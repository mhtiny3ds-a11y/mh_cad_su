// Các loại đối tượng bản vẽ và phép toán trên chúng.
// Góc của ARC/TEXT lưu bằng ĐỘ (giống DXF), ngược chiều kim đồng hồ, 0° = trục X dương.

import {
  type BBox,
  type Vec,
  add,
  angleInArc,
  angleOf,
  boxAdd,
  boxInside,
  boxOverlap,
  circleCircleIntersections,
  closestOnSegment,
  deg2rad,
  dist,
  distToSegment,
  emptyBox,
  mid,
  mirrorPoint,
  polar,
  rad2deg,
  rotate,
  scaleAbout,
  segCircleIntersections,
  segSegIntersection,
  segTouchesBox,
  sub,
} from './geom';

interface Base {
  id: number;
  layer: string;
  /** Mã màu ACI. Không có = theo layer (ByLayer). */
  color?: number;
}

export interface LineEnt extends Base {
  type: 'LINE';
  a: Vec;
  b: Vec;
}
export interface CircleEnt extends Base {
  type: 'CIRCLE';
  c: Vec;
  r: number;
}
export interface ArcEnt extends Base {
  type: 'ARC';
  c: Vec;
  r: number;
  start: number;
  end: number;
}
export interface PolylineEnt extends Base {
  type: 'LWPOLYLINE';
  pts: Vec[];
  closed: boolean;
}
export interface TextEnt extends Base {
  type: 'TEXT';
  p: Vec;
  h: number;
  text: string;
  rot: number;
}

export type Entity = LineEnt | CircleEnt | ArcEnt | PolylineEnt | TextEnt;
export type EntityType = Entity['type'];
/** Đối tượng chưa có id (dùng khi tạo mới). */
export type NewEntity = Entity extends infer E ? (E extends Entity ? Omit<E, 'id'> : never) : never;

export const ENTITY_TYPES: EntityType[] = ['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'TEXT'];

// ---------- Phân rã thành nguyên tố hình học ----------

export type Prim =
  | { k: 'seg'; a: Vec; b: Vec }
  | { k: 'arc'; c: Vec; r: number; start: number; end: number; full: boolean };

export function polySegments(e: PolylineEnt): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  for (let i = 0; i + 1 < e.pts.length; i++) out.push([e.pts[i], e.pts[i + 1]]);
  if (e.closed && e.pts.length > 2) out.push([e.pts[e.pts.length - 1], e.pts[0]]);
  return out;
}

/** Hộp bao quanh chữ (xấp xỉ: mỗi ký tự rộng 0,6 lần chiều cao). */
export function textCorners(e: TextEnt): Vec[] {
  const w = Math.max(1, e.text.length) * e.h * 0.6;
  const r = deg2rad(e.rot);
  const p0 = e.p;
  const p1 = polar(p0, r, w);
  const up: Vec = [-Math.sin(r) * e.h, Math.cos(r) * e.h];
  return [p0, p1, add(p1, up), add(p0, up)];
}

export function prims(e: Entity): Prim[] {
  switch (e.type) {
    case 'LINE':
      return [{ k: 'seg', a: e.a, b: e.b }];
    case 'CIRCLE':
      return [{ k: 'arc', c: e.c, r: e.r, start: 0, end: 360, full: true }];
    case 'ARC':
      return [{ k: 'arc', c: e.c, r: e.r, start: e.start, end: e.end, full: false }];
    case 'LWPOLYLINE':
      return polySegments(e).map(([a, b]) => ({ k: 'seg' as const, a, b }));
    case 'TEXT': {
      const c = textCorners(e);
      return c.map((p, i) => ({ k: 'seg' as const, a: p, b: c[(i + 1) % 4] }));
    }
  }
}

const onArc = (p: Vec, pr: Extract<Prim, { k: 'arc' }>): boolean =>
  pr.full || angleInArc(angleOf(sub(p, pr.c)), deg2rad(pr.start), deg2rad(pr.end));

function primIntersections(p: Prim, q: Prim): Vec[] {
  if (p.k === 'seg' && q.k === 'seg') {
    const x = segSegIntersection(p.a, p.b, q.a, q.b);
    return x ? [x] : [];
  }
  if (p.k === 'seg' && q.k === 'arc') return segCircleIntersections(p.a, p.b, q.c, q.r).filter((x) => onArc(x, q));
  if (p.k === 'arc' && q.k === 'seg') return primIntersections(q, p);
  if (p.k === 'arc' && q.k === 'arc')
    return circleCircleIntersections(p.c, p.r, q.c, q.r).filter((x) => onArc(x, p) && onArc(x, q));
  return [];
}

export function intersections(e1: Entity, e2: Entity): Vec[] {
  if (e1.type === 'TEXT' || e2.type === 'TEXT') return [];
  const out: Vec[] = [];
  for (const p of prims(e1)) for (const q of prims(e2)) out.push(...primIntersections(p, q));
  return out;
}

// ---------- Hộp bao ----------

export function arcEndpoints(e: ArcEnt): [Vec, Vec] {
  return [polar(e.c, deg2rad(e.start), e.r), polar(e.c, deg2rad(e.end), e.r)];
}

export function bbox(e: Entity): BBox {
  const b = emptyBox();
  switch (e.type) {
    case 'LINE':
      boxAdd(b, e.a);
      boxAdd(b, e.b);
      break;
    case 'CIRCLE':
      boxAdd(b, [e.c[0] - e.r, e.c[1] - e.r]);
      boxAdd(b, [e.c[0] + e.r, e.c[1] + e.r]);
      break;
    case 'ARC': {
      for (const p of arcEndpoints(e)) boxAdd(b, p);
      for (const q of [0, 90, 180, 270])
        if (angleInArc(deg2rad(q), deg2rad(e.start), deg2rad(e.end))) boxAdd(b, polar(e.c, deg2rad(q), e.r));
      break;
    }
    case 'LWPOLYLINE':
      for (const p of e.pts) boxAdd(b, p);
      break;
    case 'TEXT':
      for (const p of textCorners(e)) boxAdd(b, p);
      break;
  }
  return b;
}

// ---------- Chọn đối tượng ----------

/** Khoảng cách từ điểm p tới đối tượng (dùng khi bấm chọn). */
export function distanceTo(e: Entity, p: Vec): number {
  if (e.type === 'TEXT') {
    const c = textCorners(e);
    // Bấm vào trong khung chữ cũng tính là trúng.
    const inside = pointInPolygon(p, c);
    return inside ? 0 : Math.min(...c.map((q, i) => distToSegment(p, q, c[(i + 1) % 4])));
  }
  let best = Infinity;
  for (const pr of prims(e)) {
    if (pr.k === 'seg') best = Math.min(best, distToSegment(p, pr.a, pr.b));
    else {
      const ang = angleOf(sub(p, pr.c));
      if (onArc(polar(pr.c, ang, pr.r), pr)) best = Math.min(best, Math.abs(dist(p, pr.c) - pr.r));
      else {
        const s = polar(pr.c, deg2rad(pr.start), pr.r);
        const en = polar(pr.c, deg2rad(pr.end), pr.r);
        best = Math.min(best, dist(p, s), dist(p, en));
      }
    }
  }
  return best;
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Chọn kiểu Window (nằm trọn trong khung). */
export const insideBox = (e: Entity, box: BBox): boolean => boxInside(bbox(e), box);

/** Chọn kiểu Crossing (nằm trong hoặc cắt khung). */
export function touchesBox(e: Entity, box: BBox): boolean {
  if (!boxOverlap(bbox(e), box)) return false;
  if (insideBox(e, box)) return true;
  for (const pr of prims(e)) {
    if (pr.k === 'seg') {
      if (segTouchesBox(pr.a, pr.b, box)) return true;
    } else {
      const c: Vec[] = [
        [box.minX, box.minY],
        [box.maxX, box.minY],
        [box.maxX, box.maxY],
        [box.minX, box.maxY],
      ];
      for (let i = 0; i < 4; i++) if (primIntersections({ k: 'seg', a: c[i], b: c[(i + 1) % 4] }, pr).length) return true;
    }
  }
  return false;
}

// ---------- Điểm bắt (object snap) ----------

export type SnapKind = 'end' | 'mid' | 'center' | 'quad' | 'int' | 'near' | 'insert';
export interface SnapPoint {
  p: Vec;
  kind: SnapKind;
}

export function snapPoints(e: Entity): SnapPoint[] {
  const out: SnapPoint[] = [];
  switch (e.type) {
    case 'LINE':
      out.push({ p: e.a, kind: 'end' }, { p: e.b, kind: 'end' }, { p: mid(e.a, e.b), kind: 'mid' });
      break;
    case 'CIRCLE':
      out.push({ p: e.c, kind: 'center' });
      for (const q of [0, 90, 180, 270]) out.push({ p: polar(e.c, deg2rad(q), e.r), kind: 'quad' });
      break;
    case 'ARC': {
      const [s, en] = arcEndpoints(e);
      const span = ((e.end - e.start) % 360 + 360) % 360 || 360;
      out.push(
        { p: s, kind: 'end' },
        { p: en, kind: 'end' },
        { p: polar(e.c, deg2rad(e.start + span / 2), e.r), kind: 'mid' },
        { p: e.c, kind: 'center' },
      );
      break;
    }
    case 'LWPOLYLINE':
      for (const p of e.pts) out.push({ p, kind: 'end' });
      for (const [a, b] of polySegments(e)) out.push({ p: mid(a, b), kind: 'mid' });
      break;
    case 'TEXT':
      out.push({ p: e.p, kind: 'insert' });
      break;
  }
  return out;
}

/** Điểm gần nhất trên đối tượng (snap Nearest). */
export function nearestOn(e: Entity, p: Vec): Vec | null {
  let best: Vec | null = null;
  let bd = Infinity;
  for (const pr of prims(e)) {
    let q: Vec;
    if (pr.k === 'seg') q = closestOnSegment(p, pr.a, pr.b);
    else {
      q = polar(pr.c, angleOf(sub(p, pr.c)), pr.r);
      if (!onArc(q, pr)) continue;
    }
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

// ---------- Biến đổi ----------

type PtFn = (p: Vec) => Vec;

function mapPoints<E extends Entity>(e: E, f: PtFn): E {
  switch (e.type) {
    case 'LINE':
      return { ...e, a: f(e.a), b: f(e.b) };
    case 'LWPOLYLINE':
      return { ...e, pts: e.pts.map(f) };
    default:
      return e;
  }
}

export function moveEnt<E extends Entity>(e: E, d: Vec): E {
  const f: PtFn = (p) => add(p, d);
  if (e.type === 'CIRCLE' || e.type === 'ARC') return { ...e, c: f(e.c) };
  if (e.type === 'TEXT') return { ...e, p: f(e.p) };
  return mapPoints(e, f);
}

export function rotateEnt<E extends Entity>(e: E, base: Vec, angleDeg: number): E {
  const r = deg2rad(angleDeg);
  const f: PtFn = (p) => rotate(p, base, r);
  if (e.type === 'CIRCLE') return { ...e, c: f(e.c) };
  if (e.type === 'ARC') return { ...e, c: f(e.c), start: normDeg(e.start + angleDeg), end: normDeg(e.end + angleDeg) };
  if (e.type === 'TEXT') return { ...e, p: f(e.p), rot: normDeg(e.rot + angleDeg) };
  return mapPoints(e, f);
}

export function scaleEnt<E extends Entity>(e: E, base: Vec, k: number): E {
  const f: PtFn = (p) => scaleAbout(p, base, k);
  if (e.type === 'CIRCLE' || e.type === 'ARC') return { ...e, c: f(e.c), r: e.r * Math.abs(k) };
  if (e.type === 'TEXT') return { ...e, p: f(e.p), h: e.h * Math.abs(k) };
  return mapPoints(e, f);
}

export function mirrorEnt<E extends Entity>(e: E, a: Vec, b: Vec): E {
  const f: PtFn = (p) => mirrorPoint(p, a, b);
  if (e.type === 'CIRCLE') return { ...e, c: f(e.c) };
  if (e.type === 'ARC') {
    // Đối xứng đảo chiều cung: điểm cuối cũ thành điểm đầu mới.
    const [s, en] = arcEndpoints(e);
    const c = f(e.c);
    return {
      ...e,
      c,
      start: normDeg(rad2deg(angleOf(sub(f(en), c)))),
      end: normDeg(rad2deg(angleOf(sub(f(s), c)))),
    };
  }
  if (e.type === 'TEXT') {
    // Giữ chữ đọc được (giống MIRRTEXT=0): chỉ dời điểm chèn.
    return { ...e, p: f(e.p) };
  }
  return mapPoints(e, f);
}

export function normDeg(d: number): number {
  const t = d % 360;
  const r = t < 0 ? t + 360 : t;
  return Math.abs(r - 360) < 1e-9 ? 0 : r;
}

// ---------- Mô tả ----------

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const fp = (p: Vec) => `${fmt(p[0])}, ${fmt(p[1])}`;

export function polyLength(e: PolylineEnt): number {
  return polySegments(e).reduce((s, [a, b]) => s + dist(a, b), 0);
}

export function polyArea(pts: readonly Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function describe(e: Entity): string {
  const head = `${e.type} #${e.id} · lớp ${e.layer}${e.color !== undefined ? ` · màu ${e.color}` : ''}`;
  switch (e.type) {
    case 'LINE':
      return `${head} · từ ${fp(e.a)} đến ${fp(e.b)} · dài ${fmt(dist(e.a, e.b))}`;
    case 'CIRCLE':
      return `${head} · tâm ${fp(e.c)} · R = ${fmt(e.r)} · chu vi ${fmt(2 * Math.PI * e.r)} · diện tích ${fmt(Math.PI * e.r * e.r)}`;
    case 'ARC':
      return `${head} · tâm ${fp(e.c)} · R = ${fmt(e.r)} · góc ${fmt(e.start)}° → ${fmt(e.end)}°`;
    case 'LWPOLYLINE':
      return `${head} · ${e.pts.length} đỉnh · ${e.closed ? 'kín' : 'hở'} · dài ${fmt(polyLength(e))}${
        e.closed ? ` · diện tích ${fmt(polyArea(e.pts))}` : ''
      }`;
    case 'TEXT':
      return `${head} · "${e.text}" tại ${fp(e.p)} · cao ${fmt(e.h)} · xoay ${fmt(e.rot)}°`;
  }
}

export { fmt as fmtNum, fp as fmtPoint };
