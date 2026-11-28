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
  boxUnion,
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
import { dimGeometry, dimText, measure } from './dim';
import { type PatLine, loopsBox, mapPatLine } from './hatch';

interface Base {
  id: number;
  layer: string;
  /** Mã màu ACI. Không có = theo layer (ByLayer). */
  color?: number;
  /** Kiểu đường. Không có = theo layer. */
  lt?: string;
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
  /** Tô đặc (mũi tên kích thước, SOLID nhập từ DXF). */
  fill?: boolean;
  /** Vùng che (WIPEOUT): tô bằng màu nền, che các đối tượng vẽ trước nó. */
  wipe?: boolean;
}
export interface TextEnt extends Base {
  type: 'TEXT';
  p: Vec;
  h: number;
  text: string;
  rot: number;
  /** Căn ngang: L trái (mặc định), C giữa, R phải. */
  ha?: 'L' | 'C' | 'R';
  /** Căn dọc: B chân chữ (mặc định), M giữa, T đỉnh chữ. */
  va?: 'B' | 'M' | 'T';
}

export interface DimStyle {
  txt: number;
  asz: number;
  exo: number;
  exe: number;
  gap: number;
  dec: number;
}

export type DimKind = 'linear' | 'aligned' | 'radius' | 'diameter' | 'angular' | 'ordinate' | 'arclen';

/**
 * Kích thước. Ý nghĩa của pts theo kind:
 *  - linear / aligned: [điểm 1, điểm 2, vị trí đường kích thước]; linear có rot (0° = ngang, 90° = đứng)
 *  - radius: [tâm, điểm trên đường tròn] · diameter: [điểm 1, điểm đối diện]
 *  - angular: [đỉnh góc, điểm trên cạnh 1, điểm trên cạnh 2, vị trí cung]
 *  - arclen (chiều dài cung): [tâm, đầu cung, cuối cung, vị trí đường kích thước]
 *  - ordinate (toạ độ): [điểm cần đo, đầu đường dẫn]; rot = 90 đo Y, còn lại đo X
 */
export interface DimEnt extends Base {
  type: 'DIMENSION';
  kind: DimKind;
  pts: Vec[];
  rot?: number;
  /** Ghi đè chữ; "<>" là giá trị đo. */
  text?: string;
  style: DimStyle;
}

export interface InsertEnt extends Base {
  type: 'INSERT';
  name: string;
  p: Vec;
  sx: number;
  sy: number;
  rot: number;
}

export interface HatchEnt extends Base {
  type: 'HATCH';
  /** Các vòng biên (đa giác). Đảo được xử lý theo quy tắc chẵn-lẻ. */
  loops: Vec[][];
  solid: boolean;
  /** Tên mẫu (để hiển thị / sửa); hình mẫu thực tế nằm ở lines. */
  pattern: string;
  scale: number;
  angle: number;
  lines: PatLine[];
}

/** Đường dựng vô hạn hai phía (XLINE) hoặc một phía (RAY, ray = true). dir là véc-tơ đơn vị. */
export interface XlineEnt extends Base {
  type: 'XLINE';
  p: Vec;
  dir: Vec;
  ray?: boolean;
}

/** Điểm (POINT). */
export interface PointEnt extends Base {
  type: 'POINT';
  p: Vec;
}

export type Entity = LineEnt | CircleEnt | ArcEnt | PolylineEnt | TextEnt | DimEnt | InsertEnt | HatchEnt | PointEnt | XlineEnt;
export type EntityType = Entity['type'];
/** Đối tượng chưa có id (dùng khi tạo mới). */
export type NewEntity = Entity extends infer E ? (E extends Entity ? Omit<E, 'id'> : never) : never;
type AnyEnt = Entity | NewEntity;

export const ENTITY_TYPES: EntityType[] = ['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'TEXT', 'DIMENSION', 'INSERT', 'HATCH', 'POINT', 'XLINE'];

// ---------- Block ----------

export interface BlockDef {
  name: string;
  base: Vec;
  ents: NewEntity[];
}

// Bản vẽ đang dùng đăng ký hàm tra block (một trang chỉ có một bản vẽ hoạt động).
let blockLookup: (name: string) => BlockDef | undefined = () => undefined;
export function setBlockLookup(fn: (name: string) => BlockDef | undefined): void {
  blockLookup = fn;
}
export const getBlock = (name: string): BlockDef | undefined => blockLookup(name);

/** Đặt một đối tượng của block vào vị trí của INSERT. */
export function placeInBlock<E extends AnyEnt>(e: E, ins: Pick<InsertEnt, 'p' | 'sx' | 'sy' | 'rot'>, base: Vec): E {
  let t: AnyEnt = moveEnt(e, [-base[0], -base[1]]);
  t = scaleXY(t, ins.sx, ins.sy);
  t = rotateEnt(t, [0, 0], ins.rot);
  return moveEnt(t, ins.p) as E;
}

/**
 * Phân rã đối tượng phức (INSERT, DIMENSION) thành đối tượng cơ bản để vẽ, chọn, bắt điểm.
 * Đối tượng cơ bản trả về chính nó.
 */
// Bộ nhớ đệm: đối tượng là bất biến (mỗi lần sửa tạo đối tượng mới), nên lưu theo chính đối tượng.
// Với INSERT còn kiểm tra định nghĩa block có đổi không.
const expandCache = new WeakMap<object, { def: BlockDef | undefined; out: NewEntity[] }>();
const bboxCache = new WeakMap<object, { def: BlockDef | undefined; b: BBox }>();

export function expand(e: AnyEnt, depth = 0): NewEntity[] {
  if (e.type !== 'DIMENSION' && e.type !== 'INSERT') return [e as NewEntity];
  const def = e.type === 'INSERT' ? blockLookup(e.name) : undefined;
  const c = expandCache.get(e);
  if (c && c.def === def) return c.out;
  const out = expandRaw(e, depth);
  expandCache.set(e, { def, out });
  return out;
}

function expandRaw(e: AnyEnt, depth: number): NewEntity[] {
  if (e.type === 'DIMENSION') return dimGeometry(e);
  if (e.type !== 'INSERT') return [e as NewEntity];
  if (depth > 8) return [];
  const b = blockLookup(e.name);
  if (!b) return [];
  const out: NewEntity[] = [];
  for (const x of b.ents) {
    const placed = placeInBlock(x, e, b.base);
    // Đối tượng ở layer "0" và màu ByBlock trong block lấy theo INSERT.
    const inherit = placed.layer === '0' ? { ...placed, layer: e.layer, ...(placed.color === undefined && e.color !== undefined ? { color: e.color } : {}) } : placed;
    out.push(...expand(inherit as NewEntity, depth + 1));
  }
  return out;
}

const isComplex = (e: AnyEnt): boolean => e.type === 'INSERT' || e.type === 'DIMENSION';

// ---------- Phân rã thành nguyên tố hình học ----------

export type Prim =
  | { k: 'seg'; a: Vec; b: Vec }
  | { k: 'arc'; c: Vec; r: number; start: number; end: number; full: boolean };

export function polySegments(e: Pick<PolylineEnt, 'pts' | 'closed'>): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  for (let i = 0; i + 1 < e.pts.length; i++) out.push([e.pts[i], e.pts[i + 1]]);
  if (e.closed && e.pts.length > 2) out.push([e.pts[e.pts.length - 1], e.pts[0]]);
  return out;
}

/** Độ dài nửa đường dựng dùng để tính toán (lớn hơn mọi bản vẽ thực tế). */
export const XLINE_FAR = 1e8;

/** Đoạn thẳng đại diện cho XLINE/RAY khi cắt, bắt điểm. */
export function xlineSeg(e: Pick<XlineEnt, 'p' | 'dir' | 'ray'>, far = XLINE_FAR): [Vec, Vec] {
  const b: Vec = [e.p[0] + e.dir[0] * far, e.p[1] + e.dir[1] * far];
  const a: Vec = e.ray ? e.p : [e.p[0] - e.dir[0] * far, e.p[1] - e.dir[1] * far];
  return [a, b];
}

/** Khoảng cách giữa hai dòng chữ, tính theo chiều cao chữ. */
export const LINE_SPACING = 1.6;

/** Các dòng của chữ nhiều dòng (MTEXT nhập vào dùng \n). */
export const textLines = (t: string): string[] => t.split('\n');

/** Chiều cao cả khối chữ. */
export const textBlockHeight = (e: Pick<TextEnt, 'h' | 'text'>): number => e.h * (1 + (textLines(e.text).length - 1) * LINE_SPACING);

/** Tách chữ nhiều dòng thành từng dòng, mỗi dòng có điểm chân chữ riêng (căn dọc B). */
export function textLineOrigins(e: Pick<TextEnt, 'p' | 'h' | 'text' | 'rot' | 'va'>): { text: string; p: Vec }[] {
  const lines = textLines(e.text);
  if (lines.length === 1) return [{ text: e.text, p: e.p }];
  const H = textBlockHeight(e);
  const top = e.va === 'T' ? 0 : e.va === 'M' ? H / 2 : H;
  const r = deg2rad(e.rot);
  const up: Vec = [-Math.sin(r), Math.cos(r)];
  return lines.map((text, i) => {
    const k = top - e.h - i * e.h * LINE_SPACING;
    return { text, p: [e.p[0] + up[0] * k, e.p[1] + up[1] * k] as Vec };
  });
}

/** Bốn góc khung chữ (xấp xỉ: mỗi ký tự rộng 0,6 lần chiều cao). Chữ nhiều dòng xếp từ trên xuống. */
export function textCorners(e: Pick<TextEnt, 'p' | 'h' | 'text' | 'rot' | 'ha' | 'va'>): Vec[] {
  const lines = textLines(e.text);
  const w = Math.max(1, ...lines.map((l) => l.length)) * e.h * 0.6;
  const H = textBlockHeight(e);
  const r = deg2rad(e.rot);
  const dx = e.ha === 'C' ? -w / 2 : e.ha === 'R' ? -w : 0;
  // Một dòng: B = chân chữ. Nhiều dòng: B = chân dòng cuối.
  const dy = e.va === 'M' ? -H / 2 : e.va === 'T' ? -H : 0;
  const along: Vec = [Math.cos(r), Math.sin(r)];
  const up: Vec = [-Math.sin(r), Math.cos(r)];
  const p0: Vec = [e.p[0] + along[0] * dx + up[0] * dy, e.p[1] + along[1] * dx + up[1] * dy];
  const p1 = polar(p0, r, w);
  const h: Vec = [up[0] * H, up[1] * H];
  return [p0, p1, add(p1, h), add(p0, h)];
}

export function prims(e: AnyEnt): Prim[] {
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
    case 'HATCH':
      return e.loops.flatMap((l) => l.map((p, i) => ({ k: 'seg' as const, a: p, b: l[(i + 1) % l.length] })));
    case 'POINT':
      return [{ k: 'seg', a: e.p, b: e.p }];
    case 'XLINE': {
      const [a, b] = xlineSeg(e);
      return [{ k: 'seg', a, b }];
    }
    default:
      return expand(e).flatMap((x) => (x.type === 'TEXT' ? [] : prims(x)));
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

export function intersections(e1: AnyEnt, e2: AnyEnt): Vec[] {
  const noInt = (e: AnyEnt) => e.type === 'TEXT' || e.type === 'HATCH' || e.type === 'POINT';
  if (noInt(e1) || noInt(e2)) return [];
  const out: Vec[] = [];
  for (const p of prims(e1)) for (const q of prims(e2)) out.push(...primIntersections(p, q));
  return out;
}

// ---------- Hộp bao ----------

export function arcEndpoints(e: Pick<ArcEnt, 'c' | 'r' | 'start' | 'end'>): [Vec, Vec] {
  return [polar(e.c, deg2rad(e.start), e.r), polar(e.c, deg2rad(e.end), e.r)];
}

export function bbox(e: AnyEnt): BBox {
  if (e.type === 'INSERT' || e.type === 'DIMENSION' || e.type === 'HATCH') {
    const def = e.type === 'INSERT' ? blockLookup(e.name) : undefined;
    const c = bboxCache.get(e);
    if (c && c.def === def) return c.b;
    const b = bboxRaw(e);
    bboxCache.set(e, { def, b });
    return b;
  }
  return bboxRaw(e);
}

function bboxRaw(e: AnyEnt): BBox {
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
    case 'HATCH':
      return loopsBox(e.loops);
    case 'POINT':
    case 'XLINE':
      // Đường dựng vô hạn: chỉ tính điểm gốc để "xem toàn bộ" không bị phóng vô cùng.
      boxAdd(b, e.p);
      break;
    default: {
      let u = b;
      for (const x of expand(e)) u = boxUnion(u, bbox(x));
      if (e.type === 'INSERT') boxAdd(u, e.p);
      return u;
    }
  }
  return b;
}

// ---------- Chọn đối tượng ----------

export function pointInPolygon(p: Vec, poly: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Khoảng cách từ điểm p tới đối tượng (dùng khi bấm chọn). */
export function distanceTo(e: AnyEnt, p: Vec): number {
  if (e.type === 'TEXT') {
    const c = textCorners(e);
    return pointInPolygon(p, c) ? 0 : Math.min(...c.map((q, i) => distToSegment(p, q, c[(i + 1) % 4])));
  }
  if (e.type === 'LWPOLYLINE' && (e.fill || e.wipe) && pointInPolygon(p, e.pts)) return 0;
  if (e.type === 'HATCH' && e.loops.filter((l) => pointInPolygon(p, l)).length % 2 === 1) return 0;
  if (e.type === 'POINT') return dist(p, e.p);
  if (isComplex(e)) {
    let best = Infinity;
    for (const x of expand(e)) best = Math.min(best, distanceTo(x, p));
    return best;
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

/** Chọn kiểu Window (nằm trọn trong khung). Đường dựng vô hạn không bao giờ nằm trọn. */
export const insideBox = (e: AnyEnt, box: BBox): boolean => e.type !== 'XLINE' && boxInside(bbox(e), box);

/** Chọn kiểu Crossing (nằm trong hoặc cắt khung). */
export function touchesBox(e: AnyEnt, box: BBox): boolean {
  if (e.type === 'XLINE') {
    const [a, b] = xlineSeg(e);
    return segTouchesBox(a, b, box);
  }
  if (!boxOverlap(bbox(e), box)) return false;
  if (insideBox(e, box)) return true;
  if (isComplex(e)) return expand(e).some((x) => touchesBox(x, box));
  const corners: Vec[] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];
  for (const pr of prims(e)) {
    if (pr.k === 'seg') {
      if (segTouchesBox(pr.a, pr.b, box)) return true;
    } else {
      for (let i = 0; i < 4; i++) if (primIntersections({ k: 'seg', a: corners[i], b: corners[(i + 1) % 4] }, pr).length) return true;
    }
  }
  return false;
}

// ---------- Điểm bắt (object snap) ----------

export type SnapKind = 'end' | 'mid' | 'center' | 'quad' | 'int' | 'near' | 'insert' | 'perp' | 'node' | 'tan';
export interface SnapPoint {
  p: Vec;
  kind: SnapKind;
}

export function snapPoints(e: AnyEnt): SnapPoint[] {
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
    case 'DIMENSION':
      for (const p of e.pts) out.push({ p, kind: 'node' });
      break;
    case 'POINT':
      out.push({ p: e.p, kind: 'node' });
      break;
    case 'XLINE':
      out.push({ p: e.p, kind: e.ray ? 'end' : 'mid' });
      break;
    case 'HATCH':
      break;
    case 'INSERT':
      out.push({ p: e.p, kind: 'insert' });
      for (const x of expand(e)) out.push(...snapPoints(x));
      break;
  }
  return out;
}

/** Điểm gần nhất trên đối tượng (snap Nearest). */
export function nearestOn(e: AnyEnt, p: Vec): Vec | null {
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

/** Chân đường vuông góc hạ từ `from` xuống đối tượng (snap Perpendicular). */
export function perpendicularFoot(e: AnyEnt, from: Vec, near: Vec): Vec | null {
  let best: Vec | null = null;
  let bd = Infinity;
  for (const pr of prims(e)) {
    let q: Vec | null = null;
    if (pr.k === 'seg') {
      const d = sub(pr.b, pr.a);
      const l2 = d[0] * d[0] + d[1] * d[1];
      if (l2 < 1e-18) continue;
      const t = ((from[0] - pr.a[0]) * d[0] + (from[1] - pr.a[1]) * d[1]) / l2;
      if (t < -1e-9 || t > 1 + 1e-9) continue;
      q = [pr.a[0] + d[0] * t, pr.a[1] + d[1] * t];
    } else {
      const ang = angleOf(sub(from, pr.c));
      for (const a of [ang, ang + Math.PI]) {
        const x = polar(pr.c, a, pr.r);
        if (onArc(x, pr) && (!q || dist(x, near) < dist(q, near))) q = x;
      }
    }
    if (q) {
      const d = dist(q, near);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
  }
  return best;
}

/** Tiếp điểm của đường thẳng kẻ từ `from` tới đường tròn / cung (snap Tangent). */
export function tangentPoints(e: AnyEnt, from: Vec): Vec[] {
  if (e.type !== 'CIRCLE' && e.type !== 'ARC') return [];
  const d = dist(from, e.c);
  if (d <= e.r + 1e-9) return [];
  const base = angleOf(sub(from, e.c));
  const t = Math.acos(e.r / d);
  const out = [polar(e.c, base + t, e.r), polar(e.c, base - t, e.r)];
  return e.type === 'ARC' ? out.filter((p) => angleInArc(angleOf(sub(p, e.c)), deg2rad(e.start), deg2rad(e.end))) : out;
}

// ---------- Grip (điểm nắm để sửa nhanh) ----------

export function gripPoints(e: AnyEnt): Vec[] {
  switch (e.type) {
    case 'LINE':
      return [e.a, mid(e.a, e.b), e.b];
    case 'CIRCLE':
      return [e.c, ...[0, 90, 180, 270].map((q) => polar(e.c, deg2rad(q), e.r))];
    case 'ARC': {
      const [s, en] = arcEndpoints(e);
      const span = normDeg(e.end - e.start) || 360;
      return [s, polar(e.c, deg2rad(e.start + span / 2), e.r), en, e.c];
    }
    case 'LWPOLYLINE':
      return [...e.pts];
    case 'TEXT':
      return [e.p];
    case 'DIMENSION':
      return [...e.pts];
    case 'INSERT':
    case 'POINT':
      return [e.p];
    case 'XLINE':
      return [e.p, add(e.p, e.dir)];
    case 'HATCH': {
      const b = loopsBox(e.loops);
      return [[(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]];
    }
  }
}

/** Kéo grip thứ i tới điểm to. */
export function applyGrip<E extends AnyEnt>(e: E, i: number, to: Vec): E {
  switch (e.type) {
    case 'LINE':
      if (i === 0) return { ...e, a: to };
      if (i === 2) return { ...e, b: to };
      return moveEnt(e, sub(to, mid(e.a, e.b)));
    case 'CIRCLE':
      if (i === 0) return { ...e, c: to };
      return { ...e, r: Math.max(dist(e.c, to), 1e-9) };
    case 'ARC': {
      if (i === 3) return { ...e, c: to };
      const g = gripPoints(e);
      const pts = [g[0], g[1], g[2]];
      pts[i] = to;
      const c3 = circle3(pts[0], pts[1], pts[2]);
      if (!c3) return e;
      const a1 = rad2deg(angleOf(sub(pts[0], c3.c)));
      const a2 = rad2deg(angleOf(sub(pts[1], c3.c)));
      const a3 = rad2deg(angleOf(sub(pts[2], c3.c)));
      const ccw = normDeg(a2 - a1) <= normDeg(a3 - a1);
      return ccw
        ? { ...e, c: c3.c, r: c3.r, start: normDeg(a1), end: normDeg(a3) }
        : { ...e, c: c3.c, r: c3.r, start: normDeg(a3), end: normDeg(a1) };
    }
    case 'LWPOLYLINE': {
      const pts = [...e.pts];
      pts[i] = to;
      return { ...e, pts };
    }
    case 'TEXT':
    case 'INSERT':
    case 'POINT':
      return { ...e, p: to };
    case 'HATCH':
      return moveEnt(e, sub(to, gripPoints(e)[0]));
    case 'XLINE': {
      if (i === 0) return { ...e, p: to };
      const d = sub(to, e.p);
      const L = Math.hypot(d[0], d[1]);
      return L > 1e-12 ? { ...e, dir: [d[0] / L, d[1] / L] } : e;
    }
    case 'DIMENSION': {
      const pts = [...e.pts];
      pts[i] = to;
      return { ...e, pts };
    }
  }
  return e;
}

function circle3(p1: Vec, p2: Vec, p3: Vec): { c: Vec; r: number } | null {
  const d = 2 * (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = p1[0] ** 2 + p1[1] ** 2;
  const b2 = p2[0] ** 2 + p2[1] ** 2;
  const c2 = p3[0] ** 2 + p3[1] ** 2;
  const c: Vec = [
    (a2 * (p2[1] - p3[1]) + b2 * (p3[1] - p1[1]) + c2 * (p1[1] - p2[1])) / d,
    (a2 * (p3[0] - p2[0]) + b2 * (p1[0] - p3[0]) + c2 * (p2[0] - p1[0])) / d,
  ];
  return { c, r: dist(c, p1) };
}

// ---------- Biến đổi ----------

type PtFn = (p: Vec) => Vec;

function mapPts<E extends AnyEnt>(e: E, f: PtFn): E {
  switch (e.type) {
    case 'LINE':
      return { ...e, a: f(e.a), b: f(e.b) };
    case 'LWPOLYLINE':
    case 'DIMENSION':
      return { ...e, pts: e.pts.map(f) };
    case 'CIRCLE':
    case 'ARC':
      return { ...e, c: f(e.c) };
    case 'TEXT':
    case 'INSERT':
    case 'POINT':
      return { ...e, p: f(e.p) };
    case 'HATCH':
      return { ...e, loops: e.loops.map((l) => l.map(f)), lines: e.lines.map((l) => mapPatLine(l, f)) };
    case 'XLINE': {
      const p = f(e.p);
      const d = sub(f(add(e.p, e.dir)), p);
      const L = Math.hypot(d[0], d[1]) || 1;
      return { ...e, p, dir: [d[0] / L, d[1] / L] };
    }
  }
  return e;
}

export function moveEnt<E extends AnyEnt>(e: E, d: Vec): E {
  return mapPts(e, (p) => add(p, d));
}

export function rotateEnt<E extends AnyEnt>(e: E, base: Vec, angleDeg: number): E {
  if (!angleDeg) return e;
  const t = mapPts(e, (p) => rotate(p, base, deg2rad(angleDeg)));
  switch (t.type) {
    case 'ARC':
      return { ...t, start: normDeg(t.start + angleDeg), end: normDeg(t.end + angleDeg) };
    case 'TEXT':
    case 'INSERT':
      return { ...t, rot: normDeg(t.rot + angleDeg) };
    case 'HATCH':
      return { ...t, angle: normDeg(t.angle + angleDeg) };
    case 'DIMENSION':
      return t.kind === 'linear' ? { ...t, rot: normDeg((t.rot ?? 0) + angleDeg) } : t;
  }
  return t;
}

export function scaleEnt<E extends AnyEnt>(e: E, base: Vec, k: number): E {
  const t = mapPts(e, (p) => scaleAbout(p, base, k));
  const a = Math.abs(k);
  switch (t.type) {
    case 'CIRCLE':
    case 'ARC':
      return { ...t, r: t.r * a };
    case 'TEXT':
      return { ...t, h: t.h * a };
    case 'INSERT':
      return { ...t, sx: t.sx * a, sy: t.sy * a };
    case 'HATCH':
      return { ...t, scale: t.scale * a };
  }
  return t;
}

/** Tỉ lệ theo hai trục quanh gốc toạ độ (dùng khi đặt block). Đường tròn/chữ dùng |sx|. */
export function scaleXY<E extends AnyEnt>(e: E, sx: number, sy: number): E {
  if (sx === 1 && sy === 1) return e;
  let t: AnyEnt = e;
  if (sx < 0) t = mirrorEnt(t, [0, 0], [0, 1]);
  if (sy < 0) t = mirrorEnt(t, [0, 0], [1, 0]);
  const ax = Math.abs(sx);
  const ay = Math.abs(sy);
  if (Math.abs(ax - ay) < 1e-12) return scaleEnt(t, [0, 0], ax) as E;
  // Không đều: điểm tỉ lệ theo trục; bán kính/chiều cao lấy trung bình.
  const m = mapPts(t, (p) => [p[0] * ax, p[1] * ay]);
  const k = (ax + ay) / 2;
  switch (m.type) {
    case 'CIRCLE':
    case 'ARC':
      return { ...m, r: m.r * k } as E;
    case 'TEXT':
      return { ...m, h: m.h * ay } as E;
    case 'INSERT':
      return { ...m, sx: m.sx * ax, sy: m.sy * ay } as E;
  }
  return m as E;
}

export function mirrorEnt<E extends AnyEnt>(e: E, a: Vec, b: Vec): E {
  const f: PtFn = (p) => mirrorPoint(p, a, b);
  const axis = rad2deg(angleOf(sub(b, a)));
  switch (e.type) {
    case 'ARC': {
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
    case 'TEXT':
      // Giữ chữ đọc được (giống MIRRTEXT = 0): chỉ dời điểm chèn.
      return { ...e, p: f(e.p) };
    case 'INSERT':
      return { ...e, p: f(e.p), rot: normDeg(2 * axis - e.rot), sy: -e.sy };
    case 'DIMENSION': {
      const pts = e.pts.map(f);
      return e.kind === 'linear' ? { ...e, pts, rot: normDeg(2 * axis - (e.rot ?? 0)) } : { ...e, pts };
    }
  }
  return mapPts(e, f);
}

export function normDeg(d: number): number {
  const t = d % 360;
  const r = t < 0 ? t + 360 : t;
  return Math.abs(r - 360) < 1e-9 ? 0 : r;
}

// ---------- Mô tả ----------

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const fp = (p: Vec) => `${fmt(p[0])}, ${fmt(p[1])}`;

export function polyLength(e: Pick<PolylineEnt, 'pts' | 'closed'>): number {
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
  const head = `${e.type} #${e.id} · lớp ${e.layer}${e.color !== undefined ? ` · màu ${e.color}` : ''}${e.lt ? ` · nét ${e.lt}` : ''}`;
  switch (e.type) {
    case 'LINE':
      return `${head} · từ ${fp(e.a)} đến ${fp(e.b)} · dài ${fmt(dist(e.a, e.b))} · góc ${fmt(normDeg(rad2deg(angleOf(sub(e.b, e.a)))))}°`;
    case 'CIRCLE':
      return `${head} · tâm ${fp(e.c)} · R = ${fmt(e.r)} · chu vi ${fmt(2 * Math.PI * e.r)} · diện tích ${fmt(Math.PI * e.r * e.r)}`;
    case 'ARC': {
      const sw = normDeg(e.end - e.start) || 360;
      return `${head} · tâm ${fp(e.c)} · R = ${fmt(e.r)} · góc ${fmt(e.start)}° → ${fmt(e.end)}° · dài cung ${fmt((sw * Math.PI * e.r) / 180)}`;
    }
    case 'LWPOLYLINE':
      return `${head} · ${e.pts.length} đỉnh · ${e.closed ? 'kín' : 'hở'} · dài ${fmt(polyLength(e))}${
        e.closed ? ` · diện tích ${fmt(polyArea(e.pts))}` : ''
      }`;
    case 'TEXT':
      return `${head} · "${e.text}" tại ${fp(e.p)} · cao ${fmt(e.h)} · xoay ${fmt(e.rot)}°`;
    case 'DIMENSION':
      return `${head} · kích thước ${e.kind} · giá trị ${fmt(measure(e))} · chữ "${dimText(e)}"`;
    case 'INSERT':
      return `${head} · block "${e.name}" tại ${fp(e.p)} · tỉ lệ ${fmt(e.sx)} × ${fmt(e.sy)} · xoay ${fmt(e.rot)}°`;
    case 'HATCH':
      return `${head} · mẫu ${e.pattern} · tỉ lệ ${fmt(e.scale)} · góc ${fmt(e.angle)}° · ${e.loops.length} vòng biên · diện tích ${fmt(hatchArea(e))}`;
    case 'POINT':
      return `${head} · tại ${fp(e.p)}`;
    case 'XLINE':
      return `${head} · ${e.ray ? 'tia (RAY)' : 'đường dựng (XLINE)'} qua ${fp(e.p)} · góc ${fmt(normDeg(rad2deg(angleOf(e.dir))))}°`;
  }
}

export { fmt as fmtNum, fp as fmtPoint };

/** Diện tích vùng tô (trừ đảo theo quy tắc chẵn-lẻ). */
export function hatchArea(e: Pick<HatchEnt, 'loops'>): number {
  return e.loops.reduce((s, l) => {
    const depth = e.loops.filter((o) => o !== l && pointInPolygon(l[0], o)).length;
    return s + (depth % 2 ? -1 : 1) * polyArea(l);
  }, 0);
}
