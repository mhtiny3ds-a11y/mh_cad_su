// Bộ điều khiển giao diện: chuột/bàn phím, dòng lệnh, bắt điểm, chọn đối tượng.

import { type Vec, angleOf, dist, len, polar, rad2deg, sub } from '../core/geom';
import { Drawing } from '../core/document';
import {
  type Ctx,
  type IO,
  type PointOpts,
  CancelError,
  type Registry,
  runInteractive,
} from '../core/commands';
import { type NewEntity, type SnapKind, applyGrip, bbox, distanceTo, gripPoints, insideBox, intersections, perpendicularFoot, snapPoints, touchesBox } from '../core/entities';
import { normDeg } from '../core/entities';
import { parseInput } from '../core/input';
import { type MhcadApi, createApi } from '../core/api';
import { decodeDxfBytes, readDxf, writeDxf } from '../core/dxf';
import { createRegistry } from '../core/registry';
import { GridIndex } from '../core/spatial';
import { isDwg } from '../core/dwg';
import { PAPERS, plotSvg } from '../core/svg';
import { type Theme, Viewport, aciToCss, render } from './view';
import { ICONS, LOGO } from './icons';

export const VERSION = '0.2.0';

const THEMES: Record<'dark' | 'light', Theme> = {
  dark: {
    bg: '#14181f',
    fg: '#e6edf3',
    grid: '#1c222b',
    gridMajor: '#262e3a',
    accent: '#2dd4bf',
    select: '#58a6ff',
    preview: '#2dd4bf',
    snap: '#facc15',
    windowFill: 'rgba(76,141,255,0.12)',
    crossFill: 'rgba(63,185,80,0.12)',
  },
  light: {
    bg: '#fbfbf8',
    fg: '#111827',
    grid: '#eef0ec',
    gridMajor: '#dfe3dc',
    accent: '#0f766e',
    select: '#2563eb',
    preview: '#0f766e',
    snap: '#ca8a04',
    windowFill: 'rgba(37,99,235,0.10)',
    crossFill: 'rgba(22,163,74,0.10)',
  },
};

type PendingKind = 'point' | 'distance' | 'angle' | 'string' | 'selection' | 'entity';
interface Pending {
  kind: PendingKind;
  msg: string;
  base?: Vec;
  /** Điểm thứ nhất khi đo khoảng cách/góc bằng hai lần bấm. */
  tempBase?: Vec;
  keywords?: string[];
  allowNone?: boolean;
  def?: number | string;
  spaces?: boolean;
  single?: boolean;
  preview?: PointOpts['preview'];
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* bộ nhớ trình duyệt không dùng được: bỏ qua */
    }
  },
};

const TOOLS = [
  'LINE', 'PLINE', 'RECTANG', 'POLYGON', 'CIRCLE', 'ARC', 'TEXT', '|',
  'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'OFFSET', 'TRIM', 'EXTEND', 'FILLET', 'CHAMFER', 'BREAK', 'JOIN', 'EXPLODE', 'ERASE', '|',
  'DIMLINEAR', 'DIMALIGNED', 'DIMRADIUS', 'DIMANGULAR', 'DIMCONTINUE', '|',
  'HATCH', 'BLOCK', 'INSERT', 'MATCHPROP', '|', 'DIST', 'AREA', 'LIST',
];

const TOOL_LABEL: Record<string, string> = {
  LINE: 'Đoạn thẳng (L)',
  PLINE: 'Đa tuyến (PL)',
  RECTANG: 'Hình chữ nhật (REC)',
  CIRCLE: 'Đường tròn (C)',
  ARC: 'Cung tròn 3 điểm (A)',
  TEXT: 'Chữ (DT)',
  MOVE: 'Di chuyển (M)',
  COPY: 'Sao chép (CO)',
  ROTATE: 'Xoay (RO)',
  SCALE: 'Tỉ lệ (SC)',
  MIRROR: 'Đối xứng (MI)',
  OFFSET: 'Offset song song (O)',
  EXPLODE: 'Phá đa tuyến (X)',
  ERASE: 'Xoá (E)',
  DIST: 'Đo khoảng cách (DI)',
  POLYGON: 'Đa giác đều (POL)',
  TRIM: 'Cắt bỏ (TR)',
  EXTEND: 'Kéo dài (EX)',
  FILLET: 'Bo góc (F)',
  CHAMFER: 'Vát góc (CHA)',
  BREAK: 'Bẻ gãy (BR)',
  JOIN: 'Nối (J)',
  DIMLINEAR: 'Kích thước ngang/đứng (DLI)',
  DIMALIGNED: 'Kích thước song song (DAL)',
  DIMRADIUS: 'Kích thước bán kính (DRA)',
  DIMANGULAR: 'Kích thước góc (DAN)',
  DIMCONTINUE: 'Kích thước nối tiếp (DCO)',
  BLOCK: 'Tạo block (B)',
  INSERT: 'Chèn block (I)',
  MATCHPROP: 'Sao chép thuộc tính (MA)',
  AREA: 'Diện tích (AA)',
  HATCH: 'Tô vật liệu (H)',
  LIST: 'Thông tin đối tượng (LI)',
};

export class App {
  readonly doc = new Drawing();
  readonly reg: Registry = createRegistry();
  readonly vp = new Viewport();
  readonly api: MhcadApi;
  private selection = new Set<number>();
  private ctx: Ctx;
  private canvas!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  private input!: HTMLInputElement;
  private promptEl!: HTMLElement;
  private historyEl!: HTMLElement;
  private coordsEl!: HTMLElement;
  private layerSel!: HTMLSelectElement;
  private fileInput!: HTMLInputElement;

  private themeName: 'dark' | 'light' = 'dark';
  private showGrid = true;
  private snapOn = true;
  private orthoOn = false;
  private cursorScreen: Vec | null = null;
  private hover: number | null = null;
  private snap: { p: Vec; kind: SnapKind } | null = null;
  private box: { a: Vec; b: Vec; startPx: Vec; dragging: boolean } | null = null;
  private pan: { last: Vec } | null = null;
  private touches = new Map<number, Vec>();
  private pinch: { d: number; mid: Vec } | null = null;
  private hotGrip: { id: number; i: number } | null = null;
  private index: GridIndex | null = null;
  private lastRenderMs = 0;
  private lastStats: Record<string, number> = { drawn: 0, total: 0 };
  private dwgWorker: Worker | null = null;
  private spaceDown = false;
  private pending: Pending | null = null;
  private running: Promise<void> | null = null;
  private runningName = '';
  private lastCmd = '';
  private cmdHistory: string[] = [];
  private histIdx = -1;
  private fileName = 'ban-ve.dxf';
  private frame = 0;
  private saveTimer = 0;

  constructor(private root: HTMLElement) {
    this.ctx = {
      doc: this.doc,
      selection: this.selection,
      view: {
        zoomExtents: () => this.zoomExtents(),
        zoomWindow: (a, b) => this.zoomWindow(a, b),
      },
      print: (m) => this.print(m),
    };
    this.api = createApi({
      doc: this.doc,
      reg: this.reg,
      ctx: () => this.ctx,
      version: VERSION,
      setSelection: (ids) => {
        this.selection.clear();
        ids.forEach((i) => this.selection.add(i));
        this.redraw();
      },
      onLoaded: () => {
        this.selection.clear();
        this.zoomExtents();
      },
      view: {
        zoomExtents: () => this.zoomExtents(),
        zoomWindow: (a, b) => this.zoomWindow(a, b),
        snapshot: () => this.snapshot(),
        renderStats: () => ({ ms: this.lastRenderMs, ...this.lastStats }),
        redrawNow: () => {
          this.draw();
          return this.lastRenderMs;
        },
        toClient: (p) => {
          const r = this.canvas.getBoundingClientRect();
          const q = this.vp.toScreen(p);
          return [r.left + q[0], r.top + q[1]];
        },
      },
    });
  }

  // ---------- Khởi tạo giao diện ----------

  mount(): void {
    const saved = store.get('mhcad.theme');
    this.themeName = saved === 'light' ? 'light' : saved === 'dark' ? 'dark' : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = this.themeName;

    this.root.innerHTML = `
      <header class="topbar">
        <div class="brand">${LOGO}<span>MHCAD</span><small>v${VERSION}</small></div>
        <div class="actions">
          <button data-act="new" title="Bản vẽ mới">${ICONS.new}</button>
          <button data-act="open" title="Mở file DXF / DWG (hoặc kéo-thả vào vùng vẽ)">${ICONS.open}</button>
          <button data-act="save" title="Lưu ra file DXF (Ctrl+S)">${ICONS.save}</button>
          <span class="sep"></span>
          <button data-act="undo" title="Hoàn tác (Ctrl+Z)">${ICONS.undo}</button>
          <button data-act="redo" title="Làm lại (Ctrl+Y)">${ICONS.redo}</button>
          <button data-act="extents" title="Xem toàn bộ (Z ↵ ↵)">${ICONS.extents}</button>
          <span class="sep"></span>
          <button data-act="plot" title="In / xuất PDF theo tỉ lệ (Ctrl+P)">${ICONS.plot}</button>
          <button data-act="svg" title="Xuất SVG">${ICONS.svg}</button>
        </div>
        <div class="actions right">
          <label class="layer" title="Layer hiện hành (đang chọn đối tượng: chuyển chúng sang layer này)"><span class="dot"></span><select id="layer"></select></label>
          <button data-act="layers" title="Quản lý layer (LA)">${ICONS.layers}</button>
          <button data-act="theme" title="Đổi nền sáng/tối">${ICONS.theme}</button>
          <button data-act="help" title="Trợ giúp (F1)">${ICONS.help}</button>
        </div>
      </header>
      <nav class="toolbar" aria-label="Công cụ">
        ${TOOLS.map((t) => (t === '|' ? '<span class="sep"></span>' : `<button data-cmd="${t}" title="${TOOL_LABEL[t]}">${ICONS[t]}</button>`)).join('')}
      </nav>
      <main class="stage"><canvas id="cv" aria-label="Vùng vẽ"></canvas></main>
      <section class="cmdline">
        <div class="history" id="history" aria-live="polite"></div>
        <div class="prompt-row">
          <span class="prompt" id="prompt">Lệnh:</span>
          <input id="cmd" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Gõ lệnh (L, C, REC, M...) hoặc toạ độ" />
        </div>
      </section>
      <footer class="status">
        <span id="coords" class="coords">0, 0</span>
        <span class="toggles">
          <button data-toggle="snap" title="Bắt điểm (F3)">SNAP</button>
          <button data-toggle="ortho" title="Vuông góc (F8)">ORTHO</button>
          <button data-toggle="grid" title="Lưới (F7)">GRID</button>
        </span>
        <span class="units" id="units">mm</span>
      </footer>
      <input type="file" id="file" accept=".dxf,.DXF,.dwg,.DWG" hidden />
      <dialog id="help"></dialog>
      <dialog id="layers"></dialog>
      <dialog id="plot"></dialog>
      <iframe id="printframe" title="In" aria-hidden="true" tabindex="-1"></iframe>`;

    this.canvas = this.root.querySelector('#cv')!;
    this.g = this.canvas.getContext('2d')!;
    this.input = this.root.querySelector('#cmd')!;
    this.promptEl = this.root.querySelector('#prompt')!;
    this.historyEl = this.root.querySelector('#history')!;
    this.coordsEl = this.root.querySelector('#coords')!;
    this.layerSel = this.root.querySelector('#layer')!;
    this.fileInput = this.root.querySelector('#file')!;

    this.bindUi();
    this.bindCanvas();
    this.bindKeys();

    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement!);
    this.resize();

    this.doc.onChange(() => {
      this.index = null;
      this.refreshLayers();
      this.redraw();
      clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => this.autosave(), 800);
    });

    if (!this.restore()) this.vp.fit({ minX: 0, minY: 0, maxX: 10000, maxY: 6000 });
    this.refreshLayers();
    this.refreshToggles();
    this.updatePrompt();
    this.print(`MHCAD ${VERSION} — phần mềm CAD miễn phí, mã nguồn mở. Gõ lệnh hoặc bấm F1 để xem trợ giúp.`);
    this.input.focus();
    this.redraw();
  }

  private bindUi(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) =>
      b.addEventListener('click', () => {
        void this.start(b.dataset.cmd!);
        this.input.focus();
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        this.action(b.dataset.act!);
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => this.toggle(b.dataset.toggle as 'snap' | 'ortho' | 'grid')),
    );
    this.layerSel.addEventListener('change', () => {
      try {
        if (this.selection.size && !this.running) {
          const r = this.api.run('CHPROP', { ids: [...this.selection], layer: this.layerSel.value });
          this.print(r.message!);
          this.selection.clear();
          this.refreshLayers();
          return;
        }
        this.api.run('LAYER', { name: this.layerSel.value, current: true });
      } catch (e) {
        this.print((e as Error).message);
      }
      this.input.focus();
    });
    this.fileInput.addEventListener('change', async () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (!f) return;
      await this.openFile(f);
    });
    // Kéo-thả file DXF/DWG vào vùng vẽ.
    const stage = this.root.querySelector<HTMLElement>('.stage')!;
    stage.addEventListener('dragover', (e) => {
      e.preventDefault();
      stage.classList.add('drop');
    });
    stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
    stage.addEventListener('drop', (e) => {
      e.preventDefault();
      stage.classList.remove('drop');
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.openFile(f);
    });
  }

  /** Chuyển DWG → DXF trong Web Worker (LibreDWG WebAssembly, nạp khi cần). */
  private dwgToDxf(bytes: Uint8Array): Promise<string> {
    if (!this.dwgWorker) this.dwgWorker = new Worker(new URL('./dwg-worker.ts', import.meta.url), { type: 'module' });
    const w = this.dwgWorker;
    const id = Math.random();
    return new Promise((resolve, reject) => {
      const onMsg = (ev: MessageEvent<{ id: number; dxf?: string; error?: string }>) => {
        if (ev.data.id !== id) return;
        w.removeEventListener('message', onMsg);
        if (ev.data.error) reject(new Error(ev.data.error));
        else resolve(ev.data.dxf!);
      };
      w.addEventListener('message', onMsg);
      w.addEventListener('error', (e) => reject(new Error(e.message || 'Lỗi khi nạp bộ đọc DWG')), { once: true });
      w.postMessage({ id, bytes }, [bytes.buffer]);
    });
  }

  private async openFile(f: File): Promise<void> {
    {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let text: string;
        if (isDwg(bytes)) {
          this.print(`Đang đọc DWG ${f.name}… (lần đầu cần tải bộ đọc khoảng 8 MB)`);
          const t0 = performance.now();
          text = await this.dwgToDxf(bytes);
          this.print(`Đã chuyển DWG trong ${Math.round(performance.now() - t0)} ms`);
        } else text = decodeDxfBytes(bytes);
        const r = readDxf(text);
        this.doc.load(r.data);
        this.fileName = f.name.replace(/\.(dxf|dwg)$/i, '') + '.dxf';
        this.selection.clear();
        this.zoomExtents();
        this.print(`Đã mở ${f.name}: ${r.data.entities.length} đối tượng, ${r.data.layers.length} layer.`);
        const sk = Object.entries(r.skipped);
        if (sk.length) this.print(`Chưa hỗ trợ (bỏ qua): ${sk.map(([k, v]) => `${k} × ${v}`).join(', ')}`);
      } catch (e) {
        this.print(`Không mở được file: ${(e as Error).message}`);
      }
    }
  }

  private action(act: string): void {
    switch (act) {
      case 'new':
        if (this.doc.dirty && this.doc.entities.size && !confirm('Bản vẽ hiện tại chưa lưu ra file. Tạo bản vẽ mới?')) return;
        this.cancel();
        this.doc.reset();
        this.fileName = 'ban-ve.dxf';
        this.selection.clear();
        this.vp.fit({ minX: 0, minY: 0, maxX: 10000, maxY: 6000 });
        this.print('Bản vẽ mới.');
        break;
      case 'open':
        this.fileInput.click();
        break;
      case 'save':
        this.saveDxf();
        break;
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'extents':
        this.zoomExtents();
        break;
      case 'theme':
        this.themeName = this.themeName === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = this.themeName;
        store.set('mhcad.theme', this.themeName);
        this.refreshLayers();
        this.redraw();
        break;
      case 'help':
        this.showHelp();
        break;
      case 'layers':
        this.showLayers();
        return;
      case 'plot':
        this.showPlot();
        return;
      case 'svg':
        this.exportSvg();
        break;
    }
    this.input.focus();
  }

  private toggle(k: 'snap' | 'ortho' | 'grid'): void {
    if (k === 'snap') this.snapOn = !this.snapOn;
    if (k === 'ortho') this.orthoOn = !this.orthoOn;
    if (k === 'grid') this.showGrid = !this.showGrid;
    this.print(`${k.toUpperCase()} ${(k === 'snap' ? this.snapOn : k === 'ortho' ? this.orthoOn : this.showGrid) ? 'bật' : 'tắt'}`);
    this.refreshToggles();
    this.redraw();
    this.input.focus();
  }

  private refreshToggles(): void {
    const on = { snap: this.snapOn, ortho: this.orthoOn, grid: this.showGrid };
    this.root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((b) => {
      b.classList.toggle('on', on[b.dataset.toggle as keyof typeof on]);
      b.setAttribute('aria-pressed', String(on[b.dataset.toggle as keyof typeof on]));
    });
  }

  private refreshLayers(): void {
    const cur = this.doc.currentLayer;
    const names = [...this.doc.layers.keys()].sort((a, b) => (a === '0' ? -1 : b === '0' ? 1 : a.localeCompare(b, 'vi')));
    const sig = names.join('\u0000') + '|' + cur;
    if (this.layerSel.dataset.sig !== sig) {
      this.layerSel.innerHTML = names.map((n) => `<option>${escapeHtml(n)}</option>`).join('');
      this.layerSel.dataset.sig = sig;
    }
    this.layerSel.value = cur;
    const l = this.doc.layers.get(cur);
    const dot = this.root.querySelector<HTMLElement>('.layer .dot');
    if (dot) dot.style.background = aciToCss(l?.color ?? 7, THEMES[this.themeName].fg);
    const u = this.root.querySelector('#units');
    if (u) u.textContent = this.doc.units;
  }

  // ---------- Canvas ----------

  private resize(): void {
    const el = this.canvas.parentElement!;
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.vp.w = Math.max(1, r.width);
    this.vp.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.vp.w * dpr);
    this.canvas.height = Math.round(this.vp.h * dpr);
    this.canvas.style.width = `${this.vp.w}px`;
    this.canvas.style.height = `${this.vp.h}px`;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  redraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(hideCursor = false): void {
    const cursorW = this.cursorScreen ? this.effectivePoint() : null;
    const preview: NewEntity[] = [];
    if (this.pending?.preview && cursorW && !hideCursor) {
      try {
        preview.push(...this.pending.preview(cursorW));
      } catch {
        /* xem trước lỗi thì bỏ qua */
      }
    } else if (this.pending && cursorW && (this.pending.tempBase || (this.pending.kind !== 'selection' && this.pending.base))) {
      const b = this.pending.tempBase ?? this.pending.base!;
      preview.push({ type: 'LINE', a: b, b: cursorW, layer: '0' });
    }
    const t0 = performance.now();
    const rs = {
      doc: this.doc,
      vp: this.vp,
      theme: THEMES[this.themeName],
      showGrid: this.showGrid,
      selection: this.selection,
      hover: hideCursor ? null : this.hover,
      preview,
      cursor: hideCursor || !this.cursorScreen ? null : this.vp.toWorld(this.cursorScreen[0], this.cursorScreen[1]),
      snap: hideCursor ? null : this.snap,
      box: this.box && !hideCursor ? { a: this.box.a, b: this.box.b } : null,
      pickbox: !this.pending || this.pending.kind === 'selection' || this.pending.kind === 'entity',
      grips: !this.running,
      hotGrip: this.hotGrip,
      pickSize: 5,
    } as Parameters<typeof render>[1];
    render(this.g, rs);
    this.lastRenderMs = performance.now() - t0;
    if (rs.stats) this.lastStats = rs.stats;
  }

  private snapshot(): string {
    this.draw(true);
    const url = this.canvas.toDataURL('image/png');
    this.draw();
    return url;
  }

  zoomExtents(): void {
    const b = this.doc.extents();
    if (b) this.vp.fit(b);
    this.redraw();
  }

  zoomWindow(a: Vec, b: Vec): void {
    this.vp.fit({ minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) }, 0.02);
    this.redraw();
  }

  private bindCanvas(): void {
    const cv = this.canvas;
    const pos = (e: PointerEvent | WheelEvent | MouseEvent): Vec => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
        this.touches.set(e.pointerId, p);
        if (this.touches.size === 2 && this.pinch) {
          const [a, b] = [...this.touches.values()];
          const d = Math.max(dist(a, b), 1);
          const m: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          this.vp.panPx(m[0] - this.pinch.mid[0], m[1] - this.pinch.mid[1]);
          this.vp.zoomAt(m[0], m[1], d / this.pinch.d);
          this.pinch = { d, mid: m };
          this.redraw();
          return;
        }
      }
      if (this.pan) {
        this.vp.panPx(p[0] - this.pan.last[0], p[1] - this.pan.last[1]);
        this.pan.last = p;
      }
      this.cursorScreen = p;
      this.updateHoverAndSnap();
      if (this.box) {
        this.box.b = this.vp.toWorld(p[0], p[1]);
        if (dist(p, this.box.startPx) > 5) this.box.dragging = true;
      }
      const w = this.effectivePoint();
      this.coordsEl.textContent = `${fmt(w[0])}, ${fmt(w[1])}`;
      this.redraw();
    });

    cv.addEventListener('pointerleave', () => {
      this.cursorScreen = null;
      this.snap = null;
      this.hover = null;
      this.redraw();
    });

    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, p);
        if (this.touches.size === 2) {
          // Hai ngón: chụm để zoom, kéo để di chuyển màn hình.
          const [a, b] = [...this.touches.values()];
          this.pinch = { d: Math.max(dist(a, b), 1), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
          this.box = null;
          this.redraw();
          return;
        }
      }
      this.cursorScreen = p;
      if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
        e.preventDefault();
        this.pan = { last: p };
        cv.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      if (e.pointerType === 'mouse') e.preventDefault(); // giữ con trỏ nhập ở dòng lệnh
      cv.setPointerCapture(e.pointerId);
      this.updateHoverAndSnap();
      this.leftDown(p, e.shiftKey);
      if (e.pointerType === 'mouse') this.input.focus();
    });

    const endTouch = (e: PointerEvent) => {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
    };
    cv.addEventListener('pointercancel', endTouch);
    cv.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') {
        const wasPinch = !!this.pinch;
        endTouch(e);
        if (wasPinch) return;
      }
      if (this.pan && (e.button === 1 || e.button === 0)) {
        this.pan = null;
        return;
      }
      if (e.button === 0 && this.box?.dragging) this.finishBox(e.shiftKey);
    });

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      const k = Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 30 : 1));
      this.vp.zoomAt(p[0], p[1], k);
      this.redraw();
    }, { passive: false });

    cv.addEventListener('auxclick', (e) => {
      if (e.button === 1 && e.detail === 2) this.zoomExtents();
    });

    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.submit('');
    });
  }

  /** Toạ độ con trỏ sau khi áp dụng bắt điểm và ORTHO. */
  private effectivePoint(): Vec {
    if (!this.cursorScreen) return [0, 0];
    if (this.snap) return this.snap.p;
    let w = this.vp.toWorld(this.cursorScreen[0], this.cursorScreen[1]);
    const base = this.pending?.tempBase ?? this.pending?.base;
    if (this.orthoOn && base && this.pending?.kind !== 'selection') {
      const d = sub(w, base);
      w = Math.abs(d[0]) >= Math.abs(d[1]) ? [w[0], base[1]] : [base[0], w[1]];
    }
    return w;
  }

  private updateHoverAndSnap(): void {
    if (!this.cursorScreen) return;
    const w = this.vp.toWorld(this.cursorScreen[0], this.cursorScreen[1]);
    const tol = 6 / this.vp.scale;
    if (!this.index) this.index = new GridIndex(this.doc.visible(), this.doc.extents());
    const r2 = 12 / this.vp.scale;
    const near = this.index
      .query({ minX: w[0] - r2, minY: w[1] - r2, maxX: w[0] + r2, maxY: w[1] + r2 })
      .filter((e) => {
        if (this.doc.layers.get(e.layer)?.visible === false || this.doc.get(e.id) !== e) return false;
        const b = bbox(e);
        return w[0] >= b.minX - tol * 2 && w[0] <= b.maxX + tol * 2 && w[1] >= b.minY - tol * 2 && w[1] <= b.maxY + tol * 2;
      });

    // Đối tượng dưới con trỏ.
    let hov: number | null = null;
    let hd = tol;
    for (const e of near) {
      const d = distanceTo(e, w);
      if (d <= hd) {
        hd = d;
        hov = e.id;
      }
    }
    const picking = !this.pending || this.pending.kind === 'selection' || this.pending.kind === 'entity';
    this.hover = picking ? hov : null;

    // Bắt điểm (chỉ khi lệnh đang hỏi điểm).
    this.snap = null;
    if (!this.snapOn || picking || this.pending?.kind === 'string') return;
    const stol = 10 / this.vp.scale;
    let best: { p: Vec; kind: SnapKind } | null = null;
    let bd = stol;
    for (const e of near) {
      for (const s of snapPoints(e)) {
        const d = dist(s.p, w);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
    }
    const base = this.pending?.tempBase ?? this.pending?.base;
    if (base)
      for (const e of near) {
        const q = perpendicularFoot(e, base, w);
        if (q && dist(q, w) < bd * 0.8) {
          bd = dist(q, w);
          best = { p: q, kind: 'perp' };
        }
      }
    const cand = near.filter((e) => distanceTo(e, w) < stol).slice(0, 25);
    for (let i = 0; i < cand.length; i++)
      for (let j = i + 1; j < cand.length; j++)
        for (const p of intersections(cand[i], cand[j])) {
          const d = dist(p, w);
          if (d < bd) {
            bd = d;
            best = { p, kind: 'int' };
          }
        }
    this.snap = best;
  }

  private leftDown(p: Vec, shift: boolean): void {
    const pd = this.pending;
    const w = this.effectivePoint();
    if (pd?.kind === 'entity') {
      if (this.hover !== null) this.resolvePending({ id: this.hover, p: this.vp.toWorld(p[0], p[1]) });
      else this.print('Hãy bấm trúng một đối tượng');
      return;
    }
    if (pd && pd.kind !== 'selection' && pd.kind !== 'string') {
      this.acceptPoint(w);
      return;
    }
    // Bấm vào grip của đối tượng đang chọn → sửa nhanh.
    if (!this.running && this.selection.size && this.selection.size <= 200) {
      for (const id of this.selection) {
        const e = this.doc.get(id);
        if (!e || !this.doc.isEditable(e)) continue;
        const gi = gripPoints(e).findIndex((g) => dist(this.vp.toScreen(g), p) <= 6);
        if (gi >= 0) return void this.startGrip(id, gi);
      }
    }
    // Đang kéo khung theo kiểu bấm-bấm → lần bấm thứ hai kết thúc.
    if (this.box) {
      this.box.b = this.vp.toWorld(p[0], p[1]);
      this.finishBox(shift);
      return;
    }
    if (this.hover !== null) {
      const id = this.hover;
      if (shift) this.selection.delete(id);
      else this.selection.add(id);
      this.redraw();
      if (pd?.kind === 'selection' && pd.single && !shift) this.resolvePending([id]);
      else if (pd?.kind === 'selection') this.print(`Đã chọn ${this.selection.size} đối tượng`);
      return;
    }
    const a = this.vp.toWorld(p[0], p[1]);
    this.box = { a, b: a, startPx: p, dragging: false };
  }

  private finishBox(remove: boolean): void {
    if (!this.box) return;
    const { a, b } = this.box;
    this.box = null;
    const crossing = b[0] < a[0];
    const box = { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
    let n = 0;
    for (const e of this.doc.visible()) {
      if (crossing ? touchesBox(e, box) : insideBox(e, box)) {
        if (remove) this.selection.delete(e.id);
        else this.selection.add(e.id);
        n++;
      }
    }
    if (this.pending?.kind === 'selection') {
      this.print(`Tìm thấy ${n}, tổng đã chọn ${this.selection.size}`);
      if (this.pending.single && this.selection.size) this.resolvePending([...this.selection].slice(0, 1));
    }
    this.redraw();
  }

  // ---------- Bàn phím ----------

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' && document.activeElement !== this.input) this.spaceDown = true;
      // Đang mở hộp thoại: để hộp thoại tự xử lý phím (Esc đóng hộp).
      if (this.root.querySelector('dialog[open]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F1') {
        e.preventDefault();
        this.showHelp();
      } else if (e.key === 'F3') {
        e.preventDefault();
        this.toggle('snap');
      } else if (e.key === 'F7') {
        e.preventDefault();
        this.toggle('grid');
      } else if (e.key === 'F8') {
        e.preventDefault();
        this.toggle('ortho');
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        this.redo();
      } else if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.showPlot();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveDxf();
      } else if (mod && e.key.toLowerCase() === 'a' && document.activeElement !== this.input) {
        e.preventDefault();
        this.doc.visible().forEach((x) => this.selection.add(x.id));
        this.redraw();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.input.value = '';
        if (this.running) this.cancel();
        else {
          this.selection.clear();
          this.box = null;
          this.redraw();
        }
      } else if (e.key === 'Delete' && !this.running && !this.input.value && this.selection.size) {
        e.preventDefault();
        void this.start('ERASE');
      } else if (document.activeElement !== this.input && e.key.length === 1 && !mod && !e.altKey && e.key !== ' ') {
        this.input.focus();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.spaceDown = false;
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || (e.key === ' ' && !(this.pending?.kind === 'string' && this.pending.spaces))) {
        e.preventDefault();
        const v = this.input.value;
        this.input.value = '';
        this.submit(v);
      } else if (e.key === 'ArrowUp' && !this.pending) {
        e.preventDefault();
        if (!this.cmdHistory.length) return;
        this.histIdx = this.histIdx < 0 ? this.cmdHistory.length - 1 : Math.max(0, this.histIdx - 1);
        this.input.value = this.cmdHistory[this.histIdx];
      } else if (e.key === 'ArrowDown' && !this.pending) {
        e.preventDefault();
        if (this.histIdx < 0) return;
        this.histIdx++;
        this.input.value = this.histIdx >= this.cmdHistory.length ? '' : this.cmdHistory[this.histIdx];
        if (this.histIdx >= this.cmdHistory.length) this.histIdx = -1;
      }
    });
  }

  // ---------- Dòng lệnh ----------

  private submit(raw: string): void {
    const text = raw.trim();
    const pd = this.pending;
    if (!this.running) {
      if (!text) {
        if (this.lastCmd) void this.start(this.lastCmd);
        return;
      }
      const up = text.toUpperCase();
      if (up === 'U' || up === 'UNDO') return void this.undo();
      if (up === 'REDO') return void this.redo();
      if (up === 'HELP' || up === '?') return void this.showHelp();
      if (up === 'NEW') return void this.action('new');
      if (up === 'PLOT' || up === 'PRINT' || up === 'EXPORTPDF') return void this.showPlot();
      if (up === 'LAYERS' || up === 'LAYMAN' || up === 'LA' || up === 'LAYER') return void this.showLayers();
      if (up === 'OPEN') return void this.action('open');
      if (up === 'SAVE' || up === 'SAVEAS' || up === 'QSAVE') return void this.saveDxf();
      this.cmdHistory.push(text);
      this.histIdx = -1;
      void this.start(text);
      return;
    }
    if (!pd) return;
    this.echo(text || '↵');
    const base = pd.tempBase ?? pd.base ?? null;

    // Từ khoá.
    if (text && pd.keywords?.length) {
      const k = pd.keywords.find((kw) => kw.toUpperCase().startsWith(text.toUpperCase()));
      if (k && !/^[-+\d.@]/.test(text)) return this.resolvePending(k);
    }

    switch (pd.kind) {
      case 'entity':
        if (!text) return this.resolvePending(null);
        this.print('Bấm vào một đối tượng trên màn hình (Enter để kết thúc)');
        return;
      case 'selection': {
        if (!text) return this.resolvePending([...this.selection]);
        const up = text.toUpperCase();
        if (up === 'ALL') {
          this.doc.visible().filter((e) => this.doc.isEditable(e)).forEach((e) => this.selection.add(e.id));
          this.print(`Đã chọn ${this.selection.size} đối tượng`);
          this.redraw();
          return;
        }
        this.print('Bấm vào đối tượng hoặc kéo khung; Enter để kết thúc; ALL để chọn tất cả');
        return;
      }
      case 'string':
        if (!raw.trim() && pd.def !== undefined) return this.resolvePending(String(pd.def));
        return this.resolvePending(raw.trim() || null);
      case 'point': {
        const r = parseInput(text, base);
        if (r.kind === 'empty') return pd.allowNone ? this.resolvePending(null) : undefined;
        if (r.kind === 'point') return this.resolvePending(r.p);
        if (r.kind === 'number' && base) {
          // Nhập khoảng cách trực tiếp theo hướng con trỏ.
          const c = this.cursorScreen ? this.effectivePoint() : null;
          const d = c ? sub(c, base) : ([1, 0] as Vec);
          const ang = len(d) > 1e-12 ? angleOf(d) : 0;
          return this.resolvePending(polar(base, ang, r.n));
        }
        this.print('Cần một điểm: x,y  ·  @dx,dy  ·  @dài<góc  ·  hoặc bấm trên màn hình');
        return;
      }
      case 'distance': {
        const r = parseInput(text, base);
        if (r.kind === 'empty') return pd.def !== undefined ? this.resolvePending(Number(pd.def)) : this.resolvePending(null);
        if (r.kind === 'number') return this.resolvePending(r.n);
        if (r.kind === 'point') return this.acceptPoint(r.p);
        this.print('Cần một số hoặc một điểm');
        return;
      }
      case 'angle': {
        const r = parseInput(text, base);
        if (r.kind === 'empty') return pd.def !== undefined ? this.resolvePending(Number(pd.def)) : this.resolvePending(null);
        if (r.kind === 'number') return this.resolvePending(r.n);
        if (r.kind === 'point') return this.acceptPoint(r.p);
        this.print('Cần một góc (độ) hoặc một điểm');
        return;
      }
    }
  }

  /** Người dùng bấm (hoặc gõ) một điểm khi lệnh đang chờ. */
  private acceptPoint(w: Vec): void {
    const pd = this.pending;
    if (!pd) return;
    if (pd.kind === 'point') return this.resolvePending(w);
    const base = pd.base ?? pd.tempBase;
    if (!base) {
      pd.tempBase = w;
      this.updatePrompt('Điểm thứ hai');
      return;
    }
    if (pd.kind === 'distance') return this.resolvePending(dist(base, w));
    if (pd.kind === 'angle') return this.resolvePending(normDeg(rad2deg(angleOf(sub(w, base)))));
  }

  private resolvePending(v: unknown): void {
    const pd = this.pending;
    if (!pd) return;
    this.pending = null;
    this.snap = null;
    pd.resolve(v);
  }

  private request<T>(kind: PendingKind, msg: string, extra: Partial<Pending>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending = { kind, msg, resolve: resolve as (v: unknown) => void, reject, ...extra };
      this.updatePrompt();
      this.updateHoverAndSnap();
      this.redraw();
    });
  }

  private io: IO = {
    getPoint: (msg, o = {}) => this.request('point', msg, { base: o.base, allowNone: o.allowNone, keywords: o.keywords, preview: o.preview }),
    getDistance: (msg, o = {}) => this.request('distance', msg, { base: o.base, def: o.def, preview: o.preview }),
    getAngle: (msg, o) => this.request('angle', msg, { base: o.base, def: o.def, preview: o.preview }),
    getString: (msg, o = {}) => this.request('string', msg, { def: o.def, spaces: o.spaces }),
    getSelection: (msg, o = {}) => this.request('selection', msg, { single: o.single }),
    getEntity: (msg, o = {}) => this.request('entity', msg, { keywords: o.keywords, allowNone: true }),
    print: (m) => this.print(m),
  };

  async start(name: string): Promise<void> {
    if (this.running) {
      this.cancel();
      await this.running;
    }
    const def = this.reg.resolve(name);
    if (!def) {
      this.print(`Không có lệnh "${name}". Gõ HELP để xem danh sách.`);
      return;
    }
    this.lastCmd = def.name;
    this.echo(def.name, true);
    this.launch(def.name, () => runInteractive(this.reg, this.ctx, this.io, def.name));
  }

  /** Chạy một luồng tương tác (lệnh hoặc sửa grip) với vòng đời chung. */
  private launch(name: string, flow: () => Promise<void>): void {
    this.runningName = name;
    this.running = flow()
      .catch((e) => {
        if (!(e instanceof CancelError)) this.print(`Lỗi: ${(e as Error).message}`);
      })
      .finally(() => {
        this.running = null;
        this.runningName = '';
        this.pending = null;
        this.snap = null;
        this.box = null;
        this.selection.clear();
        this.hotGrip = null;
        this.updatePrompt();
        this.redraw();
      });
  }

  /** Kéo grip: bấm điểm mới (có bắt điểm, ORTHO, nhập toạ độ). */
  private startGrip(id: number, i: number): void {
    const e = this.doc.get(id);
    if (!e) return;
    const base = gripPoints(e)[i];
    this.hotGrip = { id, i };
    this.launch('GRIP', async () => {
      const to = await this.io.getPoint('Điểm mới cho grip', {
        base,
        preview: (c) => {
          const { id: _id, ...rest } = applyGrip(e, i, c);
          return [rest as NewEntity];
        },
      });
      if (Array.isArray(to)) this.api.run('GRIPEDIT', { id, index: i, to });
    });
  }

  cancel(): void {
    const pd = this.pending;
    if (pd) {
      this.pending = null;
      pd.reject(new CancelError());
      this.print('*Huỷ*');
    }
  }

  private undo(): void {
    if (this.running) return this.print('Hãy kết thúc lệnh đang chạy trước (Esc).');
    const l = this.doc.undo();
    this.selection.clear();
    this.print(l ? `Hoàn tác: ${l}` : 'Không còn gì để hoàn tác');
  }

  private redo(): void {
    if (this.running) return;
    const l = this.doc.redo();
    this.print(l ? `Làm lại: ${l}` : 'Không còn gì để làm lại');
  }

  private updatePrompt(override?: string): void {
    const pd = this.pending;
    if (!pd) {
      this.promptEl.textContent = this.running ? `${this.runningName}:` : 'Lệnh:';
      return;
    }
    let s = `${this.runningName}: ${override ?? pd.msg}`;
    if (pd.keywords?.length) s += ` [${pd.keywords.join('/')}]`;
    if (pd.def !== undefined) s += ` <${pd.def}>`;
    this.promptEl.textContent = s + ':';
  }

  print(msg: string): void {
    for (const line of msg.split('\n')) {
      const d = document.createElement('div');
      d.textContent = line;
      this.historyEl.appendChild(d);
    }
    while (this.historyEl.childElementCount > 300) this.historyEl.firstElementChild!.remove();
    this.historyEl.scrollTop = this.historyEl.scrollHeight;
  }

  private echo(text: string, isCmd = false): void {
    const d = document.createElement('div');
    d.className = isCmd ? 'echo cmd' : 'echo';
    d.textContent = isCmd ? `Lệnh: ${text}` : `${this.promptEl.textContent} ${text}`;
    this.historyEl.appendChild(d);
    this.historyEl.scrollTop = this.historyEl.scrollHeight;
  }

  // ---------- File & lưu tạm ----------

  private saveDxf(): void {
    this.download(writeDxf(this.doc.toData()), this.fileName, 'application/dxf');
    this.doc.dirty = false;
    this.print(`Đã lưu ${this.fileName} (${this.doc.entities.size} đối tượng).`);
  }

  private autosave(): void {
    store.set('mhcad.autosave', JSON.stringify({ name: this.fileName, data: this.doc.toData() }));
  }

  private restore(): boolean {
    const raw = store.get('mhcad.autosave');
    if (!raw) return false;
    try {
      const { name, data } = JSON.parse(raw);
      if (data?.format !== 'mhcad' || !data.entities?.length) return false;
      this.doc.load(data);
      this.fileName = name || this.fileName;
      this.zoomExtents();
      this.print(`Đã khôi phục bản vẽ lưu tạm (${data.entities.length} đối tượng).`);
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Quản lý layer ----------

  private showLayers(): void {
    const dlg = this.root.querySelector<HTMLDialogElement>('#layers')!;
    const fg = THEMES[this.themeName].fg;
    const render = () => {
      const counts = new Map<string, number>();
      for (const e of this.doc.all()) counts.set(e.layer, (counts.get(e.layer) ?? 0) + 1);
      const lts = [...this.doc.linetypes.keys()];
      const rows = [...this.doc.layers.values()]
        .sort((a, b) => (a.name === '0' ? -1 : b.name === '0' ? 1 : a.name.localeCompare(b.name, 'vi')))
        .map((l) => {
          const cur = l.name === this.doc.currentLayer;
          const n = escapeHtml(l.name);
          return `<tr data-layer="${n}" class="${cur ? 'cur' : ''}">
            <td><button class="mini" data-op="current" title="Đặt làm hiện hành">${cur ? '●' : '○'}</button></td>
            <td class="name">${n}</td>
            <td><button class="mini" data-op="visible" aria-pressed="${l.visible}" title="Bật/tắt">${l.visible ? 'Bật' : 'Tắt'}</button></td>
            <td><button class="mini" data-op="locked" aria-pressed="${l.locked}" title="Khoá/mở">${l.locked ? 'Khoá' : 'Mở'}</button></td>
            <td><span class="swatch" style="background:${aciToCss(l.color, fg)}"></span><input class="color" type="number" min="1" max="255" value="${l.color}" data-op="color" aria-label="Màu ACI" /></td>
            <td><select data-op="linetype" aria-label="Kiểu đường">${lts.map((t) => `<option ${t === (l.lt ?? 'CONTINUOUS') ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
            <td class="num">${counts.get(l.name) ?? 0}</td>
            <td><button class="mini" data-op="rename" title="Đổi tên">Đổi tên</button><button class="mini danger" data-op="delete" title="Xoá layer và đối tượng trên đó">Xoá</button></td>
          </tr>`;
        })
        .join('');
      dlg.innerHTML = `
        <div class="help layers">
          <header><h2>Quản lý layer</h2><button class="close" aria-label="Đóng">✕</button></header>
          <form class="newlayer"><input name="name" placeholder="Tên layer mới" aria-label="Tên layer mới" required />
            <input name="color" type="number" min="1" max="255" value="7" aria-label="Màu ACI" />
            <button type="submit">Thêm</button></form>
          <div class="tablewrap"><table>
            <thead><tr><th></th><th>Tên</th><th>Hiện</th><th>Khoá</th><th>Màu</th><th>Kiểu đường</th><th>Số ĐT</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table></div>
          <p class="note">Màu theo mã ACI: 1 đỏ · 2 vàng · 3 xanh lá · 4 lục lam · 5 xanh dương · 6 tím · 7 trắng/đen · 8–9 xám.
          LTSCALE hiện tại: ${this.doc.ltscale} (đổi bằng lệnh LTSCALE).</p>
        </div>`;
      dlg.querySelector('.close')!.addEventListener('click', () => dlg.close());
      dlg.querySelector<HTMLFormElement>('.newlayer')!.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target as HTMLFormElement);
        this.tryRun('LAYER', { name: String(f.get('name')).trim(), color: Number(f.get('color')) || 7, current: false });
        render();
      });
      dlg.querySelectorAll<HTMLElement>('[data-op]').forEach((el) => {
        const tr = el.closest<HTMLElement>('tr')!;
        const name = this.doc.layers.has(tr.dataset.layer!) ? tr.dataset.layer! : [...this.doc.layers.keys()].find((k) => escapeHtml(k) === tr.dataset.layer)!;
        const l = this.doc.layers.get(name)!;
        const op = el.dataset.op!;
        const evName = el.tagName === 'BUTTON' ? 'click' : 'change';
        el.addEventListener(evName, () => {
          if (op === 'current') this.tryRun('LAYER', { name });
          else if (op === 'visible') this.tryRun('LAYER', { name, visible: !l.visible, current: false });
          else if (op === 'locked') this.tryRun('LAYER', { name, locked: !l.locked, current: false });
          else if (op === 'color') this.tryRun('LAYER', { name, color: Number((el as HTMLInputElement).value), current: false });
          else if (op === 'linetype') this.tryRun('LAYER', { name, linetype: (el as HTMLSelectElement).value, current: false });
          else if (op === 'rename') {
            const to = prompt(`Tên mới cho layer "${name}"`, name);
            if (to && to !== name) this.tryRun('LAYER', { name, newName: to });
          } else if (op === 'delete') {
            const n = this.doc.all().filter((e) => e.layer === name).length;
            if (confirm(`Xoá layer "${name}"${n ? ` và ${n} đối tượng trên đó` : ''}? (có thể hoàn tác bằng U)`)) this.tryRun('LAYDEL', { name });
          }
          render();
        });
      });
    };
    render();
    dlg.addEventListener('close', () => this.input.focus(), { once: true });
    if (!dlg.open) dlg.showModal();
  }

  private tryRun(cmd: string, args: Record<string, unknown>): void {
    try {
      const r = this.api.run(cmd, args);
      if (r.message) this.print(r.message);
    } catch (e) {
      this.print((e as Error).message);
      alert((e as Error).message);
    }
  }

  // ---------- In / xuất ----------

  private plotArea(which: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (which === 'view') return this.vp.worldBox();
    return this.doc.extents();
  }

  private showPlot(): void {
    const dlg = this.root.querySelector<HTMLDialogElement>('#plot')!;
    dlg.innerHTML = `
      <form class="help plot" method="dialog">
        <header><h2>In / xuất PDF</h2><button type="button" class="close" aria-label="Đóng">✕</button></header>
        <div class="grid">
          <label>Khổ giấy <select name="paper">${Object.keys(PAPERS).map((k) => `<option ${k === 'A3' ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          <label>Hướng <select name="orient"><option value="l">Ngang</option><option value="p">Dọc</option></select></label>
          <label>Vùng in <select name="area"><option value="extents">Toàn bộ bản vẽ</option><option value="view">Khung nhìn hiện tại</option></select></label>
          <label>Tỉ lệ 1: <input name="scale" type="number" min="0" step="any" placeholder="vừa khổ" /></label>
          <label>Nét (mm) <input name="lw" type="number" min="0.05" step="0.05" value="0.18" /></label>
          <label class="check"><input name="mono" type="checkbox" checked /> In đen trắng</label>
        </div>
        <p class="note" id="plotinfo"></p>
        <div class="buttons"><button type="button" data-do="svg">Tải SVG</button><button type="button" data-do="print" class="primary">In / Lưu PDF…</button></div>
        <p class="note">Ở hộp thoại in của trình duyệt, chọn máy in hoặc “Lưu dưới dạng PDF”, đặt lề = Không, tỉ lệ = 100%.</p>
      </form>`;
    const form = dlg.querySelector('form')!;
    const read = () => {
      const f = new FormData(form);
      const box = this.plotArea(String(f.get('area')));
      if (!box) return null;
      const sc = Number(f.get('scale'));
      return plotSvg(this.doc, {
        box,
        paper: String(f.get('paper')) as keyof typeof PAPERS,
        landscape: f.get('orient') === 'l',
        ...(sc > 0 ? { scale: sc } : {}),
        mono: f.get('mono') === 'on',
        lineMm: Number(f.get('lw')) || 0.18,
        aci: (i) => aciToCss(i, '#000'),
      });
    };
    const info = () => {
      const r = read();
      dlg.querySelector('#plotinfo')!.textContent = r
        ? `Khổ ${fmt(r.widthMm)} × ${fmt(r.heightMm)} mm · tỉ lệ thực tế 1:${fmt(r.scale)}${this.doc.units !== 'mm' ? ` (đơn vị bản vẽ: ${this.doc.units})` : ''}`
        : 'Bản vẽ trống';
    };
    form.addEventListener('input', info);
    info();
    dlg.querySelector('.close')!.addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-do="svg"]')!.addEventListener('click', () => {
      const r = read();
      if (r) this.download(r.svg, this.fileName.replace(/\.dxf$/i, '.svg'), 'image/svg+xml');
    });
    dlg.querySelector('[data-do="print"]')!.addEventListener('click', () => {
      const r = read();
      if (!r) return;
      dlg.close();
      this.printSvg(r.svg, r.widthMm, r.heightMm);
    });
    dlg.addEventListener('close', () => this.input.focus(), { once: true });
    dlg.showModal();
  }

  private printSvg(svg: string, w: number, h: number): void {
    const frame = this.root.querySelector<HTMLIFrameElement>('#printframe')!;
    const d = frame.contentDocument!;
    d.open();
    d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(this.fileName)}</title>
      <style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${w}mm;height:${h}mm}</style>
      </head><body>${svg}</body></html>`);
    d.close();
    setTimeout(() => {
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
    }, 100);
  }

  private exportSvg(): void {
    const box = this.doc.extents();
    if (!box) return this.print('Bản vẽ trống');
    const r = plotSvg(this.doc, { box, paper: 'A3', landscape: true, mono: false, aci: (i) => aciToCss(i, '#000') });
    this.download(r.svg, this.fileName.replace(/\.dxf$/i, '.svg'), 'image/svg+xml');
    this.print(`Đã xuất SVG (vừa khổ A3, tỉ lệ 1:${fmt(r.scale)})`);
  }

  private download(content: string, name: string, type: string): void {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- Trợ giúp ----------

  private showHelp(): void {
    const dlg = this.root.querySelector<HTMLDialogElement>('#help')!;
    const rows = this.reg
      .list()
      .map((c) => `<tr><td><b>${c.name}</b></td><td>${(c.aliases ?? []).join(', ')}</td><td>${escapeHtml(c.desc)}</td></tr>`)
      .join('');
    dlg.innerHTML = `
      <div class="help">
        <header><h2>Trợ giúp MHCAD</h2><button class="close" aria-label="Đóng">✕</button></header>
        <h3>Nhập toạ độ</h3>
        <ul>
          <li><code>x,y</code> toạ độ tuyệt đối · <code>@dx,dy</code> tương đối · <code>@dài&lt;góc</code> toạ độ cực</li>
          <li>Gõ một số khi đang vẽ: đi theo hướng con trỏ đúng khoảng cách đó (bật ORTHO để vẽ thẳng)</li>
          <li>Enter / Space / chuột phải: kết thúc hoặc lặp lại lệnh trước · Esc: huỷ</li>
        </ul>
        <h3>Chuột &amp; phím</h3>
        <ul>
          <li>Lăn chuột: phóng to/thu nhỏ · Giữ nút giữa (hoặc Space + kéo): di chuyển màn hình · Bấm đúp nút giữa: xem toàn bộ</li>
          <li>Kéo trái → phải: chọn đối tượng nằm trọn trong khung · phải → trái: chọn cả đối tượng chạm khung · Shift + bấm: bỏ chọn</li>
          <li>F3 bắt điểm · F7 lưới · F8 vuông góc · Ctrl+Z / Ctrl+Y hoàn tác / làm lại · Ctrl+S lưu DXF · Delete xoá</li>
          <li>Lệnh khác: <code>U</code> hoàn tác, <code>REDO</code>, <code>NEW</code>, <code>OPEN</code>, <code>SAVE</code></li>
        </ul>
        <h3>Danh sách lệnh</h3>
        <table><thead><tr><th>Lệnh</th><th>Gõ tắt</th><th>Mô tả</th></tr></thead><tbody>${rows}</tbody></table>
        <h3>Điều khiển bằng script / trợ lý AI</h3>
        <p>Mở Console của trình duyệt (F12) hoặc để trợ lý AI dùng đối tượng <code>window.mhcad</code>:</p>
        <pre>mhcad.help()
mhcad.run('RECTANG', { p1: [0, 0], p2: [4000, 6000], layer: 'TUONG' })
mhcad.batch('Vẽ phòng', () => { /* nhiều lệnh → một lần hoàn tác */ })
mhcad.query.summary()</pre>
        <p class="note">MHCAD là phần mềm độc lập, mã nguồn mở (GPL-3.0). Không liên kết với Autodesk hay Trimble. DXF là định dạng trao đổi có đặc tả công khai.</p>
      </div>`;
    dlg.querySelector('.close')!.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => this.input.focus(), { once: true });
    dlg.showModal();
  }
}

const fmt = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
