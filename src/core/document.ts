// Bản vẽ: đối tượng, layer, hoàn tác/làm lại theo giao dịch (transaction).
// Mọi thay đổi đều đi qua add/update/remove/setLayer để undo luôn đúng.

import { type BBox, boxUnion, boxValid, emptyBox } from './geom';
import { type BlockDef, type DimStyle, type Entity, type NewEntity, bbox, setBlockLookup } from './entities';
import { DEFAULT_DIMSTYLE } from './dim';

export interface Layer {
  name: string;
  /** Mã màu ACI (1 đỏ, 2 vàng, 3 xanh lá, 4 lục lam, 5 xanh dương, 6 tím, 7 trắng/đen). */
  color: number;
  visible: boolean;
  locked: boolean;
  /** Kiểu đường của layer (mặc định CONTINUOUS). */
  lt?: string;
}

/**
 * Kiểu đường do MHCAD tự định nghĩa (đơn vị bản vẽ, nhân với LTSCALE).
 * Số dương = nét, số âm = khoảng trống, 0 = chấm.
 */
export const BUILTIN_LINETYPES: Record<string, number[]> = {
  CONTINUOUS: [],
  DASHED: [12, -6],
  HIDDEN: [6, -3],
  CENTER: [32, -6, 6, -6],
  DASHDOT: [12, -5, 0, -5],
  DOT: [0, -5],
  PHANTOM: [30, -5, 6, -5, 6, -5],
};

type Change =
  | { k: 'ent'; id: number; before: Entity | null; after: Entity | null }
  | { k: 'layer'; name: string; before: Layer | null; after: Layer | null }
  | { k: 'clayer'; before: string; after: string }
  | { k: 'block'; name: string; before: BlockDef | null; after: BlockDef | null }
  | { k: 'dimstyle'; before: DimStyle; after: DimStyle }
  | { k: 'ltscale'; before: number; after: number };

export interface Tx {
  label: string;
  changes: Change[];
}

export type DocListener = () => void;

export class Drawing {
  readonly entities = new Map<number, Entity>();
  readonly layers = new Map<string, Layer>();
  readonly blocks = new Map<string, BlockDef>();
  readonly linetypes = new Map<string, number[]>(Object.entries(BUILTIN_LINETYPES));
  dimStyle: DimStyle = { ...DEFAULT_DIMSTYLE };
  ltscale = 50;
  currentLayer = '0';
  units = 'mm';
  private nextId = 1;
  private undoStack: Tx[] = [];
  private redoStack: Tx[] = [];
  private open: Tx | null = null;
  private depth = 0;
  private listeners = new Set<DocListener>();
  /** Đã có thay đổi chưa lưu. */
  dirty = false;

  constructor() {
    this.layers.set('0', { name: '0', color: 7, visible: true, locked: false });
    this.activate();
  }

  /** Đặt bản vẽ này làm bản vẽ đang hoạt động (để INSERT tra được block). */
  activate(): void {
    setBlockLookup((n) => this.blocks.get(n));
  }

  onChange(fn: DocListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // ---------- Giao dịch ----------

  /** Mở giao dịch. Có thể lồng nhau; chỉ lớp ngoài cùng tạo một bước undo. */
  begin(label: string): void {
    if (this.depth === 0) this.open = { label, changes: [] };
    this.depth++;
  }

  commit(): void {
    if (this.depth === 0) return;
    this.depth--;
    if (this.depth > 0 || !this.open) return;
    const tx = this.open;
    this.open = null;
    if (tx.changes.length) {
      this.undoStack.push(tx);
      if (this.undoStack.length > 500) this.undoStack.shift();
      this.redoStack = [];
      this.dirty = true;
    }
    this.emit();
  }

  /** Huỷ giao dịch đang mở và khôi phục mọi thay đổi trong đó. */
  rollback(): void {
    if (!this.open) return;
    const tx = this.open;
    this.open = null;
    this.depth = 0;
    for (let i = tx.changes.length - 1; i >= 0; i--) this.apply(tx.changes[i], 'before');
    this.emit();
  }

  /** Chạy fn trong một giao dịch; lỗi thì khôi phục toàn bộ. */
  transact<T>(label: string, fn: () => T): T {
    this.begin(label);
    try {
      const r = fn();
      this.commit();
      return r;
    } catch (err) {
      if (this.depth === 1) this.rollback();
      else this.depth--;
      throw err;
    }
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  private record(c: Change): void {
    if (this.open) this.open.changes.push(c);
    else {
      this.undoStack.push({ label: 'thay đổi', changes: [c] });
      this.redoStack = [];
      this.dirty = true;
      this.emit();
    }
  }

  private apply(c: Change, side: 'before' | 'after'): void {
    if (c.k === 'ent') {
      const v = c[side];
      if (v) this.entities.set(c.id, v);
      else this.entities.delete(c.id);
    } else if (c.k === 'layer') {
      const v = c[side];
      if (v) this.layers.set(c.name, v);
      else this.layers.delete(c.name);
    } else if (c.k === 'block') {
      const v = c[side];
      if (v) this.blocks.set(c.name, v);
      else this.blocks.delete(c.name);
    } else if (c.k === 'dimstyle') this.dimStyle = c[side];
    else if (c.k === 'ltscale') this.ltscale = c[side];
    else this.currentLayer = c[side];
  }

  canUndo = (): boolean => this.undoStack.length > 0;
  canRedo = (): boolean => this.redoStack.length > 0;

  undo(): string | null {
    if (this.inTransaction) return null;
    const tx = this.undoStack.pop();
    if (!tx) return null;
    for (let i = tx.changes.length - 1; i >= 0; i--) this.apply(tx.changes[i], 'before');
    this.redoStack.push(tx);
    this.dirty = true;
    this.emit();
    return tx.label;
  }

  redo(): string | null {
    if (this.inTransaction) return null;
    const tx = this.redoStack.pop();
    if (!tx) return null;
    for (const c of tx.changes) this.apply(c, 'after');
    this.undoStack.push(tx);
    this.dirty = true;
    this.emit();
    return tx.label;
  }

  // ---------- Đối tượng ----------

  add(e: NewEntity): Entity {
    if (!this.layers.has(e.layer)) this.ensureLayer(e.layer);
    const ent = { ...e, id: this.nextId++ } as Entity;
    this.entities.set(ent.id, ent);
    this.record({ k: 'ent', id: ent.id, before: null, after: ent });
    return ent;
  }

  update(e: Entity): void {
    const before = this.entities.get(e.id);
    if (!before) throw new Error(`Không có đối tượng #${e.id}`);
    this.entities.set(e.id, e);
    this.record({ k: 'ent', id: e.id, before, after: e });
  }

  remove(id: number): void {
    const before = this.entities.get(id);
    if (!before) return;
    this.entities.delete(id);
    this.record({ k: 'ent', id, before, after: null });
  }

  get(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  all(): Entity[] {
    return [...this.entities.values()];
  }

  /** Đối tượng đang hiển thị (layer bật). */
  visible(): Entity[] {
    return this.all().filter((e) => this.layers.get(e.layer)?.visible !== false);
  }

  isEditable(e: Entity): boolean {
    const l = this.layers.get(e.layer);
    return !l || (l.visible && !l.locked);
  }

  // ---------- Layer ----------

  ensureLayer(name: string, color = 7): Layer {
    const ex = this.layers.get(name);
    if (ex) return ex;
    const l: Layer = { name, color, visible: true, locked: false };
    this.layers.set(name, l);
    this.record({ k: 'layer', name, before: null, after: l });
    return l;
  }

  setLayer(name: string, patch: Partial<Omit<Layer, 'name'>>): void {
    const before = this.layers.get(name);
    if (!before) throw new Error(`Không có layer "${name}"`);
    const after = { ...before, ...patch };
    this.layers.set(name, after);
    this.record({ k: 'layer', name, before, after });
  }

  /** Xoá layer rỗng (không còn đối tượng). */
  removeLayer(name: string): void {
    const before = this.layers.get(name);
    if (!before) return;
    if (name === '0' || name === this.currentLayer) throw new Error('Không xoá được layer 0 hoặc layer hiện hành');
    if (this.all().some((e) => e.layer === name)) throw new Error(`Layer "${name}" vẫn còn đối tượng`);
    this.layers.delete(name);
    this.record({ k: 'layer', name, before, after: null });
  }

  setCurrentLayer(name: string): void {
    if (!this.layers.has(name)) throw new Error(`Không có layer "${name}"`);
    if (name === this.currentLayer) return;
    const before = this.currentLayer;
    this.currentLayer = name;
    this.record({ k: 'clayer', before, after: name });
  }

  // ---------- Block, kiểu kích thước, LTSCALE ----------

  setBlock(def: BlockDef): void {
    const before = this.blocks.get(def.name) ?? null;
    const after = { ...def, ents: def.ents.map((e) => ({ ...e })) };
    this.blocks.set(def.name, after);
    this.record({ k: 'block', name: def.name, before, after });
  }

  setDimStyle(patch: Partial<DimStyle>): void {
    const before = this.dimStyle;
    this.dimStyle = { ...before, ...patch };
    this.record({ k: 'dimstyle', before, after: this.dimStyle });
  }

  setLtscale(v: number): void {
    if (!(v > 0)) throw new Error('LTSCALE phải > 0');
    const before = this.ltscale;
    this.ltscale = v;
    this.record({ k: 'ltscale', before, after: v });
  }

  /** Mẫu nét của một đối tượng (theo đối tượng, rồi theo layer). */
  linePattern(e: { layer: string; lt?: string }): number[] {
    const name = (e.lt && e.lt.toUpperCase() !== 'BYLAYER' ? e.lt : this.layers.get(e.layer)?.lt) ?? 'CONTINUOUS';
    return this.linetypes.get(name.toUpperCase()) ?? [];
  }

  // ---------- Khác ----------

  extents(): BBox | null {
    let b = emptyBox();
    for (const e of this.visible()) b = boxUnion(b, bbox(e));
    return boxValid(b) ? b : null;
  }

  /** Xoá sạch, không ghi undo (dùng khi tạo mới / mở file). */
  reset(): void {
    this.entities.clear();
    this.layers.clear();
    this.blocks.clear();
    this.linetypes.clear();
    for (const [k, v] of Object.entries(BUILTIN_LINETYPES)) this.linetypes.set(k, v);
    this.dimStyle = { ...DEFAULT_DIMSTYLE };
    this.ltscale = 50;
    this.units = 'mm';
    this.activate();
    this.layers.set('0', { name: '0', color: 7, visible: true, locked: false });
    this.currentLayer = '0';
    this.nextId = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.open = null;
    this.depth = 0;
    this.dirty = false;
    this.emit();
  }

  /** Chụp toàn bộ trạng thái (kể cả lịch sử hoàn tác) để chuyển qua lại giữa các tab bản vẽ. */
  saveState(): DocState {
    return {
      entities: new Map(this.entities),
      layers: new Map(this.layers),
      blocks: new Map(this.blocks),
      linetypes: new Map(this.linetypes),
      dimStyle: this.dimStyle,
      ltscale: this.ltscale,
      currentLayer: this.currentLayer,
      units: this.units,
      nextId: this.nextId,
      undo: this.undoStack,
      redo: this.redoStack,
      dirty: this.dirty,
    };
  }

  /** Khôi phục trạng thái đã chụp bằng saveState(). */
  restoreState(s: DocState): void {
    const fill = <K, V>(m: Map<K, V>, src: Map<K, V>) => {
      m.clear();
      for (const [k, v] of src) m.set(k, v);
    };
    fill(this.entities, s.entities);
    fill(this.layers, s.layers);
    fill(this.blocks, s.blocks);
    fill(this.linetypes, s.linetypes);
    this.dimStyle = s.dimStyle;
    this.ltscale = s.ltscale;
    this.currentLayer = s.currentLayer;
    this.units = s.units;
    this.nextId = s.nextId;
    this.undoStack = s.undo;
    this.redoStack = s.redo;
    this.open = null;
    this.depth = 0;
    this.dirty = s.dirty;
    this.activate();
    this.emit();
  }

  /** Nạp dữ liệu (không ghi undo). */
  load(data: DrawingData): void {
    this.reset();
    for (const l of data.layers) this.layers.set(l.name, { ...l });
    for (const b of data.blocks ?? []) this.blocks.set(b.name, b);
    for (const [k, v] of Object.entries(data.linetypes ?? {})) if (!this.linetypes.has(k.toUpperCase())) this.linetypes.set(k.toUpperCase(), v);
    if (data.dimStyle) this.dimStyle = { ...DEFAULT_DIMSTYLE, ...data.dimStyle };
    if (data.ltscale && data.ltscale > 0) this.ltscale = data.ltscale;
    if (!this.layers.has('0')) this.layers.set('0', { name: '0', color: 7, visible: true, locked: false });
    for (const e of data.entities) {
      const id = this.nextId++;
      this.entities.set(id, { ...e, id } as Entity);
    }
    this.currentLayer = data.currentLayer && this.layers.has(data.currentLayer) ? data.currentLayer : '0';
    if (data.units) this.units = data.units;
    this.dirty = false;
    this.emit();
  }

  toData(): DrawingData {
    return {
      format: 'mhcad',
      version: 1,
      units: this.units,
      currentLayer: this.currentLayer,
      layers: [...this.layers.values()].map((l) => ({ ...l })),
      blocks: [...this.blocks.values()],
      linetypes: Object.fromEntries([...this.linetypes].filter(([k]) => !(k in BUILTIN_LINETYPES))),
      dimStyle: { ...this.dimStyle },
      ltscale: this.ltscale,
      entities: this.all().map(({ id: _id, ...rest }) => rest as NewEntity),
    };
  }
}

/** Trạng thái đầy đủ của một bản vẽ (dùng cho nhiều tab). */
export interface DocState {
  entities: Map<number, Entity>;
  layers: Map<string, Layer>;
  blocks: Map<string, BlockDef>;
  linetypes: Map<string, number[]>;
  dimStyle: DimStyle;
  ltscale: number;
  currentLayer: string;
  units: string;
  nextId: number;
  undo: Tx[];
  redo: Tx[];
  dirty: boolean;
}

export interface DrawingData {
  format: 'mhcad';
  version: 1;
  units?: string;
  currentLayer?: string;
  layers: Layer[];
  blocks?: BlockDef[];
  /** Kiểu đường ngoài bộ có sẵn (đọc từ DXF). */
  linetypes?: Record<string, number[]>;
  dimStyle?: DimStyle;
  ltscale?: number;
  entities: NewEntity[];
}
