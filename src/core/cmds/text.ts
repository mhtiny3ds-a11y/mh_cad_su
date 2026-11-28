// Công cụ chữ: DDEDIT, SCALETEXT, TCOUNT, TCASE, TORIENT, TXT2MTXT, JUSTIFYTEXT, TCIRCLE, TEXTMASK, TEXTUNMASK,
// TEXTTOFRONT, HATCHTOBACK, DRAWORDER.

import { type Vec, add, deg2rad, dist, mul, sub } from '../geom';
import { type Entity, type NewEntity, type TextEnt, bbox, textCorners } from '../entities';
import { type CommandDef, type Ctx, type IO, COMMON, created, ids, num, optStr, props, str } from '../commands';

type T = Extract<Entity, { type: 'TEXT' }>;

const textsOf = (ctx: Ctx, args: Record<string, unknown>): T[] => {
  const list = ids(ctx, args).filter((e): e is T => e.type === 'TEXT');
  if (!list.length) throw new Error('Không có đối tượng chữ (TEXT / MTEXT) nào trong danh sách');
  return list;
};

const pickTexts = async (ctx: Ctx, io: IO, msg = 'Chọn chữ'): Promise<number[]> => {
  const pre = [...ctx.selection];
  const s = pre.length ? pre : await io.getSelection(msg);
  ctx.selection.clear();
  return s.filter((id) => ctx.doc.get(id)?.type === 'TEXT');
};

const DDEDIT: CommandDef = {
  name: 'DDEDIT',
  aliases: ['ED', 'TEXTEDIT', 'TEDIT'],
  desc: 'Sửa nội dung chữ hoặc chữ ghi đè của kích thước',
  params: [
    { name: 'id', type: 'number', required: true, desc: 'Id đối tượng chữ / kích thước' },
    { name: 'text', type: 'string', required: true, desc: 'Nội dung mới (kích thước: "<>" là giá trị đo)' },
  ],
  run(ctx, args) {
    const e = ctx.doc.get(num(args, 'id'));
    if (!e || (e.type !== 'TEXT' && e.type !== 'DIMENSION')) throw new Error('Đối tượng không phải chữ hay kích thước');
    if (!ctx.doc.isEditable(e)) throw new Error('Đối tượng nằm trên layer khoá');
    const text = str(args, 'text', e.type === 'DIMENSION' ? '<>' : undefined);
    if (e.type === 'TEXT') ctx.doc.update({ ...e, text });
    else ctx.doc.update({ ...e, text: text === '<>' ? undefined : text });
    return { ids: [e.id], message: 'Đã sửa chữ' };
  },
  async interactive(ctx, io) {
    for (;;) {
      const p = await io.getEntity('Chọn chữ hoặc kích thước cần sửa (Enter để kết thúc)');
      if (!p || typeof p === 'string') return;
      const e = ctx.doc.get(p.id);
      if (!e || (e.type !== 'TEXT' && e.type !== 'DIMENSION')) {
        io.print('Đối tượng không phải chữ hay kích thước');
        continue;
      }
      const cur = e.type === 'TEXT' ? e.text : (e.text ?? '<>');
      const v =
        e.type === 'TEXT' && e.text.includes('\n') && io.getText
          ? await io.getText('Sửa chữ nhiều dòng', cur)
          : await io.getString('Nội dung mới', { def: cur, spaces: true });
      if (v === null) return;
      DDEDIT.run(ctx, { id: e.id, text: v });
    }
  },
};

const SCALETEXT: CommandDef = {
  name: 'SCALETEXT',
  desc: 'Đổi chiều cao chữ hàng loạt (giữ nguyên điểm chèn)',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các chữ' },
    { name: 'height', type: 'number', desc: 'Chiều cao mới' },
    { name: 'factor', type: 'number', desc: 'Hoặc: hệ số nhân chiều cao' },
  ],
  run(ctx, args) {
    const list = textsOf(ctx, args);
    const h = args.height == null ? undefined : num(args, 'height');
    const k = args.factor == null ? undefined : num(args, 'factor');
    if (h === undefined && k === undefined) throw new Error('Cần "height" hoặc "factor"');
    if ((h ?? 1) <= 0 || (k ?? 1) <= 0) throw new Error('Giá trị phải > 0');
    for (const e of list) ctx.doc.update({ ...e, h: h ?? e.h * k! });
    return { ids: list.map((e) => e.id), message: `Đã đổi chiều cao ${list.length} chữ` };
  },
  async interactive(ctx, io) {
    const s = await pickTexts(ctx, io);
    if (!s.length) return;
    const h = await io.getDistance('Chiều cao chữ mới', { def: (ctx.doc.get(s[0]) as T).h });
    if (h) io.print(SCALETEXT.run(ctx, { ids: s, height: h }).message!);
  },
};

/** Thứ tự đọc: từ trên xuống, trái sang phải. */
const readingOrder = (a: T, b: T) => (Math.abs(a.p[1] - b.p[1]) > Math.min(a.h, b.h) * 0.5 ? b.p[1] - a.p[1] : a.p[0] - b.p[0]);

const TCOUNT: CommandDef = {
  name: 'TCOUNT',
  desc: 'Đánh số thứ tự cho các chữ (theo thứ tự đọc: trên → dưới, trái → phải)',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các chữ' },
    { name: 'start', type: 'number', desc: 'Số bắt đầu (mặc định 1)' },
    { name: 'step', type: 'number', desc: 'Bước tăng (mặc định 1)' },
    { name: 'mode', type: 'string', desc: '"prefix" thêm trước, "suffix" thêm sau, "overwrite" thay cả chữ (mặc định prefix)' },
    { name: 'sep', type: 'string', desc: 'Ký tự ngăn cách (mặc định ". ")' },
    { name: 'sort', type: 'string', desc: '"y" theo thứ tự đọc (mặc định), "x" trái → phải, "select" giữ thứ tự chọn' },
  ],
  run(ctx, args) {
    let list = textsOf(ctx, args);
    const sort = optStr(args, 'sort') ?? 'y';
    if (sort === 'y') list = [...list].sort(readingOrder);
    else if (sort === 'x') list = [...list].sort((a, b) => a.p[0] - b.p[0] || b.p[1] - a.p[1]);
    const start = num(args, 'start', 1);
    const step = num(args, 'step', 1);
    const mode = optStr(args, 'mode') ?? 'prefix';
    const sep = optStr(args, 'sep') ?? '. ';
    list.forEach((e, i) => {
      const n = String(Math.round((start + i * step) * 1e6) / 1e6);
      const text = mode === 'overwrite' ? n : mode === 'suffix' ? `${e.text}${sep}${n}` : `${n}${sep}${e.text}`;
      ctx.doc.update({ ...e, text });
    });
    return { ids: list.map((e) => e.id), message: `Đã đánh số ${list.length} chữ` };
  },
  async interactive(ctx, io) {
    const s = await pickTexts(ctx, io);
    if (!s.length) return;
    const start = await io.getDistance('Số bắt đầu', { def: 1 });
    if (start === null) return;
    const mode = await io.getString('Cách ghi [prefix/suffix/overwrite]', { def: 'prefix' });
    if (mode === null) return;
    io.print(TCOUNT.run(ctx, { ids: s, start, mode: mode.toLowerCase() }).message!);
  },
};

const sentence = (s: string) => s.toLocaleLowerCase('vi').replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (m) => m.toLocaleUpperCase('vi'));
const title = (s: string) => s.toLocaleLowerCase('vi').replace(/(^|\s)(\p{L})/gu, (_m, a, b) => a + b.toLocaleUpperCase('vi'));
const toggle = (s: string) => [...s].map((c) => (c === c.toLocaleUpperCase('vi') ? c.toLocaleLowerCase('vi') : c.toLocaleUpperCase('vi'))).join('');

const TCASE: CommandDef = {
  name: 'TCASE',
  desc: 'Đổi chữ hoa / thường: upper, lower, sentence (viết hoa đầu câu), title (hoa đầu từ), toggle (đảo)',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các chữ' },
    { name: 'mode', type: 'string', required: true, desc: 'upper | lower | sentence | title | toggle' },
  ],
  run(ctx, args) {
    const mode = str(args, 'mode').toLowerCase();
    const f =
      mode === 'upper' ? (s: string) => s.toLocaleUpperCase('vi') : mode === 'lower' ? (s: string) => s.toLocaleLowerCase('vi') : mode === 'sentence' ? sentence : mode === 'title' ? title : mode === 'toggle' ? toggle : null;
    if (!f) throw new Error('mode phải là upper, lower, sentence, title hoặc toggle');
    const list = textsOf(ctx, args);
    for (const e of list) ctx.doc.update({ ...e, text: f(e.text) });
    return { ids: list.map((e) => e.id), message: `Đã đổi ${list.length} chữ` };
  },
  async interactive(ctx, io) {
    const s = await pickTexts(ctx, io);
    if (!s.length) return;
    const mode = await io.getString('Kiểu [upper/lower/sentence/title/toggle]', { def: 'upper' });
    if (mode) io.print(TCASE.run(ctx, { ids: s, mode }).message!);
  },
};

const TORIENT: CommandDef = {
  name: 'TORIENT',
  desc: 'Xoay chữ cho dễ đọc (chữ ngược / dốc quá 90° được lật lại, giữ nguyên tâm)',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Các chữ' }],
  run(ctx, args) {
    let n = 0;
    for (const e of textsOf(ctx, args)) {
      const r = ((e.rot % 360) + 360) % 360;
      if (r > 90 && r <= 270) {
        const c = textCorners(e);
        const ctr: Vec = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
        // Lật 180° quanh tâm khung chữ: điểm chèn đối xứng qua tâm, đảo căn trái/phải và trên/dưới.
        const ha = e.ha === 'L' || !e.ha ? 'R' : e.ha === 'R' ? 'L' : 'C';
        const va = e.va === 'T' ? 'B' : !e.va || e.va === 'B' ? 'T' : 'M';
        const p = sub(mul(ctr, 2), e.p);
        ctx.doc.update({ ...e, rot: (r + 180) % 360, p, ha, va });
        n++;
      }
    }
    return { message: `Đã lật ${n} chữ` };
  },
  async interactive(ctx, io) {
    const s = await pickTexts(ctx, io);
    if (s.length) io.print(TORIENT.run(ctx, { ids: s }).message!);
  },
};

const TXT2MTXT: CommandDef = {
  name: 'TXT2MTXT',
  aliases: ['T2M'],
  desc: 'Gộp nhiều dòng chữ thành một chữ nhiều dòng (theo thứ tự đọc)',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Các chữ' }],
  run(ctx, args) {
    const list = [...textsOf(ctx, args)].sort(readingOrder);
    const first = list[0];
    const top = Math.max(...list.map((e) => bbox(e).maxY));
    const left = Math.min(...list.map((e) => bbox(e).minX));
    for (const e of list) ctx.doc.remove(e.id);
    const { id: _id, ...base } = first;
    const m = ctx.doc.add({ ...base, p: [left, top], text: list.map((e) => e.text).join('\n'), rot: 0, ha: 'L', va: 'T' });
    return created([m], `Đã gộp ${list.length} dòng thành chữ nhiều dòng`);
  },
  async interactive(ctx, io) {
    const s = await pickTexts(ctx, io);
    if (s.length) io.print(TXT2MTXT.run(ctx, { ids: s }).message!);
  },
};

const JUSTIFYTEXT: CommandDef = {
  name: 'JUSTIFYTEXT',
  desc: 'Đổi điểm canh chữ (TL, TC, TR, ML, MC, MR, BL, BC, BR) mà chữ vẫn giữ nguyên chỗ',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các chữ' },
    { name: 'justify', type: 'string', required: true, desc: 'Hai ký tự: dọc (T/M/B) + ngang (L/C/R), ví dụ "MC"' },
  ],
  run(ctx, args) {
    const j = str(args, 'justify').toUpperCase();
    const va = j[0] as TextEnt['va'];
    const ha = (j[1] ?? 'L') as TextEnt['ha'];
    if (!['T', 'M', 'B'].includes(va!) || !['L', 'C', 'R'].includes(ha!)) throw new Error('justify phải là TL, TC, TR, ML, MC, MR, BL, BC hoặc BR');
    const list = textsOf(ctx, args);
    for (const e of list) {
      const c = textCorners(e); // [dưới trái, dưới phải, trên phải, trên trái]
      const fx = ha === 'L' ? 0 : ha === 'C' ? 0.5 : 1;
      const fy = va === 'B' ? 0 : va === 'M' ? 0.5 : 1;
      const along = sub(c[1], c[0]);
      const up = sub(c[3], c[0]);
      const p = add(c[0], add(mul(along, fx), mul(up, fy)));
      ctx.doc.update({ ...e, p, ha, va });
    }
    return { ids: list.map((e) => e.id), message: `Đã đổi điểm canh ${list.length} chữ thành ${j}` };
  },
  async interactive(ctx, io) {
    const s = await pickTexts(ctx, io);
    if (!s.length) return;
    const j = await io.getString('Điểm canh [TL/TC/TR/ML/MC/MR/BL/BC/BR]', { def: 'MC' });
    if (j) io.print(JUSTIFYTEXT.run(ctx, { ids: s, justify: j }).message!);
  },
};

/** Khung chữ nới rộng thêm off (theo hướng chữ). */
function textFrame(e: T, off: number): Vec[] {
  const c = textCorners(e);
  const r = deg2rad(e.rot);
  const al: Vec = [Math.cos(r) * off, Math.sin(r) * off];
  const up: Vec = [-Math.sin(r) * off, Math.cos(r) * off];
  return [sub(sub(c[0], al), up), sub(add(c[1], al), up), add(add(c[2], al), up), add(sub(c[3], al), up)];
}

const TCIRCLE: CommandDef = {
  name: 'TCIRCLE',
  desc: 'Bao chữ bằng đường tròn, khung chữ nhật hoặc khe (slot)',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các chữ' },
    { name: 'shape', type: 'string', desc: '"circle" (mặc định), "rect" hoặc "slot"' },
    { name: 'offset', type: 'number', desc: 'Khoảng hở, tính theo chiều cao chữ (mặc định 0,35)' },
    ...COMMON,
  ],
  run(ctx, args) {
    const shape = optStr(args, 'shape') ?? 'circle';
    const k = num(args, 'offset', 0.35);
    const out: Entity[] = [];
    for (const e of textsOf(ctx, args)) {
      const off = k * e.h;
      const pr = { ...props(ctx, args), layer: optStr(args, 'layer') ?? e.layer };
      if (shape === 'rect') out.push(ctx.doc.add({ type: 'LWPOLYLINE', pts: textFrame(e, off), closed: true, ...pr }));
      else if (shape === 'slot') {
        const f = textFrame(e, off);
        const r = dist(f[0], f[3]) / 2;
        const a = deg2rad(e.rot);
        const pts: Vec[] = [];
        const c1: Vec = [(f[0][0] + f[3][0]) / 2, (f[0][1] + f[3][1]) / 2];
        const c2: Vec = [(f[1][0] + f[2][0]) / 2, (f[1][1] + f[2][1]) / 2];
        for (let i = 0; i <= 12; i++) pts.push([c2[0] + r * Math.cos(a - Math.PI / 2 + (Math.PI * i) / 12), c2[1] + r * Math.sin(a - Math.PI / 2 + (Math.PI * i) / 12)]);
        for (let i = 0; i <= 12; i++) pts.push([c1[0] + r * Math.cos(a + Math.PI / 2 + (Math.PI * i) / 12), c1[1] + r * Math.sin(a + Math.PI / 2 + (Math.PI * i) / 12)]);
        out.push(ctx.doc.add({ type: 'LWPOLYLINE', pts, closed: true, ...pr }));
      } else {
        const c = textCorners(e);
        const ctr: Vec = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
        out.push(ctx.doc.add({ type: 'CIRCLE', c: ctr, r: dist(c[0], c[2]) / 2 + off, ...pr }));
      }
    }
    return created(out, `Đã bao ${out.length} chữ`);
  },
  async interactive(ctx, io) {
    const s = await pickTexts(ctx, io);
    if (!s.length) return;
    const shape = await io.getString('Hình bao [circle/rect/slot]', { def: 'circle' });
    if (shape) io.print(TCIRCLE.run(ctx, { ids: s, shape: shape.toLowerCase() }).message!);
  },
};

const TEXTMASK: CommandDef = {
  name: 'TEXTMASK',
  desc: 'Che nền dưới chữ bằng vùng che (WIPEOUT) để chữ nổi trên hatch / nét vẽ',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các chữ' },
    { name: 'offset', type: 'number', desc: 'Khoảng nới quanh chữ, tính theo chiều cao chữ (mặc định 0,25)' },
  ],
  run(ctx, args) {
    const k = num(args, 'offset', 0.25);
    const list = textsOf(ctx, args);
    const masks = list.map((e) => ctx.doc.add({ type: 'LWPOLYLINE', pts: textFrame(e, k * e.h), closed: true, wipe: true, layer: e.layer }));
    // Thứ tự vẽ: vùng che lên trên mọi thứ, rồi chữ lên trên vùng che.
    ctx.doc.drawOrder(masks.map((m) => m.id), 'front');
    ctx.doc.drawOrder(list.map((e) => e.id), 'front');
    ctx.doc.setVar('TEXTMASKS', { ...ctx.doc.getVar<Record<string, number>>('TEXTMASKS', {}), ...Object.fromEntries(list.map((e, i) => [e.id, masks[i].id])) });
    return created(masks, `Đã che nền ${list.length} chữ`);
  },
  async interactive(ctx, io) {
    const s = await pickTexts(ctx, io);
    if (s.length) io.print(TEXTMASK.run(ctx, { ids: s }).message!);
  },
};

const TEXTUNMASK: CommandDef = {
  name: 'TEXTUNMASK',
  desc: 'Bỏ vùng che nền đã tạo bằng TEXTMASK',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Các chữ' }],
  run(ctx, args) {
    const map = { ...ctx.doc.getVar<Record<string, number>>('TEXTMASKS', {}) };
    let n = 0;
    for (const e of textsOf(ctx, args)) {
      const m = map[e.id];
      if (m !== undefined && ctx.doc.get(m)) {
        ctx.doc.remove(m);
        n++;
      }
      delete map[e.id];
    }
    ctx.doc.setVar('TEXTMASKS', map);
    return { message: `Đã bỏ che nền ${n} chữ` };
  },
  async interactive(ctx, io) {
    const s = await pickTexts(ctx, io);
    if (s.length) io.print(TEXTUNMASK.run(ctx, { ids: s }).message!);
  },
};

// ---------- Thứ tự vẽ ----------

const DRAWORDER: CommandDef = {
  name: 'DRAWORDER',
  aliases: ['DR'],
  desc: 'Đưa đối tượng lên trên cùng (front) hoặc xuống dưới cùng (back)',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng' },
    { name: 'where', type: 'string', desc: '"front" (mặc định) hoặc "back"' },
  ],
  run(ctx, args) {
    const list = ids(ctx, args);
    const where = (optStr(args, 'where') ?? 'front').toLowerCase() === 'back' ? 'back' : 'front';
    ctx.doc.drawOrder(list.map((e) => e.id), where);
    return { message: `Đã đưa ${list.length} đối tượng ${where === 'front' ? 'lên trên' : 'xuống dưới'}` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng');
    if (!s.length) return;
    const w = await io.getString('[Front/Back]', { def: 'Front' });
    if (w) io.print(DRAWORDER.run(ctx, { ids: s, where: w.toLowerCase().startsWith('b') ? 'back' : 'front' }).message!);
  },
};

const typeOrder = (name: string, aliases: string[], desc: string, pick: (e: Entity) => boolean, where: 'front' | 'back'): CommandDef => ({
  name,
  aliases,
  desc,
  params: [],
  run(ctx) {
    const list = ctx.doc.all().filter(pick);
    ctx.doc.drawOrder(list.map((e) => e.id), where);
    return { message: `Đã đưa ${list.length} đối tượng ${where === 'front' ? 'lên trên' : 'xuống dưới'}` };
  },
});

const TEXTTOFRONT = typeOrder('TEXTTOFRONT', [], 'Đưa mọi chữ và kích thước lên trên cùng', (e) => e.type === 'TEXT' || e.type === 'DIMENSION', 'front');
const HATCHTOBACK = typeOrder('HATCHTOBACK', [], 'Đưa mọi vùng tô (HATCH) xuống dưới cùng', (e) => e.type === 'HATCH', 'back');

// ---------- WIPEOUT ----------

const WIPEOUT: CommandDef = {
  name: 'WIPEOUT',
  aliases: ['WO'],
  desc: 'Vùng che: đa giác tô màu nền, che các đối tượng vẽ trước nó',
  params: [
    { name: 'points', type: 'points', desc: 'Các đỉnh đa giác che' },
    { name: 'ids', type: 'ids', desc: 'Hoặc: đa tuyến kín dùng làm biên (giữ nguyên đa tuyến)' },
    { name: 'frames', type: 'boolean', desc: 'Chỉ đổi chế độ hiện khung vùng che (true / false), không tạo mới' },
    ...COMMON,
  ],
  run(ctx, args) {
    if (args.frames !== undefined) {
      ctx.doc.setVar('WIPEOUTFRAME', args.frames ? 1 : 0);
      return { message: `Khung vùng che: ${args.frames ? 'hiện' : 'ẩn'}` };
    }
    let loops: Vec[][];
    if (Array.isArray(args.ids))
      loops = ids(ctx, args).map((e) => {
        if (e.type !== 'LWPOLYLINE' || !e.closed) throw new Error(`#${e.id} không phải đa tuyến kín`);
        return e.pts;
      });
    else if (Array.isArray(args.points)) loops = [(args.points as unknown[]).map((p) => p as Vec)];
    else throw new Error('Cần "points" hoặc "ids"');
    const out = loops.map((pts) => {
      if (pts.length < 3) throw new Error('Vùng che cần ít nhất 3 đỉnh');
      return ctx.doc.add({ type: 'LWPOLYLINE', pts, closed: true, wipe: true, ...props(ctx, args) } as NewEntity);
    });
    return created(out);
  },
  async interactive(ctx, io) {
    const pts: Vec[] = [];
    for (;;) {
      const p = await io.getPoint(pts.length ? 'Điểm tiếp theo (Enter để khép kín)' : 'Điểm đầu', {
        base: pts[pts.length - 1],
        allowNone: pts.length >= 3,
        keywords: pts.length ? [] : ['Polyline', 'Frames'],
        preview: (c) => (pts.length ? [{ type: 'LWPOLYLINE', pts: [...pts, c], closed: true, layer: ctx.doc.currentLayer }] : []),
      });
      if (p === 'Frames') {
        const v = await io.getString('Hiện khung [On/Off]', { def: 'On' });
        if (v) io.print(WIPEOUT.run(ctx, { frames: v.toLowerCase() === 'on' }).message!);
        return;
      }
      if (p === 'Polyline') {
        const s = await io.getSelection('Chọn đa tuyến kín');
        if (s.length) WIPEOUT.run(ctx, { ids: s });
        ctx.selection.clear();
        return;
      }
      if (!Array.isArray(p)) break;
      pts.push(p as Vec);
    }
    if (pts.length >= 3) WIPEOUT.run(ctx, { points: pts });
  },
};

export const TEXT_COMMANDS: CommandDef[] = [
  DDEDIT,
  SCALETEXT,
  TCOUNT,
  TCASE,
  TORIENT,
  TXT2MTXT,
  JUSTIFYTEXT,
  TCIRCLE,
  TEXTMASK,
  TEXTUNMASK,
  DRAWORDER,
  TEXTTOFRONT,
  HATCHTOBACK,
  WIPEOUT,
];
