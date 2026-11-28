// Kiểu dữ liệu của bộ thông dịch AutoLISP.
// nil = null · danh sách thường = mảng JS (không rỗng) · cặp chấm = Pair · số nguyên = number · số thực = Real
// · ký hiệu = Sym · chuỗi = string · đối tượng bản vẽ = Ename · bộ chọn = PickSet · hàm = LFun | Builtin.

export class Sym {
  private static table = new Map<string, Sym>();
  private constructor(readonly name: string) {}
  static of(name: string): Sym {
    const k = name.toUpperCase();
    let s = Sym.table.get(k);
    if (!s) Sym.table.set(k, (s = new Sym(k)));
    return s;
  }
}

export class Real {
  constructor(readonly v: number) {}
}

export class Pair {
  constructor(
    readonly car: Value,
    readonly cdr: Value,
  ) {}
}

export class Ename {
  constructor(readonly id: number) {}
}

export class PickSet {
  constructor(readonly ids: number[]) {}
}

/** Đối tượng ActiveX giả lập (vla-object). kind: 'ent' | 'app' | 'doc' | 'space'. */
export class VlaObj {
  constructor(
    readonly kind: 'ent' | 'app' | 'doc' | 'space',
    readonly id = 0,
  ) {}
}

/** Biến thể / mảng an toàn của VLAX: chỉ giữ giá trị bên trong. */
export class Variant {
  constructor(readonly value: Value) {}
}

/** Lỗi bắt được bởi vl-catch-all-apply. */
export class CatchError {
  constructor(readonly msg: string) {}
}

export class FileHandle {
  lines: string[] = [];
  pos = 0;
  constructor(
    readonly name: string,
    readonly mode: 'r' | 'w' | 'a',
  ) {}
}

export type Value = null | number | Real | string | Sym | Value[] | Pair | Ename | PickSet | VlaObj | Variant | FileHandle | CatchError | LFun | Builtin;

export interface LFun {
  kind: 'lambda';
  name: string;
  params: Sym[];
  locals: Sym[];
  body: Value[];
}

export type Builtin = ((args: Value[]) => Value | Promise<Value>) & { lispName?: string };

export const T = Sym.of('T');
export const NIL = null;

export const isNum = (v: Value): v is number | Real => typeof v === 'number' || v instanceof Real;
export const num = (v: Value): number => {
  if (typeof v === 'number') return v;
  if (v instanceof Real) return v.v;
  throw new LispError(`bad argument type: numberp: ${show(v)}`);
};
export const isList = (v: Value): v is Value[] | null => v === null || Array.isArray(v);
export const truthy = (v: Value): boolean => v !== null;
export const bool = (b: boolean): Value => (b ? T : null);
export const list = (a: Value[]): Value => (a.length ? a : null);

export class LispError extends Error {}
/** Thoát khỏi chương trình lisp (exit / quit / Esc). */
export class LispExit extends Error {
  constructor(readonly value: Value = null) {
    super('quit / exit abort');
  }
}

/** Số thực in theo kiểu AutoLISP (tối đa 6 chữ số có nghĩa, luôn có phần thập phân). */
export function fmtReal(x: number): string {
  if (!Number.isFinite(x)) return x > 0 ? '1.#INF' : x < 0 ? '-1.#INF' : '-1.#IND';
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return `${x}.0`;
  const s = Number(x.toPrecision(6)).toString();
  if (/e/.test(s)) {
    const [m, e] = Number(x).toExponential(5).split('e');
    return `${String(Number(m))}E${Number(e) < 0 ? '-' : '+'}${String(Math.abs(Number(e))).padStart(2, '0')}`;
  }
  return s.includes('.') ? s : `${s}.0`;
}

/** Chuỗi hiển thị (prin1: có nháy kép; princ: không). */
export function show(v: Value, princ = false): string {
  if (v === null) return 'nil';
  if (typeof v === 'number') return String(v);
  if (v instanceof Real) return fmtReal(v.v);
  if (typeof v === 'string') return princ ? v : JSON.stringify(v).replace(/\\u([0-9a-f]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  if (v instanceof Sym) return v.name;
  if (Array.isArray(v)) return `(${v.map((x) => show(x, princ)).join(' ')})`;
  if (v instanceof Pair) return `(${show(v.car, princ)} . ${show(v.cdr, princ)})`;
  if (v instanceof Ename) return `<Entity name: ${(0x7ff000000 + v.id).toString(16)}>`;
  if (v instanceof PickSet) return `<Selection set: ${v.ids.length}>`;
  if (v instanceof VlaObj) return `#<VLA-OBJECT ${v.kind === 'ent' ? 'IAcadEntity' : v.kind === 'app' ? 'IAcadApplication' : v.kind === 'doc' ? 'IAcadDocument' : 'IAcadModelSpace'} ${v.id}>`;
  if (v instanceof Variant) return `#<variant ${show(v.value)}>`;
  if (v instanceof FileHandle) return `#<file "${v.name}">`;
  if (v instanceof CatchError) return `#<%catch-all-apply-error%>`;
  if (typeof v === 'function') return `#<SUBR @${v.lispName ?? 'builtin'}>`;
  return `#<USUBR @${(v as LFun).name || 'lambda'}>`;
}
