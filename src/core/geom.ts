// Hình học 2D cơ bản. Mọi hàm đều thuần (không đổi dữ liệu đầu vào).

export type Vec = readonly [number, number];

export const EPS = 1e-9;

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec, b: Vec): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec): number => Math.hypot(a[0], a[1]);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const angleOf = (a: Vec): number => Math.atan2(a[1], a[0]);
export const polar = (base: Vec, angle: number, d: number): Vec => [
  base[0] + Math.cos(angle) * d,
  base[1] + Math.sin(angle) * d,
];

export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;

/** Chuẩn hoá góc về [0, 2π). */
export function normAngle(a: number): number {
  const t = a % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}

/** Góc a có nằm trên cung đi ngược chiều kim đồng hồ từ start tới end không. */
export function angleInArc(a: number, start: number, end: number): boolean {
  const s = normAngle(start);
  const span = normAngle(end - start) || 2 * Math.PI;
  return normAngle(a - s) <= span + 1e-12;
}

export function rotate(p: Vec, base: Vec, angle: number): Vec {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p[0] - base[0];
  const dy = p[1] - base[1];
  return [base[0] + dx * c - dy * s, base[1] + dx * s + dy * c];
}

export function scaleAbout(p: Vec, base: Vec, k: number): Vec {
  return [base[0] + (p[0] - base[0]) * k, base[1] + (p[1] - base[1]) * k];
}

/** Đối xứng điểm p qua đường thẳng đi qua a, b. */
export function mirrorPoint(p: Vec, a: Vec, b: Vec): Vec {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < EPS) return p;
  const t = dot(sub(p, a), d) / l2;
  const foot = add(a, mul(d, t));
  return [2 * foot[0] - p[0], 2 * foot[1] - p[1]];
}

/** Khoảng cách từ p tới đoạn thẳng ab. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  return dist(p, closestOnSegment(p, a, b));
}

export function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < EPS) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return add(a, mul(d, t));
}

/** Giao điểm hai đoạn thẳng (chỉ trả về khi nằm trên cả hai đoạn). */
export function segSegIntersection(a1: Vec, a2: Vec, b1: Vec, b2: Vec): Vec | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const qp = sub(b1, a1);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  const tol = 1e-9;
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null;
  return add(a1, mul(r, t));
}

/** Giao điểm đoạn thẳng ab với đường tròn (c, r). */
export function segCircleIntersections(a: Vec, b: Vec, c: Vec, r: number): Vec[] {
  const d = sub(b, a);
  const f = sub(a, c);
  const A = dot(d, d);
  if (A < EPS) return [];
  const B = 2 * dot(f, d);
  const C = dot(f, f) - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < -EPS) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  const out: Vec[] = [];
  for (const t of disc < EPS ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t >= -1e-9 && t <= 1 + 1e-9) out.push(add(a, mul(d, t)));
  }
  return out;
}

/** Giao điểm hai đường tròn. */
export function circleCircleIntersections(c1: Vec, r1: number, c2: Vec, r2: number): Vec[] {
  const d = dist(c1, c2);
  if (d < EPS || d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const p = add(c1, mul(sub(c2, c1), a / d));
  if (h < EPS) return [p];
  const ox = (-(c2[1] - c1[1]) * h) / d;
  const oy = ((c2[0] - c1[0]) * h) / d;
  return [
    [p[0] + ox, p[1] + oy],
    [p[0] - ox, p[1] - oy],
  ];
}

/** Đường tròn đi qua 3 điểm; null nếu thẳng hàng. */
export function circleFrom3(p1: Vec, p2: Vec, p3: Vec): { c: Vec; r: number } | null {
  const ax = p1[0], ay = p1[1];
  const bx = p2[0], by = p2[1];
  const cx = p3[0], cy = p3[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < EPS) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const c: Vec = [ux, uy];
  return { c, r: dist(c, p1) };
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function boxAdd(b: BBox, p: Vec): BBox {
  b.minX = Math.min(b.minX, p[0]);
  b.minY = Math.min(b.minY, p[1]);
  b.maxX = Math.max(b.maxX, p[0]);
  b.maxY = Math.max(b.maxY, p[1]);
  return b;
}

export function boxUnion(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export const boxValid = (b: BBox): boolean => b.minX <= b.maxX && b.minY <= b.maxY;

export const boxInside = (inner: BBox, outer: BBox): boolean =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

export const boxOverlap = (a: BBox, b: BBox): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Đoạn thẳng có cắt hoặc nằm trong hình chữ nhật không. */
export function segTouchesBox(a: Vec, b: Vec, box: BBox): boolean {
  const inBox = (p: Vec) => p[0] >= box.minX && p[0] <= box.maxX && p[1] >= box.minY && p[1] <= box.maxY;
  if (inBox(a) || inBox(b)) return true;
  const c: Vec[] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];
  for (let i = 0; i < 4; i++) if (segSegIntersection(a, b, c[i], c[(i + 1) % 4])) return true;
  return false;
}
