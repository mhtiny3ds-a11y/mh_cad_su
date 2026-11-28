// Sửa đổi bổ sung (LENGTHEN, DIVIDE, MEASURE, OVERKILL, ALIGN, OOPS, BREAKATPOINT, REVERSE, SETBYLAYER, PEDIT, ARRAYPATH),
// tra cứu (ID, CAL, MASSPROP, STATUS, TIME, BCOUNT) và quản lý (PURGE, RENAME, BLOCKREPLACE, UNITS, COLOR, CELTYPE, SETVAR).

import { type Vec, add, angleOf, deg2rad, dist, polar, rad2deg, sub } from '../geom';
import { type Entity, type NewEntity, bbox, hatchArea, moveEnt, normDeg, polyArea, rotateEnt, scaleEnt } from '../entities';
import { type CurveEnt, curveLength, isClosed, isCurve, paramOf, pointAt, subCurve } from '../curve';
import { type CommandDef, type Ctx, bool, created, ids, num, optStr, pt, renameLayer, str } from '../commands';

const curveOf = (ctx: Ctx, id: unknown): CurveEnt => {
  const e = ctx.doc.get(Number(id));
  if (!e) throw new Error(`Không có đối tượng #${id}`);
  if (!ctx.doc.isEditable(e)) throw new Error('Đối tượng nằm trên layer khoá');
  if (!isCurve(e)) throw new Error('Chỉ áp dụng cho đoạn thẳng, cung, đường tròn, đa tuyến');
  return e;
};

const keepProps = (e: Entity) => ({ layer: e.layer, ...(e.color !== undefined ? { color: e.color } : {}), ...(e.lt ? { lt: e.lt } : {}) });

/** Chia cung thành các điểm (dùng khi đổi cung sang đa tuyến). */
function arcPts(c: Vec, r: number, start: number, end: number): Vec[] {
  const sw = normDeg(end - start) || 360;
  const n = Math.max(4, Math.ceil(sw / 5));
  return Array.from({ length: n + 1 }, (_, i) => polar(c, deg2rad(start + (sw * i) / n), r));
}

// ---------- LENGTHEN ----------

const LENGTHEN: CommandDef = {
  name: 'LENGTHEN',
  aliases: ['LEN'],
  desc: 'Đổi chiều dài đoạn thẳng / cung / đa tuyến hở ở đầu gần điểm bấm: thêm "delta", đặt "total" hoặc theo "percent"',
  params: [
    { name: 'id', type: 'number', required: true, desc: 'Id đối tượng' },
    { name: 'pick', type: 'point', desc: 'Điểm gần đầu cần đổi (mặc định: đầu cuối)' },
    { name: 'delta', type: 'number', desc: 'Thêm (âm = bớt) chiều dài' },
    { name: 'total', type: 'number', desc: 'Hoặc: chiều dài mới' },
    { name: 'percent', type: 'number', desc: 'Hoặc: phần trăm chiều dài hiện tại (100 = giữ nguyên)' },
  ],
  run(ctx, args) {
    const e = curveOf(ctx, args.id);
    if (isClosed(e)) throw new Error('Không đổi chiều dài được đối tượng kín');
    const L = curveLength(e);
    const target =
      args.total != null ? num(args, 'total') : args.percent != null ? (L * num(args, 'percent')) / 100 : args.delta != null ? L + num(args, 'delta') : NaN;
    if (!Number.isFinite(target)) throw new Error('Cần "delta", "total" hoặc "percent"');
    if (target <= 1e-9) throw new Error('Chiều dài mới phải > 0');
    const d = target - L;
    const pick = args.pick !== undefined ? pt(args, 'pick') : pointAt(e, L);
    const atEnd = dist(pick, pointAt(e, L)) <= dist(pick, pointAt(e, 0));
    let out: Entity;
    if (e.type === 'LINE') {
      const dir = sub(e.b, e.a);
      const u: Vec = [dir[0] / L, dir[1] / L];
      out = atEnd ? { ...e, b: add(e.b, [u[0] * d, u[1] * d]) } : { ...e, a: sub(e.a, [u[0] * d, u[1] * d]) };
    } else if (e.type === 'ARC') {
      const da = rad2deg(d / e.r);
      if (normDeg(e.end - e.start) + da >= 360) throw new Error('Cung dài quá một vòng tròn');
      out = atEnd ? { ...e, end: normDeg(e.end + da) } : { ...e, start: normDeg(e.start - da) };
    } else if (e.type === 'LWPOLYLINE') {
      const pts = [...e.pts];
      const [i0, i1] = atEnd ? [pts.length - 2, pts.length - 1] : [1, 0];
      const seg = dist(pts[i0], pts[i1]);
      if (seg + d <= 1e-9) throw new Error('Đoạn cuối quá ngắn để bớt chiều dài này');
      const u: Vec = [(pts[i1][0] - pts[i0][0]) / seg, (pts[i1][1] - pts[i0][1]) / seg];
      pts[i1] = add(pts[i1], [u[0] * d, u[1] * d]);
      out = { ...e, pts };
    } else throw new Error('Không hỗ trợ');
    ctx.doc.update(out);
    return { ids: [e.id], message: `Chiều dài mới: ${Math.round(target * 1000) / 1000}` };
  },
  async interactive(ctx, io) {
    const mode = await io.getString('Cách đổi [DElta/Total/Percent]', { def: 'DElta' });
    if (!mode) return;
    const m = mode.toUpperCase();
    const key = m.startsWith('T') ? 'total' : m.startsWith('P') ? 'percent' : 'delta';
    const v = await io.getDistance(key === 'total' ? 'Chiều dài mới' : key === 'percent' ? 'Phần trăm' : 'Chiều dài thêm (âm = bớt)');
    if (v === null) return;
    for (;;) {
      const p = await io.getEntity('Bấm vào đầu cần đổi (Enter để kết thúc)');
      if (!p || typeof p === 'string') return;
      try {
        io.print(LENGTHEN.run(ctx, { id: p.id, pick: p.p, [key]: v }).message!);
      } catch (err) {
        io.print((err as Error).message);
      }
    }
  },
};

// ---------- DIVIDE / MEASURE ----------

function placeMarks(ctx: Ctx, e: CurveEnt, params: number[], block: string | undefined, align: boolean): Entity[] {
  const L = curveLength(e);
  return params.map((t) => {
    const p = pointAt(e, t);
    if (!block) return ctx.doc.add({ type: 'POINT', p, ...keepProps(e), layer: ctx.doc.currentLayer });
    const q = pointAt(e, Math.min(L, t + L * 1e-4));
    const rot = align ? rad2deg(angleOf(sub(q, p))) : 0;
    return ctx.doc.add({ type: 'INSERT', name: block, p, sx: 1, sy: 1, rot: normDeg(rot), layer: ctx.doc.currentLayer });
  });
}

const DIVIDE: CommandDef = {
  name: 'DIVIDE',
  aliases: ['DIV'],
  desc: 'Chia đều đối tượng thành n đoạn, đặt điểm (POINT) hoặc block tại các điểm chia',
  params: [
    { name: 'id', type: 'number', required: true, desc: 'Đối tượng cần chia' },
    { name: 'count', type: 'number', required: true, desc: 'Số đoạn (2–32767)' },
    { name: 'block', type: 'string', desc: 'Tên block đặt tại điểm chia (mặc định: POINT)' },
    { name: 'align', type: 'boolean', desc: 'Xoay block theo hướng đối tượng (mặc định có)' },
  ],
  run(ctx, args) {
    const e = curveOf(ctx, args.id);
    const n = Math.round(num(args, 'count'));
    if (n < 2 || n > 32767) throw new Error('Số đoạn phải từ 2 tới 32767');
    const block = optStr(args, 'block');
    if (block && !ctx.doc.blocks.has(block)) throw new Error(`Không có block "${block}"`);
    const L = curveLength(e);
    const params = Array.from({ length: isClosed(e) ? n : n - 1 }, (_, i) => (L * (isClosed(e) ? i : i + 1)) / n);
    return created(placeMarks(ctx, e, params, block, bool(args, 'align', true)), `Đã chia thành ${n} đoạn`);
  },
  async interactive(ctx, io) {
    const p = await io.getEntity('Chọn đối tượng cần chia', { keywords: [] });
    if (!p || typeof p === 'string') return;
    const n = await io.getDistance('Số đoạn', { def: 4 });
    if (n) io.print(DIVIDE.run(ctx, { id: p.id, count: n }).message!);
  },
};

const MEASURE: CommandDef = {
  name: 'MEASURE',
  aliases: ['ME'],
  desc: 'Đặt điểm (hoặc block) dọc đối tượng, cách nhau một khoảng cố định, tính từ đầu gần điểm bấm',
  params: [
    { name: 'id', type: 'number', required: true, desc: 'Đối tượng' },
    { name: 'length', type: 'number', required: true, desc: 'Khoảng cách giữa các điểm' },
    { name: 'pick', type: 'point', desc: 'Điểm gần đầu bắt đầu đo (mặc định: đầu đối tượng)' },
    { name: 'block', type: 'string', desc: 'Tên block (mặc định: POINT)' },
  ],
  run(ctx, args) {
    const e = curveOf(ctx, args.id);
    const step = num(args, 'length');
    if (step <= 0) throw new Error('Khoảng cách phải > 0');
    const L = curveLength(e);
    const block = optStr(args, 'block');
    if (block && !ctx.doc.blocks.has(block)) throw new Error(`Không có block "${block}"`);
    const fromEnd = args.pick !== undefined && !isClosed(e) && dist(pt(args, 'pick'), pointAt(e, L)) < dist(pt(args, 'pick'), pointAt(e, 0));
    const params: number[] = [];
    for (let t = step; t < L - 1e-9 || (!isClosed(e) && Math.abs(t - L) < 1e-9); t += step) params.push(fromEnd ? L - t : t);
    if (params.length > 32767) throw new Error('Quá nhiều điểm');
    return created(placeMarks(ctx, e, params, block, true), `Đã đặt ${params.length} điểm`);
  },
  async interactive(ctx, io) {
    const p = await io.getEntity('Chọn đối tượng (bấm gần đầu bắt đầu đo)');
    if (!p || typeof p === 'string') return;
    const d = await io.getDistance('Khoảng cách');
    if (d) io.print(MEASURE.run(ctx, { id: p.id, length: d, pick: p.p }).message!);
  },
};

// ---------- OVERKILL ----------

/** Khoá so sánh hình học (bỏ id, làm tròn toạ độ; đoạn thẳng không phân biệt chiều). */
function geomKey(e: Entity, tol: number): string {
  const r = (v: number) => Math.round(v / tol);
  const rv = (p: Vec) => `${r(p[0])},${r(p[1])}`;
  const head = `${e.type}|${e.layer}|${e.color ?? ''}|${e.lt ?? ''}`;
  switch (e.type) {
    case 'LINE': {
      const [a, b] = [rv(e.a), rv(e.b)].sort();
      return `${head}|${a}|${b}`;
    }
    case 'CIRCLE':
      return `${head}|${rv(e.c)}|${r(e.r)}`;
    case 'ARC':
      return `${head}|${rv(e.c)}|${r(e.r)}|${Math.round(e.start * 1e4)}|${Math.round(e.end * 1e4)}`;
    case 'LWPOLYLINE': {
      const a = e.pts.map(rv);
      const f = a.join(';');
      const b = [...a].reverse().join(';');
      return `${head}|${e.closed}|${e.fill ?? ''}|${e.wipe ?? ''}|${f < b ? f : b}`;
    }
    default: {
      const { id: _id, ...rest } = e;
      return `${head}|${JSON.stringify(rest, (_k, v) => (typeof v === 'number' ? r(v) : v))}`;
    }
  }
}

const OVERKILL: CommandDef = {
  name: 'OVERKILL',
  desc: 'Xoá đối tượng trùng nhau và đoạn thẳng dài bằng 0',
  params: [
    { name: 'ids', type: 'ids', desc: 'Các đối tượng cần xét (bỏ trống = cả bản vẽ)' },
    { name: 'tolerance', type: 'number', desc: 'Sai số coi là trùng (mặc định 0,000001)' },
  ],
  run(ctx, args) {
    const tol = num(args, 'tolerance', 1e-6);
    const list = Array.isArray(args.ids) ? ids(ctx, args) : ctx.doc.visible().filter((e) => ctx.doc.isEditable(e));
    const seen = new Set<string>();
    let dup = 0;
    let zero = 0;
    for (const e of list) {
      if (e.type === 'LINE' && dist(e.a, e.b) <= tol) {
        ctx.doc.remove(e.id);
        zero++;
        continue;
      }
      const k = geomKey(e, tol);
      if (seen.has(k)) {
        ctx.doc.remove(e.id);
        dup++;
      } else seen.add(k);
    }
    ctx.selection.clear();
    return { message: `Đã xoá ${dup} đối tượng trùng, ${zero} đoạn dài bằng 0` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng (Enter = cả bản vẽ)');
    io.print(OVERKILL.run(ctx, s.length ? { ids: s } : {}).message!);
  },
};

// ---------- ALIGN ----------

const ALIGN: CommandDef = {
  name: 'ALIGN',
  aliases: ['AL'],
  desc: 'Căn chỉnh: dời điểm nguồn 1 tới đích 1, xoay để hướng nguồn 1→2 trùng đích 1→2, có thể co giãn theo khoảng cách',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng' },
    { name: 'source1', type: 'point', required: true, desc: 'Điểm nguồn 1' },
    { name: 'dest1', type: 'point', required: true, desc: 'Điểm đích 1' },
    { name: 'source2', type: 'point', desc: 'Điểm nguồn 2' },
    { name: 'dest2', type: 'point', desc: 'Điểm đích 2' },
    { name: 'scale', type: 'boolean', desc: 'Co giãn theo tỉ số khoảng cách (mặc định không)' },
  ],
  run(ctx, args) {
    const s1 = pt(args, 'source1');
    const d1 = pt(args, 'dest1');
    const list = ids(ctx, args);
    let ang = 0;
    let k = 1;
    if (args.source2 !== undefined && args.dest2 !== undefined) {
      const s2 = pt(args, 'source2');
      const d2 = pt(args, 'dest2');
      ang = rad2deg(angleOf(sub(d2, d1)) - angleOf(sub(s2, s1)));
      if (bool(args, 'scale', false)) {
        const ls = dist(s1, s2);
        if (ls < 1e-12) throw new Error('Hai điểm nguồn trùng nhau');
        k = dist(d1, d2) / ls;
      }
    }
    for (const e of list) {
      let t: Entity = moveEnt(e, sub(d1, s1));
      t = rotateEnt(t, d1, ang);
      if (k !== 1) t = scaleEnt(t, d1, k);
      ctx.doc.update(t);
    }
    return { ids: list.map((e) => e.id), message: `Đã căn chỉnh ${list.length} đối tượng` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng');
    if (!s.length) return;
    const s1 = await io.getPoint('Điểm nguồn thứ nhất');
    if (!Array.isArray(s1)) return;
    const d1 = await io.getPoint('Điểm đích thứ nhất', { base: s1 as Vec });
    if (!Array.isArray(d1)) return;
    const s2 = await io.getPoint('Điểm nguồn thứ hai (Enter để chỉ dời)', { allowNone: true });
    if (!Array.isArray(s2)) return void io.print(ALIGN.run(ctx, { ids: s, source1: s1, dest1: d1 }).message!);
    const d2 = await io.getPoint('Điểm đích thứ hai', { base: d1 as Vec });
    if (!Array.isArray(d2)) return;
    const sc = await io.getString('Co giãn theo điểm căn? [Yes/No]', { def: 'No' });
    ctx.selection.clear();
    io.print(ALIGN.run(ctx, { ids: s, source1: s1, dest1: d1, source2: s2, dest2: d2, scale: (sc ?? '').toUpperCase().startsWith('Y') }).message!);
  },
};

// ---------- OOPS, BREAKATPOINT, REVERSE, SETBYLAYER ----------

const OOPS: CommandDef = {
  name: 'OOPS',
  desc: 'Lấy lại các đối tượng vừa xoá bằng ERASE gần nhất',
  params: [],
  run(ctx) {
    const list = ctx.doc.getVar<NewEntity[]>('_OOPS', []);
    if (!list.length) throw new Error('Không có gì để lấy lại');
    const out = list.map((e) => ctx.doc.add(e));
    ctx.doc.setVar('_OOPS', undefined);
    return created(out, `Đã lấy lại ${out.length} đối tượng`);
  },
};

const BREAKATPOINT: CommandDef = {
  name: 'BREAKATPOINT',
  aliases: ['BRP'],
  desc: 'Cắt đối tượng hở thành hai tại một điểm (không mất đoạn nào)',
  params: [
    { name: 'id', type: 'number', required: true, desc: 'Đối tượng' },
    { name: 'point', type: 'point', required: true, desc: 'Điểm cắt' },
  ],
  run(ctx, args) {
    const e = curveOf(ctx, args.id);
    if (isClosed(e)) throw new Error('Đối tượng kín: dùng BREAK với hai điểm');
    const t = paramOf(e, pt(args, 'point'));
    const L = curveLength(e);
    const a = subCurve(e, 0, t);
    const b = subCurve(e, t, L);
    if (!a || !b) throw new Error('Điểm cắt trùng đầu mút');
    ctx.doc.remove(e.id);
    return created([ctx.doc.add(a), ctx.doc.add(b)], 'Đã cắt thành hai đối tượng');
  },
  async interactive(ctx, io) {
    const p = await io.getEntity('Chọn đối tượng');
    if (!p || typeof p === 'string') return;
    const q = await io.getPoint('Điểm cắt');
    if (Array.isArray(q)) io.print(BREAKATPOINT.run(ctx, { id: p.id, point: q }).message!);
  },
};

const REVERSE: CommandDef = {
  name: 'REVERSE',
  desc: 'Đảo chiều đoạn thẳng / đa tuyến (ảnh hưởng nét đứt không đối xứng, offset, đo)',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng' }],
  run(ctx, args) {
    let n = 0;
    for (const e of ids(ctx, args)) {
      if (e.type === 'LINE') ctx.doc.update({ ...e, a: e.b, b: e.a });
      else if (e.type === 'LWPOLYLINE') ctx.doc.update({ ...e, pts: [...e.pts].reverse() });
      else continue;
      n++;
    }
    return { message: `Đã đảo chiều ${n} đối tượng` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đường cần đảo chiều');
    if (s.length) io.print(REVERSE.run(ctx, { ids: s }).message!);
  },
};

const SETBYLAYER: CommandDef = {
  name: 'SETBYLAYER',
  desc: 'Đưa màu và kiểu đường của đối tượng về theo layer (ByLayer)',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng' }],
  run(ctx, args) {
    const list = ids(ctx, args);
    for (const e of list) {
      if (e.color === undefined && !e.lt) continue;
      const { color: _c, lt: _l, ...rest } = e;
      ctx.doc.update(rest as Entity);
    }
    return { ids: list.map((e) => e.id), message: `Đã đưa ${list.length} đối tượng về ByLayer` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng');
    if (s.length) io.print(SETBYLAYER.run(ctx, { ids: s }).message!);
  },
};

// ---------- PEDIT ----------

/** Đổi LINE / ARC thành đa tuyến. */
function toPolyline(e: Entity): Extract<Entity, { type: 'LWPOLYLINE' }> | null {
  if (e.type === 'LWPOLYLINE') return e;
  if (e.type === 'LINE') return { id: e.id, type: 'LWPOLYLINE', pts: [e.a, e.b], closed: false, ...keepProps(e) };
  if (e.type === 'ARC') return { id: e.id, type: 'LWPOLYLINE', pts: arcPts(e.c, e.r, e.start, e.end), closed: false, ...keepProps(e) };
  return null;
}

const PEDIT: CommandDef = {
  name: 'PEDIT',
  aliases: ['PE'],
  desc: 'Sửa đa tuyến: close (khép), open (mở), join (nối thêm), spline (làm trơn), decurve (bỏ đỉnh thừa thẳng hàng), reverse; đoạn thẳng / cung tự đổi thành đa tuyến',
  params: [
    { name: 'id', type: 'number', required: true, desc: 'Đa tuyến (hoặc đoạn thẳng / cung)' },
    { name: 'op', type: 'string', required: true, desc: 'close | open | join | spline | decurve | reverse | convert' },
    { name: 'ids', type: 'ids', desc: 'Với join: các đối tượng nối thêm' },
  ],
  run(ctx, args) {
    const e = ctx.doc.get(num(args, 'id'));
    if (!e || !ctx.doc.isEditable(e)) throw new Error('Không có đối tượng hoặc layer bị khoá');
    const p = toPolyline(e);
    if (!p) throw new Error('Chỉ sửa được đa tuyến, đoạn thẳng hoặc cung');
    const op = str(args, 'op').toLowerCase();
    let out = p;
    switch (op) {
      case 'close':
        out = { ...p, closed: true };
        break;
      case 'open':
        out = { ...p, closed: false };
        break;
      case 'reverse':
        out = { ...p, pts: [...p.pts].reverse() };
        break;
      case 'convert':
        break;
      case 'decurve': {
        // Bỏ đỉnh nằm thẳng hàng với hai đỉnh kề (kể cả điểm chia cung).
        const pts = p.pts.filter((q, i, a) => {
          if (i === 0 || i === a.length - 1) return true;
          const u = sub(q, a[i - 1]);
          const v = sub(a[i + 1], q);
          return Math.abs(u[0] * v[1] - u[1] * v[0]) > 1e-9 * Math.hypot(...u) * Math.hypot(...v);
        });
        out = { ...p, pts };
        break;
      }
      case 'spline': {
        // Đường cong trơn qua các đỉnh (Catmull-Rom), giữ đầu mút.
        const P = p.pts;
        if (P.length < 3) break;
        const n = P.length;
        const at = (i: number): Vec => (p.closed ? P[((i % n) + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
        const res: Vec[] = [P[0]];
        const spans = p.closed ? n : n - 1;
        for (let i = 0; i < spans; i++) {
          const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
          for (let s = 1; s <= 8; s++) {
            const t = s / 8;
            const t2 = t * t;
            const t3 = t2 * t;
            res.push([
              0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
              0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
            ]);
          }
        }
        if (p.closed) res.pop();
        out = { ...p, pts: res };
        break;
      }
      case 'join': {
        // Nối nối tiếp các đối tượng chạm đầu mút.
        let pts = [...p.pts];
        const rest = (Array.isArray(args.ids) ? ids(ctx, args) : []).filter((x) => x.id !== p.id);
        const tol = 1e-6 * Math.max(1, ...pts.map((q) => Math.abs(q[0]) + Math.abs(q[1])));
        let progress = true;
        const left = rest.map((x) => ({ x, pl: toPolyline(x) })).filter((o) => o.pl && !o.pl.closed);
        while (progress && left.length) {
          progress = false;
          for (let i = 0; i < left.length; i++) {
            const q = left[i].pl!.pts;
            const s = pts[0];
            const t = pts[pts.length - 1];
            let add2: Vec[] | null = null;
            let front = false;
            if (dist(t, q[0]) <= tol) add2 = q.slice(1);
            else if (dist(t, q[q.length - 1]) <= tol) add2 = [...q].reverse().slice(1);
            else if (dist(s, q[q.length - 1]) <= tol) ((add2 = q.slice(0, -1)), (front = true));
            else if (dist(s, q[0]) <= tol) ((add2 = [...q].reverse().slice(0, -1)), (front = true));
            if (add2) {
              pts = front ? [...add2, ...pts] : [...pts, ...add2];
              ctx.doc.remove(left[i].x.id);
              left.splice(i, 1);
              progress = true;
              break;
            }
          }
        }
        const closed = pts.length > 3 && dist(pts[0], pts[pts.length - 1]) <= tol;
        out = { ...p, pts: closed ? pts.slice(0, -1) : pts, closed: closed || p.closed };
        break;
      }
      default:
        throw new Error('op phải là close, open, join, spline, decurve, reverse hoặc convert');
    }
    ctx.doc.update(out as Entity);
    return { ids: [e.id], message: `PEDIT ${op}: ${out.pts.length} đỉnh${out.closed ? ', kín' : ''}` };
  },
  async interactive(ctx, io) {
    const p = await io.getEntity('Chọn đa tuyến');
    if (!p || typeof p === 'string') return;
    for (;;) {
      const op = await io.getString('Thao tác [Close/Open/Join/Spline/Decurve/Reverse] (Enter để kết thúc)', { def: '' });
      if (!op) return;
      const map: Record<string, string> = { C: 'close', O: 'open', J: 'join', S: 'spline', D: 'decurve', R: 'reverse' };
      const o = map[op[0].toUpperCase()];
      if (!o) continue;
      try {
        if (o === 'join') {
          const s = await io.getSelection('Chọn đối tượng nối thêm');
          io.print(PEDIT.run(ctx, { id: p.id, op: o, ids: s }).message!);
          ctx.selection.clear();
        } else io.print(PEDIT.run(ctx, { id: p.id, op: o }).message!);
      } catch (err) {
        io.print((err as Error).message);
      }
    }
  },
};

// ---------- ARRAYPATH ----------

const ARRAYPATH: CommandDef = {
  name: 'ARRAYPATH',
  aliases: ['ARP'],
  desc: 'Mảng dọc đường dẫn: chép đối tượng đều nhau theo một đường (đoạn thẳng, cung, đa tuyến, đường tròn)',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng cần chép' },
    { name: 'path', type: 'number', required: true, desc: 'Id đường dẫn' },
    { name: 'count', type: 'number', required: true, desc: 'Số bản (tính cả bản đầu)' },
    { name: 'base', type: 'point', desc: 'Điểm gốc của nhóm đối tượng (mặc định: tâm khung bao)' },
    { name: 'align', type: 'boolean', desc: 'Xoay theo hướng đường dẫn (mặc định có)' },
  ],
  run(ctx, args) {
    const path = curveOf(ctx, args.path);
    const n = Math.round(num(args, 'count'));
    if (n < 2) throw new Error('Số bản phải ≥ 2');
    const list = ids(ctx, args);
    const b = list.map(bbox).reduce((a, x) => ({ minX: Math.min(a.minX, x.minX), minY: Math.min(a.minY, x.minY), maxX: Math.max(a.maxX, x.maxX), maxY: Math.max(a.maxY, x.maxY) }));
    const base = args.base !== undefined ? pt(args, 'base') : ([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] as Vec);
    const L = curveLength(path);
    const step = isClosed(path) ? L / n : L / (n - 1);
    const align = bool(args, 'align', true);
    const tangent = (t: number) => {
      const d = Math.max(L * 1e-5, 1e-9);
      const a = pointAt(path, Math.max(0, t - d));
      const c = pointAt(path, Math.min(L, t + d));
      return rad2deg(angleOf(sub(c, a)));
    };
    const a0 = tangent(0);
    const out: Entity[] = [];
    for (let i = 0; i < n; i++) {
      const t = i * step;
      const p = pointAt(path, t);
      for (const e of list) {
        const { id: _id, ...rest } = e;
        let c = moveEnt(rest as NewEntity, sub(p, base));
        if (align) c = rotateEnt(c, p, tangent(t) - a0);
        if (i === 0 && dist(p, base) < 1e-12 && !align) continue;
        out.push(ctx.doc.add(c));
      }
    }
    return created(out, `Đã tạo ${n} bản dọc đường dẫn`);
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng');
    if (!s.length) return;
    const p = await io.getEntity('Chọn đường dẫn');
    if (!p || typeof p === 'string') return;
    const n = await io.getDistance('Số bản', { def: 5 });
    ctx.selection.clear();
    if (n) io.print(ARRAYPATH.run(ctx, { ids: s, path: p.id, count: n }).message!);
  },
};

// ---------- Tra cứu ----------

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

const ID: CommandDef = {
  name: 'ID',
  desc: 'Hiện toạ độ một điểm',
  params: [{ name: 'point', type: 'point', required: true, desc: 'Điểm' }],
  readonly: true,
  run(_ctx, args) {
    const p = pt(args, 'point');
    return { point: p, message: `X = ${fmt(p[0])}   Y = ${fmt(p[1])}` };
  },
  async interactive(ctx, io) {
    const p = await io.getPoint('Chọn điểm');
    if (Array.isArray(p)) io.print(ID.run(ctx, { point: p }).message!);
  },
};

/** Máy tính biểu thức: + - * / ^ ( ), pi, sqrt, sin/cos/tan (độ), asin/acos/atan (ra độ), abs, round, floor, ceil, log, ln, exp, min, max. */
export function calc(expr: string): number {
  const src = expr.replace(/,/g, ';').replace(/\s+/g, '');
  let i = 0;
  const peek = () => src[i];
  const eat = (c: string) => {
    if (src[i] === c) {
      i++;
      return true;
    }
    return false;
  };
  const fns: Record<string, (...a: number[]) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    exp: Math.exp,
    ln: Math.log,
    log: Math.log10,
    sin: (d) => Math.sin(deg2rad(d)),
    cos: (d) => Math.cos(deg2rad(d)),
    tan: (d) => Math.tan(deg2rad(d)),
    asin: (x) => rad2deg(Math.asin(x)),
    acos: (x) => rad2deg(Math.acos(x)),
    atan: (x) => rad2deg(Math.atan(x)),
    min: Math.min,
    max: Math.max,
  };
  const expr0 = (): number => {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else return v;
    }
  };
  const term = (): number => {
    let v = unary();
    for (;;) {
      if (eat('*')) v *= unary();
      else if (eat('/')) v /= unary();
      else return v;
    }
  };
  // Dấu trừ đứng trước có độ ưu tiên thấp hơn luỹ thừa: -2^2 = -4.
  const unary = (): number => (eat('-') ? -unary() : eat('+') ? unary() : power());
  const power = (): number => {
    const b = atom();
    return eat('^') ? b ** unary() : b;
  };
  const atom = (): number => {
    if (eat('(')) {
      const v = expr0();
      if (!eat(')')) throw new Error('Thiếu dấu ")"');
      return v;
    }
    const m = /^(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)/i.exec(src.slice(i));
    if (m) {
      i += m[0].length;
      return Number(m[0]);
    }
    const w = /^[a-z]+/i.exec(src.slice(i));
    if (w) {
      i += w[0].length;
      const name = w[0].toLowerCase();
      if (name === 'pi') return Math.PI;
      const f = fns[name];
      if (!f) throw new Error(`Không biết hàm "${name}"`);
      if (!eat('(')) throw new Error(`Thiếu "(" sau ${name}`);
      const a = [expr0()];
      while (eat(';')) a.push(expr0());
      if (!eat(')')) throw new Error('Thiếu dấu ")"');
      return f(...a);
    }
    throw new Error(`Không hiểu biểu thức tại "${src.slice(i) || peek() || 'cuối'}"`);
  };
  const v = expr0();
  if (i < src.length) throw new Error(`Thừa ký tự "${src.slice(i)}"`);
  return v;
}

const CAL: CommandDef = {
  name: 'CAL',
  aliases: ['QUICKCALC', 'QC'],
  desc: 'Máy tính: + - * / ^ ( ), pi, sqrt, sin/cos/tan (độ), abs, round, min, max…',
  params: [{ name: 'expr', type: 'string', required: true, desc: 'Biểu thức, ví dụ "sqrt(3^2+4^2)*2"' }],
  readonly: true,
  run(_ctx, args) {
    const v = calc(str(args, 'expr'));
    if (!Number.isFinite(v)) throw new Error('Kết quả không xác định');
    return { value: v, message: `= ${Math.round(v * 1e8) / 1e8}` };
  },
  async interactive(ctx, io) {
    const e = await io.getString('Biểu thức', { spaces: true });
    if (e) io.print(CAL.run(ctx, { expr: e }).message!);
  },
};

/** Vòng kín của đối tượng để tính diện tích / trọng tâm. */
function regionLoops(e: Entity): Vec[][] | null {
  if (e.type === 'LWPOLYLINE' && e.closed) return [e.pts];
  if (e.type === 'CIRCLE') return [Array.from({ length: 360 }, (_, i) => polar(e.c, (Math.PI * i) / 180, e.r))];
  if (e.type === 'HATCH') return e.loops;
  return null;
}

function centroid(pts: Vec[]): Vec {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  return Math.abs(a) < 1e-18 ? pts[0] : [cx / (3 * a), cy / (3 * a)];
}

const MASSPROP: CommandDef = {
  name: 'MASSPROP',
  desc: 'Tính chất hình học vùng kín: diện tích, chu vi, trọng tâm, khung bao, mô-men quán tính',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Đa tuyến kín, đường tròn hoặc vùng tô' }],
  readonly: true,
  run(ctx, args) {
    const lines: string[] = [];
    const results: Record<string, unknown>[] = [];
    for (const e of ids(ctx, args)) {
      const loops = regionLoops(e);
      if (!loops) continue;
      const area = e.type === 'HATCH' ? hatchArea(e) : e.type === 'CIRCLE' ? Math.PI * e.r * e.r : polyArea(loops[0]);
      const perim = e.type === 'CIRCLE' ? 2 * Math.PI * e.r : loops.reduce((s, l) => s + l.reduce((t, p, i) => t + dist(p, l[(i + 1) % l.length]), 0), 0);
      const c = e.type === 'CIRCLE' ? e.c : centroid(loops[0]);
      const b = bbox(e);
      // Mô-men quán tính quanh trọng tâm (vòng ngoài).
      let ix = 0;
      let iy = 0;
      const l0 = loops[0].map((p) => sub(p, c));
      for (let i = 0; i < l0.length; i++) {
        const [x0, y0] = l0[i];
        const [x1, y1] = l0[(i + 1) % l0.length];
        const k = x0 * y1 - x1 * y0;
        ix += (y0 * y0 + y0 * y1 + y1 * y1) * k;
        iy += (x0 * x0 + x0 * x1 + x1 * x1) * k;
      }
      ix = Math.abs(ix / 12);
      iy = Math.abs(iy / 12);
      results.push({ id: e.id, area, perimeter: perim, centroid: c, ix, iy });
      lines.push(
        `#${e.id}: diện tích ${fmt(area)} · chu vi ${fmt(perim)} · trọng tâm (${fmt(c[0])}, ${fmt(c[1])}) · khung ${fmt(b.maxX - b.minX)} × ${fmt(b.maxY - b.minY)} · Ix ${fmt(ix)} · Iy ${fmt(iy)}`,
      );
    }
    if (!results.length) throw new Error('Cần đa tuyến kín, đường tròn hoặc vùng tô');
    return { results, message: lines.join('\n') };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn vùng kín');
    if (s.length) io.print(MASSPROP.run(ctx, { ids: s }).message!);
  },
};

const STATUS: CommandDef = {
  name: 'STATUS',
  desc: 'Tình trạng bản vẽ: số đối tượng theo loại, layer, block, phạm vi, biến chính',
  params: [],
  readonly: true,
  run(ctx) {
    const d = ctx.doc;
    const by = new Map<string, number>();
    for (const e of d.all()) by.set(e.type, (by.get(e.type) ?? 0) + 1);
    const ext = d.extents();
    const lines = [
      `${d.entities.size} đối tượng: ${[...by].map(([k, v]) => `${k} ${v}`).join(', ') || 'không có'}`,
      `${d.layers.size} layer (hiện hành: ${d.currentLayer}) · ${d.blocks.size} block · đơn vị ${d.units}`,
      ext ? `Phạm vi: (${fmt(ext.minX)}, ${fmt(ext.minY)}) – (${fmt(ext.maxX)}, ${fmt(ext.maxY)})` : 'Bản vẽ trống',
      `LTSCALE ${d.ltscale} · màu hiện hành ${d.getVar('CECOLOR', 'BYLAYER')} · kiểu đường hiện hành ${d.getVar('CELTYPE', 'BYLAYER')}`,
    ];
    return { message: lines.join('\n') };
  },
};

const TIME: CommandDef = {
  name: 'TIME',
  desc: 'Ngày giờ hiện tại',
  params: [],
  readonly: true,
  run() {
    return { message: `Bây giờ: ${new Date().toLocaleString('vi-VN')}` };
  },
};

const BCOUNT: CommandDef = {
  name: 'BCOUNT',
  desc: 'Đếm số lần chèn của từng block (trong vùng chọn hoặc cả bản vẽ)',
  params: [{ name: 'ids', type: 'ids', desc: 'Các đối tượng (bỏ trống = cả bản vẽ)' }],
  readonly: true,
  run(ctx, args) {
    const list = Array.isArray(args.ids) && args.ids.length ? ids(ctx, args) : ctx.doc.visible();
    const m = new Map<string, number>();
    for (const e of list) if (e.type === 'INSERT') m.set(e.name, (m.get(e.name) ?? 0) + 1);
    const rows = [...m].sort((a, b) => a[0].localeCompare(b[0], 'vi'));
    return {
      counts: Object.fromEntries(rows),
      message: rows.length ? rows.map(([k, v]) => `${k}: ${v}`).join('\n') : 'Không có block nào',
    };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng (Enter = cả bản vẽ)');
    io.print(BCOUNT.run(ctx, s.length ? { ids: s } : {}).message!);
  },
};

// ---------- Quản lý ----------

/** Block được dùng (kể cả lồng nhau trong block khác). */
function usedBlocks(ctx: Ctx): Set<string> {
  const used = new Set<string>();
  const visit = (ents: readonly NewEntity[] | Entity[]) => {
    for (const e of ents)
      if (e.type === 'INSERT' && !used.has(e.name)) {
        used.add(e.name);
        const b = ctx.doc.blocks.get(e.name);
        if (b) visit(b.ents);
      }
  };
  visit(ctx.doc.all());
  return used;
}

const PURGE: CommandDef = {
  name: 'PURGE',
  aliases: ['PU', '-PURGE'],
  desc: 'Dọn bản vẽ: xoá layer rỗng, block không dùng, kiểu đường không dùng',
  params: [{ name: 'what', type: 'string', desc: '"all" (mặc định), "layers", "blocks" hoặc "linetypes"' }],
  run(ctx, args) {
    const what = (optStr(args, 'what') ?? 'all').toLowerCase();
    let nb = 0;
    let nl = 0;
    if (what === 'all' || what === 'blocks') {
      // Lặp vì xoá block ngoài có thể làm block lồng bên trong thành không dùng.
      for (;;) {
        const used = usedBlocks(ctx);
        const dead = [...ctx.doc.blocks.keys()].filter((n) => !used.has(n));
        if (!dead.length) break;
        for (const n of dead) ctx.doc.removeBlock(n);
        nb += dead.length;
      }
    }
    if (what === 'all' || what === 'layers') {
      const usedL = new Set(ctx.doc.all().map((e) => e.layer));
      for (const b of ctx.doc.blocks.values()) for (const e of b.ents) usedL.add(e.layer);
      for (const name of [...ctx.doc.layers.keys()])
        if (name !== '0' && name !== ctx.doc.currentLayer && !usedL.has(name) && !/^defpoints$/i.test(name)) {
          ctx.doc.removeLayer(name);
          nl++;
        }
    }
    return { message: `Đã dọn ${nb} block, ${nl} layer` };
  },
};

const RENAME: CommandDef = {
  name: 'RENAME',
  aliases: ['REN', '-RENAME'],
  desc: 'Đổi tên layer hoặc block',
  params: [
    { name: 'kind', type: 'string', required: true, desc: '"layer" hoặc "block"' },
    { name: 'from', type: 'string', required: true, desc: 'Tên cũ' },
    { name: 'to', type: 'string', required: true, desc: 'Tên mới' },
  ],
  run(ctx, args) {
    const kind = str(args, 'kind').toLowerCase();
    const from = str(args, 'from');
    const to = str(args, 'to').trim();
    if (kind.startsWith('l')) return renameLayer(ctx, from, to);
    const b = ctx.doc.blocks.get(from);
    if (!b) throw new Error(`Không có block "${from}"`);
    if (ctx.doc.blocks.has(to)) throw new Error(`Block "${to}" đã có`);
    if (!/^[^<>/\\":;?*|=`]{1,255}$/.test(to)) throw new Error('Tên block không hợp lệ');
    ctx.doc.setBlock({ ...b, name: to });
    for (const e of ctx.doc.all()) if (e.type === 'INSERT' && e.name === from) ctx.doc.update({ ...e, name: to });
    for (const x of [...ctx.doc.blocks.values()])
      if (x.ents.some((e) => e.type === 'INSERT' && e.name === from))
        ctx.doc.setBlock({ ...x, ents: x.ents.map((e) => (e.type === 'INSERT' && e.name === from ? { ...e, name: to } : e)) });
    ctx.doc.removeBlock(from);
    return { message: `Đã đổi tên block "${from}" thành "${to}"` };
  },
  async interactive(ctx, io) {
    const kind = await io.getString('Đổi tên [Layer/Block]', { def: 'Layer' });
    if (!kind) return;
    const from = await io.getString('Tên cũ', { spaces: true });
    if (!from) return;
    const to = await io.getString('Tên mới', { spaces: true });
    if (to) io.print(RENAME.run(ctx, { kind, from, to }).message!);
  },
};

const BLOCKREPLACE: CommandDef = {
  name: 'BLOCKREPLACE',
  desc: 'Thay mọi lần chèn của một block bằng block khác (giữ vị trí, tỉ lệ, góc)',
  params: [
    { name: 'from', type: 'string', required: true, desc: 'Block cũ' },
    { name: 'to', type: 'string', required: true, desc: 'Block mới' },
  ],
  run(ctx, args) {
    const from = str(args, 'from');
    const to = str(args, 'to');
    if (!ctx.doc.blocks.has(to)) throw new Error(`Không có block "${to}"`);
    let n = 0;
    for (const e of ctx.doc.all())
      if (e.type === 'INSERT' && e.name === from && ctx.doc.isEditable(e)) {
        ctx.doc.update({ ...e, name: to });
        n++;
      }
    return { message: `Đã thay ${n} block "${from}" bằng "${to}"` };
  },
  async interactive(ctx, io) {
    const from = await io.getString('Block cần thay', { spaces: true });
    if (!from) return;
    const to = await io.getString('Thay bằng block', { spaces: true });
    if (to) io.print(BLOCKREPLACE.run(ctx, { from, to }).message!);
  },
};

const UNITS: CommandDef = {
  name: 'UNITS',
  aliases: ['UN', '-UNITS'],
  desc: 'Đơn vị bản vẽ: mm, cm, m, in, ft',
  params: [{ name: 'units', type: 'string', required: true, desc: 'mm | cm | m | in | ft' }],
  run(ctx, args) {
    const u = str(args, 'units').toLowerCase();
    if (!['mm', 'cm', 'm', 'in', 'ft'].includes(u)) throw new Error('Đơn vị phải là mm, cm, m, in hoặc ft');
    ctx.doc.setUnits(u);
    return { message: `Đơn vị bản vẽ: ${u}` };
  },
  async interactive(ctx, io) {
    const u = await io.getString(`Đơn vị [mm/cm/m/in/ft] (hiện: ${ctx.doc.units})`, { def: ctx.doc.units });
    if (u) io.print(UNITS.run(ctx, { units: u }).message!);
  },
};

const COLOR: CommandDef = {
  name: 'COLOR',
  aliases: ['COL', '-COLOR', 'CECOLOR'],
  desc: 'Màu hiện hành cho đối tượng vẽ mới: 1–255 hoặc BYLAYER',
  params: [{ name: 'color', type: 'string', required: true, desc: 'Số màu ACI 1–255, hoặc BYLAYER' }],
  run(ctx, args) {
    const v = str(args, 'color').toUpperCase();
    const names: Record<string, number> = { RED: 1, YELLOW: 2, GREEN: 3, CYAN: 4, BLUE: 5, MAGENTA: 6, WHITE: 7, DO: 1, VANG: 2, XANHLA: 3, XANH: 5, TIM: 6, TRANG: 7 };
    if (v === 'BYLAYER' || v === '256') {
      ctx.doc.setVar('CECOLOR', undefined);
      return { message: 'Màu hiện hành: BYLAYER' };
    }
    const n = names[v] ?? Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 255) throw new Error('Màu phải là 1–255 hoặc BYLAYER');
    ctx.doc.setVar('CECOLOR', n);
    return { message: `Màu hiện hành: ${n}` };
  },
  async interactive(ctx, io) {
    const v = await io.getString('Màu hiện hành (1–255 / BYLAYER)', { def: String(ctx.doc.getVar('CECOLOR', 'BYLAYER')) });
    if (v) io.print(COLOR.run(ctx, { color: v }).message!);
  },
};

const CELTYPE: CommandDef = {
  name: 'CELTYPE',
  aliases: ['LINETYPE', 'LT', '-LINETYPE'],
  desc: 'Kiểu đường hiện hành cho đối tượng vẽ mới (BYLAYER, CONTINUOUS, DASHED, HIDDEN, CENTER, DASHDOT, DOT, PHANTOM…)',
  params: [{ name: 'linetype', type: 'string', required: true, desc: 'Tên kiểu đường hoặc BYLAYER' }],
  run(ctx, args) {
    const v = str(args, 'linetype').toUpperCase();
    if (v === 'BYLAYER') {
      ctx.doc.setVar('CELTYPE', undefined);
      return { message: 'Kiểu đường hiện hành: BYLAYER' };
    }
    if (!ctx.doc.linetypes.has(v)) throw new Error(`Không có kiểu đường "${v}". Có: ${[...ctx.doc.linetypes.keys()].join(', ')}`);
    ctx.doc.setVar('CELTYPE', v);
    return { message: `Kiểu đường hiện hành: ${v}` };
  },
  async interactive(ctx, io) {
    io.print(`Kiểu đường có: BYLAYER, ${[...ctx.doc.linetypes.keys()].join(', ')}`);
    const v = await io.getString('Kiểu đường hiện hành', { def: String(ctx.doc.getVar('CELTYPE', 'BYLAYER')) });
    if (v) io.print(CELTYPE.run(ctx, { linetype: v }).message!);
  },
};

const SETVAR: CommandDef = {
  name: 'SETVAR',
  aliases: ['SET'],
  desc: 'Đặt biến bản vẽ: LTSCALE, CLAYER, CECOLOR, CELTYPE, DIMSCALE, PDSIZE, WIPEOUTFRAME…',
  params: [
    { name: 'name', type: 'string', required: true, desc: 'Tên biến' },
    { name: 'value', type: 'string', desc: 'Giá trị (bỏ trống = chỉ xem)' },
  ],
  run(ctx, args) {
    const name = str(args, 'name').toUpperCase();
    const cur = () =>
      name === 'LTSCALE' ? ctx.doc.ltscale : name === 'CLAYER' ? ctx.doc.currentLayer : name === 'INSUNITS' || name === 'UNITS' ? ctx.doc.units : ctx.doc.getVar(name, undefined);
    if (args.value === undefined || args.value === '') return { value: cur(), message: `${name} = ${JSON.stringify(cur() ?? null)}` };
    const raw = String(args.value);
    const v = raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
    if (name === 'LTSCALE') ctx.doc.setLtscale(Number(v));
    else if (name === 'CLAYER') ctx.doc.setCurrentLayer(String(v));
    else if (name === 'CECOLOR') COLOR.run(ctx, { color: String(v) });
    else if (name === 'CELTYPE') CELTYPE.run(ctx, { linetype: String(v) });
    else if (name === 'DIMSCALE') {
      const k = Number(v);
      if (!(k > 0)) throw new Error('DIMSCALE phải > 0');
      const s = ctx.doc.dimStyle;
      // Kiểu kích thước mặc định (chữ cao 250) tương ứng DIMSCALE = 100 với chữ 2,5 trên giấy.
      const base = ctx.doc.getVar<number>('DIMSCALE', 100);
      const f = k / base;
      ctx.doc.setDimStyle({ txt: s.txt * f, asz: s.asz * f, exo: s.exo * f, exe: s.exe * f, gap: s.gap * f });
      ctx.doc.setVar('DIMSCALE', k);
    } else ctx.doc.setVar(name, v);
    return { value: cur(), message: `${name} = ${JSON.stringify(cur())}` };
  },
  async interactive(ctx, io) {
    const name = await io.getString('Tên biến');
    if (!name) return;
    const v = await io.getString(`Giá trị mới cho ${name.toUpperCase()} (Enter = xem)`, { def: '' });
    io.print(SETVAR.run(ctx, { name, value: v ?? '' }).message!);
  },
};

// Hàm tiện ích dùng chung với lệnh khác.
export { arcPts, keepProps, toPolyline, regionLoops, centroid };

export const TOOL_COMMANDS: CommandDef[] = [
  LENGTHEN,
  DIVIDE,
  MEASURE,
  OVERKILL,
  ALIGN,
  OOPS,
  BREAKATPOINT,
  REVERSE,
  SETBYLAYER,
  PEDIT,
  ARRAYPATH,
  ID,
  CAL,
  MASSPROP,
  STATUS,
  TIME,
  BCOUNT,
  PURGE,
  RENAME,
  BLOCKREPLACE,
  UNITS,
  COLOR,
  CELTYPE,
  SETVAR,
];
