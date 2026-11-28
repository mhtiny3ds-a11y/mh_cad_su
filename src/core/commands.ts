// Hệ thống lệnh. Mỗi lệnh có:
//  - params + run(): gọi trực tiếp bằng dữ liệu có cấu trúc (API, script, Claude)
//  - interactive(): hỏi người dùng từng bước trên dòng lệnh / canvas, rồi gọi run()
// Cả hai đường đều chạy trong một giao dịch → một lần hoàn tác.

import { type Vec, angleOf, circleFrom3, dist, rad2deg, sub } from './geom';
import { type Drawing } from './document';
import {
  type Entity,
  type NewEntity,
  expand,
  getBlock,
  placeInBlock,
  describe,
  fmtNum,
  mirrorEnt,
  moveEnt,
  normDeg,
  polySegments,
  rotateEnt,
  scaleEnt,
} from './entities';
import { offsetEntity } from './offset';
import { toVec } from './input';

export type ParamType = 'point' | 'points' | 'number' | 'string' | 'ids' | 'boolean';

export interface ParamSpec {
  name: string;
  type: ParamType;
  required?: boolean;
  desc: string;
}

export type Args = Record<string, unknown>;
export type Result = Record<string, unknown> & { message?: string };

/** Lỗi do người dùng huỷ lệnh (Esc). */
export class CancelError extends Error {
  constructor() {
    super('*Huỷ*');
  }
}

export interface PointOpts {
  base?: Vec;
  /** Enter trống trả về null thay vì hỏi lại. */
  allowNone?: boolean;
  keywords?: string[];
  /** Hình xem trước theo vị trí con trỏ. */
  preview?: (cursor: Vec) => NewEntity[];
}

/** Giao tiếp tương tác do giao diện cung cấp. */
export interface IO {
  getPoint(msg: string, opts?: PointOpts): Promise<Vec | string | null>;
  /** Nhận số gõ vào hoặc điểm bấm (tính khoảng cách tới base). */
  getDistance(msg: string, opts?: { base?: Vec; def?: number; preview?: PointOpts['preview'] }): Promise<number | null>;
  getAngle(msg: string, opts: { base: Vec; def?: number; preview?: PointOpts['preview'] }): Promise<number | null>;
  getString(msg: string, opts?: { def?: string; spaces?: boolean }): Promise<string | null>;
  /** Bấm vào một đối tượng: trả về id và điểm bấm; Enter = null; gõ từ khoá = chuỗi. */
  getEntity(msg: string, opts?: { keywords?: string[] }): Promise<{ id: number; p: Vec } | string | null>;
  /** single: bấm trúng một đối tượng là xong ngay. */
  getSelection(msg: string, opts?: { single?: boolean }): Promise<number[]>;
  print(msg: string): void;
}

export interface ViewApi {
  zoomExtents(): void;
  zoomWindow(a: Vec, b: Vec): void;
}

export interface Ctx {
  doc: Drawing;
  /** Các đối tượng đang được chọn sẵn (trước khi gọi lệnh). */
  selection: Set<number>;
  view?: ViewApi;
  print: (msg: string) => void;
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  desc: string;
  params: ParamSpec[];
  /** Lệnh chỉ đọc (không mở giao dịch). */
  readonly?: boolean;
  run(ctx: Ctx, args: Args): Result;
  interactive?(ctx: Ctx, io: IO): Promise<void>;
}

// ---------- Tiện ích đọc tham số ----------

export const num = (args: Args, k: string, def?: number): number => {
  const v = args[k];
  if (v === undefined || v === null) {
    if (def !== undefined) return def;
    throw new Error(`Thiếu tham số "${k}"`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Tham số "${k}" phải là số`);
  return n;
};
export const pt = (args: Args, k: string): Vec => {
  if (args[k] === undefined) throw new Error(`Thiếu tham số "${k}"`);
  return toVec(args[k], k);
};
export const pts = (args: Args, k: string, min: number): Vec[] => {
  const v = args[k];
  if (!Array.isArray(v)) throw new Error(`Tham số "${k}" phải là mảng điểm`);
  const out = v.map((p, i) => toVec(p, `${k}[${i}]`));
  if (out.length < min) throw new Error(`"${k}" cần ít nhất ${min} điểm`);
  return out;
};
export const str = (args: Args, k: string, def?: string): string => {
  const v = args[k];
  if (v === undefined || v === null || v === '') {
    if (def !== undefined) return def;
    throw new Error(`Thiếu tham số "${k}"`);
  }
  return String(v);
};
export const optStr = (args: Args, k: string): string | undefined => (args[k] == null ? undefined : String(args[k]));
export const bool = (args: Args, k: string, def: boolean): boolean => (args[k] === undefined ? def : Boolean(args[k]));

export function ids(ctx: Ctx, args: Args): Entity[] {
  const v = args.ids;
  if (!Array.isArray(v) || v.length === 0) throw new Error('Cần "ids": danh sách id đối tượng');
  return v.map((x) => {
    const e = ctx.doc.get(Number(x));
    if (!e) throw new Error(`Không có đối tượng #${x}`);
    if (!ctx.doc.isEditable(e)) throw new Error(`Đối tượng #${x} nằm trên layer đang khoá hoặc tắt`);
    return e;
  });
}

/** Thuộc tính chung: layer và màu (nếu truyền vào). */
export function props(ctx: Ctx, args: Args): { layer: string; color?: number } {
  const layer = optStr(args, 'layer') ?? ctx.doc.currentLayer;
  const color = args.color == null ? undefined : num(args, 'color');
  return color === undefined ? { layer } : { layer, color };
}

export const COMMON: ParamSpec[] = [
  { name: 'layer', type: 'string', desc: 'Layer (mặc định: layer hiện hành; tự tạo nếu chưa có)' },
  { name: 'color', type: 'number', desc: 'Màu ACI 1–255 (mặc định: theo layer)' },
];

export const created = (ents: Entity[], message?: string): Result => ({ ids: ents.map((e) => e.id), message });

/** Lấy danh sách chọn: dùng chọn sẵn nếu có, không thì hỏi. */
export async function pickSelection(ctx: Ctx, io: IO): Promise<number[]> {
  const pre = [...ctx.selection].filter((id) => {
    const e = ctx.doc.get(id);
    return e && ctx.doc.isEditable(e);
  });
  if (pre.length) return pre;
  const s = await io.getSelection('Chọn đối tượng');
  return s;
}

export const entsOf = (ctx: Ctx, list: number[]): Entity[] =>
  list.map((id) => ctx.doc.get(id)).filter((e): e is Entity => !!e);

// ---------- Định nghĩa lệnh ----------

const LINE: CommandDef = {
  name: 'LINE',
  aliases: ['L'],
  desc: 'Vẽ các đoạn thẳng nối liên tiếp các điểm',
  params: [
    { name: 'points', type: 'points', required: true, desc: 'Danh sách điểm [[x,y], ...], ít nhất 2' },
    { name: 'close', type: 'boolean', desc: 'Nối điểm cuối về điểm đầu' },
    ...COMMON,
  ],
  run(ctx, args) {
    const p = pts(args, 'points', 2);
    const pr = props(ctx, args);
    const out: Entity[] = [];
    for (let i = 0; i + 1 < p.length; i++) out.push(ctx.doc.add({ type: 'LINE', a: p[i], b: p[i + 1], ...pr }));
    if (bool(args, 'close', false) && p.length > 2)
      out.push(ctx.doc.add({ type: 'LINE', a: p[p.length - 1], b: p[0], ...pr }));
    return created(out);
  },
  async interactive(ctx, io) {
    const first = await io.getPoint('Điểm đầu');
    if (!Array.isArray(first)) return;
    const chain: Vec[] = [first as Vec];
    const madeIds: number[] = [];
    for (;;) {
      const last = chain[chain.length - 1];
      const kws = chain.length >= 3 ? ['Close', 'Undo'] : ['Undo'];
      const p = await io.getPoint('Điểm tiếp theo', {
        base: last,
        allowNone: true,
        keywords: kws,
        preview: (c) => [{ type: 'LINE', a: last, b: c, layer: ctx.doc.currentLayer }],
      });
      if (p === null) return;
      if (p === 'Undo') {
        if (chain.length > 1) {
          chain.pop();
          const id = madeIds.pop();
          if (id !== undefined) ctx.doc.remove(id);
        }
        continue;
      }
      if (p === 'Close') {
        const r = LINE.run(ctx, { points: [last, chain[0]] });
        madeIds.push(...(r.ids as number[]));
        return;
      }
      if (typeof p === 'string') continue;
      const r = LINE.run(ctx, { points: [last, p] });
      madeIds.push(...(r.ids as number[]));
      chain.push(p);
    }
  },
};

const PLINE: CommandDef = {
  name: 'PLINE',
  aliases: ['PL'],
  desc: 'Vẽ đa tuyến (polyline) qua các điểm',
  params: [
    { name: 'points', type: 'points', required: true, desc: 'Danh sách đỉnh [[x,y], ...], ít nhất 2' },
    { name: 'closed', type: 'boolean', desc: 'Đa tuyến kín' },
    ...COMMON,
  ],
  run(ctx, args) {
    const e = ctx.doc.add({ type: 'LWPOLYLINE', pts: pts(args, 'points', 2), closed: bool(args, 'closed', false), ...props(ctx, args) });
    return created([e]);
  },
  async interactive(ctx, io) {
    const first = await io.getPoint('Điểm đầu');
    if (!Array.isArray(first)) return;
    const chain: Vec[] = [first as Vec];
    for (;;) {
      const last = chain[chain.length - 1];
      const p = await io.getPoint('Điểm tiếp theo', {
        base: last,
        allowNone: true,
        keywords: chain.length >= 3 ? ['Close', 'Undo'] : ['Undo'],
        preview: (c) => [{ type: 'LWPOLYLINE', pts: [...chain, c], closed: false, layer: ctx.doc.currentLayer }],
      });
      if (p === 'Undo') {
        if (chain.length > 1) chain.pop();
        continue;
      }
      if (p === null || p === 'Close') {
        if (chain.length >= 2) PLINE.run(ctx, { points: chain, closed: p === 'Close' });
        return;
      }
      if (Array.isArray(p)) chain.push(p as Vec);
    }
  },
};

const RECTANG: CommandDef = {
  name: 'RECTANG',
  aliases: ['REC', 'RECTANGLE'],
  desc: 'Vẽ hình chữ nhật (đa tuyến kín) từ hai góc đối diện',
  params: [
    { name: 'p1', type: 'point', required: true, desc: 'Góc thứ nhất' },
    { name: 'p2', type: 'point', required: true, desc: 'Góc đối diện' },
    ...COMMON,
  ],
  run(ctx, args) {
    const a = pt(args, 'p1');
    const b = pt(args, 'p2');
    if (a[0] === b[0] || a[1] === b[1]) throw new Error('Hai góc phải khác nhau theo cả X và Y');
    const e = ctx.doc.add({
      type: 'LWPOLYLINE',
      pts: [a, [b[0], a[1]], b, [a[0], b[1]]],
      closed: true,
      ...props(ctx, args),
    });
    return created([e]);
  },
  async interactive(ctx, io) {
    const a = await io.getPoint('Góc thứ nhất');
    if (!Array.isArray(a)) return;
    const p1 = a as Vec;
    const rect = (c: Vec): NewEntity => ({
      type: 'LWPOLYLINE',
      pts: [p1, [c[0], p1[1]], c, [p1[0], c[1]]],
      closed: true,
      layer: ctx.doc.currentLayer,
    });
    const b = await io.getPoint('Góc đối diện (hoặc @dài,rộng)', { base: p1, preview: (c) => [rect(c)] });
    if (!Array.isArray(b)) return;
    RECTANG.run(ctx, { p1, p2: b });
  },
};

const CIRCLE: CommandDef = {
  name: 'CIRCLE',
  aliases: ['C'],
  desc: 'Vẽ đường tròn theo tâm và bán kính',
  params: [
    { name: 'center', type: 'point', required: true, desc: 'Tâm' },
    { name: 'radius', type: 'number', required: true, desc: 'Bán kính (> 0)' },
    ...COMMON,
  ],
  run(ctx, args) {
    const r = num(args, 'radius');
    if (r <= 0) throw new Error('Bán kính phải > 0');
    return created([ctx.doc.add({ type: 'CIRCLE', c: pt(args, 'center'), r, ...props(ctx, args) })]);
  },
  async interactive(ctx, io) {
    const c = await io.getPoint('Tâm đường tròn');
    if (!Array.isArray(c)) return;
    const center = c as Vec;
    const r = await io.getDistance('Bán kính', {
      base: center,
      preview: (p) => [{ type: 'CIRCLE', c: center, r: Math.max(dist(center, p), 1e-9), layer: ctx.doc.currentLayer }],
    });
    if (r === null || r <= 0) return;
    CIRCLE.run(ctx, { center, radius: r });
  },
};

function arcFrom3(p1: Vec, p2: Vec, p3: Vec): { c: Vec; r: number; start: number; end: number } | null {
  const cr = circleFrom3(p1, p2, p3);
  if (!cr) return null;
  const a1 = rad2deg(angleOf(sub(p1, cr.c)));
  const a3 = rad2deg(angleOf(sub(p3, cr.c)));
  // Hướng: nếu p2 nằm trên cung ngược chiều kim đồng hồ từ p1 tới p3 thì giữ, không thì đảo.
  const a2 = rad2deg(angleOf(sub(p2, cr.c)));
  const ccw = normDeg(a2 - a1) <= normDeg(a3 - a1);
  return ccw
    ? { c: cr.c, r: cr.r, start: normDeg(a1), end: normDeg(a3) }
    : { c: cr.c, r: cr.r, start: normDeg(a3), end: normDeg(a1) };
}

const ARC: CommandDef = {
  name: 'ARC',
  aliases: ['A'],
  desc: 'Vẽ cung tròn: qua 3 điểm (p1, p2, p3) hoặc theo tâm/bán kính/góc',
  params: [
    { name: 'p1', type: 'point', desc: 'Điểm đầu (cách 3 điểm)' },
    { name: 'p2', type: 'point', desc: 'Điểm giữa (cách 3 điểm)' },
    { name: 'p3', type: 'point', desc: 'Điểm cuối (cách 3 điểm)' },
    { name: 'center', type: 'point', desc: 'Tâm (cách tâm/góc)' },
    { name: 'radius', type: 'number', desc: 'Bán kính' },
    { name: 'startAngle', type: 'number', desc: 'Góc đầu (độ, ngược chiều kim đồng hồ)' },
    { name: 'endAngle', type: 'number', desc: 'Góc cuối (độ)' },
    ...COMMON,
  ],
  run(ctx, args) {
    let a: { c: Vec; r: number; start: number; end: number } | null;
    if (args.center !== undefined) {
      a = {
        c: pt(args, 'center'),
        r: num(args, 'radius'),
        start: normDeg(num(args, 'startAngle')),
        end: normDeg(num(args, 'endAngle')),
      };
      if (a.r <= 0) throw new Error('Bán kính phải > 0');
    } else {
      a = arcFrom3(pt(args, 'p1'), pt(args, 'p2'), pt(args, 'p3'));
      if (!a) throw new Error('Ba điểm thẳng hàng, không tạo được cung');
    }
    return created([ctx.doc.add({ type: 'ARC', ...a, ...props(ctx, args) })]);
  },
  async interactive(ctx, io) {
    const p1 = await io.getPoint('Điểm đầu của cung');
    if (!Array.isArray(p1)) return;
    const p2 = await io.getPoint('Điểm thứ hai', {
      base: p1 as Vec,
      preview: (c) => [{ type: 'LINE', a: p1 as Vec, b: c, layer: ctx.doc.currentLayer }],
    });
    if (!Array.isArray(p2)) return;
    const p3 = await io.getPoint('Điểm cuối', {
      base: p2 as Vec,
      preview: (c) => {
        const a = arcFrom3(p1 as Vec, p2 as Vec, c);
        return a ? [{ type: 'ARC', ...a, layer: ctx.doc.currentLayer }] : [];
      },
    });
    if (!Array.isArray(p3)) return;
    ARC.run(ctx, { p1, p2, p3 });
  },
};

const TEXT: CommandDef = {
  name: 'TEXT',
  aliases: ['DT', 'DTEXT', 'T'],
  desc: 'Ghi một dòng chữ (hỗ trợ tiếng Việt Unicode)',
  params: [
    { name: 'position', type: 'point', required: true, desc: 'Điểm chèn (góc dưới trái)' },
    { name: 'text', type: 'string', required: true, desc: 'Nội dung' },
    { name: 'height', type: 'number', desc: 'Chiều cao chữ (mặc định 250)' },
    { name: 'rotation', type: 'number', desc: 'Góc xoay (độ, mặc định 0)' },
    ...COMMON,
  ],
  run(ctx, args) {
    const h = num(args, 'height', 250);
    if (h <= 0) throw new Error('Chiều cao chữ phải > 0');
    const e = ctx.doc.add({
      type: 'TEXT',
      p: pt(args, 'position'),
      text: str(args, 'text'),
      h,
      rot: normDeg(num(args, 'rotation', 0)),
      ...props(ctx, args),
    });
    return created([e]);
  },
  async interactive(ctx, io) {
    const p = await io.getPoint('Điểm chèn chữ');
    if (!Array.isArray(p)) return;
    const h = await io.getDistance('Chiều cao chữ', { base: p as Vec, def: lastTextHeight });
    if (h === null || h <= 0) return;
    const text = await io.getString('Nội dung', { spaces: true });
    if (!text) return;
    lastTextHeight = h;
    TEXT.run(ctx, { position: p, height: h, text });
  },
};
let lastTextHeight = 250;

const ERASE: CommandDef = {
  name: 'ERASE',
  aliases: ['E', 'DELETE'],
  desc: 'Xoá đối tượng',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Danh sách id cần xoá' }],
  run(ctx, args) {
    const list = ids(ctx, args);
    for (const e of list) ctx.doc.remove(e.id);
    ctx.selection.clear();
    return { ids: list.map((e) => e.id), message: `Đã xoá ${list.length} đối tượng` };
  },
  async interactive(ctx, io) {
    const s = await pickSelection(ctx, io);
    if (s.length) io.print(ERASE.run(ctx, { ids: s }).message!);
  },
};

function transformCmd(
  name: string,
  aliases: string[],
  desc: string,
  extra: ParamSpec[],
  apply: (e: Entity, args: Args) => Entity,
  ask: (ctx: Ctx, io: IO, sel: Entity[]) => Promise<Args | null>,
  copy = false,
): CommandDef {
  const def: CommandDef = {
    name,
    aliases,
    desc,
    params: [{ name: 'ids', type: 'ids', required: true, desc: 'Danh sách id đối tượng' }, ...extra],
    run(ctx, args) {
      const list = ids(ctx, args);
      const out: Entity[] = [];
      for (const e of list) {
        const t = apply(e, args);
        if (copy) {
          const { id: _id, ...rest } = t;
          out.push(ctx.doc.add(rest as NewEntity));
        } else {
          ctx.doc.update(t);
          out.push(t);
        }
      }
      return { ids: out.map((e) => e.id), message: `${name}: ${out.length} đối tượng` };
    },
    async interactive(ctx, io) {
      const s = await pickSelection(ctx, io);
      if (!s.length) return;
      const a = await ask(ctx, io, entsOf(ctx, s));
      if (a) def.run(ctx, { ids: s, ...a });
    },
  };
  return def;
}

export const ghost = (sel: Entity[], f: (e: Entity) => Entity): NewEntity[] =>
  sel.map((e) => {
    const { id: _id, ...rest } = f(e);
    return rest as NewEntity;
  });

async function askFromTo(io: IO, sel: Entity[]): Promise<{ base: Vec; to: Vec } | null> {
  const b = await io.getPoint('Điểm gốc');
  if (!Array.isArray(b)) return null;
  const base = b as Vec;
  const t = await io.getPoint('Điểm đích', { base, preview: (c) => ghost(sel, (e) => moveEnt(e, sub(c, base))) });
  if (!Array.isArray(t)) return null;
  return { base, to: t as Vec };
}

const disp = (args: Args): Vec => {
  if (args.displacement !== undefined) return pt(args, 'displacement');
  return sub(pt(args, 'to'), pt(args, 'from'));
};
const MOVE_PARAMS: ParamSpec[] = [
  { name: 'from', type: 'point', desc: 'Điểm gốc' },
  { name: 'to', type: 'point', desc: 'Điểm đích' },
  { name: 'displacement', type: 'point', desc: 'Hoặc: độ dời [dx, dy] thay cho from/to' },
];

const MOVE = transformCmd('MOVE', ['M'], 'Di chuyển đối tượng', MOVE_PARAMS, (e, a) => moveEnt(e, disp(a)), async (_c, io, sel) => {
  const r = await askFromTo(io, sel);
  return r && { from: r.base, to: r.to };
});

const COPY_ONE = transformCmd('COPY', ['CO', 'CP'], 'Sao chép đối tượng', MOVE_PARAMS, (e, a) => moveEnt(e, disp(a)), async () => null, true);
const COPY: CommandDef = {
  ...COPY_ONE,
  async interactive(ctx, io) {
    const s = await pickSelection(ctx, io);
    if (!s.length) return;
    const sel = entsOf(ctx, s);
    const b = await io.getPoint('Điểm gốc');
    if (!Array.isArray(b)) return;
    const base = b as Vec;
    // Sao chép nhiều lần cho tới khi Enter.
    for (;;) {
      const t = await io.getPoint('Điểm đích (Enter để kết thúc)', {
        base,
        allowNone: true,
        preview: (c) => ghost(sel, (e) => moveEnt(e, sub(c, base))),
      });
      if (!Array.isArray(t)) return;
      COPY_ONE.run(ctx, { ids: s, from: base, to: t });
    }
  },
};

const ROTATE = transformCmd(
  'ROTATE',
  ['RO'],
  'Xoay đối tượng quanh điểm gốc',
  [
    { name: 'base', type: 'point', required: true, desc: 'Tâm xoay' },
    { name: 'angle', type: 'number', required: true, desc: 'Góc xoay (độ, dương = ngược chiều kim đồng hồ)' },
  ],
  (e, a) => rotateEnt(e, pt(a, 'base'), num(a, 'angle')),
  async (_c, io, sel) => {
    const b = await io.getPoint('Tâm xoay');
    if (!Array.isArray(b)) return null;
    const base = b as Vec;
    const ang = await io.getAngle('Góc xoay', {
      base,
      preview: (c) => ghost(sel, (e) => rotateEnt(e, base, rad2deg(angleOf(sub(c, base))))),
    });
    return ang === null ? null : { base, angle: ang };
  },
);

const SCALE = transformCmd(
  'SCALE',
  ['SC'],
  'Phóng to / thu nhỏ đối tượng theo hệ số',
  [
    { name: 'base', type: 'point', required: true, desc: 'Điểm gốc' },
    { name: 'factor', type: 'number', required: true, desc: 'Hệ số tỉ lệ (> 0)' },
  ],
  (e, a) => {
    const k = num(a, 'factor');
    if (k <= 0) throw new Error('Hệ số tỉ lệ phải > 0');
    return scaleEnt(e, pt(a, 'base'), k);
  },
  async (_c, io, sel) => {
    const b = await io.getPoint('Điểm gốc');
    if (!Array.isArray(b)) return null;
    const base = b as Vec;
    const k = await io.getDistance('Hệ số tỉ lệ', {
      base,
      preview: (c) => ghost(sel, (e) => scaleEnt(e, base, Math.max(dist(base, c) / 1000, 1e-6))),
    });
    return k === null || k <= 0 ? null : { base, factor: k };
  },
);

const MIRROR_T = transformCmd(
  'MIRROR',
  ['MI'],
  'Lấy đối xứng qua đường thẳng p1–p2',
  [
    { name: 'p1', type: 'point', required: true, desc: 'Điểm thứ nhất của trục đối xứng' },
    { name: 'p2', type: 'point', required: true, desc: 'Điểm thứ hai của trục đối xứng' },
    { name: 'erase', type: 'boolean', desc: 'Xoá đối tượng gốc (mặc định: giữ)' },
  ],
  (e, a) => mirrorEnt(e, pt(a, 'p1'), pt(a, 'p2')),
  async () => null,
  true,
);
const MIRROR: CommandDef = {
  ...MIRROR_T,
  run(ctx, args) {
    const r = MIRROR_T.run(ctx, args);
    if (bool(args, 'erase', false)) for (const e of ids(ctx, args)) ctx.doc.remove(e.id);
    return r;
  },
  async interactive(ctx, io) {
    const s = await pickSelection(ctx, io);
    if (!s.length) return;
    const sel = entsOf(ctx, s);
    const a = await io.getPoint('Điểm thứ nhất của trục đối xứng');
    if (!Array.isArray(a)) return;
    const b = await io.getPoint('Điểm thứ hai', {
      base: a as Vec,
      preview: (c) => ghost(sel, (e) => mirrorEnt(e, a as Vec, c)),
    });
    if (!Array.isArray(b)) return;
    const k = await io.getPoint('Xoá đối tượng gốc?', { allowNone: true, keywords: ['Yes', 'No'] });
    MIRROR.run(ctx, { ids: s, p1: a, p2: b, erase: k === 'Yes' });
  },
};

const OFFSET: CommandDef = {
  name: 'OFFSET',
  aliases: ['O'],
  desc: 'Tạo đối tượng song song cách một khoảng (LINE, CIRCLE, ARC, đa tuyến)',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Đối tượng cần offset' },
    { name: 'distance', type: 'number', required: true, desc: 'Khoảng cách (> 0)' },
    { name: 'side', type: 'point', required: true, desc: 'Một điểm nằm về phía cần offset' },
  ],
  run(ctx, args) {
    const d = num(args, 'distance');
    const side = pt(args, 'side');
    const out: Entity[] = [];
    for (const e of ids(ctx, args)) {
      const n = offsetEntity(e, d, side);
      if (n) out.push(ctx.doc.add(n));
    }
    if (!out.length) throw new Error('Không offset được đối tượng đã chọn');
    return created(out);
  },
  async interactive(ctx, io) {
    const d = await io.getDistance('Khoảng cách offset', { def: lastOffset });
    if (d === null || d <= 0) return;
    lastOffset = d;
    for (;;) {
      ctx.selection.clear();
      const s = await io.getSelection('Chọn đối tượng cần offset (Enter để kết thúc)', { single: true });
      if (!s.length) return;
      const e = ctx.doc.get(s[0]);
      if (!e) return;
      const side = await io.getPoint('Bấm về phía cần offset', {
        preview: (c) => {
          const n = offsetEntity(e, d, c);
          return n ? [n] : [];
        },
      });
      if (!Array.isArray(side)) return;
      try {
        OFFSET.run(ctx, { ids: [e.id], distance: d, side });
      } catch (err) {
        io.print((err as Error).message);
      }
    }
  },
};
let lastOffset = 100;

const EXPLODE: CommandDef = {
  name: 'EXPLODE',
  aliases: ['X'],
  desc: 'Phá đa tuyến thành đoạn thẳng; phá block (INSERT) và kích thước thành đối tượng cơ bản',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Danh sách id' }],
  run(ctx, args) {
    const out: Entity[] = [];
    for (const e of ids(ctx, args)) {
      if (e.type === 'LWPOLYLINE') {
        const p = { layer: e.layer, ...(e.color !== undefined ? { color: e.color } : {}), ...(e.lt ? { lt: e.lt } : {}) };
        for (const [a, b] of polySegments(e)) out.push(ctx.doc.add({ type: 'LINE', a, b, ...p }));
        ctx.doc.remove(e.id);
      } else if (e.type === 'INSERT' || e.type === 'DIMENSION') {
        // Phá một cấp: block lồng nhau vẫn giữ là INSERT.
        const parts: NewEntity[] =
          e.type === 'DIMENSION'
            ? expand(e)
            : (() => {
                const b = getBlock(e.name);
                if (!b) throw new Error(`Không có block "${e.name}"`);
                return b.ents.map((x) => {
                  const placed = placeInBlock(x, e, b.base);
                  return placed.layer === '0' ? ({ ...placed, layer: e.layer } as NewEntity) : placed;
                });
              })();
        for (const x of parts) out.push(ctx.doc.add(x));
        ctx.doc.remove(e.id);
      }
    }
    ctx.selection.clear();
    return created(out, `Đã tạo ${out.length} đối tượng`);
  },
  async interactive(ctx, io) {
    const s = await pickSelection(ctx, io);
    if (s.length) io.print(EXPLODE.run(ctx, { ids: s }).message!);
  },
};

const LAYER: CommandDef = {
  name: 'LAYER',
  aliases: ['LA'],
  desc: 'Tạo / chỉnh layer và đặt layer hiện hành',
  params: [
    { name: 'name', type: 'string', required: true, desc: 'Tên layer' },
    { name: 'color', type: 'number', desc: 'Màu ACI' },
    { name: 'current', type: 'boolean', desc: 'Đặt làm layer hiện hành (mặc định: có)' },
    { name: 'visible', type: 'boolean', desc: 'Bật/tắt hiển thị' },
    { name: 'locked', type: 'boolean', desc: 'Khoá/mở khoá' },
    { name: 'linetype', type: 'string', desc: 'Kiểu đường của layer (CONTINUOUS, DASHED, HIDDEN, CENTER, DASHDOT, DOT, PHANTOM)' },
    { name: 'newName', type: 'string', desc: 'Đổi tên layer thành tên này' },
  ],
  run(ctx, args) {
    const name = str(args, 'name').trim();
    if (args.newName !== undefined) return renameLayer(ctx, name, str(args, 'newName').trim());
    if (!/^[^<>/\\":;?*|=`]{1,255}$/.test(name)) throw new Error('Tên layer không hợp lệ');
    const isNew = !ctx.doc.layers.has(name);
    ctx.doc.ensureLayer(name, args.color == null ? 7 : num(args, 'color'));
    const patch: Record<string, unknown> = {};
    if (!isNew && args.color != null) patch.color = num(args, 'color');
    if (args.visible !== undefined) patch.visible = Boolean(args.visible);
    if (args.locked !== undefined) patch.locked = Boolean(args.locked);
    if (args.linetype !== undefined) {
      const lt = str(args, 'linetype').toUpperCase();
      if (!ctx.doc.linetypes.has(lt)) throw new Error(`Không có kiểu đường "${lt}"`);
      patch.lt = lt;
    }
    if (Object.keys(patch).length) ctx.doc.setLayer(name, patch);
    if (bool(args, 'current', true)) ctx.doc.setCurrentLayer(name);
    return { name, message: `${isNew ? 'Đã tạo' : 'Đã cập nhật'} layer "${name}"` };
  },
  async interactive(ctx, io) {
    const name = await io.getString(`Tên layer (hiện hành: ${ctx.doc.currentLayer})`, { spaces: true });
    if (!name) return;
    io.print(LAYER.run(ctx, { name }).message!);
  },
};

function renameLayer(ctx: Ctx, from: string, to: string): Result {
  const l = ctx.doc.layers.get(from);
  if (!l) throw new Error(`Không có layer "${from}"`);
  if (from === '0') throw new Error('Không đổi tên được layer 0');
  if (!/^[^<>/\\":;?*|=`]{1,255}$/.test(to)) throw new Error('Tên layer không hợp lệ');
  if (ctx.doc.layers.has(to)) throw new Error(`Layer "${to}" đã có`);
  ctx.doc.ensureLayer(to, l.color);
  ctx.doc.setLayer(to, { visible: l.visible, locked: false, ...(l.lt ? { lt: l.lt } : {}) });
  for (const e of ctx.doc.all()) if (e.layer === from) ctx.doc.update({ ...e, layer: to });
  if (ctx.doc.currentLayer === from) ctx.doc.setCurrentLayer(to);
  if (l.locked) ctx.doc.setLayer(to, { locked: true });
  ctx.doc.removeLayer(from);
  return { name: to, message: `Đã đổi tên layer "${from}" thành "${to}"` };
}

const LAYDEL: CommandDef = {
  name: 'LAYDEL',
  desc: 'Xoá layer cùng mọi đối tượng trên đó (không xoá được layer 0 và layer hiện hành)',
  params: [{ name: 'name', type: 'string', required: true, desc: 'Tên layer' }],
  run(ctx, args) {
    const name = str(args, 'name');
    if (!ctx.doc.layers.has(name)) throw new Error(`Không có layer "${name}"`);
    if (name === '0' || name === ctx.doc.currentLayer) throw new Error('Không xoá được layer 0 hoặc layer hiện hành');
    let n = 0;
    for (const e of ctx.doc.all())
      if (e.layer === name) {
        ctx.doc.remove(e.id);
        n++;
      }
    ctx.doc.removeLayer(name);
    return { message: `Đã xoá layer "${name}" và ${n} đối tượng` };
  },
  async interactive(ctx, io) {
    const name = await io.getString('Tên layer cần xoá', { spaces: true });
    if (name) io.print(LAYDEL.run(ctx, { name }).message!);
  },
};

const DIST: CommandDef = {
  name: 'DIST',
  aliases: ['DI'],
  readonly: true,
  desc: 'Đo khoảng cách giữa hai điểm',
  params: [
    { name: 'p1', type: 'point', required: true, desc: 'Điểm thứ nhất' },
    { name: 'p2', type: 'point', required: true, desc: 'Điểm thứ hai' },
  ],
  run(_ctx, args) {
    const a = pt(args, 'p1');
    const b = pt(args, 'p2');
    const d = dist(a, b);
    const ang = normDeg(rad2deg(angleOf(sub(b, a))));
    return {
      distance: d,
      dx: b[0] - a[0],
      dy: b[1] - a[1],
      angle: ang,
      message: `Khoảng cách = ${fmtNum(d)} · ΔX = ${fmtNum(b[0] - a[0])} · ΔY = ${fmtNum(b[1] - a[1])} · góc ${fmtNum(ang)}°`,
    };
  },
  async interactive(ctx, io) {
    const a = await io.getPoint('Điểm thứ nhất');
    if (!Array.isArray(a)) return;
    const b = await io.getPoint('Điểm thứ hai', {
      base: a as Vec,
      preview: (c) => [{ type: 'LINE', a: a as Vec, b: c, layer: ctx.doc.currentLayer }],
    });
    if (!Array.isArray(b)) return;
    io.print(DIST.run(ctx, { p1: a, p2: b }).message!);
  },
};

const LIST: CommandDef = {
  name: 'LIST',
  aliases: ['LI', 'LS'],
  readonly: true,
  desc: 'Liệt kê thông tin đối tượng',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Danh sách id' }],
  run(ctx, args) {
    const v = args.ids;
    if (!Array.isArray(v)) throw new Error('Cần "ids"');
    const lines = v.map((id) => {
      const e = ctx.doc.get(Number(id));
      return e ? describe(e) : `Không có đối tượng #${id}`;
    });
    return { lines, message: lines.join('\n') };
  },
  async interactive(ctx, io) {
    const s = [...ctx.selection].length ? [...ctx.selection] : await io.getSelection('Chọn đối tượng');
    if (s.length) io.print(LIST.run(ctx, { ids: s }).message!);
  },
};

const ZOOM: CommandDef = {
  name: 'ZOOM',
  aliases: ['Z'],
  readonly: true,
  desc: 'Thu phóng màn hình: Extents (toàn bộ bản vẽ) hoặc Window (khung p1–p2)',
  params: [
    { name: 'p1', type: 'point', desc: 'Góc khung (bỏ trống = Extents)' },
    { name: 'p2', type: 'point', desc: 'Góc đối diện' },
  ],
  run(ctx, args) {
    if (!ctx.view) return { message: 'Không có màn hình' };
    if (args.p1 !== undefined) ctx.view.zoomWindow(pt(args, 'p1'), pt(args, 'p2'));
    else ctx.view.zoomExtents();
    return {};
  },
  async interactive(ctx, io) {
    const p = await io.getPoint('Góc khung hoặc [Extents]', { allowNone: true, keywords: ['Extents', 'Window'] });
    if (p === null || p === 'Extents') return void ZOOM.run(ctx, {});
    let a: Vec | string | null = p;
    if (p === 'Window') a = await io.getPoint('Góc thứ nhất');
    if (!Array.isArray(a)) return;
    const b = await io.getPoint('Góc đối diện', { base: a as Vec });
    if (Array.isArray(b)) ZOOM.run(ctx, { p1: a, p2: b });
  },
};

export const BUILTIN: CommandDef[] = [
  LINE,
  PLINE,
  RECTANG,
  CIRCLE,
  ARC,
  TEXT,
  ERASE,
  MOVE,
  COPY,
  ROTATE,
  SCALE,
  MIRROR,
  OFFSET,
  EXPLODE,
  LAYER,
  LAYDEL,
  DIST,
  LIST,
  ZOOM,
];

export class Registry {
  private byName = new Map<string, CommandDef>();
  private alias = new Map<string, string>();

  constructor(defs: CommandDef[] = BUILTIN) {
    for (const d of defs) this.register(d);
  }

  register(d: CommandDef): void {
    this.byName.set(d.name, d);
    for (const a of d.aliases ?? []) this.alias.set(a.toUpperCase(), d.name);
  }

  resolve(input: string): CommandDef | undefined {
    const k = input.trim().toUpperCase();
    return this.byName.get(k) ?? this.byName.get(this.alias.get(k) ?? '');
  }

  list(): CommandDef[] {
    return [...this.byName.values()];
  }

  /** Mô tả máy đọc được (cho Claude/AI và trang trợ giúp). */
  schema(): { name: string; aliases: string[]; desc: string; params: ParamSpec[] }[] {
    return this.list().map((d) => ({ name: d.name, aliases: d.aliases ?? [], desc: d.desc, params: d.params }));
  }
}

/** Chạy lệnh bằng dữ liệu có cấu trúc, trong một giao dịch. */
export function runCommand(reg: Registry, ctx: Ctx, name: string, args: Args = {}): Result {
  const def = reg.resolve(name);
  if (!def) throw new Error(`Không có lệnh "${name}"`);
  for (const p of def.params) if (p.required && args[p.name] === undefined)
    throw new Error(`${def.name}: thiếu tham số "${p.name}" (${p.desc})`);
  if (def.readonly) return def.run(ctx, args);
  return ctx.doc.transact(def.name, () => def.run(ctx, args));
}

/** Chạy lệnh ở chế độ tương tác; Esc giữ lại phần đã làm (giống AutoCAD). */
export async function runInteractive(reg: Registry, ctx: Ctx, io: IO, name: string): Promise<void> {
  const def = reg.resolve(name);
  if (!def) throw new Error(`Không có lệnh "${name}"`);
  if (!def.interactive) throw new Error(`Lệnh ${def.name} chưa hỗ trợ nhập tương tác`);
  if (def.readonly) {
    try {
      await def.interactive(ctx, io);
    } catch (e) {
      if (!(e instanceof CancelError)) throw e;
    }
    return;
  }
  ctx.doc.begin(def.name);
  try {
    await def.interactive(ctx, io);
    ctx.doc.commit();
  } catch (e) {
    if (e instanceof CancelError) ctx.doc.commit();
    else {
      ctx.doc.rollback();
      throw e;
    }
  }
}
