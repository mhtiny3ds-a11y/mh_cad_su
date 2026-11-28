// Bản vẽ: đối tượng, layer, hoàn tác/làm lại theo giao dịch (transaction).
// Mọi thay đổi đều đi qua add/update/remove/setLayer để undo luôn đúng.

import { type BBox, boxUnion, boxValid, emptyBox } from './geom';
import { type Entity, type NewEntity, bbox } from './entities';

export interface Layer {
  name: string;
  /** Mã màu ACI (1 đỏ, 2 vàng, 3 xanh lá, 4 lục lam, 5 xanh dương, 6 tím, 7 trắng/đen). */
  color: number;
  visible: boolean;
  locked: boolean;
}

type Change =
  | { k: 'ent'; id: number; before: Entity | null; after: Entity | null }
  | { k: 'layer'; name: string; before: Layer | null; after: Layer | null }
  | { k: 'clayer'; before: string; after: string };

interface Tx {
  label: string;
  changes: Change[];
}

export type DocListener = () => void;

export class Drawing {
  readonly entities = new Map<number, Entity>();
  readonly layers = new Map<string, Layer>();
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
    } else this.currentLayer = c[side];
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

  setCurrentLayer(name: string): void {
    if (!this.layers.has(name)) throw new Error(`Không có layer "${name}"`);
    if (name === this.currentLayer) return;
    const before = this.currentLayer;
    this.currentLayer = name;
    this.record({ k: 'clayer', before, after: name });
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

  /** Nạp dữ liệu (không ghi undo). */
  load(data: DrawingData): void {
    this.reset();
    for (const l of data.layers) this.layers.set(l.name, { ...l });
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
      entities: this.all().map(({ id: _id, ...rest }) => rest as NewEntity),
    };
  }
}

export interface DrawingData {
  format: 'mhcad';
  version: 1;
  units?: string;
  currentLayer?: string;
  layers: Layer[];
  entities: NewEntity[];
}
