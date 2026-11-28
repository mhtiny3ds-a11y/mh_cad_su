import { describe, expect, it } from 'vitest';
import { Drawing } from '../src/core/document';
import { decodeDxfText, encodeDxfText, readDxf, stripMtext, writeDxf } from '../src/core/dxf';

describe('DXF', () => {
  it('mã hoá tiếng Việt và giải mã lại', () => {
    const s = 'Phòng khách – tầng 1';
    const enc = encodeDxfText(s);
    expect(enc).toMatch(/^[\x00-\x7f]*$/);
    expect(decodeDxfText(enc)).toBe(s);
  });

  it('ghi rồi đọc lại giữ nguyên dữ liệu', () => {
    const d = new Drawing();
    d.transact('t', () => {
      d.ensureLayer('TƯỜNG', 1);
      d.setCurrentLayer('TƯỜNG');
      d.add({ type: 'LINE', a: [0, 0], b: [1000, 0], layer: 'TƯỜNG' });
      d.add({ type: 'CIRCLE', c: [5, 5], r: 2.5, layer: '0', color: 3 });
      d.add({ type: 'ARC', c: [0, 0], r: 10, start: 30, end: 200, layer: '0' });
      d.add({ type: 'LWPOLYLINE', pts: [[0, 0], [10, 0], [10, 10]], closed: true, layer: 'TƯỜNG' });
      d.add({ type: 'TEXT', p: [1, 2], h: 250, text: 'Bếp ăn', rot: 90, layer: '0' });
    });
    const text = writeDxf(d.toData());
    expect(text).toMatch(/AC1009/);
    expect(text.endsWith('EOF\r\n')).toBe(true);
    const { data, skipped } = readDxf(text);
    expect(skipped).toEqual({});
    expect(data.currentLayer).toBe('TƯỜNG');
    expect(data.units).toBe('mm');
    expect(data.layers.find((l) => l.name === 'TƯỜNG')?.color).toBe(1);
    const orig = d.toData().entities;
    expect(data.entities).toEqual(orig);
  });

  it('đọc LWPOLYLINE, MTEXT, bỏ qua loại chưa hỗ trợ', () => {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'A', '90', '3', '70', '1', '10', '0', '20', '0', '10', '5', '20', '0', '10', '5', '20', '5',
      '0', 'MTEXT', '8', 'B', '10', '0', '20', '0', '40', '2', '1', '{\\fArial|b0;Dòng 1\\PDòng 2}',
      '0', 'INSERT', '8', '0', '2', 'BLK', '10', '0', '20', '0',
      '0', 'ENDSEC', '0', 'EOF', '',
    ].join('\n');
    const { data, skipped } = readDxf(dxf);
    expect(data.entities[0]).toMatchObject({ type: 'LWPOLYLINE', closed: true, pts: [[0, 0], [5, 0], [5, 5]] });
    expect(data.entities.filter((e) => e.type === 'TEXT').map((e) => (e as { text: string }).text)).toEqual(['Dòng 1', 'Dòng 2']);
    expect(skipped).toEqual({ INSERT: 1 });
    expect(stripMtext('\\H2.5;Cao\\Pthấp')).toBe('Cao\nthấp');
  });
});
