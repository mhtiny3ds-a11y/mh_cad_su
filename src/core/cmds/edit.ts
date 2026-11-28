// SETPROP (sửa thuộc tính bất kỳ — dùng cho bảng Thuộc tính), ARRAY, STRETCH, ELLIPSE.

import { type BBox, type Vec, angleOf, deg2rad, dist, polar, rad2deg, sub } from '../geom';
import { type Entity, type NewEntity, bbox, moveEnt, normDeg, rotateEnt } from '../entities';
import { PATTERNS, patternLines } from '../hatch';
import { type Args, type CommandDef, type Ctx, COMMON, bool, created, ids, num, optStr, pickSelection, props, pt } from '../commands';
import { toVec } from '../input';
import { offsetPolyline } from '../offset';
import type { BlockDef } from '../entities';

// ---------- SETPROP ----------

const NUM_FIELDS: Record<string, string[]> = {
  CIRCLE: ['r'],
  ARC: ['r', 'start', 'end'],
  TEXT: ['h', 'rot'],
  INSERT: ['sx', 'sy', 'rot'],
  HATCH: ['scale', 'angle'],
  DIMENSION: ['rot'],
};
const PT_FIELDS: Record<string, string[]> = {
  LINE: ['a', 'b'],
  CIRCLE: ['c'],
  ARC: ['c'],
  TEXT: ['p'],
  INSERT: ['p'],
  POINT: ['p'],
};

const SETPROP: CommandDef = {
  name: 'SETPROP',
  aliases: ['PROPS'],
  desc:
    'Sửa thuộc tính đối tượng. Chung: layer, color (số hoặc BYLAYER), linetype. Riêng: LINE a,b · CIRCLE c,r · ARC c,r,start,end · ' +
    'TEXT p,h,rot,text,ha,va · LWPOLYLINE closed,pts · INSERT p,sx,sy,rot · HATCH pattern,scale,angle · DIMENSION text · POINT p',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng' },
    { name: 'set', type: 'string', required: true, desc: 'Đối tượng JSON các trường cần đổi, ví dụ {"r": 500} hoặc {"layer": "TUONG", "color": 1}' },
  ],
  run(ctx, args) {
    const raw = args.set;
    const patch = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
    if (!patch || typeof patch !== 'object') throw new Error('"set" phải là đối tượng');
    const list = ids(ctx, args);
    for (const e of list) {
      const n: Record<string, unknown> = { ...e };
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'layer') {
          ctx.doc.ensureLayer(String(v));
          n.layer = String(v);
        } else if (k === 'color') {
          if (v === null || String(v).toUpperCase() === 'BYLAYER') delete n.color;
          else {
            const c = Number(v);
            if (!(c >= 1 && c <= 255)) throw new Error('Màu từ 1 tới 255 hoặc BYLAYER');
            n.color = c;
          }
        } else if (k === 'linetype') {
          const lt = String(v).toUpperCase();
          if (lt === 'BYLAYER') delete n.lt;
          else if (!ctx.doc.linetypes.has(lt)) throw new Error(`Không có kiểu đường "${v}"`);
          else n.lt = lt;
        } else if ((NUM_FIELDS[e.type] ?? []).includes(k)) {
          const x = Number(v);
          if (!Number.isFinite(x)) throw new Error(`"${k}" phải là số`);
          if ((k === 'r' || k === 'h' || k === 'scale') && x <= 0) throw new Error(`"${k}" phải > 0`);
          n[k] = k === 'start' || k === 'end' || k === 'rot' || k === 'angle' ? normDeg(x) : x;
        } else if ((PT_FIELDS[e.type] ?? []).includes(k)) n[k] = toVec(v, k);
        else if (e.type === 'TEXT' && k === 'text') {
          if (!String(v)) throw new Error('Nội dung chữ không được rỗng');
          n.text = String(v);
        } else if (e.type === 'TEXT' && (k === 'ha' || k === 'va')) n[k] = String(v);
        else if (e.type === 'DIMENSION' && k === 'text') {
          if (v === '' || v === null) delete n.text;
          else n.text = String(v);
        } else if (e.type === 'LWPOLYLINE' && k === 'closed') n.closed = Boolean(v);
        else if (e.type === 'LWPOLYLINE' && k === 'pts') {
          if (!Array.isArray(v) || v.length < 2) throw new Error('"pts" cần ít nhất 2 điểm');
          n.pts = v.map((p, i) => toVec(p, `pts[${i}]`));
        } else if (e.type === 'HATCH' && k === 'pattern') {
          const p = String(v).toUpperCase();
          if (!PATTERNS[p]) throw new Error(`Không có mẫu "${v}"`);
          n.pattern = p;
        } else throw new Error(`${e.type} không có thuộc tính "${k}" sửa được`);
      }
      if (e.type === 'HATCH' && ('pattern' in patch || 'scale' in patch || 'angle' in patch)) {
        n.solid = n.pattern === 'SOLID';
        n.lines = patternLines(String(n.pattern), Number(n.scale), Number(n.angle));
      }
      ctx.doc.update(n as unknown as Entity);
    }
    return { ids: list.map((e) => e.id), message: `Đã sửa ${list.length} đối tượng` };
  },
};

// ---------- ARRAY ----------

const ARRAY: CommandDef = {
  name: 'ARRAY',
  aliases: ['AR', 'ARRAYRECT', 'ARRAYPOLAR'],
  desc: 'Sao chép theo mảng: chữ nhật (rows × cols) hoặc tròn (quanh tâm)',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Đối tượng gốc' },
    { name: 'kind', type: 'string', desc: '"rect" (mặc định) hoặc "polar"' },
    { name: 'rows', type: 'number', desc: 'rect: số hàng (mặc định 1)' },
    { name: 'cols', type: 'number', desc: 'rect: số cột (mặc định 1)' },
    { name: 'dx', type: 'number', desc: 'rect: khoảng cách cột' },
    { name: 'dy', type: 'number', desc: 'rect: khoảng cách hàng' },
    { name: 'center', type: 'point', desc: 'polar: tâm' },
    { name: 'count', type: 'number', desc: 'polar: tổng số bản (kể cả gốc)' },
    { name: 'angle', type: 'number', desc: 'polar: góc trải, độ (mặc định 360)' },
    { name: 'rotate', type: 'boolean', desc: 'polar: xoay bản sao theo vòng (mặc định có)' },
  ],
  run(ctx, args) {
    const src = ids(ctx, args);
    const out: Entity[] = [];
    const add = (e: Entity) => {
      const { id: _id, ...rest } = e;
      out.push(ctx.doc.add(rest as NewEntity));
    };
    const kind = (optStr(args, 'kind') ?? 'rect').toLowerCase();
    if (kind === 'polar') {
      const c = pt(args, 'center');
      const n = Math.round(num(args, 'count'));
      if (n < 2 || n > 10000) throw new Error('count từ 2 tới 10000');
      const total = num(args, 'angle', 360);
      const step = Math.abs(Math.abs(total) - 360) < 1e-9 ? total / n : total / (n - 1);
      const rot = bool(args, 'rotate', true);
      for (let i = 1; i < n; i++)
        for (const e of src)
          add(rot ? rotateEnt(e, c, step * i) : moveEnt(e, sub(rotPoint(anchor(e), c, step * i), anchor(e))));
    } else {
      const rows = Math.round(num(args, 'rows', 1));
      const cols = Math.round(num(args, 'cols', 1));
      if (rows < 1 || cols < 1 || rows * cols > 100000) throw new Error('rows, cols ≥ 1 và tổng ≤ 100000');
      const dx = num(args, 'dx', 0);
      const dy = num(args, 'dy', 0);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (!r && !c) continue;
          for (const e of src) add(moveEnt(e, [c * dx, r * dy]));
        }
    }
    return created(out, `Đã tạo ${out.length} bản sao`);
  },
  async interactive(ctx, io) {
    const s = await pickSelection(ctx, io);
    if (!s.length) return;
    const k = await io.getPoint('Kiểu mảng', { keywords: ['Rectangular', 'Polar'] });
    if (k === 'Polar') {
      const c = await io.getPoint('Tâm mảng');
      if (!Array.isArray(c)) return;
      const n = await io.getDistance('Tổng số bản', { def: 6 });
      if (!n) return;
      const a = await io.getDistance('Góc trải (độ)', { def: 360 });
      if (a === null) return;
      io.print(ARRAY.run(ctx, { ids: s, kind: 'polar', center: c, count: n, angle: a }).message!);
    } else if (k === 'Rectangular') {
      const rows = await io.getDistance('Số hàng', { def: 3 });
      if (!rows) return;
      const cols = await io.getDistance('Số cột', { def: 3 });
      if (!cols) return;
      const b = bboxOf(ctx, s);
      const dy = await io.getDistance('Khoảng cách hàng', { def: Math.round((b.maxY - b.minY) * 1.5) || 1000 });
      if (dy === null) return;
      const dx = await io.getDistance('Khoảng cách cột', { def: Math.round((b.maxX - b.minX) * 1.5) || 1000 });
      if (dx === null) return;
      io.print(ARRAY.run(ctx, { ids: s, rows, cols, dx, dy }).message!);
    }
  },
};

const anchor = (e: Entity): Vec => {
  const b = bbox(e);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
};
const rotPoint = (p: Vec, c: Vec, deg: number): Vec => {
  const a = deg2rad(deg);
  const d = sub(p, c);
  return [c[0] + d[0] * Math.cos(a) - d[1] * Math.sin(a), c[1] + d[0] * Math.sin(a) + d[1] * Math.cos(a)];
};
function bboxOf(ctx: Ctx, list: number[]): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const id of list) {
    const e = ctx.doc.get(id);
    if (!e) continue;
    const x = bbox(e);
    b.minX = Math.min(b.minX, x.minX);
    b.minY = Math.min(b.minY, x.minY);
    b.maxX = Math.max(b.maxX, x.maxX);
    b.maxY = Math.max(b.maxY, x.maxY);
  }
  return b;
}

// ---------- STRETCH ----------

const inBox = (p: Vec, b: BBox) => p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY;

/** Kéo giãn: điểm nằm trong khung được dời, phần ngoài giữ nguyên. */
export function stretchEnt(e: Entity, box: BBox, d: Vec): Entity | null {
  const mv = (p: Vec): Vec => (inBox(p, box) ? [p[0] + d[0], p[1] + d[1]] : p);
  const b = bbox(e);
  if (b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY) return moveEnt(e, d);
  switch (e.type) {
    case 'LINE':
      return inBox(e.a, box) || inBox(e.b, box) ? { ...e, a: mv(e.a), b: mv(e.b) } : null;
    case 'LWPOLYLINE':
      return e.pts.some((p) => inBox(p, box)) ? { ...e, pts: e.pts.map(mv) } : null;
    case 'DIMENSION':
      return e.pts.some((p) => inBox(p, box)) ? { ...e, pts: e.pts.map(mv) } : null;
    case 'ARC': {
      const s = polar(e.c, deg2rad(e.start), e.r);
      const en = polar(e.c, deg2rad(e.end), e.r);
      if (!inBox(s, box) && !inBox(en, box)) return null;
      // Giữ điểm giữa, dời đầu mút → cung qua 3 điểm mới.
      const m = polar(e.c, deg2rad(e.start + (normDeg(e.end - e.start) || 360) / 2), e.r);
      const p1 = mv(s);
      const p3 = mv(en);
      const c = circleThrough(p1, m, p3);
      if (!c) return null;
      return { ...e, c: c.c, r: c.r, start: normDeg(rad2deg(angleOf(sub(p1, c.c)))), end: normDeg(rad2deg(angleOf(sub(p3, c.c)))) };
    }
    case 'TEXT':
    case 'INSERT':
    case 'POINT':
    case 'XLINE':
      return inBox(e.p, box) ? moveEnt(e, d) : null;
    case 'CIRCLE':
      return inBox(e.c, box) ? moveEnt(e, d) : null;
    default:
      return null;
  }
}

function circleThrough(a: Vec, b: Vec, c: Vec): { c: Vec; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const o: Vec = [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
  return { c: o, r: dist(o, a) };
}

const STRETCH: CommandDef = {
  name: 'STRETCH',
  aliases: ['S'],
  desc: 'Kéo giãn: dời các điểm nằm trong khung chọn, giữ nguyên phần ngoài khung',
  params: [
    { name: 'p1', type: 'point', required: true, desc: 'Góc khung chọn' },
    { name: 'p2', type: 'point', required: true, desc: 'Góc đối diện' },
    { name: 'from', type: 'point', required: true, desc: 'Điểm gốc' },
    { name: 'to', type: 'point', required: true, desc: 'Điểm đích' },
  ],
  run(ctx, args) {
    const a = pt(args, 'p1');
    const b = pt(args, 'p2');
    const box = { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
    const d = sub(pt(args, 'to'), pt(args, 'from'));
    const out: number[] = [];
    for (const e of ctx.doc.visible()) {
      if (!ctx.doc.isEditable(e)) continue;
      const n = stretchEnt(e, box, d);
      if (n) {
        ctx.doc.update(n);
        out.push(e.id);
      }
    }
    return { ids: out, message: `Đã kéo giãn ${out.length} đối tượng` };
  },
  async interactive(ctx, io) {
    const a = await io.getPoint('Góc khung chọn (kéo phải → trái)');
    if (!Array.isArray(a)) return;
    const b = await io.getPoint('Góc đối diện', { base: a as Vec });
    if (!Array.isArray(b)) return;
    const f = await io.getPoint('Điểm gốc');
    if (!Array.isArray(f)) return;
    const box = { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
    const t = await io.getPoint('Điểm đích', {
      base: f as Vec,
      preview: (c) => {
        const d = sub(c, f as Vec);
        return ctx.doc
          .visible()
          .map((e) => stretchEnt(e, box, d))
          .filter((e): e is Entity => !!e)
          .map(({ id: _id, ...r }) => r as NewEntity);
      },
    });
    if (!Array.isArray(t)) return;
    io.print(STRETCH.run(ctx, { p1: a, p2: b, from: f, to: t }).message!);
  },
};

// ---------- ELLIPSE ----------

export function ellipsePts(c: Vec, rx: number, ry: number, rotDeg: number, n = 96): Vec[] {
  const r = deg2rad(rotDeg);
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return [c[0] + x * Math.cos(r) - y * Math.sin(r), c[1] + x * Math.sin(r) + y * Math.cos(r)] as Vec;
  });
}

const ELLIPSE: CommandDef = {
  name: 'ELLIPSE',
  aliases: ['EL'],
  desc: 'Vẽ elip (lưu dưới dạng đa tuyến kín nhiều đỉnh)',
  params: [
    { name: 'center', type: 'point', required: true, desc: 'Tâm' },
    { name: 'rx', type: 'number', required: true, desc: 'Bán trục thứ nhất' },
    { name: 'ry', type: 'number', required: true, desc: 'Bán trục thứ hai' },
    { name: 'rotation', type: 'number', desc: 'Góc của trục thứ nhất, độ' },
    ...COMMON,
  ],
  run(ctx, args: Args) {
    const rx = num(args, 'rx');
    const ry = num(args, 'ry');
    if (rx <= 0 || ry <= 0) throw new Error('Bán trục phải > 0');
    return created([
      ctx.doc.add({ type: 'LWPOLYLINE', pts: ellipsePts(pt(args, 'center'), rx, ry, num(args, 'rotation', 0)), closed: true, ...props(ctx, args) }),
    ]);
  },
  async interactive(ctx, io) {
    const c = await io.getPoint('Tâm elip');
    if (!Array.isArray(c)) return;
    const center = c as Vec;
    const a = await io.getPoint('Điểm cuối trục thứ nhất', {
      base: center,
      preview: (q) => [{ type: 'LWPOLYLINE', pts: ellipsePts(center, Math.max(dist(center, q), 1e-9), Math.max(dist(center, q), 1e-9) / 2, rad2deg(angleOf(sub(q, center)))), closed: true, layer: ctx.doc.currentLayer }],
    });
    if (!Array.isArray(a)) return;
    const rx = dist(center, a as Vec);
    const rot = rad2deg(angleOf(sub(a as Vec, center)));
    const ry = await io.getDistance('Bán trục thứ hai', {
      base: center,
      preview: (q) => [{ type: 'LWPOLYLINE', pts: ellipsePts(center, rx, Math.max(dist(center, q), 1e-9), rot), closed: true, layer: ctx.doc.currentLayer }],
    });
    if (!ry) return;
    ELLIPSE.run(ctx, { center, rx, ry, rotation: rot });
  },
};

// ---------- MLINE (tường 2 nét) ----------

/** Hai đường song song của MLINE theo căn lề: top (đường đi qua mép trên), zero (giữa), bottom. */
export function mlineEdges(points: Vec[], width: number, just: string, closed: boolean): [Vec[], Vec[]] {
  const [o1, o2] = just === 'top' ? [0, -width] : just === 'bottom' ? [width, 0] : [width / 2, -width / 2];
  const side = (o: number) => (Math.abs(o) < 1e-12 ? [...points] : offsetPolyline(points, closed, o));
  return [side(o1), side(o2)];
}

let mlWidth = 200;
let mlJust = 'zero';

const MLINE: CommandDef = {
  name: 'MLINE',
  aliases: ['ML', 'TUONG'],
  desc: 'Vẽ tường 2 nét: hai đa tuyến song song cách nhau "width", có nét bịt hai đầu',
  params: [
    { name: 'points', type: 'points', required: true, desc: 'Các điểm của đường định vị' },
    { name: 'width', type: 'number', desc: 'Bề dày (mặc định 200)' },
    { name: 'justification', type: 'string', desc: '"zero" (giữa, mặc định), "top" hoặc "bottom"' },
    { name: 'closed', type: 'boolean', desc: 'Khép kín' },
    ...COMMON,
  ],
  run(ctx, args) {
    const raw = args.points;
    if (!Array.isArray(raw) || raw.length < 2) throw new Error('"points" cần ít nhất 2 điểm');
    const p = raw.map((x, i) => toVec(x, `points[${i}]`));
    const w = num(args, 'width', mlWidth);
    if (w <= 0) throw new Error('Bề dày phải > 0');
    const just = (optStr(args, 'justification') ?? mlJust).toLowerCase();
    const closed = bool(args, 'closed', false);
    const [a, b] = mlineEdges(p, w, just, closed);
    const pr = props(ctx, args);
    const out: Entity[] = [
      ctx.doc.add({ type: 'LWPOLYLINE', pts: a, closed, ...pr }),
      ctx.doc.add({ type: 'LWPOLYLINE', pts: b, closed, ...pr }),
    ];
    if (!closed) {
      out.push(ctx.doc.add({ type: 'LINE', a: a[0], b: b[0], ...pr }));
      out.push(ctx.doc.add({ type: 'LINE', a: a[a.length - 1], b: b[b.length - 1], ...pr }));
    }
    return created(out);
  },
  async interactive(ctx, io) {
    io.print(`Bề dày ${mlWidth}, căn ${mlJust}`);
    const chain: Vec[] = [];
    for (;;) {
      const last = chain[chain.length - 1];
      const r = await io.getPoint(chain.length ? 'Điểm tiếp theo' : 'Điểm đầu', {
        base: last,
        allowNone: chain.length > 0,
        keywords: chain.length >= 3 ? ['Close', 'Undo'] : chain.length ? ['Undo'] : ['Width', 'Justification'],
        preview: (c) => {
          if (!chain.length) return [];
          const [a, b] = mlineEdges([...chain, c], mlWidth, mlJust, false);
          return [
            { type: 'LWPOLYLINE', pts: a, closed: false, layer: ctx.doc.currentLayer },
            { type: 'LWPOLYLINE', pts: b, closed: false, layer: ctx.doc.currentLayer },
          ];
        },
      });
      if (r === 'Width') {
        const v = await io.getDistance('Bề dày tường', { def: mlWidth });
        if (v && v > 0) mlWidth = v;
        continue;
      }
      if (r === 'Justification') {
        const v = await io.getPoint('Căn theo', { keywords: ['Top', 'Zero', 'Bottom'] });
        if (typeof v === 'string') mlJust = v.toLowerCase();
        continue;
      }
      if (r === 'Undo') {
        chain.pop();
        continue;
      }
      if (r === null || r === 'Close') {
        if (chain.length >= 2) MLINE.run(ctx, { points: chain, closed: r === 'Close' });
        return;
      }
      if (Array.isArray(r)) chain.push(r as Vec);
    }
  },
};

// ---------- Dán (Ctrl+V) ----------

const PASTE: CommandDef = {
  name: 'PASTECLIP',
  aliases: ['PASTE'],
  desc: 'Dán các đối tượng (dữ liệu từ Ctrl+C) dời từ điểm "from" tới "to"',
  params: [
    { name: 'data', type: 'string', required: true, desc: 'JSON {"ents": [...], "blocks": [...]} như khi sao chép' },
    { name: 'from', type: 'point', required: true, desc: 'Điểm gốc của dữ liệu' },
    { name: 'to', type: 'point', required: true, desc: 'Điểm dán' },
  ],
  run(ctx, args) {
    const d = (typeof args.data === 'string' ? JSON.parse(args.data) : args.data) as { ents: NewEntity[]; blocks?: BlockDef[] };
    if (!d || !Array.isArray(d.ents)) throw new Error('Dữ liệu dán không hợp lệ');
    for (const b of d.blocks ?? []) if (!ctx.doc.blocks.has(b.name)) ctx.doc.setBlock(b);
    const delta = sub(pt(args, 'to'), pt(args, 'from'));
    const out = d.ents.map((e) => ctx.doc.add(moveEnt(e, delta)));
    return created(out, `Đã dán ${out.length} đối tượng`);
  },
};

export const EDIT_COMMANDS: CommandDef[] = [SETPROP, ARRAY, STRETCH, ELLIPSE, MLINE, PASTE];
