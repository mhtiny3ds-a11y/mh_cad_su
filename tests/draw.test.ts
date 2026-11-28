import { describe, expect, it } from 'vitest';
import { Drawing } from '../src/core/document';
import type { Ctx } from '../src/core/commands';
import { createRegistry } from '../src/core/registry';
import { createApi } from '../src/core/api';
import { bbox, distanceTo, intersections, moveEnt, rotateEnt, tangentPoints, textCorners, textLineOrigins, touchesBox } from '../src/core/entities';
import { readDxf, writeDxf } from '../src/core/dxf';
import { revcloudPts, splinePts, wrapText } from '../src/core/cmds/draw';
import { offsetEntity } from '../src/core/offset';
import { plotSvg } from '../src/core/svg';

function setup() {
  const doc = new Drawing();
  const reg = createRegistry();
  const selection = new Set<number>();
  const ctx: Ctx = { doc, selection, print: () => {} };
  const api = createApi({ doc, reg, ctx: () => ctx, version: 't', setSelection: () => {} });
  const first = (r: Record<string, unknown>) => (r.ids as number[])[0];
  return { doc, api, first, selection };
}

describe('XLINE / RAY', () => {
  it('tạo đường dựng, cắt đoạn thẳng ở xa điểm gốc, không làm phình "xem toàn bộ"', () => {
    const { doc, api, first } = setup();
    const x = doc.get(first(api.run('XLINE', { point: [0, 0], angle: 0 })))!;
    expect(x.type).toBe('XLINE');
    const l = doc.get(first(api.run('LINE', { points: [[50000, -10], [50000, 10]] })))!;
    const pts = intersections(x, l);
    expect(pts).toHaveLength(1);
    expect(pts[0][0]).toBeCloseTo(50000, 3);
    expect(pts[0][1]).toBeCloseTo(0, 3);
    const b = bbox(x);
    expect(b.maxX - b.minX).toBe(0);
    expect(distanceTo(x, [-123456, 5])).toBeCloseTo(5, 3);
    expect(touchesBox(x, { minX: -1e6, minY: -1, maxX: -1e6 + 10, maxY: 1 })).toBe(true);
  });

  it('tia chỉ đi một phía', () => {
    const { doc, api, first } = setup();
    const r = doc.get(first(api.run('RAY', { start: [0, 0], through: [10, 0] })))!;
    expect(intersections(r, { type: 'LINE', a: [-100, -1], b: [-100, 1], layer: '0' })).toHaveLength(0);
    expect(intersections(r, { type: 'LINE', a: [100, -1], b: [100, 1], layer: '0' })).toHaveLength(1);
  });

  it('di chuyển, xoay, offset giữ hướng đơn vị', () => {
    const { doc, api, first } = setup();
    const x = doc.get(first(api.run('XLINE', { point: [0, 0], through: [10, 0] })))!;
    const m = moveEnt(x, [5, 5]);
    expect(m.type === 'XLINE' && m.p).toEqual([5, 5]);
    const r = rotateEnt(x, [0, 0], 90);
    if (r.type !== 'XLINE') throw new Error();
    expect(r.dir[0]).toBeCloseTo(0, 9);
    expect(r.dir[1]).toBeCloseTo(1, 9);
    const o = offsetEntity(x, 100, [0, 50]);
    expect(o?.type === 'XLINE' && o.p[1]).toBeCloseTo(100, 9);
  });

  it('đọc XLINE/RAY từ DXF; ghi ra R12 thành LINE đủ dài', () => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'XLINE', '8', '0', '10', '1', '20', '2', '11', '0', '21', '2', '0', 'RAY', '8', '0', '10', '0', '20', '0', '11', '1', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const r = readDxf(dxf);
    const [a, b] = r.data.entities;
    expect(a.type === 'XLINE' && !a.ray && a.dir).toEqual([0, 1]);
    expect(b.type === 'XLINE' && b.ray).toBe(true);
    const out = writeDxf(r.data);
    const back = readDxf(out).data.entities;
    expect(back.every((e) => e.type === 'LINE')).toBe(true);
  });

  it('in SVG cắt đường dựng theo khung in', () => {
    const { doc, api } = setup();
    api.run('XLINE', { point: [0, 0], angle: 30 });
    const r = plotSvg(doc, { box: { minX: -100, minY: -100, maxX: 100, maxY: 100 }, paper: 'A4', landscape: true });
    expect(r.svg).toContain('<line');
  });
});

describe('Bắt điểm tiếp tuyến', () => {
  it('hai tiếp điểm từ điểm ngoài đường tròn', () => {
    const t = tangentPoints({ type: 'CIRCLE', c: [0, 0], r: 5, layer: '0' }, [10, 0]);
    expect(t).toHaveLength(2);
    for (const p of t) {
      // Bán kính vuông góc với đường từ điểm ngoài tới tiếp điểm.
      expect(p[0] * (10 - p[0]) + p[1] * (0 - p[1])).toBeCloseTo(0, 9);
    }
    expect(tangentPoints({ type: 'CIRCLE', c: [0, 0], r: 5, layer: '0' }, [1, 0])).toHaveLength(0);
  });
});

describe('DONUT, REVCLOUD, SPLINE', () => {
  it('DONUT là vùng tô đặc hai vòng; trong = 0 thành chấm tròn', () => {
    const { doc, api, first } = setup();
    const d = doc.get(first(api.run('DONUT', { center: [0, 0], inner: 50, outer: 100 })))!;
    expect(d.type === 'HATCH' && d.solid && d.loops.length).toBe(2);
    const s = doc.get(first(api.run('DONUT', { center: [0, 0], inner: 0, outer: 100 })))!;
    expect(s.type === 'HATCH' && s.loops.length).toBe(1);
    expect(() => api.run('DONUT', { center: [0, 0], inner: 100, outer: 50 })).toThrow();
  });

  it('REVCLOUD hình chữ nhật: cung lồi ra ngoài khung', () => {
    const pts = revcloudPts([[0, 0], [1000, 0], [1000, 500], [0, 500]], true, 250);
    expect(pts.length).toBeGreaterThan(40);
    const minY = Math.min(...pts.map((p) => p[1]));
    const maxX = Math.max(...pts.map((p) => p[0]));
    expect(minY).toBeLessThan(-10);
    expect(maxX).toBeGreaterThan(1010);
    // Chiều ngược lại của đường dẫn cũng lồi ra ngoài.
    const cw = revcloudPts([[0, 0], [0, 500], [1000, 500], [1000, 0]], true, 250);
    expect(Math.min(...cw.map((p) => p[1]))).toBeLessThan(-10);
  });

  it('REVCLOUD từ đường tròn thay đối tượng gốc, hoàn tác được', () => {
    const { doc, api, first } = setup();
    const c = first(api.run('CIRCLE', { center: [0, 0], radius: 1000 }));
    api.run('REVCLOUD', { ids: [c], arc: 300 });
    expect(doc.get(c)).toBeUndefined();
    expect(doc.all()[0].type).toBe('LWPOLYLINE');
    api.undo();
    expect(doc.get(c)?.type).toBe('CIRCLE');
  });

  it('SPLINE đi qua mọi điểm đã cho', () => {
    const P: [number, number][] = [[0, 0], [100, 80], [200, -50], [300, 0]];
    const s = splinePts(P, false);
    for (const p of P) expect(Math.min(...s.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])))).toBeLessThan(1e-9);
    expect(s.length).toBe(1 + 3 * 16);
  });
});

describe('MTEXT & chữ nhiều dòng', () => {
  it('tự ngắt dòng theo bề rộng', () => {
    expect(wrapText('một hai ba bốn năm', 10 * 0.6 * 10, 10)).toBe('một hai ba\nbốn năm');
  });

  it('MTEXT tạo chữ căn trên, khung bao gồm mọi dòng', () => {
    const { doc, api, first } = setup();
    const e = doc.get(first(api.run('MTEXT', { position: [0, 1000], text: 'Dòng 1\\PDòng thứ hai', height: 100 })))!;
    if (e.type !== 'TEXT') throw new Error();
    expect(e.text).toBe('Dòng 1\nDòng thứ hai');
    const c = textCorners(e);
    expect(Math.max(...c.map((p) => p[1]))).toBeCloseTo(1000, 6);
    expect(Math.min(...c.map((p) => p[1]))).toBeCloseTo(1000 - 100 * 2.6, 6);
    const lines = textLineOrigins(e);
    expect(lines.map((l) => l.p[1])).toEqual([900, 740]);
  });

  it('ghi DXF R12 tách thành từng dòng TEXT', () => {
    const { doc, api } = setup();
    api.run('MTEXT', { position: [0, 0], text: 'A\nB\nC', height: 10 });
    const back = readDxf(writeDxf(doc.toData())).data.entities;
    expect(back.filter((e) => e.type === 'TEXT').map((e) => e.type === 'TEXT' && e.text)).toEqual(['A', 'B', 'C']);
  });
});

describe('FIND', () => {
  it('tìm (không phân biệt hoa thường) rồi thay thế, hoàn tác được', () => {
    const { doc, api, first, selection } = setup();
    const a = first(api.run('TEXT', { position: [0, 0], text: 'Phòng ngủ 1' }));
    api.run('TEXT', { position: [0, 500], text: 'Bếp' });
    const r = api.run('FIND', { find: 'phòng' });
    expect(r.ids).toEqual([a]);
    expect([...selection]).toEqual([a]);
    api.run('FIND', { find: 'Phòng ngủ', replace: 'P.Ngủ' });
    expect(doc.get(a)?.type === 'TEXT' && (doc.get(a) as { text: string }).text).toBe('P.Ngủ 1');
    api.undo();
    expect((doc.get(a) as { text: string }).text).toBe('Phòng ngủ 1');
  });
});

describe('Nhiều bản vẽ (saveState / restoreState)', () => {
  it('chuyển qua lại giữ nguyên đối tượng, layer và lịch sử hoàn tác', () => {
    const { doc, api } = setup();
    api.run('LINE', { points: [[0, 0], [10, 0]], layer: 'A' });
    api.run('CIRCLE', { center: [0, 0], radius: 5 });
    const s1 = doc.saveState();
    doc.reset();
    api.run('RECTANG', { p1: [0, 0], p2: [5, 5] });
    const s2 = doc.saveState();
    doc.restoreState(s1);
    expect(doc.entities.size).toBe(2);
    expect(doc.layers.has('A')).toBe(true);
    api.undo();
    expect(doc.entities.size).toBe(1);
    // Id mới không trùng id cũ sau khi khôi phục.
    const id = (api.run('POINT', { position: [1, 1] }).ids as number[])[0];
    expect(id).toBeGreaterThan(2);
    doc.restoreState(s2);
    expect(doc.all().map((e) => e.type)).toEqual(['LWPOLYLINE']);
    expect(doc.layers.has('A')).toBe(false);
  });
});
