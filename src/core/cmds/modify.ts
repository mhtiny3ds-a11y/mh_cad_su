// Lệnh sửa hình học: TRIM, EXTEND, FILLET, CHAMFER, BREAK, JOIN, GRIPEDIT, CHPROP, MATCHPROP.

import { type Vec, EPS, add, angleOf, cross, dist, dot, len, mul, rad2deg, sub } from '../geom';
import { type Entity, type NewEntity, applyGrip, normDeg } from '../entities';
import { type CurveEnt, curveLength, extendCurve, isClosed, isCurve, paramOf, subCurve, trimCurve } from '../curve';
import {
  type Args,
  type CommandDef,
  type Ctx,
  ids,
  num,
  optStr,
  pickSelection,
  pt,
} from '../commands';

const getEnt = (ctx: Ctx, args: Args, k: string): Entity => {
  const id = Number(args[k]);
  const e = ctx.doc.get(id);
  if (!e) throw new Error(`Không có đối tượng #${args[k]}`);
  if (!ctx.doc.isEditable(e)) throw new Error(`Đối tượng #${id} nằm trên layer đang khoá hoặc tắt`);
  return e;
};

const asCurve = (e: Entity, cmd: string): CurveEnt => {
  if (!isCurve(e)) throw new Error(`${cmd} chỉ áp dụng cho LINE, ARC, CIRCLE, đa tuyến (không áp dụng cho ${e.type})`);
  return e;
};

/** Danh sách cạnh cắt/biên: tham số "edges" hoặc mọi đối tượng đang hiện. */
const edgesOf = (ctx: Ctx, args: Args): Entity[] =>
  Array.isArray(args.edges) && args.edges.length
    ? (args.edges as unknown[]).map((x) => ctx.doc.get(Number(x))).filter((e): e is Entity => !!e)
    : ctx.doc.visible();

// ---------- TRIM / EXTEND ----------

const TRIM: CommandDef = {
  name: 'TRIM',
  aliases: ['TR'],
  desc: 'Cắt bỏ phần đối tượng nằm giữa các giao điểm (mặc định mọi đối tượng đều là cạnh cắt)',
  params: [
    { name: 'id', type: 'number', required: true, desc: 'Đối tượng cần cắt' },
    { name: 'pick', type: 'point', required: true, desc: 'Một điểm nằm trên phần cần bỏ' },
    { name: 'edges', type: 'ids', desc: 'Chỉ dùng các đối tượng này làm cạnh cắt (mặc định: tất cả)' },
  ],
  run(ctx, args) {
    const e = asCurve(getEnt(ctx, args, 'id'), 'TRIM');
    const r = trimCurve(e, pt(args, 'pick'), edgesOf(ctx, args));
    if (!r) throw new Error('Đối tượng không cắt qua cạnh nào ở phía đã chọn');
    if (!r.replace) {
      ctx.doc.remove(e.id);
      return { ids: [], message: 'Đã xoá đối tượng' };
    }
    ctx.doc.update({ ...r.replace, id: e.id } as Entity);
    const out = [e.id];
    if (r.extra) out.push(ctx.doc.add(r.extra).id);
    return { ids: out };
  },
  async interactive(ctx, io) {
    const edges = [...ctx.selection];
    ctx.selection.clear();
    if (edges.length) io.print(`Dùng ${edges.length} đối tượng đã chọn làm cạnh cắt`);
    for (;;) {
      const hit = await io.getEntity('Bấm vào phần cần cắt bỏ (Enter để kết thúc)');
      if (!hit || typeof hit === 'string') return;
      try {
        TRIM.run(ctx, { id: hit.id, pick: hit.p, ...(edges.length ? { edges } : {}) });
      } catch (err) {
        io.print((err as Error).message);
      }
    }
  },
};

const EXTEND: CommandDef = {
  name: 'EXTEND',
  aliases: ['EX'],
  desc: 'Kéo dài LINE, ARC hoặc đa tuyến hở tới đối tượng biên gần nhất',
  params: [
    { name: 'id', type: 'number', required: true, desc: 'Đối tượng cần kéo dài' },
    { name: 'pick', type: 'point', required: true, desc: 'Điểm gần đầu mút cần kéo dài' },
    { name: 'edges', type: 'ids', desc: 'Chỉ dùng các đối tượng này làm biên (mặc định: tất cả)' },
  ],
  run(ctx, args) {
    const e = asCurve(getEnt(ctx, args, 'id'), 'EXTEND');
    const n = extendCurve(e, pt(args, 'pick'), edgesOf(ctx, args));
    if (!n) throw new Error('Không tìm thấy biên để kéo dài tới');
    ctx.doc.update({ ...n, id: e.id } as Entity);
    return { ids: [e.id] };
  },
  async interactive(ctx, io) {
    const edges = [...ctx.selection];
    ctx.selection.clear();
    for (;;) {
      const hit = await io.getEntity('Bấm gần đầu mút cần kéo dài (Enter để kết thúc)');
      if (!hit || typeof hit === 'string') return;
      try {
        EXTEND.run(ctx, { id: hit.id, pick: hit.p, ...(edges.length ? { edges } : {}) });
      } catch (err) {
        io.print((err as Error).message);
      }
    }
  },
};

// ---------- FILLET / CHAMFER ----------

interface Corner {
  P: Vec;
  /** Hướng đơn vị từ P về phía giữ lại của mỗi đường. */
  u1: Vec;
  u2: Vec;
  /** Đầu mút giữ lại của mỗi đường. */
  keep1: Vec;
  keep2: Vec;
}

function lineCorner(l1: Extract<Entity, { type: 'LINE' }>, l2: Extract<Entity, { type: 'LINE' }>, pick1: Vec, pick2: Vec): Corner {
  const d1 = sub(l1.b, l1.a);
  const d2 = sub(l2.b, l2.a);
  const den = cross(d1, d2);
  if (Math.abs(den) < EPS * Math.max(1, len(d1) * len(d2))) throw new Error('Hai đường thẳng song song');
  const t = cross(sub(l2.a, l1.a), d2) / den;
  const P = add(l1.a, mul(d1, t));
  const side = (l: typeof l1, pick: Vec): { keep: Vec; u: Vec } => {
    const dir = sub(l.b, l.a);
    const s = Math.sign(dot(sub(pick, P), dir)) || 1;
    const keep = s > 0 ? (dot(sub(l.b, P), dir) >= dot(sub(l.a, P), dir) ? l.b : l.a) : dot(sub(l.a, P), dir) <= dot(sub(l.b, P), dir) ? l.a : l.b;
    const u = mul(dir, s / len(dir));
    return { keep, u };
  };
  const a = side(l1, pick1);
  const b = side(l2, pick2);
  return { P, u1: a.u, u2: b.u, keep1: a.keep, keep2: b.keep };
}

const lineOnly = (e: Entity, cmd: string) => {
  if (e.type !== 'LINE') throw new Error(`${cmd} hiện chỉ áp dụng cho hai LINE (hãy EXPLODE đa tuyến trước)`);
  return e;
};

const FILLET: CommandDef = {
  name: 'FILLET',
  aliases: ['F'],
  desc: 'Bo tròn góc giữa hai đường thẳng (bán kính 0 = nối thành góc nhọn)',
  params: [
    { name: 'id1', type: 'number', required: true, desc: 'Đường thẳng thứ nhất' },
    { name: 'id2', type: 'number', required: true, desc: 'Đường thẳng thứ hai' },
    { name: 'radius', type: 'number', desc: 'Bán kính (mặc định 0)' },
    { name: 'pick1', type: 'point', desc: 'Điểm trên phần giữ lại của đường 1 (mặc định: trung điểm)' },
    { name: 'pick2', type: 'point', desc: 'Điểm trên phần giữ lại của đường 2' },
  ],
  run(ctx, args) {
    const l1 = lineOnly(getEnt(ctx, args, 'id1'), 'FILLET');
    const l2 = lineOnly(getEnt(ctx, args, 'id2'), 'FILLET');
    if (l1.id === l2.id) throw new Error('Cần hai đường khác nhau');
    const r = num(args, 'radius', 0);
    if (r < 0) throw new Error('Bán kính phải ≥ 0');
    const mid = (l: typeof l1): Vec => [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2];
    const c = lineCorner(l1, l2, args.pick1 ? pt(args, 'pick1') : mid(l1), args.pick2 ? pt(args, 'pick2') : mid(l2));
    if (r === 0) {
      ctx.doc.update({ ...l1, a: c.keep1, b: c.P });
      ctx.doc.update({ ...l2, a: c.keep2, b: c.P });
      return { ids: [l1.id, l2.id] };
    }
    const theta = Math.acos(Math.max(-1, Math.min(1, dot(c.u1, c.u2))));
    if (theta < 1e-6 || Math.PI - theta < 1e-6) throw new Error('Góc quá nhỏ để bo');
    const t = r / Math.tan(theta / 2);
    if (t > dist(c.P, c.keep1) + 1e-9 || t > dist(c.P, c.keep2) + 1e-9) throw new Error('Bán kính quá lớn so với đoạn thẳng');
    const T1 = add(c.P, mul(c.u1, t));
    const T2 = add(c.P, mul(c.u2, t));
    const bis = add(c.u1, c.u2);
    const C = add(c.P, mul(bis, r / Math.sin(theta / 2) / len(bis)));
    let a1 = rad2deg(angleOf(sub(T1, C)));
    let a2 = rad2deg(angleOf(sub(T2, C)));
    if (normDeg(a2 - a1) > 180) [a1, a2] = [a2, a1];
    ctx.doc.update({ ...l1, a: c.keep1, b: T1 });
    ctx.doc.update({ ...l2, a: c.keep2, b: T2 });
    const arc = ctx.doc.add({ type: 'ARC', c: C, r, start: normDeg(a1), end: normDeg(a2), layer: l1.layer, ...(l1.color !== undefined ? { color: l1.color } : {}) });
    return { ids: [l1.id, l2.id, arc.id] };
  },
  async interactive(ctx, io) {
    for (;;) {
      const h1 = await io.getEntity(`Chọn đường thứ nhất [Radius] (R hiện tại = ${filletR})`, { keywords: ['Radius'] });
      if (!h1) return;
      if (typeof h1 === 'string') {
        const r = await io.getDistance('Bán kính bo', { def: filletR });
        if (r !== null && r >= 0) filletR = r;
        continue;
      }
      const h2 = await io.getEntity('Chọn đường thứ hai');
      if (!h2 || typeof h2 === 'string') return;
      try {
        FILLET.run(ctx, { id1: h1.id, id2: h2.id, radius: filletR, pick1: h1.p, pick2: h2.p });
      } catch (err) {
        io.print((err as Error).message);
      }
      return;
    }
  },
};
let filletR = 0;

const CHAMFER: CommandDef = {
  name: 'CHAMFER',
  aliases: ['CHA'],
  desc: 'Vát góc giữa hai đường thẳng',
  params: [
    { name: 'id1', type: 'number', required: true, desc: 'Đường thẳng thứ nhất' },
    { name: 'id2', type: 'number', required: true, desc: 'Đường thẳng thứ hai' },
    { name: 'd1', type: 'number', required: true, desc: 'Khoảng vát trên đường 1' },
    { name: 'd2', type: 'number', desc: 'Khoảng vát trên đường 2 (mặc định = d1)' },
    { name: 'pick1', type: 'point', desc: 'Điểm trên phần giữ lại của đường 1' },
    { name: 'pick2', type: 'point', desc: 'Điểm trên phần giữ lại của đường 2' },
  ],
  run(ctx, args) {
    const l1 = lineOnly(getEnt(ctx, args, 'id1'), 'CHAMFER');
    const l2 = lineOnly(getEnt(ctx, args, 'id2'), 'CHAMFER');
    const d1 = num(args, 'd1');
    const d2 = num(args, 'd2', d1);
    if (d1 < 0 || d2 < 0) throw new Error('Khoảng vát phải ≥ 0');
    const mid = (l: typeof l1): Vec => [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2];
    const c = lineCorner(l1, l2, args.pick1 ? pt(args, 'pick1') : mid(l1), args.pick2 ? pt(args, 'pick2') : mid(l2));
    if (d1 > dist(c.P, c.keep1) + 1e-9 || d2 > dist(c.P, c.keep2) + 1e-9) throw new Error('Khoảng vát lớn hơn đoạn thẳng');
    const T1 = add(c.P, mul(c.u1, d1));
    const T2 = add(c.P, mul(c.u2, d2));
    ctx.doc.update({ ...l1, a: c.keep1, b: T1 });
    ctx.doc.update({ ...l2, a: c.keep2, b: T2 });
    const out = [l1.id, l2.id];
    if (dist(T1, T2) > 1e-9) out.push(ctx.doc.add({ type: 'LINE', a: T1, b: T2, layer: l1.layer, ...(l1.color !== undefined ? { color: l1.color } : {}) }).id);
    return { ids: out };
  },
  async interactive(ctx, io) {
    const h1 = await io.getEntity(`Chọn đường thứ nhất [Distance] (vát ${chamD1} × ${chamD2})`, { keywords: ['Distance'] });
    if (!h1) return;
    if (typeof h1 === 'string') {
      const a = await io.getDistance('Khoảng vát thứ nhất', { def: chamD1 });
      if (a === null) return;
      const b = await io.getDistance('Khoảng vát thứ hai', { def: a });
      if (b === null) return;
      chamD1 = a;
      chamD2 = b;
      return CHAMFER.interactive!(ctx, io);
    }
    const h2 = await io.getEntity('Chọn đường thứ hai');
    if (!h2 || typeof h2 === 'string') return;
    CHAMFER.run(ctx, { id1: h1.id, id2: h2.id, d1: chamD1, d2: chamD2, pick1: h1.p, pick2: h2.p });
  },
};
let chamD1 = 100;
let chamD2 = 100;

// ---------- BREAK / JOIN ----------

const BREAK: CommandDef = {
  name: 'BREAK',
  aliases: ['BR'],
  desc: 'Bẻ gãy đối tượng giữa hai điểm (hai điểm trùng nhau = tách làm hai tại điểm đó)',
  params: [
    { name: 'id', type: 'number', required: true, desc: 'Đối tượng' },
    { name: 'p1', type: 'point', required: true, desc: 'Điểm bẻ thứ nhất' },
    { name: 'p2', type: 'point', desc: 'Điểm bẻ thứ hai (mặc định = p1)' },
  ],
  run(ctx, args) {
    const e = asCurve(getEnt(ctx, args, 'id'), 'BREAK');
    let t1 = paramOf(e, pt(args, 'p1'));
    let t2 = args.p2 !== undefined ? paramOf(e, pt(args, 'p2')) : t1;
    const L = curveLength(e);
    if (isClosed(e)) {
      if (Math.abs(t1 - t2) < 1e-9) throw new Error('Đường kín cần hai điểm bẻ khác nhau');
      // Bỏ phần đi ngược chiều kim đồng hồ từ điểm 1 tới điểm 2, giữ phần còn lại.
      if (e.type === 'LWPOLYLINE' && t2 < t1) [t1, t2] = [t2, t1];
      const keep = subCurve(e, t2, t1 < t2 ? t1 + L : t1);
      if (!keep) throw new Error('Không bẻ được');
      ctx.doc.update({ ...keep, id: e.id } as Entity);
      return { ids: [e.id] };
    }
    if (t2 < t1) [t1, t2] = [t2, t1];
    const a = subCurve(e, 0, t1);
    const b = subCurve(e, t2, L);
    if (!a && !b) {
      ctx.doc.remove(e.id);
      return { ids: [] };
    }
    ctx.doc.update({ ...(a ?? b)!, id: e.id } as Entity);
    const out = [e.id];
    if (a && b) out.push(ctx.doc.add(b).id);
    return { ids: out };
  },
  async interactive(ctx, io) {
    const h = await io.getEntity('Chọn đối tượng (điểm bấm là điểm bẻ thứ nhất)');
    if (!h || typeof h === 'string') return;
    const p2 = await io.getPoint('Điểm bẻ thứ hai (Enter = bẻ tại một điểm) [First]', { allowNone: true, keywords: ['First'] });
    let p1: Vec = h.p;
    let second: Vec | string | null = p2;
    if (p2 === 'First') {
      const a = await io.getPoint('Điểm bẻ thứ nhất');
      if (!Array.isArray(a)) return;
      p1 = a as Vec;
      second = await io.getPoint('Điểm bẻ thứ hai', { allowNone: true });
    }
    BREAK.run(ctx, { id: h.id, p1, ...(Array.isArray(second) ? { p2: second } : {}) });
  },
};

const JOIN: CommandDef = {
  name: 'JOIN',
  aliases: ['J'],
  desc: 'Nối các LINE / đa tuyến có đầu mút trùng nhau thành một đa tuyến (LINE thẳng hàng → một LINE)',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng cần nối (ít nhất 2)' }],
  run(ctx, args) {
    const list = ids(ctx, args).filter((e) => e.type === 'LINE' || (e.type === 'LWPOLYLINE' && !e.closed));
    if (list.length < 2) throw new Error('Cần ít nhất 2 LINE hoặc đa tuyến hở');
    const ext = ctx.doc.extents();
    const tol = 1e-6 * Math.max(1, ext ? Math.max(ext.maxX - ext.minX, ext.maxY - ext.minY) : 1);

    // Trường hợp các LINE thẳng hàng, nối liền / chồng nhau → một LINE.
    if (list.every((e) => e.type === 'LINE')) {
      const ls = list as Extract<Entity, { type: 'LINE' }>[];
      const d = sub(ls[0].b, ls[0].a);
      const u = mul(d, 1 / len(d));
      const colinear = ls.every((l) => Math.abs(cross(u, sub(l.a, ls[0].a))) < tol && Math.abs(cross(u, sub(l.b, ls[0].a))) < tol);
      if (colinear) {
        const iv = ls
          .map((l) => [dot(sub(l.a, ls[0].a), u), dot(sub(l.b, ls[0].a), u)].sort((a, b) => a - b))
          .sort((a, b) => a[0] - b[0]);
        let end = iv[0][1];
        for (const [s, e] of iv.slice(1)) {
          if (s > end + tol) throw new Error('Các đoạn thẳng hàng nhưng không liền nhau');
          end = Math.max(end, e);
        }
        const a = add(ls[0].a, mul(u, iv[0][0]));
        const b = add(ls[0].a, mul(u, end));
        ctx.doc.update({ ...ls[0], a, b });
        for (const l of ls.slice(1)) ctx.doc.remove(l.id);
        return { ids: [ls[0].id], message: `Đã nối ${ls.length} đoạn thành 1 LINE` };
      }
    }

    const chains = list.map((e) => ({ e, pts: e.type === 'LINE' ? [e.a, e.b] : [...(e as Extract<Entity, { type: 'LWPOLYLINE' }>).pts] }));
    const near = (p: Vec, q: Vec) => dist(p, q) <= tol;
    let cur = chains.shift()!.pts;
    const used: Entity[] = [list[0]];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < chains.length; i++) {
        const c = chains[i].pts;
        const s = cur[0];
        const t = cur[cur.length - 1];
        let merged: Vec[] | null = null;
        if (near(t, c[0])) merged = [...cur, ...c.slice(1)];
        else if (near(t, c[c.length - 1])) merged = [...cur, ...c.slice(0, -1).reverse()];
        else if (near(s, c[c.length - 1])) merged = [...c, ...cur.slice(1)];
        else if (near(s, c[0])) merged = [...c.slice().reverse(), ...cur.slice(1)];
        if (merged) {
          cur = merged;
          used.push(chains[i].e);
          chains.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    if (used.length < 2) throw new Error('Các đối tượng không có đầu mút trùng nhau');
    const closed = cur.length > 3 && near(cur[0], cur[cur.length - 1]);
    if (closed) cur = cur.slice(0, -1);
    const first = used[0];
    const pl: NewEntity = {
      type: 'LWPOLYLINE',
      pts: cur,
      closed,
      layer: first.layer,
      ...(first.color !== undefined ? { color: first.color } : {}),
    };
    for (const e of used) ctx.doc.remove(e.id);
    const n = ctx.doc.add(pl);
    ctx.selection.clear();
    return { ids: [n.id], message: `Đã nối ${used.length} đối tượng thành đa tuyến${closed ? ' kín' : ''}` };
  },
  async interactive(ctx, io) {
    const s = await pickSelection(ctx, io);
    if (s.length) io.print(JOIN.run(ctx, { ids: s }).message!);
  },
};

// ---------- Sửa nhanh & thuộc tính ----------

const GRIPEDIT: CommandDef = {
  name: 'GRIPEDIT',
  desc: 'Kéo điểm nắm (grip) thứ index của đối tượng tới vị trí mới',
  params: [
    { name: 'id', type: 'number', required: true, desc: 'Đối tượng' },
    { name: 'index', type: 'number', required: true, desc: 'Số thứ tự grip (xem gripPoints)' },
    { name: 'to', type: 'point', required: true, desc: 'Vị trí mới' },
  ],
  run(ctx, args) {
    const e = getEnt(ctx, args, 'id');
    ctx.doc.update(applyGrip(e, num(args, 'index'), pt(args, 'to')));
    return { ids: [e.id] };
  },
};

const CHPROP: CommandDef = {
  name: 'CHPROP',
  aliases: ['CH'],
  desc: 'Đổi layer, màu, kiểu đường của đối tượng',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Danh sách id' },
    { name: 'layer', type: 'string', desc: 'Layer mới (tự tạo nếu chưa có)' },
    { name: 'color', type: 'string', desc: 'Màu ACI 1–255 hoặc "BYLAYER"' },
    { name: 'linetype', type: 'string', desc: 'Kiểu đường (CONTINUOUS, DASHED, HIDDEN, CENTER, DASHDOT, DOT, PHANTOM) hoặc "BYLAYER"' },
  ],
  run(ctx, args) {
    const list = ids(ctx, args);
    const layer = optStr(args, 'layer');
    if (layer) ctx.doc.ensureLayer(layer);
    const colorRaw = optStr(args, 'color');
    const ltRaw = optStr(args, 'linetype');
    if (ltRaw && ltRaw.toUpperCase() !== 'BYLAYER' && !ctx.doc.linetypes.has(ltRaw.toUpperCase()))
      throw new Error(`Không có kiểu đường "${ltRaw}"`);
    for (const e of list) {
      const n: Record<string, unknown> = { ...e };
      if (layer) n.layer = layer;
      if (colorRaw !== undefined) {
        if (colorRaw.toUpperCase() === 'BYLAYER') delete n.color;
        else {
          const c = Number(colorRaw);
          if (!(c >= 1 && c <= 255)) throw new Error('Màu phải từ 1 tới 255 hoặc BYLAYER');
          n.color = c;
        }
      }
      if (ltRaw !== undefined) {
        if (ltRaw.toUpperCase() === 'BYLAYER') delete n.lt;
        else n.lt = ltRaw.toUpperCase();
      }
      ctx.doc.update(n as unknown as Entity);
    }
    return { ids: list.map((e) => e.id), message: `Đã đổi thuộc tính ${list.length} đối tượng` };
  },
  async interactive(ctx, io) {
    const s = await pickSelection(ctx, io);
    if (!s.length) return;
    const what = await io.getPoint('Đổi thuộc tính nào', { keywords: ['Layer', 'Color', 'Ltype'] });
    if (what === 'Layer') {
      const v = await io.getString('Tên layer mới', { spaces: true });
      if (v) io.print(CHPROP.run(ctx, { ids: s, layer: v }).message!);
    } else if (what === 'Color') {
      const v = await io.getString('Màu (1–255 hoặc BYLAYER)');
      if (v) io.print(CHPROP.run(ctx, { ids: s, color: v }).message!);
    } else if (what === 'Ltype') {
      const v = await io.getString(`Kiểu đường (${[...ctx.doc.linetypes.keys()].join(', ')}, BYLAYER)`);
      if (v) io.print(CHPROP.run(ctx, { ids: s, linetype: v }).message!);
    }
  },
};

const MATCHPROP: CommandDef = {
  name: 'MATCHPROP',
  aliases: ['MA'],
  desc: 'Sao chép layer, màu, kiểu đường từ đối tượng nguồn sang các đối tượng đích',
  params: [
    { name: 'source', type: 'number', required: true, desc: 'Đối tượng nguồn' },
    { name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng đích' },
  ],
  run(ctx, args) {
    const src = ctx.doc.get(Number(args.source));
    if (!src) throw new Error(`Không có đối tượng #${args.source}`);
    return CHPROP.run(ctx, {
      ids: args.ids,
      layer: src.layer,
      color: src.color === undefined ? 'BYLAYER' : String(src.color),
      linetype: src.lt ?? 'BYLAYER',
    });
  },
  async interactive(ctx, io) {
    ctx.selection.clear();
    const src = await io.getEntity('Chọn đối tượng nguồn');
    if (!src || typeof src === 'string') return;
    for (;;) {
      const t = await io.getEntity('Chọn đối tượng đích (Enter để kết thúc)');
      if (!t || typeof t === 'string') return;
      MATCHPROP.run(ctx, { source: src.id, ids: [t.id] });
    }
  },
};

export const MODIFY_COMMANDS: CommandDef[] = [TRIM, EXTEND, FILLET, CHAMFER, BREAK, JOIN, GRIPEDIT, CHPROP, MATCHPROP];
