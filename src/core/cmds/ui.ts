// Lệnh cần giao diện (tệp, in, bộ nhớ tạm, hoàn tác nhiều bước, bật/tắt chế độ). Lõi chỉ kiểm tham số rồi
// chuyển cho giao diện qua ctx.ui; chạy ngoài giao diện (kiểm thử, Node) sẽ báo lỗi rõ ràng.

import type { DrawingData } from '../document';
import { type BlockDef, type NewEntity, bbox, moveEnt } from '../entities';
import type { Vec } from '../geom';
import { writeDxf } from '../dxf';
import { type Args, type CommandDef, type Ctx, ids, optStr, pt } from '../commands';

function ui(ctx: Ctx, action: string, args: Args = {}): Record<string, unknown> {
  if (!ctx.ui) throw new Error('Lệnh này chỉ dùng trên giao diện MHCAD');
  return ctx.ui(action, args) ?? {};
}

const uiCmd = (name: string, aliases: string[], desc: string, action = name.toLowerCase(), params: CommandDef['params'] = []): CommandDef => ({
  name,
  aliases,
  desc,
  params,
  readonly: true,
  run(ctx, args) {
    return { message: '', ...ui(ctx, action, args) };
  },
});

/** Dữ liệu bản vẽ chỉ gồm các đối tượng chọn (kèm layer và block cần thiết) — dùng cho WBLOCK. */
export function extractData(ctx: Ctx, entIds: number[]): DrawingData {
  const full = ctx.doc.toData();
  const ents: NewEntity[] = entIds.map((id) => {
    const e = ctx.doc.get(id);
    if (!e) throw new Error(`Không có đối tượng #${id}`);
    const { id: _id, ...rest } = e;
    return rest as NewEntity;
  });
  const blocks = new Set<string>();
  const visit = (list: readonly NewEntity[]) => {
    for (const e of list)
      if (e.type === 'INSERT' && !blocks.has(e.name)) {
        blocks.add(e.name);
        const b = ctx.doc.blocks.get(e.name);
        if (b) visit(b.ents);
      }
  };
  visit(ents);
  const layers = new Set(['0', ...ents.map((e) => e.layer)]);
  for (const n of blocks) for (const e of ctx.doc.blocks.get(n)?.ents ?? []) layers.add(e.layer);
  return {
    ...full,
    currentLayer: '0',
    layers: full.layers.filter((l) => layers.has(l.name)),
    blocks: (full.blocks ?? []).filter((b) => blocks.has(b.name)),
    entities: ents,
  };
}

/** Dữ liệu bộ nhớ tạm (JSON): đối tượng, block cần thiết, điểm gốc. */
export function clipData(ctx: Ctx, entIds: number[], base?: Vec): string {
  const d = extractData(ctx, entIds);
  let b = base;
  if (!b) {
    const bb = d.entities.map(bbox).reduce((a, x) => ({ minX: Math.min(a.minX, x.minX), minY: Math.min(a.minY, x.minY), maxX: 0, maxY: 0 }));
    b = [bb.minX, bb.minY];
  }
  return JSON.stringify({ base: b, ents: d.entities, blocks: d.blocks ?? [] });
}

function clipCmd(name: string, aliases: string[], desc: string, cut: boolean, withBase: boolean): CommandDef {
  const def: CommandDef = {
    name,
    aliases,
    desc,
    params: [
      { name: 'ids', type: 'ids', required: true, desc: 'Các đối tượng' },
      ...(withBase ? [{ name: 'base', type: 'point' as const, required: true, desc: 'Điểm gốc khi dán' }] : []),
    ],
    readonly: !cut,
    run(ctx, args) {
      const list = ids(ctx, args);
      const data = clipData(ctx, list.map((e) => e.id), args.base !== undefined ? pt(args, 'base') : undefined);
      ui(ctx, 'clip', { data });
      if (cut) for (const e of list) ctx.doc.remove(e.id);
      ctx.selection.clear();
      return { data, message: `Đã ${cut ? 'cắt' : 'chép'} ${list.length} đối tượng vào bộ nhớ tạm (Ctrl+V để dán)` };
    },
    async interactive(ctx, io) {
      const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng');
      if (!s.length) return;
      let base: Vec | undefined;
      if (withBase) {
        const p = await io.getPoint('Điểm gốc');
        if (!Array.isArray(p)) return;
        base = p as Vec;
      }
      io.print(def.run(ctx, { ids: s, ...(base ? { base } : {}) }).message!);
    },
  };
  return def;
}

const readClip = (ctx: Ctx, args: Args): { base: Vec; ents: NewEntity[]; blocks: BlockDef[] } => {
  const raw = args.data !== undefined ? args.data : ui(ctx, 'getclip').data;
  const d = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { base: Vec; ents: NewEntity[]; blocks?: BlockDef[] } | undefined;
  if (!d || !Array.isArray(d.ents) || !d.ents.length) throw new Error('Bộ nhớ tạm trống');
  return { base: d.base ?? [0, 0], ents: d.ents, blocks: d.blocks ?? [] };
};

const PASTEBLOCK: CommandDef = {
  name: 'PASTEBLOCK',
  desc: 'Dán nội dung bộ nhớ tạm thành một block (Ctrl+Shift+V)',
  params: [
    { name: 'to', type: 'point', required: true, desc: 'Điểm chèn' },
    { name: 'data', type: 'string', desc: 'Dữ liệu bộ nhớ tạm (mặc định: bộ nhớ tạm của MHCAD)' },
  ],
  run(ctx, args) {
    const d = readClip(ctx, args);
    for (const b of d.blocks) if (!ctx.doc.blocks.has(b.name)) ctx.doc.setBlock(b);
    let n = 1;
    while (ctx.doc.blocks.has(`A$C${n}`)) n++;
    const name = `A$C${n}`;
    ctx.doc.setBlock({ name, base: d.base, ents: d.ents });
    const e = ctx.doc.add({ type: 'INSERT', name, p: pt(args, 'to'), sx: 1, sy: 1, rot: 0, layer: ctx.doc.currentLayer });
    return { ids: [e.id], message: `Đã dán thành block ${name}` };
  },
  async interactive(ctx, io) {
    const d = readClip(ctx, {});
    const to = await io.getPoint('Điểm chèn', { preview: (c) => d.ents.map((e) => moveEnt(e, [c[0] - d.base[0], c[1] - d.base[1]])) });
    if (Array.isArray(to)) io.print(PASTEBLOCK.run(ctx, { to }).message!);
  },
};

const PASTEORIG: CommandDef = {
  name: 'PASTEORIG',
  desc: 'Dán đúng toạ độ gốc (dùng để chép giữa các tab bản vẽ)',
  params: [{ name: 'data', type: 'string', desc: 'Dữ liệu bộ nhớ tạm (mặc định: bộ nhớ tạm của MHCAD)' }],
  run(ctx, args) {
    const d = readClip(ctx, args);
    for (const b of d.blocks) if (!ctx.doc.blocks.has(b.name)) ctx.doc.setBlock(b);
    const out = d.ents.map((e) => ctx.doc.add(e));
    return { ids: out.map((e) => e.id), message: `Đã dán ${out.length} đối tượng tại toạ độ gốc` };
  },
};

const WBLOCK: CommandDef = {
  name: 'WBLOCK',
  aliases: ['W', '-WBLOCK'],
  desc: 'Ghi các đối tượng chọn (hoặc một block) ra tệp DXF riêng',
  params: [
    { name: 'ids', type: 'ids', desc: 'Các đối tượng' },
    { name: 'block', type: 'string', desc: 'Hoặc: tên block cần ghi' },
    { name: 'name', type: 'string', desc: 'Tên tệp (mặc định: tên block hoặc "wblock.dxf")' },
  ],
  readonly: true,
  run(ctx, args) {
    let data: DrawingData;
    const bname = optStr(args, 'block');
    if (bname) {
      const b = ctx.doc.blocks.get(bname);
      if (!b) throw new Error(`Không có block "${bname}"`);
      const full = ctx.doc.toData();
      // Block thành bản vẽ: dời điểm gốc block về (0,0).
      const ents = b.ents.map((e) => JSON.parse(JSON.stringify(e)) as NewEntity);
      data = { ...full, currentLayer: '0', entities: ents, blocks: (full.blocks ?? []).filter((x) => x.name !== bname) };
      if (b.base[0] || b.base[1]) data.entities = ents.map((e) => moveEnt(e, [-b.base[0], -b.base[1]]));
    } else data = extractData(ctx, ids(ctx, args).map((e) => e.id));
    const name = (optStr(args, 'name') ?? bname ?? 'wblock').replace(/\.dxf$/i, '') + '.dxf';
    const dxf = writeDxf(data);
    if (ctx.ui) ctx.ui('download', { name, content: dxf, type: 'application/dxf' });
    return { name, size: dxf.length, message: `Đã ghi ${data.entities.length} đối tượng ra ${name}` };
  },
  async interactive(ctx, io) {
    const s = ctx.selection.size ? [...ctx.selection] : await io.getSelection('Chọn đối tượng cần ghi ra tệp (Enter = chọn block)');
    if (s.length) {
      io.print(WBLOCK.run(ctx, { ids: s }).message!);
      return;
    }
    const b = await io.getString('Tên block cần ghi', { spaces: true });
    if (b) io.print(WBLOCK.run(ctx, { block: b }).message!);
  },
};

export const UI_COMMANDS: CommandDef[] = [
  uiCmd('NEW', ['QNEW'], 'Bản vẽ mới (tab mới)'),
  uiCmd('OPEN', ['OP'], 'Mở bản vẽ DXF / DWG'),
  uiCmd('QSAVE', ['SAVE'], 'Lưu bản vẽ ra tệp DXF', 'qsave'),
  uiCmd('SAVEAS', [], 'Lưu thành tệp DXF với tên mới', 'saveas', [{ name: 'name', type: 'string', desc: 'Tên tệp' }]),
  uiCmd('SAVEALL', [], 'Lưu mọi bản vẽ đang mở ra DXF'),
  uiCmd('CLOSE', [], 'Đóng bản vẽ hiện hành'),
  uiCmd('CLOSEALL', [], 'Đóng mọi bản vẽ'),
  uiCmd('PLOT', ['PRINT', 'EXPORTPDF'], 'In / xuất PDF theo khổ giấy và tỉ lệ'),
  uiCmd('PREVIEW', ['PRE'], 'Xem trước bản in'),
  uiCmd('EXPORTSVG', ['SVGOUT'], 'Xuất bản vẽ ra SVG'),
  uiCmd('PNGOUT', ['PNG', 'JPGOUT'], 'Xuất ảnh PNG của màn hình vẽ', 'pngout', [{ name: 'scale', type: 'number', desc: 'Độ phân giải so với màn hình (mặc định 2)' }]),
  clipCmd('COPYCLIP', [], 'Chép đối tượng chọn vào bộ nhớ tạm (Ctrl+C)', false, false),
  clipCmd('CUTCLIP', [], 'Cắt đối tượng chọn vào bộ nhớ tạm (Ctrl+X)', true, false),
  clipCmd('COPYBASE', [], 'Chép vào bộ nhớ tạm kèm điểm gốc (Ctrl+Shift+C)', false, true),
  clipCmd('CUTBASE', [], 'Cắt vào bộ nhớ tạm kèm điểm gốc (Ctrl+Shift+X)', true, true),
  PASTEBLOCK,
  PASTEORIG,
  {
    ...uiCmd('UNDO', [], 'Hoàn tác nhiều bước', 'undo', [{ name: 'steps', type: 'number', desc: 'Số bước (mặc định 1)' }]),
    async interactive(ctx, io) {
      const n = await io.getDistance('Số bước hoàn tác', { def: 1 });
      if (n) ui(ctx, 'undo', { steps: n });
    },
  },
  {
    ...uiCmd('MREDO', [], 'Làm lại nhiều bước', 'redo', [{ name: 'steps', type: 'number', desc: 'Số bước (mặc định 1)' }]),
    async interactive(ctx, io) {
      const n = await io.getDistance('Số bước làm lại', { def: 1 });
      if (n) ui(ctx, 'redo', { steps: n });
    },
  },
  uiCmd('REGEN', ['RE', 'REGENALL', 'REA', 'REDRAW', 'R'], 'Vẽ lại màn hình'),
  uiCmd('TEXTSCR', [], 'Mở / đóng cửa sổ lịch sử lệnh (F2)'),
  uiCmd('CLEANSCREENON', [], 'Toàn màn hình vẽ (Ctrl+0)'),
  uiCmd('CLEANSCREENOFF', [], 'Hiện lại thanh công cụ'),
  uiCmd('ORTHO', [], 'Bật / tắt vẽ vuông góc (F8)'),
  uiCmd('GRID', [], 'Bật / tắt lưới (F7)'),
  uiCmd('OSNAP', ['OS', 'DSETTINGS', 'DS'], 'Bật / tắt bắt điểm (F3)'),
  uiCmd('POLAR', [], 'Bật / tắt dóng theo góc (F10)'),
  uiCmd('PROPERTIES', ['PR', 'MO'], 'Bảng thuộc tính (Ctrl+1)'),
  uiCmd('LAYMAN', ['LAYERS'], 'Hộp quản lý layer'),
  uiCmd('ABOUT', [], 'Giới thiệu MHCAD'),
  WBLOCK,
];
