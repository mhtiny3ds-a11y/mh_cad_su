// Gắn AutoLISP vào MHCAD: lệnh LISP / APPLOAD / LSPCHECK, lệnh C:XXX do lisp định nghĩa, và hàm chạy lisp cho API.

import type { CommandDef, Ctx, IO, Registry } from '../commands';
import { createLisp } from './cad';
import { readAll } from './reader';
import { type LFun, type Value, LispError, LispExit, Sym, show } from './types';
import type { Interp } from './interp';

export interface LispResult {
  value: string;
  output: string;
  error?: string;
  /** Số đối tượng thay đổi (thêm − bớt). */
  delta: number;
}

export interface LispRuntime {
  interp: Interp;
  /** Chạy mã lisp; io = giao diện để hỏi người dùng (getpoint, entsel…), null khi chạy từ script / AI. */
  run(code: string, io: IO | null): Promise<LispResult>;
  /** Nạp một tệp .lsp (lưu mã nguồn để (load "ten") dùng lại). */
  load(name: string, code: string, io: IO | null): Promise<LispResult>;
  /** Các hàm lisp có trong mã mà MHCAD chưa hỗ trợ. */
  check(code: string): string[];
  /** Lệnh C:XXX đã đăng ký. */
  commands(): string[];
}

/** Các dạng đặc biệt (không phải hàm) — không báo thiếu khi quét. */
const SPECIAL = new Set(['QUOTE', 'FUNCTION', 'SETQ', 'DEFUN', 'DEFUN-Q', 'LAMBDA', 'IF', 'COND', 'PROGN', 'AND', 'OR', 'WHILE', 'REPEAT', 'FOREACH']);

export function attachLisp(reg: Registry, ctx: () => Ctx): LispRuntime {
  let curIO: IO | null = null;
  const userCmds = new Set<string>();
  const L = createLisp({ reg, ctx, io: () => curIO }, (name, f) => registerCmd(name, f));

  const exec = async (code: string, io: IO | null): Promise<LispResult> => {
    const prev = curIO;
    curIO = io;
    const c = ctx();
    const n0 = c.doc.entities.size;
    L.out = '';
    const outer = !c.doc.inTransaction;
    if (outer) c.doc.begin('LISP');
    try {
      const v = await L.evalString(code);
      return { value: show(v), output: L.out, delta: c.doc.entities.size - n0 };
    } catch (e) {
      if (e instanceof LispExit) return { value: show(e.value), output: L.out, delta: c.doc.entities.size - n0 };
      // Gọi *error* nếu lisp có định nghĩa.
      const handler = L.get(Sym.of('*ERROR*'));
      const msg = (e as Error).message;
      if (handler) {
        try {
          await L.call(handler, [msg]);
        } catch {
          /* *error* lỗi tiếp: bỏ qua */
        }
      }
      return { value: 'nil', output: L.out, error: msg, delta: c.doc.entities.size - n0 };
    } finally {
      // Giữ lại phần đã vẽ được (như AutoCAD), gộp thành một bước hoàn tác.
      if (outer) c.doc.commit();
      curIO = prev;
    }
  };

  function registerCmd(name: string, f: LFun): void {
    userCmds.add(name);
    const def: CommandDef = {
      name,
      desc: `Lệnh lisp người dùng (${f.name})`,
      params: [],
      run() {
        throw new Error(`Lệnh lisp ${name}: gõ trên dòng lệnh hoặc dùng mhcad.lisp("(c:${name.toLowerCase()})")`);
      },
      async interactive(c, io) {
        const prev = curIO;
        curIO = io;
        L.out = '';
        try {
          await L.call(f as unknown as Value, []);
        } catch (e) {
          if (!(e instanceof LispExit)) {
            const handler = L.get(Sym.of('*ERROR*'));
            if (handler) await L.call(handler, [(e as Error).message]).catch(() => null);
            else io.print(`; lỗi: ${(e as Error).message}`);
          }
        } finally {
          curIO = prev;
          void c;
        }
      },
    };
    reg.register(def);
  }

  // Lệnh của bản thân MHCAD để chạy lisp từ dòng lệnh / menu.
  reg.register({
    name: 'LISP',
    aliases: ['VLISP', 'VLIDE', 'EVAL'],
    desc: 'Chạy mã AutoLISP (từ AI / script: mhcad.lisp("(...)")). Gõ trực tiếp biểu thức bắt đầu bằng "(" trên dòng lệnh cũng được',
    params: [{ name: 'code', type: 'string', required: true, desc: 'Mã AutoLISP' }],
    run() {
      throw new Error('Dùng mhcad.lisp(code) (trả về Promise) để chạy lisp từ script');
    },
    async interactive(_c, io) {
      const code = io.getText ? await io.getText('Mã AutoLISP') : await io.getString('Mã AutoLISP', { spaces: true });
      if (!code) return;
      const r = await exec(code, io);
      if (r.output.trim()) io.print(r.output.trim());
      io.print(r.error ? `; lỗi: ${r.error}` : r.value);
    },
  });
  reg.register({
    name: 'LSPCHECK',
    desc: 'Quét mã lisp, liệt kê các hàm MHCAD chưa hỗ trợ',
    params: [{ name: 'code', type: 'string', required: true, desc: 'Mã AutoLISP' }],
    readonly: true,
    run(_c, args) {
      const miss = check(String(args.code ?? ''));
      return { missing: miss, message: miss.length ? `Chưa hỗ trợ: ${miss.join(', ')}` : 'Mọi hàm trong mã đều có sẵn' };
    },
  });

  function check(code: string): string[] {
    const defined = new Set<string>();
    const used = new Set<string>();
    const walk = (v: Value) => {
      if (!Array.isArray(v)) return;
      const h = v[0];
      if (h instanceof Sym) {
        if ((h.name === 'DEFUN' || h.name === 'DEFUN-Q') && v[1] instanceof Sym) defined.add(v[1].name);
        if (h.name === 'QUOTE') return;
        if (!SPECIAL.has(h.name)) used.add(h.name);
        // Tham số / biến cục bộ của defun, lambda không phải lời gọi hàm.
        const start = h.name === 'DEFUN' || h.name === 'DEFUN-Q' ? 3 : h.name === 'LAMBDA' ? 2 : h.name === 'FOREACH' ? 2 : 1;
        for (const x of v.slice(start)) walk(x);
        if (h.name === 'SETQ') for (let i = 1; i < v.length; i += 2) if (v[i] instanceof Sym) defined.add((v[i] as Sym).name);
        if (h.name === 'COND') for (const cl of v.slice(1)) if (Array.isArray(cl)) for (const x of cl) walk(x);
        return;
      }
      for (const x of v) walk(x);
    };
    let forms: Value[];
    try {
      forms = readAll(code);
    } catch (e) {
      return [`(lỗi cú pháp: ${(e as Error).message})`];
    }
    forms.forEach(walk);
    return [...used].filter((n) => !defined.has(n) && L.get(Sym.of(n)) === null && !L.resolveMissing?.(n)).sort();
  }

  return {
    interp: L,
    run: exec,
    async load(name, code, io) {
      L.sources.set(name.toLowerCase().replace(/^.*[\\/]/, ''), code);
      return exec(code, io);
    },
    check,
    commands: () => [...userCmds],
  };
}

export { LispError };
