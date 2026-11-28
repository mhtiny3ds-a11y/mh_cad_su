// Đường cong có tham số: LINE, ARC, CIRCLE, LWPOLYLINE.
// Tham số t = độ dài cung tính từ điểm đầu (CIRCLE: từ góc 0°). Dùng cho TRIM, EXTEND, BREAK.

import {
  type Vec,
  EPS,
  add,
  angleOf,
  circleCircleIntersections,
  cross,
  deg2rad,
  dist,
  dot,
  len,
  mul,
  normAngle,
  polar,
  rad2deg,
  segCircleIntersections,
  segSegIntersection,
  sub,
} from './geom';
import { type ArcEnt, type Entity, type NewEntity, type Prim, normDeg, prims } from './entities';

export type CurveEnt = Extract<Entity, { type: 'LINE' | 'ARC' | 'CIRCLE' | 'LWPOLYLINE' }>;

export const isCurve = (e: Entity): e is CurveEnt =>
  e.type === 'LINE' || e.type === 'ARC' || e.type === 'CIRCLE' || e.type === 'LWPOLYLINE';

export const isClosed = (e: CurveEnt): boolean => e.type === 'CIRCLE' || (e.type === 'LWPOLYLINE' && e.closed);

const sweepRad = (a: ArcEnt): number => normAngle(deg2rad(a.end) - deg2rad(a.start)) || 2 * Math.PI;

/** Đỉnh của đa tuyến (kín thì lặp lại đỉnh đầu ở cuối). */
function polyVerts(e: Extract<Entity, { type: 'LWPOLYLINE' }>): Vec[] {
  return e.closed ? [...e.pts, e.pts[0]] : [...e.pts];
}

function cumLengths(v: Vec[]): number[] {
  const c = [0];
  for (let i = 1; i < v.length; i++) c.push(c[i - 1] + dist(v[i - 1], v[i]));
  return c;
}

export function curveLength(e: CurveEnt): number {
  switch (e.type) {
    case 'LINE':
      return dist(e.a, e.b);
    case 'ARC':
      return e.r * sweepRad(e);
    case 'CIRCLE':
      return 2 * Math.PI * e.r;
    case 'LWPOLYLINE': {
      const c = cumLengths(polyVerts(e));
      return c[c.length - 1];
    }
  }
}

export function pointAt(e: CurveEnt, t: number): Vec {
  switch (e.type) {
    case 'LINE': {
      const L = dist(e.a, e.b) || 1;
      return add(e.a, mul(sub(e.b, e.a), t / L));
    }
    case 'ARC':
      return polar(e.c, deg2rad(e.start) + t / e.r, e.r);
    case 'CIRCLE':
      return polar(e.c, t / e.r, e.r);
    case 'LWPOLYLINE': {
      const v = polyVerts(e);
      const c = cumLengths(v);
      const L = c[c.length - 1];
      if (isClosed(e)) t = ((t % L) + L) % L;
      for (let i = 1; i < v.length; i++) {
        if (t <= c[i] + 1e-12 || i === v.length - 1) {
          const seg = c[i] - c[i - 1] || 1;
          return add(v[i - 1], mul(sub(v[i], v[i - 1]), (t - c[i - 1]) / seg));
        }
      }
      return v[v.length - 1];
    }
  }
}

/** Tham số của điểm gần p nhất trên đường cong. */
export function paramOf(e: CurveEnt, p: Vec): number {
  switch (e.type) {
    case 'LINE': {
      const d = sub(e.b, e.a);
      const L = len(d);
      if (L < EPS) return 0;
      return Math.max(0, Math.min(L, dot(sub(p, e.a), d) / L));
    }
    case 'CIRCLE':
      return normAngle(angleOf(sub(p, e.c))) * e.r;
    case 'ARC': {
      const sw = sweepRad(e);
      const a = normAngle(angleOf(sub(p, e.c)) - deg2rad(e.start));
      if (a <= sw) return a * e.r;
      // Ngoài cung: lấy đầu mút gần hơn.
      return a - sw < 2 * Math.PI - a ? sw * e.r : 0;
    }
    case 'LWPOLYLINE': {
      const v = polyVerts(e);
      const c = cumLengths(v);
      let best = 0;
      let bd = Infinity;
      for (let i = 1; i < v.length; i++) {
        const d = sub(v[i], v[i - 1]);
        const L = len(d);
        const s = L < EPS ? 0 : Math.max(0, Math.min(L, dot(sub(p, v[i - 1]), d) / L));
        const q = add(v[i - 1], mul(d, L < EPS ? 0 : s / L));
        const dd = dist(p, q);
        if (dd < bd) {
          bd = dd;
          best = c[i - 1] + s;
        }
      }
      return best;
    }
  }
}

/**
 * Đoạn con từ t1 tới t2 (t1 < t2). Với đường kín, t2 có thể vượt độ dài (đi vòng qua điểm đầu).
 * Trả về null nếu đoạn quá ngắn.
 */
export function subCurve(e: CurveEnt, t1: number, t2: number): NewEntity | null {
  if (t2 - t1 < 1e-9) return null;
  const { id: _id, ...base } = e;
  const keep = { layer: e.layer, ...(e.color !== undefined ? { color: e.color } : {}), ...(e.lt ? { lt: e.lt } : {}) };
  void base;
  switch (e.type) {
    case 'LINE':
      return { type: 'LINE', a: pointAt(e, t1), b: pointAt(e, t2), ...keep };
    case 'ARC': {
      const s = e.start + rad2deg(t1 / e.r);
      const en = e.start + rad2deg(t2 / e.r);
      return { type: 'ARC', c: e.c, r: e.r, start: normDeg(s), end: normDeg(en), ...keep };
    }
    case 'CIRCLE': {
      if (t2 - t1 >= 2 * Math.PI * e.r - 1e-9) return { type: 'CIRCLE', c: e.c, r: e.r, ...keep };
      return { type: 'ARC', c: e.c, r: e.r, start: normDeg(rad2deg(t1 / e.r)), end: normDeg(rad2deg(t2 / e.r)), ...keep };
    }
    case 'LWPOLYLINE': {
      const v0 = polyVerts(e);
      const c0 = cumLengths(v0);
      const L = c0[c0.length - 1];
      // Trải phẳng hai vòng để xử lý đoạn đi qua điểm đầu của đa tuyến kín.
      const v = isClosed(e) ? [...v0, ...v0.slice(1)] : v0;
      const c = isClosed(e) ? [...c0, ...c0.slice(1).map((x) => x + L)] : c0;
      const at = (t: number): Vec => {
        for (let i = 1; i < v.length; i++)
          if (t <= c[i] + 1e-12 || i === v.length - 1) {
            const seg = c[i] - c[i - 1] || 1;
            return add(v[i - 1], mul(sub(v[i], v[i - 1]), (t - c[i - 1]) / seg));
          }
        return v[v.length - 1];
      };
      const pts: Vec[] = [at(t1)];
      for (let i = 0; i < v.length; i++) if (c[i] > t1 + 1e-9 && c[i] < t2 - 1e-9) pts.push(v[i]);
      pts.push(at(t2));
      return { type: 'LWPOLYLINE', pts, closed: false, ...keep };
    }
  }
}

// ---------- Giao điểm dùng cho TRIM / EXTEND ----------

function primIntersect(p: Prim, q: Prim): Vec[] {
  const onArc = (x: Vec, a: Extract<Prim, { k: 'arc' }>) =>
    a.full || normAngle(angleOf(sub(x, a.c)) - deg2rad(a.start)) <= (normAngle(deg2rad(a.end) - deg2rad(a.start)) || 2 * Math.PI) + 1e-12;
  if (p.k === 'seg' && q.k === 'seg') {
    const x = segSegIntersection(p.a, p.b, q.a, q.b);
    return x ? [x] : [];
  }
  if (p.k === 'seg' && q.k === 'arc') return segCircleIntersections(p.a, p.b, q.c, q.r).filter((x) => onArc(x, q));
  if (p.k === 'arc' && q.k === 'seg') return primIntersect(q, p);
  if (p.k === 'arc' && q.k === 'arc')
    return circleCircleIntersections(p.c, p.r, q.c, q.r).filter((x) => onArc(x, p) && onArc(x, q));
  return [];
}

/** Các tham số trên e nơi e bị các đối tượng cắt cắt qua (đã sắp xếp, bỏ trùng). */
export function cutParams(e: CurveEnt, cutters: Entity[]): number[] {
  const ts: number[] = [];
  const mine = prims(e);
  for (const c of cutters) {
    if (c.id === e.id) {
      // Tự cắt của đa tuyến: bỏ qua ở bản này.
      continue;
    }
    for (const q of cutterPrims(c)) for (const p of mine) for (const x of primIntersect(p, q)) ts.push(paramOf(e, x));
  }
  ts.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of ts) if (!out.length || t - out[out.length - 1] > 1e-7) out.push(t);
  return out;
}

/** Nguyên tố hình học của một đối tượng dùng làm cạnh cắt (block/kích thước được phân rã). */
let cutterPrims: (e: Entity) => Prim[] = (e) => prims(e);
export function setCutterPrims(fn: (e: Entity) => Prim[]): void {
  cutterPrims = fn;
}

export interface TrimResult {
  /** Thay đối tượng gốc bằng phần này (null = xoá đối tượng gốc). */
  replace: NewEntity | null;
  /** Phần còn lại thêm mới (khi cắt ở giữa). */
  extra: NewEntity | null;
}

/** Cắt bỏ phần của e chứa điểm bấm pick, giới hạn bởi các giao điểm với cutters. */
export function trimCurve(e: CurveEnt, pick: Vec, cutters: Entity[]): TrimResult | null {
  const cuts = cutParams(e, cutters);
  const L = curveLength(e);
  const tp = paramOf(e, pick);
  if (isClosed(e)) {
    if (cuts.length < 2) return null;
    let a = cuts[cuts.length - 1] - L;
    let b = cuts[0];
    for (const t of cuts) {
      if (t < tp) a = t;
      else {
        b = t;
        break;
      }
    }
    if (tp > cuts[cuts.length - 1]) {
      a = cuts[cuts.length - 1];
      b = cuts[0] + L;
    }
    // Giữ phần từ b đi tiếp tới a (vòng qua điểm đầu).
    const keepFrom = b;
    const keepTo = a + L;
    return { replace: subCurve(e, keepFrom, keepTo), extra: null };
  }
  const inner = cuts.filter((t) => t > 1e-7 && t < L - 1e-7);
  let a: number | null = null;
  let b: number | null = null;
  for (const t of inner) {
    if (t < tp) a = t;
    else if (b === null) b = t;
  }
  if (a === null && b === null) return null;
  const first = a !== null ? subCurve(e, 0, a) : null;
  const second = b !== null ? subCurve(e, b, L) : null;
  return first ? { replace: first, extra: second } : { replace: second, extra: null };
}

// ---------- EXTEND ----------

/** Giao của tia/đường thẳng vô hạn (o + s·d, |d| = 1) với nguyên tố; trả về các s. */
function rayHits(o: Vec, d: Vec, q: Prim): number[] {
  if (q.k === 'seg') {
    const r = sub(q.b, q.a);
    const den = cross(d, r);
    if (Math.abs(den) < EPS) return [];
    const ao = sub(q.a, o);
    const s = cross(ao, r) / den;
    const u = cross(ao, d) / den;
    return u >= -1e-9 && u <= 1 + 1e-9 ? [s] : [];
  }
  const f = sub(o, q.c);
  const B = 2 * dot(f, d);
  const C = dot(f, f) - q.r * q.r;
  const disc = B * B - 4 * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [(-B - sq) / 2, (-B + sq) / 2].filter((s) => {
    if (q.full) return true;
    const x = add(o, mul(d, s));
    return normAngle(angleOf(sub(x, q.c)) - deg2rad(q.start)) <= (normAngle(deg2rad(q.end) - deg2rad(q.start)) || 2 * Math.PI) + 1e-12;
  });
}

/** Kéo dài đầu mút gần điểm bấm của LINE / ARC / đa tuyến hở tới biên gần nhất. */
export function extendCurve(e: CurveEnt, pick: Vec, bounds: Entity[]): NewEntity | null {
  const { id: _id, ...rest } = e;
  const others = bounds.filter((b) => b.id !== e.id);
  const bprims = others.flatMap((b) => cutterPrims(b));
  if (e.type === 'LINE' || e.type === 'LWPOLYLINE') {
    let a: Vec, b: Vec, atEnd: boolean;
    if (e.type === 'LINE') {
      atEnd = paramOf(e, pick) > dist(e.a, e.b) / 2;
      [a, b] = atEnd ? [e.a, e.b] : [e.b, e.a];
    } else {
      if (e.closed || e.pts.length < 2) return null;
      atEnd = paramOf(e, pick) > curveLength(e) / 2;
      const n = e.pts.length;
      [a, b] = atEnd ? [e.pts[n - 2], e.pts[n - 1]] : [e.pts[1], e.pts[0]];
    }
    const L = dist(a, b);
    if (L < EPS) return null;
    const d = mul(sub(b, a), 1 / L);
    let best = Infinity;
    for (const q of bprims) for (const s of rayHits(b, d, q)) if (s > 1e-7 && s < best) best = s;
    if (!Number.isFinite(best)) return null;
    const nb = add(b, mul(d, best));
    if (e.type === 'LINE') return atEnd ? { ...rest, a: e.a, b: nb } as NewEntity : { ...rest, a: nb, b: e.b } as NewEntity;
    const pts = [...e.pts];
    if (atEnd) pts[pts.length - 1] = nb;
    else pts[0] = nb;
    return { ...rest, pts } as NewEntity;
  }
  if (e.type === 'ARC') {
    const atEnd = paramOf(e, pick) > curveLength(e) / 2;
    const full: Prim = { k: 'arc', c: e.c, r: e.r, start: 0, end: 360, full: true };
    const angs: number[] = [];
    for (const q of bprims) for (const x of primIntersect(full, q)) angs.push(rad2deg(normAngle(angleOf(sub(x, e.c)))));
    const sweep = normDeg(e.end - e.start) || 360;
    let best = Infinity;
    for (const a of angs) {
      // Khoảng góc phải đi thêm (ngoài phạm vi cung hiện tại).
      const delta = atEnd ? normDeg(a - e.end) : normDeg(e.start - a);
      if (delta > 1e-7 && delta < 360 - sweep - 1e-7 && delta < best) best = delta;
    }
    if (!Number.isFinite(best)) return null;
    return atEnd ? ({ ...rest, end: normDeg(e.end + best) } as NewEntity) : ({ ...rest, start: normDeg(e.start - best) } as NewEntity);
  }
  return null;
}
