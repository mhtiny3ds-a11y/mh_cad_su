// Kích thước & ghi chú bổ sung: DIMBASELINE, DIMORDINATE, DIMARC, QDIM, DIMEDIT, DIMSPACE, MLEADER, TABLE,
// CENTERMARK, CENTERLINE, BREAKLINE, GOPY.

import { type Vec, add, angleOf, deg2rad, dist, dot, mid, mul, polar, sub } from '../geom';
import { type DimEnt, type Entity, type NewEntity, bbox, normDeg, snapPoints } from '../entities';
import { type CommandDef, type Ctx, COMMON, created, ids, num, optStr, props, pt, pts, str } from '../commands';
import { DIM_COMMON, addDim, projectLoc } from './annotate';
import { revcloudPts } from './draw';

type Dim = Extract<Entity, { type: 'DIMENSION' }>;

/** Kích thước tạo gần nhất (làm gốc mặc định cho DIMBASELINE). */
function lastDim(ctx: Ctx, kinds: DimEnt['kind'][]): Dim | undefined {
  let best: Dim | undefined;
  for (const e of ctx.doc.all()) if (e.type === 'DIMENSION' && kinds.includes(e.kind) && (!best || e.id > best.id)) best = e;
  return best;
}

const DIMBASELINE: CommandDef = {
  name: 'DIMBASELINE',
  aliases: ['DBA', 'DIMBASE'],
  desc: 'Kích thước cùng gốc: các kích thước mới chung đường dóng thứ nhất với kích thước gốc, xếp cách đều ra ngoài',
  params: [
    { name: 'base', type: 'number', desc: 'Kích thước gốc (ngang/đứng/song song; mặc định: kích thước tạo gần nhất)' },
    { name: 'points', type: 'points', required: true, desc: 'Các gốc đường dóng thứ hai' },
    { name: 'spacing', type: 'number', desc: 'Khoảng cách giữa các đường kích thước (mặc định 3,75 × chiều cao chữ)' },
  ],
  run(ctx, args) {
    const b = args.base != null ? ctx.doc.get(Number(args.base)) : lastDim(ctx, ['linear', 'aligned']);
    if (b?.type !== 'DIMENSION' || (b.kind !== 'linear' && b.kind !== 'aligned')) throw new Error('Cần một kích thước ngang/đứng/song song làm gốc');
    const sp = num(args, 'spacing', b.style.txt * 3.75);
    const u: Vec = b.kind === 'linear' ? [Math.cos(deg2rad(b.rot ?? 0)), Math.sin(deg2rad(b.rot ?? 0))] : (() => {
      const d = sub(b.pts[1], b.pts[0]);
      const L = Math.hypot(d[0], d[1]) || 1;
      return [d[0] / L, d[1] / L] as Vec;
    })();
    const n: Vec = [-u[1], u[0]];
    // Phía đặt kích thước: theo vị trí đường kích thước của kích thước gốc.
    const side = Math.sign(dot(sub(b.pts[2], b.pts[0]), n)) || 1;
    let cur = b;
    const out: Entity[] = [];
    for (const q of pts(args, 'points', 1)) {
      const loc = add(cur.kind === 'linear' ? projectLoc(cur, q) : add(q, sub(cur.pts[2], cur.pts[1])), mul(n, sp * side));
      const e = ctx.doc.add({
        type: 'DIMENSION',
        kind: b.kind,
        pts: [b.pts[0], q, loc],
        ...(b.rot !== undefined ? { rot: b.rot } : {}),
        style: { ...b.style },
        layer: b.layer,
        ...(b.color !== undefined ? { color: b.color } : {}),
      });
      out.push(e);
      cur = e as Dim;
    }
    return created(out);
  },
  async interactive(ctx, io) {
    let b = lastDim(ctx, ['linear', 'aligned']);
    if (!b) {
      const h = await io.getEntity('Chọn kích thước gốc');
      if (!h || typeof h === 'string') return;
      b = ctx.doc.get(h.id) as Dim;
    }
    const base = b.id;
    for (;;) {
      const q = await io.getPoint('Gốc đường dóng thứ hai (Enter để kết thúc)', { allowNone: true });
      if (!Array.isArray(q)) return;
      DIMBASELINE.run(ctx, { base: lastDim(ctx, ['linear', 'aligned'])?.id ?? base, points: [q] });
    }
  },
};

const DIMORDINATE: CommandDef = {
  name: 'DIMORDINATE',
  aliases: ['DOR', 'DIMORD'],
  desc: 'Kích thước toạ độ: ghi X hoặc Y của một điểm (gốc toạ độ 0,0)',
  params: [
    { name: 'point', type: 'point', required: true, desc: 'Điểm cần ghi toạ độ' },
    { name: 'leader', type: 'point', required: true, desc: 'Đầu đường dẫn (nơi đặt chữ)' },
    { name: 'axis', type: 'string', desc: '"x" hoặc "y" (mặc định: tự chọn theo hướng kéo đường dẫn)' },
    ...DIM_COMMON,
  ],
  run(ctx, args) {
    const p = pt(args, 'point');
    const l = pt(args, 'leader');
    const ax = optStr(args, 'axis')?.toLowerCase() ?? (Math.abs(l[0] - p[0]) > Math.abs(l[1] - p[1]) ? 'y' : 'x');
    const e = addDim(ctx, args, 'ordinate', [p, l], ax === 'y' ? 90 : 0);
    return { ids: [e.id] };
  },
  async interactive(ctx, io) {
    const p = await io.getPoint('Điểm cần ghi toạ độ');
    if (!Array.isArray(p)) return;
    const q = await io.getPoint('Đầu đường dẫn', {
      base: p as Vec,
      preview: (c) => [{ type: 'DIMENSION', kind: 'ordinate', pts: [p as Vec, c], rot: Math.abs(c[0] - p[0]) > Math.abs(c[1] - p[1]) ? 90 : 0, style: ctx.doc.dimStyle, layer: ctx.doc.currentLayer }],
    });
    if (Array.isArray(q)) DIMORDINATE.run(ctx, { point: p, leader: q });
  },
};

const DIMARC: CommandDef = {
  name: 'DIMARC',
  aliases: ['DAR'],
  desc: 'Kích thước chiều dài cung',
  params: [
    { name: 'id', type: 'number', required: true, desc: 'Id cung (ARC)' },
    { name: 'location', type: 'point', required: true, desc: 'Vị trí đường kích thước' },
    ...DIM_COMMON,
  ],
  run(ctx, args) {
    const a = ctx.doc.get(num(args, 'id'));
    if (a?.type !== 'ARC') throw new Error('Cần chọn một cung (ARC)');
    const s = polar(a.c, deg2rad(a.start), a.r);
    const en = polar(a.c, deg2rad(a.end), a.r);
    const loc = pt(args, 'location');
    // Vị trí luôn nằm trong phần góc của cung (tránh lấy nhầm phần bù).
    const midA = deg2rad(a.start + (normDeg(a.end - a.start) || 360) / 2);
    const fixed = polar(a.c, midA, Math.max(dist(a.c, loc), 1e-9));
    const e = addDim(ctx, args, 'arclen', [a.c, s, en, fixed]);
    return { ids: [e.id] };
  },
  async interactive(ctx, io) {
    const h = await io.getEntity('Chọn cung');
    if (!h || typeof h === 'string') return;
    const a = ctx.doc.get(h.id);
    if (a?.type !== 'ARC') return io.print('Cần chọn một cung');
    const loc = await io.getPoint('Vị trí đường kích thước');
    if (Array.isArray(loc)) DIMARC.run(ctx, { id: a.id, location: loc });
  },
};

const QDIM: CommandDef = {
  name: 'QDIM',
  desc: 'Kích thước nhanh: ghi chuỗi kích thước nối tiếp (hoặc cùng gốc) qua mọi đầu mút / tâm của các đối tượng chọn',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng' },
    { name: 'location', type: 'point', required: true, desc: 'Vị trí đường kích thước' },
    { name: 'direction', type: 'string', desc: '"h" ngang hoặc "v" đứng (mặc định: theo vị trí đặt)' },
    { name: 'mode', type: 'string', desc: '"continuous" (mặc định) hoặc "baseline"' },
  ],
  run(ctx, args) {
    const list = ids(ctx, args);
    const loc = pt(args, 'location');
    const b = list.map(bbox).reduce((a, x) => ({ minX: Math.min(a.minX, x.minX), minY: Math.min(a.minY, x.minY), maxX: Math.max(a.maxX, x.maxX), maxY: Math.max(a.maxY, x.maxY) }));
    const dir = optStr(args, 'direction')?.toLowerCase() ?? (loc[1] > b.maxY || loc[1] < b.minY ? 'h' : 'v');
    const k = dir === 'h' ? 0 : 1;
    const raw: Vec[] = [];
    for (const e of list) for (const s of snapPoints(e)) if (s.kind === 'end' || s.kind === 'center' || s.kind === 'node' || s.kind === 'insert') raw.push(s.p);
    raw.sort((p, q) => p[k] - q[k]);
    const tol = 1e-6 * Math.max(1, b.maxX - b.minX, b.maxY - b.minY);
    const P: Vec[] = [];
    for (const p of raw) if (!P.length || Math.abs(p[k] - P[P.length - 1][k]) > tol) P.push(p);
    if (P.length < 2) throw new Error('Cần ít nhất hai điểm khác nhau theo phương ghi kích thước');
    const rot = dir === 'h' ? 0 : 90;
    const baseline = (optStr(args, 'mode') ?? 'continuous').toLowerCase().startsWith('b');
    const out: Entity[] = [];
    const step = ctx.doc.dimStyle.txt * 3.75;
    for (let i = 1; i < P.length; i++) {
      const a = baseline ? P[0] : P[i - 1];
      const off = baseline ? (i - 1) * step * (k === 0 ? Math.sign(loc[1] - b.minY) || 1 : Math.sign(loc[0] - b.minX) || 1) : 0;
      const l: Vec = k === 0 ? [P[i][0], loc[1] + off] : [loc[0] + off, P[i][1]];
      out.push(addDim(ctx, {}, 'linear', [a, P[i], l], rot));
    }
    return created(out, `Đã ghi ${out.length} kích thước`);
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng cần ghi kích thước');
    if (!s.length) return;
    const loc = await io.getPoint('Vị trí đường kích thước', { keywords: ['Baseline'] });
    if (loc === 'Baseline') {
      const l2 = await io.getPoint('Vị trí đường kích thước');
      if (Array.isArray(l2)) io.print(QDIM.run(ctx, { ids: s, location: l2, mode: 'baseline' }).message!);
    } else if (Array.isArray(loc)) io.print(QDIM.run(ctx, { ids: s, location: loc }).message!);
    ctx.selection.clear();
  },
};

const DIMEDIT: CommandDef = {
  name: 'DIMEDIT',
  aliases: ['DED'],
  desc: 'Sửa chữ của nhiều kích thước: ghi đè chữ ("<>" là giá trị đo), hoặc "home" để trả về giá trị đo',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các kích thước' },
    { name: 'text', type: 'string', required: true, desc: 'Chữ mới, ví dụ "<> mm" hoặc "home"' },
  ],
  run(ctx, args) {
    const t = str(args, 'text');
    const list = ids(ctx, args).filter((e): e is Dim => e.type === 'DIMENSION');
    for (const d of list) {
      const { text: _t, ...rest } = d;
      ctx.doc.update(t.toLowerCase() === 'home' || t === '<>' ? (rest as Dim) : { ...d, text: t });
    }
    return { message: `Đã sửa ${list.length} kích thước` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn kích thước');
    if (!s.length) return;
    const t = await io.getString('Chữ mới ("<>" = giá trị đo, Home = trả về)', { def: '<>', spaces: true });
    ctx.selection.clear();
    if (t) io.print(DIMEDIT.run(ctx, { ids: s, text: t }).message!);
  },
};

const DIMSPACE: CommandDef = {
  name: 'DIMSPACE',
  desc: 'Dàn đều các kích thước song song so với một kích thước gốc',
  params: [
    { name: 'base', type: 'number', required: true, desc: 'Kích thước gốc (giữ nguyên)' },
    { name: 'ids', type: 'ids', required: true, desc: 'Các kích thước cần dàn' },
    { name: 'spacing', type: 'number', desc: 'Khoảng cách (mặc định 3,75 × chiều cao chữ; 0 = thẳng hàng)' },
  ],
  run(ctx, args) {
    const b = ctx.doc.get(num(args, 'base'));
    if (b?.type !== 'DIMENSION' || (b.kind !== 'linear' && b.kind !== 'aligned')) throw new Error('Kích thước gốc phải là ngang/đứng/song song');
    const ang = b.kind === 'linear' ? deg2rad(b.rot ?? 0) : angleOf(sub(b.pts[1], b.pts[0]));
    const n: Vec = [-Math.sin(ang), Math.cos(ang)];
    const sp = num(args, 'spacing', b.style.txt * 3.75);
    const off0 = dot(b.pts[2], n);
    const side = Math.sign(off0 - dot(b.pts[0], n)) || 1;
    const list = ids(ctx, args)
      .filter((e): e is Dim => e.type === 'DIMENSION' && e.id !== b.id && (e.kind === 'linear' || e.kind === 'aligned'))
      .sort((p, q) => side * (dot(p.pts[2], n) - dot(q.pts[2], n)));
    list.forEach((d, i) => {
      const want = off0 + side * sp * (i + 1);
      const loc = add(d.pts[2], mul(n, want - dot(d.pts[2], n)));
      ctx.doc.update({ ...d, pts: [d.pts[0], d.pts[1], loc] });
    });
    return { message: `Đã dàn đều ${list.length} kích thước` };
  },
  async interactive(ctx, io) {
    const h = await io.getEntity('Chọn kích thước gốc');
    if (!h || typeof h === 'string') return;
    const s = await io.getSelection('Chọn các kích thước cần dàn');
    if (!s.length) return;
    const sp = await io.getDistance('Khoảng cách (0 = thẳng hàng)', { def: (ctx.doc.get(h.id) as Dim).style.txt * 3.75 });
    ctx.selection.clear();
    if (sp !== null) io.print(DIMSPACE.run(ctx, { base: h.id, ids: s, spacing: sp }).message!);
  },
};

// ---------- MLEADER ----------

/** Hình của đường dẫn ghi chú: mũi tên, các đoạn, đoạn ngang ngắn và chữ. */
export function leaderEnts(points: Vec[], text: string, h: number, layer: string, color?: number): NewEntity[] {
  const col = color !== undefined ? { color } : {};
  const out: NewEntity[] = [];
  const [tip, next] = points;
  const ang = angleOf(sub(tip, next));
  const asz = h * 0.72;
  const back = polar(tip, ang + Math.PI, asz);
  const w = asz / 5;
  const nv: Vec = [-Math.sin(ang) * w, Math.cos(ang) * w];
  out.push({ type: 'LWPOLYLINE', pts: [tip, add(back, nv), sub(back, nv)], closed: true, fill: true, layer, ...col });
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const right = last[0] >= prev[0];
  const land: Vec = [last[0] + (right ? 1 : -1) * h, last[1]];
  out.push({ type: 'LWPOLYLINE', pts: [...points, land], closed: false, layer, ...col });
  if (text)
    out.push({
      type: 'TEXT',
      p: [land[0] + (right ? 1 : -1) * h * 0.4, land[1]],
      h,
      text,
      rot: 0,
      ha: right ? 'L' : 'R',
      va: 'M',
      layer,
      ...col,
    });
  return out;
}

let leaderH = 250;

const MLEADER: CommandDef = {
  name: 'MLEADER',
  aliases: ['MLD', 'LEADER', 'LE', 'QLEADER', 'QLE'],
  desc: 'Đường dẫn ghi chú: mũi tên tại điểm đầu, gãy qua các điểm, chữ ở cuối',
  params: [
    { name: 'points', type: 'points', required: true, desc: 'Điểm mũi tên, (các điểm gãy), điểm cuối' },
    { name: 'text', type: 'string', desc: 'Nội dung ghi chú (xuống dòng bằng \\n)' },
    { name: 'height', type: 'number', desc: 'Chiều cao chữ (mặc định 250)' },
    ...COMMON,
  ],
  run(ctx, args) {
    const P = pts(args, 'points', 2);
    const h = num(args, 'height', leaderH);
    const pr = props(ctx, args);
    const out = leaderEnts(P, optStr(args, 'text') ?? '', h, pr.layer, pr.color).map((e) => ctx.doc.add({ ...e, ...(pr.lt && e.type !== 'TEXT' ? { lt: pr.lt } : {}) }));
    return created(out);
  },
  async interactive(ctx, io) {
    const a = await io.getPoint('Điểm mũi tên', { keywords: ['Height'] });
    if (a === 'Height') {
      const v = await io.getDistance('Chiều cao chữ', { def: leaderH });
      if (v && v > 0) leaderH = v;
      return MLEADER.interactive!(ctx, io);
    }
    if (!Array.isArray(a)) return;
    const P: Vec[] = [a as Vec];
    for (;;) {
      const q = await io.getPoint(P.length < 2 ? 'Điểm tiếp theo' : 'Điểm tiếp theo (Enter để ghi chữ)', {
        base: P[P.length - 1],
        allowNone: P.length >= 2,
        preview: (c) => leaderEnts([...P, c], '', leaderH, ctx.doc.currentLayer),
      });
      if (!Array.isArray(q)) break;
      P.push(q as Vec);
      if (P.length >= 3) break;
    }
    if (P.length < 2) return;
    const t = io.getText ? await io.getText('Nội dung ghi chú') : await io.getString('Nội dung ghi chú', { spaces: true });
    MLEADER.run(ctx, { points: P, text: t ?? '', height: leaderH });
  },
};

// ---------- TABLE ----------

const TABLE: CommandDef = {
  name: 'TABLE',
  aliases: ['TB', '-TABLE'],
  desc: 'Bảng: kẻ khung và điền chữ. data là mảng các hàng (hàng đầu là tiêu đề), hoặc văn bản dán từ Excel (Tab ngăn cột)',
  params: [
    { name: 'position', type: 'point', required: true, desc: 'Góc trên trái' },
    { name: 'data', type: 'string', desc: 'Mảng 2 chiều [["A","B"],["1","2"]] hoặc văn bản Tab / xuống dòng' },
    { name: 'rows', type: 'number', desc: 'Số hàng (khi không có data, mặc định 4)' },
    { name: 'cols', type: 'number', desc: 'Số cột (khi không có data, mặc định 3)' },
    { name: 'colWidth', type: 'number', desc: 'Bề rộng cột (mặc định: tự theo chữ, tối thiểu 2500)' },
    { name: 'rowHeight', type: 'number', desc: 'Chiều cao hàng (mặc định 2 × chiều cao chữ)' },
    { name: 'height', type: 'number', desc: 'Chiều cao chữ (mặc định 250)' },
    ...COMMON,
  ],
  run(ctx, args) {
    const p0 = pt(args, 'position');
    let data: string[][];
    if (Array.isArray(args.data)) data = (args.data as unknown[]).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [String(r)]));
    else if (typeof args.data === 'string' && args.data.trim())
      data = args.data
        .replace(/\r/g, '')
        .split('\n')
        .filter((l, i, a) => l.trim() || i < a.length - 1)
        .map((l) => l.split('\t'));
    else data = Array.from({ length: Math.round(num(args, 'rows', 4)) }, () => Array.from({ length: Math.round(num(args, 'cols', 3)) }, () => ''));
    const nr = data.length;
    const nc = Math.max(...data.map((r) => r.length));
    if (nr < 1 || nc < 1 || nr * nc > 20000) throw new Error('Bảng phải có từ 1 ô tới 20.000 ô');
    const h = num(args, 'height', 250);
    const rh = num(args, 'rowHeight', h * 2);
    const widths = Array.from({ length: nc }, (_, j) =>
      args.colWidth != null ? num(args, 'colWidth') : Math.max(2500, ...data.map((r) => (r[j] ?? '').length * h * 0.65 + h * 1.6)),
    );
    const W = widths.reduce((a, b) => a + b, 0);
    const pr = props(ctx, args);
    const out: Entity[] = [];
    out.push(ctx.doc.add({ type: 'LWPOLYLINE', pts: [p0, [p0[0] + W, p0[1]], [p0[0] + W, p0[1] - rh * nr], [p0[0], p0[1] - rh * nr]], closed: true, ...pr }));
    for (let i = 1; i < nr; i++) out.push(ctx.doc.add({ type: 'LINE', a: [p0[0], p0[1] - rh * i], b: [p0[0] + W, p0[1] - rh * i], ...pr }));
    let x = p0[0];
    for (let j = 0; j < nc - 1; j++) {
      x += widths[j];
      out.push(ctx.doc.add({ type: 'LINE', a: [x, p0[1]], b: [x, p0[1] - rh * nr], ...pr }));
    }
    x = p0[0];
    for (let j = 0; j < nc; j++) {
      for (let i = 0; i < nr; i++) {
        const t = (data[i][j] ?? '').trim();
        if (!t) continue;
        const num0 = /^[-+]?[\d.,]+$/.test(t);
        const head = i === 0;
        out.push(
          ctx.doc.add({
            type: 'TEXT',
            p: [head ? x + widths[j] / 2 : num0 ? x + widths[j] - h * 0.6 : x + h * 0.6, p0[1] - rh * i - rh / 2],
            h,
            text: t,
            rot: 0,
            ha: head ? 'C' : num0 ? 'R' : 'L',
            va: 'M',
            ...pr,
          }),
        );
      }
      x += widths[j];
    }
    return created(out, `Đã tạo bảng ${nr} hàng × ${nc} cột`);
  },
  async interactive(ctx, io) {
    const p = await io.getPoint('Góc trên trái của bảng');
    if (!Array.isArray(p)) return;
    const t = io.getText ? await io.getText('Dán dữ liệu từ Excel (Tab ngăn cột) hoặc gõ: mỗi dòng một hàng, cột cách nhau bằng Tab hoặc |') : null;
    if (t) TABLE.run(ctx, { position: p, data: t.includes('\t') ? t : t.replace(/\s*\|\s*/g, '\t') });
    else {
      const r = await io.getDistance('Số hàng', { def: 4 });
      if (!r) return;
      const c = await io.getDistance('Số cột', { def: 3 });
      if (c) io.print(TABLE.run(ctx, { position: p, rows: r, cols: c }).message!);
    }
  },
};

// ---------- Ký hiệu ----------

const CENTERMARK: CommandDef = {
  name: 'CENTERMARK',
  aliases: ['CM'],
  desc: 'Dấu tâm cho đường tròn / cung: chữ thập ở tâm và đường tâm kéo ra ngoài',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các đường tròn / cung' },
    { name: 'size', type: 'number', desc: 'Nửa cạnh chữ thập (mặc định 0,1 × bán kính)' },
    { name: 'extension', type: 'number', desc: 'Phần kéo ra ngoài đường tròn (mặc định 0,1 × bán kính)' },
  ],
  run(ctx, args) {
    const out: Entity[] = [];
    for (const e of ids(ctx, args)) {
      if (e.type !== 'CIRCLE' && e.type !== 'ARC') continue;
      const s = num(args, 'size', e.r * 0.1);
      const ext = num(args, 'extension', e.r * 0.1);
      const L = { layer: e.layer };
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        out.push(ctx.doc.add({ type: 'LINE', a: [e.c[0] - dx * s, e.c[1] - dy * s], b: [e.c[0] + dx * s, e.c[1] + dy * s], ...L }));
        for (const sg of [1, -1]) {
          const a: Vec = [e.c[0] + sg * dx * s * 2, e.c[1] + sg * dy * s * 2];
          const b: Vec = [e.c[0] + sg * dx * (e.r + ext), e.c[1] + sg * dy * (e.r + ext)];
          if (dist(e.c, a) < dist(e.c, b)) out.push(ctx.doc.add({ type: 'LINE', a, b, ...L, lt: 'CENTER' }));
        }
      }
    }
    if (!out.length) throw new Error('Cần chọn đường tròn hoặc cung');
    return created(out);
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đường tròn / cung');
    ctx.selection.clear();
    if (s.length) CENTERMARK.run(ctx, { ids: s });
  },
};

const CENTERLINE: CommandDef = {
  name: 'CENTERLINE',
  aliases: ['CL'],
  desc: 'Đường tâm giữa hai đoạn thẳng (nét CENTER, kéo dài hai đầu)',
  params: [
    { name: 'id1', type: 'number', required: true, desc: 'Đoạn thẳng thứ nhất' },
    { name: 'id2', type: 'number', required: true, desc: 'Đoạn thẳng thứ hai' },
    { name: 'extension', type: 'number', desc: 'Phần kéo dài mỗi đầu (mặc định 5% chiều dài)' },
  ],
  run(ctx, args) {
    const a = ctx.doc.get(num(args, 'id1'));
    const b = ctx.doc.get(num(args, 'id2'));
    if (a?.type !== 'LINE' || b?.type !== 'LINE') throw new Error('Cần hai đoạn thẳng');
    // Ghép đầu mút gần nhau.
    const [b1, b2] = dist(a.a, b.a) + dist(a.b, b.b) <= dist(a.a, b.b) + dist(a.b, b.a) ? [b.a, b.b] : [b.b, b.a];
    const p = mid(a.a, b1);
    const q = mid(a.b, b2);
    const L = dist(p, q);
    if (L < 1e-9) throw new Error('Hai đoạn không xác định được đường tâm');
    const ext = num(args, 'extension', L * 0.05);
    const u: Vec = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    const e = ctx.doc.add({ type: 'LINE', a: sub(p, mul(u, ext)), b: add(q, mul(u, ext)), layer: ctx.doc.currentLayer, lt: 'CENTER' });
    return created([e]);
  },
  async interactive(ctx, io) {
    const a = await io.getEntity('Chọn đoạn thẳng thứ nhất');
    if (!a || typeof a === 'string') return;
    const b = await io.getEntity('Chọn đoạn thẳng thứ hai');
    if (b && typeof b !== 'string') CENTERLINE.run(ctx, { id1: a.id, id2: b.id });
  },
};

/** Ký hiệu đường ngắt: đoạn thẳng có chữ Z ở giữa. */
export function breaklinePts(a: Vec, b: Vec, size: number): Vec[] {
  const L = dist(a, b);
  const u: Vec = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: Vec = [-u[1], u[0]];
  const m = mid(a, b);
  const at = (t: number, k: number): Vec => add(add(m, mul(u, t * size)), mul(n, k * size));
  return [a, at(-0.5, 0), at(-0.25, 1), at(0.25, -1), at(0.5, 0), b];
}

const BREAKLINE: CommandDef = {
  name: 'BREAKLINE',
  aliases: ['BRL'],
  desc: 'Ký hiệu đường ngắt (đoạn thẳng có chữ Z ở giữa)',
  params: [
    { name: 'p1', type: 'point', required: true, desc: 'Điểm đầu' },
    { name: 'p2', type: 'point', required: true, desc: 'Điểm cuối' },
    { name: 'size', type: 'number', desc: 'Độ lớn ký hiệu (mặc định 1/10 chiều dài)' },
    ...COMMON,
  ],
  run(ctx, args) {
    const a = pt(args, 'p1');
    const b = pt(args, 'p2');
    const L = dist(a, b);
    if (L < 1e-9) throw new Error('Hai điểm trùng nhau');
    const size = num(args, 'size', L / 10);
    return created([ctx.doc.add({ type: 'LWPOLYLINE', pts: breaklinePts(a, b, size), closed: false, ...props(ctx, args) })]);
  },
  async interactive(ctx, io) {
    const a = await io.getPoint('Điểm đầu');
    if (!Array.isArray(a)) return;
    const b = await io.getPoint('Điểm cuối', {
      base: a as Vec,
      preview: (c) => (dist(c, a as Vec) > 1e-9 ? [{ type: 'LWPOLYLINE', pts: breaklinePts(a as Vec, c, dist(a as Vec, c) / 10), closed: false, layer: ctx.doc.currentLayer }] : []),
    });
    if (Array.isArray(b)) BREAKLINE.run(ctx, { p1: a, p2: b });
  },
};

const GOPY: CommandDef = {
  name: 'GOPY',
  aliases: ['GY'],
  desc: 'Góp ý: khoanh đám mây đỏ quanh chỗ cần sửa kèm lời ghi chú, đặt trên layer GOP-Y',
  params: [
    { name: 'corners', type: 'points', required: true, desc: 'Hai góc vùng góp ý' },
    { name: 'text', type: 'string', required: true, desc: 'Lời góp ý' },
    { name: 'height', type: 'number', desc: 'Chiều cao chữ (mặc định: theo kích thước vùng)' },
  ],
  run(ctx, args) {
    const [a, b] = pts(args, 'corners', 2);
    const w = Math.abs(b[0] - a[0]);
    const hh = Math.abs(b[1] - a[1]);
    if (w < 1e-9 || hh < 1e-9) throw new Error('Vùng góp ý phải có diện tích');
    if (!ctx.doc.layers.has('GOP-Y')) ctx.doc.ensureLayer('GOP-Y', 1);
    const arc = Math.max(Math.min(w, hh) / 6, 1e-6);
    const x0 = Math.min(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const cloud = ctx.doc.add({ type: 'LWPOLYLINE', pts: revcloudPts([[x0, Math.min(a[1], b[1])], [x0 + w, Math.min(a[1], b[1])], [x0 + w, y1], [x0, y1]], true, arc), closed: true, layer: 'GOP-Y' });
    const h = num(args, 'height', Math.max(Math.min(w, hh) / 8, 1e-6));
    const leader = leaderEnts([[x0 + w, y1], [x0 + w + h * 2, y1 + h * 2]], str(args, 'text'), h, 'GOP-Y').map((e) => ctx.doc.add(e));
    return created([cloud, ...leader], 'Đã thêm góp ý (layer GOP-Y)');
  },
  async interactive(ctx, io) {
    const a = await io.getPoint('Góc thứ nhất vùng góp ý');
    if (!Array.isArray(a)) return;
    const b = await io.getPoint('Góc đối diện', {
      base: a as Vec,
      preview: (c) => [{ type: 'LWPOLYLINE', pts: [a as Vec, [c[0], a[1]], c, [a[0], c[1]]], closed: true, layer: ctx.doc.currentLayer }],
    });
    if (!Array.isArray(b)) return;
    const t = io.getText ? await io.getText('Lời góp ý') : await io.getString('Lời góp ý', { spaces: true });
    if (t) io.print(GOPY.run(ctx, { corners: [a, b], text: t }).message!);
  },
};

export const ANNOT2_COMMANDS: CommandDef[] = [
  DIMBASELINE,
  DIMORDINATE,
  DIMARC,
  QDIM,
  DIMEDIT,
  DIMSPACE,
  MLEADER,
  TABLE,
  CENTERMARK,
  CENTERLINE,
  BREAKLINE,
  GOPY,
];
