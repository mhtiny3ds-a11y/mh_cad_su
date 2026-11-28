// Bộ thông dịch AutoLISP: đánh giá biểu thức (bất đồng bộ để gọi được lệnh tương tác), dạng đặc biệt và hàm lõi.
// Phạm vi biến động (dynamic scope) như AutoLISP: tham số và biến cục bộ của defun được gán tạm rồi trả lại.

import { readAll } from './reader';
import {
  type Builtin,
  type LFun,
  type Value,
  CatchError,
  FileHandle,
  LispError,
  LispExit,
  NIL,
  Pair,
  Real,
  Sym,
  T,
  bool,
  fmtReal,
  isNum,
  list,
  num,
  show,
  truthy,
} from './types';

const S = Sym.of;
const LAMBDA = S('LAMBDA');
const SLASH = S('/');

/** Số thực nếu có toán hạng thực, ngược lại số nguyên (32-bit như AutoLISP). */
const mk = (v: number, real: boolean): Value => (real ? new Real(v) : v | 0);
const anyReal = (a: Value[]) => a.some((x) => x instanceof Real);

const str = (v: Value, fn: string): string => {
  if (typeof v !== 'string') throw new LispError(`bad argument type: stringp ${show(v)} (${fn})`);
  return v;
};
const int = (v: Value, fn: string): number => {
  if (typeof v !== 'number') throw new LispError(`bad argument type: fixnump: ${show(v)} (${fn})`);
  return v;
};
const arr = (v: Value): Value[] => {
  if (v === null) return [];
  if (Array.isArray(v)) return v;
  throw new LispError(`bad argument type: listp ${show(v)}`);
};

export function car(v: Value): Value {
  if (v === null) return null;
  if (Array.isArray(v)) return v[0];
  if (v instanceof Pair) return v.car;
  throw new LispError(`bad argument type: consp ${show(v)}`);
}
export function cdr(v: Value): Value {
  if (v === null) return null;
  if (Array.isArray(v)) return list(v.slice(1));
  if (v instanceof Pair) return v.cdr;
  throw new LispError(`bad argument type: consp ${show(v)}`);
}

/** So sánh equal (cấu trúc), có sai số cho số thực. */
export function equal(a: Value, b: Value, fuzz = 0): boolean {
  if (isNum(a) && isNum(b)) return Math.abs(num(a) - num(b)) <= fuzz;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i], fuzz));
  if (a instanceof Pair && b instanceof Pair) return equal(a.car, b.car, fuzz) && equal(a.cdr, b.cdr, fuzz);
  if (a && b && typeof a === 'object' && 'id' in a && typeof b === 'object' && 'id' in b) return a.constructor === b.constructor && (a as { id: number }).id === (b as { id: number }).id;
  return a === b;
}

const eq = (a: Value, b: Value): boolean => {
  if (isNum(a) && isNum(b)) return num(a) === num(b) && (a instanceof Real) === (b instanceof Real);
  if (a && b && typeof a === 'object' && 'id' in a && typeof b === 'object' && 'id' in b) return a.constructor === b.constructor && (a as { id: number }).id === (b as { id: number }).id;
  return a === b;
};

/** Khớp mẫu ký tự đại diện kiểu wcmatch: * ? # @ . ~ [..] , ` */
export function wcmatch(s: string, pattern: string): boolean {
  const pats: string[] = [];
  let cur = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '`' && i + 1 < pattern.length) {
      cur += c + pattern[++i];
      continue;
    }
    if (c === ',') {
      pats.push(cur);
      cur = '';
    } else cur += c;
  }
  pats.push(cur);
  const toRe = (p: string) => {
    let neg = false;
    if (p.startsWith('~')) {
      neg = true;
      p = p.slice(1);
    }
    let re = '';
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === '`') re += (p[++i] ?? '').replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
      else if (c === '*') re += '.*';
      else if (c === '?') re += '.';
      else if (c === '#') re += '[0-9]';
      else if (c === '@') re += '\\p{L}';
      else if (c === '.') re += '[^\\p{L}\\p{N}]';
      else if (c === '[') {
        const j = p.indexOf(']', i + 1);
        if (j < 0) re += '\\[';
        else {
          let body = p.slice(i + 1, j);
          const not = body.startsWith('~');
          if (not) body = body.slice(1);
          re += `[${not ? '^' : ''}${body.replace(/[\\^\]]/g, '\\$&')}]`;
          i = j;
        }
      } else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    }
    return { re: new RegExp(`^${re}$`, 'u'), neg };
  };
  return pats.some((p) => {
    const { re, neg } = toRe(p);
    return re.test(s) !== neg;
  });
}

/** rtos: mode 2 thập phân (mặc định), 1 khoa học. */
export function rtos(x: number, mode = 2, prec = 4): string {
  if (mode === 1) return x.toExponential(prec).replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2');
  const s = x.toFixed(Math.max(0, Math.min(15, prec)));
  return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}

export interface LispHost {
  print(s: string): void;
}

export class Interp {
  readonly globals = new Map<Sym, Value>();
  private steps = 0;
  /** Giới hạn bước tính (chống vòng lặp vô hạn). */
  maxSteps = 50_000_000;
  out = '';

  constructor(public host: LispHost = { print: () => {} }) {
    this.installCore();
  }

  def(name: string, f: Builtin): void {
    f.lispName = name.toUpperCase();
    this.globals.set(S(name), f);
  }

  get(sym: Sym): Value {
    return this.globals.has(sym) ? this.globals.get(sym)! : null;
  }

  set(sym: Sym, v: Value): void {
    this.globals.set(sym, v);
  }

  emit(s: string): void {
    this.out += s;
    this.host.print(s);
  }

  /** Đọc và chạy mã nguồn; trả về giá trị biểu thức cuối. */
  async evalString(src: string): Promise<Value> {
    let r: Value = null;
    for (const form of readAll(src)) r = await this.eval(form);
    return r;
  }

  toFn(f: Value): LFun | Builtin {
    if (typeof f === 'function') return f as Builtin;
    if (f && typeof f === 'object' && 'kind' in f && (f as LFun).kind === 'lambda') return f as LFun;
    if (f instanceof Sym) {
      const v = this.get(f);
      if (v === null) {
        const r = this.resolveMissing?.(f.name);
        if (r) return r;
        throw new LispError(`no function definition: ${f.name}`);
      }
      return this.toFn(v);
    }
    if (Array.isArray(f) && f[0] === LAMBDA) return this.makeLambda('', f[1], f.slice(2));
    throw new LispError(`bad function: ${show(f)}`);
  }

  makeLambda(name: string, spec: Value, body: Value[]): LFun {
    const params: Sym[] = [];
    const locals: Sym[] = [];
    let into = params;
    for (const p of arr(spec)) {
      if (p === SLASH) {
        into = locals;
        continue;
      }
      if (!(p instanceof Sym)) throw new LispError(`bad formal argument list: ${show(spec)}`);
      into.push(p);
    }
    return { kind: 'lambda', name, params, locals, body };
  }

  async call(f: Value, args: Value[]): Promise<Value> {
    const fn = this.toFn(f);
    if (typeof fn === 'function') return fn(args);
    if (args.length !== fn.params.length) throw new LispError(`too ${args.length > fn.params.length ? 'many' : 'few'} arguments`);
    const vars = [...fn.params, ...fn.locals];
    const saved = vars.map((s) => (this.globals.has(s) ? this.globals.get(s)! : undefined));
    fn.params.forEach((s, i) => this.globals.set(s, args[i]));
    fn.locals.forEach((s) => this.globals.set(s, null));
    try {
      let r: Value = null;
      for (const x of fn.body) r = await this.eval(x);
      return r;
    } finally {
      vars.forEach((s, i) => {
        if (saved[i] === undefined) this.globals.delete(s);
        else this.globals.set(s, saved[i]!);
      });
    }
  }

  async eval(x: Value): Promise<Value> {
    if (++this.steps > this.maxSteps) throw new LispError('vượt giới hạn tính toán (vòng lặp vô hạn?)');
    if (x instanceof Sym) return x === T ? T : this.get(x);
    if (!Array.isArray(x)) return x;
    const head = x[0];
    if (head instanceof Sym) {
      switch (head.name) {
        case 'QUOTE':
          return x[1] ?? null;
        case 'FUNCTION':
          return Array.isArray(x[1]) && x[1][0] === LAMBDA ? this.makeLambda('', x[1][1], x[1].slice(2)) : (x[1] ?? null);
        case 'SETQ': {
          let v: Value = null;
          for (let i = 1; i < x.length; i += 2) {
            const s = x[i];
            if (!(s instanceof Sym)) throw new LispError(`bad argument type: symbolp ${show(s)}`);
            v = await this.eval(x[i + 1] ?? null);
            this.globals.set(s, v);
          }
          return v;
        }
        case 'DEFUN':
        case 'DEFUN-Q': {
          const name = x[1];
          if (!(name instanceof Sym)) throw new LispError('bad DEFUN syntax');
          const f = this.makeLambda(name.name, x[2] ?? null, x.slice(3));
          this.globals.set(name, f);
          this.onDefun?.(name.name, f);
          return name;
        }
        case 'LAMBDA':
          return this.makeLambda('', x[1] ?? null, x.slice(2));
        case 'IF':
          return truthy(await this.eval(x[1] ?? null)) ? this.eval(x[2] ?? null) : x.length > 3 ? this.eval(x[3]) : null;
        case 'COND':
          for (const c of x.slice(1)) {
            const cl = arr(c);
            const t = await this.eval(cl[0] ?? null);
            if (truthy(t)) {
              let r = t;
              for (const e of cl.slice(1)) r = await this.eval(e);
              return r;
            }
          }
          return null;
        case 'PROGN': {
          let r: Value = null;
          for (const e of x.slice(1)) r = await this.eval(e);
          return r;
        }
        case 'AND':
          for (const e of x.slice(1)) if (!truthy(await this.eval(e))) return null;
          return T;
        case 'OR':
          for (const e of x.slice(1)) if (truthy(await this.eval(e))) return T;
          return null;
        case 'WHILE': {
          let r: Value = null;
          while (truthy(await this.eval(x[1] ?? null))) for (const e of x.slice(2)) r = await this.eval(e);
          return r;
        }
        case 'REPEAT': {
          const n = num(await this.eval(x[1] ?? null));
          let r: Value = null;
          for (let i = 0; i < n; i++) for (const e of x.slice(2)) r = await this.eval(e);
          return r;
        }
        case 'FOREACH': {
          const s = x[1];
          if (!(s instanceof Sym)) throw new LispError('bad FOREACH syntax');
          const items = arr(await this.eval(x[2] ?? null));
          const had = this.globals.has(s);
          const old = this.globals.get(s);
          let r: Value = null;
          try {
            for (const it of items) {
              this.globals.set(s, it);
              for (const e of x.slice(3)) r = await this.eval(e);
            }
          } finally {
            if (had) this.globals.set(s, old!);
            else this.globals.delete(s);
          }
          return r;
        }
      }
    }
    const fn = this.toFn(head);
    const args: Value[] = [];
    for (let i = 1; i < x.length; i++) args.push(await this.eval(x[i]));
    return this.call(fn as Value, args);
  }

  /** Hàm sinh theo tên khi chưa định nghĩa (vla-get-xxx / vla-put-xxx). */
  resolveMissing?: (name: string) => Builtin | null;
  /** Mã nguồn các tệp lisp đã nạp (cho hàm load). Khoá: tên tệp viết thường. */
  readonly sources = new Map<string, string>();

  /** Gọi khi định nghĩa hàm (để đăng ký lệnh C:XXX). */
  onDefun?: (name: string, f: LFun) => void;

  private installCore(): void {
    const d = (n: string, f: Builtin) => this.def(n, f);
    this.set(S('PI'), new Real(Math.PI));
    this.set(T, T);
    this.set(S('PAUSE'), '\\');

    // ---- Số học ----
    d('+', (a) => mk(a.reduce<number>((s, v) => s + num(v), 0), anyReal(a)));
    d('-', (a) => (a.length === 1 ? mk(-num(a[0]), anyReal(a)) : mk(a.slice(1).reduce<number>((s, v) => s - num(v), num(a[0] ?? 0)), anyReal(a))));
    d('*', (a) => mk(a.reduce<number>((s, v) => s * num(v), 1), anyReal(a)));
    d('/', (a) => {
      if (!a.length) return 0;
      const real = anyReal(a);
      let r = num(a[0]);
      for (const v of a.slice(1)) {
        const b = num(v);
        if (b === 0) throw new LispError('divide by zero');
        r = real ? r / b : Math.trunc(r / b);
      }
      return mk(r, real);
    });
    d('1+', (a) => mk(num(a[0]) + 1, anyReal(a)));
    d('1-', (a) => mk(num(a[0]) - 1, anyReal(a)));
    d('REM', (a) => mk(a.slice(1).reduce<number>((s, v) => s % num(v), num(a[0])), anyReal(a)));
    d('ABS', (a) => mk(Math.abs(num(a[0])), anyReal(a)));
    d('MAX', (a) => mk(Math.max(...a.map(num)), anyReal(a)));
    d('MIN', (a) => mk(Math.min(...a.map(num)), anyReal(a)));
    d('SQRT', (a) => new Real(Math.sqrt(num(a[0]))));
    d('SIN', (a) => new Real(Math.sin(num(a[0]))));
    d('COS', (a) => new Real(Math.cos(num(a[0]))));
    d('ATAN', (a) => new Real(a.length > 1 ? Math.atan2(num(a[0]), num(a[1])) : Math.atan(num(a[0]))));
    d('EXPT', (a) => mk(num(a[0]) ** num(a[1]), anyReal(a)));
    d('EXP', (a) => new Real(Math.exp(num(a[0]))));
    d('LOG', (a) => new Real(Math.log(num(a[0]))));
    d('FIX', (a) => Math.trunc(num(a[0])));
    d('FLOAT', (a) => new Real(num(a[0])));
    d('GCD', (a) => {
      let [x, y] = [Math.abs(int(a[0], 'gcd')), Math.abs(int(a[1], 'gcd'))];
      while (y) [x, y] = [y, x % y];
      return x;
    });
    d('LOGAND', (a) => a.reduce<number>((s, v) => s & int(v, 'logand'), -1));
    d('LOGIOR', (a) => a.reduce<number>((s, v) => s | int(v, 'logior'), 0));
    d('LSH', (a) => {
      const n = int(a[1] ?? 0, 'lsh');
      return n >= 0 ? int(a[0], 'lsh') << n : int(a[0], 'lsh') >>> -n;
    });
    d('~', (a) => ~int(a[0], '~'));
    d('BOOLE', (a) => {
      const op = int(a[0], 'boole');
      return a.slice(2).reduce<number>((s, v) => {
        const b = int(v, 'boole');
        let r = 0;
        for (let bit = 0; bit < 32; bit++) {
          const i1 = (s >> bit) & 1;
          const i2 = (b >> bit) & 1;
          if ((op >> (3 - (i1 * 2 + i2))) & 1) r |= 1 << bit;
        }
        return r;
      }, int(a[1], 'boole'));
    });
    const cmp = (name: string, f: (x: number | string, y: number | string) => boolean) =>
      d(name, (a) => {
        const vals = a.map((v) => (typeof v === 'string' ? v : num(v)));
        for (let i = 0; i + 1 < vals.length; i++) if (!f(vals[i], vals[i + 1])) return null;
        return T;
      });
    cmp('=', (x, y) => x === y);
    cmp('<', (x, y) => x < y);
    cmp('>', (x, y) => x > y);
    cmp('<=', (x, y) => x <= y);
    cmp('>=', (x, y) => x >= y);
    d('/=', (a) => {
      const vals = a.map((v) => (typeof v === 'string' ? v : num(v)));
      for (let i = 0; i + 1 < vals.length; i++) if (vals[i] === vals[i + 1]) return null;
      return T;
    });
    d('ZEROP', (a) => bool(num(a[0]) === 0));
    d('MINUSP', (a) => bool(num(a[0]) < 0));
    d('NUMBERP', (a) => bool(isNum(a[0])));

    // ---- Danh sách ----
    d('CAR', (a) => car(a[0]));
    d('CDR', (a) => cdr(a[0]));
    for (const p of ['AA', 'AD', 'DA', 'DD', 'AAA', 'AAD', 'ADA', 'ADD', 'DAA', 'DAD', 'DDA', 'DDD', 'ADDD', 'DDDD']) {
      d(`C${p}R`, (a) => {
        let v = a[0];
        for (let i = p.length - 1; i >= 0; i--) v = p[i] === 'A' ? car(v) : cdr(v);
        return v;
      });
    }
    d('CONS', (a) => {
      const [x, y] = a;
      if (y === null || y === undefined) return [x];
      if (Array.isArray(y)) return [x, ...y];
      return new Pair(x, y);
    });
    d('LIST', (a) => list(a));
    d('APPEND', (a) => list(a.flatMap((v) => arr(v))));
    d('LENGTH', (a) => arr(a[0]).length);
    d('REVERSE', (a) => list([...arr(a[0])].reverse()));
    d('NTH', (a) => arr(a[1])[int(a[0], 'nth')] ?? null);
    d('LAST', (a) => {
      const l = arr(a[0]);
      return l.length ? l[l.length - 1] : null;
    });
    d('MEMBER', (a) => {
      const l = arr(a[1]);
      const i = l.findIndex((v) => equal(v, a[0]));
      return i < 0 ? null : list(l.slice(i));
    });
    d('ASSOC', (a) => arr(a[1]).find((v) => (v instanceof Pair || Array.isArray(v)) && equal(car(v), a[0])) ?? null);
    d('SUBST', (a) => {
      const [nw, old, l] = a;
      const rep = (v: Value): Value => (equal(v, old) ? nw : Array.isArray(v) ? v.map(rep) : v);
      return list(arr(l).map(rep));
    });
    d('LISTP', (a) => bool(a[0] === null || Array.isArray(a[0]) || a[0] instanceof Pair));
    d('VL-CONSP', (a) => bool(Array.isArray(a[0]) || a[0] instanceof Pair));
    d('ATOM', (a) => bool(!(Array.isArray(a[0]) || a[0] instanceof Pair)));
    d('NULL', (a) => bool(a[0] === null));
    d('NOT', (a) => bool(a[0] === null));
    d('VL-LIST*', (a) => {
      const last = a[a.length - 1];
      const head = a.slice(0, -1);
      if (last === null) return list(head);
      if (Array.isArray(last)) return [...head, ...last];
      return head.length === 1 ? new Pair(head[0], last) : list([...head, last]);
    });
    d('VL-POSITION', (a) => {
      const i = arr(a[1]).findIndex((v) => equal(v, a[0]));
      return i < 0 ? null : i;
    });
    d('VL-REMOVE', (a) => list(arr(a[1]).filter((v) => !equal(v, a[0]))));
    const pred = async (f: Value, v: Value) => truthy(await this.call(f, [v]));
    d('VL-REMOVE-IF', async (a) => {
      const out: Value[] = [];
      for (const v of arr(a[1])) if (!(await pred(a[0], v))) out.push(v);
      return list(out);
    });
    d('VL-REMOVE-IF-NOT', async (a) => {
      const out: Value[] = [];
      for (const v of arr(a[1])) if (await pred(a[0], v)) out.push(v);
      return list(out);
    });
    d('VL-MEMBER-IF', async (a) => {
      const l = arr(a[1]);
      for (let i = 0; i < l.length; i++) if (await pred(a[0], l[i])) return list(l.slice(i));
      return null;
    });
    d('VL-MEMBER-IF-NOT', async (a) => {
      const l = arr(a[1]);
      for (let i = 0; i < l.length; i++) if (!(await pred(a[0], l[i]))) return list(l.slice(i));
      return null;
    });
    d('VL-SOME', async (a) => {
      const lists = a.slice(1).map(arr);
      const n = Math.min(...lists.map((l) => l.length));
      for (let i = 0; i < n; i++) {
        const r = await this.call(a[0], lists.map((l) => l[i]));
        if (truthy(r)) return r;
      }
      return null;
    });
    d('VL-EVERY', async (a) => {
      const lists = a.slice(1).map(arr);
      const n = Math.min(...lists.map((l) => l.length));
      for (let i = 0; i < n; i++) if (!truthy(await this.call(a[0], lists.map((l) => l[i])))) return null;
      return T;
    });
    const sortWith = async (l: Value[], f: Value): Promise<number[]> => {
      // Sắp xếp trộn (merge sort) với hàm so sánh bất đồng bộ.
      const idx = l.map((_, i) => i);
      const ms = async (xs: number[]): Promise<number[]> => {
        if (xs.length < 2) return xs;
        const m = xs.length >> 1;
        const [p, q] = [await ms(xs.slice(0, m)), await ms(xs.slice(m))];
        const out: number[] = [];
        while (p.length && q.length) out.push(truthy(await this.call(f, [l[q[0]], l[p[0]]])) ? q.shift()! : p.shift()!);
        return [...out, ...p, ...q];
      };
      return ms(idx);
    };
    d('VL-SORT', async (a) => {
      const l = arr(a[0]);
      return list((await sortWith(l, a[1])).map((i) => l[i]));
    });
    d('VL-SORT-I', async (a) => list(await sortWith(arr(a[0]), a[1])));
    d('ACAD_STRLSORT', (a) => list([...arr(a[0])].sort((x, y) => String(x).localeCompare(String(y)))));
    d('MAPCAR', async (a) => {
      const lists = a.slice(1).map(arr);
      const n = lists.length ? Math.min(...lists.map((l) => l.length)) : 0;
      const out: Value[] = [];
      for (let i = 0; i < n; i++) out.push(await this.call(a[0], lists.map((l) => l[i])));
      return list(out);
    });
    d('APPLY', (a) => this.call(a[0], arr(a[1])));
    d('EVAL', (a) => this.eval(a[0]));
    d('READ', (a) => {
      const f = readAll(str(a[0] ?? '', 'read'));
      return f[0] ?? null;
    });
    d('VL-CATCH-ALL-APPLY', async (a) => {
      try {
        return await this.call(a[0], arr(a[1]));
      } catch (e) {
        if (e instanceof LispExit) throw e;
        return new CatchError((e as Error).message);
      }
    });
    d('VL-CATCH-ALL-ERROR-P', (a) => bool(a[0] instanceof CatchError));
    d('VL-CATCH-ALL-ERROR-MESSAGE', (a) => (a[0] instanceof CatchError ? a[0].msg : ''));
    d('EXIT', () => {
      throw new LispExit();
    });
    d('QUIT', () => {
      throw new LispExit();
    });
    d('VL-EXIT-WITH-VALUE', (a) => {
      throw new LispExit(a[0] ?? null);
    });
    d('VL-EXIT-WITH-ERROR', (a) => {
      throw new LispError(String(a[0] ?? ''));
    });

    // ---- Ký hiệu / kiểu ----
    d('EQ', (a) => bool(eq(a[0], a[1])));
    d('EQUAL', (a) => bool(equal(a[0], a[1], a[2] === undefined ? 0 : num(a[2]))));
    d('TYPE', (a) => {
      const v = a[0];
      if (v === null) return null;
      if (typeof v === 'number') return S('INT');
      if (v instanceof Real) return S('REAL');
      if (typeof v === 'string') return S('STR');
      if (v instanceof Sym) return S('SYM');
      if (Array.isArray(v) || v instanceof Pair) return S('LIST');
      if (typeof v === 'function') return S('SUBR');
      if (v instanceof FileHandle) return S('FILE');
      const ctor = (v as object).constructor?.name;
      if (ctor === 'Ename') return S('ENAME');
      if (ctor === 'PickSet') return S('PICKSET');
      if (ctor === 'VlaObj') return S('VLA-OBJECT');
      if (ctor === 'Variant') return S('VARIANT');
      return S('USUBR');
    });
    d('BOUNDP', (a) => bool(a[0] instanceof Sym && this.globals.has(a[0]) && this.globals.get(a[0]) !== null));
    d('SET', (a) => {
      if (!(a[0] instanceof Sym)) throw new LispError('bad argument type: symbolp');
      this.globals.set(a[0], a[1] ?? null);
      return a[1] ?? null;
    });
    d('VL-SYMBOL-NAME', (a) => (a[0] instanceof Sym ? a[0].name : ''));
    d('VL-SYMBOLP', (a) => bool(a[0] instanceof Sym));
    d('VL-SYMBOL-VALUE', (a) => (a[0] instanceof Sym ? this.get(a[0]) : null));
    d('ATOMS-FAMILY', (a) => {
      const names = [...this.globals.keys()].map((s) => s.name);
      if (a[1] !== undefined && a[1] !== null) return list(arr(a[1]).map((n) => (names.includes(String(n).toUpperCase()) ? (a[0] === 1 ? n : S(String(n))) : null)));
      return list(names.map((n) => (a[0] === 1 ? n : S(n))));
    });

    // ---- Chuỗi ----
    d('STRCAT', (a) => a.map((v) => str(v, 'strcat')).join(''));
    d('STRLEN', (a) => a.reduce<number>((s, v) => s + str(v, 'strlen').length, 0));
    d('SUBSTR', (a) => {
      const s = str(a[0], 'substr');
      const st = int(a[1], 'substr') - 1;
      return a[2] === undefined || a[2] === null ? s.slice(st) : s.substr(st, int(a[2], 'substr'));
    });
    d('STRCASE', (a) => (truthy(a[1] ?? null) ? str(a[0], 'strcase').toLocaleLowerCase('vi') : str(a[0], 'strcase').toLocaleUpperCase('vi')));
    d('ITOA', (a) => String(int(a[0], 'itoa')));
    d('ATOI', (a) => {
      const m = /^\s*[+-]?\d+/.exec(str(a[0], 'atoi'));
      return m ? Number(m[0]) | 0 : 0;
    });
    d('ATOF', (a) => {
      const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(str(a[0], 'atof'));
      return new Real(m ? Number(m[0]) : 0);
    });
    d('ASCII', (a) => str(a[0], 'ascii').codePointAt(0) ?? 0);
    d('CHR', (a) => String.fromCodePoint(int(a[0], 'chr')));
    d('RTOS', (a) => rtos(num(a[0]), a[1] == null ? 2 : num(a[1]), a[2] == null ? 4 : num(a[2])));
    d('DISTOF', (a) => {
      const v = Number(str(a[0], 'distof').trim().replace(',', '.'));
      return Number.isFinite(v) ? new Real(v) : null;
    });
    d('ANGTOS', (a) => {
      const deg = (num(a[0]) * 180) / Math.PI;
      const mode = a[1] == null ? 0 : num(a[1]);
      const prec = a[2] == null ? 4 : num(a[2]);
      if (mode === 3) return rtos(num(a[0]), 2, prec) + 'r';
      if (mode === 1) {
        const d0 = Math.floor(deg);
        const m = Math.floor((deg - d0) * 60);
        const s = ((deg - d0) * 60 - m) * 60;
        return `${d0}d${m}'${s.toFixed(Math.max(0, prec - 4))}"`;
      }
      return rtos(((deg % 360) + 360) % 360, 2, prec);
    });
    d('ANGTOF', (a) => {
      const v = Number(str(a[0], 'angtof'));
      return Number.isFinite(v) ? new Real((v * Math.PI) / 180) : null;
    });
    d('WCMATCH', (a) => bool(wcmatch(str(a[0], 'wcmatch'), str(a[1], 'wcmatch'))));
    d('VL-STRING-SEARCH', (a) => {
      const i = str(a[1], 'vl-string-search').indexOf(str(a[0], 'vl-string-search'), a[2] == null ? 0 : num(a[2]));
      return i < 0 ? null : i;
    });
    d('VL-STRING-POSITION', (a) => {
      const s = str(a[1], 'vl-string-position');
      const ch = String.fromCharCode(int(a[0], 'vl-string-position'));
      const i = truthy(a[3] ?? null) ? s.lastIndexOf(ch) : s.indexOf(ch, a[2] == null ? 0 : num(a[2]));
      return i < 0 ? null : i;
    });
    d('VL-STRING-SUBST', (a) => {
      const s = str(a[2], 'vl-string-subst');
      const pat = str(a[1], 'vl-string-subst');
      const i = s.indexOf(pat, a[3] == null ? 0 : num(a[3]));
      return i < 0 ? s : s.slice(0, i) + str(a[0], 'vl-string-subst') + s.slice(i + pat.length);
    });
    d('VL-STRING-TRANSLATE', (a) => {
      const from = str(a[0], 'vl-string-translate');
      const to = str(a[1], 'vl-string-translate');
      return [...str(a[2], 'vl-string-translate')].map((c) => {
        const i = from.indexOf(c);
        return i < 0 ? c : (to[Math.min(i, to.length - 1)] ?? c);
      }).join('');
    });
    const trimSet = (set: string) => new RegExp(`[${set.replace(/[\\\]^-]/g, '\\$&')}]`);
    d('VL-STRING-TRIM', (a) => {
      const re = trimSet(str(a[0], 'vl-string-trim'));
      let s = str(a[1], 'vl-string-trim');
      while (s && re.test(s[0])) s = s.slice(1);
      while (s && re.test(s[s.length - 1])) s = s.slice(0, -1);
      return s;
    });
    d('VL-STRING-LEFT-TRIM', (a) => {
      const re = trimSet(str(a[0], 'vl-string-left-trim'));
      let s = str(a[1], 'vl-string-left-trim');
      while (s && re.test(s[0])) s = s.slice(1);
      return s;
    });
    d('VL-STRING-RIGHT-TRIM', (a) => {
      const re = trimSet(str(a[0], 'vl-string-right-trim'));
      let s = str(a[1], 'vl-string-right-trim');
      while (s && re.test(s[s.length - 1])) s = s.slice(0, -1);
      return s;
    });
    d('VL-STRING->LIST', (a) => list([...str(a[0], 'vl-string->list')].map((c) => c.codePointAt(0)!)));
    d('VL-LIST->STRING', (a) => arr(a[0]).map((c) => String.fromCodePoint(num(c))).join(''));
    d('VL-STRING-ELT', (a) => str(a[0], 'vl-string-elt').charCodeAt(int(a[1], 'vl-string-elt')));
    d('VL-STRING-MISMATCH', (a) => {
      const [x, y] = [str(a[0], 'm'), str(a[1], 'm')];
      let i = 0;
      while (i < x.length && i < y.length && x[i] === y[i]) i++;
      return i;
    });
    d('VL-PRINC-TO-STRING', (a) => show(a[0], true));
    d('VL-PRIN1-TO-STRING', (a) => show(a[0]));
    d('VL-FILENAME-BASE', (a) => str(a[0], 'f').replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, ''));
    d('VL-FILENAME-EXTENSION', (a) => {
      const m = /(\.[^.\\/]*)$/.exec(str(a[0], 'f'));
      return m ? m[1] : null;
    });
    d('VL-FILENAME-DIRECTORY', (a) => str(a[0], 'f').replace(/[\\/][^\\/]*$/, ''));
    d('VL-FILENAME-MKTEMP', () => `tmp${Date.now()}`);

    // ---- In ra ----
    // (princ) không đối số: thoát "im lặng" (không in gì ở cuối hàm lệnh).
    const QUIET = S('');
    d('PRINC', (a) => {
      if (a[0] !== undefined) this.emit(show(a[0], true));
      return a[0] === undefined ? QUIET : a[0];
    });
    d('PRIN1', (a) => {
      if (a[0] !== undefined) this.emit(show(a[0]));
      return a[0] === undefined ? QUIET : a[0];
    });
    d('PRINT', (a) => {
      this.emit('\n' + show(a[0] ?? null) + ' ');
      return a[0] ?? null;
    });
    d('PROMPT', (a) => {
      this.emit(String(a[0] ?? ''));
      return null;
    });
    d('TERPRI', () => {
      this.emit('\n');
      return null;
    });
    d('ALERT', (a) => {
      this.emit(`\n[Thông báo] ${String(a[0] ?? '')}\n`);
      return null;
    });
    for (const n of ['TEXTSCR', 'GRAPHSCR', 'TEXTPAGE', 'GC', 'VL-LOAD-COM', 'VL-LOAD-REACTORS', 'ACAD-PUSH-DBMOD', 'ACAD-POP-DBMOD', 'SETFUNHELP', 'VL-BT'])
      d(n, () => null);
    d('VER', () => 'Visual LISP 2026 (vi) MHCAD');
    d('GETCNAME', (a) => String(a[0] ?? '').replace(/^[_.\-]+/, '').toUpperCase());

    // ---- Tệp (trong bộ nhớ) ----
    const files = new Map<string, string[]>();
    this.files = files;
    d('OPEN', (a) => {
      const name = str(a[0], 'open');
      const mode = str(a[1], 'open').toLowerCase()[0] as 'r' | 'w' | 'a';
      const fh = new FileHandle(name, mode);
      if (mode === 'r') {
        const c = files.get(name.toLowerCase());
        if (!c) return null;
        fh.lines = [...c];
      } else if (mode === 'a') fh.lines = [...(files.get(name.toLowerCase()) ?? [])];
      return fh;
    });
    d('CLOSE', (a) => {
      const f = a[0];
      if (f instanceof FileHandle && f.mode !== 'r') files.set(f.name.toLowerCase(), f.lines);
      return null;
    });
    d('WRITE-LINE', (a) => {
      const f = a[1];
      if (f instanceof FileHandle) f.lines.push(str(a[0], 'write-line'));
      else this.emit(`\n${str(a[0], 'write-line')}`);
      return a[0];
    });
    d('READ-LINE', (a) => {
      const f = a[0];
      if (!(f instanceof FileHandle)) return null;
      return f.pos < f.lines.length ? f.lines[f.pos++] : null;
    });
    d('FINDFILE', (a) => (files.has(str(a[0], 'findfile').toLowerCase()) ? a[0] : null));
  }

  /** Tệp ảo trong bộ nhớ (open / write-line / read-line). */
  files = new Map<string, string[]>();

  /** Định dạng giá trị trả về cho người dùng xem. */
  static show = show;
  static real = (v: number) => new Real(v);
  static fmtReal = fmtReal;
}

export { NIL };
