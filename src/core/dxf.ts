// Đọc / ghi DXF dạng ASCII.
// Ghi: định dạng R12 (AC1009) tối giản — AutoCAD, BricsCAD, LibreCAD, DraftSight đều mở được.
// Đọc: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE/VERTEX (2D), TEXT, MTEXT và bảng LAYER.
// Chữ không phải ASCII được ghi bằng mã \U+XXXX (chuẩn DXF) nên tiếng Việt không bị lỗi font.

import type { Vec } from './geom';
import type { NewEntity } from './entities';
import type { DrawingData, Layer } from './document';

// ---------- Ghi ----------

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

const n = (v: number) => {
  const r = Math.round(v * 1e8) / 1e8;
  return Object.is(r, -0) ? '0' : String(r);
};

export function writeDxf(data: DrawingData): string {
  const o: string[] = [];
  const g = (code: number, v: string | number) => o.push(String(code), typeof v === 'number' ? n(v) : v);

  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, unitsCode(data.units));
  g(9, '$CLAYER');
  g(8, encodeDxfText(data.currentLayer ?? '0'));
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, 1);
  g(0, 'LTYPE');
  g(2, 'CONTINUOUS');
  g(70, 0);
  g(3, 'Solid line');
  g(72, 65);
  g(73, 0);
  g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, data.layers.length);
  for (const l of data.layers) {
    g(0, 'LAYER');
    g(2, encodeDxfText(l.name));
    g(70, l.locked ? 4 : 0);
    g(62, l.visible ? l.color : -Math.abs(l.color));
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const e of data.entities) {
    const head = (type: string) => {
      g(0, type);
      g(8, encodeDxfText(e.layer));
      if (e.color !== undefined) g(62, e.color);
    };
    switch (e.type) {
      case 'LINE':
        head('LINE');
        g(10, e.a[0]);
        g(20, e.a[1]);
        g(30, 0);
        g(11, e.b[0]);
        g(21, e.b[1]);
        g(31, 0);
        break;
      case 'CIRCLE':
        head('CIRCLE');
        g(10, e.c[0]);
        g(20, e.c[1]);
        g(30, 0);
        g(40, e.r);
        break;
      case 'ARC':
        head('ARC');
        g(10, e.c[0]);
        g(20, e.c[1]);
        g(30, 0);
        g(40, e.r);
        g(50, e.start);
        g(51, e.end);
        break;
      case 'LWPOLYLINE':
        // R12 không có LWPOLYLINE → ghi POLYLINE + VERTEX + SEQEND.
        head('POLYLINE');
        g(66, 1);
        g(10, 0);
        g(20, 0);
        g(30, 0);
        g(70, e.closed ? 1 : 0);
        for (const p of e.pts) {
          g(0, 'VERTEX');
          g(8, encodeDxfText(e.layer));
          g(10, p[0]);
          g(20, p[1]);
          g(30, 0);
        }
        g(0, 'SEQEND');
        g(8, encodeDxfText(e.layer));
        break;
      case 'TEXT':
        head('TEXT');
        g(10, e.p[0]);
        g(20, e.p[1]);
        g(30, 0);
        g(40, e.h);
        g(1, encodeDxfText(e.text));
        if (e.rot) g(50, e.rot);
        break;
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}

const UNITS: Record<string, number> = { in: 1, ft: 2, mm: 4, cm: 5, m: 6 };
const unitsCode = (u?: string) => UNITS[u ?? 'mm'] ?? 4;
const unitsName = (c: number) => Object.entries(UNITS).find(([, v]) => v === c)?.[0];

// ---------- Đọc ----------

export function decodeDxfText(s: string): string {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±');
}

/** Bỏ mã định dạng MTEXT (\P, {\f...;}, \H..; ...), giữ phần chữ. */
export function stripMtext(s: string): string {
  return decodeDxfText(s)
    .replace(/\\P/g, '\n')
    .replace(/\\[ACcFfHhQqTtWw][^;]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\S([^;]*);/g, (_, x: string) => x.replace(/[#^]/g, '/'))
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\');
}

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

export function readDxf(text: string): DxfReadResult {
  if (/^AutoCAD Binary DXF/.test(text)) throw new Error('Chưa hỗ trợ DXF nhị phân, hãy lưu lại dạng ASCII');
  const P = pairs(text);
  const layers = new Map<string, Layer>();
  const entities: NewEntity[] = [];
  const skipped: Record<string, number> = {};
  let units: string | undefined;
  let clayer: string | undefined;

  let i = 0;
  const at = () => P[i];

  // Gom nhóm mã của một bản ghi (từ sau mã 0 cho tới mã 0 kế tiếp).
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
  const common = (r: Pair[]) => {
    const layer = decodeDxfText(get(r, 8) ?? '0');
    const c = get(r, 62);
    const color = c === undefined ? undefined : Number(c);
    // 256 = ByLayer, 0 = ByBlock → coi như theo layer.
    return color === undefined || color === 256 || color === 0 ? { layer } : { layer, color: Math.abs(color) };
  };

  let section = '';
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
        // HEADER là chuỗi biến 9 / giá trị.
        let j = 0;
        while (j < r.length) {
          if (r[j][0] === 9 && r[j][1] === '$INSUNITS' && r[j + 1]) units = unitsName(Number(r[j + 1][1]));
          if (r[j][0] === 9 && r[j][1] === '$CLAYER' && r[j + 1]) clayer = decodeDxfText(r[j + 1][1]);
          j++;
        }
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
        layers.set(decodeDxfText(name), {
          name: decodeDxfText(name),
          color: Math.abs(c) || 7,
          visible: c >= 0,
          locked: (num(r, 70) & 4) !== 0,
        });
      }
      continue;
    }
    if (section !== 'ENTITIES') {
      record();
      continue;
    }

    const r = record();
    switch (val) {
      case 'LINE':
        entities.push({ type: 'LINE', a: [num(r, 10), num(r, 20)], b: [num(r, 11), num(r, 21)], ...common(r) });
        break;
      case 'CIRCLE':
        entities.push({ type: 'CIRCLE', c: [num(r, 10), num(r, 20)], r: num(r, 40), ...common(r) });
        break;
      case 'ARC':
        entities.push({
          type: 'ARC',
          c: [num(r, 10), num(r, 20)],
          r: num(r, 40),
          start: num(r, 50),
          end: num(r, 51),
          ...common(r),
        });
        break;
      case 'LWPOLYLINE': {
        const pts: Vec[] = [];
        for (let k = 0; k < r.length; k++) {
          if (r[k][0] === 10) {
            const y = r[k + 1] && r[k + 1][0] === 20 ? Number(r[k + 1][1]) : 0;
            pts.push([Number(r[k][1]), y]);
          }
          if (r[k][0] === 42 && Number(r[k][1]) !== 0) skipped['LWPOLYLINE (đoạn cong → thẳng)'] = (skipped['LWPOLYLINE (đoạn cong → thẳng)'] ?? 0) + 1;
        }
        if (pts.length >= 2) entities.push({ type: 'LWPOLYLINE', pts, closed: (num(r, 70) & 1) !== 0, ...common(r) });
        break;
      }
      case 'POLYLINE': {
        const flags = num(r, 70);
        const pts: Vec[] = [];
        while (i < P.length && at()[0] === 0 && at()[1] === 'VERTEX') {
          const v = record();
          pts.push([num(v, 10), num(v, 20)]);
        }
        if (i < P.length && at()[1] === 'SEQEND') record();
        if (flags & (16 | 64)) {
          skipped['POLYLINE 3D/mesh'] = (skipped['POLYLINE 3D/mesh'] ?? 0) + 1;
          break;
        }
        if (pts.length >= 2) entities.push({ type: 'LWPOLYLINE', pts, closed: (flags & 1) !== 0, ...common(r) });
        break;
      }
      case 'TEXT':
        entities.push({
          type: 'TEXT',
          p: [num(r, 10), num(r, 20)],
          h: num(r, 40, 2.5) || 2.5,
          text: decodeDxfText(get(r, 1) ?? ''),
          rot: num(r, 50),
          ...common(r),
        });
        break;
      case 'MTEXT': {
        // Nội dung dài được chia ở mã 3, phần cuối ở mã 1.
        const raw = r.filter((p) => p[0] === 3).map((p) => p[1]).join('') + (get(r, 1) ?? '');
        const lines = stripMtext(raw).split('\n');
        const h = num(r, 40, 2.5) || 2.5;
        const rot = get(r, 50) !== undefined ? num(r, 50) : (Math.atan2(num(r, 21), num(r, 11, 1)) * 180) / Math.PI;
        lines.forEach((t, k) => {
          if (t.trim())
            entities.push({ type: 'TEXT', p: [num(r, 10), num(r, 20) - (k + 1) * h * 1.6], h, text: t, rot, ...common(r) });
        });
        break;
      }
      default:
        skipped[val] = (skipped[val] ?? 0) + 1;
    }
  }

  for (const e of entities) if (!layers.has(e.layer)) layers.set(e.layer, { name: e.layer, color: 7, visible: true, locked: false });
  if (!layers.has('0')) layers.set('0', { name: '0', color: 7, visible: true, locked: false });

  return {
    data: {
      format: 'mhcad',
      version: 1,
      units,
      currentLayer: clayer && layers.has(clayer) ? clayer : '0',
      layers: [...layers.values()],
      entities,
    },
    skipped,
  };
}
