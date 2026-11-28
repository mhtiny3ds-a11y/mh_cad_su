// Phân tích chuỗi nhập trên dòng lệnh: toạ độ tuyệt đối, tương đối, cực.

import { type Vec, add, deg2rad, polar } from './geom';

export type ParsedInput =
  | { kind: 'point'; p: Vec }
  | { kind: 'number'; n: number }
  | { kind: 'text'; s: string }
  | { kind: 'empty' };

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const RE_XY = new RegExp(`^(@)?\\s*(${NUM})\\s*,\\s*(${NUM})(?:\\s*,\\s*${NUM})?$`);
const RE_POLAR = new RegExp(`^(@)?\\s*(${NUM})\\s*<\\s*(${NUM})$`);
const RE_NUM = new RegExp(`^${NUM}$`);

/**
 * Hỗ trợ:
 *  - `x,y`      toạ độ tuyệt đối
 *  - `@dx,dy`   tương đối so với điểm trước
 *  - `@d<góc`   cực tương đối (góc theo độ)
 *  - `d<góc`    cực tuyệt đối (từ gốc toạ độ)
 *  - `số`       một số (khoảng cách / bán kính / góc tuỳ ngữ cảnh)
 */
export function parseInput(raw: string, last: Vec | null): ParsedInput {
  const s = raw.trim();
  if (!s) return { kind: 'empty' };
  let m = RE_XY.exec(s);
  if (m) {
    const v: Vec = [Number(m[2]), Number(m[3])];
    if (m[1]) return { kind: 'point', p: add(last ?? [0, 0], v) };
    return { kind: 'point', p: v };
  }
  m = RE_POLAR.exec(s);
  if (m) {
    const base: Vec = m[1] ? (last ?? [0, 0]) : [0, 0];
    return { kind: 'point', p: polar(base, deg2rad(Number(m[3])), Number(m[2])) };
  }
  if (RE_NUM.test(s)) return { kind: 'number', n: Number(s) };
  return { kind: 'text', s };
}

/** Chuẩn hoá điểm do API truyền vào: chấp nhận [x,y], {x,y}, "x,y". */
export function toVec(v: unknown, name = 'điểm'): Vec {
  if (Array.isArray(v) && v.length >= 2 && v.every((n, i) => i > 2 || typeof n === 'number')) {
    const p: Vec = [Number(v[0]), Number(v[1])];
    if (Number.isFinite(p[0]) && Number.isFinite(p[1])) return p;
  }
  if (v && typeof v === 'object' && 'x' in v && 'y' in v) {
    const o = v as { x: unknown; y: unknown };
    const p: Vec = [Number(o.x), Number(o.y)];
    if (Number.isFinite(p[0]) && Number.isFinite(p[1])) return p;
  }
  if (typeof v === 'string') {
    const r = parseInput(v, null);
    if (r.kind === 'point') return r.p;
  }
  throw new Error(`Giá trị ${name} không hợp lệ: ${JSON.stringify(v)} (cần [x, y])`);
}
