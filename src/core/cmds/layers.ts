// Công cụ layer (LAYOFF, LAYISO, LAYMCUR…) và chọn đối tượng (SELECTALL, QSELECT, SELECTSIMILAR, ẩn / cô lập).

import type { Entity, EntityType } from '../entities';
import { ENTITY_TYPES } from '../entities';
import { type Args, type CommandDef, type Ctx, type IO, bool, ids, optStr, str } from '../commands';

/** Lấy đối tượng theo id, kể cả trên layer đang khoá (dùng cho lệnh chỉ đọc layer của đối tượng). */
function anyIds(ctx: Ctx, args: Args): Entity[] {
  const v = args.ids;
  if (!Array.isArray(v) || !v.length) throw new Error('Cần "ids": danh sách id đối tượng');
  return v.map((x) => {
    const e = ctx.doc.get(Number(x));
    if (!e) throw new Error(`Không có đối tượng #${x}`);
    return e;
  });
}

const layersOf = (ents: Entity[]) => [...new Set(ents.map((e) => e.layer))];

/** Lệnh dạng "chọn đối tượng → làm gì đó với layer của chúng". */
function layerPickCmd(
  name: string,
  aliases: string[],
  desc: string,
  apply: (ctx: Ctx, layers: string[], ents: Entity[]) => string,
  opts: { single?: boolean; repeat?: boolean } = {},
): CommandDef {
  const def: CommandDef = {
    name,
    aliases,
    desc,
    params: [{ name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng (lấy layer của chúng)' }],
    run(ctx, args) {
      const ents = anyIds(ctx, args);
      return { message: apply(ctx, layersOf(ents), ents) };
    },
    async interactive(ctx, io) {
      for (;;) {
        const pre = [...ctx.selection];
        const s = pre.length ? pre : await io.getSelection('Chọn đối tượng', { single: opts.single || opts.repeat });
        if (!s.length) return;
        ctx.selection.clear();
        try {
          io.print(def.run(ctx, { ids: s }).message!);
        } catch (err) {
          io.print((err as Error).message);
        }
        if (!opts.repeat || pre.length) return;
      }
    },
  };
  return def;
}

function setLayers(ctx: Ctx, layers: string[], patch: { visible?: boolean; locked?: boolean }): string[] {
  const done: string[] = [];
  for (const l of layers) {
    if (patch.visible === false && l === ctx.doc.currentLayer) continue;
    ctx.doc.setLayer(l, patch);
    done.push(l);
  }
  return done;
}

const LAYOFF = layerPickCmd(
  'LAYOFF',
  [],
  'Tắt layer của đối tượng bấm vào (không tắt layer hiện hành)',
  (ctx, layers) => {
    const d = setLayers(ctx, layers, { visible: false });
    return d.length ? `Đã tắt layer ${d.join(', ')}` : 'Không tắt được layer hiện hành';
  },
  { repeat: true },
);

const LAYFRZ = layerPickCmd(
  'LAYFRZ',
  [],
  'Đóng băng (ẩn) layer của đối tượng bấm vào',
  (ctx, layers) => {
    const d = setLayers(ctx, layers, { visible: false });
    return d.length ? `Đã đóng băng layer ${d.join(', ')}` : 'Không đóng băng được layer hiện hành';
  },
  { repeat: true },
);

const LAYLCK = layerPickCmd('LAYLCK', [], 'Khoá layer của đối tượng', (ctx, layers) => `Đã khoá layer ${setLayers(ctx, layers, { locked: true }).join(', ')}`, {
  single: true,
});

const LAYULK = layerPickCmd('LAYULK', [], 'Mở khoá layer của đối tượng', (ctx, layers) => `Đã mở khoá layer ${setLayers(ctx, layers, { locked: false }).join(', ')}`, {
  single: true,
});

const LAYMCUR = layerPickCmd(
  'LAYMCUR',
  [],
  'Đặt layer của đối tượng làm layer hiện hành',
  (ctx, layers) => {
    ctx.doc.setCurrentLayer(layers[0]);
    if (ctx.doc.layers.get(layers[0])?.visible === false) ctx.doc.setLayer(layers[0], { visible: true });
    return `Layer hiện hành: ${layers[0]}`;
  },
  { single: true },
);

const LAYCUR: CommandDef = {
  name: 'LAYCUR',
  desc: 'Chuyển các đối tượng sang layer hiện hành',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng' }],
  run(ctx, args) {
    const list = ids(ctx, args);
    for (const e of list) if (e.layer !== ctx.doc.currentLayer) ctx.doc.update({ ...e, layer: ctx.doc.currentLayer });
    return { ids: list.map((e) => e.id), message: `Đã chuyển ${list.length} đối tượng sang layer ${ctx.doc.currentLayer}` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng');
    if (s.length) io.print(LAYCUR.run(ctx, { ids: s }).message!);
  },
};

const LAYON: CommandDef = {
  name: 'LAYON',
  aliases: ['LAYTHW'],
  desc: 'Bật (và làm tan) mọi layer',
  params: [],
  run(ctx) {
    let n = 0;
    for (const l of ctx.doc.layers.values())
      if (!l.visible) {
        ctx.doc.setLayer(l.name, { visible: true });
        n++;
      }
    return { message: `Đã bật ${n} layer` };
  },
};

const LAYISO: CommandDef = {
  name: 'LAYISO',
  desc: 'Cô lập: chỉ giữ layer của các đối tượng chọn, tắt mọi layer khác (LAYUNISO để trả lại)',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng' },
    { name: 'lock', type: 'boolean', desc: 'Khoá các layer khác thay vì tắt' },
  ],
  run(ctx, args) {
    const keep = new Set(layersOf(anyIds(ctx, args)));
    const lock = bool(args, 'lock', false);
    const prev: Record<string, { visible: boolean; locked: boolean }> = {};
    for (const l of ctx.doc.layers.values()) {
      prev[l.name] = { visible: l.visible, locked: l.locked };
      if (keep.has(l.name)) {
        if (!l.visible || l.locked) ctx.doc.setLayer(l.name, { visible: true, locked: false });
      } else if (lock) ctx.doc.setLayer(l.name, { locked: true });
      else if (l.visible) ctx.doc.setLayer(l.name, { visible: false });
    }
    if (!keep.has(ctx.doc.currentLayer)) ctx.doc.setCurrentLayer([...keep][0]);
    ctx.doc.setVar('LAYISO_PREV', prev);
    return { message: `Đã cô lập layer ${[...keep].join(', ')}` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng trên layer cần cô lập');
    ctx.selection.clear();
    if (s.length) io.print(LAYISO.run(ctx, { ids: s }).message!);
  },
};

const LAYUNISO: CommandDef = {
  name: 'LAYUNISO',
  desc: 'Trả lại trạng thái layer trước lần LAYISO gần nhất',
  params: [],
  run(ctx) {
    const prev = ctx.doc.getVar<Record<string, { visible: boolean; locked: boolean }> | undefined>('LAYISO_PREV', undefined);
    if (!prev) throw new Error('Chưa cô lập layer nào (LAYISO)');
    for (const [name, st] of Object.entries(prev)) {
      const l = ctx.doc.layers.get(name);
      if (l && (l.visible !== st.visible || l.locked !== st.locked)) ctx.doc.setLayer(name, st);
    }
    ctx.doc.setVar('LAYISO_PREV', undefined);
    return { message: 'Đã trả lại trạng thái layer' };
  },
};

const LAYMCH: CommandDef = {
  name: 'LAYMCH',
  desc: 'Đổi các đối tượng sang layer của đối tượng mẫu (hoặc layer gõ tên)',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng cần đổi' },
    { name: 'target', type: 'number', desc: 'Id đối tượng mẫu' },
    { name: 'layer', type: 'string', desc: 'Hoặc: tên layer đích' },
  ],
  run(ctx, args) {
    const to = args.target !== undefined ? ctx.doc.get(Number(args.target))?.layer : optStr(args, 'layer');
    if (!to) throw new Error('Cần "target" (id đối tượng mẫu) hoặc "layer"');
    if (!ctx.doc.layers.has(to)) ctx.doc.ensureLayer(to);
    const list = ids(ctx, args);
    for (const e of list) if (e.layer !== to) ctx.doc.update({ ...e, layer: to });
    return { ids: list.map((e) => e.id), message: `Đã chuyển ${list.length} đối tượng sang layer ${to}` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng cần đổi layer');
    if (!s.length) return;
    const t = await io.getEntity('Chọn đối tượng mẫu', { keywords: ['Name'] });
    if (t === 'Name') {
      const layer = await io.getString('Tên layer đích', { spaces: true });
      if (layer) io.print(LAYMCH.run(ctx, { ids: s, layer }).message!);
    } else if (t && typeof t !== 'string') io.print(LAYMCH.run(ctx, { ids: s, target: t.id }).message!);
    ctx.selection.clear();
  },
};

const COPYTOLAYER: CommandDef = {
  name: 'COPYTOLAYER',
  desc: 'Chép đối tượng sang layer khác (bản gốc giữ nguyên)',
  params: [
    { name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng' },
    { name: 'layer', type: 'string', required: true, desc: 'Layer đích (tự tạo nếu chưa có)' },
  ],
  run(ctx, args) {
    const to = str(args, 'layer');
    ctx.doc.ensureLayer(to);
    const out = ids(ctx, args).map((e) => {
      const { id: _id, ...rest } = e;
      return ctx.doc.add({ ...rest, layer: to } as Parameters<typeof ctx.doc.add>[0]);
    });
    return { ids: out.map((e) => e.id), message: `Đã chép ${out.length} đối tượng sang layer ${to}` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng cần chép');
    if (!s.length) return;
    const layer = await io.getString('Layer đích', { spaces: true });
    if (layer) io.print(COPYTOLAYER.run(ctx, { ids: s, layer }).message!);
  },
};

const LAYMRG: CommandDef = {
  name: 'LAYMRG',
  desc: 'Gộp layer: chuyển mọi đối tượng của các layer nguồn sang layer đích rồi xoá layer nguồn',
  params: [
    { name: 'from', type: 'string', required: true, desc: 'Tên layer nguồn (nhiều layer: mảng tên)' },
    { name: 'to', type: 'string', required: true, desc: 'Layer đích' },
  ],
  run(ctx, args) {
    const to = str(args, 'to');
    const from = (Array.isArray(args.from) ? args.from.map(String) : [str(args, 'from')]).filter((n) => n !== to);
    if (!ctx.doc.layers.has(to)) ctx.doc.ensureLayer(to);
    let n = 0;
    for (const name of from) {
      if (!ctx.doc.layers.has(name)) throw new Error(`Không có layer "${name}"`);
      if (name === '0') throw new Error('Không gộp được layer 0');
      for (const e of ctx.doc.all())
        if (e.layer === name) {
          ctx.doc.update({ ...e, layer: to });
          n++;
        }
      if (ctx.doc.currentLayer === name) ctx.doc.setCurrentLayer(to);
      ctx.doc.removeLayer(name);
    }
    return { message: `Đã gộp ${from.length} layer vào ${to} (${n} đối tượng)` };
  },
  async interactive(ctx, io) {
    const from = await io.getString('Layer nguồn (cách nhau bằng dấu phẩy)', { spaces: true });
    if (!from) return;
    const to = await io.getString('Layer đích', { spaces: true });
    if (to) io.print(LAYMRG.run(ctx, { from: from.split(',').map((x) => x.trim()).filter(Boolean), to }).message!);
  },
};

// ---------- Chọn đối tượng ----------

const SELECTALL: CommandDef = {
  name: 'SELECTALL',
  aliases: ['AI_SELALL'],
  desc: 'Chọn mọi đối tượng đang hiện và sửa được',
  params: [],
  readonly: true,
  run(ctx) {
    ctx.selection.clear();
    for (const e of ctx.doc.visible()) if (ctx.doc.isEditable(e)) ctx.selection.add(e.id);
    return { ids: [...ctx.selection], message: `Đã chọn ${ctx.selection.size} đối tượng` };
  },
};

const QSELECT: CommandDef = {
  name: 'QSELECT',
  aliases: ['FILTER', '-QSELECT'],
  desc: 'Chọn nhanh theo loại, layer, màu, tên block (các điều kiện cùng thoả)',
  params: [
    { name: 'type', type: 'string', desc: `Loại đối tượng (${ENTITY_TYPES.join(', ')}); nhiều loại cách nhau dấu phẩy` },
    { name: 'layer', type: 'string', desc: 'Tên layer (dùng * ? làm ký tự đại diện)' },
    { name: 'color', type: 'number', desc: 'Màu ACI (256 = theo layer)' },
    { name: 'block', type: 'string', desc: 'Tên block (cho INSERT; dùng * ?)' },
    { name: 'text', type: 'string', desc: 'Chữ chứa chuỗi này (cho TEXT)' },
    { name: 'add', type: 'boolean', desc: 'Thêm vào lựa chọn hiện có thay vì thay thế' },
  ],
  readonly: true,
  run(ctx, args) {
    const types = optStr(args, 'type')
      ?.toUpperCase()
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((t) => (t === 'PLINE' || t === 'POLYLINE' ? 'LWPOLYLINE' : t === 'MTEXT' ? 'TEXT' : t === 'DIM' ? 'DIMENSION' : t === 'BLOCK' ? 'INSERT' : t)) as EntityType[] | undefined;
    const lay = optStr(args, 'layer');
    const blk = optStr(args, 'block');
    const txt = optStr(args, 'text')?.toLowerCase();
    const color = args.color == null ? undefined : Number(args.color);
    const lre = lay ? wild(lay) : null;
    const bre = blk ? wild(blk) : null;
    const hits = ctx.doc.visible().filter(
      (e) =>
        (!types || types.includes(e.type)) &&
        (!lre || lre.test(e.layer)) &&
        (color === undefined || (color === 256 ? e.color === undefined : e.color === color)) &&
        (!bre || (e.type === 'INSERT' && bre.test(e.name))) &&
        (!txt || (e.type === 'TEXT' && e.text.toLowerCase().includes(txt))),
    );
    if (!bool(args, 'add', false)) ctx.selection.clear();
    for (const e of hits) ctx.selection.add(e.id);
    return { ids: hits.map((e) => e.id), message: `Đã chọn ${hits.length} đối tượng` };
  },
  async interactive(ctx, io) {
    const type = await io.getString('Loại đối tượng (Enter = mọi loại)', { def: '' });
    if (type === null) return;
    const layer = await io.getString('Layer (Enter = mọi layer, dùng * ?)', { def: '', spaces: true });
    if (layer === null) return;
    io.print(QSELECT.run(ctx, { ...(type ? { type } : {}), ...(layer ? { layer } : {}) }).message!);
  },
};

/** Mẫu * ? (không phân biệt hoa thường) → RegExp. */
export function wild(p: string): RegExp {
  return new RegExp(`^(?:${p.split(',').map((x) => x.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')).join('|')})$`, 'i');
}

const SELECTSIMILAR: CommandDef = {
  name: 'SELECTSIMILAR',
  aliases: ['SS'],
  desc: 'Chọn mọi đối tượng giống đối tượng mẫu (cùng loại, cùng layer; block cùng tên)',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Đối tượng mẫu' }],
  readonly: true,
  run(ctx, args) {
    const refs = anyIds(ctx, args);
    const key = (e: Entity) => `${e.type}|${e.layer}|${e.type === 'INSERT' ? e.name : ''}`;
    const want = new Set(refs.map(key));
    ctx.selection.clear();
    for (const e of ctx.doc.visible()) if (want.has(key(e))) ctx.selection.add(e.id);
    return { ids: [...ctx.selection], message: `Đã chọn ${ctx.selection.size} đối tượng giống mẫu` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng mẫu');
    if (s.length) io.print(SELECTSIMILAR.run(ctx, { ids: s }).message!);
  },
};

const pickOrSel = async (ctx: Ctx, io: IO, msg: string) => (ctx.selection.size ? [...ctx.selection] : await io.getSelection(msg));

const HIDEOBJECTS: CommandDef = {
  name: 'HIDEOBJECTS',
  aliases: ['HIDE'],
  desc: 'Ẩn tạm các đối tượng (UNISOLATEOBJECTS để hiện lại)',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng cần ẩn' }],
  run(ctx, args) {
    const list = anyIds(ctx, args).map((e) => e.id);
    const cur = ctx.doc.getVar<number[]>('_HIDDEN', []);
    ctx.doc.setVar('_HIDDEN', [...new Set([...cur, ...list])]);
    ctx.selection.clear();
    return { message: `Đã ẩn ${list.length} đối tượng` };
  },
  async interactive(ctx, io) {
    const s = await pickOrSel(ctx, io, 'Chọn đối tượng cần ẩn');
    if (s.length) io.print(HIDEOBJECTS.run(ctx, { ids: s }).message!);
  },
};

const ISOLATEOBJECTS: CommandDef = {
  name: 'ISOLATEOBJECTS',
  aliases: ['ISOLATE'],
  desc: 'Chỉ hiện các đối tượng chọn, ẩn tạm mọi đối tượng khác',
  params: [{ name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng giữ lại' }],
  run(ctx, args) {
    const keep = new Set(anyIds(ctx, args).map((e) => e.id));
    const hide = ctx.doc.all().filter((e) => !keep.has(e.id)).map((e) => e.id);
    ctx.doc.setVar('_HIDDEN', hide);
    ctx.selection.clear();
    return { message: `Đã cô lập ${keep.size} đối tượng` };
  },
  async interactive(ctx, io) {
    const s = await pickOrSel(ctx, io, 'Chọn đối tượng cần cô lập');
    if (s.length) io.print(ISOLATEOBJECTS.run(ctx, { ids: s }).message!);
  },
};

const UNISOLATEOBJECTS: CommandDef = {
  name: 'UNISOLATEOBJECTS',
  aliases: ['UNISOLATE', 'UNHIDE'],
  desc: 'Hiện lại các đối tượng đã ẩn / cô lập',
  params: [],
  run(ctx) {
    const n = ctx.doc.getVar<number[]>('_HIDDEN', []).length;
    ctx.doc.setVar('_HIDDEN', undefined);
    return { message: n ? `Đã hiện lại ${n} đối tượng` : 'Không có đối tượng nào đang ẩn' };
  },
};

/** Đếm theo layer (cho STATUS / bảng layer). */
export function countByLayer(ents: Entity[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of ents) m.set(e.layer, (m.get(e.layer) ?? 0) + 1);
  return m;
}

export const LAYER_COMMANDS: CommandDef[] = [
  LAYOFF,
  LAYFRZ,
  LAYLCK,
  LAYULK,
  LAYMCUR,
  LAYCUR,
  LAYON,
  LAYISO,
  LAYUNISO,
  LAYMCH,
  COPYTOLAYER,
  LAYMRG,
  SELECTALL,
  QSELECT,
  SELECTSIMILAR,
  HIDEOBJECTS,
  ISOLATEOBJECTS,
  UNISOLATEOBJECTS,
];
