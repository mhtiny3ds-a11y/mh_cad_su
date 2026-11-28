// Xuất bản vẽ ra SVG (dùng để in / lưu PDF theo khổ giấy và tỉ lệ).

import type { BBox } from './geom';
import { deg2rad, polar } from './geom';
import type { Drawing } from './document';
import { type NewEntity, expand, textLineOrigins, xlineSeg } from './entities';
import { hatchSegments } from './hatch';

export const PAPERS: Record<string, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
};

export interface PlotOptions {
  /** Vùng bản vẽ cần in (toạ độ bản vẽ). */
  box: BBox;
  paper: keyof typeof PAPERS | [number, number];
  landscape: boolean;
  /** 1:N (bản vẽ đơn vị mm). Không có = vừa khổ giấy. */
  scale?: number;
  /** Lề giấy, mm. */
  margin?: number;
  /** In đen trắng (mặc định có). */
  mono?: boolean;
  /** Độ dày nét, mm. */
  lineMm?: number;
  aci?: (i: number) => string;
}

export interface PlotResult {
  svg: string;
  widthMm: number;
  heightMm: number;
  /** Tỉ lệ thực tế 1:N. */
  scale: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f = (v: number) => (Math.round(v * 1000) / 1000).toString();

export function plotSvg(doc: Drawing, o: PlotOptions): PlotResult {
  const [pw, ph] = Array.isArray(o.paper) ? o.paper : PAPERS[o.paper];
  const W = o.landscape ? Math.max(pw, ph) : Math.min(pw, ph);
  const H = o.landscape ? Math.min(pw, ph) : Math.max(pw, ph);
  const m = o.margin ?? 10;
  const bw = Math.max(o.box.maxX - o.box.minX, 1e-9);
  const bh = Math.max(o.box.maxY - o.box.minY, 1e-9);
  const fit = Math.max(bw / (W - 2 * m), bh / (H - 2 * m));
  const N = o.scale && o.scale > 0 ? o.scale : fit;
  // Một mm giấy = N đơn vị bản vẽ. Căn giữa vùng in trên giấy.
  const vw = W * N;
  const vh = H * N;
  const cx = (o.box.minX + o.box.maxX) / 2;
  const cy = (o.box.minY + o.box.maxY) / 2;
  const vx = cx - vw / 2;
  const vy = cy - vh / 2;
  const stroke = (o.lineMm ?? 0.18) * N;
  const mono = o.mono !== false;
  const aci = o.aci ?? (() => '#000');

  const out: string[] = [];
  const colorOf = (e: NewEntity) => (mono ? '#000' : aci(e.color ?? doc.layers.get(e.layer)?.color ?? 7));
  const dashOf = (e: NewEntity) => {
    const pat = doc.linePattern(e);
    if (!pat.length) return '';
    return ` stroke-dasharray="${pat.map((x) => f(Math.max(Math.abs(x) * doc.ltscale, x === 0 ? stroke : 0))).join(' ')}"`;
  };

  const emit = (e: NewEntity) => {
    if (doc.layers.get(e.layer)?.visible === false) return;
    if (e.type === 'INSERT' || e.type === 'DIMENSION') {
      for (const x of expand(e)) emit(x);
      return;
    }
    const col = colorOf(e);
    const st = `fill="none" stroke="${col}" stroke-width="${f(stroke)}"${dashOf(e)}`;
    switch (e.type) {
      case 'XLINE': {
        const far = Math.hypot(e.p[0] - cx, e.p[1] - cy) + Math.hypot(vw, vh);
        const [a, b] = xlineSeg(e, far);
        out.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" ${st}/>`);
        break;
      }
      case 'LINE':
        out.push(`<line x1="${f(e.a[0])}" y1="${f(e.a[1])}" x2="${f(e.b[0])}" y2="${f(e.b[1])}" ${st}/>`);
        break;
      case 'CIRCLE':
        out.push(`<circle cx="${f(e.c[0])}" cy="${f(e.c[1])}" r="${f(e.r)}" ${st}/>`);
        break;
      case 'ARC': {
        const a = polar(e.c, deg2rad(e.start), e.r);
        const b = polar(e.c, deg2rad(e.end), e.r);
        const sweep = (((e.end - e.start) % 360) + 360) % 360 || 360;
        out.push(`<path d="M${f(a[0])} ${f(a[1])}A${f(e.r)} ${f(e.r)} 0 ${sweep > 180 ? 1 : 0} 1 ${f(b[0])} ${f(b[1])}" ${st}/>`);
        break;
      }
      case 'LWPOLYLINE': {
        const d = e.pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join('') + (e.closed ? 'Z' : '');
        out.push(e.fill ? `<path d="${d}" fill="${col}" stroke="none"/>` : `<path d="${d}" ${st}/>`);
        break;
      }
      case 'POINT':
        out.push(`<circle cx="${f(e.p[0])}" cy="${f(e.p[1])}" r="${f(stroke * 1.5)}" fill="${col}"/>`);
        break;
      case 'HATCH': {
        const d = e.loops.map((l) => l.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join('') + 'Z').join('');
        if (e.solid) out.push(`<path d="${d}" fill="${col}" fill-rule="evenodd" stroke="none"/>`);
        else {
          const segs = hatchSegments(e.loops, e.lines, 20000) ?? [];
          out.push(`<path d="${segs.map(([a, b]) => `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`).join('')}" fill="none" stroke="${col}" stroke-width="${f(stroke * 0.7)}"/>`);
        }
        break;
      }
      case 'TEXT': {
        if (e.text.includes('\n')) {
          for (const l of textLineOrigins(e)) emit({ ...e, text: l.text, p: l.p, va: 'B' });
          break;
        }
        const anchor = e.ha === 'C' ? 'middle' : e.ha === 'R' ? 'end' : 'start';
        const dy = e.va === 'M' ? e.h / 2 : e.va === 'T' ? e.h : 0;
        out.push(
          `<text transform="translate(${f(e.p[0])} ${f(e.p[1])}) rotate(${f(e.rot)}) scale(1 -1)" y="${f(dy)}" font-size="${f(e.h)}" text-anchor="${anchor}" fill="${col}" font-family="Arial, 'Noto Sans', sans-serif">${esc(e.text)}</text>`,
        );
        break;
      }
    }
  };

  for (const e of doc.visible()) emit(e);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(vw)} ${f(vh)}">
<rect width="100%" height="100%" fill="#fff"/>
<g transform="translate(${f(-vx)} ${f(vy + vh)}) scale(1 -1)" stroke-linecap="round" stroke-linejoin="round">
${out.join('\n')}
</g>
</svg>`;
  return { svg, widthMm: W, heightMm: H, scale: N };
}
