// HATCH: mẫu tô (do MHCAD tự định nghĩa), cắt nét mẫu theo biên, chia vùng tô đặc, dò biên khi bấm điểm.

import { type BBox, type Vec, add, boxAdd, cross, deg2rad, dist, dot, emptyBox, len, mul, polar, sub } from './geom';

/** Một họ đường song song của mẫu tô (toạ độ bản vẽ). */
export interface PatLine {
  /** Góc đường, độ. */
  angle: number;
  /** Một điểm mà đường đầu tiên đi qua. */
  base: Vec;
  /** Dịch từ đường này sang đường kế tiếp (dọc theo hướng đường, vuông góc). */
  offset: Vec;
  /** Nét: dương = vạch, âm = khoảng trống, 0 = chấm. Rỗng = liền. */
  dashes: number[];
}

interface PatDef {
  desc: string;
  /** Định nghĩa ở tỉ lệ 1, góc 0: [góc, gốc x, gốc y, dịch dọc, dịch ngang, ...nét]. */
  lines: number[][];
}

/** Thư viện mẫu tô của MHCAD (tự soạn, đơn vị bản vẽ ở tỉ lệ 1). */
export const PATTERNS: Record<string, PatDef> = {
  SOLID: { desc: 'Tô đặc', lines: [] },
  LINE: { desc: 'Đường ngang song song', lines: [[0, 0, 0, 0, 3]] },
  LINE45: { desc: 'Gạch chéo 45° (mặt cắt chung)', lines: [[45, 0, 0, 0, 3]] },
  CROSS: { desc: 'Lưới ô vuông', lines: [[0, 0, 0, 0, 3], [90, 0, 0, 0, 3]] },
  CROSS45: { desc: 'Lưới chéo', lines: [[45, 0, 0, 0, 3], [135, 0, 0, 0, 3]] },
  DASH45: { desc: 'Gạch chéo nét đứt', lines: [[45, 0, 0, 0, 3, 3, -1.5]] },
  STEEL: { desc: 'Hai gạch chéo sát nhau (thép)', lines: [[45, 0, 0, 0, 3], [45, 0, 0.9, 0, 3]] },
  BRICK: {
    desc: 'Gạch xây',
    lines: [
      [0, 0, 0, 0, 6],
      [90, 0, 0, 6, 6, 6, -6],
    ],
  },
  CONCRETE: { desc: 'Bê tông (chấm và vạch ngắn)', lines: [[45, 0, 0, 2, 4, 0.8, -3.2], [135, 1, 1, 2, 4, 0, -4]] },
  EARTH: { desc: 'Đất', lines: [[0, 0, 0, 6, 6, 4, -8], [90, 0, 0, 6, 6, 4, -8]] },
  DOTS: { desc: 'Chấm đều', lines: [[0, 0, 0, 1.5, 1.5, 0, -1.5]] },
  HONEY: { desc: 'Tổ ong', lines: [[0, 0, 0, 5.196, 3, 3, -6], [120, 0, 0, 5.196, 3, 3, -6], [60, 3, 0, 5.196, 3, 3, -6]] },
};

/** Sinh các họ đường của mẫu theo tỉ lệ và góc. */
export function patternLines(name: string, scale: number, angle: number): PatLine[] {
  const def = PATTERNS[name.toUpperCase()];
  if (!def) throw new Error(`Không có mẫu "${name}". Các mẫu: ${Object.keys(PATTERNS).join(', ')}`);
  const a = deg2rad(angle);
  const rot = (v: Vec): Vec => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
  return def.lines.map(([ang, bx, by, dx, dy, ...dashes]) => {
    const la = deg2rad(ang);
    // Dịch (dx dọc đường, dy vuông góc) theo hệ của đường.
    const off: Vec = [dx * Math.cos(la) - dy * Math.sin(la), dx * Math.sin(la) + dy * Math.cos(la)];
    return {
      angle: ang + angle,
      base: rot([bx * scale, by * scale]),
      offset: rot([off[0] * scale, off[1] * scale]),
      dashes: dashes.map((d) => d * scale),
    };
  });
}

/** Biến đổi họ đường bằng một phép biến đổi điểm (dời, xoay, tỉ lệ, đối xứng). */
export function mapPatLine(l: PatLine, f: (p: Vec) => Vec): PatLine {
  const b = f(l.base);
  const u = sub(f(add(l.base, polar([0, 0], deg2rad(l.angle), 1))), b);
  const s = len(u);
  return {
    angle: (Math.atan2(u[1], u[0]) * 180) / Math.PI,
    base: b,
    offset: sub(f(add(l.base, l.offset)), b),
    dashes: l.dashes.map((d) => d * s),
  };
}

export function loopsBox(loops: Vec[][]): BBox {
  const b = emptyBox();
  for (const l of loops) for (const p of l) boxAdd(b, p);
  return b;
}

/** Các đoạn của mẫu nằm trong biên (quy tắc chẵn-lẻ cho đảo). Trả null nếu quá dày. */
export function hatchSegments(loops: Vec[][], lines: PatLine[], maxLines = 4000): [Vec, Vec][] | null {
  const box = loopsBox(loops);
  const corners: Vec[] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];
  const edges: [Vec, Vec][] = [];
  for (const l of loops) for (let i = 0; i < l.length; i++) edges.push([l[i], l[(i + 1) % l.length]]);
  const out: [Vec, Vec][] = [];
  for (const pl of lines) {
    const u: Vec = [Math.cos(deg2rad(pl.angle)), Math.sin(deg2rad(pl.angle))];
    const n: Vec = [-u[1], u[0]];
    const step = dot(pl.offset, n);
    if (Math.abs(step) < 1e-12) continue;
    const proj = corners.map((c) => dot(sub(c, pl.base), n));
    const k0 = Math.ceil(Math.min(...proj) / step - 1e-9);
    const k1 = Math.floor(Math.max(...proj) / step + 1e-9);
    const [ka, kb] = k0 <= k1 ? [k0, k1] : [k1, k0];
    if (kb - ka > maxLines) return null;
    const period = pl.dashes.reduce((s, d) => s + Math.abs(d), 0);
    for (let k = ka; k <= kb; k++) {
      const o = add(pl.base, mul(pl.offset, k));
      // Giao đường (o + t·u) với các cạnh.
      const ts: number[] = [];
      for (const [a, b] of edges) {
        // Quy tắc cắt chuẩn: chỉ đếm khi hai đầu cạnh nằm ở hai phía (0 tính là phía âm),
        // nên đỉnh nằm đúng trên đường không bị đếm trùng hay lệch cặp.
        const da = dot(sub(a, o), n);
        const db = dot(sub(b, o), n);
        if (da > 0 === db > 0) continue;
        const x = add(a, mul(sub(b, a), da / (da - db)));
        ts.push(dot(sub(x, o), u));
      }
      ts.sort((x, y) => x - y);
      for (let i = 0; i + 1 < ts.length; i += 2) {
        const t1 = ts[i];
        const t2 = ts[i + 1];
        if (t2 - t1 < 1e-12) continue;
        if (!pl.dashes.length || period < 1e-12) {
          out.push([add(o, mul(u, t1)), add(o, mul(u, t2))]);
          continue;
        }
        // Nét đứt: bắt đầu từ mốc chu kỳ trước t1.
        let t = Math.floor(t1 / period) * period;
        let guard = 0;
        while (t < t2 && guard++ < 20000) {
          for (const d of pl.dashes) {
            const a = t;
            const b = t + Math.abs(d);
            if (d >= 0) {
              const s1 = Math.max(a, t1);
              const s2 = d === 0 ? s1 : Math.min(b, t2);
              if (d === 0 ? a >= t1 && a <= t2 : s2 > s1) out.push([add(o, mul(u, s1)), add(o, mul(u, d === 0 ? s1 + Math.max(period * 0.02, 1e-6) : s2))]);
            }
            t = b;
            if (t >= t2) break;
          }
        }
      }
    }
  }
  return out;
}

/** Chia vùng (chẵn-lẻ) thành các hình thang theo dải ngang — dùng để ghi SOLID ra DXF R12. */
export function trapezoids(loops: Vec[][]): Vec[][] {
  const edges: [Vec, Vec][] = [];
  const ys = new Set<number>();
  for (const l of loops)
    for (let i = 0; i < l.length; i++) {
      const a = l[i];
      const b = l[(i + 1) % l.length];
      ys.add(a[1]);
      if (a[1] !== b[1]) edges.push([a, b]);
    }
  const sorted = [...ys].sort((a, b) => a - b);
  const xAt = (e: [Vec, Vec], y: number) => e[0][0] + ((y - e[0][1]) * (e[1][0] - e[0][0])) / (e[1][1] - e[0][1]);
  const out: Vec[][] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const y0 = sorted[i];
    const y1 = sorted[i + 1];
    const ym = (y0 + y1) / 2;
    const act = edges
      .filter(([a, b]) => Math.min(a[1], b[1]) <= y0 && Math.max(a[1], b[1]) >= y1)
      .map((e) => ({ e, x: xAt(e, ym) }))
      .sort((p, q) => p.x - q.x);
    for (let k = 0; k + 1 < act.length; k += 2) {
      const L = act[k].e;
      const R = act[k + 1].e;
      out.push([
        [xAt(L, y0), y0],
        [xAt(R, y0), y0],
        [xAt(R, y1), y1],
        [xAt(L, y1), y1],
      ]);
    }
  }
  return out;
}

// ---------- Dò biên (BOUNDARY) ----------

/**
 * Tìm vùng kín nhỏ nhất chứa điểm p, tạo bởi các đoạn thẳng cho trước (đã chia cung thành đoạn).
 * Trả về đa giác biên (ngược chiều kim đồng hồ) hoặc null.
 */
export function findBoundary(segs: [Vec, Vec][], p: Vec, tol = 1e-6): Vec[] | null {
  // 1. Chia mọi đoạn tại giao điểm.
  const n = segs.length;
  if (!n || n > 20000) return null;
  const cuts: number[][] = segs.map(() => [0, 1]);
  const boxes = segs.map(([a, b]) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
  // Sắp theo x để giảm số cặp phải xét.
  const order = segs.map((_, i) => i).sort((i, j) => boxes[i][0] - boxes[j][0]);
  for (let ii = 0; ii < n; ii++) {
    const i = order[ii];
    for (let jj = ii + 1; jj < n; jj++) {
      const j = order[jj];
      if (boxes[j][0] > boxes[i][2] + tol) break;
      if (boxes[j][1] > boxes[i][3] + tol || boxes[j][3] < boxes[i][1] - tol) continue;
      const [a, b] = segs[i];
      const [c, d] = segs[j];
      const r = sub(b, a);
      const s = sub(d, c);
      const den = cross(r, s);
      if (Math.abs(den) < 1e-14) continue;
      const t = cross(sub(c, a), s) / den;
      const u = cross(sub(c, a), r) / den;
      const et = tol / Math.max(len(r), 1e-12);
      const eu = tol / Math.max(len(s), 1e-12);
      if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) continue;
      cuts[i].push(Math.min(1, Math.max(0, t)));
      cuts[j].push(Math.min(1, Math.max(0, u)));
    }
  }
  // 2. Đồ thị phẳng: gộp đỉnh gần nhau.
  const q = Math.max(tol * 10, 1e-9);
  const key = (v: Vec) => `${Math.round(v[0] / q)},${Math.round(v[1] / q)}`;
  const nodes = new Map<string, { p: Vec; out: string[] }>();
  const node = (v: Vec) => {
    const k = key(v);
    if (!nodes.has(k)) nodes.set(k, { p: v, out: [] });
    return k;
  };
  const edgeSet = new Set<string>();
  segs.forEach(([a, b], i) => {
    const ts = [...new Set(cuts[i])].sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const p1 = add(a, mul(sub(b, a), ts[k]));
      const p2 = add(a, mul(sub(b, a), ts[k + 1]));
      const k1 = node(p1);
      const k2 = node(p2);
      if (k1 === k2 || edgeSet.has(`${k1}|${k2}`)) continue;
      edgeSet.add(`${k1}|${k2}`);
      edgeSet.add(`${k2}|${k1}`);
      nodes.get(k1)!.out.push(k2);
      nodes.get(k2)!.out.push(k1);
    }
  });
  // 3. Tia từ p sang phải: cạnh cắt gần nhất.
  let best: [string, string] | null = null;
  let bestX = Infinity;
  for (const e of edgeSet) {
    const [k1, k2] = e.split('|');
    if (k1 > k2) continue;
    const a = nodes.get(k1)!.p;
    const b = nodes.get(k2)!.p;
    if ((a[1] > p[1]) === (b[1] > p[1])) continue;
    const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
    if (x > p[0] && x < bestX) {
      bestX = x;
      best = [k1, k2];
    }
  }
  if (!best) return null;
  // Hướng cạnh sao cho p nằm bên trái.
  let [u, v] = best;
  if (cross(sub(nodes.get(v)!.p, nodes.get(u)!.p), sub(p, nodes.get(u)!.p)) < 0) [u, v] = [v, u];
  // 4. Đi vòng: tại mỗi đỉnh rẽ trái nhiều nhất.
  const start = `${u}|${v}`;
  const poly: Vec[] = [nodes.get(u)!.p];
  for (let guard = 0; guard < 100000; guard++) {
    const pu = nodes.get(u)!.p;
    const pv = nodes.get(v)!.p;
    poly.push(pv);
    const inA = Math.atan2(pv[1] - pu[1], pv[0] - pu[0]);
    let next: string | null = null;
    let bestTurn = -Infinity;
    for (const w of nodes.get(v)!.out) {
      if (w === u && nodes.get(v)!.out.length > 1) continue;
      const pw = nodes.get(w)!.p;
      let turn = Math.atan2(pw[1] - pv[1], pw[0] - pv[0]) - inA;
      while (turn <= -Math.PI) turn += 2 * Math.PI;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn > bestTurn) {
        bestTurn = turn;
        next = w;
      }
    }
    if (!next) return null;
    u = v;
    v = next;
    if (`${u}|${v}` === start) break;
  }
  poly.pop();
  // Bỏ đỉnh thẳng hàng.
  const clean: Vec[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[(i - 1 + poly.length) % poly.length];
    const b = poly[i];
    const c = poly[(i + 1) % poly.length];
    if (Math.abs(cross(sub(b, a), sub(c, b))) > 1e-12 * Math.max(1, dist(a, c) ** 2)) clean.push(b);
  }
  if (clean.length < 3) return null;
  let area = 0;
  for (let i = 0; i < clean.length; i++) area += cross(clean[i], clean[(i + 1) % clean.length]);
  if (area <= 0) return null; // vùng ngoài cùng (không kín quanh p)
  return clean;
}
