import { describe, expect, it } from 'vitest';
import { Drawing } from '../src/core/document';
import type { Ctx } from '../src/core/commands';
import { createRegistry } from '../src/core/registry';
import { createApi } from '../src/core/api';
import type { Entity } from '../src/core/entities';
import { expand } from '../src/core/entities';
import { measure, dimText } from '../src/core/dim';
import { calc } from '../src/core/cmds/tools';
import { readDxf, writeDxf } from '../src/core/dxf';

function setup(withUi = false) {
  const doc = new Drawing();
  const reg = createRegistry();
  const selection = new Set<number>();
  const uiLog: [string, Record<string, unknown>][] = [];
  let clip: string | undefined;
  const ctx: Ctx = {
    doc,
    selection,
    print: () => {},
    ...(withUi
      ? {
          ui: (a: string, args: Record<string, unknown>) => {
            uiLog.push([a, args]);
            if (a === 'clip') clip = String(args.data);
            if (a === 'getclip') return { data: clip };
          },
        }
      : {}),
  };
  const api = createApi({ doc, reg, ctx: () => ctx, version: 't', setSelection: () => {} });
  const first = (r: Record<string, unknown>) => (r.ids as number[])[0];
  const get = <T extends Entity['type']>(id: number) => doc.get(id) as Extract<Entity, { type: T }>;
  return { doc, api, first, selection, get, uiLog, reg };
}

describe('Layer', () => {
  it('LAYOFF / LAYON / LAYISO / LAYUNISO / LAYMCUR', () => {
    const { doc, api, first } = setup();
    api.run('LAYER', { name: 'A' });
    const a = first(api.run('LINE', { points: [[0, 0], [1, 0]] }));
    api.run('LAYER', { name: 'B' });
    const b = first(api.run('LINE', { points: [[0, 1], [1, 1]] }));
    api.run('LAYER', { name: '0' });
    api.run('LAYOFF', { ids: [a] });
    expect(doc.layers.get('A')!.visible).toBe(false);
    api.run('LAYON');
    expect(doc.layers.get('A')!.visible).toBe(true);
    api.run('LAYISO', { ids: [b] });
    expect(doc.layers.get('A')!.visible).toBe(false);
    expect(doc.layers.get('B')!.visible).toBe(true);
    expect(doc.currentLayer).toBe('B');
    api.run('LAYUNISO');
    expect(doc.layers.get('A')!.visible).toBe(true);
    api.run('LAYMCUR', { ids: [a] });
    expect(doc.currentLayer).toBe('A');
  });

  it('LAYMRG gộp layer, COPYTOLAYER, LAYMCH', () => {
    const { doc, api, first } = setup();
    const a = first(api.run('LINE', { points: [[0, 0], [1, 0]], layer: 'X' }));
    const b = first(api.run('CIRCLE', { center: [0, 0], radius: 1, layer: 'Y' }));
    api.run('LAYMRG', { from: ['X'], to: 'Y' });
    expect(doc.layers.has('X')).toBe(false);
    expect(doc.get(a)!.layer).toBe('Y');
    const r = api.run('COPYTOLAYER', { ids: [b], layer: 'Z' });
    expect(doc.get((r.ids as number[])[0])!.layer).toBe('Z');
    api.run('LAYMCH', { ids: [a], target: (r.ids as number[])[0] });
    expect(doc.get(a)!.layer).toBe('Z');
  });
});

describe('Chọn đối tượng', () => {
  it('QSELECT theo loại + layer, SELECTSIMILAR, ẩn / cô lập', () => {
    const { doc, api, selection } = setup();
    api.run('LINE', { points: [[0, 0], [1, 0]], layer: 'TUONG' });
    api.run('LINE', { points: [[0, 1], [1, 1]], layer: 'CUA' });
    const c = (api.run('CIRCLE', { center: [0, 0], radius: 1, layer: 'TUONG' }).ids as number[])[0];
    api.run('QSELECT', { type: 'LINE', layer: 'TU*' });
    expect(selection.size).toBe(1);
    api.run('SELECTSIMILAR', { ids: [c] });
    expect([...selection]).toEqual([c]);
    api.run('ISOLATEOBJECTS', { ids: [c] });
    expect(doc.visible().map((e) => e.id)).toEqual([c]);
    api.run('UNISOLATEOBJECTS');
    expect(doc.visible()).toHaveLength(3);
    api.run('HIDEOBJECTS', { ids: [c] });
    expect(doc.visible()).toHaveLength(2);
    // Ẩn tạm không ghi vào tệp.
    expect(doc.toData().vars?._HIDDEN).toBeUndefined();
    api.undo();
    expect(doc.visible()).toHaveLength(3);
  });
});

describe('Chữ', () => {
  it('TCOUNT theo thứ tự đọc, TCASE, SCALETEXT', () => {
    const { api, get } = setup();
    const lo = (api.run('TEXT', { position: [0, 0], text: 'dưới' }).ids as number[])[0];
    const hi = (api.run('TEXT', { position: [0, 1000], text: 'trên' }).ids as number[])[0];
    api.run('TCOUNT', { ids: [lo, hi] });
    expect(get<'TEXT'>(hi).text).toBe('1. trên');
    expect(get<'TEXT'>(lo).text).toBe('2. dưới');
    api.run('TCASE', { ids: [hi], mode: 'upper' });
    expect(get<'TEXT'>(hi).text).toBe('1. TRÊN');
    api.run('TCASE', { ids: [hi], mode: 'title' });
    expect(get<'TEXT'>(hi).text).toBe('1. Trên');
    api.run('SCALETEXT', { ids: [lo, hi], factor: 2 });
    expect(get<'TEXT'>(lo).h).toBe(500);
  });

  it('JUSTIFYTEXT giữ nguyên vị trí chữ; TORIENT lật chữ ngược; TXT2MTXT gộp dòng', () => {
    const { doc, api, get, first } = setup();
    const t = first(api.run('TEXT', { position: [100, 100], text: 'ABCD', height: 10 }));
    api.run('JUSTIFYTEXT', { ids: [t], justify: 'MC' });
    const e = get<'TEXT'>(t);
    expect(e.ha).toBe('C');
    expect(e.p[0]).toBeCloseTo(100 + 4 * 6 / 2, 6);
    expect(e.p[1]).toBeCloseTo(105, 6);
    const r = first(api.run('TEXT', { position: [0, 0], text: 'X', rotation: 180 }));
    api.run('TORIENT', { ids: [r] });
    expect(get<'TEXT'>(r).rot).toBe(0);
    const a = first(api.run('TEXT', { position: [0, 500], text: 'Dòng 1' }));
    const b = first(api.run('TEXT', { position: [0, 0], text: 'Dòng 2' }));
    const m = first(api.run('TXT2MTXT', { ids: [b, a] }));
    expect(doc.get(a)).toBeUndefined();
    expect(get<'TEXT'>(m).text).toBe('Dòng 1\nDòng 2');
  });

  it('TEXTMASK tạo vùng che dưới chữ, chữ vẽ sau vùng che; TEXTUNMASK bỏ đi', () => {
    const { doc, api, first } = setup();
    first(api.run('HATCH', { points: [[-100, -100], [1000, -100], [1000, 500], [-100, 500]], pattern: 'SOLID' }));
    const t = first(api.run('TEXT', { position: [0, 0], text: 'Phòng' }));
    const w = first(api.run('TEXTMASK', { ids: [t] }));
    const order = doc.all().map((e) => e.id);
    expect(order.indexOf(w)).toBeLessThan(order.indexOf(t));
    expect((doc.get(w) as { wipe?: boolean }).wipe).toBe(true);
    api.run('TEXTUNMASK', { ids: [t] });
    expect(doc.get(w)).toBeUndefined();
  });

  it('DRAWORDER đưa xuống dưới, hoàn tác trả lại thứ tự', () => {
    const { doc, api, first } = setup();
    const a = first(api.run('POINT', { position: [0, 0] }));
    const b = first(api.run('POINT', { position: [1, 0] }));
    api.run('DRAWORDER', { ids: [b], where: 'back' });
    expect(doc.all().map((e) => e.id)).toEqual([b, a]);
    api.undo();
    expect(doc.all().map((e) => e.id)).toEqual([a, b]);
  });
});

describe('Sửa đổi bổ sung', () => {
  it('LENGTHEN đoạn thẳng và cung', () => {
    const { api, get, first } = setup();
    const l = first(api.run('LINE', { points: [[0, 0], [100, 0]] }));
    api.run('LENGTHEN', { id: l, pick: [95, 0], delta: 50 });
    expect(get<'LINE'>(l).b).toEqual([150, 0]);
    api.run('LENGTHEN', { id: l, pick: [1, 0], total: 100 });
    expect(get<'LINE'>(l).a[0]).toBeCloseTo(50, 9);
    const a = first(api.run('ARC', { center: [0, 0], radius: 100, startAngle: 0, endAngle: 90 }));
    api.run('LENGTHEN', { id: a, percent: 200 });
    expect(get<'ARC'>(a).end).toBeCloseTo(180, 9);
  });

  it('DIVIDE / MEASURE đặt điểm', () => {
    const { doc, api, first } = setup();
    const l = first(api.run('LINE', { points: [[0, 0], [100, 0]] }));
    api.run('DIVIDE', { id: l, count: 4 });
    const pts = doc.all().filter((e) => e.type === 'POINT').map((e) => (e as { p: readonly number[] }).p[0]);
    expect(pts).toEqual([25, 50, 75]);
    const c = first(api.run('CIRCLE', { center: [0, 0], radius: 10 }));
    const r = api.run('DIVIDE', { id: c, count: 6 });
    expect((r.ids as number[]).length).toBe(6);
    const m = api.run('MEASURE', { id: l, length: 30 });
    expect((m.ids as number[]).length).toBe(3);
  });

  it('OVERKILL xoá trùng (kể cả ngược chiều) và đoạn dài 0; OOPS lấy lại đối tượng vừa xoá', () => {
    const { doc, api, first } = setup();
    api.run('LINE', { points: [[0, 0], [10, 0]] });
    api.run('LINE', { points: [[10, 0], [0, 0]] });
    api.run('LINE', { points: [[5, 5], [5, 5]] });
    api.run('CIRCLE', { center: [0, 0], radius: 3 });
    api.run('CIRCLE', { center: [0, 0], radius: 3 });
    api.run('OVERKILL');
    expect(doc.entities.size).toBe(2);
    const id = first(api.run('POINT', { position: [9, 9] }));
    api.run('ERASE', { ids: [id] });
    api.run('OOPS');
    expect(doc.all().some((e) => e.type === 'POINT')).toBe(true);
  });

  it('ALIGN dời + xoay + co giãn', () => {
    const { api, get, first } = setup();
    const l = first(api.run('LINE', { points: [[0, 0], [10, 0]] }));
    api.run('ALIGN', { ids: [l], source1: [0, 0], dest1: [100, 100], source2: [10, 0], dest2: [100, 120], scale: true });
    const e = get<'LINE'>(l);
    expect(e.a[0]).toBeCloseTo(100, 9);
    expect(e.b[0]).toBeCloseTo(100, 9);
    expect(e.b[1]).toBeCloseTo(120, 9);
  });

  it('BREAKATPOINT, REVERSE, SETBYLAYER, PEDIT', () => {
    const { doc, api, get, first } = setup();
    const l = first(api.run('LINE', { points: [[0, 0], [10, 0]], color: 1 }));
    const r = api.run('BREAKATPOINT', { id: l, point: [4, 0] });
    expect((r.ids as number[]).length).toBe(2);
    const [x] = r.ids as number[];
    api.run('REVERSE', { ids: [x] });
    expect(get<'LINE'>(x).a).toEqual([4, 0]);
    api.run('SETBYLAYER', { ids: [x] });
    expect(get<'LINE'>(x).color).toBeUndefined();
    // PEDIT join: ghép hai đoạn chạm nhau thành một đa tuyến.
    const ids2 = r.ids as number[];
    api.run('PEDIT', { id: ids2[0], op: 'join', ids: [ids2[1]] });
    const p = get<'LWPOLYLINE'>(ids2[0]);
    expect(p.type).toBe('LWPOLYLINE');
    expect(p.pts).toHaveLength(3);
    expect(doc.get(ids2[1])).toBeUndefined();
    api.run('PEDIT', { id: ids2[0], op: 'decurve' });
    expect(get<'LWPOLYLINE'>(ids2[0]).pts).toHaveLength(2);
    api.run('PEDIT', { id: ids2[0], op: 'close' });
    expect(get<'LWPOLYLINE'>(ids2[0]).closed).toBe(true);
  });

  it('ARRAYPATH chép dọc đường dẫn', () => {
    const { doc, api, first } = setup();
    const path = first(api.run('LINE', { points: [[0, 0], [100, 0]] }));
    const c = first(api.run('CIRCLE', { center: [0, 0], radius: 2 }));
    api.run('ARRAYPATH', { ids: [c], path, count: 5, base: [0, 0] });
    const cs = doc.all().filter((e) => e.type === 'CIRCLE').map((e) => (e as { c: readonly number[] }).c[0]).sort((a, b) => a - b);
    expect(cs).toEqual([0, 0, 25, 50, 75, 100]);
  });
});

describe('Tra cứu & quản lý', () => {
  it('CAL tính biểu thức', () => {
    expect(calc('sqrt(3^2+4^2)*2')).toBe(10);
    expect(calc('sin(30)')).toBeCloseTo(0.5, 12);
    expect(calc('max(1,5,3)')).toBe(5);
    expect(calc('-2^2')).toBe(-4);
    expect(() => calc('2+')).toThrow();
  });

  it('MASSPROP hình chữ nhật', () => {
    const { api, first } = setup();
    const r = first(api.run('RECTANG', { p1: [0, 0], p2: [4, 2] }));
    const m = api.run('MASSPROP', { ids: [r] }).results as { area: number; perimeter: number; centroid: number[]; ix: number }[];
    expect(m[0].area).toBeCloseTo(8, 9);
    expect(m[0].perimeter).toBeCloseTo(12, 9);
    expect(m[0].centroid[0]).toBeCloseTo(2, 9);
    expect(m[0].ix).toBeCloseTo((4 * 2 ** 3) / 12, 9);
  });

  it('PURGE xoá block & layer không dùng; RENAME block; BLOCKREPLACE; BCOUNT', () => {
    const { doc, api, first } = setup();
    const c = first(api.run('CIRCLE', { center: [0, 0], radius: 1, layer: 'L1' }));
    api.run('BLOCK', { name: 'A', base: [0, 0], ids: [c] });
    api.run('INSERT', { name: 'A', position: [10, 0] });
    api.run('LINE', { points: [[0, 0], [1, 1]], layer: 'TAM' });
    api.run('ERASE', { ids: [doc.all().find((e) => e.layer === 'TAM')!.id] });
    const c2 = first(api.run('CIRCLE', { center: [0, 0], radius: 2 }));
    api.run('BLOCK', { name: 'B', base: [0, 0], ids: [c2] });
    api.run('RENAME', { kind: 'block', from: 'A', to: 'A2' });
    expect(doc.all().find((e) => e.type === 'INSERT')).toMatchObject({ name: 'A2' });
    expect(api.run('BCOUNT').counts).toEqual({ A2: 2, B: 1 });
    api.run('BLOCKREPLACE', { from: 'A2', to: 'B' });
    api.run('PURGE');
    expect([...doc.blocks.keys()]).toEqual(['B']);
    expect(doc.layers.has('TAM')).toBe(false);
  });

  it('COLOR / CELTYPE áp cho đối tượng mới; UNITS hoàn tác được; SETVAR', () => {
    const { doc, api, first, get } = setup();
    api.run('COLOR', { color: '1' });
    api.run('CELTYPE', { linetype: 'DASHED' });
    const l = first(api.run('LINE', { points: [[0, 0], [1, 0]] }));
    expect(get<'LINE'>(l)).toMatchObject({ color: 1, lt: 'DASHED' });
    api.run('COLOR', { color: 'BYLAYER' });
    expect(get<'LINE'>(first(api.run('LINE', { points: [[0, 0], [1, 0]] }))).color).toBeUndefined();
    api.run('UNITS', { units: 'm' });
    expect(doc.units).toBe('m');
    api.undo();
    expect(doc.units).toBe('mm');
    api.run('SETVAR', { name: 'LTSCALE', value: '10' });
    expect(doc.ltscale).toBe(10);
    expect(api.run('SETVAR', { name: 'LTSCALE' }).value).toBe(10);
  });
});

describe('Kích thước & ghi chú', () => {
  it('DIMBASELINE xếp cách đều ra ngoài, chung đường dóng thứ nhất', () => {
    const { doc, api } = setup();
    api.run('DIMLINEAR', { p1: [0, 0], p2: [100, 0], location: [50, -50] });
    api.run('DIMBASELINE', { points: [[200, 0], [300, 0]] });
    const dims = doc.all().filter((e) => e.type === 'DIMENSION') as Extract<Entity, { type: 'DIMENSION' }>[];
    expect(dims.map((d) => measure(d))).toEqual([100, 200, 300]);
    expect(dims.every((d) => d.pts[0][0] === 0)).toBe(true);
    expect(dims[1].pts[2][1]).toBeLessThan(dims[0].pts[2][1]);
    expect(dims[2].pts[2][1]).toBeLessThan(dims[1].pts[2][1]);
  });

  it('DIMORDINATE ghi X / Y, DIMARC ghi chiều dài cung; ghi / đọc DXF', () => {
    const { doc, api, first } = setup();
    const o = first(api.run('DIMORDINATE', { point: [1500, 800], leader: [1500, 2000] }));
    const oy = first(api.run('DIMORDINATE', { point: [1500, 800], leader: [3000, 800] }));
    const d = doc.get(o) as Extract<Entity, { type: 'DIMENSION' }>;
    expect(dimText(d)).toBe('1500');
    expect(dimText(doc.get(oy) as typeof d)).toBe('800');
    const a = first(api.run('ARC', { center: [0, 0], radius: 100, startAngle: 0, endAngle: 90 }));
    const da = first(api.run('DIMARC', { id: a, location: [200, 200] }));
    expect(measure(doc.get(da) as typeof d)).toBeCloseTo(50 * Math.PI, 9);
    expect(dimText(doc.get(da) as typeof d).startsWith('⌒')).toBe(true);
    expect(expand(doc.get(da)!).length).toBeGreaterThan(3);
    // Ghi DXF: kích thước toạ độ là DIMENSION loại 6 (+64 khi đo X); chiều dài cung ghi thành block.
    const out = writeDxf(doc.toData());
    const types = [...out.matchAll(/\n\s*0\r?\nDIMENSION\r?\n[\s\S]*?\n\s*70\r?\n\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(types.sort((a, b) => a - b)).toEqual([6, 70]);
    expect(readDxf(out).data.entities.length).toBeGreaterThanOrEqual(3);
  });

  it('QDIM chuỗi kích thước qua các đầu mút', () => {
    const { doc, api } = setup();
    const ids = [
      (api.run('LINE', { points: [[0, 0], [0, 100]] }).ids as number[])[0],
      (api.run('LINE', { points: [[300, 0], [300, 100]] }).ids as number[])[0],
      (api.run('LINE', { points: [[1000, 0], [1000, 100]] }).ids as number[])[0],
    ];
    api.run('QDIM', { ids, location: [0, 300] });
    const dims = doc.all().filter((e) => e.type === 'DIMENSION') as Extract<Entity, { type: 'DIMENSION' }>[];
    expect(dims.map((d) => Math.round(measure(d)))).toEqual([300, 700]);
  });

  it('MLEADER có mũi tên, đường dẫn, chữ; TABLE từ dữ liệu dán Excel', () => {
    const { doc, api } = setup();
    api.run('MLEADER', { points: [[0, 0], [500, 500]], text: 'Cửa đi D1' });
    expect(doc.all().map((e) => e.type).sort()).toEqual(['LWPOLYLINE', 'LWPOLYLINE', 'TEXT']);
    doc.reset();
    api.run('TABLE', { position: [0, 0], data: 'Phòng\tDiện tích\nKhách\t20,5\nNgủ\t12' });
    const texts = doc.all().filter((e) => e.type === 'TEXT') as Extract<Entity, { type: 'TEXT' }>[];
    expect(texts.map((t) => t.text)).toEqual(['Phòng', 'Khách', 'Ngủ', 'Diện tích', '20,5', '12']);
    expect(texts.find((t) => t.text === '12')!.ha).toBe('R');
  });

  it('CENTERMARK, CENTERLINE, BREAKLINE, GOPY, WIPEOUT', () => {
    const { doc, api, first } = setup();
    const c = first(api.run('CIRCLE', { center: [0, 0], radius: 100 }));
    expect((api.run('CENTERMARK', { ids: [c] }).ids as number[]).length).toBe(6);
    const a = first(api.run('LINE', { points: [[0, 0], [100, 0]] }));
    const b = first(api.run('LINE', { points: [[100, 50], [0, 50]] }));
    const cl = doc.get(first(api.run('CENTERLINE', { id1: a, id2: b }))) as Extract<Entity, { type: 'LINE' }>;
    expect(cl.a[1]).toBeCloseTo(25, 9);
    expect(cl.lt).toBe('CENTER');
    expect(doc.get(first(api.run('BREAKLINE', { p1: [0, 0], p2: [100, 0] })))!.type).toBe('LWPOLYLINE');
    api.run('GOPY', { corners: [[0, 0], [600, 400]], text: 'Sửa lại cửa' });
    expect(doc.layers.get('GOP-Y')?.color).toBe(1);
    const w = first(api.run('WIPEOUT', { points: [[0, 0], [10, 0], [10, 10]] }));
    expect((doc.get(w) as { wipe?: boolean }).wipe).toBe(true);
  });

  it('đọc WIPEOUT từ DXF', () => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'WIPEOUT', '8', '0', '10', '100', '20', '200', '11', '50', '21', '0', '12', '0', '22', '30', '91', '2', '14', '-0.5', '24', '-0.5', '14', '0.5', '24', '0.5', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const e = readDxf(dxf).data.entities[0];
    expect(e.type === 'LWPOLYLINE' && e.wipe).toBe(true);
    if (e.type !== 'LWPOLYLINE') throw new Error();
    const xs = e.pts.map((p) => p[0]).sort((a, b) => a - b);
    const ys = e.pts.map((p) => p[1]).sort((a, b) => a - b);
    expect([xs[0], xs[3], ys[0], ys[3]]).toEqual([100, 150, 200, 230]);
  });
});

describe('Lệnh giao diện', () => {
  it('ngoài giao diện báo lỗi rõ ràng', () => {
    const { api } = setup();
    expect(() => api.run('QSAVE')).toThrow(/giao diện/);
  });

  it('COPYCLIP / CUTCLIP / PASTEORIG / PASTEBLOCK qua bộ nhớ tạm', () => {
    const { doc, api, first, uiLog } = setup(true);
    const c = first(api.run('CIRCLE', { center: [10, 10], radius: 5 }));
    api.run('CUTCLIP', { ids: [c] });
    expect(doc.entities.size).toBe(0);
    expect(uiLog[0][0]).toBe('clip');
    api.run('PASTEORIG');
    expect(doc.all()[0]).toMatchObject({ type: 'CIRCLE', c: [10, 10] });
    api.run('PASTEBLOCK', { to: [100, 100] });
    const ins = doc.all().find((e) => e.type === 'INSERT')!;
    expect(ins).toMatchObject({ name: 'A$C1' });
  });

  it('WBLOCK ghi DXF chỉ gồm đối tượng chọn', () => {
    const { api, first, uiLog } = setup(true);
    const a = first(api.run('LINE', { points: [[0, 0], [1, 0]], layer: 'A' }));
    api.run('CIRCLE', { center: [0, 0], radius: 1, layer: 'B' });
    api.run('WBLOCK', { ids: [a], name: 'mot-doan' });
    const [act, args] = uiLog.find(([x]) => x === 'download')!;
    expect(act).toBe('download');
    const d = readDxf(String(args.content)).data;
    expect(d.entities).toHaveLength(1);
    expect(d.layers.map((l) => l.name).sort()).toEqual(['0', 'A']);
  });

  it('lệnh chưa có hỏi đáp riêng vẫn chạy được tương tác (hỏi tham số bắt buộc)', async () => {
    const { doc, reg } = setup();
    const { runInteractive } = await import('../src/core/commands');
    const answers: unknown[] = ['1+2*3'];
    const printed: string[] = [];
    const io = {
      getPoint: async () => null,
      getDistance: async () => null,
      getAngle: async () => null,
      getString: async () => answers.shift() as string,
      getEntity: async () => null,
      getSelection: async () => [],
      print: (m: string) => printed.push(m),
    };
    await runInteractive(reg, { doc, selection: new Set(), print: () => {} }, io, 'CAL');
    expect(printed).toEqual(['= 7']);
  });
});
