// Hàm AutoLISP làm việc với bản vẽ: command, entget / entmake / entmod, ssget, tblsearch, getvar / setvar,
// get* (nhập từ người dùng), hình học, vlax-curve-*, một phần VLA / ACET.

import { type Vec, add, angleOf, deg2rad, dist, polar, rad2deg, segSegIntersection, sub } from '../geom';
import { type Entity, type NewEntity, bbox, distanceTo, hatchArea, insideBox, nearestOn, normDeg, snapPoints, textCorners, touchesBox } from '../entities';
import { type Args, type Ctx, type IO, type Registry, CancelError, runCommand, runInteractive } from '../commands';
import { type CurveEnt, curveLength, isCurve, pointAt } from '../curve';
import { parseInput } from '../input';
import { PATTERNS, resolvePattern } from '../hatch';
import { measure } from '../dim';
import { Interp, wcmatch } from './interp';
import { type LFun, type Value, Ename, LispError, Pair, PickSet, Real, Sym, T, Variant, VlaObj, bool, isNum, list, num, show, truthy } from './types';

const S = Sym.of;
const R = (v: number) => new Real(v);
const P3 = (p: Vec): Value => [R(p[0]), R(p[1]), R(0)];
const P2 = (p: Vec): Value => [R(p[0]), R(p[1])];
const dp = (code: number, v: Value) => new Pair(code, v);

/** Điểm lisp (x y [z]) → Vec. */
export function toPt(v: Value): Vec | null {
  if (v instanceof Variant) return toPt(v.value);
  if (Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1])) return [num(v[0]), num(v[1])];
  return null;
}
const needPt = (v: Value, fn: string): Vec => {
  const p = toPt(v);
  if (!p) throw new LispError(`bad argument type: point: ${show(v)} (${fn})`);
  return p;
};

const patName = resolvePattern;

export interface CadEnv {
  reg: Registry;
  ctx: () => Ctx;
  /** IO thật của giao diện (để getpoint, entsel… hỏi người dùng); null khi chạy ngoài giao diện. */
  io: () => IO | null;
}

const ACI_BYLAYER = 256;

// ---------- Đối tượng ↔ danh sách mã nhóm DXF ----------

const ATT: Record<string, number> = { TL: 1, TC: 2, TR: 3, ML: 4, MC: 5, MR: 6, BL: 7, BC: 8, BR: 9 };

export function entToList(e: Entity): Value[] {
  const out: Value[] = [dp(-1, new Ename(e.id))];
  const multi = e.type === 'TEXT' && e.text.includes('\n');
  out.push(dp(0, e.type === 'XLINE' ? (e.ray ? 'RAY' : 'XLINE') : multi ? 'MTEXT' : e.type === 'LWPOLYLINE' && e.wipe ? 'WIPEOUT' : e.type));
  out.push(dp(5, (0x100 + e.id).toString(16).toUpperCase()));
  out.push(dp(100, 'AcDbEntity'));
  out.push(dp(8, e.layer));
  if (e.lt) out.push(dp(6, e.lt));
  out.push(dp(62, e.color ?? ACI_BYLAYER));
  switch (e.type) {
    case 'LINE':
      out.push([10, R(e.a[0]), R(e.a[1]), R(0)], [11, R(e.b[0]), R(e.b[1]), R(0)]);
      break;
    case 'CIRCLE':
      out.push([10, R(e.c[0]), R(e.c[1]), R(0)], dp(40, R(e.r)));
      break;
    case 'ARC':
      out.push([10, R(e.c[0]), R(e.c[1]), R(0)], dp(40, R(e.r)), dp(50, R(deg2rad(e.start))), dp(51, R(deg2rad(e.end))));
      break;
    case 'LWPOLYLINE':
      out.push(dp(100, 'AcDbPolyline'), dp(90, e.pts.length), dp(70, e.closed ? 1 : 0), dp(43, R(0)), dp(38, R(0)));
      for (const p of e.pts) out.push([10, R(p[0]), R(p[1])], dp(40, R(0)), dp(41, R(0)), dp(42, R(0)), dp(91, 0));
      break;
    case 'TEXT': {
      if (multi) {
        const att = (e.va === 'M' ? 'M' : e.va === 'B' ? 'B' : 'T') + (e.ha ?? 'L');
        out.push([10, R(e.p[0]), R(e.p[1]), R(0)], dp(40, R(e.h)), dp(71, ATT[att] ?? 1), dp(1, e.text.replace(/\n/g, '\\P')), dp(50, R(deg2rad(e.rot))));
        break;
      }
      out.push([10, R(e.p[0]), R(e.p[1]), R(0)], dp(40, R(e.h)), dp(1, e.text), dp(50, R(deg2rad(e.rot))), dp(41, R(1)), dp(7, 'Standard'));
      out.push(dp(72, e.ha === 'C' ? 1 : e.ha === 'R' ? 2 : 0), [11, R(e.p[0]), R(e.p[1]), R(0)], dp(73, e.va === 'M' ? 2 : e.va === 'T' ? 3 : 0));
      break;
    }
    case 'INSERT':
      out.push(dp(2, e.name), [10, R(e.p[0]), R(e.p[1]), R(0)], dp(41, R(e.sx)), dp(42, R(e.sy)), dp(43, R(1)), dp(50, R(deg2rad(e.rot))));
      break;
    case 'POINT':
      out.push([10, R(e.p[0]), R(e.p[1]), R(0)]);
      break;
    case 'XLINE':
      out.push([10, R(e.p[0]), R(e.p[1]), R(0)], [11, R(e.dir[0]), R(e.dir[1]), R(0)]);
      break;
    case 'HATCH':
      out.push(dp(2, e.pattern), dp(70, e.solid ? 1 : 0), dp(41, R(e.scale)), dp(52, R(deg2rad(e.angle))), dp(91, e.loops.length));
      break;
    case 'DIMENSION':
      out.push(dp(1, e.text ?? ''), dp(42, R(measure(e))), dp(70, { linear: 0, aligned: 1, angular: 2, diameter: 3, radius: 4, ordinate: 6, arclen: 0 }[e.kind]));
      for (const [i, p] of e.pts.entries()) out.push([[13, 14, 10, 15][i] ?? 10, R(p[0]), R(p[1]), R(0)]);
      break;
  }
  return out;
}

/** Tra mã nhóm trong danh sách (giá trị sau dấu chấm, hoặc phần còn lại của danh sách điểm). */
function gv(l: Value[], code: number): Value | undefined {
  for (const it of l) {
    if (it instanceof Pair && it.car === code) return it.cdr;
    if (Array.isArray(it) && it[0] === code) return list(it.slice(1));
  }
  return undefined;
}
const gnum = (l: Value[], code: number, def: number) => {
  const v = gv(l, code);
  return v === undefined || v === null ? def : num(v);
};
const gstr = (l: Value[], code: number) => {
  const v = gv(l, code);
  return typeof v === 'string' ? v : undefined;
};
const gpt = (l: Value[], code: number): Vec | undefined => {
  const v = gv(l, code);
  return v === undefined ? undefined : (toPt(v) ?? undefined);
};
const allPts = (l: Value[], code: number): Vec[] => l.filter((it) => Array.isArray(it) && it[0] === code).map((it) => [num((it as Value[])[1]), num((it as Value[])[2])] as Vec);

/** Danh sách mã nhóm → đối tượng mới (cho entmake / entmod). */
export function listToEnt(l: Value[], ctx: Ctx, base?: Entity): NewEntity | null {
  const type = (gstr(l, 0) ?? base?.type ?? '').toUpperCase();
  const layer = gstr(l, 8) ?? base?.layer ?? ctx.doc.currentLayer;
  const c = gv(l, 62);
  const color = c === undefined ? base?.color : num(c) === 256 || num(c) === 0 ? undefined : Math.abs(num(c));
  const lt = gstr(l, 6) ?? base?.lt;
  const common = { layer, ...(color !== undefined ? { color } : {}), ...(lt && lt.toUpperCase() !== 'BYLAYER' ? { lt: lt.toUpperCase() } : {}) };
  const b = base as Record<string, unknown> | undefined;
  switch (type) {
    case 'LINE':
      return { type: 'LINE', a: gpt(l, 10) ?? (b?.a as Vec), b: gpt(l, 11) ?? (b?.b as Vec), ...common };
    case 'CIRCLE':
      return { type: 'CIRCLE', c: gpt(l, 10) ?? (b?.c as Vec), r: gnum(l, 40, (b?.r as number) ?? 1), ...common };
    case 'ARC':
      return {
        type: 'ARC',
        c: gpt(l, 10) ?? (b?.c as Vec),
        r: gnum(l, 40, (b?.r as number) ?? 1),
        start: gv(l, 50) !== undefined ? normDeg(rad2deg(gnum(l, 50, 0))) : ((b?.start as number) ?? 0),
        end: gv(l, 51) !== undefined ? normDeg(rad2deg(gnum(l, 51, 0))) : ((b?.end as number) ?? 90),
        ...common,
      };
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const pts = allPts(l, 10);
      return { type: 'LWPOLYLINE', pts: pts.length ? pts : ((b?.pts as Vec[]) ?? []), closed: (gnum(l, 70, b?.closed ? 1 : 0) & 1) === 1, ...common };
    }
    case 'POINT':
      return { type: 'POINT', p: gpt(l, 10) ?? (b?.p as Vec), ...common };
    case 'XLINE':
    case 'RAY': {
      const d = gpt(l, 11) ?? (b?.dir as Vec) ?? [1, 0];
      const L = Math.hypot(d[0], d[1]) || 1;
      return { type: 'XLINE', p: gpt(l, 10) ?? (b?.p as Vec), dir: [d[0] / L, d[1] / L], ...(type === 'RAY' ? { ray: true } : {}), ...common };
    }
    case 'TEXT': {
      const h72 = gnum(l, 72, b ? ((b.ha === 'C' ? 1 : b.ha === 'R' ? 2 : 0) as number) : 0);
      const v73 = gnum(l, 73, b ? (b.va === 'M' ? 2 : b.va === 'T' ? 3 : 0) : 0);
      const aligned = h72 !== 0 || v73 !== 0;
      const p = (aligned ? gpt(l, 11) : undefined) ?? gpt(l, 10) ?? (b?.p as Vec);
      const ha = h72 === 1 || h72 === 4 ? 'C' : h72 === 2 ? 'R' : undefined;
      const va = h72 === 4 ? 'M' : v73 === 2 ? 'M' : v73 === 3 ? 'T' : undefined;
      return {
        type: 'TEXT',
        p,
        h: gnum(l, 40, (b?.h as number) ?? ctx.doc.getVar('TEXTSIZE', 250)),
        text: gstr(l, 1) ?? (b?.text as string) ?? '',
        rot: gv(l, 50) !== undefined ? normDeg(rad2deg(gnum(l, 50, 0))) : ((b?.rot as number) ?? 0),
        ...(ha ? { ha } : {}),
        ...(va ? { va } : {}),
        ...common,
      };
    }
    case 'MTEXT': {
      const raw = (l.filter((it) => it instanceof Pair && it.car === 3).map((it) => (it as Pair).cdr as string).join('') + (gstr(l, 1) ?? '')) || ((b?.text as string) ?? '');
      const text = raw.replace(/\\P/g, '\n').replace(/\{\\[^;]*;|\}|\\[A-OQ-Za-oq-z][^;\\]*;?/g, '');
      const att = gnum(l, 71, 1);
      const ha = (['L', 'C', 'R'] as const)[(att - 1) % 3];
      const va = (['T', 'M', 'B'] as const)[Math.floor((att - 1) / 3)];
      const dir = gpt(l, 11);
      const rot = dir ? rad2deg(angleOf(dir)) : rad2deg(gnum(l, 50, 0));
      return { type: 'TEXT', p: gpt(l, 10) ?? (b?.p as Vec), h: gnum(l, 40, (b?.h as number) ?? 250), text, rot: normDeg(rot), ha, va, ...common };
    }
    case 'SOLID': {
      const q = [gpt(l, 10), gpt(l, 11), gpt(l, 13), gpt(l, 12)].filter((x): x is Vec => !!x);
      return { type: 'LWPOLYLINE', pts: q, closed: true, fill: true, ...common };
    }
    case 'INSERT': {
      const name = gstr(l, 2) ?? (b?.name as string);
      if (!name || !ctx.doc.blocks.has(name)) throw new LispError(`Không có block "${name}"`);
      return {
        type: 'INSERT',
        name,
        p: gpt(l, 10) ?? (b?.p as Vec),
        sx: gnum(l, 41, (b?.sx as number) ?? 1),
        sy: gnum(l, 42, (b?.sy as number) ?? gnum(l, 41, 1)),
        rot: gv(l, 50) !== undefined ? normDeg(rad2deg(gnum(l, 50, 0))) : ((b?.rot as number) ?? 0),
        ...common,
      };
    }
  }
  return null;
}

// ---------- IO chạy theo kịch bản cho (command ...) ----------

const PAUSE = '\\';
class Script {
  i = 0;
  constructor(readonly toks: Value[]) {}
  get done() {
    return this.i >= this.toks.length;
  }
  peek(): Value | undefined {
    return this.toks[this.i];
  }
  next(): Value | undefined {
    return this.toks[this.i++];
  }
}

function scriptIO(s: Script, real: IO | null, printOut: (m: string) => void, continueWithUser: boolean): IO {
  const ask = <T>(fallback: ((io: IO) => Promise<T>) | null): Promise<T> => {
    if (real && fallback && (continueWithUser || s.peek() === PAUSE)) {
      if (s.peek() === PAUSE) s.next();
      return fallback(real);
    }
    throw new CancelError();
  };
  const kw = (v: string, kws?: string[]) => {
    const t = v.replace(/^_+/, '').toUpperCase();
    return kws?.find((k) => k.toUpperCase() === t) ?? kws?.find((k) => k.toUpperCase().startsWith(t));
  };
  const io: IO = {
    async getPoint(msg, o = {}) {
      if (s.done || s.peek() === PAUSE) return ask((x) => x.getPoint(msg, o));
      const v = s.next()!;
      if (v === '' || v === null) {
        if (o.allowNone || o.keywords?.length) return null;
        throw new CancelError();
      }
      const p = toPt(v);
      if (p) return p;
      if (v instanceof Ename) return null;
      if (isNum(v) && o.base) return [o.base[0] + num(v), o.base[1]] as Vec;
      if (typeof v === 'string') {
        const k = kw(v, o.keywords);
        if (k) return k;
        const r = parseInput(v, o.base ?? null);
        if (r.kind === 'point') return r.p;
        if (r.kind === 'number' && o.base) return [o.base[0] + r.n, o.base[1]] as Vec;
      }
      throw new LispError(`Điểm không hợp lệ: ${show(v)}`);
    },
    async getDistance(msg, o = {}) {
      if (s.done || s.peek() === PAUSE) return ask((x) => x.getDistance(msg, o));
      const v = s.next()!;
      if (v === '' || v === null) return o.def ?? null;
      if (isNum(v)) return num(v);
      const p = toPt(v);
      if (p) return o.base ? dist(o.base, p) : null;
      if (typeof v === 'string' && Number.isFinite(Number(v))) return Number(v);
      throw new LispError(`Khoảng cách không hợp lệ: ${show(v)}`);
    },
    async getAngle(msg, o) {
      if (s.done || s.peek() === PAUSE) return ask((x) => x.getAngle(msg, o));
      const v = s.next()!;
      if (v === '' || v === null) return o.def ?? null;
      if (isNum(v)) return num(v);
      const p = toPt(v);
      if (p) return rad2deg(angleOf(sub(p, o.base)));
      if (typeof v === 'string' && Number.isFinite(Number(v))) return Number(v);
      throw new LispError(`Góc không hợp lệ: ${show(v)}`);
    },
    async getString(msg, o = {}) {
      if (s.done || s.peek() === PAUSE) return ask((x) => x.getString(msg, o));
      const v = s.next()!;
      if (v === null) return o.def ?? null;
      if (typeof v === 'string') return v === '' && o.def !== undefined ? o.def : v.replace(/^_(?=[A-Za-z])/, '');
      if (isNum(v)) return String(num(v));
      if (v instanceof Sym) return v.name;
      return show(v, true);
    },
    async getText(msg, def) {
      if (s.done || s.peek() === PAUSE) return ask((x) => (x.getText ? x.getText(msg, def) : x.getString(msg, { spaces: true })));
      const v = s.next()!;
      return typeof v === 'string' ? v : v === null ? null : show(v, true);
    },
    async getEntity(msg, o = {}) {
      if (s.done || s.peek() === PAUSE) return ask((x) => x.getEntity(msg, o));
      const v = s.next()!;
      if (v === '' || v === null) return null;
      if (v instanceof Ename) return { id: v.id, p: pickPointOf(v.id) };
      if (Array.isArray(v) && v[0] instanceof Ename) return { id: v[0].id, p: toPt(v[1]) ?? pickPointOf(v[0].id) };
      if (typeof v === 'string') {
        const k = kw(v, o.keywords);
        if (k) return k;
      }
      const p = toPt(v);
      if (p) {
        const e = hitAt(p);
        if (e) return { id: e.id, p };
      }
      throw new LispError(`Cần một đối tượng: ${show(v)}`);
    },
    async getSelection(msg, o = {}) {
      if (s.done || s.peek() === PAUSE) return ask((x) => x.getSelection(msg, o));
      const ids: number[] = [];
      while (!s.done) {
        const v = s.peek()!;
        if (v instanceof PickSet) ids.push(...v.ids);
        else if (v instanceof Ename) ids.push(v.id);
        else if (Array.isArray(v) && v[0] instanceof Ename) ids.push(v[0].id);
        else if (typeof v === 'string' && /^_?(ALL|L|P|LAST|PREVIOUS)$/i.test(v)) ids.push(...namedSel(v));
        else break;
        s.next();
        if (o.single) break;
      }
      if (s.peek() === '' || s.peek() === null) s.next();
      return [...new Set(ids)];
    },
    print: printOut,
  };
  let pickPointOf: (id: number) => Vec = () => [0, 0];
  let hitAt: (p: Vec) => Entity | undefined = () => undefined;
  let namedSel: (v: string) => number[] = () => [];
  (io as IO & { _bind: unknown })._bind = (a: typeof pickPointOf, b: typeof hitAt, c: typeof namedSel) => {
    pickPointOf = a;
    hitAt = b;
    namedSel = c;
  };
  return io;
}

/** Diện tích (đa tuyến tính như khép kín, đường tròn, cung = hình viên phân, vùng tô). */
function areaOf(e: Entity): number {
  if (e.type === 'CIRCLE') return Math.PI * e.r * e.r;
  if (e.type === 'LWPOLYLINE') {
    let s = 0;
    for (let i = 0; i < e.pts.length; i++) {
      const p = e.pts[i];
      const q = e.pts[(i + 1) % e.pts.length];
      s += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(s) / 2;
  }
  if (e.type === 'ARC') {
    const sw = deg2rad(normDeg(e.end - e.start) || 360);
    return (e.r * e.r * (sw - Math.sin(sw))) / 2;
  }
  if (e.type === 'HATCH') return hatchArea(e);
  return 0;
}

// ---------- Cài các hàm CAD vào bộ thông dịch ----------

export function installCad(L: Interp, env: CadEnv): void {
  const d = (n: string, f: (a: Value[]) => Value | Promise<Value>) => L.def(n, f);
  const ctx = () => env.ctx();
  const doc = () => env.ctx().doc;
  const io = () => {
    const x = env.io();
    if (!x) throw new LispError('Hàm này cần người dùng nhập trên giao diện');
    return x;
  };
  const session = new Map<string, Value>();
  let prevSS: number[] = [];
  const deleted = new Map<number, Entity>();
  let initKw: string[] = [];
  let initBits = 0;
  // Định nghĩa block đang dựng bằng entmake BLOCK … ENDBLK.
  let blockDef: { name: string; base: Vec; ents: NewEntity[] } | null = null;

  const entOf = (v: Value, fn: string): Entity => {
    const id = v instanceof Ename ? v.id : v instanceof VlaObj && v.kind === 'ent' ? v.id : Array.isArray(v) && v[0] instanceof Ename ? v[0].id : -1;
    const e = doc().get(id);
    if (!e) throw new LispError(`bad argument type: lentityp ${show(v)} (${fn})`);
    return e;
  };
  const pickPointOf = (id: number): Vec => {
    const e = doc().get(id);
    if (!e) return [0, 0];
    const s = snapPoints(e)[0];
    if (s) return s.p;
    const b = bbox(e);
    return [b.minX, b.minY];
  };
  const hitAt = (p: Vec): Entity | undefined => {
    let best: Entity | undefined;
    let bd = Infinity;
    const ext = doc().extents();
    const tol = ext ? Math.max(ext.maxX - ext.minX, ext.maxY - ext.minY) * 0.002 : 1;
    for (const e of doc().visible()) {
      const dd = distanceTo(e, p);
      if (dd < bd) {
        bd = dd;
        best = e;
      }
    }
    return bd <= tol ? best : undefined;
  };
  const lastId = (): number | null => {
    let m = -1;
    for (const e of doc().visible()) m = Math.max(m, e.id);
    return m < 0 ? null : m;
  };
  const namedSel = (v: string): number[] => {
    const k = v.replace(/^_/, '').toUpperCase();
    if (k === 'ALL') return doc().visible().map((e) => e.id);
    if (k === 'L' || k === 'LAST') {
      const id = lastId();
      return id === null ? [] : [id];
    }
    return [...prevSS];
  };

  // ---- (command ...) ----
  const runCmd = async (toks: Value[]): Promise<void> => {
    if (!toks.length) return; // (command) = huỷ lệnh đang chạy
    let i = 0;
    while (i < toks.length) {
      const head = toks[i];
      if (head === '' || head === null) {
        i++;
        continue;
      }
      if (typeof head !== 'string' && !(head instanceof Sym)) throw new LispError(`Tên lệnh không hợp lệ: ${show(head)}`);
      const raw = (typeof head === 'string' ? head : head.name).trim();
      const name = raw.replace(/^['_.]+/, '').replace(/^_+/, '').toUpperCase();
      // Thu các đối số tới tên lệnh kế tiếp không rõ ràng → cho cả phần còn lại vào lệnh này.
      const args = toks.slice(i + 1);
      const used = await runOne(name, args);
      i += 1 + used;
    }
  };

  /** Chạy một lệnh với các đối số, trả về số đối số đã dùng. */
  const runOne = async (name: string, args: Value[]): Promise<number> => {
    const c = ctx();
    const special = SPECIAL[name.replace(/^-/, '')];
    if (special) return special(args);
    const def = env.reg.resolve(name) ?? env.reg.resolve(name.replace(/^-/, ''));
    if (!def) throw new LispError(`Unknown command "${name}"`);
    const script = new Script(args);
    // Thông báo của lệnh chỉ in ra khi lisp bật CMDECHO = 1.
    const sio = scriptIO(script, env.io(), (m) => (session.get('CMDECHO') === 1 ? L.emit(`\n${m}`) : undefined), args.length === 0);
    (sio as IO & { _bind: (a: unknown, b: unknown, c: unknown) => void })._bind(pickPointOf, hitAt, namedSel);
    // Lệnh gọi từ lisp không dùng lựa chọn sẵn của người dùng.
    const saved = [...c.selection];
    c.selection.clear();
    try {
      await runInteractive(env.reg, c, sio, def.name);
    } catch (e) {
      if (!(e instanceof CancelError)) throw e instanceof LispError ? e : new LispError((e as Error).message);
    } finally {
      if (!c.selection.size) saved.forEach((id) => doc().get(id) && c.selection.add(id));
    }
    // Lệnh kết thúc bằng "" dư → đã được tiêu thụ trong script.
    return script.i;
  };

  const run = (cmd: string, a: Args) => runCommand(env.reg, ctx(), cmd, a);

  const SPECIAL: Record<string, (args: Value[]) => Promise<number> | number> = {
    LAYER: (args) => {
      let i = 0;
      const names = (v: Value) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      const match = (pat: string) => [...doc().layers.keys()].filter((n) => wcmatch(n.toUpperCase(), pat.toUpperCase()));
      while (i < args.length) {
        const op = args[i++];
        if (op === '' || op === null) break;
        const o = String(op).replace(/^_/, '').toUpperCase();
        if (o === 'M' || o === 'MAKE') {
          const n = String(args[i++]);
          run('LAYER', { name: n, current: true });
        } else if (o === 'S' || o === 'SET') run('LAYER', { name: String(args[i++]), current: true });
        else if (o === 'N' || o === 'NEW') for (const n of names(args[i++])) run('LAYER', { name: n, current: false });
        else if (o === 'C' || o === 'COLOR') {
          let col = args[i++];
          if (typeof col === 'string' && /^t/i.test(col)) col = args[i++]; // true color: bỏ qua
          const target = args[i++];
          for (const pat of names(target)) for (const n of match(pat)) run('LAYER', { name: n, color: Math.abs(num(isNum(col) ? col : Number(col))), current: false });
        } else if (o === 'L' || o === 'LTYPE') {
          const lt = String(args[i++]).toUpperCase();
          const target = args[i++];
          for (const pat of names(target)) for (const n of match(pat)) if (doc().linetypes.has(lt)) run('LAYER', { name: n, linetype: lt, current: false });
        } else if (['ON', 'OFF', 'F', 'FREEZE', 'T', 'THAW', 'LO', 'LOCK', 'U', 'UNLOCK'].includes(o)) {
          const target = args[i++];
          for (const pat of names(target))
            for (const n of match(pat)) {
              if ((o === 'OFF' || o === 'F' || o === 'FREEZE') && n === doc().currentLayer) continue;
              const patch = o === 'ON' || o === 'T' || o === 'THAW' ? { visible: true } : o === 'OFF' || o === 'F' || o === 'FREEZE' ? { visible: false } : { locked: o === 'LO' || o === 'LOCK' };
              doc().setLayer(n, patch);
            }
        } else if (o === 'LW' || o === 'P' || o === 'PLOT' || o === 'TR' || o === 'D' || o === 'DESCRIPTION') i += 2;
        else if (o === '?' || o === 'A' || o === 'STATE') i++;
      }
      return i;
    },
    HATCH: async (args) => {
      // -HATCH: _P mẫu [tỉ lệ góc] · _S bộ chọn "" · điểm bên trong · "" kết thúc.
      let i = 0;
      let pattern = String(doc().getVar('HPNAME', 'LINE45'));
      let scale = Number(doc().getVar('HPSCALE', doc().ltscale));
      let angle = Number(doc().getVar('HPANG', 0));
      const sel: number[] = [];
      const picks: Vec[] = [];
      while (i < args.length) {
        const v = args[i++];
        if (v === '' || v === null) {
          if (sel.length || picks.length) break;
          continue;
        }
        const p = toPt(v);
        if (p) {
          picks.push(p);
          continue;
        }
        if (v instanceof PickSet || v instanceof Ename) {
          sel.push(...(v instanceof PickSet ? v.ids : [v.id]));
          continue;
        }
        const o = String(v).replace(/^_/, '').toUpperCase();
        if (o === 'P' || o === 'PROPERTIES') {
          pattern = patName(String(args[i++]));
          if (pattern === 'SOLID') continue;
          if (isNum(args[i] ?? null)) scale = num(args[i++]);
          if (isNum(args[i] ?? null)) angle = num(args[i++]);
        } else if (o === 'S' || o === 'SELECT') {
          while (i < args.length && (args[i] instanceof PickSet || args[i] instanceof Ename)) {
            const x = args[i++];
            sel.push(...(x instanceof PickSet ? x.ids : [(x as Ename).id]));
          }
          if (args[i] === '') i++;
        } else if (o === 'A' || o === 'ADVANCED' || o === 'O' || o === 'ORIGIN' || o === 'AN' || o === 'ANNOTATIVE') i++;
      }
      const base = { pattern: PATTERNS[pattern] ? pattern : 'LINE45', scale, angle };
      if (sel.length) {
        const ok = sel.filter((id) => {
          const e = doc().get(id);
          return e && ((e.type === 'LWPOLYLINE' && e.closed) || e.type === 'CIRCLE');
        });
        if (ok.length) run('HATCH', { ids: ok, ...base });
      }
      for (const p of picks) run('HATCH', { pick: p, ...base });
      return i;
    },
    INSERT: (args) => {
      const [nm, pt, sx, sy, rot] = args;
      const name = String(nm).replace(/^\*/, '');
      const p = toPt(pt ?? null);
      if (!p) throw new LispError('INSERT cần điểm chèn');
      run('INSERT', { name, position: p, scale: sx == null || sx === '' ? 1 : num(sx), rotation: rot == null || rot === '' ? 0 : num(rot) });
      // Tỉ lệ Y khác X: sửa trực tiếp đối tượng vừa chèn.
      if (sy != null && sy !== '' && isNum(sy) && num(sy) !== (sx == null || sx === '' ? 1 : num(sx))) {
        const id = lastId();
        const e = id !== null ? doc().get(id) : undefined;
        if (e?.type === 'INSERT') doc().update({ ...e, sy: num(sy) });
      }
      return Math.min(args.length, 5);
    },
    TEXT: (args) => {
      // TEXT [J kiểu] điểm [cao] góc nội-dung
      let i = 0;
      let ha: string | undefined;
      let va: string | undefined;
      if (typeof args[0] === 'string' && /^_?(J|JUSTIFY)$/i.test(args[0])) {
        const j = String(args[1]).replace(/^_/, '').toUpperCase();
        i = 2;
        const map: Record<string, [string, string]> = { C: ['C', 'B'], R: ['R', 'B'], M: ['C', 'M'], MC: ['C', 'M'], TL: ['L', 'T'], TC: ['C', 'T'], TR: ['R', 'T'], ML: ['L', 'M'], MR: ['R', 'M'], BL: ['L', 'B'], BC: ['C', 'B'], BR: ['R', 'B'], L: ['L', 'B'] };
        [ha, va] = map[j] ?? ['L', 'B'];
      } else if (typeof args[0] === 'string' && /^_?(S|STYLE)$/i.test(args[0])) i = 2;
      const p = toPt(args[i++] ?? null);
      if (!p) throw new LispError('TEXT cần điểm chèn');
      const fixedH = Number(doc().getVar('TEXTSTYLE_HEIGHT', 0));
      const h = fixedH > 0 ? fixedH : isNum(args[i] ?? null) ? num(args[i++]) : (args[i] === '' ? (i++, Number(doc().getVar('TEXTSIZE', 250))) : Number(doc().getVar('TEXTSIZE', 250)));
      const rot = isNum(args[i] ?? null) ? num(args[i++]) : args[i] === '' ? (i++, 0) : 0;
      const text = String(args[i++] ?? '');
      const r = run('TEXT', { position: p, height: h, rotation: rot, text });
      if (ha || va) {
        const id = (r.ids as number[])[0];
        const e = doc().get(id);
        if (e?.type === 'TEXT') doc().update({ ...e, ...(ha && ha !== 'L' ? { ha: ha as 'C' | 'R' } : {}), ...(va && va !== 'B' ? { va: va as 'M' | 'T' } : {}) });
      }
      doc().setVar('TEXTSIZE', h);
      return i;
    },
    MTEXT: (args) => {
      // MTEXT góc1 [tuỳ chọn giá trị]* góc2 dòng... ""
      let i = 0;
      const p1 = toPt(args[i++] ?? null);
      if (!p1) throw new LispError('MTEXT cần điểm');
      let h = Number(doc().getVar('TEXTSIZE', 250));
      let p2: Vec | null = null;
      while (i < args.length && !p2) {
        const v = args[i++];
        const q = toPt(v);
        if (q) p2 = q;
        else if (typeof v === 'string' && /^_?H/i.test(v)) h = num(args[i++]);
        else if (typeof v === 'string' && /^_?[JRSWL]/i.test(v)) i++;
      }
      const lines: string[] = [];
      while (i < args.length && args[i] !== '') lines.push(String(args[i++]));
      if (args[i] === '') i++;
      run('MTEXT', { position: [Math.min(p1[0], p2?.[0] ?? p1[0]), Math.max(p1[1], p2?.[1] ?? p1[1])], text: lines.join('\n'), height: h, width: p2 ? Math.abs(p2[0] - p1[0]) : 0 });
      return i;
    },
    ZOOM: (args) => {
      const o = String(args[0] ?? '').replace(/^_/, '').toUpperCase();
      if (o === 'E' || o === 'EXTENTS' || o === 'A' || o === 'ALL') ctx().view?.zoomExtents();
      else if (o === 'W' || o === 'WINDOW') {
        const a = toPt(args[1] ?? null);
        const b = toPt(args[2] ?? null);
        if (a && b) ctx().view?.zoomWindow(a, b);
        return 3;
      } else if (toPt(args[0] ?? null) && toPt(args[1] ?? null)) {
        ctx().view?.zoomWindow(toPt(args[0])!, toPt(args[1])!);
        return 2;
      }
      return Math.min(1, args.length);
    },
    UNDO: (args) => {
      const o = String(args[0] ?? '').replace(/^_/, '').toUpperCase();
      if (/^\d+$/.test(o) || isNum(args[0] ?? null)) {
        const n = isNum(args[0] ?? null) ? num(args[0]) : Number(o);
        for (let k = 0; k < n; k++) doc().undo();
        return 1;
      }
      // BE / E / M / B / A / C: đánh dấu, bỏ qua.
      return o === 'C' || o === 'CONTROL' || o === 'A' || o === 'AUTO' ? 2 : 1;
    },
    REGEN: () => 0,
    REDRAW: () => 0,
    REGENALL: () => 0,
    SETVAR: (args) => {
      setvar(String(args[0]), args[1] ?? null);
      return 2;
    },
    OSNAP: (args) => (args.length ? 1 : 0),
    ORTHO: (args) => (args.length ? 1 : 0),
    BLOCK: (args) => {
      // -BLOCK tên điểm-gốc bộ-chọn ""
      const name = String(args[0]);
      let i = 1;
      if (typeof args[i] === 'string' && /^_?Y/i.test(String(args[i]))) i++; // ghi đè
      const base = toPt(args[i++] ?? null) ?? [0, 0];
      const ids: number[] = [];
      while (i < args.length && (args[i] instanceof PickSet || args[i] instanceof Ename)) {
        const x = args[i++];
        ids.push(...(x instanceof PickSet ? x.ids : [(x as Ename).id]));
      }
      if (args[i] === '') i++;
      run('BLOCK', { name, base, ids });
      return i;
    },
  };

  const cmd = async (a: Value[]) => {
    await runCmd(a);
    return null;
  };
  d('COMMAND', cmd);
  d('VL-CMDF', async (a) => {
    await runCmd(a);
    return T;
  });
  d('COMMAND-S', cmd);

  // ---- entget / entmake / entmod ----
  d('ENTGET', (a) => {
    const e = doc().get(a[0] instanceof Ename ? a[0].id : -1);
    return e ? entToList(e) : null;
  });
  d('ENTMAKE', (a) => {
    const l = Array.isArray(a[0]) ? a[0] : [];
    const type = (gstr(l, 0) ?? '').toUpperCase();
    if (type === 'LAYER') {
      const name = gstr(l, 2);
      if (!name) return null;
      run('LAYER', { name, color: Math.abs(gnum(l, 62, 7)), current: false, ...(gstr(l, 6) ? { linetype: gstr(l, 6)!.toUpperCase() } : {}) });
      return l;
    }
    if (type === 'BLOCK') {
      blockDef = { name: gstr(l, 2) ?? 'BLOCK', base: gpt(l, 10) ?? [0, 0], ents: [] };
      return l;
    }
    if (type === 'ENDBLK') {
      if (!blockDef) return null;
      doc().setBlock(blockDef);
      const n = blockDef.name;
      blockDef = null;
      return n;
    }
    if (type === 'SEQEND' || type === 'VERTEX') return null;
    const e = listToEnt(l, ctx());
    if (!e) return null;
    if (blockDef) {
      blockDef.ents.push(e);
      return l;
    }
    doc().add(e);
    return l;
  });
  d('ENTMAKEX', (a) => {
    const l = Array.isArray(a[0]) ? a[0] : [];
    const e = listToEnt(l, ctx());
    return e ? new Ename(doc().add(e).id) : null;
  });
  d('ENTMOD', (a) => {
    const l = Array.isArray(a[0]) ? a[0] : [];
    const en = gv(l, -1);
    const base = en instanceof Ename ? doc().get(en.id) : undefined;
    if (!base) return null;
    const ne = listToEnt(l, ctx(), base);
    if (!ne) return null;
    doc().update({ ...ne, id: base.id } as Entity);
    return l;
  });
  d('ENTUPD', (a) => a[0] ?? null);
  d('ENTDEL', (a) => {
    if (!(a[0] instanceof Ename)) return null;
    const id = a[0].id;
    const e = doc().get(id);
    if (e) {
      deleted.set(id, e);
      doc().remove(id);
    } else {
      const old = deleted.get(id);
      if (old) {
        const { id: _i, ...rest } = old;
        const n = doc().add(rest as NewEntity);
        deleted.delete(id);
        return new Ename(n.id);
      }
    }
    return a[0];
  });
  d('ENTLAST', () => {
    const id = lastId();
    return id === null ? null : new Ename(id);
  });
  d('ENTNEXT', (a) => {
    const ids = doc().all().map((e) => e.id);
    if (!a.length || a[0] === null) return ids.length ? new Ename(ids[0]) : null;
    const cur = a[0] instanceof Ename ? a[0].id : -1;
    const nx = ids.find((x) => x > cur);
    return nx === undefined ? null : new Ename(nx);
  });
  d('HANDENT', (a) => {
    const id = parseInt(String(a[0]), 16) - 0x100;
    return doc().get(id) ? new Ename(id) : null;
  });

  // ---- Bảng ----
  const tblEntry = (table: string, name: string): Value => {
    const t = table.toUpperCase();
    if (t === 'LAYER') {
      const l = [...doc().layers.values()].find((x) => x.name.toUpperCase() === name.toUpperCase());
      if (!l) return null;
      return [dp(0, 'LAYER'), dp(2, l.name), dp(70, l.locked ? 4 : 0), dp(62, l.visible ? l.color : -l.color), dp(6, l.lt ?? 'Continuous')];
    }
    if (t === 'BLOCK') {
      const b = [...doc().blocks.values()].find((x) => x.name.toUpperCase() === name.toUpperCase());
      return b ? [dp(0, 'BLOCK'), dp(2, b.name), dp(70, 0), [10, R(b.base[0]), R(b.base[1]), R(0)]] : null;
    }
    if (t === 'LTYPE') {
      const k = name.toUpperCase();
      return doc().linetypes.has(k) ? [dp(0, 'LTYPE'), dp(2, k), dp(70, 0)] : null;
    }
    if (t === 'STYLE' || t === 'DIMSTYLE') return /^standard$/i.test(name) ? [dp(0, t), dp(2, 'Standard'), dp(70, 0), dp(40, R(0))] : null;
    return null;
  };
  const tblNames = (table: string): string[] => {
    const t = table.toUpperCase();
    if (t === 'LAYER') return [...doc().layers.keys()];
    if (t === 'BLOCK') return [...doc().blocks.keys()];
    if (t === 'LTYPE') return [...doc().linetypes.keys()];
    if (t === 'STYLE' || t === 'DIMSTYLE') return ['Standard'];
    return [];
  };
  const tblPos = new Map<string, number>();
  d('TBLSEARCH', (a) => tblEntry(String(a[0]), String(a[1])));
  d('TBLNEXT', (a) => {
    const t = String(a[0]).toUpperCase();
    const pos = truthy(a[1] ?? null) ? 0 : (tblPos.get(t) ?? 0);
    const names = tblNames(t);
    tblPos.set(t, pos + 1);
    return pos < names.length ? tblEntry(t, names[pos]) : null;
  });
  d('TBLOBJNAME', (a) => (tblEntry(String(a[0]), String(a[1])) ? String(a[1]) : null));
  d('SNVALID', (a) => bool(/^[^<>/\\":;?*|=`]{1,255}$/.test(String(a[0]))));
  d('REGAPP', (a) => a[0] ?? null);

  // ---- Bộ chọn ----
  const filterMatch = (e: Entity, fl: Value[]): boolean => {
    const el = entToList(e);
    const test = (it: Value): boolean => {
      if (!(it instanceof Pair) && !Array.isArray(it)) return true;
      const code = it instanceof Pair ? (it.car as number) : (it[0] as number);
      const want = it instanceof Pair ? it.cdr : list(it.slice(1));
      if (code === -4) return true;
      const have = gv(el, code);
      if (have === undefined) return code === 62 && want === 256 && e.color === undefined;
      if (typeof want === 'string' && typeof have === 'string') return wcmatch(have.toUpperCase(), want.toUpperCase());
      if (isNum(want) && isNum(have)) return num(want) === num(have);
      return show(want) === show(have);
    };
    // Hỗ trợ nhóm <OR … OR> và <AND … AND> (một cấp lồng).
    const evalSeq = (items: Value[]): boolean => {
      let i = 0;
      let ok = true;
      while (i < items.length) {
        const it = items[i];
        if (it instanceof Pair && it.car === -4 && typeof it.cdr === 'string') {
          const op = it.cdr.toUpperCase();
          if (op === '<OR' || op === '<AND' || op === '<NOT') {
            const close = op.slice(1) + '>';
            let depth = 1;
            let j = i + 1;
            for (; j < items.length; j++) {
              const x = items[j];
              if (x instanceof Pair && x.car === -4 && typeof x.cdr === 'string') {
                if (x.cdr.toUpperCase().startsWith('<')) depth++;
                else if (x.cdr.toUpperCase() === close || x.cdr.endsWith('>')) depth--;
              }
              if (!depth) break;
            }
            const inner = items.slice(i + 1, j);
            const r = op === '<OR' ? inner.some((x) => evalSeq([x])) : op === '<NOT' ? !evalSeq(inner) : evalSeq(inner);
            ok = ok && r;
            i = j + 1;
            continue;
          }
        }
        ok = ok && test(it);
        i++;
      }
      return ok;
    };
    return evalSeq(fl);
  };
  d('SSGET', async (a) => {
    let ids: number[] = [];
    const mode = typeof a[0] === 'string' ? a[0].replace(/^_/, '').toUpperCase() : null;
    const flt = a.find((x, i) => i > 0 && Array.isArray(x) && x.some((y) => y instanceof Pair)) as Value[] | undefined ?? (Array.isArray(a[0]) && a[0].some((y) => y instanceof Pair) ? (a[0] as Value[]) : undefined);
    const all = () => doc().visible();
    if (mode === 'X') ids = doc().all().map((e) => e.id);
    else if (mode === 'I') ids = [...ctx().selection];
    else if (mode === 'L') ids = lastId() === null ? [] : [lastId()!];
    else if (mode === 'P') ids = [...prevSS];
    else if (mode === 'W' || mode === 'C') {
      const p = needPt(a[1], 'ssget');
      const q = needPt(a[2], 'ssget');
      const box = { minX: Math.min(p[0], q[0]), minY: Math.min(p[1], q[1]), maxX: Math.max(p[0], q[0]), maxY: Math.max(p[1], q[1]) };
      ids = all().filter((e) => (mode === 'W' ? insideBox(e, box) : touchesBox(e, box))).map((e) => e.id);
    } else if (mode === 'WP' || mode === 'CP' || mode === 'F') {
      const poly = (Array.isArray(a[1]) ? a[1] : []).map((v) => needPt(v, 'ssget'));
      const inside = (p: Vec) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
          if (poly[i][1] > p[1] !== poly[j][1] > p[1] && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
        return c;
      };
      ids = all()
        .filter((e) => {
          const b = bbox(e);
          const corners: Vec[] = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
          if (mode === 'WP') return corners.every(inside);
          // CP / F: chạm cạnh đa giác / đường chắn.
          const segs = mode === 'F' ? poly.slice(1).map((p, i) => [poly[i], p] as [Vec, Vec]) : poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as [Vec, Vec]);
          return (mode === 'CP' && corners.some(inside)) || segs.some(([p, q]) => touchesBox({ type: 'LINE', a: p, b: q, layer: '' }, b) && segTouchesEnt(e, p, q));
        })
        .map((e) => e.id);
    } else if (mode === ':S' || mode === '+.:S' || mode === ':E' || mode === '_:S') {
      const r = await io().getSelection('Chọn đối tượng', { single: true });
      ids = r.slice(0, 1);
    } else if (!mode && toPt(a[0] ?? null)) {
      const e = hitAt(toPt(a[0])!);
      ids = e ? [e.id] : [];
    } else if (!mode || mode === '' || mode === 'A') {
      ids = await io().getSelection('Chọn đối tượng');
      ctx().selection.clear();
    }
    if (flt) ids = ids.filter((id) => {
      const e = doc().get(id);
      return !!e && filterMatch(e, flt);
    });
    if (!ids.length) return null;
    prevSS = ids;
    return new PickSet(ids);
  });
  const segTouchesEnt = (e: Entity, p: Vec, q: Vec) => {
    const L = dist(p, q);
    if (L < 1e-12) return false;
    for (let k = 0; k <= 64; k++) {
      const t: Vec = [p[0] + ((q[0] - p[0]) * k) / 64, p[1] + ((q[1] - p[1]) * k) / 64];
      if (distanceTo(e, t) < L / 64) return true;
    }
    return false;
  };
  d('SSLENGTH', (a) => (a[0] instanceof PickSet ? a[0].ids.length : 0));
  d('SSNAME', (a) => {
    if (!(a[0] instanceof PickSet)) return null;
    const id = a[0].ids[num(a[1])];
    return id === undefined ? null : new Ename(id);
  });
  d('SSADD', (a) => {
    if (!a.length) return new PickSet([]);
    const base = a[1] instanceof PickSet ? a[1].ids : [];
    const id = a[0] instanceof Ename ? a[0].id : null;
    if (a[1] instanceof PickSet) {
      if (id !== null && !base.includes(id)) (a[1].ids as number[]).push(id);
      return a[1];
    }
    return new PickSet(id === null ? [] : [id]);
  });
  d('SSDEL', (a) => {
    if (!(a[1] instanceof PickSet) || !(a[0] instanceof Ename)) return null;
    const i = a[1].ids.indexOf(a[0].id);
    if (i < 0) return null;
    a[1].ids.splice(i, 1);
    return a[1];
  });
  d('SSMEMB', (a) => (a[1] instanceof PickSet && a[0] instanceof Ename && a[1].ids.includes(a[0].id) ? a[0] : null));
  d('SSSETFIRST', (a) => {
    const c = ctx();
    c.selection.clear();
    const s = a[1] ?? a[0];
    if (s instanceof PickSet) s.ids.forEach((id) => c.selection.add(id));
    return list([null, s ?? null]);
  });
  d('SSGETFIRST', () => list([null, ctx().selection.size ? new PickSet([...ctx().selection]) : null]));
  d('SSNAMEX', (a) => (a[0] instanceof PickSet ? list(a[0].ids.map((id, i) => [0, new Ename(id), i])) : null));

  // ---- Biến hệ thống ----
  const DIMVAR: Record<string, keyof ReturnType<typeof doc>['dimStyle']> = { DIMTXT: 'txt', DIMASZ: 'asz', DIMEXO: 'exo', DIMEXE: 'exe', DIMGAP: 'gap' };
  const getvar = (n: string): Value => {
    const k = n.toUpperCase();
    const D = doc();
    switch (k) {
      case 'CLAYER':
        return D.currentLayer;
      case 'LTSCALE':
        return R(D.ltscale);
      case 'CECOLOR':
        return String(D.getVar('CECOLOR', 'BYLAYER'));
      case 'CELTYPE':
        return String(D.getVar('CELTYPE', 'ByLayer'));
      case 'INSUNITS':
        return { mm: 4, cm: 5, m: 6, in: 1, ft: 2 }[D.units] ?? 4;
      case 'DIMSCALE':
        return R(D.getVar('DIMSCALE', 100));
      case 'DIMDEC':
        return D.dimStyle.dec;
      case 'TEXTSIZE':
        return R(Number(D.getVar('TEXTSIZE', 250)));
      case 'HPSCALE':
        return R(Number(D.getVar('HPSCALE', D.ltscale)));
      case 'HPANG':
        return R(deg2rad(Number(D.getVar('HPANG', 0))));
      case 'HPNAME':
        return String(D.getVar('HPNAME', 'LINE45'));
      case 'EXTMIN':
      case 'EXTMAX': {
        const e = D.extents() ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        return P3(k === 'EXTMIN' ? [e.minX, e.minY] : [e.maxX, e.maxY]);
      }
      case 'DWGNAME':
        return String(D.getVar('DWGNAME', 'ban-ve.dxf'));
      case 'DWGPREFIX':
        return '';
      case 'CDATE': {
        const t = new Date();
        const p = (x: number) => String(x).padStart(2, '0');
        return R(Number(`${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}.${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`));
      }
      case 'DATE':
        return R(Date.now() / 86400000 + 2440587.5);
      case 'MILLISECS':
        return Math.round(performance.now());
      case 'PROGRAM':
        return 'mhcad';
      case 'ACADVER':
        return '25.0s (MHCAD)';
      case 'CMDACTIVE':
        return 0;
      case 'VIEWCTR':
        return P3([0, 0]);
    }
    if (DIMVAR[k]) return R(D.dimStyle[DIMVAR[k]] / Number(D.getVar('DIMSCALE', 100)));
    if (session.has(k)) return session.get(k)!;
    const v = D.getVar<unknown>(k, undefined);
    if (v === undefined) return null;
    if (typeof v === 'number') return Number.isInteger(v) && !/SCALE|SIZE|ANG/.test(k) ? v : R(v);
    if (typeof v === 'string') return v;
    return null;
  };
  const setvar = (n: string, v: Value): Value => {
    const k = n.toUpperCase();
    const D = doc();
    const val = isNum(v) ? num(v) : typeof v === 'string' ? v : null;
    switch (k) {
      case 'CLAYER':
        if (!D.layers.has(String(val))) throw new LispError(`Không có layer "${val}"`);
        D.setCurrentLayer(String(val));
        return v;
      case 'LTSCALE':
        D.setLtscale(Number(val));
        return v;
      case 'CECOLOR':
        run('COLOR', { color: String(val) });
        return v;
      case 'CELTYPE':
        run('CELTYPE', { linetype: String(val) });
        return v;
      case 'DIMSCALE':
        run('SETVAR', { name: 'DIMSCALE', value: String(val) });
        return v;
      case 'DIMDEC':
        D.setDimStyle({ dec: Number(val) });
        return v;
      case 'HPANG':
        D.setVar('HPANG', rad2deg(Number(val)));
        return v;
      case 'HPNAME':
        D.setVar('HPNAME', patName(String(val)));
        return v;
      case 'TEXTSIZE':
      case 'HPSCALE':
      case 'PDMODE':
      case 'PDSIZE':
      case 'WIPEOUTFRAME':
        D.setVar(k, Number(val));
        return v;
    }
    if (DIMVAR[k]) {
      D.setDimStyle({ [DIMVAR[k]]: Number(val) * Number(D.getVar('DIMSCALE', 100)) });
      return v;
    }
    // Biến giao diện / phiên (CMDECHO, OSMODE, FILEDIA…): giữ trong phiên lisp.
    session.set(k, v);
    return v;
  };
  d('GETVAR', (a) => getvar(String(a[0])));
  d('SETVAR', (a) => setvar(String(a[0]), a[1] ?? null));
  const env0 = new Map<string, string>();
  d('GETENV', (a) => env0.get(String(a[0]).toUpperCase()) ?? null);
  d('SETENV', (a) => {
    env0.set(String(a[0]).toUpperCase(), String(a[1]));
    return a[1] ?? null;
  });
  d('GETCFG', () => null);
  d('SETCFG', (a) => a[1] ?? null);

  // ---- Nhập từ người dùng ----
  const msgOf = (v: Value | undefined, def: string) => (typeof v === 'string' ? v.replace(/^\n+/, '').replace(/:\s*$/, '') || def : def);
  d('INITGET', (a) => {
    initBits = 0;
    initKw = [];
    for (const v of a) {
      if (typeof v === 'number') initBits = v;
      else if (typeof v === 'string') initKw = v.split(/\s+/).filter(Boolean).map((k) => k.replace(/^_/, ''));
    }
    return null;
  });
  const takeKw = () => {
    const k = initKw;
    const bits = initBits;
    initKw = [];
    initBits = 0;
    return { k, bits };
  };
  d('GETPOINT', async (a) => {
    const base = toPt(a[0] ?? null);
    const msg = msgOf(base ? a[1] : a[0], 'Chọn điểm');
    const { k } = takeKw();
    const r = await io().getPoint(msg, { ...(base ? { base } : {}), allowNone: true, ...(k.length ? { keywords: k } : {}) });
    if (r === null) return null;
    return typeof r === 'string' ? r : P3(r);
  });
  d('GETCORNER', async (a) => {
    const base = needPt(a[0], 'getcorner');
    const r = await io().getPoint(msgOf(a[1], 'Góc đối diện'), { base, allowNone: true, preview: (c) => [{ type: 'LWPOLYLINE', pts: [base, [c[0], base[1]], c, [base[0], c[1]]], closed: true, layer: doc().currentLayer }] });
    return Array.isArray(r) ? P3(r as Vec) : null;
  });
  const getNum = async (a: Value[], kind: 'dist' | 'real' | 'int') => {
    const base = toPt(a[0] ?? null);
    const msg = msgOf(base ? a[1] : a[0], kind === 'int' ? 'Nhập số nguyên' : 'Nhập số');
    const { k } = takeKw();
    if (k.length) {
      const s = await io().getString(`${msg} [${k.join('/')}]`);
      if (s === null || s === '') return null;
      const kwm = k.find((x) => x.toUpperCase().startsWith(s.toUpperCase()));
      if (kwm) return kwm;
      const n = Number(s);
      return Number.isFinite(n) ? (kind === 'int' ? Math.trunc(n) : R(n)) : null;
    }
    const r = await io().getDistance(msg, base ? { base } : {});
    if (r === null) return null;
    return kind === 'int' ? Math.trunc(r) : R(r);
  };
  d('GETDIST', (a) => getNum(a, 'dist'));
  d('GETREAL', (a) => getNum(a, 'real'));
  d('GETINT', (a) => getNum(a, 'int'));
  const getAng = async (a: Value[]) => {
    const base = toPt(a[0] ?? null);
    const msg = msgOf(base ? a[1] : a[0], 'Góc');
    if (base) {
      const r = await io().getAngle(msg, { base });
      return r === null ? null : R(deg2rad(r));
    }
    const r = await io().getDistance(`${msg} (độ)`);
    return r === null ? null : R(deg2rad(r));
  };
  d('GETANGLE', getAng);
  d('GETORIENT', getAng);
  d('GETSTRING', async (a) => {
    const spaces = typeof a[0] !== 'string' && truthy(a[0] ?? null);
    const msg = msgOf(typeof a[0] === 'string' ? a[0] : a[1], 'Nhập chuỗi');
    const r = await io().getString(msg, { spaces });
    return r ?? '';
  });
  d('GETKWORD', async (a) => {
    const { k } = takeKw();
    const r = await io().getString(`${msgOf(a[0], 'Chọn')}${k.length ? ` [${k.join('/')}]` : ''}`);
    if (r === null || r === '') return null;
    return k.find((x) => x.toUpperCase().startsWith(r.toUpperCase())) ?? null;
  });
  const entsel = async (a: Value[]) => {
    const { k } = takeKw();
    const r = await io().getEntity(msgOf(a[0], 'Chọn đối tượng'), k.length ? { keywords: k } : {});
    if (r === null) return null;
    if (typeof r === 'string') return r;
    return [new Ename(r.id), P3(r.p)];
  };
  d('ENTSEL', entsel);
  d('NENTSEL', entsel);
  d('NENTSELP', entsel);
  d('GETFILED', () => null);

  // ---- Hình học ----
  d('POLAR', (a) => P3(polar(needPt(a[0], 'polar'), num(a[1]), num(a[2]))));
  d('DISTANCE', (a) => R(dist(needPt(a[0], 'distance'), needPt(a[1], 'distance'))));
  d('ANGLE', (a) => {
    const v = angleOf(sub(needPt(a[1], 'angle'), needPt(a[0], 'angle')));
    return R(v < 0 ? v + 2 * Math.PI : v);
  });
  d('INTERS', (a) => {
    const [p1, p2, p3, p4] = a.slice(0, 4).map((v) => needPt(v, 'inters'));
    const onSeg = a[4] === undefined || truthy(a[4]);
    if (onSeg) {
      const x = segSegIntersection(p1, p2, p3, p4);
      return x ? P3(x) : null;
    }
    const d1 = sub(p2, p1);
    const d2 = sub(p4, p3);
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-15) return null;
    const t = ((p3[0] - p1[0]) * d2[1] - (p3[1] - p1[1]) * d2[0]) / den;
    return P3(add(p1, [d1[0] * t, d1[1] * t]));
  });
  d('TRANS', (a) => {
    const p = toPt(a[0] ?? null);
    return p ? (Array.isArray(a[0]) && a[0].length === 2 ? P2(p) : P3(p)) : (a[0] ?? null);
  });
  d('OSNAP', (a) => {
    const p = needPt(a[0], 'osnap');
    const modes = String(a[1] ?? '').toUpperCase();
    const ext = doc().extents();
    const tol = ext ? Math.max(ext.maxX - ext.minX, ext.maxY - ext.minY) * 0.01 : 10;
    let best: Vec | null = null;
    let bd = tol;
    for (const e of doc().visible()) {
      if (distanceTo(e, p) > tol) continue;
      for (const s of snapPoints(e)) {
        const ok =
          (modes.includes('END') && s.kind === 'end') ||
          (modes.includes('MID') && s.kind === 'mid') ||
          (modes.includes('CEN') && s.kind === 'center') ||
          (modes.includes('QUA') && s.kind === 'quad') ||
          (modes.includes('INS') && s.kind === 'insert') ||
          (modes.includes('NOD') && s.kind === 'node');
        if (ok && dist(s.p, p) < bd) {
          bd = dist(s.p, p);
          best = s.p;
        }
      }
      if (modes.includes('NEA')) {
        const q = nearestOn(e, p);
        if (q && dist(q, p) < bd) {
          bd = dist(q, p);
          best = q;
        }
      }
    }
    return best ? P3(best) : null;
  });
  d('TEXTBOX', (a) => {
    const l = Array.isArray(a[0]) ? a[0] : [];
    const t = listToEnt([dp(0, 'TEXT'), dp(10, null), ...l.filter((x) => !(x instanceof Pair && x.car === 10))], ctx());
    if (!t || t.type !== 'TEXT') return null;
    const c = textCorners({ ...t, p: [0, 0], rot: 0 });
    return [P3(c[0]), P3(c[2])];
  });
  for (const n of ['GRDRAW', 'GRVECS', 'REDRAW', 'GRTEXT', 'GRCLEAR']) d(n, () => null);
  d('GRREAD', () => {
    throw new LispError('grread chưa hỗ trợ');
  });

  // ---- vlax-curve-* ----
  const curveOf = (v: Value): CurveEnt => {
    const e = entOf(v, 'vlax-curve');
    if (!isCurve(e)) throw new LispError(`Đối tượng #${e.id} không phải đường cong`);
    return e;
  };
  /** Tham số AutoCAD: LINE theo chiều dài, ARC / CIRCLE theo góc (radian), LWPOLYLINE theo chỉ số đỉnh. */
  const paramToDist = (e: CurveEnt, t: number): number => {
    if (e.type === 'LINE') return t;
    if (e.type === 'CIRCLE') return t * e.r;
    if (e.type === 'ARC') return (t - deg2rad(e.start)) * e.r;
    const v = e.closed ? [...e.pts, e.pts[0]] : e.pts;
    let s = 0;
    const i = Math.min(Math.floor(t), v.length - 2);
    for (let k = 0; k < i; k++) s += dist(v[k], v[k + 1]);
    return s + (t - i) * dist(v[i], v[i + 1]);
  };
  const distToParam = (e: CurveEnt, s: number): number => {
    if (e.type === 'LINE') return s;
    if (e.type === 'CIRCLE') return s / e.r;
    if (e.type === 'ARC') return deg2rad(e.start) + s / e.r;
    const v = e.closed ? [...e.pts, e.pts[0]] : e.pts;
    let acc = 0;
    for (let k = 0; k + 1 < v.length; k++) {
      const L = dist(v[k], v[k + 1]);
      if (s <= acc + L + 1e-12) return k + (L ? (s - acc) / L : 0);
      acc += L;
    }
    return v.length - 1;
  };
  const endParam = (e: CurveEnt): number =>
    e.type === 'LINE' ? curveLength(e) : e.type === 'CIRCLE' ? 2 * Math.PI : e.type === 'ARC' ? deg2rad(e.start) + curveLength(e) / e.r : e.closed ? e.pts.length : e.pts.length - 1;
  const startParam = (e: CurveEnt): number => (e.type === 'ARC' ? deg2rad(e.start) : 0);
  const distOfPoint = (e: CurveEnt, p: Vec): number => {
    // Tìm tham số chiều dài gần điểm nhất bằng dò theo đoạn.
    const L = curveLength(e);
    const n = Math.max(200, e.type === 'LWPOLYLINE' ? e.pts.length * 20 : 200);
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k <= n; k++) {
      const s = (L * k) / n;
      const dd = dist(pointAt(e, s), p);
      if (dd < bd) {
        bd = dd;
        best = s;
      }
    }
    // Tinh chỉnh.
    let lo = Math.max(0, best - L / n);
    let hi = Math.min(L, best + L / n);
    for (let it = 0; it < 40; it++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (dist(pointAt(e, m1), p) < dist(pointAt(e, m2), p)) hi = m2;
      else lo = m1;
    }
    return (lo + hi) / 2;
  };
  d('VLAX-CURVE-GETSTARTPARAM', (a) => R(startParam(curveOf(a[0]))));
  d('VLAX-CURVE-GETENDPARAM', (a) => R(endParam(curveOf(a[0]))));
  d('VLAX-CURVE-GETSTARTPOINT', (a) => P3(pointAt(curveOf(a[0]), 0)));
  d('VLAX-CURVE-GETENDPOINT', (a) => {
    const e = curveOf(a[0]);
    return P3(pointAt(e, curveLength(e)));
  });
  d('VLAX-CURVE-GETDISTATPARAM', (a) => R(paramToDist(curveOf(a[0]), num(a[1]))));
  d('VLAX-CURVE-GETPARAMATDIST', (a) => R(distToParam(curveOf(a[0]), num(a[1]))));
  d('VLAX-CURVE-GETPOINTATPARAM', (a) => {
    const e = curveOf(a[0]);
    return P3(pointAt(e, paramToDist(e, num(a[1]))));
  });
  d('VLAX-CURVE-GETPOINTATDIST', (a) => {
    const e = curveOf(a[0]);
    const s = num(a[1]);
    if (s < -1e-9 || s > curveLength(e) + 1e-9) return null;
    return P3(pointAt(e, s));
  });
  d('VLAX-CURVE-GETDISTATPOINT', (a) => R(distOfPoint(curveOf(a[0]), needPt(a[1], 'vlax-curve-getdistatpoint'))));
  d('VLAX-CURVE-GETPARAMATPOINT', (a) => {
    const e = curveOf(a[0]);
    return R(distToParam(e, distOfPoint(e, needPt(a[1], 'vlax-curve-getparamatpoint'))));
  });
  d('VLAX-CURVE-GETCLOSESTPOINTTO', (a) => {
    const e = curveOf(a[0]);
    return P3(pointAt(e, distOfPoint(e, needPt(a[1], 'vlax-curve-getclosestpointto'))));
  });
  d('VLAX-CURVE-GETAREA', (a) => R(areaOf(entOf(a[0], 'vlax-curve-getarea'))));
  d('VLAX-CURVE-ISCLOSED', (a) => {
    const e = curveOf(a[0]);
    return bool(e.type === 'CIRCLE' || (e.type === 'LWPOLYLINE' && e.closed));
  });
  d('VLAX-CURVE-GETFIRSTDERIV', (a) => {
    const e = curveOf(a[0]);
    const s = paramToDist(e, num(a[1]));
    const h = curveLength(e) * 1e-6;
    const p = pointAt(e, Math.max(0, s - h));
    const q = pointAt(e, Math.min(curveLength(e), s + h));
    const dd = sub(q, p);
    const L = Math.hypot(dd[0], dd[1]) || 1;
    // Độ lớn theo tham số: với đa tuyến = chiều dài đoạn, cung = bán kính.
    const k = e.type === 'ARC' || e.type === 'CIRCLE' ? e.r : e.type === 'LINE' ? 1 : (() => {
      const v = e.closed ? [...e.pts, e.pts[0]] : e.pts;
      const i = Math.min(Math.floor(num(a[1])), v.length - 2);
      return dist(v[i], v[i + 1]);
    })();
    return P3([(dd[0] / L) * k, (dd[1] / L) * k]);
  });

  // ---- VLA / VLAX (một phần) ----
  d('VLAX-GET-ACAD-OBJECT', () => new VlaObj('app'));
  d('VLAX-ENAME->VLA-OBJECT', (a) => new VlaObj('ent', entOf(a[0], 'vlax-ename->vla-object').id));
  d('VLAX-VLA-OBJECT->ENAME', (a) => (a[0] instanceof VlaObj ? new Ename(a[0].id) : null));
  d('VLA-GET-ACTIVEDOCUMENT', () => new VlaObj('doc'));
  d('VLA-GET-MODELSPACE', () => new VlaObj('space'));
  d('VLA-GET-PAPERSPACE', () => new VlaObj('space'));
  for (const n of ['VLA-STARTUNDOMARK', 'VLA-ENDUNDOMARK', 'VLA-REGEN', 'VLA-UPDATE', 'VLAX-RELEASE-OBJECT', 'VLA-ZOOMEXTENTS'])
    d(n, () => {
      if (n === 'VLA-ZOOMEXTENTS') ctx().view?.zoomExtents();
      return null;
    });
  d('VLAX-3D-POINT', (a) => new Variant(P3(Array.isArray(a[0]) ? needPt(a[0], 'vlax-3d-point') : [num(a[0]), num(a[1] ?? 0)])));
  d('VLAX-MAKE-SAFEARRAY', () => new Variant(null));
  d('VLAX-SAFEARRAY-FILL', (a) => new Variant(a[1] ?? null));
  d('VLAX-SAFEARRAY->LIST', (a) => (a[0] instanceof Variant ? a[0].value : (a[0] ?? null)));
  d('VLAX-MAKE-VARIANT', (a) => new Variant(a[0] ?? null));
  d('VLAX-VARIANT-VALUE', (a) => (a[0] instanceof Variant ? a[0].value : (a[0] ?? null)));
  d('VARIANT-VALUE', (a) => (a[0] instanceof Variant ? a[0].value : (a[0] ?? null)));
  d('VLAX-VARIANT-TYPE', () => 8197);
  d('VLAX-VARIANT-CHANGE-TYPE', (a) => a[0] ?? null);
  d('VLAX-ERASED-P', (a) => bool(!(a[0] instanceof VlaObj) || !doc().get(a[0].id)));

  const OBJNAME: Record<string, string> = { LINE: 'AcDbLine', CIRCLE: 'AcDbCircle', ARC: 'AcDbArc', LWPOLYLINE: 'AcDbPolyline', TEXT: 'AcDbText', INSERT: 'AcDbBlockReference', HATCH: 'AcDbHatch', POINT: 'AcDbPoint', DIMENSION: 'AcDbRotatedDimension', XLINE: 'AcDbXline' };
  const getProp = (o: Value, prop: string, asList: boolean): Value => {
    const e = entOf(o, `vla-get-${prop}`);
    const pt = (p: Vec) => (asList ? P3(p) : new Variant(P3(p)));
    const p = prop.toUpperCase();
    switch (p) {
      case 'LAYER':
        return e.layer;
      case 'COLOR':
        return e.color ?? ACI_BYLAYER;
      case 'LINETYPE':
        return e.lt ?? 'ByLayer';
      case 'OBJECTNAME':
        return e.type === 'TEXT' && e.text.includes('\n') ? 'AcDbMText' : OBJNAME[e.type] ?? e.type;
      case 'HANDLE':
        return (0x100 + e.id).toString(16).toUpperCase();
      case 'OBJECTID':
        return e.id;
      case 'LENGTH':
        if (isCurve(e)) return R(curveLength(e));
        break;
      case 'AREA':
        return R(areaOf(e));
      case 'RADIUS':
        if (e.type === 'CIRCLE' || e.type === 'ARC') return R(e.r);
        break;
      case 'DIAMETER':
        if (e.type === 'CIRCLE') return R(e.r * 2);
        break;
      case 'CENTER':
        if (e.type === 'CIRCLE' || e.type === 'ARC') return pt(e.c);
        break;
      case 'STARTPOINT':
        if (isCurve(e)) return pt(pointAt(e, 0));
        break;
      case 'ENDPOINT':
        if (isCurve(e)) return pt(pointAt(e, curveLength(e)));
        break;
      case 'STARTANGLE':
        if (e.type === 'ARC') return R(deg2rad(e.start));
        break;
      case 'ENDANGLE':
        if (e.type === 'ARC') return R(deg2rad(e.end));
        break;
      case 'CLOSED':
        if (e.type === 'LWPOLYLINE') return e.closed ? S(':VLAX-TRUE') : S(':VLAX-FALSE');
        break;
      case 'COORDINATES':
        if (e.type === 'LWPOLYLINE') {
          const flat = e.pts.flatMap((q) => [R(q[0]), R(q[1])]);
          return asList ? flat : new Variant(flat);
        }
        break;
      case 'TEXTSTRING':
        if (e.type === 'TEXT') return e.text.replace(/\n/g, '\\P');
        if (e.type === 'DIMENSION') return e.text ?? '';
        break;
      case 'HEIGHT':
        if (e.type === 'TEXT') return R(e.h);
        break;
      case 'ROTATION':
        if (e.type === 'TEXT' || e.type === 'INSERT') return R(deg2rad(e.rot));
        break;
      case 'INSERTIONPOINT':
      case 'TEXTALIGNMENTPOINT':
        if (e.type === 'TEXT' || e.type === 'INSERT' || e.type === 'POINT') return pt(e.p);
        break;
      case 'NAME':
      case 'EFFECTIVENAME':
        if (e.type === 'INSERT') return e.name;
        break;
      case 'XSCALEFACTOR':
        if (e.type === 'INSERT') return R(e.sx);
        break;
      case 'YSCALEFACTOR':
        if (e.type === 'INSERT') return R(e.sy);
        break;
      case 'MEASUREMENT':
        if (e.type === 'DIMENSION') return R(measure(e));
        break;
      case 'PATTERNNAME':
        if (e.type === 'HATCH') return e.pattern;
        break;
      case 'PATTERNSCALE':
        if (e.type === 'HATCH') return R(e.scale);
        break;
      case 'VISIBLE':
        return S(':VLAX-TRUE');
    }
    throw new LispError(`; error: ActiveX Server returned the error: unknown name: ${prop}`);
  };
  const putProp = (o: Value, prop: string, v: Value): Value => {
    const e = entOf(o, `vla-put-${prop}`);
    const p = prop.toUpperCase();
    const val = v instanceof Variant ? v.value : v;
    const pt = toPt(val);
    let n: Entity | null = null;
    switch (p) {
      case 'LAYER':
        if (!doc().layers.has(String(val))) doc().ensureLayer(String(val));
        n = { ...e, layer: String(val) };
        break;
      case 'COLOR': {
        const c = num(val);
        const { color: _c, ...rest } = e;
        n = c === 256 || c === 0 ? (rest as Entity) : { ...e, color: c };
        break;
      }
      case 'LINETYPE': {
        const { lt: _l, ...rest } = e;
        n = /^bylayer$/i.test(String(val)) ? (rest as Entity) : { ...e, lt: String(val).toUpperCase() };
        break;
      }
      case 'TEXTSTRING':
        if (e.type === 'TEXT') n = { ...e, text: String(val).replace(/\\P/g, '\n') };
        else if (e.type === 'DIMENSION') n = { ...e, text: String(val) || undefined };
        break;
      case 'HEIGHT':
        if (e.type === 'TEXT') n = { ...e, h: num(val) };
        break;
      case 'ROTATION':
        if (e.type === 'TEXT' || e.type === 'INSERT') n = { ...e, rot: normDeg(rad2deg(num(val))) };
        break;
      case 'INSERTIONPOINT':
      case 'TEXTALIGNMENTPOINT':
        if (pt && (e.type === 'TEXT' || e.type === 'INSERT' || e.type === 'POINT')) n = { ...e, p: pt };
        break;
      case 'RADIUS':
        if (e.type === 'CIRCLE' || e.type === 'ARC') n = { ...e, r: num(val) };
        break;
      case 'CENTER':
        if (pt && (e.type === 'CIRCLE' || e.type === 'ARC')) n = { ...e, c: pt };
        break;
      case 'STARTPOINT':
        if (pt && e.type === 'LINE') n = { ...e, a: pt };
        break;
      case 'ENDPOINT':
        if (pt && e.type === 'LINE') n = { ...e, b: pt };
        break;
      case 'CLOSED':
        if (e.type === 'LWPOLYLINE') n = { ...e, closed: val instanceof Sym ? val.name === ':VLAX-TRUE' : truthy(val) };
        break;
      case 'XSCALEFACTOR':
        if (e.type === 'INSERT') n = { ...e, sx: num(val) };
        break;
      case 'YSCALEFACTOR':
        if (e.type === 'INSERT') n = { ...e, sy: num(val) };
        break;
      case 'VISIBLE':
        return v;
    }
    if (!n) throw new LispError(`; error: ActiveX Server returned the error: unknown name: ${prop}`);
    doc().update(n);
    return v;
  };
  // vla-get-xxx / vla-put-xxx được giải theo tên khi gọi (xem hook bên dưới).
  L.resolveMissing = (name: string) => {
    const m = /^VLA-(GET|PUT)-(.+)$/.exec(name);
    if (m) {
      const f = m[1] === 'GET' ? (a: Value[]) => getProp(a[0], m[2], false) : (a: Value[]) => putProp(a[0], m[2], a[1] ?? null);
      return f;
    }
    return null;
  };
  d('VLAX-GET-PROPERTY', (a) => getProp(a[0], a[1] instanceof Sym ? a[1].name : String(a[1]), false));
  d('VLAX-GET', (a) => getProp(a[0], a[1] instanceof Sym ? a[1].name : String(a[1]), true));
  d('VLAX-PUT-PROPERTY', (a) => putProp(a[0], a[1] instanceof Sym ? a[1].name : String(a[1]), a[2] ?? null));
  d('VLAX-PUT', (a) => putProp(a[0], a[1] instanceof Sym ? a[1].name : String(a[1]), a[2] ?? null));
  d('VLAX-PROPERTY-AVAILABLE-P', (a) => {
    try {
      getProp(a[0], a[1] instanceof Sym ? a[1].name : String(a[1]), true);
      return T;
    } catch {
      return null;
    }
  });
  d('VLA-DELETE', (a) => {
    doc().remove(entOf(a[0], 'vla-delete').id);
    return null;
  });
  d('VLA-MOVE', (a) => {
    const e = entOf(a[0], 'vla-move');
    run('MOVE', { ids: [e.id], from: needPt(a[1], 'vla-move'), to: needPt(a[2], 'vla-move') });
    return null;
  });
  d('VLA-COPY', (a) => {
    const e = entOf(a[0], 'vla-copy');
    const { id: _i, ...rest } = e;
    return new VlaObj('ent', doc().add(rest as NewEntity).id);
  });
  d('VLA-ROTATE', (a) => {
    const e = entOf(a[0], 'vla-rotate');
    run('ROTATE', { ids: [e.id], base: needPt(a[1], 'vla-rotate'), angle: rad2deg(num(a[2])) });
    return null;
  });
  d('VLA-SCALEENTITY', (a) => {
    const e = entOf(a[0], 'vla-scaleentity');
    run('SCALE', { ids: [e.id], base: needPt(a[1], 'vla-scaleentity'), factor: num(a[2]) });
    return null;
  });
  const addTo = (ne: NewEntity) => new VlaObj('ent', doc().add(ne).id);
  d('VLA-ADDLINE', (a) => addTo({ type: 'LINE', a: needPt(a[1], 'vla-addline'), b: needPt(a[2], 'vla-addline'), layer: doc().currentLayer }));
  d('VLA-ADDCIRCLE', (a) => addTo({ type: 'CIRCLE', c: needPt(a[1], 'vla-addcircle'), r: num(a[2]), layer: doc().currentLayer }));
  d('VLA-ADDARC', (a) => addTo({ type: 'ARC', c: needPt(a[1], 'vla-addarc'), r: num(a[2]), start: normDeg(rad2deg(num(a[3]))), end: normDeg(rad2deg(num(a[4]))), layer: doc().currentLayer }));
  d('VLA-ADDTEXT', (a) => addTo({ type: 'TEXT', text: String(a[1]), p: needPt(a[2], 'vla-addtext'), h: num(a[3]), rot: 0, layer: doc().currentLayer }));
  d('VLA-ADDPOINT', (a) => addTo({ type: 'POINT', p: needPt(a[1], 'vla-addpoint'), layer: doc().currentLayer }));
  d('VLA-ADDLIGHTWEIGHTPOLYLINE', (a) => {
    const raw = a[1] instanceof Variant ? a[1].value : a[1];
    const flat = (Array.isArray(raw) ? raw : []).map(num);
    const pts: Vec[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
    return addTo({ type: 'LWPOLYLINE', pts, closed: false, layer: doc().currentLayer });
  });

  // ---- ACET (Express Tools) ----
  d('ACET-SS-TO-LIST', (a) => (a[0] instanceof PickSet ? list(a[0].ids.map((id) => new Ename(id))) : null));
  d('ACET-LIST-TO-SS', (a) => {
    const ids = (Array.isArray(a[0]) ? a[0] : []).filter((x): x is Ename => x instanceof Ename).map((x) => x.id);
    return ids.length ? new PickSet(ids) : null;
  });
  d('ACET-GEOM-VERTEX-LIST', (a) => {
    const e = entOf(a[0], 'acet-geom-vertex-list');
    if (e.type === 'LWPOLYLINE') return list(e.pts.map(P3));
    if (e.type === 'LINE') return [P3(e.a), P3(e.b)];
    return null;
  });
  d('ACET-STR-REPLACE', (a) => String(a[2]).split(String(a[0])).join(String(a[1])));
  d('ACET-STR-TO-LIST', (a) => list(String(a[1]).split(String(a[0]))));
  for (const n of ['ACET-ERROR-INIT', 'ACET-ERROR-RESTORE', 'ACET-UNDO-BEGIN', 'ACET-UNDO-END', 'ACET-SYSVAR-RESTORE', 'ACET-UI-PROGRESS', 'ACET-UI-PROGRESS-INIT', 'ACET-UI-PROGRESS-SAFE', 'ACET-UI-PROGRESS-DONE', 'ACET-UI-STATUS'])
    d(n, () => null);
  d('ACET-SYSVAR-SET', (a) => {
    const l = Array.isArray(a[0]) ? a[0] : [];
    for (let i = 0; i + 1 < l.length; i += 2) setvar(String(l[i]), l[i + 1]);
    return null;
  });
  d('ACET-SS-ZOOM-EXTENTS', () => {
    ctx().view?.zoomExtents();
    return null;
  });
  d('ACET-GEOM-SS-EXTENTS', (a) => {
    if (!(a[0] instanceof PickSet)) return null;
    const bs = a[0].ids.map((id) => doc().get(id)).filter((e): e is Entity => !!e).map(bbox);
    if (!bs.length) return null;
    return [P3([Math.min(...bs.map((b) => b.minX)), Math.min(...bs.map((b) => b.minY))]), P3([Math.max(...bs.map((b) => b.maxX)), Math.max(...bs.map((b) => b.maxY))])];
  });
  d('ACET-ENT-GEOMEXTENTS', (a) => {
    const b = bbox(entOf(a[0], 'acet-ent-geomextents'));
    return [P3([b.minX, b.minY]), P3([b.maxX, b.maxY])];
  });

  // ---- DCL: chưa có hộp thoại → trả về mã lỗi để lisp tự thoát gọn ----
  d('LOAD_DIALOG', () => -1);
  for (const n of ['UNLOAD_DIALOG', 'NEW_DIALOG', 'START_DIALOG', 'DONE_DIALOG', 'TERM_DIALOG', 'ACTION_TILE', 'SET_TILE', 'GET_TILE', 'MODE_TILE', 'START_LIST', 'ADD_LIST', 'END_LIST', 'START_IMAGE', 'FILL_IMAGE', 'VECTOR_IMAGE', 'END_IMAGE', 'CLIENT_DATA_TILE'])
    d(n, () => null);

  // ---- Nạp lisp ----
  d('LOAD', async (a) => {
    const name = String(a[0]).toLowerCase().replace(/\\/g, '/').replace(/^.*\//, '');
    const key = [...L.sources.keys()].find((k) => k === name || k === `${name}.lsp` || k.replace(/\.lsp$/, '') === name);
    if (!key) {
      if (a.length > 1) return a[1];
      throw new LispError(`LOAD failed: "${a[0]}"`);
    }
    return L.evalString(L.sources.get(key)!);
  });
  d('AUTOLOAD', () => null);
  d('ARXLOAD', () => null);
  d('VL-REGISTRY-READ', () => null);
  d('VL-REGISTRY-WRITE', (a) => a[2] ?? null);
  d('STARTAPP', () => null);
  d('LAYOUTLIST', () => ['Layout1']);
  d('ACAD_COLORDLG', (a) => a[0] ?? 7);
  d('ACAD_TRUECOLORDLG', (a) => a[0] ?? null);
  d('MENUCMD', () => null);
  d('VL-DOC-SET', (a) => {
    if (a[0] instanceof Sym) L.set(a[0], a[1] ?? null);
    return a[1] ?? null;
  });
  d('VL-DOC-REF', (a) => (a[0] instanceof Sym ? L.get(a[0]) : null));
  d('VL-BB-SET', (a) => {
    if (a[0] instanceof Sym) L.set(a[0], a[1] ?? null);
    return a[1] ?? null;
  });
  d('VL-BB-REF', (a) => (a[0] instanceof Sym ? L.get(a[0]) : null));
  d('VL-PROPAGATE', () => null);
  L.set(S(':VLAX-TRUE'), S(':VLAX-TRUE'));
  L.set(S(':VLAX-FALSE'), S(':VLAX-FALSE'));
  L.set(S(':VLAX-NULL'), null);
  for (const [n, v] of Object.entries({ ACRED: 1, ACYELLOW: 2, ACGREEN: 3, ACCYAN: 4, ACBLUE: 5, ACMAGENTA: 6, ACWHITE: 7, ACBYLAYER: 256, ACBYBLOCK: 0 })) L.set(S(n), v);
}

/** Bộ thông dịch kèm hàm CAD; các lệnh C:XXX được đăng ký vào Registry. */
export function createLisp(env: CadEnv, onCommand?: (name: string, f: LFun) => void): Interp {
  const L = new Interp();
  installCad(L, env);
  L.onDefun = (name, f) => {
    if (/^C:/i.test(name)) onCommand?.(name.slice(2).toUpperCase(), f);
  };
  return L;
}

