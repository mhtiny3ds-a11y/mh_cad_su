// Lệnh vẽ bổ sung: XLINE, RAY, DONUT, REVCLOUD, SPLINE, MTEXT, FIND.

import { type Vec, angleOf, deg2rad, dist, polar, sub } from '../geom';
import { type Entity, type NewEntity, normDeg, textLines } from '../entities';
import { type CommandDef, COMMON, bool, created, ids, num, optStr, props, pt, pts, str } from '../commands';

const unit = (d: Vec): Vec => {
  const L = Math.hypot(d[0], d[1]);
  if (L < 1e-12) throw new Error('Hai điểm trùng nhau, không xác định được hướng');
  return [d[0] / L, d[1] / L];
};

// ---------- XLINE / RAY ----------

const XLINE: CommandDef = {
  name: 'XLINE',
  aliases: ['XL'],
  desc: 'Đường dựng vô hạn hai phía (đường gióng) qua một điểm',
  params: [
    { name: 'point', type: 'point', required: true, desc: 'Điểm mà đường đi qua' },
    { name: 'through', type: 'point', desc: 'Điểm thứ hai xác định hướng' },
    { name: 'angle', type: 'number', desc: 'Hoặc: góc của đường, độ (0 = ngang, 90 = đứng)' },
    ...COMMON,
  ],
  run(ctx, args) {
    const p = pt(args, 'point');
    const dir: Vec = args.through !== undefined ? unit(sub(pt(args, 'through'), p)) : polar([0, 0], deg2rad(num(args, 'angle', 0)), 1);
    return created([ctx.doc.add({ type: 'XLINE', p, dir, ...props(ctx, args) })]);
  },
  async interactive(ctx, io) {
    const first = await io.getPoint('Điểm đi qua', { keywords: ['Hor', 'Ver', 'Ang'] });
    if (first === null) return;
    let fixedAngle: number | null = null;
    if (first === 'Hor') fixedAngle = 0;
    else if (first === 'Ver') fixedAngle = 90;
    else if (first === 'Ang') {
      const a = await io.getDistance('Góc của đường (độ)', { def: 45 });
      if (a === null) return;
      fixedAngle = a;
    }
    if (fixedAngle !== null) {
      const dir = polar([0, 0], deg2rad(fixedAngle), 1);
      for (;;) {
        const p = await io.getPoint('Điểm đi qua (Enter để kết thúc)', {
          allowNone: true,
          preview: (c) => [{ type: 'XLINE', p: c, dir, layer: ctx.doc.currentLayer }],
        });
        if (!Array.isArray(p)) return;
        XLINE.run(ctx, { point: p, angle: fixedAngle });
      }
    }
    if (!Array.isArray(first)) return;
    const base = first as Vec;
    for (;;) {
      const q = await io.getPoint('Điểm thứ hai (Enter để kết thúc)', {
        base,
        allowNone: true,
        preview: (c) => (dist(c, base) > 1e-9 ? [{ type: 'XLINE', p: base, dir: unit(sub(c, base)), layer: ctx.doc.currentLayer }] : []),
      });
      if (!Array.isArray(q)) return;
      if (dist(q as Vec, base) > 1e-9) XLINE.run(ctx, { point: base, through: q });
    }
  },
};

const RAY: CommandDef = {
  name: 'RAY',
  aliases: [],
  desc: 'Tia: đường vô hạn một phía, bắt đầu từ một điểm',
  params: [
    { name: 'start', type: 'point', required: true, desc: 'Điểm gốc' },
    { name: 'through', type: 'point', required: true, desc: 'Điểm mà tia đi qua' },
    ...COMMON,
  ],
  run(ctx, args) {
    const p = pt(args, 'start');
    return created([ctx.doc.add({ type: 'XLINE', ray: true, p, dir: unit(sub(pt(args, 'through'), p)), ...props(ctx, args) })]);
  },
  async interactive(ctx, io) {
    const s = await io.getPoint('Điểm gốc của tia');
    if (!Array.isArray(s)) return;
    const base = s as Vec;
    for (;;) {
      const q = await io.getPoint('Điểm tia đi qua (Enter để kết thúc)', {
        base,
        allowNone: true,
        preview: (c) => (dist(c, base) > 1e-9 ? [{ type: 'XLINE', ray: true, p: base, dir: unit(sub(c, base)), layer: ctx.doc.currentLayer }] : []),
      });
      if (!Array.isArray(q)) return;
      if (dist(q as Vec, base) > 1e-9) RAY.run(ctx, { start: base, through: q });
    }
  },
};

// ---------- DONUT ----------

const circlePts = (c: Vec, r: number, n = 72): Vec[] => Array.from({ length: n }, (_, i) => polar(c, (2 * Math.PI * i) / n, r));

function donutEnt(c: Vec, inner: number, outer: number, layer: string): NewEntity {
  const loops = [circlePts(c, outer / 2)];
  if (inner > 0) loops.push(circlePts(c, inner / 2));
  return { type: 'HATCH', loops, solid: true, pattern: 'SOLID', scale: 1, angle: 0, lines: [], layer };
}

let donutIn = 50;
let donutOut = 100;

const DONUT: CommandDef = {
  name: 'DONUT',
  aliases: ['DO', 'DOUGHNUT'],
  desc: 'Vành khuyên tô đặc (đường kính trong = 0 thành chấm tròn đặc)',
  params: [
    { name: 'center', type: 'point', required: true, desc: 'Tâm' },
    { name: 'inner', type: 'number', desc: 'Đường kính trong (mặc định 50)' },
    { name: 'outer', type: 'number', desc: 'Đường kính ngoài (mặc định 100)' },
    ...COMMON,
  ],
  run(ctx, args) {
    const inner = num(args, 'inner', donutIn);
    const outer = num(args, 'outer', donutOut);
    if (inner < 0 || outer <= 0 || inner >= outer) throw new Error('Cần 0 ≤ đường kính trong < đường kính ngoài');
    const e = donutEnt(pt(args, 'center'), inner, outer, '');
    return created([ctx.doc.add({ ...e, ...props(ctx, args) } as NewEntity)]);
  },
  async interactive(ctx, io) {
    const i = await io.getDistance('Đường kính trong', { def: donutIn });
    if (i === null) return;
    const o = await io.getDistance('Đường kính ngoài', { def: donutOut });
    if (o === null) return;
    if (i < 0 || o <= i) return io.print('Đường kính ngoài phải lớn hơn đường kính trong');
    donutIn = i;
    donutOut = o;
    for (;;) {
      const c = await io.getPoint('Tâm (Enter để kết thúc)', { allowNone: true, preview: (q) => [donutEnt(q, i, o, ctx.doc.currentLayer)] });
      if (!Array.isArray(c)) return;
      DONUT.run(ctx, { center: c, inner: i, outer: o });
    }
  },
};

// ---------- REVCLOUD ----------

/**
 * Đường mây: chia đường dẫn thành các đoạn dài khoảng arcLen, thay mỗi đoạn bằng một cung lồi ra ngoài
 * (cung 120°, chia nhỏ thành đoạn thẳng).
 */
export function revcloudPts(path: Vec[], closed: boolean, arcLen: number): Vec[] {
  const P = closed && dist(path[0], path[path.length - 1]) > 1e-9 ? [...path, path[0]] : [...path];
  // Đi dọc đường dẫn lấy các điểm cách đều.
  const marks: Vec[] = [P[0]];
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i];
    const b = P[i + 1];
    const L = dist(a, b);
    const n = Math.max(1, Math.round(L / arcLen));
    for (let k = 1; k <= n; k++) marks.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  // Cung lồi ra ngoài: với đường kín ngược chiều kim đồng hồ, phía ngoài là bên phải.
  let ccw = true;
  if (closed) {
    let s = 0;
    for (let i = 0; i + 1 < P.length; i++) s += P[i][0] * P[i + 1][1] - P[i + 1][0] * P[i][1];
    ccw = s > 0;
  }
  const out: Vec[] = [marks[0]];
  const sweep = 120;
  const seg = 6;
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i];
    const b = marks[i + 1];
    const chord = dist(a, b);
    if (chord < 1e-12) continue;
    const r = chord / 2 / Math.sin(deg2rad(sweep / 2));
    const m: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dir = angleOf(sub(b, a));
    // Tâm nằm phía trong, cung lồi ra ngoài.
    const inward = dir + (ccw ? Math.PI / 2 : -Math.PI / 2);
    const c = polar(m, inward, r * Math.cos(deg2rad(sweep / 2)));
    const a0 = angleOf(sub(a, c));
    const sgn = ccw ? -1 : 1;
    for (let k = 1; k <= seg; k++) out.push(polar(c, a0 + (sgn * deg2rad(sweep) * k) / seg, r));
    out[out.length - 1] = b;
  }
  if (closed) out.pop();
  return out;
}

let cloudArc = 500;

const REVCLOUD: CommandDef = {
  name: 'REVCLOUD',
  aliases: ['RC'],
  desc: 'Đường mây đánh dấu chỗ sửa: theo hình chữ nhật, theo các điểm, hoặc biến đa tuyến kín/đường tròn thành mây',
  params: [
    { name: 'corners', type: 'points', desc: 'Hai góc hình chữ nhật' },
    { name: 'points', type: 'points', desc: 'Hoặc: các đỉnh đường dẫn' },
    { name: 'ids', type: 'ids', desc: 'Hoặc: đối tượng (đa tuyến, đường tròn) cần biến thành mây (đối tượng gốc bị xoá)' },
    { name: 'arc', type: 'number', desc: 'Độ dài mỗi cung (mặc định 500)' },
    { name: 'closed', type: 'boolean', desc: 'Khép kín (mặc định có)' },
    ...COMMON,
  ],
  run(ctx, args) {
    const arc = num(args, 'arc', cloudArc);
    if (arc <= 0) throw new Error('Độ dài cung phải > 0');
    const closed = bool(args, 'closed', true);
    const make = (path: Vec[], c: boolean, extra: Partial<Entity> = {}) =>
      ctx.doc.add({ type: 'LWPOLYLINE', pts: revcloudPts(path, c, arc), closed: c, ...props(ctx, args), ...extra } as NewEntity);
    if (Array.isArray(args.corners)) {
      const [a, b] = pts(args, 'corners', 2);
      return created([make([a, [b[0], a[1]], b, [a[0], b[1]]], true)]);
    }
    if (Array.isArray(args.points)) return created([make(pts(args, 'points', 2), closed)]);
    if (Array.isArray(args.ids)) {
      const out: Entity[] = [];
      for (const e of ids(ctx, args)) {
        let path: Vec[] | null = null;
        let c = true;
        if (e.type === 'LWPOLYLINE') {
          path = e.pts;
          c = e.closed;
        } else if (e.type === 'CIRCLE') path = circlePts(e.c, e.r, Math.max(8, Math.round((2 * Math.PI * e.r) / arc)));
        if (!path) continue;
        out.push(make(path, c, { layer: e.layer, ...(e.color !== undefined ? { color: e.color } : {}) }));
        ctx.doc.remove(e.id);
      }
      if (!out.length) throw new Error('Không có đa tuyến hay đường tròn nào để biến thành mây');
      return created(out);
    }
    throw new Error('Cần "corners", "points" hoặc "ids"');
  },
  async interactive(ctx, io) {
    for (;;) {
      const a = await io.getPoint(`Góc thứ nhất (độ dài cung ${cloudArc})`, { keywords: ['Arc', 'Object', 'Freehand'] });
      if (a === null) return;
      if (a === 'Arc') {
        const v = await io.getDistance('Độ dài cung', { def: cloudArc });
        if (v && v > 0) cloudArc = v;
        continue;
      }
      if (a === 'Object') {
        const s = await io.getSelection('Chọn đa tuyến hoặc đường tròn');
        if (s.length) io.print(REVCLOUD.run(ctx, { ids: s }).message ?? 'Đã tạo đường mây');
        ctx.selection.clear();
        return;
      }
      if (a === 'Freehand') {
        const path: Vec[] = [];
        for (;;) {
          const p = await io.getPoint(path.length < 2 ? 'Điểm đường dẫn' : 'Điểm tiếp theo (Enter để khép kín)', {
            base: path[path.length - 1],
            allowNone: path.length >= 2,
            preview: (c) => (path.length ? [{ type: 'LWPOLYLINE', pts: revcloudPts([...path, c], false, cloudArc), closed: false, layer: ctx.doc.currentLayer }] : []),
          });
          if (!Array.isArray(p)) break;
          path.push(p as Vec);
        }
        if (path.length >= 2) REVCLOUD.run(ctx, { points: path, closed: path.length >= 3 });
        return;
      }
      if (!Array.isArray(a)) continue;
      const p1 = a as Vec;
      const b = await io.getPoint('Góc đối diện', {
        base: p1,
        preview: (c) =>
          Math.abs(c[0] - p1[0]) > 1e-9 && Math.abs(c[1] - p1[1]) > 1e-9
            ? [{ type: 'LWPOLYLINE', pts: revcloudPts([p1, [c[0], p1[1]], c, [p1[0], c[1]]], true, cloudArc), closed: true, layer: ctx.doc.currentLayer }]
            : [],
      });
      if (!Array.isArray(b)) return;
      REVCLOUD.run(ctx, { corners: [p1, b] });
      return;
    }
  },
};

// ---------- SPLINE (đường cong trơn qua các điểm) ----------

/** Đường cong Catmull-Rom (dạng hướng tâm) đi qua mọi điểm, chia thành đoạn thẳng. */
export function splinePts(P: Vec[], closed: boolean, perSpan = 16): Vec[] {
  if (P.length < 3) return [...P];
  const n = P.length;
  const at = (i: number): Vec => (closed ? P[((i % n) + n) % n] : i < 0 ? [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]] : i >= n ? [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]] : P[i]);
  const out: Vec[] = [P[0]];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    // Tham số hướng tâm (alpha = 0,5) tránh vòng xoắn và đỉnh nhọn.
    const t01 = Math.sqrt(dist(p0, p1)) || 1e-9;
    const t12 = Math.sqrt(dist(p1, p2)) || 1e-9;
    const t23 = Math.sqrt(dist(p2, p3)) || 1e-9;
    const m1 = [0, 1].map((k) => (p2[k] - p1[k] + t12 * ((p1[k] - p0[k]) / t01 - (p2[k] - p0[k]) / (t01 + t12)))) as unknown as Vec;
    const m2 = [0, 1].map((k) => (p2[k] - p1[k] + t12 * ((p3[k] - p2[k]) / t23 - (p3[k] - p1[k]) / (t12 + t23)))) as unknown as Vec;
    for (let s = 1; s <= perSpan; s++) {
      const t = s / perSpan;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
      const h10 = t ** 3 - 2 * t ** 2 + t;
      const h01 = -2 * t ** 3 + 3 * t ** 2;
      const h11 = t ** 3 - t ** 2;
      out.push([h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0], h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1]]);
    }
  }
  if (closed) out.pop();
  return out;
}

const SPLINE: CommandDef = {
  name: 'SPLINE',
  aliases: ['SPL'],
  desc: 'Đường cong trơn đi qua các điểm (lưu dưới dạng đa tuyến nhiều đỉnh)',
  params: [
    { name: 'points', type: 'points', required: true, desc: 'Các điểm mà đường cong đi qua' },
    { name: 'closed', type: 'boolean', desc: 'Khép kín' },
    ...COMMON,
  ],
  run(ctx, args) {
    const P = pts(args, 'points', 2);
    const closed = bool(args, 'closed', false);
    return created([ctx.doc.add({ type: 'LWPOLYLINE', pts: splinePts(P, closed), closed, ...props(ctx, args) })]);
  },
  async interactive(ctx, io) {
    const P: Vec[] = [];
    for (;;) {
      const kws = P.length >= 3 ? ['Close', 'Undo'] : P.length ? ['Undo'] : [];
      const p = await io.getPoint(P.length ? 'Điểm tiếp theo (Enter để kết thúc)' : 'Điểm đầu', {
        base: P[P.length - 1],
        allowNone: P.length >= 2,
        keywords: kws,
        preview: (c) => (P.length ? [{ type: 'LWPOLYLINE', pts: splinePts([...P, c], false), closed: false, layer: ctx.doc.currentLayer }] : []),
      });
      if (p === null) break;
      if (p === 'Undo') {
        P.pop();
        continue;
      }
      if (p === 'Close') {
        SPLINE.run(ctx, { points: P, closed: true });
        return;
      }
      if (Array.isArray(p)) P.push(p as Vec);
    }
    if (P.length >= 2) SPLINE.run(ctx, { points: P });
  },
};

// ---------- MTEXT (chữ nhiều dòng) ----------

/** Ngắt dòng theo bề rộng (ước lượng mỗi ký tự rộng 0,6 lần chiều cao). */
export function wrapText(text: string, width: number, h: number): string {
  if (!(width > 0)) return text;
  const max = Math.max(1, Math.floor(width / (h * 0.6)));
  const out: string[] = [];
  for (const para of textLines(text)) {
    let line = '';
    for (const w of para.split(/ +/)) {
      if (!line) line = w;
      else if ((line + ' ' + w).length <= max) line += ' ' + w;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

let mtextHeight = 250;

const MTEXT: CommandDef = {
  name: 'MTEXT',
  aliases: ['MT'],
  desc: 'Chữ nhiều dòng trong khung (tự ngắt dòng theo bề rộng). Xuống dòng bằng \\n',
  params: [
    { name: 'position', type: 'point', required: true, desc: 'Góc trên trái của khung chữ' },
    { name: 'text', type: 'string', required: true, desc: 'Nội dung, xuống dòng bằng ký tự \\n' },
    { name: 'height', type: 'number', desc: 'Chiều cao chữ (mặc định 250)' },
    { name: 'width', type: 'number', desc: 'Bề rộng khung để tự ngắt dòng (bỏ trống = không ngắt)' },
    { name: 'rotation', type: 'number', desc: 'Góc xoay, độ' },
    ...COMMON,
  ],
  run(ctx, args) {
    const h = num(args, 'height', mtextHeight);
    if (h <= 0) throw new Error('Chiều cao chữ phải > 0');
    const text = wrapText(str(args, 'text').replace(/\r\n?/g, '\n').replace(/\\P/g, '\n'), num(args, 'width', 0), h);
    return created([
      ctx.doc.add({ type: 'TEXT', p: pt(args, 'position'), h, text, rot: normDeg(num(args, 'rotation', 0)), va: 'T', ...props(ctx, args) }),
    ]);
  },
  async interactive(ctx, io) {
    const a = await io.getPoint('Góc thứ nhất của khung chữ', { keywords: ['Height'] });
    if (a === 'Height') {
      const v = await io.getDistance('Chiều cao chữ', { def: mtextHeight });
      if (v && v > 0) mtextHeight = v;
      return MTEXT.interactive!(ctx, io);
    }
    if (!Array.isArray(a)) return;
    const p1 = a as Vec;
    const b = await io.getPoint('Góc đối diện', {
      base: p1,
      preview: (c) => [{ type: 'LWPOLYLINE', pts: [p1, [c[0], p1[1]], c, [p1[0], c[1]]], closed: true, layer: ctx.doc.currentLayer }],
    });
    if (!Array.isArray(b)) return;
    const top: Vec = [Math.min(p1[0], b[0]), Math.max(p1[1], b[1])];
    const width = Math.abs(b[0] - p1[0]);
    const text = io.getText ? await io.getText('Nội dung chữ (nhiều dòng)') : await io.getString('Nội dung (xuống dòng bằng \\P)', { spaces: true });
    if (!text) return;
    MTEXT.run(ctx, { position: top, text, height: mtextHeight, width });
  },
};

// ---------- FIND (tìm & thay chữ) ----------

const FIND: CommandDef = {
  name: 'FIND',
  aliases: ['TIM'],
  desc: 'Tìm chữ trong bản vẽ (chọn các chữ tìm được); có "replace" thì thay thế',
  params: [
    { name: 'find', type: 'string', required: true, desc: 'Chuỗi cần tìm' },
    { name: 'replace', type: 'string', desc: 'Chuỗi thay thế (bỏ trống = chỉ tìm)' },
    { name: 'matchCase', type: 'boolean', desc: 'Phân biệt hoa thường (mặc định không)' },
  ],
  run(ctx, args) {
    const find = str(args, 'find');
    const rep = optStr(args, 'replace');
    const cs = bool(args, 'matchCase', false);
    const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cs ? 'g' : 'gi');
    const hits = ctx.doc.visible().filter((e): e is Extract<Entity, { type: 'TEXT' }> => e.type === 'TEXT' && ctx.doc.isEditable(e) && e.text.search(re) >= 0);
    if (rep !== undefined) for (const e of hits) ctx.doc.update({ ...e, text: e.text.replace(re, rep) });
    ctx.selection.clear();
    for (const e of hits) ctx.selection.add(e.id);
    const message = hits.length
      ? rep !== undefined
        ? `Đã thay ${hits.length} chữ`
        : `Tìm thấy ${hits.length} chữ (đã chọn)`
      : `Không tìm thấy "${find}"`;
    return { ids: hits.map((e) => e.id), message };
  },
  async interactive(ctx, io) {
    const find = await io.getString('Tìm chữ', { spaces: true });
    if (!find) return;
    const rep = await io.getString('Thay bằng (Enter để chỉ tìm)', { spaces: true });
    io.print(FIND.run(ctx, rep ? { find, replace: rep } : { find }).message!);
  },
};

export const DRAW_COMMANDS: CommandDef[] = [XLINE, RAY, DONUT, REVCLOUD, SPLINE, MTEXT, FIND];
