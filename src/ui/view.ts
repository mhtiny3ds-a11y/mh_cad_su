// Khung nhìn (toạ độ thế giới ↔ màn hình) và vẽ bằng Canvas 2D.
// Trục Y thế giới hướng lên, trục Y màn hình hướng xuống.

import type { BBox, Vec } from '../core/geom';
import { deg2rad } from '../core/geom';
import type { Drawing } from '../core/document';
import { type Entity, type NewEntity, type SnapKind, bbox, expand, gripPoints } from '../core/entities';
import { hatchSegments } from '../core/hatch';

export class Viewport {
  /** Số pixel (CSS) trên một đơn vị bản vẽ. */
  scale = 0.1;
  /** Điểm thế giới nằm ở giữa màn hình. */
  cx = 5000;
  cy = 3000;
  w = 800;
  h = 600;

  toScreen(p: Vec): Vec {
    return [(p[0] - this.cx) * this.scale + this.w / 2, this.h / 2 - (p[1] - this.cy) * this.scale];
  }

  toWorld(sx: number, sy: number): Vec {
    return [(sx - this.w / 2) / this.scale + this.cx, (this.h / 2 - sy) / this.scale + this.cy];
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorld(sx, sy);
    this.scale = Math.min(1e6, Math.max(1e-6, this.scale * factor));
    const after = this.toWorld(sx, sy);
    this.cx += before[0] - after[0];
    this.cy += before[1] - after[1];
  }

  panPx(dx: number, dy: number): void {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }

  fit(b: BBox, margin = 0.08): void {
    const bw = Math.max(b.maxX - b.minX, 1e-6);
    const bh = Math.max(b.maxY - b.minY, 1e-6);
    this.scale = Math.min((this.w * (1 - 2 * margin)) / bw, (this.h * (1 - 2 * margin)) / bh);
    if (!Number.isFinite(this.scale) || this.scale <= 0) this.scale = 1;
    this.cx = (b.minX + b.maxX) / 2;
    this.cy = (b.minY + b.maxY) / 2;
  }

  worldBox(): BBox {
    const a = this.toWorld(0, this.h);
    const b = this.toWorld(this.w, 0);
    return { minX: a[0], minY: a[1], maxX: b[0], maxY: b[1] };
  }
}

// ---------- Màu ----------

const ACI_BASE: Record<number, string> = {
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  8: '#808080',
  9: '#c0c0c0',
};

/** Đổi mã màu ACI sang CSS. Màu 7 đổi theo nền (trắng trên nền tối, đen trên nền sáng). */
// Trên nền sáng, các màu quá sáng (vàng, lục lam, xanh lá) được làm đậm hơn để dễ đọc.
const ACI_ON_LIGHT: Record<number, string> = { 2: '#b8a000', 3: '#00a020', 4: '#0097a7', 6: '#c000c0' };

export function aciToCss(i: number, fg: string): string {
  if (i === 7 || i <= 0 || i > 255) return fg;
  const lightBg = /^#[0-3]/.test(fg);
  if (lightBg && ACI_ON_LIGHT[i]) return ACI_ON_LIGHT[i];
  if (ACI_BASE[i]) return ACI_BASE[i];
  if (i >= 250) {
    const v = Math.round(51 + ((i - 250) * (255 - 51)) / 5);
    return `rgb(${v},${v},${v})`;
  }
  // Bảng 10–249: 24 sắc độ × 10 biến thể (đậm/nhạt, sáng/tối) — xấp xỉ.
  const hue = Math.floor((i - 10) / 10) * 15;
  const k = (i - 10) % 10;
  const light = [50, 50, 40, 40, 30, 30, 25, 25, 15, 15][k];
  const sat = k % 2 === 0 ? 100 : 50;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

// ---------- Vẽ ----------

export interface Theme {
  bg: string;
  fg: string;
  grid: string;
  gridMajor: string;
  accent: string;
  select: string;
  preview: string;
  snap: string;
  windowFill: string;
  crossFill: string;
}

export interface RenderState {
  doc: Drawing;
  vp: Viewport;
  theme: Theme;
  showGrid: boolean;
  selection: Set<number>;
  hover: number | null;
  preview: NewEntity[];
  cursor: Vec | null;
  snap: { p: Vec; kind: SnapKind } | null;
  box: { a: Vec; b: Vec } | null;
  pickbox: boolean;
  pickSize: number;
  /** Hiện điểm nắm (grip) của đối tượng đang chọn. */
  grips: boolean;
  hotGrip: { id: number; i: number } | null;
  /** Thống kê lần vẽ gần nhất (ghi ra). */
  stats?: { drawn: number; total: number; collectMs?: number; flushMs?: number; batches?: number };
}

function niceStep(minWorld: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(minWorld)));
  for (const m of [1, 2, 5, 10]) if (p * m >= minWorld) return p * m;
  return p * 10;
}

function drawGrid(g: CanvasRenderingContext2D, s: RenderState): void {
  const { vp, theme } = s;
  const step = niceStep(14 / vp.scale);
  const major = step * 5;
  const wb = vp.worldBox();
  const lines = (st: number, color: string) => {
    g.strokeStyle = color;
    g.beginPath();
    for (let x = Math.ceil(wb.minX / st) * st; x <= wb.maxX; x += st) {
      const sx = Math.round(vp.toScreen([x, 0])[0]) + 0.5;
      g.moveTo(sx, 0);
      g.lineTo(sx, vp.h);
    }
    for (let y = Math.ceil(wb.minY / st) * st; y <= wb.maxY; y += st) {
      const sy = Math.round(vp.toScreen([0, y])[1]) + 0.5;
      g.moveTo(0, sy);
      g.lineTo(vp.w, sy);
    }
    g.stroke();
  };
  g.lineWidth = 1;
  lines(step, theme.grid);
  lines(major, theme.gridMajor);
}

/** Gom nét cùng kiểu (màu, nét đứt, độ dày) thành một Path2D để vẽ một lần — nhanh hơn nhiều với bản vẽ lớn. */
class Batch {
  strokes = new Map<string, { color: string; dash: number[]; width: number; path: Path2D }>();
  fills = new Map<string, Path2D>();
  texts: { e: NewEntity & { type: 'TEXT' }; color: string }[] = [];

  stroke(color: string, dash: number[], width: number): Path2D {
    const k = `${color}|${dash.join(',')}|${width}`;
    let v = this.strokes.get(k);
    if (!v) this.strokes.set(k, (v = { color, dash, width, path: new Path2D() }));
    return v.path;
  }

  fill(color: string): Path2D {
    let p = this.fills.get(color);
    if (!p) this.fills.set(color, (p = new Path2D()));
    return p;
  }

  flush(g: CanvasRenderingContext2D, vp: Viewport): void {
    for (const [color, path] of this.fills) {
      g.fillStyle = color;
      g.fill(path, 'evenodd');
    }
    for (const v of this.strokes.values()) {
      g.strokeStyle = v.color;
      g.lineWidth = v.width;
      g.setLineDash(v.dash);
      g.stroke(v.path);
    }
    g.setLineDash([]);
    for (const t of this.texts) drawText(g, t.e, vp, t.color);
    this.strokes.clear();
    this.fills.clear();
    this.texts = [];
  }
}

function addPath(p: Path2D, e: NewEntity | Entity, vp: Viewport): void {
  switch (e.type) {
    case 'LINE': {
      const a = vp.toScreen(e.a);
      const b = vp.toScreen(e.b);
      p.moveTo(a[0], a[1]);
      p.lineTo(b[0], b[1]);
      break;
    }
    case 'CIRCLE': {
      const c = vp.toScreen(e.c);
      const r = Math.max(e.r * vp.scale, 0.5);
      p.moveTo(c[0] + r, c[1]);
      p.arc(c[0], c[1], r, 0, Math.PI * 2);
      break;
    }
    case 'ARC': {
      const c = vp.toScreen(e.c);
      const r = Math.max(e.r * vp.scale, 0.5);
      // Màn hình lật trục Y → góc âm và vẽ theo chiều kim đồng hồ.
      const a0 = -deg2rad(e.start);
      p.moveTo(c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0));
      p.arc(c[0], c[1], r, a0, -deg2rad(e.end), true);
      break;
    }
    case 'LWPOLYLINE': {
      const n = e.pts.length;
      if (!n) break;
      const q0 = vp.toScreen(e.pts[0]);
      p.moveTo(q0[0], q0[1]);
      for (let i = 1; i < n; i++) {
        const q = vp.toScreen(e.pts[i]);
        p.lineTo(q[0], q[1]);
      }
      // Không dùng closePath(): với Path2D lớn trong Chromium, closePath làm việc dựng đường chậm đi rất nhiều.
      if (e.closed) p.lineTo(q0[0], q0[1]);
      break;
    }
  }
}

function drawText(g: CanvasRenderingContext2D, e: NewEntity & { type: 'TEXT' }, vp: Viewport, color: string): void {
  const px = e.h * vp.scale;
  const p = vp.toScreen(e.p);
  if (px < 1.5) {
    // Chữ quá nhỏ: vẽ một vạch thay thế cho nhẹ.
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    const w = Math.max(1, e.text.length * px * 0.6);
    const x0 = e.ha === 'C' ? p[0] - w / 2 : e.ha === 'R' ? p[0] - w : p[0];
    g.moveTo(x0, p[1]);
    g.lineTo(x0 + w, p[1]);
    g.stroke();
    return;
  }
  g.save();
  g.translate(p[0], p[1]);
  g.rotate(-deg2rad(e.rot));
  g.fillStyle = color;
  g.font = `${px}px "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif`;
  g.textAlign = e.ha === 'C' ? 'center' : e.ha === 'R' ? 'right' : 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(e.text, 0, e.va === 'M' ? px / 2 : e.va === 'T' ? px : 0);
  g.restore();
}

/** Nét đứt theo kiểu đường (đơn vị bản vẽ × LTSCALE → pixel). */
function dashFor(pattern: number[], ltscale: number, scale: number): number[] {
  if (!pattern.length) return [];
  const px = pattern.map((x) => Math.abs(x) * ltscale * scale);
  const period = px.reduce((a, b) => a + b, 0);
  if (period < 6 || period > 1e5) return [];
  return pattern.map((x, i) => (x === 0 ? 1 : Math.max(px[i], 1)));
}

// Đoạn nét mẫu của HATCH (lưu đệm theo đối tượng; null = quá dày để vẽ từng nét).
const hatchCache = new WeakMap<object, [Vec, Vec][] | null>();
function hatchSegs(e: NewEntity & { type: 'HATCH' }): [Vec, Vec][] | null {
  if (hatchCache.has(e)) return hatchCache.get(e)!;
  const segs = hatchSegments(e.loops, e.lines, 3000);
  hatchCache.set(e, segs);
  return segs;
}

/** Đưa một đối tượng (block, kích thước được phân rã) vào lô vẽ, màu theo đối tượng/layer. */
function queueEntity(b: Batch, e: NewEntity | Entity, s: RenderState, override: string | null, width: number): void {
  const { doc, vp, theme } = s;
  if (e.type === 'INSERT' || e.type === 'DIMENSION') {
    for (const x of expand(e)) {
      if (doc.layers.get(x.layer)?.visible === false) continue;
      queueEntity(b, x, s, override, width);
    }
    return;
  }
  const layer = doc.layers.get(e.layer);
  const color = override ?? aciToCss(e.color ?? layer?.color ?? 7, theme.fg);
  switch (e.type) {
    case 'TEXT':
      b.texts.push({ e, color });
      return;
    case 'POINT': {
      const q = vp.toScreen(e.p);
      b.fill(color).rect(q[0] - 1.5, q[1] - 1.5, 3, 3);
      return;
    }
    case 'HATCH': {
      if (e.solid) {
        const p = b.fill(override ? hexAlpha(color, 0.45) : color);
        for (const l of e.loops) addPath(p, { type: 'LWPOLYLINE', pts: l, closed: true, layer: '' }, vp);
        return;
      }
      // Nét mẫu quá dày so với màn hình → tô mờ thay cho từng nét.
      const spacingPx = Math.min(...e.lines.map((l) => Math.abs(l.offset[0] * -Math.sin(deg2rad(l.angle)) + l.offset[1] * Math.cos(deg2rad(l.angle))))) * vp.scale;
      const segs = spacingPx >= 2 ? hatchSegs(e) : null;
      if (!segs) {
        const p = b.fill(hexAlpha(color, 0.25));
        for (const l of e.loops) addPath(p, { type: 'LWPOLYLINE', pts: l, closed: true, layer: '' }, vp);
        return;
      }
      const p = b.stroke(color, override ? [6, 4] : [], 1);
      for (const [a, c] of segs) {
        const q1 = vp.toScreen(a);
        const q2 = vp.toScreen(c);
        p.moveTo(q1[0], q1[1]);
        p.lineTo(q2[0], q2[1]);
      }
      return;
    }
    case 'LWPOLYLINE':
      if (e.fill) {
        addPath(b.fill(color), e, vp);
        return;
      }
  }
  const dash = override ? [6, 4] : dashFor(doc.linePattern(e), doc.ltscale, vp.scale);
  addPath(b.stroke(color, dash, width), e, vp);
}

function hexAlpha(color: string, a: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return color;
}

function drawSnapMarker(g: CanvasRenderingContext2D, p: Vec, kind: SnapKind, color: string): void {
  const s = 6;
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  switch (kind) {
    case 'end':
      g.rect(p[0] - s, p[1] - s, 2 * s, 2 * s);
      break;
    case 'mid':
      g.moveTo(p[0], p[1] - s);
      g.lineTo(p[0] + s, p[1] + s);
      g.lineTo(p[0] - s, p[1] + s);
      g.closePath();
      break;
    case 'center':
      g.arc(p[0], p[1], s, 0, Math.PI * 2);
      break;
    case 'quad':
      g.moveTo(p[0], p[1] - s);
      g.lineTo(p[0] + s, p[1]);
      g.lineTo(p[0], p[1] + s);
      g.lineTo(p[0] - s, p[1]);
      g.closePath();
      break;
    case 'int':
      g.moveTo(p[0] - s, p[1] - s);
      g.lineTo(p[0] + s, p[1] + s);
      g.moveTo(p[0] + s, p[1] - s);
      g.lineTo(p[0] - s, p[1] + s);
      break;
    case 'near':
      g.moveTo(p[0] - s, p[1] - s);
      g.lineTo(p[0] + s, p[1] - s);
      g.lineTo(p[0] - s, p[1] + s);
      g.lineTo(p[0] + s, p[1] + s);
      g.closePath();
      break;
    case 'insert':
      g.rect(p[0] - s, p[1] - s, 2 * s, 2 * s);
      g.moveTo(p[0] - s, p[1]);
      g.lineTo(p[0] + s, p[1]);
      break;
    case 'perp':
      g.moveTo(p[0] - s, p[1] - s);
      g.lineTo(p[0] - s, p[1] + s);
      g.lineTo(p[0] + s, p[1] + s);
      g.moveTo(p[0] - s, p[1]);
      g.lineTo(p[0], p[1]);
      g.lineTo(p[0], p[1] + s);
      break;
    case 'node':
      g.arc(p[0], p[1], s, 0, Math.PI * 2);
      g.moveTo(p[0] - s, p[1] - s);
      g.lineTo(p[0] + s, p[1] + s);
      g.moveTo(p[0] + s, p[1] - s);
      g.lineTo(p[0] - s, p[1] + s);
      break;
  }
  g.stroke();
  g.restore();
}

function drawAxisIcon(g: CanvasRenderingContext2D, h: number, color: string): void {
  const o: Vec = [18, h - 18];
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(o[0], o[1]);
  g.lineTo(o[0] + 34, o[1]);
  g.moveTo(o[0], o[1]);
  g.lineTo(o[0], o[1] - 34);
  g.stroke();
  g.font = '11px system-ui, sans-serif';
  g.fillText('X', o[0] + 38, o[1] + 4);
  g.fillText('Y', o[0] - 3, o[1] - 40);
  g.restore();
}

export function render(g: CanvasRenderingContext2D, s: RenderState): void {
  const { vp, theme, doc } = s;
  g.fillStyle = theme.bg;
  g.fillRect(0, 0, vp.w, vp.h);
  if (s.showGrid) drawGrid(g, s);

  // Trục toạ độ gốc.
  g.lineWidth = 1;
  const o = vp.toScreen([0, 0]);
  g.strokeStyle = theme.gridMajor;
  g.setLineDash([4, 4]);
  g.beginPath();
  g.moveTo(o[0], 0);
  g.lineTo(o[0], vp.h);
  g.moveTo(0, o[1]);
  g.lineTo(vp.w, o[1]);
  g.stroke();
  g.setLineDash([]);

  const view = vp.worldBox();
  const pad = 2 / vp.scale;
  const batch = new Batch();
  let drawn = 0;
  const tc = performance.now();
  for (const e of doc.visible()) {
    const b = bbox(e);
    if (b.maxX < view.minX - pad || b.minX > view.maxX + pad || b.maxY < view.minY - pad || b.minY > view.maxY + pad) continue;
    drawn++;
    // Đối tượng quá nhỏ trên màn hình (< 1 px) vẽ thành một chấm.
    if ((b.maxX - b.minX) * vp.scale < 1 && (b.maxY - b.minY) * vp.scale < 1 && e.type !== 'TEXT') {
      const q = vp.toScreen([b.minX, b.minY]);
      batch.fill(aciToCss(e.color ?? doc.layers.get(e.layer)?.color ?? 7, theme.fg)).rect(q[0], q[1] - 1, 1, 1);
      continue;
    }
    const sel = s.selection.has(e.id);
    queueEntity(batch, e, s, sel ? theme.select : null, s.hover === e.id ? 2.5 : 1);
  }
  const tf = performance.now();
  batch.flush(g, vp);
  s.stats = { drawn, total: doc.entities.size, collectMs: tf - tc, flushMs: performance.now() - tf, batches: 0 };

  if (s.grips && s.selection.size && s.selection.size <= 200) {
    g.lineWidth = 1;
    for (const id of s.selection) {
      const e = doc.get(id);
      if (!e) continue;
      gripPoints(e).forEach((p, i) => {
        const q = vp.toScreen(p);
        const hot = s.hotGrip && s.hotGrip.id === id && s.hotGrip.i === i;
        g.fillStyle = hot ? '#ef4444' : theme.select;
        g.fillRect(q[0] - 4, q[1] - 4, 8, 8);
        g.strokeStyle = theme.bg;
        g.strokeRect(q[0] - 4.5, q[1] - 4.5, 9, 9);
      });
    }
  }

  if (s.preview.length) {
    for (const e of s.preview) queueEntity(batch, e, s, theme.preview, 1);
    batch.flush(g, vp);
  }

  if (s.box) {
    const a = vp.toScreen(s.box.a);
    const b = vp.toScreen(s.box.b);
    const crossing = b[0] < a[0];
    g.fillStyle = crossing ? theme.crossFill : theme.windowFill;
    g.strokeStyle = crossing ? '#3fb950' : '#4c8dff';
    g.setLineDash(crossing ? [5, 4] : []);
    g.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    g.strokeRect(Math.min(a[0], b[0]) + 0.5, Math.min(a[1], b[1]) + 0.5, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    g.setLineDash([]);
  }

  if (s.snap) drawSnapMarker(g, vp.toScreen(s.snap.p), s.snap.kind, theme.snap);

  if (s.cursor) {
    const c = vp.toScreen(s.cursor);
    const x = Math.round(c[0]) + 0.5;
    const y = Math.round(c[1]) + 0.5;
    g.strokeStyle = theme.fg;
    g.lineWidth = 1;
    g.beginPath();
    const L = 28;
    g.moveTo(x - L, y);
    g.lineTo(x + L, y);
    g.moveTo(x, y - L);
    g.lineTo(x, y + L);
    g.stroke();
    if (s.pickbox) g.strokeRect(x - s.pickSize, y - s.pickSize, s.pickSize * 2, s.pickSize * 2);
  }

  drawAxisIcon(g, vp.h, theme.accent);
}
