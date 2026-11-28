// Khung nhìn (toạ độ thế giới ↔ màn hình) và vẽ bằng Canvas 2D.
// Trục Y thế giới hướng lên, trục Y màn hình hướng xuống.

import type { BBox, Vec } from '../core/geom';
import { deg2rad } from '../core/geom';
import type { Drawing } from '../core/document';
import { type Entity, type NewEntity, type SnapKind, bbox } from '../core/entities';

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
export function aciToCss(i: number, fg: string): string {
  if (i === 7 || i <= 0 || i > 255) return fg;
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

function pathEntity(g: CanvasRenderingContext2D, e: NewEntity | Entity, vp: Viewport): void {
  g.beginPath();
  switch (e.type) {
    case 'LINE': {
      const a = vp.toScreen(e.a);
      const b = vp.toScreen(e.b);
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      break;
    }
    case 'CIRCLE': {
      const c = vp.toScreen(e.c);
      g.arc(c[0], c[1], Math.max(e.r * vp.scale, 0.5), 0, Math.PI * 2);
      break;
    }
    case 'ARC': {
      const c = vp.toScreen(e.c);
      // Màn hình lật trục Y → góc âm và vẽ theo chiều kim đồng hồ.
      g.arc(c[0], c[1], Math.max(e.r * vp.scale, 0.5), -deg2rad(e.start), -deg2rad(e.end), true);
      break;
    }
    case 'LWPOLYLINE': {
      e.pts.forEach((p, i) => {
        const q = vp.toScreen(p);
        if (i === 0) g.moveTo(q[0], q[1]);
        else g.lineTo(q[0], q[1]);
      });
      if (e.closed) g.closePath();
      break;
    }
    case 'TEXT':
      break;
  }
}

function drawText(g: CanvasRenderingContext2D, e: NewEntity & { type: 'TEXT' }, vp: Viewport, color: string): void {
  const px = e.h * vp.scale;
  const p = vp.toScreen(e.p);
  if (px < 2) {
    // Chữ quá nhỏ: vẽ một vạch thay thế cho nhẹ.
    g.strokeStyle = color;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(p[0] + Math.max(2, e.text.length * px * 0.6), p[1]);
    g.stroke();
    return;
  }
  g.save();
  g.translate(p[0], p[1]);
  g.rotate(-deg2rad(e.rot));
  g.fillStyle = color;
  g.font = `${px}px "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif`;
  g.textBaseline = 'alphabetic';
  g.fillText(e.text, 0, 0);
  g.restore();
}

function drawOne(g: CanvasRenderingContext2D, e: NewEntity | Entity, vp: Viewport, color: string): void {
  if (e.type === 'TEXT') return drawText(g, e, vp, color);
  g.strokeStyle = color;
  pathEntity(g, e, vp);
  g.stroke();
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
  for (const e of doc.visible()) {
    const b = bbox(e);
    if (b.maxX < view.minX - pad || b.minX > view.maxX + pad || b.maxY < view.minY - pad || b.minY > view.maxY + pad) continue;
    const layer = doc.layers.get(e.layer);
    const color = aciToCss(e.color ?? layer?.color ?? 7, theme.fg);
    const sel = s.selection.has(e.id);
    const hov = s.hover === e.id;
    g.lineWidth = hov ? 2.5 : 1;
    if (sel) {
      g.setLineDash([6, 4]);
      drawOne(g, e, vp, theme.select);
      g.setLineDash([]);
    } else drawOne(g, e, vp, color);
  }

  if (s.preview.length) {
    g.lineWidth = 1;
    g.setLineDash([5, 4]);
    for (const e of s.preview) drawOne(g, e, vp, theme.preview);
    g.setLineDash([]);
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
