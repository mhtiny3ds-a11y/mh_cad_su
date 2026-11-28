// Kích thước (DIMENSION): tính hình vẽ (đường dóng, đường kích thước, mũi tên, chữ) từ các điểm định nghĩa.
// Chỉ phụ thuộc kiểu dữ liệu, không phụ thuộc entities.ts lúc chạy (tránh vòng lặp import).

import {
  type Vec,
  add,
  angleOf,
  deg2rad,
  dist,
  dot,
  len,
  mid,
  mul,
  normAngle,
  polar,
  rad2deg,
  sub,
} from './geom';
import type { DimEnt, DimStyle, NewEntity } from './entities';

export const DEFAULT_DIMSTYLE: DimStyle = {
  txt: 250, // chiều cao chữ
  asz: 180, // độ dài mũi tên
  exo: 100, // khoảng hở từ đối tượng tới đường dóng
  exe: 150, // đường dóng vượt qua đường kích thước
  gap: 80, // khoảng cách chữ tới đường kích thước
  dec: 0, // số chữ số thập phân
};

export function fmtMeasure(v: number, dec: number): string {
  const s = v.toFixed(Math.max(0, Math.min(8, dec)));
  return s;
}

const unit = (v: Vec): Vec => {
  const l = len(v);
  return l < 1e-12 ? [1, 0] : [v[0] / l, v[1] / l];
};
const perp = (v: Vec): Vec => [-v[1], v[0]];

/** Góc chữ dễ đọc: luôn trong (-90°, 90°]. */
function readable(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 90 && a <= 270) a -= 180;
  return a;
}

/** Giá trị đo được của kích thước. */
export function measure(d: Omit<DimEnt, 'id'>): number {
  const p = d.pts;
  switch (d.kind) {
    case 'linear': {
      const u: Vec = [Math.cos(deg2rad(d.rot ?? 0)), Math.sin(deg2rad(d.rot ?? 0))];
      return Math.abs(dot(sub(p[1], p[0]), u));
    }
    case 'aligned':
      return dist(p[0], p[1]);
    case 'radius':
      return dist(p[0], p[1]);
    case 'diameter':
      return dist(p[0], p[1]);
    case 'ordinate':
      // rot 90 = đo Y (đường dẫn ngang), còn lại đo X.
      return d.rot === 90 ? p[0][1] : p[0][0];
    case 'arclen': {
      const a1 = angleOf(sub(p[1], p[0]));
      const a2 = angleOf(sub(p[2], p[0]));
      const { sweep } = angularSpan(p[0], a1, a2, p[3]);
      return sweep * dist(p[0], p[1]);
    }
    case 'angular': {
      const a1 = angleOf(sub(p[1], p[0]));
      const a2 = angleOf(sub(p[2], p[0]));
      const { from, sweep } = angularSpan(p[0], a1, a2, p[3]);
      void from;
      return rad2deg(sweep);
    }
  }
}

/** Chọn phần góc (giữa hai tia) chứa điểm đặt cung. */
function angularSpan(c: Vec, a1: number, a2: number, loc: Vec): { from: number; sweep: number } {
  const al = angleOf(sub(loc, c));
  const s12 = normAngle(a2 - a1);
  if (normAngle(al - a1) <= s12) return { from: a1, sweep: s12 };
  const s21 = normAngle(a1 - a2);
  if (normAngle(al - a2) <= s21) return { from: a2, sweep: s21 };
  return { from: a1, sweep: s12 };
}

export function dimText(d: Omit<DimEnt, 'id'>): string {
  if (d.text && d.text !== '<>') return d.text;
  const v = fmtMeasure(measure(d), d.style.dec);
  const t = d.kind === 'radius' ? `R${v}` : d.kind === 'diameter' ? `Ø${v}` : d.kind === 'angular' ? `${v}°` : d.kind === 'arclen' ? `⌒${v}` : v;
  return d.text ? d.text.replace('<>', t) : t;
}

function arrow(tip: Vec, dirAngle: number, size: number, layer: string, color?: number): NewEntity {
  // Tam giác đặc, mũi nhọn tại tip, hướng về phía dirAngle (từ thân tới mũi).
  const back = polar(tip, dirAngle + Math.PI, size);
  const w = size / 6;
  const n: Vec = [-Math.sin(dirAngle) * w, Math.cos(dirAngle) * w];
  return {
    type: 'LWPOLYLINE',
    pts: [tip, add(back, n), sub(back, n)],
    closed: true,
    fill: true,
    layer,
    ...(color !== undefined ? { color } : {}),
  };
}

/** Hình vẽ của kích thước dưới dạng các đối tượng cơ bản (LINE, LWPOLYLINE tô đặc, TEXT). */
export function dimGeometry(d: Omit<DimEnt, 'id'>): NewEntity[] {
  const s = d.style;
  const L = d.layer;
  const col = d.color !== undefined ? { color: d.color } : {};
  const line = (a: Vec, b: Vec): NewEntity => ({ type: 'LINE', a, b, layer: L, ...col });
  const text = (p: Vec, rot: number): NewEntity => ({
    type: 'TEXT',
    p,
    h: s.txt,
    text: dimText(d),
    rot: readable(rot),
    ha: 'C',
    va: 'B',
    layer: L,
    ...col,
  });
  const out: NewEntity[] = [];
  const p = d.pts;

  if (d.kind === 'linear' || d.kind === 'aligned') {
    const [p1, p2, loc] = p;
    const u: Vec =
      d.kind === 'linear' ? [Math.cos(deg2rad(d.rot ?? 0)), Math.sin(deg2rad(d.rot ?? 0))] : unit(sub(p2, p1));
    const n = perp(u);
    // Đường kích thước đi qua loc, song song u.
    const off1 = dot(sub(loc, p1), n);
    const off2 = dot(sub(loc, p2), n);
    const d1 = add(p1, mul(n, off1));
    const d2 = add(p2, mul(n, off2));
    const sgn1 = Math.sign(off1) || 1;
    const sgn2 = Math.sign(off2) || 1;
    // Đường dóng.
    if (Math.abs(off1) > s.exo) out.push(line(add(p1, mul(n, s.exo * sgn1)), add(d1, mul(n, s.exe * sgn1))));
    if (Math.abs(off2) > s.exo) out.push(line(add(p2, mul(n, s.exo * sgn2)), add(d2, mul(n, s.exe * sgn2))));
    out.push(line(d1, d2));
    const dir = angleOf(sub(d2, d1));
    const length = dist(d1, d2);
    if (length > 2.5 * s.asz) {
      out.push(arrow(d1, dir + Math.PI, s.asz, L, d.color), arrow(d2, dir, s.asz, L, d.color));
    } else {
      // Khoảng hẹp: mũi tên quay ra ngoài.
      out.push(arrow(d1, dir, s.asz, L, d.color), arrow(d2, dir + Math.PI, s.asz, L, d.color));
      out.push(line(polar(d1, dir + Math.PI, s.asz * 2), d1), line(d2, polar(d2, dir, s.asz * 2)));
    }
    // Chữ nằm trên đường kích thước (phía "trên" khi đọc).
    let up = perp(unit(sub(d2, d1)));
    const rot = readable(rad2deg(dir));
    const upRead: Vec = [-Math.sin(deg2rad(rot)), Math.cos(deg2rad(rot))];
    if (dot(up, upRead) < 0) up = mul(up, -1);
    out.push(text(add(mid(d1, d2), mul(up, s.gap)), rad2deg(dir)));
    return out;
  }

  if (d.kind === 'radius' || d.kind === 'diameter') {
    const [a, b] = p; // radius: tâm, điểm trên đường tròn · diameter: hai điểm đối diện
    const dir = angleOf(sub(b, a));
    out.push(line(a, b));
    out.push(arrow(b, dir, s.asz, L, d.color));
    if (d.kind === 'diameter') out.push(arrow(a, dir + Math.PI, s.asz, L, d.color));
    const m = d.kind === 'radius' ? mid(a, b) : mid(a, b);
    let up: Vec = perp(unit(sub(b, a)));
    const rot = readable(rad2deg(dir));
    const upRead: Vec = [-Math.sin(deg2rad(rot)), Math.cos(deg2rad(rot))];
    if (dot(up, upRead) < 0) up = mul(up, -1);
    out.push(text(add(m, mul(up, s.gap)), rad2deg(dir)));
    return out;
  }

  if (d.kind === 'ordinate') {
    // Điểm cần đo → đầu đường dẫn; đường dẫn gãy một lần theo trục đo.
    const [f, endP] = p;
    const yType = d.rot === 90;
    const dir: Vec = yType ? [Math.sign(endP[0] - f[0]) || 1, 0] : [0, Math.sign(endP[1] - f[1]) || 1];
    const start = add(f, mul(dir, s.exo));
    const knee: Vec = yType ? [endP[0] - dir[0] * s.asz * 2, f[1]] : [f[0], endP[1] - dir[1] * s.asz * 2];
    out.push(line(start, knee), line(knee, endP));
    const tp: Vec = yType ? add(endP, [dir[0] * s.gap, -s.txt / 2]) : add(endP, [0, dir[1] > 0 ? s.gap : -s.gap - s.txt]);
    out.push({ ...text(tp, 0), ha: yType ? (dir[0] > 0 ? 'L' : 'R') : 'C' } as NewEntity);
    return out;
  }

  // Góc / chiều dài cung: tâm, điểm trên cạnh 1, điểm trên cạnh 2, vị trí cung.
  const [c, q1, q2, loc] = p;
  const r = dist(c, loc);
  const { from, sweep } = angularSpan(c, angleOf(sub(q1, c)), angleOf(sub(q2, c)), loc);
  const to = from + sweep;
  const e1 = polar(c, from, r);
  const e2 = polar(c, to, r);
  // Đường dóng từ cạnh tới cung (nếu cung nằm ngoài đoạn cạnh).
  for (const [q, ang, e] of [
    [q1, from, e1],
    [q2, to, e2],
  ] as [Vec, number, Vec][]) {
    const qd = dist(c, q);
    void ang;
    if (r > qd + s.exo) out.push(line(polar(c, angleOf(sub(e, c)), qd + s.exo), polar(c, angleOf(sub(e, c)), r + s.exe)));
  }
  out.push({ type: 'ARC', c, r, start: normDeg360(rad2deg(from)), end: normDeg360(rad2deg(to)), layer: L, ...col });
  out.push(arrow(e1, from - Math.PI / 2, s.asz, L, d.color), arrow(e2, to + Math.PI / 2, s.asz, L, d.color));
  const midAng = from + sweep / 2;
  out.push(text(polar(c, midAng, r + s.gap), rad2deg(midAng) - 90));
  return out;
}

const normDeg360 = (d: number) => ((d % 360) + 360) % 360;
