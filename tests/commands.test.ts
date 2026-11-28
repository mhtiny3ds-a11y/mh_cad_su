import { describe, expect, it } from 'vitest';
import { Drawing } from '../src/core/document';
import { type Ctx, runCommand } from '../src/core/commands';
import { createRegistry } from '../src/core/registry';
import { createApi } from '../src/core/api';
import { intersections, snapPoints } from '../src/core/entities';

function setup() {
  const doc = new Drawing();
  const reg = createRegistry();
  const selection = new Set<number>();
  const ctx: Ctx = { doc, selection, print: () => {} };
  const api = createApi({ doc, reg, ctx: () => ctx, version: 'test', setSelection: (ids) => { selection.clear(); ids.forEach((i) => selection.add(i)); } });
  return { doc, reg, ctx, api };
}

describe('lệnh vẽ', () => {
  it('LINE tạo các đoạn và một lần undo xoá hết', () => {
    const { doc, api } = setup();
    const r = api.run('LINE', { points: [[0, 0], [100, 0], [100, 100]], close: true });
    expect(r.ids).toHaveLength(3);
    expect(doc.entities.size).toBe(3);
    expect(api.undo()).toBe('LINE');
    expect(doc.entities.size).toBe(0);
    api.redo();
    expect(doc.entities.size).toBe(3);
  });

  it('alias và tham số dạng {x,y}', () => {
    const { api } = setup();
    const r = api.run('c', { center: { x: 5, y: 5 }, radius: 10 });
    const e = api.query.entity((r.ids as number[])[0])!;
    expect(e).toMatchObject({ type: 'CIRCLE', c: [5, 5], r: 10, layer: '0' });
  });

  it('báo lỗi rõ ràng khi thiếu tham số và không làm bẩn bản vẽ', () => {
    const { doc, api } = setup();
    expect(() => api.run('CIRCLE', { center: [0, 0] })).toThrow(/radius/);
    expect(() => api.run('CIRCLE', { center: [0, 0], radius: -1 })).toThrow();
    expect(doc.entities.size).toBe(0);
    expect(doc.canUndo()).toBe(false);
  });

  it('RECTANG tạo đa tuyến kín, LIST báo diện tích', () => {
    const { api } = setup();
    const id = (api.run('RECTANG', { p1: [0, 0], p2: [4000, 6000] }).ids as number[])[0];
    expect(api.query.describe(id)).toMatch(/diện tích 24000000/);
  });

  it('ARC qua 3 điểm', () => {
    const { api } = setup();
    const id = (api.run('ARC', { p1: [10, 0], p2: [0, 10], p3: [-10, 0] }).ids as number[])[0];
    const e = api.query.entity(id)!;
    expect(e.type).toBe('ARC');
    if (e.type === 'ARC') {
      expect(e.r).toBeCloseTo(10);
      expect(e.start).toBeCloseTo(0);
      expect(e.end).toBeCloseTo(180);
    }
  });

  it('LAYER tạo layer, đặt hiện hành, đối tượng mới vào layer đó', () => {
    const { doc, api } = setup();
    api.run('LAYER', { name: 'TUONG', color: 1 });
    expect(doc.currentLayer).toBe('TUONG');
    const id = (api.run('LINE', { points: [[0, 0], [1, 1]] }).ids as number[])[0];
    expect(doc.get(id)!.layer).toBe('TUONG');
    api.undo();
    api.undo();
    expect(doc.currentLayer).toBe('0');
    expect(doc.layers.has('TUONG')).toBe(false);
  });
});

describe('lệnh sửa', () => {
  it('MOVE, COPY, ROTATE, SCALE, MIRROR, ERASE', () => {
    const { doc, api } = setup();
    const [id] = api.run('LINE', { points: [[0, 0], [10, 0]] }).ids as number[];
    api.run('MOVE', { ids: [id], from: [0, 0], to: [5, 5] });
    expect(doc.get(id)).toMatchObject({ a: [5, 5], b: [15, 5] });
    const [cp] = api.run('COPY', { ids: [id], displacement: [0, 10] }).ids as number[];
    expect(doc.get(cp)).toMatchObject({ a: [5, 15], b: [15, 15] });
    api.run('ROTATE', { ids: [id], base: [5, 5], angle: 90 });
    const r = doc.get(id)!;
    if (r.type === 'LINE') {
      expect(r.b[0]).toBeCloseTo(5);
      expect(r.b[1]).toBeCloseTo(15);
    }
    api.run('SCALE', { ids: [cp], base: [5, 15], factor: 2 });
    expect(doc.get(cp)).toMatchObject({ b: [25, 15] });
    const [m] = api.run('MIRROR', { ids: [cp], p1: [0, 0], p2: [1, 0] }).ids as number[];
    expect(doc.get(m)).toMatchObject({ a: [5, -15] });
    api.run('ERASE', { ids: [id, cp, m] });
    expect(doc.entities.size).toBe(0);
  });

  it('OFFSET đường thẳng, đường tròn, đa tuyến kín', () => {
    const { doc, api } = setup();
    const [l] = api.run('LINE', { points: [[0, 0], [100, 0]] }).ids as number[];
    const [o] = api.run('OFFSET', { ids: [l], distance: 20, side: [50, 30] }).ids as number[];
    expect(doc.get(o)).toMatchObject({ a: [0, 20], b: [100, 20] });
    const [c] = api.run('CIRCLE', { center: [0, 0], radius: 50 }).ids as number[];
    const [ci] = api.run('OFFSET', { ids: [c], distance: 10, side: [1, 1] }).ids as number[];
    expect(doc.get(ci)).toMatchObject({ r: 40 });
    const [rect] = api.run('RECTANG', { p1: [0, 0], p2: [100, 50] }).ids as number[];
    const [ro] = api.run('OFFSET', { ids: [rect], distance: 10, side: [-5, -5] }).ids as number[];
    const e = doc.get(ro)!;
    expect(e.type).toBe('LWPOLYLINE');
    if (e.type === 'LWPOLYLINE') {
      const xs = e.pts.map((p) => p[0]);
      const ys = e.pts.map((p) => p[1]);
      expect(Math.min(...xs)).toBeCloseTo(-10);
      expect(Math.max(...xs)).toBeCloseTo(110);
      expect(Math.min(...ys)).toBeCloseTo(-10);
      expect(Math.max(...ys)).toBeCloseTo(60);
    }
  });

  it('EXPLODE đa tuyến thành đoạn thẳng', () => {
    const { doc, api } = setup();
    const [rect] = api.run('RECTANG', { p1: [0, 0], p2: [10, 10] }).ids as number[];
    expect((api.run('EXPLODE', { ids: [rect] }).ids as number[]).length).toBe(4);
    expect(doc.all().every((e) => e.type === 'LINE')).toBe(true);
  });

  it('không sửa được đối tượng trên layer khoá', () => {
    const { api } = setup();
    api.run('LAYER', { name: 'KHOA' });
    const [id] = api.run('LINE', { points: [[0, 0], [1, 0]] }).ids as number[];
    api.run('LAYER', { name: 'KHOA', locked: true });
    expect(() => api.run('ERASE', { ids: [id] })).toThrow(/khoá/);
  });

  it('batch gộp thành một bước undo và khôi phục khi lỗi', () => {
    const { doc, api } = setup();
    api.batch('Phòng', () => {
      api.run('LAYER', { name: 'TUONG' });
      api.run('RECTANG', { p1: [0, 0], p2: [4000, 6000] });
      api.run('TEXT', { position: [100, 100], text: 'Phòng ngủ' });
    });
    expect(doc.entities.size).toBe(2);
    expect(() =>
      api.batch('Lỗi', () => {
        api.run('LINE', { points: [[0, 0], [1, 1]] });
        api.run('CIRCLE', { center: [0, 0] });
      }),
    ).toThrow();
    expect(doc.entities.size).toBe(2);
    expect(api.undo()).toBe('Phòng');
    expect(doc.entities.size).toBe(0);
    expect(doc.currentLayer).toBe('0');
  });

  it('DIST là lệnh chỉ đọc', () => {
    const { doc, api } = setup();
    const r = api.run('DIST', { p1: [0, 0], p2: [3, 4] });
    expect(r.distance).toBe(5);
    expect(doc.canUndo()).toBe(false);
  });
});

describe('bắt điểm', () => {
  it('giao điểm đường thẳng với cung', () => {
    const { doc, api } = setup();
    api.run('LINE', { points: [[-20, 5], [20, 5]] });
    api.run('ARC', { center: [0, 0], radius: 10, startAngle: 0, endAngle: 90 });
    const [l, a] = doc.all();
    const xs = intersections(l, a);
    expect(xs).toHaveLength(1);
    expect(xs[0][0]).toBeCloseTo(Math.sqrt(75));
    expect(snapPoints(a).map((s) => s.kind)).toEqual(['end', 'end', 'mid', 'center']);
  });
});

describe('registry', () => {
  it('schema có mô tả cho mọi lệnh', () => {
    const { reg, ctx } = setup();
    for (const c of reg.schema()) {
      expect(c.desc.length).toBeGreaterThan(5);
      for (const p of c.params) expect(p.desc.length).toBeGreaterThan(2);
    }
    expect(() => runCommand(reg, ctx, 'KHONGCO')).toThrow(/Không có lệnh/);
  });
});
