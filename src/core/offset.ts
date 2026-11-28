// OFFSET: tạo đối tượng song song cách một khoảng d về phía điểm chỉ định.

import { type Vec, EPS, add, cross, dist, len, mul, sub } from './geom';
import { type Entity, type NewEntity, polySegments } from './entities';

const leftNormal = (a: Vec, b: Vec): Vec => {
  const d = sub(b, a);
  const l = len(d);
  return l < EPS ? [0, 0] : [-d[1] / l, d[0] / l];
};

/** Giao điểm hai đường thẳng vô hạn (p1 + t·d1, p2 + u·d2). */
function lineLine(p1: Vec, d1: Vec, p2: Vec, d2: Vec): Vec | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, mul(d1, t));
}

/** Phía của p so với đoạn ab: +1 bên trái, -1 bên phải. */
const sideOf = (p: Vec, a: Vec, b: Vec): number => (cross(sub(b, a), sub(p, a)) >= 0 ? 1 : -1);

export function offsetPolyline(pts: readonly Vec[], closed: boolean, signedD: number): Vec[] {
  const segs: [Vec, Vec][] = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
  if (closed) segs.push([pts[pts.length - 1], pts[0]]);
  const off = segs.map(([a, b]) => {
    const n = mul(leftNormal(a, b), signedD);
    return [add(a, n), add(b, n)] as [Vec, Vec];
  });
  const n = off.length;
  const out: Vec[] = [];
  const join = (s1: [Vec, Vec], s2: [Vec, Vec]): Vec =>
    lineLine(s1[0], sub(s1[1], s1[0]), s2[0], sub(s2[1], s2[0])) ?? s1[1];
  if (closed) {
    for (let i = 0; i < n; i++) out.push(join(off[(i - 1 + n) % n], off[i]));
  } else {
    out.push(off[0][0]);
    for (let i = 1; i < n; i++) out.push(join(off[i - 1], off[i]));
    out.push(off[n - 1][1]);
  }
  return out;
}

export function offsetEntity(e: Entity, d: number, side: Vec): NewEntity | null {
  if (d <= 0) return null;
  const { id: _id, ...base } = e;
  const out = (patch: Record<string, unknown>) => ({ ...base, ...patch }) as NewEntity;
  switch (e.type) {
    case 'LINE': {
      const n = mul(leftNormal(e.a, e.b), d * sideOf(side, e.a, e.b));
      return out({ a: add(e.a, n), b: add(e.b, n) });
    }
    case 'XLINE': {
      const b = add(e.p, e.dir);
      const n = mul(leftNormal(e.p, b), d * sideOf(side, e.p, b));
      return out({ p: add(e.p, n) });
    }
    case 'CIRCLE':
    case 'ARC': {
      const r = dist(side, e.c) > e.r ? e.r + d : e.r - d;
      if (r <= EPS) return null;
      return out({ r });
    }
    case 'LWPOLYLINE': {
      if (e.pts.length < 2) return null;
      // Xác định phía theo đoạn gần điểm chỉ định nhất.
      let best = 0;
      let bd = Infinity;
      polySegments(e).forEach(([a, b], i) => {
        const dd = distPointSeg(side, a, b);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      });
      const [a, b] = polySegments(e)[best];
      const pts = offsetPolyline(e.pts, e.closed, d * sideOf(side, a, b));
      return out({ pts });
    }
    default:
      return null;
  }
}

function distPointSeg(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = ab[0] * ab[0] + ab[1] * ab[1];
  if (l2 < EPS) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
  return dist(p, add(a, mul(ab, t)));
}
