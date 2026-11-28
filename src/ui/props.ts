// Bảng Thuộc tính (Ctrl+1): xem và sửa thuộc tính của đối tượng đang chọn qua lệnh SETPROP.

import type { Drawing } from '../core/document';
import { type Entity, bbox, describe, hatchArea, polyArea, polyLength } from '../core/entities';
import { measure } from '../core/dim';
import { PATTERNS } from '../core/hatch';
import { angleOf, dist, rad2deg, sub } from '../core/geom';

type Run = (cmd: string, args: Record<string, unknown>) => void;

const TYPE_NAME: Record<string, string> = {
  LINE: 'Đoạn thẳng',
  CIRCLE: 'Đường tròn',
  ARC: 'Cung tròn',
  LWPOLYLINE: 'Đa tuyến',
  TEXT: 'Chữ',
  DIMENSION: 'Kích thước',
  INSERT: 'Block',
  HATCH: 'Vùng tô',
  POINT: 'Điểm',
  XLINE: 'Đường dựng',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const r3 = (n: number) => String(Math.round(n * 1000) / 1000);

interface Field {
  key: string;
  label: string;
  value: string;
  kind: 'num' | 'text' | 'select' | 'check' | 'ro';
  options?: string[];
}

function fieldsOf(e: Entity): Field[] {
  const pt = (key: string, label: string, p: readonly number[]): Field[] => [
    { key: `${key}.0`, label: `${label} X`, value: r3(p[0]), kind: 'num' },
    { key: `${key}.1`, label: `${label} Y`, value: r3(p[1]), kind: 'num' },
  ];
  switch (e.type) {
    case 'LINE':
      return [
        ...pt('a', 'Đầu', e.a),
        ...pt('b', 'Cuối', e.b),
        { key: '', label: 'Dài', value: r3(dist(e.a, e.b)), kind: 'ro' },
        { key: '', label: 'Góc', value: `${r3((rad2deg(angleOf(sub(e.b, e.a))) + 360) % 360)}°`, kind: 'ro' },
      ];
    case 'CIRCLE':
      return [
        ...pt('c', 'Tâm', e.c),
        { key: 'r', label: 'Bán kính', value: r3(e.r), kind: 'num' },
        { key: '', label: 'Diện tích', value: r3(Math.PI * e.r * e.r), kind: 'ro' },
      ];
    case 'ARC':
      return [
        ...pt('c', 'Tâm', e.c),
        { key: 'r', label: 'Bán kính', value: r3(e.r), kind: 'num' },
        { key: 'start', label: 'Góc đầu', value: r3(e.start), kind: 'num' },
        { key: 'end', label: 'Góc cuối', value: r3(e.end), kind: 'num' },
      ];
    case 'LWPOLYLINE':
      return [
        { key: 'closed', label: 'Kín', value: String(e.closed), kind: 'check' },
        { key: '', label: 'Số đỉnh', value: String(e.pts.length), kind: 'ro' },
        { key: '', label: 'Chiều dài', value: r3(polyLength(e)), kind: 'ro' },
        ...(e.closed ? [{ key: '', label: 'Diện tích', value: r3(polyArea(e.pts)), kind: 'ro' as const }] : []),
      ];
    case 'TEXT':
      return [
        { key: 'text', label: 'Nội dung', value: e.text, kind: 'text' },
        ...pt('p', 'Điểm chèn', e.p),
        { key: 'h', label: 'Chiều cao', value: r3(e.h), kind: 'num' },
        { key: 'rot', label: 'Góc xoay', value: r3(e.rot), kind: 'num' },
      ];
    case 'DIMENSION':
      return [
        { key: '', label: 'Giá trị đo', value: r3(measure(e)), kind: 'ro' },
        { key: 'text', label: 'Ghi đè chữ', value: e.text ?? '', kind: 'text' },
      ];
    case 'INSERT':
      return [
        { key: '', label: 'Tên block', value: e.name, kind: 'ro' },
        ...pt('p', 'Điểm chèn', e.p),
        { key: 'sx', label: 'Tỉ lệ X', value: r3(e.sx), kind: 'num' },
        { key: 'sy', label: 'Tỉ lệ Y', value: r3(e.sy), kind: 'num' },
        { key: 'rot', label: 'Góc xoay', value: r3(e.rot), kind: 'num' },
      ];
    case 'HATCH':
      return [
        { key: 'pattern', label: 'Mẫu', value: e.pattern, kind: 'select', options: Object.keys(PATTERNS) },
        { key: 'scale', label: 'Tỉ lệ', value: r3(e.scale), kind: 'num' },
        { key: 'angle', label: 'Góc', value: r3(e.angle), kind: 'num' },
        { key: '', label: 'Diện tích', value: r3(hatchArea(e)), kind: 'ro' },
      ];
    case 'POINT':
      return pt('p', 'Vị trí', e.p);
    case 'XLINE':
      return [
        ...pt('p', 'Điểm gốc', e.p),
        { key: '', label: 'Góc', value: `${r3((rad2deg(angleOf(e.dir)) + 360) % 360)}°`, kind: 'ro' },
        { key: '', label: 'Loại', value: e.ray ? 'Tia (RAY)' : 'Đường dựng (XLINE)', kind: 'ro' },
      ];
  }
}

/** Dựng nội dung bảng; trả về chuỗi nhận dạng để biết khi nào cần dựng lại. */
export function renderProps(el: HTMLElement, doc: Drawing, ids: number[], run: Run): void {
  const ents = ids.map((id) => doc.get(id)).filter((e): e is Entity => !!e);
  if (!ents.length) {
    el.innerHTML = `<p class="muted">Chưa chọn đối tượng nào. Bấm vào đối tượng hoặc kéo khung để chọn.</p>
      <p class="muted">Bản vẽ: ${doc.entities.size} đối tượng · ${doc.layers.size} layer · ${doc.blocks.size} block · đơn vị ${doc.units}</p>`;
    return;
  }
  const counts = new Map<string, number>();
  for (const e of ents) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const same = <T,>(f: (e: Entity) => T) => (ents.every((e) => f(e) === f(ents[0])) ? f(ents[0]) : undefined);
  const layer = same((e) => e.layer);
  const color = same((e) => (e.color === undefined ? 'BYLAYER' : String(e.color)));
  const lt = same((e) => e.lt ?? 'BYLAYER');
  const head =
    ents.length === 1
      ? `${TYPE_NAME[ents[0].type] ?? ents[0].type} <span class="muted">#${ents[0].id}</span>`
      : `${ents.length} đối tượng <span class="muted">(${[...counts].map(([t, n]) => `${TYPE_NAME[t] ?? t} ${n}`).join(', ')})</span>`;
  const layers = [...doc.layers.keys()];
  const lts = ['BYLAYER', ...doc.linetypes.keys()];
  const row = (label: string, control: string) => `<label class="prow"><span>${label}</span>${control}</label>`;
  let html = `<h3>${head}</h3><div class="pgroup"><h4>Chung</h4>`;
  html += row('Layer', `<select data-k="layer">${layer === undefined ? '<option value="">*khác nhau*</option>' : ''}${layers.map((l) => `<option ${l === layer ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
  html += row('Màu', `<input data-k="color" value="${color ?? ''}" placeholder="*khác nhau*" title="1–255 hoặc BYLAYER" />`);
  html += row('Kiểu đường', `<select data-k="linetype">${lt === undefined ? '<option value="">*khác nhau*</option>' : ''}${lts.map((l) => `<option ${l === lt ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
  html += '</div>';
  if (ents.length === 1) {
    const e = ents[0];
    html += `<div class="pgroup"><h4>Hình học</h4>`;
    for (const f of fieldsOf(e)) {
      if (f.kind === 'ro') html += row(f.label, `<output>${esc(f.value)}</output>`);
      else if (f.kind === 'check') html += row(f.label, `<input type="checkbox" data-k="${f.key}" ${f.value === 'true' ? 'checked' : ''} />`);
      else if (f.kind === 'select')
        html += row(f.label, `<select data-k="${f.key}">${f.options!.map((o) => `<option ${o === f.value ? 'selected' : ''}>${o}</option>`).join('')}</select>`);
      else html += row(f.label, `<input data-k="${f.key}" value="${esc(f.value)}" ${f.kind === 'num' ? 'inputmode="decimal"' : ''} />`);
    }
    html += `</div><p class="muted small">${esc(describe(e))}</p>`;
  } else {
    const b = ents.map(bbox).reduce((a, x) => ({ minX: Math.min(a.minX, x.minX), minY: Math.min(a.minY, x.minY), maxX: Math.max(a.maxX, x.maxX), maxY: Math.max(a.maxY, x.maxY) }));
    html += `<p class="muted small">Khung bao: ${r3(b.maxX - b.minX)} × ${r3(b.maxY - b.minY)}</p>`;
  }
  el.innerHTML = html;

  const apply = (k: string, v: unknown) => {
    if (k.includes('.')) {
      // Toạ độ X/Y: ghép với giá trị còn lại.
      const [key, idx] = k.split('.');
      const e = ents[0] as unknown as Record<string, readonly number[]>;
      const p = [...e[key]];
      p[Number(idx)] = Number(v);
      run('SETPROP', { ids, set: { [key]: p } });
    } else run('SETPROP', { ids, set: { [k]: v } });
  };
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((c) => {
    const k = c.dataset.k!;
    const commit = () => {
      const v = c instanceof HTMLInputElement && c.type === 'checkbox' ? c.checked : c.value;
      if (v === '') return;
      apply(k, v);
    };
    c.addEventListener('change', commit);
    c.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') {
        ev.preventDefault();
        commit();
      }
      ev.stopPropagation();
    });
  });
}
