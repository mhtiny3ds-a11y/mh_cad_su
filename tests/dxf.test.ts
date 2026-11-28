import { describe, expect, it } from 'vitest';
import { Drawing } from '../src/core/document';
import { decodeDxfBytes, decodeDxfText, encodeDxfText, readDxf, stripMtext, writeDxf } from '../src/core/dxf';

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

  it('ghi rồi đọc lại block, kích thước, kiểu đường, căn chữ', () => {
    const d = new Drawing();
    d.transact('t', () => {
      d.setBlock({ name: 'CỬA', base: [0, 0], ents: [{ type: 'LINE', a: [0, 0], b: [900, 0], layer: '0' }] });
      d.add({ type: 'INSERT', name: 'CỬA', p: [100, 200], sx: 1, sy: -1, rot: 90, layer: '0' });
      d.add({ type: 'DIMENSION', kind: 'linear', pts: [[0, 0], [1000, 0], [500, -500]], rot: 0, style: d.dimStyle, layer: 'DIM' });
      d.add({ type: 'LINE', a: [0, 0], b: [1, 1], layer: '0', lt: 'CENTER' });
      d.add({ type: 'TEXT', p: [5, 5], h: 100, text: 'Giữa', rot: 0, ha: 'C', va: 'M', layer: '0' });
      d.setLtscale(20);
    });
    const { data } = readDxf(writeDxf(d.toData()));
    expect(data.ltscale).toBe(20);
    expect(data.blocks!.find((b) => b.name === 'CỬA')!.ents).toHaveLength(1);
    expect(data.entities.find((e) => e.type === 'INSERT' && e.name === 'CỬA')).toMatchObject({ p: [100, 200], sy: -1, rot: 90 });
    // Kích thước được đọc lại qua block hình vẽ *D1 (hiển thị đúng như khi ghi).
    const dim = data.entities.find((e) => e.type === 'INSERT' && e.name.startsWith('*D'));
    expect(dim).toBeTruthy();
    expect(data.blocks!.find((b) => b.name === '*D1')!.ents.some((e) => e.type === 'TEXT' && e.text === '1000')).toBe(true);
    expect(data.entities.find((e) => e.type === 'LINE' && e.lt === 'CENTER')).toBeTruthy();
    expect(data.entities.find((e) => e.type === 'TEXT')).toMatchObject({ ha: 'C', va: 'M', p: [5, 5] });
  });

  it('đọc cung trong đa tuyến (bulge), ELLIPSE, SOLID, MINSERT, ATTRIB', () => {
    const dxf = [
      '0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '8', '0', '2', 'B', '70', '0', '10', '0', '20', '0',
      '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '10', '21', '0',
      '0', 'ENDBLK', '8', '0',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'A', '90', '2', '70', '0', '10', '0', '20', '0', '42', '1', '10', '10', '20', '0',
      '0', 'ELLIPSE', '8', 'A', '10', '0', '20', '0', '11', '10', '21', '0', '40', '0.5', '41', '0', '42', '6.283185307179586',
      '0', 'SOLID', '8', 'A', '10', '0', '20', '0', '11', '1', '21', '0', '12', '0', '22', '1', '13', '1', '23', '1',
      '0', 'INSERT', '8', 'A', '66', '1', '2', 'B', '10', '0', '20', '0', '70', '3', '71', '2', '44', '100', '45', '50',
      '0', 'ATTRIB', '8', 'A', '10', '1', '20', '2', '40', '3', '1', 'P101', '2', 'TAG', '70', '0',
      '0', 'SEQEND', '8', 'A',
      '0', 'LINE', '8', 'A', '67', '1', '10', '0', '20', '0', '11', '1', '21', '1',
      '0', 'ENDSEC', '0', 'EOF', '',
    ].join('\n');
    const { data, skipped } = readDxf(dxf);
    const poly = data.entities[0];
    expect(poly.type).toBe('LWPOLYLINE');
    if (poly.type === 'LWPOLYLINE') {
      // Nửa đường tròn bán kính 5 qua (5, -5) hoặc (5, 5).
      expect(poly.pts.length).toBeGreaterThan(5);
      expect(Math.max(...poly.pts.map((p) => Math.abs(p[1])))).toBeCloseTo(5, 1);
    }
    const ell = data.entities[1];
    if (ell.type === 'LWPOLYLINE') expect(Math.max(...ell.pts.map((p) => p[1]))).toBeCloseTo(5, 1);
    expect(data.entities[2]).toMatchObject({ type: 'LWPOLYLINE', fill: true, pts: [[0, 0], [1, 0], [1, 1], [0, 1]] });
    expect(data.entities.filter((e) => e.type === 'INSERT')).toHaveLength(6);
    expect(data.entities.find((e) => e.type === 'TEXT')).toMatchObject({ text: 'P101' });
    expect(skipped).toEqual({ 'Paper space': 1 });
  });

  it('giải mã bảng mã: UTF-8 (2007+) và ANSI_1258', () => {
    const utf = new TextEncoder().encode('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n0\nENDSEC\n999\nNhà\n');
    expect(decodeDxfBytes(utf)).toContain('Nhà');
    const ansi = new Uint8Array([...new TextEncoder().encode('9\n$ACADVER\n1\nAC1015\n9\n$DWGCODEPAGE\n3\nANSI_1258\n999\n'), 0xd0]);
    expect(decodeDxfBytes(ansi)).toContain('Đ');
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
    expect(skipped).toEqual({ 'INSERT (thiếu block)': 1 });
    expect(stripMtext('\\H2.5;Cao\\Pthấp')).toBe('Cao\nthấp');
  });
});
