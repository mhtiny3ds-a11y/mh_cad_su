// Lệnh vẽ bổ sung và ghi chú: POLYGON, AREA, kích thước (DIM*), DIMSTYLE, BLOCK, INSERT, LTSCALE.

import { type Vec, EPS, add, angleOf, cross, deg2rad, dist, mul, polar, rad2deg, sub } from '../geom';
import { type DimEnt, type DimKind, type Entity, type NewEntity, fmtNum, polyArea, polyLength } from '../entities';
import { dimText } from '../dim';
import {
  type Args,
  type CommandDef,
  type Ctx,
  COMMON,
  bool,
  created,
  ids,
  num,
  pickSelection,
  props,
  pt,
  pts,
  str,
} from '../commands';

// ---------- POLYGON / AREA ----------

const POLYGON: CommandDef = {
  name: 'POLYGON',
  aliases: ['POL'],
  desc: 'Vẽ đa giác đều (đa tuyến kín)',
  params: [
    { name: 'center', type: 'point', required: true, desc: 'Tâm' },
    { name: 'sides', type: 'number', required: true, desc: 'Số cạnh (3–1024)' },
    { name: 'radius', type: 'number', required: true, desc: 'Bán kính' },
    { name: 'inscribed', type: 'boolean', desc: 'true = nội tiếp (đỉnh nằm trên đường tròn, mặc định); false = ngoại tiếp' },
    { name: 'rotation', type: 'number', desc: 'Góc của đỉnh (nội tiếp) / trung điểm cạnh (ngoại tiếp) đầu tiên, độ (mặc định 90)' },
    ...COMMON,
  ],
  run(ctx, args) {
    const c = pt(args, 'center');
    const n = Math.round(num(args, 'sides'));
    if (n < 3 || n > 1024) throw new Error('Số cạnh từ 3 tới 1024');
    const r = num(args, 'radius');
    if (r <= 0) throw new Error('Bán kính phải > 0');
    const ins = bool(args, 'inscribed', true);
    const rot = deg2rad(num(args, 'rotation', 90));
    const R = ins ? r : r / Math.cos(Math.PI / n);
    const a0 = ins ? rot : rot + Math.PI / n;
    const p: Vec[] = [];
    for (let i = 0; i < n; i++) p.push(polar(c, a0 + (2 * Math.PI * i) / n, R));
    return created([ctx.doc.add({ type: 'LWPOLYLINE', pts: p, closed: true, ...props(ctx, args) })]);
  },
  async interactive(ctx, io) {
    const n = await io.getDistance('Số cạnh', { def: lastSides });
    if (n === null || n < 3) return;
    lastSides = Math.round(n);
    const c = await io.getPoint('Tâm đa giác');
    if (!Array.isArray(c)) return;
    const k = await io.getPoint('Kiểu', { allowNone: true, keywords: ['Inscribed', 'Circumscribed'] });
    const inscribed = k !== 'Circumscribed';
    const center = c as Vec;
    const preview = (q: Vec): NewEntity[] => {
      const r = dist(center, q);
      if (r < EPS) return [];
      const rot = rad2deg(angleOf(sub(q, center))) - (inscribed ? 0 : 180 / lastSides);
      const R = inscribed ? r : r / Math.cos(Math.PI / lastSides);
      const a0 = deg2rad(inscribed ? rot : rot + 180 / lastSides);
      const p: Vec[] = [];
      for (let i = 0; i < lastSides; i++) p.push(polar(center, a0 + (2 * Math.PI * i) / lastSides, R));
      return [{ type: 'LWPOLYLINE', pts: p, closed: true, layer: ctx.doc.currentLayer }];
    };
    const q = await io.getPoint('Bán kính (bấm điểm hoặc gõ số)', { base: center, preview });
    if (!Array.isArray(q)) return;
    const r = dist(center, q as Vec);
    const rot = rad2deg(angleOf(sub(q as Vec, center))) - (inscribed ? 0 : 180 / lastSides);
    POLYGON.run(ctx, { center, sides: lastSides, radius: r, inscribed, rotation: rot });
  },
};
let lastSides = 4;

const AREA: CommandDef = {
  name: 'AREA',
  aliases: ['AA'],
  readonly: true,
  desc: 'Tính diện tích và chu vi: theo các điểm, hoặc theo đối tượng kín (đa tuyến kín, đường tròn)',
  params: [
    { name: 'points', type: 'points', desc: 'Các đỉnh của vùng cần tính' },
    { name: 'ids', type: 'ids', desc: 'Hoặc: các đối tượng kín (cộng dồn)' },
  ],
  run(ctx, args) {
    let area = 0;
    let perim = 0;
    if (Array.isArray(args.points)) {
      const p = pts(args, 'points', 3);
      area = polyArea(p);
      perim = polyLength({ pts: p, closed: true });
    } else {
      for (const e of ids(ctx, { ...args })) {
        if (e.type === 'CIRCLE') {
          area += Math.PI * e.r * e.r;
          perim += 2 * Math.PI * e.r;
        } else if (e.type === 'LWPOLYLINE') {
          area += polyArea(e.pts);
          perim += polyLength(e);
        } else throw new Error(`Đối tượng #${e.id} (${e.type}) không phải vùng kín`);
      }
    }
    const u = ctx.doc.units;
    const m2 = u === 'mm' ? area / 1e6 : u === 'cm' ? area / 1e4 : u === 'm' ? area : null;
    return {
      area,
      perimeter: perim,
      message: `Diện tích = ${fmtNum(area)}${m2 !== null && u !== 'm' ? ` (${fmtNum(m2)} m²)` : u === 'm' ? ' m²' : ''} · Chu vi = ${fmtNum(perim)}`,
    };
  },
  async interactive(ctx, io) {
    const first = await io.getPoint('Điểm đầu tiên [Object]', { keywords: ['Object'] });
    if (first === 'Object') {
      const h = await io.getEntity('Chọn đối tượng kín');
      if (h && typeof h !== 'string') io.print(AREA.run(ctx, { ids: [h.id] }).message!);
      return;
    }
    if (!Array.isArray(first)) return;
    const p: Vec[] = [first as Vec];
    for (;;) {
      const q = await io.getPoint('Điểm tiếp theo (Enter để tính)', {
        base: p[p.length - 1],
        allowNone: true,
        preview: (c) => [{ type: 'LWPOLYLINE', pts: [...p, c], closed: true, layer: ctx.doc.currentLayer }],
      });
      if (!Array.isArray(q)) break;
      p.push(q as Vec);
    }
    if (p.length >= 3) io.print(AREA.run(ctx, { points: p }).message!);
  },
};

// ---------- Kích thước ----------

let lastDimId: number | null = null;

function addDim(ctx: Ctx, args: Args, kind: DimKind, p: Vec[], rot?: number): Entity {
  const d: Omit<DimEnt, 'id'> = {
    type: 'DIMENSION',
    kind,
    pts: p,
    ...(rot !== undefined ? { rot } : {}),
    ...(args.text != null && args.text !== '' ? { text: String(args.text) } : {}),
    style: { ...ctx.doc.dimStyle },
    ...props(ctx, args),
  };
  const e = ctx.doc.add(d);
  lastDimId = e.id;
  return e;
}

/** Hướng mặc định của kích thước theo phương ngang/đứng dựa trên vị trí đặt. */
export function autoLinearRot(p1: Vec, p2: Vec, loc: Vec): number {
  const minX = Math.min(p1[0], p2[0]);
  const maxX = Math.max(p1[0], p2[0]);
  const minY = Math.min(p1[1], p2[1]);
  const maxY = Math.max(p1[1], p2[1]);
  const outY = loc[1] < minY || loc[1] > maxY;
  const outX = loc[0] < minX || loc[0] > maxX;
  if (outY && !outX) return 0;
  if (outX && !outY) return 90;
  return Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]) ? 0 : 90;
}

const DIM_COMMON = [
  { name: 'text', type: 'string' as const, desc: 'Ghi đè chữ; "<>" là giá trị đo (ví dụ "<> mm")' },
  ...COMMON,
];

function dimPreview(ctx: Ctx, kind: DimKind, p: Vec[], rot?: (loc: Vec) => number | undefined) {
  return (c: Vec): NewEntity[] => [
    {
      type: 'DIMENSION',
      kind,
      pts: [...p, c],
      ...(rot ? { rot: rot(c) } : {}),
      style: { ...ctx.doc.dimStyle },
      layer: ctx.doc.currentLayer,
    } as NewEntity,
  ];
}

const DIMLINEAR: CommandDef = {
  name: 'DIMLINEAR',
  aliases: ['DLI', 'DIMLIN'],
  desc: 'Kích thước ngang / đứng (hoặc theo góc rotation) giữa hai điểm',
  params: [
    { name: 'p1', type: 'point', required: true, desc: 'Gốc đường dóng 1' },
    { name: 'p2', type: 'point', required: true, desc: 'Gốc đường dóng 2' },
    { name: 'location', type: 'point', required: true, desc: 'Một điểm mà đường kích thước đi qua' },
    { name: 'rotation', type: 'number', desc: 'Góc đường kích thước: 0 = ngang, 90 = đứng (mặc định: tự chọn theo vị trí)' },
    ...DIM_COMMON,
  ],
  run(ctx, args) {
    const p1 = pt(args, 'p1');
    const p2 = pt(args, 'p2');
    const loc = pt(args, 'location');
    const rot = args.rotation != null ? num(args, 'rotation') : autoLinearRot(p1, p2, loc);
    const e = addDim(ctx, args, 'linear', [p1, p2, loc], rot);
    return { ids: [e.id], message: `Kích thước = ${dimText(e as DimEnt)}` };
  },
  async interactive(ctx, io) {
    const a = await io.getPoint('Gốc đường dóng thứ nhất (Enter = chọn đối tượng)', { allowNone: true });
    let p1: Vec, p2: Vec;
    if (a === null) {
      const h = await io.getEntity('Chọn đoạn thẳng cần ghi kích thước');
      if (!h || typeof h === 'string') return;
      const e = ctx.doc.get(h.id);
      if (e?.type !== 'LINE') return io.print('Cần chọn một LINE');
      [p1, p2] = [e.a, e.b];
    } else {
      if (!Array.isArray(a)) return;
      p1 = a as Vec;
      const b = await io.getPoint('Gốc đường dóng thứ hai', { base: p1 });
      if (!Array.isArray(b)) return;
      p2 = b as Vec;
    }
    const loc = await io.getPoint('Vị trí đường kích thước', {
      preview: dimPreview(ctx, 'linear', [p1, p2], (c) => autoLinearRot(p1, p2, c)),
    });
    if (!Array.isArray(loc)) return;
    io.print(DIMLINEAR.run(ctx, { p1, p2, location: loc }).message!);
  },
};

const DIMALIGNED: CommandDef = {
  name: 'DIMALIGNED',
  aliases: ['DAL', 'DIMALI'],
  desc: 'Kích thước song song với đoạn nối hai điểm',
  params: [
    { name: 'p1', type: 'point', required: true, desc: 'Điểm 1' },
    { name: 'p2', type: 'point', required: true, desc: 'Điểm 2' },
    { name: 'location', type: 'point', required: true, desc: 'Một điểm mà đường kích thước đi qua' },
    ...DIM_COMMON,
  ],
  run(ctx, args) {
    const e = addDim(ctx, args, 'aligned', [pt(args, 'p1'), pt(args, 'p2'), pt(args, 'location')]);
    return { ids: [e.id], message: `Kích thước = ${dimText(e as DimEnt)}` };
  },
  async interactive(ctx, io) {
    const a = await io.getPoint('Điểm thứ nhất');
    if (!Array.isArray(a)) return;
    const b = await io.getPoint('Điểm thứ hai', { base: a as Vec });
    if (!Array.isArray(b)) return;
    const loc = await io.getPoint('Vị trí đường kích thước', { preview: dimPreview(ctx, 'aligned', [a as Vec, b as Vec]) });
    if (!Array.isArray(loc)) return;
    io.print(DIMALIGNED.run(ctx, { p1: a, p2: b, location: loc }).message!);
  },
};

function circleOf(ctx: Ctx, id: unknown): { c: Vec; r: number } {
  const e = ctx.doc.get(Number(id));
  if (!e || (e.type !== 'CIRCLE' && e.type !== 'ARC')) throw new Error('Cần chọn một CIRCLE hoặc ARC');
  return { c: e.c, r: e.r };
}

function radialCmd(kind: 'radius' | 'diameter'): CommandDef {
  const def: CommandDef = {
    name: kind === 'radius' ? 'DIMRADIUS' : 'DIMDIAMETER',
    aliases: kind === 'radius' ? ['DRA', 'DIMRAD'] : ['DDI', 'DIMDIA'],
    desc: kind === 'radius' ? 'Kích thước bán kính của đường tròn / cung' : 'Kích thước đường kính của đường tròn / cung',
    params: [
      { name: 'id', type: 'number', required: true, desc: 'CIRCLE hoặc ARC' },
      { name: 'angle', type: 'number', desc: 'Hướng đặt kích thước, độ (mặc định 45)' },
      ...DIM_COMMON,
    ],
    run(ctx, args) {
      const { c, r } = circleOf(ctx, args.id);
      const a = deg2rad(num(args, 'angle', 45));
      const p = kind === 'radius' ? [c, polar(c, a, r)] : [polar(c, a + Math.PI, r), polar(c, a, r)];
      const e = addDim(ctx, args, kind, p);
      return { ids: [e.id], message: `Kích thước = ${dimText(e as DimEnt)}` };
    },
    async interactive(ctx, io) {
      const h = await io.getEntity('Chọn đường tròn hoặc cung');
      if (!h || typeof h === 'string') return;
      const { c, r } = circleOf(ctx, h.id);
      const pv = (q: Vec): NewEntity[] => {
        const a = angleOf(sub(q, c));
        return dimPreview(ctx, kind, kind === 'radius' ? [c] : [polar(c, a + Math.PI, r)])(polar(c, a, r));
      };
      const q = await io.getPoint('Vị trí kích thước', { preview: pv });
      if (!Array.isArray(q)) return;
      io.print(def.run(ctx, { id: h.id, angle: rad2deg(angleOf(sub(q as Vec, c))) }).message!);
    },
  };
  return def;
}

function lineIntersection(a1: Vec, a2: Vec, b1: Vec, b2: Vec): Vec | null {
  const d1 = sub(a2, a1);
  const d2 = sub(b2, b1);
  const den = cross(d1, d2);
  if (Math.abs(den) < EPS) return null;
  return add(a1, mul(d1, cross(sub(b1, a1), d2) / den));
}

const DIMANGULAR: CommandDef = {
  name: 'DIMANGULAR',
  aliases: ['DAN', 'DIMANG'],
  desc: 'Kích thước góc giữa hai đường thẳng (hoặc theo đỉnh và hai điểm)',
  params: [
    { name: 'id1', type: 'number', desc: 'LINE thứ nhất' },
    { name: 'id2', type: 'number', desc: 'LINE thứ hai' },
    { name: 'center', type: 'point', desc: 'Hoặc: đỉnh góc' },
    { name: 'p1', type: 'point', desc: 'Điểm trên cạnh 1' },
    { name: 'p2', type: 'point', desc: 'Điểm trên cạnh 2' },
    { name: 'location', type: 'point', required: true, desc: 'Vị trí cung kích thước (chọn phần góc chứa điểm này)' },
    ...DIM_COMMON,
  ],
  run(ctx, args) {
    let c: Vec, q1: Vec, q2: Vec;
    const loc = pt(args, 'location');
    if (args.id1 !== undefined) {
      const l1 = ctx.doc.get(Number(args.id1));
      const l2 = ctx.doc.get(Number(args.id2));
      if (l1?.type !== 'LINE' || l2?.type !== 'LINE') throw new Error('Cần hai LINE');
      const x = lineIntersection(l1.a, l1.b, l2.a, l2.b);
      if (!x) throw new Error('Hai đường thẳng song song');
      c = x;
      // Lấy đầu mút xa đỉnh hơn làm điểm trên cạnh, đảo hướng nếu vị trí đặt nằm phía bên kia.
      const far = (l: typeof l1) => (dist(l.a, x) > dist(l.b, x) ? l.a : l.b);
      q1 = far(l1);
      q2 = far(l2);
      const s1 = Math.sign(cross(sub(q1, c), sub(loc, c)));
      const s2 = Math.sign(cross(sub(loc, c), sub(q2, c)));
      if (s1 < 0 && s2 < 0) {
        q1 = add(c, sub(c, q1));
        q2 = add(c, sub(c, q2));
      }
    } else {
      c = pt(args, 'center');
      q1 = pt(args, 'p1');
      q2 = pt(args, 'p2');
    }
    const e = addDim(ctx, args, 'angular', [c, q1, q2, loc]);
    return { ids: [e.id], message: `Góc = ${dimText(e as DimEnt)}` };
  },
  async interactive(ctx, io) {
    const h1 = await io.getEntity('Chọn đường thẳng thứ nhất');
    if (!h1 || typeof h1 === 'string') return;
    const h2 = await io.getEntity('Chọn đường thẳng thứ hai');
    if (!h2 || typeof h2 === 'string') return;
    const l1 = ctx.doc.get(h1.id);
    const l2 = ctx.doc.get(h2.id);
    if (l1?.type !== 'LINE' || l2?.type !== 'LINE') return io.print('Cần chọn hai LINE');
    const x = lineIntersection(l1.a, l1.b, l2.a, l2.b);
    if (!x) return io.print('Hai đường thẳng song song');
    const loc = await io.getPoint('Vị trí cung kích thước', {
      preview: (cur) => dimPreview(ctx, 'angular', [x, h1.p, h2.p])(cur),
    });
    if (!Array.isArray(loc)) return;
    io.print(DIMANGULAR.run(ctx, { center: x, p1: h1.p, p2: h2.p, location: loc }).message!);
  },
};

const DIMCONTINUE: CommandDef = {
  name: 'DIMCONTINUE',
  aliases: ['DCO', 'DIMCONT'],
  desc: 'Ghi kích thước nối tiếp từ một kích thước ngang/đứng/song song có sẵn',
  params: [
    { name: 'base', type: 'number', desc: 'Kích thước gốc (mặc định: kích thước vừa tạo)' },
    { name: 'points', type: 'points', required: true, desc: 'Các gốc đường dóng tiếp theo' },
  ],
  run(ctx, args) {
    const baseId = args.base != null ? Number(args.base) : lastDimId;
    const b = baseId != null ? ctx.doc.get(baseId) : undefined;
    if (b?.type !== 'DIMENSION' || (b.kind !== 'linear' && b.kind !== 'aligned'))
      throw new Error('Cần một kích thước ngang/đứng/song song làm gốc');
    let prev = b.pts[1];
    let line = b;
    const out: Entity[] = [];
    for (const q of pts(args, 'points', 1)) {
      // Giữ nguyên đường kích thước: dời điểm đặt theo đường của kích thước trước.
      const off = sub(line.pts[2], line.pts[1]);
      const loc = add(q, off);
      const e = ctx.doc.add({
        type: 'DIMENSION',
        kind: line.kind,
        pts: [prev, q, line.kind === 'linear' ? projectLoc(line, q) : loc],
        ...(line.rot !== undefined ? { rot: line.rot } : {}),
        style: { ...line.style },
        layer: line.layer,
        ...(line.color !== undefined ? { color: line.color } : {}),
      });
      out.push(e);
      prev = q;
      line = e as DimEnt;
      lastDimId = e.id;
    }
    return created(out);
  },
  async interactive(ctx, io) {
    if (lastDimId == null || ctx.doc.get(lastDimId)?.type !== 'DIMENSION') {
      const h = await io.getEntity('Chọn kích thước gốc');
      if (!h || typeof h === 'string') return;
      lastDimId = h.id;
    }
    for (;;) {
      const b = ctx.doc.get(lastDimId!) as DimEnt | undefined;
      if (!b) return;
      const q = await io.getPoint('Gốc đường dóng tiếp theo (Enter để kết thúc)', {
        allowNone: true,
        preview: (c) => [
          {
            type: 'DIMENSION',
            kind: b.kind,
            pts: [b.pts[1], c, b.kind === 'linear' ? projectLoc(b, c) : add(c, sub(b.pts[2], b.pts[1]))],
            ...(b.rot !== undefined ? { rot: b.rot } : {}),
            style: b.style,
            layer: b.layer,
          } as NewEntity,
        ],
      });
      if (!Array.isArray(q)) return;
      DIMCONTINUE.run(ctx, { base: lastDimId, points: [q] });
    }
  },
};

/** Điểm đặt sao cho kích thước mới nằm trên cùng đường kích thước với kích thước b. */
function projectLoc(b: DimEnt, q: Vec): Vec {
  const a = deg2rad(b.rot ?? 0);
  const u: Vec = [Math.cos(a), Math.sin(a)];
  const n: Vec = [-u[1], u[0]];
  const off = (b.pts[2][0] - b.pts[0][0]) * n[0] + (b.pts[2][1] - b.pts[0][1]) * n[1];
  const qOff = (q[0] - b.pts[0][0]) * n[0] + (q[1] - b.pts[0][1]) * n[1];
  return add(q, mul(n, off - qOff));
}

const DIMSTYLE: CommandDef = {
  name: 'DIMSTYLE',
  aliases: ['D', 'DST', 'DDIM'],
  desc: 'Chỉnh kiểu kích thước cho các kích thước tạo mới (chiều cao chữ, mũi tên, khoảng hở, số lẻ)',
  params: [
    { name: 'scale', type: 'number', desc: 'Nhân mọi kích cỡ với hệ số này (ví dụ bản vẽ tỉ lệ 1:50 → 0.5 so với 1:100)' },
    { name: 'txt', type: 'number', desc: 'Chiều cao chữ' },
    { name: 'asz', type: 'number', desc: 'Độ dài mũi tên' },
    { name: 'exo', type: 'number', desc: 'Khoảng hở từ đối tượng tới đường dóng' },
    { name: 'exe', type: 'number', desc: 'Đường dóng vượt quá đường kích thước' },
    { name: 'gap', type: 'number', desc: 'Khoảng cách chữ tới đường kích thước' },
    { name: 'dec', type: 'number', desc: 'Số chữ số thập phân' },
    { name: 'applyTo', type: 'ids', desc: 'Áp dụng luôn cho các kích thước này' },
  ],
  run(ctx, args) {
    const s = { ...ctx.doc.dimStyle };
    const k = args.scale != null ? num(args, 'scale') : 1;
    if (k <= 0) throw new Error('Hệ số phải > 0');
    for (const key of ['txt', 'asz', 'exo', 'exe', 'gap'] as const) {
      s[key] = args[key] != null ? num(args, key) : s[key] * k;
      if (s[key] < 0) throw new Error(`${key} phải ≥ 0`);
    }
    if (args.dec != null) s.dec = Math.max(0, Math.min(8, Math.round(num(args, 'dec'))));
    ctx.doc.setDimStyle(s);
    if (Array.isArray(args.applyTo))
      for (const e of ids(ctx, { ids: args.applyTo })) if (e.type === 'DIMENSION') ctx.doc.update({ ...e, style: { ...s } });
    return { style: s, message: `Kiểu kích thước: chữ ${fmtNum(s.txt)}, mũi tên ${fmtNum(s.asz)}, số lẻ ${s.dec}` };
  },
  async interactive(ctx, io) {
    const s = ctx.doc.dimStyle;
    io.print(`Hiện tại: chữ ${s.txt}, mũi tên ${s.asz}, hở ${s.exo}, vượt ${s.exe}, cách chữ ${s.gap}, số lẻ ${s.dec}`);
    const k = await io.getPoint('Chỉnh', { keywords: ['Scale', 'Text', 'Arrow', 'Decimals'] });
    if (k === 'Scale') {
      const v = await io.getDistance('Hệ số nhân', { def: 1 });
      if (v) io.print(DIMSTYLE.run(ctx, { scale: v }).message!);
    } else if (k === 'Text') {
      const v = await io.getDistance('Chiều cao chữ', { def: s.txt });
      if (v) io.print(DIMSTYLE.run(ctx, { txt: v }).message!);
    } else if (k === 'Arrow') {
      const v = await io.getDistance('Độ dài mũi tên', { def: s.asz });
      if (v) io.print(DIMSTYLE.run(ctx, { asz: v }).message!);
    } else if (k === 'Decimals') {
      const v = await io.getDistance('Số chữ số thập phân', { def: s.dec });
      if (v !== null) io.print(DIMSTYLE.run(ctx, { dec: v }).message!);
    }
  },
};

// ---------- Block ----------

const BLOCK: CommandDef = {
  name: 'BLOCK',
  aliases: ['B'],
  desc: 'Tạo block từ các đối tượng đã chọn và thay chúng bằng một INSERT',
  params: [
    { name: 'name', type: 'string', required: true, desc: 'Tên block' },
    { name: 'base', type: 'point', required: true, desc: 'Điểm gốc của block' },
    { name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng đưa vào block' },
    { name: 'keep', type: 'boolean', desc: 'true = giữ nguyên đối tượng gốc, không thay bằng INSERT' },
  ],
  run(ctx, args) {
    const name = str(args, 'name').trim();
    if (!/^[^<>/\\":;?*|=`]{1,255}$/.test(name)) throw new Error('Tên block không hợp lệ');
    if (ctx.doc.blocks.has(name)) throw new Error(`Block "${name}" đã có`);
    const base = pt(args, 'base');
    const list = ids(ctx, args);
    ctx.doc.setBlock({ name, base, ents: list.map(({ id: _id, ...rest }) => rest as NewEntity) });
    if (bool(args, 'keep', false)) return { name, message: `Đã tạo block "${name}" (${list.length} đối tượng)` };
    for (const e of list) ctx.doc.remove(e.id);
    ctx.selection.clear();
    const ins = ctx.doc.add({ type: 'INSERT', name, p: base, sx: 1, sy: 1, rot: 0, layer: ctx.doc.currentLayer });
    return { ids: [ins.id], name, message: `Đã tạo block "${name}" (${list.length} đối tượng)` };
  },
  async interactive(ctx, io) {
    const s = await pickSelection(ctx, io);
    if (!s.length) return;
    const name = await io.getString('Tên block', { spaces: true });
    if (!name) return;
    const b = await io.getPoint('Điểm gốc');
    if (!Array.isArray(b)) return;
    io.print(BLOCK.run(ctx, { name, base: b, ids: s }).message!);
  },
};

const INSERT: CommandDef = {
  name: 'INSERT',
  aliases: ['I'],
  desc: 'Chèn block vào bản vẽ',
  params: [
    { name: 'name', type: 'string', required: true, desc: 'Tên block (xem query.blocks())' },
    { name: 'position', type: 'point', required: true, desc: 'Điểm chèn' },
    { name: 'scale', type: 'number', desc: 'Tỉ lệ (mặc định 1)' },
    { name: 'rotation', type: 'number', desc: 'Góc xoay, độ (mặc định 0)' },
    ...COMMON,
  ],
  run(ctx, args) {
    const name = str(args, 'name');
    if (!ctx.doc.blocks.has(name)) throw new Error(`Không có block "${name}"`);
    const k = num(args, 'scale', 1);
    if (k === 0) throw new Error('Tỉ lệ phải khác 0');
    const e = ctx.doc.add({ type: 'INSERT', name, p: pt(args, 'position'), sx: k, sy: k, rot: num(args, 'rotation', 0), ...props(ctx, args) });
    return created([e]);
  },
  async interactive(ctx, io) {
    const names = [...ctx.doc.blocks.keys()];
    if (!names.length) return io.print('Bản vẽ chưa có block nào (tạo bằng lệnh BLOCK)');
    io.print(`Các block: ${names.slice(0, 40).join(', ')}${names.length > 40 ? '…' : ''}`);
    const name = await io.getString('Tên block', { spaces: true, def: names[0] });
    if (!name || !ctx.doc.blocks.has(name)) return io.print(`Không có block "${name}"`);
    const p = await io.getPoint('Điểm chèn', {
      preview: (c) => [{ type: 'INSERT', name, p: c, sx: 1, sy: 1, rot: 0, layer: ctx.doc.currentLayer }],
    });
    if (!Array.isArray(p)) return;
    INSERT.run(ctx, { name, position: p });
  },
};

const LTSCALE: CommandDef = {
  name: 'LTSCALE',
  aliases: ['LTS'],
  desc: 'Hệ số tỉ lệ chung cho kiểu đường (nét đứt, nét chấm gạch)',
  params: [{ name: 'value', type: 'number', required: true, desc: 'Hệ số (> 0)' }],
  run(ctx, args) {
    ctx.doc.setLtscale(num(args, 'value'));
    return { message: `LTSCALE = ${ctx.doc.ltscale}` };
  },
  async interactive(ctx, io) {
    const v = await io.getDistance('Hệ số tỉ lệ kiểu đường', { def: ctx.doc.ltscale });
    if (v) io.print(LTSCALE.run(ctx, { value: v }).message!);
  },
};

export const ANNOTATE_COMMANDS: CommandDef[] = [
  POLYGON,
  AREA,
  DIMLINEAR,
  DIMALIGNED,
  radialCmd('radius'),
  radialCmd('diameter'),
  DIMANGULAR,
  DIMCONTINUE,
  DIMSTYLE,
  BLOCK,
  INSERT,
  LTSCALE,
];
