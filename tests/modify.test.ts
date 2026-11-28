import { describe, expect, it } from 'vitest';
import { Drawing } from '../src/core/document';
import type { Ctx } from '../src/core/commands';
import { createRegistry } from '../src/core/registry';
import { createApi } from '../src/core/api';
import type { Entity } from '../src/core/entities';
import { bbox, expand } from '../src/core/entities';
import { measure } from '../src/core/dim';

function setup() {
  const doc = new Drawing();
  const reg = createRegistry();
  const selection = new Set<number>();
  const ctx: Ctx = { doc, selection, print: () => {} };
  const api = createApi({ doc, reg, ctx: () => ctx, version: 't', setSelection: () => {} });
  const first = (r: Record<string, unknown>) => (r.ids as number[])[0];
  return { doc, api, first };
}

const near = (a: readonly number[], b: readonly number[], d = 6) => {
  expect(a[0]).toBeCloseTo(b[0], d);
  expect(a[1]).toBeCloseTo(b[1], d);
};

describe('TRIM', () => {
  it('cắt phần giữa của đoạn thẳng → hai đoạn', () => {
    const { doc, api, first } = setup();
    const l = first(api.run('LINE', { points: [[0, 0], [100, 0]] }));
    api.run('LINE', { points: [[30, -10], [30, 10]] });
    api.run('LINE', { points: [[70, -10], [70, 10]] });
    const r = api.run('TRIM', { id: l, pick: [50, 0] });
    expect((r.ids as number[]).length).toBe(2);
    const parts = (r.ids as number[]).map((id) => doc.get(id)!) as Extract<Entity, { type: 'LINE' }>[];
    near(parts[0].a, [0, 0]);
    near(parts[0].b, [30, 0]);
    near(parts[1].a, [70, 0]);
    near(parts[1].b, [100, 0]);
  });

  it('cắt đầu đoạn thẳng', () => {
    const { doc, api, first } = setup();
    const l = first(api.run('LINE', { points: [[0, 0], [100, 0]] }));
    api.run('LINE', { points: [[30, -10], [30, 10]] });
    api.run('TRIM', { id: l, pick: [10, 0] });
    const e = doc.get(l) as Extract<Entity, { type: 'LINE' }>;
    near(e.a, [30, 0]);
    near(e.b, [100, 0]);
  });

  it('cắt đường tròn thành cung', () => {
    const { doc, api, first } = setup();
    const c = first(api.run('CIRCLE', { center: [0, 0], radius: 10 }));
    api.run('LINE', { points: [[-20, 0], [20, 0]] });
    api.run('TRIM', { id: c, pick: [0, 10] });
    const e = doc.get(c)!;
    expect(e.type).toBe('ARC');
    if (e.type === 'ARC') {
      expect(e.start).toBeCloseTo(180);
      expect(e.end).toBeCloseTo(0);
    }
  });

  it('cắt hình chữ nhật (đa tuyến kín) thành đa tuyến hở', () => {
    const { doc, api, first } = setup();
    const r = first(api.run('RECTANG', { p1: [0, 0], p2: [100, 50] }));
    api.run('LINE', { points: [[40, -10], [40, 60]] });
    api.run('LINE', { points: [[60, -10], [60, 60]] });
    api.run('TRIM', { id: r, pick: [50, 50] });
    const e = doc.get(r)!;
    expect(e.type).toBe('LWPOLYLINE');
    if (e.type === 'LWPOLYLINE') {
      expect(e.closed).toBe(false);
      near(e.pts[0], [40, 50]);
      near(e.pts[e.pts.length - 1], [60, 50]);
      expect(e.pts.length).toBe(6);
    }
  });

  it('báo lỗi khi không có cạnh cắt', () => {
    const { api, first } = setup();
    const l = first(api.run('LINE', { points: [[0, 0], [100, 0]] }));
    expect(() => api.run('TRIM', { id: l, pick: [50, 0] })).toThrow();
  });
});

describe('EXTEND', () => {
  it('kéo dài đoạn thẳng tới đường biên', () => {
    const { doc, api, first } = setup();
    const l = first(api.run('LINE', { points: [[0, 0], [50, 0]] }));
    api.run('LINE', { points: [[80, -10], [80, 10]] });
    api.run('EXTEND', { id: l, pick: [45, 0] });
    near((doc.get(l) as Extract<Entity, { type: 'LINE' }>).b, [80, 0]);
  });
  it('kéo dài cung tới đường thẳng', () => {
    const { doc, api, first } = setup();
    const a = first(api.run('ARC', { center: [0, 0], radius: 10, startAngle: 0, endAngle: 45 }));
    api.run('LINE', { points: [[-20, 10], [20, 10]] });
    api.run('EXTEND', { id: a, pick: [7, 7] });
    const e = doc.get(a)!;
    if (e.type === 'ARC') expect(e.end).toBeCloseTo(90);
  });
});

describe('FILLET / CHAMFER', () => {
  it('FILLET R0 nối hai đường thành góc', () => {
    const { doc, api, first } = setup();
    const l1 = first(api.run('LINE', { points: [[0, 0], [80, 0]] }));
    const l2 = first(api.run('LINE', { points: [[100, 20], [100, 100]] }));
    api.run('FILLET', { id1: l1, id2: l2, radius: 0 });
    near((doc.get(l1) as Extract<Entity, { type: 'LINE' }>).b, [100, 0]);
    near((doc.get(l2) as Extract<Entity, { type: 'LINE' }>).b, [100, 0]);
  });
  it('FILLET bán kính tạo cung tiếp xúc', () => {
    const { doc, api, first } = setup();
    const l1 = first(api.run('LINE', { points: [[0, 0], [100, 0]] }));
    const l2 = first(api.run('LINE', { points: [[100, 0], [100, 100]] }));
    const r = api.run('FILLET', { id1: l1, id2: l2, radius: 20 });
    const arc = doc.get((r.ids as number[])[2])!;
    expect(arc.type).toBe('ARC');
    if (arc.type === 'ARC') {
      near(arc.c, [80, 20]);
      expect(arc.r).toBeCloseTo(20);
      expect(((arc.end - arc.start + 360) % 360)).toBeCloseTo(90);
    }
    near((doc.get(l1) as Extract<Entity, { type: 'LINE' }>).b, [80, 0]);
    near((doc.get(l2) as Extract<Entity, { type: 'LINE' }>).b, [100, 20]);
  });
  it('CHAMFER vát góc', () => {
    const { doc, api, first } = setup();
    const l1 = first(api.run('LINE', { points: [[0, 0], [100, 0]] }));
    const l2 = first(api.run('LINE', { points: [[100, 0], [100, 100]] }));
    const r = api.run('CHAMFER', { id1: l1, id2: l2, d1: 10, d2: 20 });
    const ch = doc.get((r.ids as number[])[2]) as Extract<Entity, { type: 'LINE' }>;
    near(ch.a, [90, 0]);
    near(ch.b, [100, 20]);
  });
});

describe('BREAK / JOIN', () => {
  it('BREAK giữa hai điểm và tại một điểm', () => {
    const { doc, api, first } = setup();
    const l = first(api.run('LINE', { points: [[0, 0], [100, 0]] }));
    const r = api.run('BREAK', { id: l, p1: [20, 0], p2: [40, 0] });
    expect((r.ids as number[]).length).toBe(2);
    const r2 = api.run('BREAK', { id: l, p1: [10, 0] });
    expect((r2.ids as number[]).length).toBe(2);
    expect(doc.entities.size).toBe(3);
  });
  it('JOIN các đoạn nối tiếp thành đa tuyến kín', () => {
    const { doc, api } = setup();
    const r = api.run('LINE', { points: [[0, 0], [10, 0], [10, 10], [0, 10]], close: true });
    const j = api.run('JOIN', { ids: r.ids });
    const e = doc.get((j.ids as number[])[0])!;
    expect(doc.entities.size).toBe(1);
    expect(e).toMatchObject({ type: 'LWPOLYLINE', closed: true });
    if (e.type === 'LWPOLYLINE') expect(e.pts.length).toBe(4);
  });
  it('JOIN hai đoạn thẳng hàng thành một LINE', () => {
    const { doc, api, first } = setup();
    const a = first(api.run('LINE', { points: [[0, 0], [10, 0]] }));
    const b = first(api.run('LINE', { points: [[10, 0], [25, 0]] }));
    api.run('JOIN', { ids: [a, b] });
    expect(doc.entities.size).toBe(1);
    near((doc.get(a) as Extract<Entity, { type: 'LINE' }>).b, [25, 0]);
  });
});

describe('Thuộc tính, grip, đa giác, diện tích', () => {
  it('CHPROP và MATCHPROP', () => {
    const { doc, api, first } = setup();
    const a = first(api.run('LINE', { points: [[0, 0], [10, 0]] }));
    const b = first(api.run('LINE', { points: [[0, 5], [10, 5]] }));
    api.run('CHPROP', { ids: [a], layer: 'TRUC', color: '1', linetype: 'CENTER' });
    expect(doc.get(a)).toMatchObject({ layer: 'TRUC', color: 1, lt: 'CENTER' });
    api.run('MATCHPROP', { source: a, ids: [b] });
    expect(doc.get(b)).toMatchObject({ layer: 'TRUC', color: 1, lt: 'CENTER' });
    api.run('CHPROP', { ids: [b], color: 'BYLAYER', linetype: 'BYLAYER' });
    expect(doc.get(b)!.color).toBeUndefined();
    expect(doc.get(b)!.lt).toBeUndefined();
  });
  it('GRIPEDIT kéo đầu mút và bán kính', () => {
    const { doc, api, first } = setup();
    const l = first(api.run('LINE', { points: [[0, 0], [10, 0]] }));
    api.run('GRIPEDIT', { id: l, index: 2, to: [20, 5] });
    near((doc.get(l) as Extract<Entity, { type: 'LINE' }>).b, [20, 5]);
    const c = first(api.run('CIRCLE', { center: [0, 0], radius: 5 }));
    api.run('GRIPEDIT', { id: c, index: 1, to: [8, 0] });
    expect((doc.get(c) as Extract<Entity, { type: 'CIRCLE' }>).r).toBeCloseTo(8);
  });
  it('POLYGON và AREA', () => {
    const { api, first } = setup();
    const p = first(api.run('POLYGON', { center: [0, 0], sides: 4, radius: 10, inscribed: false, rotation: 0 }));
    const r = api.run('AREA', { ids: [p] });
    expect(r.area).toBeCloseTo(400);
    expect(r.perimeter).toBeCloseTo(80);
    const r2 = api.run('AREA', { points: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] });
    expect(r2.message).toMatch(/12 m²/);
  });
});

describe('Kích thước', () => {
  it('DIMLINEAR tự chọn ngang/đứng, giá trị đúng, hoàn tác được', () => {
    const { doc, api, first } = setup();
    const h = first(api.run('DIMLINEAR', { p1: [0, 0], p2: [4000, 500], location: [2000, -800] }));
    const v = first(api.run('DIMLINEAR', { p1: [0, 0], p2: [4000, 500], location: [-800, 200] }));
    expect(measure(doc.get(h) as never)).toBeCloseTo(4000);
    expect(measure(doc.get(v) as never)).toBeCloseTo(500);
    expect(api.query.describe(h)).toMatch(/"4000"/);
    api.undo();
    expect(doc.get(v)).toBeUndefined();
  });
  it('DIMALIGNED, DIMRADIUS, DIMDIAMETER, DIMANGULAR', () => {
    const { doc, api, first } = setup();
    const a = first(api.run('DIMALIGNED', { p1: [0, 0], p2: [300, 400], location: [0, 600] }));
    expect(measure(doc.get(a) as never)).toBeCloseTo(500);
    const c = first(api.run('CIRCLE', { center: [0, 0], radius: 600 }));
    const r = first(api.run('DIMRADIUS', { id: c }));
    const d = first(api.run('DIMDIAMETER', { id: c, angle: 10 }));
    expect(api.query.describe(r)).toMatch(/"R600"/);
    expect(api.query.describe(d)).toMatch(/"Ø1200"/);
    const l1 = first(api.run('LINE', { points: [[0, 0], [1000, 0]] }));
    const l2 = first(api.run('LINE', { points: [[0, 0], [0, 1000]] }));
    const g = first(api.run('DIMANGULAR', { id1: l1, id2: l2, location: [500, 500] }));
    expect(measure(doc.get(g) as never)).toBeCloseTo(90);
  });
  it('DIMCONTINUE nối tiếp trên cùng một đường kích thước', () => {
    const { doc, api, first } = setup();
    const a = first(api.run('DIMLINEAR', { p1: [0, 0], p2: [1000, 0], location: [500, -500] }));
    const r = api.run('DIMCONTINUE', { base: a, points: [[2500, 0], [3000, 0]] });
    const ds = (r.ids as number[]).map((id) => doc.get(id)!);
    expect(ds.map((d) => Math.round(measure(d as never)))).toEqual([1500, 500]);
    for (const d of ds) if (d.type === 'DIMENSION') expect(d.pts[2][1]).toBeCloseTo(-500);
  });
  it('DIMSTYLE đổi kiểu cho kích thước mới', () => {
    const { doc, api, first } = setup();
    api.run('DIMSTYLE', { scale: 0.5, dec: 1 });
    const a = first(api.run('DIMLINEAR', { p1: [0, 0], p2: [1234.56, 0], location: [0, -300] }));
    expect(api.query.describe(a)).toMatch(/"1234\.6"/);
    expect(doc.dimStyle.txt).toBe(125);
  });
  it('hình vẽ kích thước có đường dóng, mũi tên đặc và chữ', () => {
    const { doc, api, first } = setup();
    const a = first(api.run('DIMLINEAR', { p1: [0, 0], p2: [1000, 0], location: [500, -500] }));
    const parts = expand(doc.get(a)!);
    expect(parts.filter((p) => p.type === 'LINE').length).toBe(3);
    expect(parts.filter((p) => p.type === 'LWPOLYLINE' && p.fill).length).toBe(2);
    expect(parts.find((p) => p.type === 'TEXT')).toMatchObject({ text: '1000', ha: 'C' });
  });
});

describe('Block', () => {
  it('BLOCK thay đối tượng bằng INSERT; INSERT tỉ lệ/xoay; EXPLODE', () => {
    const { doc, api, first } = setup();
    const r = api.run('RECTANG', { p1: [0, 0], p2: [900, 100] });
    const c = api.run('ARC', { center: [0, 100], radius: 900, startAngle: 0, endAngle: 90 });
    const ins = first(api.run('BLOCK', { name: 'CUA-900', base: [0, 0], ids: [...(r.ids as number[]), ...(c.ids as number[])] }));
    expect(doc.entities.size).toBe(1);
    expect(api.query.blocks()).toEqual([{ name: 'CUA-900', base: [0, 0], count: 2 }]);
    const i2 = first(api.run('INSERT', { name: 'CUA-900', position: [5000, 0], rotation: 90, scale: 2 }));
    const b = bbox(doc.get(i2)!);
    expect(b.minX).toBeCloseTo(5000 - 200 - 1800 + 0, 0);
    expect(b.maxY).toBeCloseTo(1800, 0);
    api.run('EXPLODE', { ids: [ins] });
    expect(doc.all().filter((e) => e.type !== 'INSERT').length).toBe(2);
    api.undo();
    api.undo();
    api.undo();
    expect(api.query.blocks()).toEqual([]);
    expect(doc.entities.size).toBe(2);
  });
});

describe('Layer', () => {
  it('đổi tên, kiểu đường, xoá layer', () => {
    const { doc, api, first } = setup();
    api.run('LAYER', { name: 'A', linetype: 'DASHED' });
    const l = first(api.run('LINE', { points: [[0, 0], [1, 0]] }));
    expect(doc.linePattern(doc.get(l)!)).toEqual([12, -6]);
    api.run('LAYER', { name: '0' });
    api.run('LAYER', { name: 'A', newName: 'B' });
    expect(doc.get(l)!.layer).toBe('B');
    expect(doc.layers.has('A')).toBe(false);
    api.run('LAYDEL', { name: 'B' });
    expect(doc.entities.size).toBe(0);
    expect(doc.layers.has('B')).toBe(false);
    api.undo();
    expect(doc.layers.has('B')).toBe(true);
    expect(doc.entities.size).toBe(1);
  });
});

describe('HATCH', () => {
  it('bấm điểm trong vùng tạo bởi các đoạn thẳng rời, nhận đảo', () => {
    const { doc, api, first } = setup();
    api.run('LINE', { points: [[-100, 0], [1100, 0]] });
    api.run('LINE', { points: [[1000, -100], [1000, 1100]] });
    api.run('LINE', { points: [[1100, 1000], [-100, 1000]] });
    api.run('LINE', { points: [[0, 1100], [0, -100]] });
    api.run('CIRCLE', { center: [500, 500], radius: 100 });
    const h = first(api.run('HATCH', { pick: [200, 200], pattern: 'LINE45', scale: 10 }));
    const e = doc.get(h)!;
    expect(e.type).toBe('HATCH');
    if (e.type === 'HATCH') {
      expect(e.loops.length).toBe(2);
      const xs = e.loops[0].map((p) => p[0]);
      expect(Math.min(...xs)).toBeCloseTo(0);
      expect(Math.max(...xs)).toBeCloseTo(1000);
    }
    expect(api.query.describe(h)).toMatch(/diện tích 96/);
  });
  it('bấm ở ngoài mọi vùng kín → báo lỗi', () => {
    const { api } = setup();
    api.run('RECTANG', { p1: [0, 0], p2: [10, 10] });
    expect(() => api.run('HATCH', { pick: [50, 50] })).toThrow(/vùng kín/);
  });
  it('HATCH theo đối tượng kín, HATCHEDIT, xoay/dời, BOUNDARY', () => {
    const { doc, api, first } = setup();
    const r = first(api.run('RECTANG', { p1: [0, 0], p2: [100, 50] }));
    const h = first(api.run('HATCH', { ids: [r], pattern: 'SOLID' }));
    expect(doc.get(h)).toMatchObject({ solid: true });
    api.run('HATCHEDIT', { ids: [h], pattern: 'CROSS', scale: 5 });
    expect(doc.get(h)).toMatchObject({ solid: false, pattern: 'CROSS', scale: 5 });
    api.run('ROTATE', { ids: [h], base: [0, 0], angle: 90 });
    const e = doc.get(h)!;
    if (e.type === 'HATCH') expect(e.lines[0].angle).toBeCloseTo(90);
    api.run('LINE', { points: [[200, 0], [300, 0], [250, 80]], close: true });
    const b = api.run('BOUNDARY', { pick: [250, 20] });
    const pl = doc.get((b.ids as number[])[0])!;
    expect(pl).toMatchObject({ type: 'LWPOLYLINE', closed: true });
    if (pl.type === 'LWPOLYLINE') expect(pl.pts.length).toBe(3);
  });
});

describe('SETPROP, ARRAY, STRETCH, ELLIPSE', () => {
  it('SETPROP sửa hình học và thuộc tính chung', () => {
    const { doc, api, first } = setup();
    const c = first(api.run('CIRCLE', { center: [0, 0], radius: 5 }));
    api.run('SETPROP', { ids: [c], set: { r: 50, c: [10, 20], layer: 'X', color: 3 } });
    expect(doc.get(c)).toMatchObject({ r: 50, c: [10, 20], layer: 'X', color: 3 });
    api.run('SETPROP', { ids: [c], set: '{"color":"BYLAYER"}' });
    expect(doc.get(c)!.color).toBeUndefined();
    expect(() => api.run('SETPROP', { ids: [c], set: { text: 'x' } })).toThrow(/không có thuộc tính/);
    expect(() => api.run('SETPROP', { ids: [c], set: { r: -1 } })).toThrow();
    const t = first(api.run('TEXT', { position: [0, 0], text: 'A' }));
    api.run('SETPROP', { ids: [t], set: { text: 'Phòng khách', h: 300 } });
    expect(doc.get(t)).toMatchObject({ text: 'Phòng khách', h: 300 });
  });
  it('ARRAY chữ nhật và tròn', () => {
    const { doc, api, first } = setup();
    const c = first(api.run('CIRCLE', { center: [0, 0], radius: 5 }));
    expect((api.run('ARRAY', { ids: [c], rows: 2, cols: 3, dx: 100, dy: 50 }).ids as number[]).length).toBe(5);
    const l = first(api.run('LINE', { points: [[100, 0], [120, 0]] }));
    api.run('ARRAY', { ids: [l], kind: 'polar', center: [0, 0], count: 4 });
    const lines = doc.all().filter((e) => e.type === 'LINE') as Extract<Entity, { type: 'LINE' }>[];
    expect(lines.length).toBe(4);
    expect(lines.some((x) => Math.abs(x.a[1] - 100) < 1e-9 && Math.abs(x.a[0]) < 1e-9)).toBe(true);
  });
  it('STRETCH dời đầu mút trong khung, giữ phần ngoài', () => {
    const { doc, api, first } = setup();
    const r = first(api.run('RECTANG', { p1: [0, 0], p2: [100, 50] }));
    const l = first(api.run('LINE', { points: [[0, 100], [100, 100]] }));
    api.run('STRETCH', { p1: [90, -10], p2: [110, 110], from: [0, 0], to: [50, 0] });
    const e = doc.get(r)!;
    if (e.type === 'LWPOLYLINE') expect(Math.max(...e.pts.map((p) => p[0]))).toBe(150);
    expect(doc.get(l)).toMatchObject({ a: [0, 100], b: [150, 100] });
  });
  it('ELLIPSE', () => {
    const { api, first } = setup();
    const e = first(api.run('ELLIPSE', { center: [0, 0], rx: 100, ry: 50 }));
    const r = api.run('AREA', { ids: [e] });
    expect(r.area as number).toBeCloseTo(Math.PI * 5000, -2);
  });
});

describe('MLINE, PASTECLIP', () => {
  it('MLINE tạo hai nét song song và nét bịt đầu', () => {
    const { doc, api } = setup();
    const r = api.run('MLINE', { points: [[0, 0], [4000, 0], [4000, 3000]], width: 200 });
    expect((r.ids as number[]).length).toBe(4);
    const polys = doc.all().filter((e) => e.type === 'LWPOLYLINE') as Extract<Entity, { type: 'LWPOLYLINE' }>[];
    const ys = polys.map((p) => p.pts[0][1]).sort((a, b) => a - b);
    expect(ys).toEqual([-100, 100]);
    // Góc trong / ngoài của tường gặp nhau đúng (giao nhau kiểu vát).
    const outer = polys.find((p) => p.pts[0][1] === -100)!;
    expect(outer.pts[1]).toEqual([4100, -100]);
  });
  it('PASTECLIP dán dữ liệu kèm block', () => {
    const { doc, api } = setup();
    const data = { ents: [{ type: 'INSERT', name: 'B', p: [0, 0], sx: 1, sy: 1, rot: 0, layer: '0' }], blocks: [{ name: 'B', base: [0, 0], ents: [{ type: 'LINE', a: [0, 0], b: [1, 0], layer: '0' }] }] };
    api.run('PASTECLIP', { data: JSON.stringify(data), from: [0, 0], to: [10, 5] });
    expect(doc.blocks.has('B')).toBe(true);
    expect(doc.all()[0]).toMatchObject({ type: 'INSERT', p: [10, 5] });
  });
});
