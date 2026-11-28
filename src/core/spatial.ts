// Chỉ mục không gian dạng lưới đều: tìm nhanh đối tượng gần con trỏ trong bản vẽ lớn.

import type { BBox } from './geom';
import { type Entity, bbox } from './entities';

export class GridIndex {
  private cells = new Map<number, Entity[]>();
  private big: Entity[] = [];
  private size = 1;
  private ox = 0;
  private oy = 0;
  private nx = 1;

  constructor(ents: Entity[], extents: BBox | null) {
    if (!extents || !ents.length) return;
    const w = Math.max(extents.maxX - extents.minX, 1e-9);
    const h = Math.max(extents.maxY - extents.minY, 1e-9);
    // Khoảng 64 ô theo chiều dài hơn, đủ mịn cho vài chục nghìn đối tượng.
    const n = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(ents.length) / 2)));
    this.size = Math.max(w, h) / n;
    this.ox = extents.minX;
    this.oy = extents.minY;
    this.nx = Math.ceil(w / this.size) + 1;
    for (const e of ents) {
      const b = bbox(e);
      const x0 = Math.floor((b.minX - this.ox) / this.size);
      const x1 = Math.floor((b.maxX - this.ox) / this.size);
      const y0 = Math.floor((b.minY - this.oy) / this.size);
      const y1 = Math.floor((b.maxY - this.oy) / this.size);
      // Đối tượng phủ quá nhiều ô: để riêng, luôn được xét.
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) {
        this.big.push(e);
        continue;
      }
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = y * this.nx + x;
          let c = this.cells.get(k);
          if (!c) this.cells.set(k, (c = []));
          c.push(e);
        }
    }
  }

  /** Các đối tượng có thể nằm trong khung (đã loại trùng). */
  query(b: BBox): Entity[] {
    const out = new Set<Entity>(this.big);
    const x0 = Math.floor((b.minX - this.ox) / this.size);
    const x1 = Math.floor((b.maxX - this.ox) / this.size);
    const y0 = Math.floor((b.minY - this.oy) / this.size);
    const y1 = Math.floor((b.maxY - this.oy) / this.size);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return [...this.cells.values()].flat().concat(this.big);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) for (const e of this.cells.get(y * this.nx + x) ?? []) out.add(e);
    return [...out];
  }
}
