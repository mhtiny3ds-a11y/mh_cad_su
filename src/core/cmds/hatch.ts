// Lệnh HATCH, BOUNDARY, POINT.

import { type Vec, deg2rad, polar } from '../geom';
import { type Entity, type NewEntity, bbox, expand, normDeg, pointInPolygon, polySegments } from '../entities';
import { PATTERNS, findBoundary, patternLines } from '../hatch';
import { type CommandDef, type Ctx, COMMON, bool, created, ids, num, optStr, props, pt, pts } from '../commands';

/** Chia mọi đối tượng (trừ chữ, tô) thành đoạn thẳng để dò biên. */
function boundarySegments(ents: Entity[]): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  const add = (e: NewEntity) => {
    switch (e.type) {
      case 'LINE':
        out.push([e.a, e.b]);
        break;
      case 'LWPOLYLINE':
        if (!e.fill) out.push(...polySegments(e));
        break;
      case 'CIRCLE':
      case 'ARC': {
        const s = e.type === 'ARC' ? e.start : 0;
        const sweep = e.type === 'ARC' ? normDeg(e.end - e.start) || 360 : 360;
        const n = Math.max(8, Math.ceil(sweep / 5));
        let prev = polar(e.c, deg2rad(s), e.r);
        for (let i = 1; i <= n; i++) {
          const q = polar(e.c, deg2rad(s + (sweep * i) / n), e.r);
          out.push([prev, q]);
          prev = q;
        }
        break;
      }
      case 'INSERT':
      case 'DIMENSION':
        for (const x of expand(e)) add(x);
        break;
    }
  };
  for (const e of ents) add(e);
  return out;
}

/** Vòng kín của một đối tượng (đa tuyến kín, đường tròn). */
function closedLoop(e: Entity): Vec[] | null {
  if (e.type === 'LWPOLYLINE' && (e.closed || (e.pts.length > 2 && e.pts[0][0] === e.pts[e.pts.length - 1][0] && e.pts[0][1] === e.pts[e.pts.length - 1][1])))
    return e.closed ? [...e.pts] : e.pts.slice(0, -1);
  if (e.type === 'CIRCLE') {
    const n = 72;
    return Array.from({ length: n }, (_, i) => polar(e.c, (2 * Math.PI * i) / n, e.r));
  }
  return null;
}

/** Tìm vùng kín chứa điểm p (kèm các đảo bên trong). */
export function detectRegion(ctx: Ctx, p: Vec, islands = true): Vec[][] | null {
  const ents = ctx.doc.visible().filter((e) => e.type !== 'TEXT' && e.type !== 'HATCH' && e.type !== 'POINT');
  const ext = ctx.doc.extents();
  const tol = 1e-7 * Math.max(1, ext ? Math.max(ext.maxX - ext.minX, ext.maxY - ext.minY) : 1);
  const outer = findBoundary(boundarySegments(ents), p, tol);
  if (!outer) return null;
  const loops = [outer];
  if (islands) {
    const ob = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const q of outer) {
      ob.minX = Math.min(ob.minX, q[0]);
      ob.minY = Math.min(ob.minY, q[1]);
      ob.maxX = Math.max(ob.maxX, q[0]);
      ob.maxY = Math.max(ob.maxY, q[1]);
    }
    for (const e of ents) {
      const l = closedLoop(e);
      if (!l) continue;
      const b = bbox(e);
      if (b.minX < ob.minX || b.maxX > ob.maxX || b.minY < ob.minY || b.maxY > ob.maxY) continue;
      if (pointInPolygon(p, l)) continue;
      if (l.every((q) => pointInPolygon(q, outer)) && !sameLoop(l, outer)) loops.push(l);
    }
  }
  return loops;
}

const sameLoop = (a: Vec[], b: Vec[]) =>
  a.length === b.length && a.every((p) => b.some((q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9));

let lastPattern = 'LINE45';
let lastScale: number | null = null;
let lastAngle = 0;

const HATCH: CommandDef = {
  name: 'HATCH',
  aliases: ['H', 'BH', 'BHATCH'],
  desc: `Tô vật liệu cho vùng kín. Mẫu: ${Object.keys(PATTERNS).join(', ')}`,
  params: [
    { name: 'pick', type: 'point', desc: 'Một điểm bên trong vùng (tự dò biên)' },
    { name: 'ids', type: 'ids', desc: 'Hoặc: các đối tượng kín (đa tuyến kín, đường tròn) làm biên' },
    { name: 'points', type: 'points', desc: 'Hoặc: các đỉnh của đa giác biên' },
    { name: 'pattern', type: 'string', desc: 'Tên mẫu (mặc định LINE45)' },
    { name: 'scale', type: 'number', desc: 'Tỉ lệ mẫu (mặc định = LTSCALE)' },
    { name: 'angle', type: 'number', desc: 'Góc xoay mẫu, độ (mặc định 0)' },
    { name: 'islands', type: 'boolean', desc: 'Tự nhận đảo bên trong (mặc định có)' },
    ...COMMON,
  ],
  run(ctx, args) {
    let loops: Vec[][];
    if (args.pick !== undefined) {
      const r = detectRegion(ctx, pt(args, 'pick'), bool(args, 'islands', true));
      if (!r) throw new Error('Không tìm thấy vùng kín quanh điểm đã chọn');
      loops = r;
    } else if (Array.isArray(args.ids)) {
      loops = ids(ctx, args).map((e) => {
        const l = closedLoop(e);
        if (!l) throw new Error(`Đối tượng #${e.id} không kín`);
        return l;
      });
    } else if (Array.isArray(args.points)) loops = [pts(args, 'points', 3)];
    else throw new Error('Cần "pick", "ids" hoặc "points"');
    const pattern = (optStr(args, 'pattern') ?? 'LINE45').toUpperCase();
    if (!PATTERNS[pattern]) throw new Error(`Không có mẫu "${pattern}". Các mẫu: ${Object.keys(PATTERNS).join(', ')}`);
    const scale = num(args, 'scale', ctx.doc.ltscale);
    if (scale <= 0) throw new Error('Tỉ lệ phải > 0');
    const angle = num(args, 'angle', 0);
    const e = ctx.doc.add({
      type: 'HATCH',
      loops,
      solid: pattern === 'SOLID',
      pattern,
      scale,
      angle,
      lines: patternLines(pattern, scale, angle),
      ...props(ctx, args),
    });
    return created([e]);
  },
  async interactive(ctx, io) {
    for (;;) {
      const scale = lastScale ?? ctx.doc.ltscale;
      const r = await io.getPoint(`Bấm vào bên trong vùng (mẫu ${lastPattern}, tỉ lệ ${scale}, góc ${lastAngle})`, {
        allowNone: true,
        keywords: ['Pattern', 'Scale', 'Angle', 'Select'],
      });
      if (r === null) return;
      if (r === 'Pattern') {
        const v = await io.getString(`Mẫu (${Object.keys(PATTERNS).join(', ')})`, { def: lastPattern });
        if (v && PATTERNS[v.toUpperCase()]) lastPattern = v.toUpperCase();
        else if (v) io.print(`Không có mẫu "${v}"`);
        continue;
      }
      if (r === 'Scale') {
        const v = await io.getDistance('Tỉ lệ mẫu', { def: scale });
        if (v && v > 0) lastScale = v;
        continue;
      }
      if (r === 'Angle') {
        const v = await io.getDistance('Góc mẫu (độ)', { def: lastAngle });
        if (v !== null) lastAngle = v;
        continue;
      }
      const base = { pattern: lastPattern, scale, angle: lastAngle };
      try {
        if (r === 'Select') {
          const s = await io.getSelection('Chọn đối tượng kín làm biên');
          if (s.length) HATCH.run(ctx, { ids: s, ...base });
          ctx.selection.clear();
        } else if (Array.isArray(r)) HATCH.run(ctx, { pick: r, ...base });
      } catch (err) {
        io.print((err as Error).message);
      }
    }
  },
};

const HATCHEDIT: CommandDef = {
  name: 'HATCHEDIT',
  aliases: ['HE'],
  desc: 'Đổi mẫu, tỉ lệ, góc của vùng tô',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các HATCH' },
    { name: 'pattern', type: 'string', desc: 'Mẫu mới' },
    { name: 'scale', type: 'number', desc: 'Tỉ lệ mới' },
    { name: 'angle', type: 'number', desc: 'Góc mới' },
  ],
  run(ctx, args) {
    const list = ids(ctx, args).filter((e): e is Extract<Entity, { type: 'HATCH' }> => e.type === 'HATCH');
    if (!list.length) throw new Error('Không có HATCH nào trong danh sách');
    for (const h of list) {
      const pattern = (optStr(args, 'pattern') ?? h.pattern).toUpperCase();
      const scale = num(args, 'scale', h.scale);
      const angle = num(args, 'angle', h.angle);
      if (!PATTERNS[pattern]) throw new Error(`Không có mẫu "${pattern}"`);
      ctx.doc.update({ ...h, pattern, scale, angle, solid: pattern === 'SOLID', lines: patternLines(pattern, scale, angle) });
    }
    return { ids: list.map((h) => h.id), message: `Đã sửa ${list.length} vùng tô` };
  },
  async interactive(ctx, io) {
    const h = await io.getEntity('Chọn vùng tô (HATCH)');
    if (!h || typeof h === 'string') return;
    const e = ctx.doc.get(h.id);
    if (e?.type !== 'HATCH') return io.print('Đối tượng không phải HATCH');
    const pattern = await io.getString(`Mẫu (${Object.keys(PATTERNS).join(', ')})`, { def: e.pattern });
    if (pattern === null) return;
    const scale = await io.getDistance('Tỉ lệ', { def: e.scale });
    if (scale === null) return;
    const angle = await io.getDistance('Góc', { def: e.angle });
    if (angle === null) return;
    io.print(HATCHEDIT.run(ctx, { ids: [e.id], pattern, scale, angle }).message!);
  },
};

const BOUNDARY: CommandDef = {
  name: 'BOUNDARY',
  aliases: ['BO', 'BPOLY'],
  desc: 'Tạo đa tuyến kín theo biên của vùng chứa điểm bấm',
  params: [{ name: 'pick', type: 'point', required: true, desc: 'Điểm bên trong vùng' }, ...COMMON],
  run(ctx, args) {
    const r = detectRegion(ctx, pt(args, 'pick'), bool(args, 'islands', false));
    if (!r) throw new Error('Không tìm thấy vùng kín quanh điểm đã chọn');
    const out = r.map((l) => ctx.doc.add({ type: 'LWPOLYLINE', pts: l, closed: true, ...props(ctx, args) }));
    return created(out, `Đã tạo ${out.length} đa tuyến biên`);
  },
  async interactive(ctx, io) {
    for (;;) {
      const p = await io.getPoint('Bấm vào bên trong vùng (Enter để kết thúc)', { allowNone: true });
      if (!Array.isArray(p)) return;
      try {
        io.print(BOUNDARY.run(ctx, { pick: p }).message!);
      } catch (err) {
        io.print((err as Error).message);
      }
    }
  },
};

const POINT: CommandDef = {
  name: 'POINT',
  aliases: ['PO'],
  desc: 'Đặt điểm (POINT)',
  params: [{ name: 'position', type: 'point', required: true, desc: 'Vị trí' }, ...COMMON],
  run(ctx, args) {
    return created([ctx.doc.add({ type: 'POINT', p: pt(args, 'position'), ...props(ctx, args) })]);
  },
  async interactive(ctx, io) {
    for (;;) {
      const p = await io.getPoint('Vị trí điểm (Enter để kết thúc)', { allowNone: true });
      if (!Array.isArray(p)) return;
      POINT.run(ctx, { position: p });
    }
  },
};

export const HATCH_COMMANDS: CommandDef[] = [HATCH, HATCHEDIT, BOUNDARY, POINT];
