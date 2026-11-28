// Đọc / ghi DXF dạng ASCII.
// Ghi: R12 (AC1009) — AutoCAD, BricsCAD, LibreCAD, DraftSight… đều mở được. Kích thước được ghi kèm block hình vẽ.
// Đọc: LINE, CIRCLE, ARC, LWPOLYLINE/POLYLINE (kể cả đoạn cong), TEXT, MTEXT, INSERT (+ ATTRIB, MINSERT),
//      DIMENSION (qua block hình vẽ), SOLID, ELLIPSE, SPLINE, LEADER; bảng LAYER, LTYPE; khối BLOCKS.
// Chữ không phải ASCII ghi bằng mã \U+XXXX (chuẩn DXF) nên tiếng Việt không bị lỗi.

import { type Vec, add, deg2rad, dist, mul, polar, sub } from './geom';
import { type BlockDef, type DimEnt, type NewEntity, expand } from './entities';
import { type PatLine, hatchSegments, trapezoids } from './hatch';
import type { DrawingData, Layer } from './document';
import { BUILTIN_LINETYPES } from './document';
import { DEFAULT_DIMSTYLE } from './dim';

// ---------- Mã hoá chữ ----------

export function encodeDxfText(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 128) out += ch;
    else if (cp <= 0xffff) out += `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += '?';
  }
  return out;
}

export function decodeDxfText(s: string): string {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoO]/g, '')
    .replace(/%%%/g, '%');
}

/** Bỏ mã định dạng MTEXT (\P, {\f...;}, \H..; ...), giữ phần chữ. */
export function stripMtext(s: string): string {
  return decodeDxfText(s)
    .replace(/\\P/g, '\n')
    .replace(/\\[ACcFfHhQqTtWw][^;]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\S([^;]*);/g, (_, x: string) => x.replace(/[#^]/g, '/'))
    .replace(/\\~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\');
}

/**
 * Giải mã byte của file DXF: bản AutoCAD 2007 (AC1021) trở lên là UTF-8;
 * bản cũ dùng bảng mã ghi trong $DWGCODEPAGE (tiếng Việt thường là ANSI_1258).
 */
export function decodeDxfBytes(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 20000)));
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d+)/.exec(head)?.[1] ?? 'AC1009';
  if (Number(ver.slice(2)) >= 1021) return new TextDecoder('utf-8').decode(bytes);
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/i.exec(head)?.[1];
  const label = cp ? `windows-${cp}` : 'windows-1252';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// ---------- Ghi ----------

const n = (v: number) => {
  const r = Math.round(v * 1e8) / 1e8;
  return Object.is(r, -0) ? '0' : String(r);
};

const UNITS: Record<string, number> = { in: 1, ft: 2, mm: 4, cm: 5, m: 6 };
const unitsCode = (u?: string) => UNITS[u ?? 'mm'] ?? 4;
const unitsName = (c: number) => Object.entries(UNITS).find(([, v]) => v === c)?.[0];

const DIM_TYPE: Record<DimEnt['kind'], number> = { linear: 0, aligned: 1, angular: 5, diameter: 3, radius: 4 };

export function writeDxf(data: DrawingData): string {
  const o: string[] = [];
  const g = (code: number, v: string | number) => o.push(String(code), typeof v === 'number' ? n(v) : v);
  const pt = (code: number, p: Vec) => {
    g(code, p[0]);
    g(code + 10, p[1]);
    g(code + 20, 0);
  };
  const ds = data.dimStyle ?? DEFAULT_DIMSTYLE;
  const linetypes: Record<string, number[]> = { ...BUILTIN_LINETYPES, ...(data.linetypes ?? {}) };

  // Kích thước → block hình vẽ ẩn danh *D1, *D2… để phần mềm khác hiển thị đúng.
  const dimBlocks: BlockDef[] = [];
  const dimBlockName = new Map<object, string>();
  let hatchN = 0;
  for (const e of data.entities)
    if (e.type === 'DIMENSION') {
      const name = `*D${dimBlocks.length + 1}`;
      dimBlocks.push({ name, base: [0, 0], ents: expand(e) });
      dimBlockName.set(e, name);
    } else if (e.type === 'HATCH') {
      // R12 không có HATCH: ghi hình vẽ của vùng tô vào block ẩn danh *X (giống cách AutoCAD R12 làm).
      const name = `*X${++hatchN}`;
      const keep = { layer: '0' };
      const ents: NewEntity[] = e.solid
        ? trapezoids(e.loops).map((q) => ({ type: 'LWPOLYLINE', pts: q, closed: true, fill: true, ...keep }))
        : (hatchSegments(e.loops, e.lines) ?? []).map(([a, b]) => ({ type: 'LINE', a, b, ...keep }));
      dimBlocks.push({ name, base: [0, 0], ents });
      dimBlockName.set(e, name);
    }

  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, unitsCode(data.units));
  g(9, '$CLAYER');
  g(8, encodeDxfText(data.currentLayer ?? '0'));
  g(9, '$LTSCALE');
  g(40, data.ltscale ?? 1);
  g(9, '$DIMSCALE');
  g(40, 1);
  for (const [k, v] of [
    ['$DIMTXT', ds.txt],
    ['$DIMASZ', ds.asz],
    ['$DIMEXO', ds.exo],
    ['$DIMEXE', ds.exe],
    ['$DIMGAP', ds.gap],
  ] as const) {
    g(9, k);
    g(40, v);
  }
  g(9, '$DIMDEC');
  g(70, ds.dec);
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, Object.keys(linetypes).length);
  for (const [name, pat] of Object.entries(linetypes)) {
    g(0, 'LTYPE');
    g(2, encodeDxfText(name));
    g(70, 0);
    g(3, name === 'CONTINUOUS' ? 'Solid line' : name);
    g(72, 65);
    g(73, pat.length);
    g(40, pat.reduce((s, x) => s + Math.abs(x), 0));
    for (const x of pat) g(49, x);
  }
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, data.layers.length);
  for (const l of data.layers) {
    g(0, 'LAYER');
    g(2, encodeDxfText(l.name));
    g(70, l.locked ? 4 : 0);
    g(62, l.visible ? l.color : -Math.abs(l.color));
    g(6, encodeDxfText(l.lt ?? 'CONTINUOUS'));
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  const writeEnt = (e: NewEntity) => {
    const head = (type: string) => {
      g(0, type);
      g(8, encodeDxfText(e.layer));
      if (e.lt) g(6, encodeDxfText(e.lt));
      if (e.color !== undefined) g(62, e.color);
    };
    switch (e.type) {
      case 'LINE':
        head('LINE');
        pt(10, e.a);
        pt(11, e.b);
        break;
      case 'CIRCLE':
        head('CIRCLE');
        pt(10, e.c);
        g(40, e.r);
        break;
      case 'ARC':
        head('ARC');
        pt(10, e.c);
        g(40, e.r);
        g(50, e.start);
        g(51, e.end);
        break;
      case 'LWPOLYLINE':
        if (e.fill && (e.pts.length === 3 || e.pts.length === 4)) {
          // SOLID: thứ tự góc 1, 2, 4, 3.
          head('SOLID');
          const [a, b, c, d] = e.pts.length === 3 ? [e.pts[0], e.pts[1], e.pts[2], e.pts[2]] : e.pts;
          pt(10, a);
          pt(11, b);
          pt(12, d);
          pt(13, c);
          break;
        }
        // R12 không có LWPOLYLINE → ghi POLYLINE + VERTEX + SEQEND.
        head('POLYLINE');
        g(66, 1);
        pt(10, [0, 0]);
        g(70, e.closed ? 1 : 0);
        for (const p of e.pts) {
          g(0, 'VERTEX');
          g(8, encodeDxfText(e.layer));
          pt(10, p);
        }
        g(0, 'SEQEND');
        g(8, encodeDxfText(e.layer));
        break;
      case 'TEXT':
        head('TEXT');
        pt(10, e.p);
        g(40, e.h);
        g(1, encodeDxfText(e.text));
        if (e.rot) g(50, e.rot);
        if ((e.ha && e.ha !== 'L') || (e.va && e.va !== 'B')) {
          g(72, e.ha === 'C' ? 1 : e.ha === 'R' ? 2 : 0);
          pt(11, e.p);
          g(73, e.va === 'M' ? 2 : e.va === 'T' ? 3 : 0);
        }
        break;
      case 'INSERT':
        head('INSERT');
        g(2, encodeDxfText(e.name));
        pt(10, e.p);
        if (e.sx !== 1) g(41, e.sx);
        if (e.sy !== 1) g(42, e.sy);
        if (e.rot) g(50, e.rot);
        break;
      case 'POINT':
        head('POINT');
        pt(10, e.p);
        break;
      case 'HATCH':
        head('INSERT');
        g(2, dimBlockName.get(e) ?? '*X0');
        pt(10, [0, 0]);
        break;
      case 'DIMENSION': {
        head('DIMENSION');
        g(2, dimBlockName.get(e) ?? '*D0');
        const p = e.pts;
        const textEnt = expand(e).find((x) => x.type === 'TEXT');
        if (e.kind === 'linear' || e.kind === 'aligned') {
          const a = e.kind === 'linear' ? deg2rad(e.rot ?? 0) : Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]);
          const nrm: Vec = [-Math.sin(a), Math.cos(a)];
          const off = (p[2][0] - p[1][0]) * nrm[0] + (p[2][1] - p[1][1]) * nrm[1];
          pt(10, add(p[1], mul(nrm, off)));
        } else if (e.kind === 'radius' || e.kind === 'diameter') pt(10, e.kind === 'radius' ? p[0] : p[1]);
        else pt(10, p[3]);
        if (textEnt && textEnt.type === 'TEXT') pt(11, textEnt.p);
        g(70, DIM_TYPE[e.kind]);
        if (e.text) g(1, encodeDxfText(e.text));
        if (e.kind === 'linear' || e.kind === 'aligned') {
          pt(13, p[0]);
          pt(14, p[1]);
          if (e.kind === 'linear') g(50, e.rot ?? 0);
        } else if (e.kind === 'radius') pt(15, p[1]);
        else if (e.kind === 'diameter') pt(15, p[0]);
        else {
          pt(13, p[1]);
          pt(14, p[2]);
          pt(15, p[0]);
        }
        break;
      }
    }
  };

  g(0, 'SECTION');
  g(2, 'BLOCKS');
  for (const b of [...(data.blocks ?? []), ...dimBlocks]) {
    g(0, 'BLOCK');
    g(8, '0');
    g(2, encodeDxfText(b.name));
    g(70, b.name.startsWith('*') ? 1 : 0);
    pt(10, b.base);
    g(3, encodeDxfText(b.name));
    for (const e of b.ents) writeEnt(e);
    g(0, 'ENDBLK');
    g(8, '0');
  }
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const e of data.entities) writeEnt(e);
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}

// ---------- Đọc ----------

export interface DxfReadResult {
  data: DrawingData;
  /** Số đối tượng bị bỏ qua theo loại (chưa hỗ trợ). */
  skipped: Record<string, number>;
}

type Pair = [number, string];

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) throw new Error(`File DXF lỗi ở dòng ${i + 1}`);
    out.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  return out;
}

/** Chia một cung trong đa tuyến (bulge) thành các điểm. */
export function bulgePoints(a: Vec, b: Vec, bulge: number): Vec[] {
  if (Math.abs(bulge) < 1e-9) return [];
  const theta = 4 * Math.atan(bulge);
  const chord = dist(a, b);
  if (chord < 1e-12) return [];
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const m: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const d = mul(sub(b, a), 1 / chord);
  const left: Vec = [-d[1], d[0]];
  const s = Math.sign(bulge) * (Math.abs(theta) > Math.PI ? -1 : 1);
  const c = add(m, mul(left, h * s));
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  const steps = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 24)));
  const out: Vec[] = [];
  for (let k = 1; k < steps; k++) out.push(polar(c, a0 + (theta * k) / steps, r));
  return out;
}

/** Tính điểm trên B-spline bằng thuật toán de Boor. */
function bspline(ctrl: Vec[], knots: number[], degree: number, samples: number): Vec[] {
  const nCtrl = ctrl.length;
  if (nCtrl < 2) return ctrl;
  if (knots.length !== nCtrl + degree + 1) {
    // Nút không hợp lệ: dùng nút đều kẹp hai đầu.
    knots = [];
    for (let i = 0; i <= degree; i++) knots.push(0);
    for (let i = 1; i < nCtrl - degree; i++) knots.push(i);
    for (let i = 0; i <= degree; i++) knots.push(nCtrl - degree);
  }
  const t0 = knots[degree];
  const t1 = knots[nCtrl];
  const out: Vec[] = [];
  for (let s = 0; s <= samples; s++) {
    const t = t0 + ((t1 - t0) * s) / samples;
    let k = degree;
    while (k < nCtrl - 1 && t >= knots[k + 1]) k++;
    const d: Vec[] = [];
    for (let j = 0; j <= degree; j++) d.push(ctrl[Math.max(0, Math.min(nCtrl - 1, k - degree + j))]);
    for (let r = 1; r <= degree; r++)
      for (let j = degree; j >= r; j--) {
        const i = k - degree + j;
        const den = knots[i + degree - r + 1] - knots[i];
        const alpha = den === 0 ? 0 : (t - knots[i]) / den;
        d[j] = [(1 - alpha) * d[j - 1][0] + alpha * d[j][0], (1 - alpha) * d[j - 1][1] + alpha * d[j][1]];
      }
    out.push(d[degree]);
  }
  return out;
}

export function readDxf(text: string): DxfReadResult {
  if (/^AutoCAD Binary DXF/.test(text)) throw new Error('Chưa hỗ trợ DXF nhị phân, hãy lưu lại dạng ASCII');
  const P = pairs(text);
  const layers = new Map<string, Layer>();
  const blocks = new Map<string, BlockDef>();
  const linetypes: Record<string, number[]> = {};
  const entities: NewEntity[] = [];
  const skipped: Record<string, number> = {};
  const skip = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);
  const header: Record<string, string> = {};

  let i = 0;
  const at = () => P[i];
  const record = (): Pair[] => {
    const r: Pair[] = [];
    i++;
    while (i < P.length && P[i][0] !== 0) r.push(P[i++]);
    return r;
  };
  const get = (r: Pair[], code: number): string | undefined => r.find((p) => p[0] === code)?.[1];
  const num = (r: Pair[], code: number, def = 0): number => {
    const v = get(r, code);
    const x = v === undefined ? def : Number(v);
    return Number.isFinite(x) ? x : def;
  };
  const vec = (r: Pair[], code: number): Vec => [num(r, code), num(r, code + 10)];
  const common = (r: Pair[]) => {
    const layer = decodeDxfText(get(r, 8) ?? '0');
    const c = get(r, 62);
    const color = c === undefined ? undefined : Number(c);
    const ltRaw = get(r, 6);
    const lt = ltRaw && !/^BY(LAYER|BLOCK)$/i.test(ltRaw) ? decodeDxfText(ltRaw).toUpperCase() : undefined;
    return {
      layer,
      // 256 = ByLayer, 0 = ByBlock → coi như theo layer.
      ...(color === undefined || color === 256 || color === 0 ? {} : { color: Math.abs(color) }),
      ...(lt ? { lt } : {}),
    };
  };

  /** Đọc một đối tượng (con trỏ i đang ở mã 0 của nó); đẩy kết quả vào out. */
  const readEntity = (type: string, out: NewEntity[]): void => {
    const r = record();
    if (num(r, 67) === 1) {
      // Đối tượng ở paper space (layout) — chưa hỗ trợ.
      if (type === 'POLYLINE' || type === 'INSERT') while (i < P.length && at()[0] === 0 && /^(VERTEX|ATTRIB|SEQEND)$/.test(at()[1])) record();
      skip('Paper space');
      return;
    }
    const cm = common(r);
    switch (type) {
      case 'LINE':
        out.push({ type: 'LINE', a: vec(r, 10), b: vec(r, 11), ...cm });
        return;
      case 'CIRCLE':
        out.push({ type: 'CIRCLE', c: vec(r, 10), r: num(r, 40), ...cm });
        return;
      case 'ARC':
        out.push({ type: 'ARC', c: vec(r, 10), r: num(r, 40), start: num(r, 50), end: num(r, 51), ...cm });
        return;
      case 'LWPOLYLINE': {
        const verts: { p: Vec; bulge: number }[] = [];
        for (let k = 0; k < r.length; k++) {
          if (r[k][0] === 10) verts.push({ p: [Number(r[k][1]), r[k + 1]?.[0] === 20 ? Number(r[k + 1][1]) : 0], bulge: 0 });
          if (r[k][0] === 42 && verts.length) verts[verts.length - 1].bulge = Number(r[k][1]);
        }
        pushPoly(verts, (num(r, 70) & 1) !== 0, cm, out);
        return;
      }
      case 'POLYLINE': {
        const flags = num(r, 70);
        const verts: { p: Vec; bulge: number }[] = [];
        while (i < P.length && at()[0] === 0 && at()[1] === 'VERTEX') {
          const v = record();
          if (num(v, 70) & 16) continue; // điểm điều khiển spline
          verts.push({ p: vec(v, 10), bulge: num(v, 42) });
        }
        if (i < P.length && at()[1] === 'SEQEND') record();
        if (flags & (16 | 64)) return void skip('POLYLINE 3D/mesh');
        pushPoly(verts, (flags & 1) !== 0, cm, out);
        return;
      }
      case 'TEXT':
      case 'ATTRIB': {
        if (type === 'ATTRIB' && num(r, 70) & 1) return; // thuộc tính ẩn
        const h72 = num(r, 72);
        const v73 = num(r, type === 'ATTRIB' ? 74 : 73);
        const aligned = (h72 !== 0 || v73 !== 0) && get(r, 11) !== undefined && h72 !== 3 && h72 !== 5;
        const ha = h72 === 1 || h72 === 4 ? 'C' : h72 === 2 ? 'R' : undefined;
        const va = h72 === 4 || v73 === 2 ? 'M' : v73 === 3 ? 'T' : undefined;
        const t = decodeDxfText(get(r, 1) ?? '');
        if (!t.trim()) return;
        out.push({
          type: 'TEXT',
          p: aligned ? vec(r, 11) : vec(r, 10),
          h: num(r, 40, 2.5) || 2.5,
          text: t,
          rot: num(r, 50),
          ...(aligned && ha ? { ha } : {}),
          ...(aligned && va ? { va } : {}),
          ...cm,
        });
        return;
      }
      case 'MTEXT': {
        const raw = r.filter((p) => p[0] === 3).map((p) => p[1]).join('') + (get(r, 1) ?? '');
        const lines = stripMtext(raw).split('\n');
        const h = num(r, 40, 2.5) || 2.5;
        const rot = get(r, 50) !== undefined ? num(r, 50) : (Math.atan2(num(r, 21), num(r, 11, 1)) * 180) / Math.PI;
        const att = num(r, 71, 1); // 1..9: TL TC TR ML MC MR BL BC BR
        const col = (att - 1) % 3;
        const row = Math.floor((att - 1) / 3);
        const ha = col === 1 ? 'C' : col === 2 ? 'R' : undefined;
        const step = h * 1.6;
        const total = (lines.length - 1) * step;
        // Dòng đầu: căn theo hàng của điểm đặt (trên / giữa / dưới).
        const firstOffset = row === 0 ? -h : row === 1 ? total / 2 - h / 2 : total;
        const base = vec(r, 10);
        const a = deg2rad(rot);
        const down: Vec = [Math.sin(a), -Math.cos(a)];
        lines.forEach((t, k) => {
          if (!t.trim()) return;
          const off = -firstOffset + k * step;
          out.push({ type: 'TEXT', p: add(base, mul(down, off)), h, text: t, rot, ...(ha ? { ha } : {}), ...cm });
        });
        return;
      }
      case 'INSERT': {
        const name = decodeDxfText(get(r, 2) ?? '');
        const attribs: NewEntity[] = [];
        if (num(r, 66) === 1) {
          while (i < P.length && at()[0] === 0 && at()[1] === 'ATTRIB') readEntity('ATTRIB', attribs);
          if (i < P.length && at()[1] === 'SEQEND') record();
        }
        const cols = Math.max(1, num(r, 70, 1));
        const rows = Math.max(1, num(r, 71, 1));
        const dx = num(r, 44);
        const dy = num(r, 45);
        const rot = num(r, 50);
        const p0 = vec(r, 10);
        const a = deg2rad(rot);
        for (let rr = 0; rr < rows; rr++)
          for (let cc = 0; cc < cols; cc++) {
            const off: Vec = [cc * dx * Math.cos(a) - rr * dy * Math.sin(a), cc * dx * Math.sin(a) + rr * dy * Math.cos(a)];
            out.push({ type: 'INSERT', name, p: add(p0, off), sx: num(r, 41, 1) || 1, sy: num(r, 42, 1) || 1, rot, ...cm });
          }
        out.push(...attribs);
        return;
      }
      case 'DIMENSION': {
        // Dùng block hình vẽ do phần mềm gốc tạo để hiển thị đúng như bản gốc.
        const bname = get(r, 2);
        if (bname) {
          out.push({ type: 'INSERT', name: decodeDxfText(bname), p: [0, 0], sx: 1, sy: 1, rot: 0, ...cm });
          pendingDims.push({ r, cm, index: out.length - 1, out });
        } else pushOwnDim(r, cm, out);
        return;
      }
      case 'SOLID':
      case 'TRACE': {
        const a = vec(r, 10);
        const b = vec(r, 11);
        const c = vec(r, 12);
        const d = get(r, 13) !== undefined ? vec(r, 13) : c;
        const pts: Vec[] = dist(c, d) < 1e-12 ? [a, b, c] : [a, b, d, c];
        out.push({ type: 'LWPOLYLINE', pts, closed: true, fill: true, ...cm });
        return;
      }
      case 'ELLIPSE': {
        const c = vec(r, 10);
        const maj = vec(r, 11);
        const ratio = num(r, 40, 1);
        const s = num(r, 41, 0);
        let e = num(r, 42, Math.PI * 2);
        if (e <= s) e += Math.PI * 2;
        const minr: Vec = [-maj[1] * ratio, maj[0] * ratio];
        const full = Math.abs(e - s - Math.PI * 2) < 1e-9;
        const steps = Math.max(8, Math.ceil(((e - s) / (Math.PI * 2)) * 96));
        const pts: Vec[] = [];
        for (let k = 0; k <= (full ? steps - 1 : steps); k++) {
          const t = s + ((e - s) * k) / steps;
          pts.push(add(c, add(mul(maj, Math.cos(t)), mul(minr, Math.sin(t)))));
        }
        out.push({ type: 'LWPOLYLINE', pts, closed: full, ...cm });
        return;
      }
      case 'SPLINE': {
        const ctrl: Vec[] = [];
        const fit: Vec[] = [];
        const knots: number[] = [];
        for (let k = 0; k < r.length; k++) {
          const [code, v] = r[k];
          if (code === 10) ctrl.push([Number(v), r[k + 1]?.[0] === 20 ? Number(r[k + 1][1]) : 0]);
          else if (code === 11) fit.push([Number(v), r[k + 1]?.[0] === 21 ? Number(r[k + 1][1]) : 0]);
          else if (code === 40) knots.push(Number(v));
        }
        const closed = (num(r, 70) & 1) !== 0;
        const pts = ctrl.length >= 2 ? bspline(ctrl, knots, Math.max(1, num(r, 71, 3)), Math.max(16, ctrl.length * 12)) : fit;
        if (pts.length >= 2) out.push({ type: 'LWPOLYLINE', pts, closed, ...cm });
        return;
      }
      case 'LEADER': {
        const pts: Vec[] = [];
        for (let k = 0; k < r.length; k++) if (r[k][0] === 10) pts.push([Number(r[k][1]), Number(r[k + 1]?.[1] ?? 0)]);
        if (pts.length >= 2) out.push({ type: 'LWPOLYLINE', pts, closed: false, ...cm });
        return;
      }
      case 'ATTDEF':
        return; // định nghĩa thuộc tính trong block: giá trị nằm ở ATTRIB của INSERT
      case 'POINT':
        out.push({ type: 'POINT', p: vec(r, 10), ...cm });
        return;
      case 'ACAD_TABLE':
      case 'ARC_DIMENSION':
      case 'LARGE_RADIAL_DIMENSION': {
        // Có block hình vẽ riêng → hiển thị qua INSERT.
        const bname = get(r, 2);
        if (bname) out.push({ type: 'INSERT', name: decodeDxfText(bname), p: [0, 0], sx: 1, sy: 1, rot: 0, ...cm });
        else skip(type);
        return;
      }
      case 'HATCH': {
        const h = parseHatch(r);
        if (h) out.push({ type: 'HATCH', ...h, ...cm });
        else skip('HATCH (biên chưa đọc được)');
        return;
      }
      default:
        skip(type);
    }
  };

  const pushPoly = (verts: { p: Vec; bulge: number }[], closed: boolean, cm: ReturnType<typeof common>, out: NewEntity[]) => {
    if (verts.length < 2) return;
    const pts: Vec[] = [];
    const nSeg = closed ? verts.length : verts.length - 1;
    for (let k = 0; k < verts.length; k++) {
      pts.push(verts[k].p);
      if (k < nSeg) pts.push(...bulgePoints(verts[k].p, verts[(k + 1) % verts.length].p, verts[k].bulge));
    }
    out.push({ type: 'LWPOLYLINE', pts, closed, ...cm });
  };

  // Kích thước có block: nếu block không tồn tại thì dựng lại bằng kích thước của MHCAD.
  const pendingDims: { r: Pair[]; cm: ReturnType<typeof common>; index: number; out: NewEntity[] }[] = [];
  const pushOwnDim = (r: Pair[], cm: ReturnType<typeof common>, out: NewEntity[]) => {
    const t = num(r, 70) & 7;
    const style = { ...dimStyle };
    const text = get(r, 1) ? decodeDxfText(get(r, 1)!) : undefined;
    const base = { type: 'DIMENSION' as const, style, ...(text ? { text } : {}), ...cm };
    if (t === 0) out.push({ ...base, kind: 'linear', pts: [vec(r, 13), vec(r, 14), vec(r, 10)], rot: num(r, 50) });
    else if (t === 1) out.push({ ...base, kind: 'aligned', pts: [vec(r, 13), vec(r, 14), vec(r, 10)] });
    else if (t === 3) out.push({ ...base, kind: 'diameter', pts: [vec(r, 15), vec(r, 10)] });
    else if (t === 4) out.push({ ...base, kind: 'radius', pts: [vec(r, 10), vec(r, 15)] });
    else if (t === 5) out.push({ ...base, kind: 'angular', pts: [vec(r, 15), vec(r, 13), vec(r, 14), vec(r, 10)] });
    else skip('DIMENSION (loại chưa hỗ trợ)');
  };

  let dimStyle = { ...DEFAULT_DIMSTYLE };
  let section = '';
  let curBlock: BlockDef | null = null;
  while (i < P.length) {
    const [code, val] = at();
    if (code !== 0) {
      i++;
      continue;
    }
    if (val === 'SECTION') {
      const r = record();
      section = get(r, 2) ?? '';
      if (section === 'HEADER') {
        for (let j = 0; j + 1 < r.length; j++) if (r[j][0] === 9) header[r[j][1]] = r[j + 1][1];
        const scale = Number(header.$DIMSCALE ?? 1) || 1;
        const hv = (k: string, d: number) => {
          const v = Number(header[k]);
          return Number.isFinite(v) && v > 0 ? v * scale : d;
        };
        dimStyle = {
          txt: hv('$DIMTXT', DEFAULT_DIMSTYLE.txt),
          asz: hv('$DIMASZ', DEFAULT_DIMSTYLE.asz),
          exo: hv('$DIMEXO', DEFAULT_DIMSTYLE.exo),
          exe: hv('$DIMEXE', DEFAULT_DIMSTYLE.exe),
          gap: hv('$DIMGAP', DEFAULT_DIMSTYLE.gap),
          dec: header.$DIMDEC !== undefined ? Number(header.$DIMDEC) : DEFAULT_DIMSTYLE.dec,
        };
      }
      continue;
    }
    if (val === 'ENDSEC' || val === 'EOF') {
      section = '';
      i++;
      continue;
    }
    if (section === 'TABLES' && val === 'LAYER') {
      const r = record();
      const name = get(r, 2);
      if (name !== undefined) {
        const c = num(r, 62, 7);
        const lt = get(r, 6);
        layers.set(decodeDxfText(name), {
          name: decodeDxfText(name),
          color: Math.abs(c) || 7,
          visible: c >= 0 && (num(r, 70) & 1) === 0,
          locked: (num(r, 70) & 4) !== 0,
          ...(lt && lt.toUpperCase() !== 'CONTINUOUS' ? { lt: decodeDxfText(lt).toUpperCase() } : {}),
        });
      }
      continue;
    }
    if (section === 'TABLES' && val === 'LTYPE') {
      const r = record();
      const name = get(r, 2);
      if (name) {
        const pat = r.filter((p) => p[0] === 49).map((p) => Number(p[1]));
        if (pat.length && !/^BY/i.test(name)) linetypes[decodeDxfText(name).toUpperCase()] = pat;
      }
      continue;
    }
    if (section === 'BLOCKS') {
      if (val === 'BLOCK') {
        const r = record();
        const name = decodeDxfText(get(r, 2) ?? '');
        curBlock = { name, base: vec(r, 10), ents: [] };
        // Model/paper space của R2000+ không phải block thật.
        if (/^\*(MODEL|PAPER)_SPACE/i.test(name)) curBlock = null;
        else blocks.set(name, curBlock);
        continue;
      }
      if (val === 'ENDBLK') {
        record();
        curBlock = null;
        continue;
      }
      if (curBlock) readEntity(val, curBlock.ents);
      else record();
      continue;
    }
    if (section !== 'ENTITIES') {
      record();
      continue;
    }
    readEntity(val, entities);
  }

  // Kích thước trỏ tới block không có → dựng lại.
  for (const d of pendingDims.reverse()) {
    const ins = d.out[d.index];
    if (ins.type === 'INSERT' && !blocks.has(ins.name)) {
      d.out.splice(d.index, 1);
      const tmp: NewEntity[] = [];
      pushOwnDim(d.r, d.cm, tmp);
      d.out.splice(d.index, 0, ...tmp);
    }
  }

  // INSERT trỏ tới block không có: bỏ và báo lại.
  const dropMissing = (list: NewEntity[]) => {
    for (let k = list.length - 1; k >= 0; k--) {
      const e = list[k];
      if (e.type === 'INSERT' && !blocks.has(e.name)) {
        list.splice(k, 1);
        skip('INSERT (thiếu block)');
      }
    }
  };
  dropMissing(entities);
  for (const b of blocks.values()) dropMissing(b.ents);

  const ensure = (name: string) => {
    if (!layers.has(name)) layers.set(name, { name, color: 7, visible: true, locked: false });
  };
  for (const e of entities) ensure(e.layer);
  for (const b of blocks.values()) for (const e of b.ents) ensure(e.layer);
  ensure('0');

  const clayer = header.$CLAYER ? decodeDxfText(header.$CLAYER) : '0';
  const lts = Number(header.$LTSCALE);
  return {
    data: {
      format: 'mhcad',
      version: 1,
      units: header.$INSUNITS ? unitsName(Number(header.$INSUNITS)) : undefined,
      currentLayer: layers.has(clayer) ? clayer : '0',
      layers: [...layers.values()],
      blocks: [...blocks.values()],
      linetypes,
      dimStyle,
      ...(lts > 0 ? { ltscale: lts } : {}),
      entities,
    },
    skipped,
  };
}

// ---------- HATCH ----------

/** Đọc HATCH theo đúng thứ tự mã nhóm. */
function parseHatch(r: Pair[]): { loops: Vec[][]; solid: boolean; pattern: string; scale: number; angle: number; lines: PatLine[] } | null {
  let i = 0;
  const N = (x: string) => Number(x);
  const findFrom = (code: number) => {
    while (i < r.length && r[i][0] !== code) i++;
    return i < r.length;
  };
  let pattern = 'SOLID';
  let solid = false;
  for (const [c, v] of r) {
    if (c === 2) pattern = v;
    if (c === 70) {
      solid = N(v) === 1;
      break;
    }
  }
  if (!findFrom(91)) return null;
  const nPaths = N(r[i][1]);
  i++;
  const loops: Vec[][] = [];
  const take = (code: number): number => {
    while (i < r.length && r[i][0] !== code) i++;
    return i < r.length ? N(r[i++][1]) : 0;
  };
  const takeVec = (code: number): Vec => {
    const x = take(code);
    const y = take(code + 10);
    return [x, y];
  };
  for (let pth = 0; pth < nPaths; pth++) {
    const flags = take(92);
    const loop: Vec[] = [];
    if (flags & 2) {
      // Đa tuyến.
      const hasBulge = take(72);
      take(73);
      const nv = take(93);
      const verts: { p: Vec; b: number }[] = [];
      for (let k = 0; k < nv; k++) {
        const p = takeVec(10);
        let b = 0;
        if (hasBulge && r[i]?.[0] === 42) b = N(r[i++][1]);
        verts.push({ p, b });
      }
      for (let k = 0; k < verts.length; k++) {
        loop.push(verts[k].p);
        loop.push(...bulgePoints(verts[k].p, verts[(k + 1) % verts.length].p, verts[k].b));
      }
    } else {
      const ne = take(93);
      for (let k = 0; k < ne; k++) {
        const et = take(72);
        if (et === 1) {
          const a = takeVec(10);
          const b = takeVec(11);
          if (!loop.length || dist(loop[loop.length - 1], a) > 1e-9) loop.push(a);
          loop.push(b);
        } else if (et === 2 || et === 3) {
          const c = takeVec(10);
          let rad: number;
          let major: Vec = [1, 0];
          let ratio = 1;
          if (et === 2) rad = take(40);
          else {
            major = takeVec(11);
            ratio = take(40);
            rad = Math.hypot(major[0], major[1]);
          }
          let a0 = take(50);
          let a1 = take(51);
          const ccw = take(73);
          if (!ccw) {
            [a0, a1] = [-a0, -a1];
          }
          let sweep = a1 - a0;
          if (ccw && sweep <= 0) sweep += 360;
          if (!ccw && sweep >= 0) sweep -= 360;
          const steps = Math.max(4, Math.ceil(Math.abs(sweep) / 5));
          const rot = Math.atan2(major[1], major[0]);
          for (let s = 0; s <= steps; s++) {
            const t = deg2rad(a0 + (sweep * s) / steps);
            const lx = rad * Math.cos(t);
            const ly = rad * ratio * Math.sin(t);
            const p: Vec = [c[0] + lx * Math.cos(rot) - ly * Math.sin(rot), c[1] + lx * Math.sin(rot) + ly * Math.cos(rot)];
            if (s === 0 && loop.length && dist(loop[loop.length - 1], p) < 1e-9) continue;
            loop.push(p);
          }
        } else if (et === 4) {
          // Spline: lấy các điểm điều khiển (gần đúng).
          take(94);
          take(73);
          take(74);
          const nk = take(95);
          const nc = take(96);
          for (let q = 0; q < nk; q++) take(40);
          for (let q = 0; q < nc; q++) loop.push(takeVec(10));
        }
      }
    }
    // Bỏ điểm cuối trùng điểm đầu.
    if (loop.length > 2 && dist(loop[0], loop[loop.length - 1]) < 1e-9) loop.pop();
    if (loop.length >= 3) loops.push(loop);
    // Bỏ qua danh sách đối tượng nguồn (97 + 330).
  }
  if (!loops.length) return null;
  const angle = findFrom(52) ? N(r[i][1]) : 0;
  const scale = findFrom(41) ? N(r[i][1]) || 1 : 1;
  const lines: PatLine[] = [];
  if (!solid && findFrom(78)) {
    const nl = N(r[i++][1]);
    for (let k = 0; k < nl; k++) {
      const ang = take(53);
      const bx = take(43);
      const by = take(44);
      const off: Vec = [take(45), take(46)];
      const nd = take(79);
      const dashes: number[] = [];
      for (let q = 0; q < nd; q++) dashes.push(take(49));
      lines.push({ angle: ang, base: [bx, by], offset: off, dashes });
    }
  }
  if (!solid && !lines.length) lines.push({ angle: 45, base: [0, 0], offset: [0, 3 * scale], dashes: [] });
  return { loops, solid, pattern: pattern.toUpperCase(), scale, angle, lines };
}
