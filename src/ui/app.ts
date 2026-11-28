// Bộ điều khiển giao diện: chuột/bàn phím, dòng lệnh, bắt điểm, chọn đối tượng.

import { type Vec, angleOf, dist, len, polar, rad2deg, sub } from '../core/geom';
import { type DocState, type DrawingData, Drawing } from '../core/document';
import {
  type Ctx,
  type IO,
  type PointOpts,
  CancelError,
  type Registry,
  runInteractive,
} from '../core/commands';
import { type Entity, type NewEntity, type SnapKind, applyGrip, moveEnt, bbox, distanceTo, gripPoints, insideBox, intersections, perpendicularFoot, tangentPoints, snapPoints, touchesBox } from '../core/entities';
import { normDeg } from '../core/entities';
import { parseInput } from '../core/input';
import { type MhcadApi, createApi } from '../core/api';
import { decodeDxfBytes, readDxf, writeDxf } from '../core/dxf';
import { createRegistry } from '../core/registry';
import { GridIndex } from '../core/spatial';
import { isDwg } from '../core/dwg';
import { renderProps } from './props';
import { PAPERS, plotSvg } from '../core/svg';
import { type Theme, Viewport, aciToCss, render } from './view';
import { ICONS, LOGO } from './icons';

export const VERSION = '0.4.0';

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
  'LINE', 'PLINE', 'XLINE', 'MLINE', 'RECTANG', 'POLYGON', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE', 'REVCLOUD', 'TEXT', 'MTEXT', '|',
  'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'STRETCH', 'ARRAY', 'OFFSET', 'TRIM', 'EXTEND', 'FILLET', 'CHAMFER', 'BREAK', 'JOIN', 'EXPLODE', 'ERASE', '|',
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
  ELLIPSE: 'Elip (EL)',
  MLINE: 'Tường 2 nét (ML)',
  STRETCH: 'Kéo giãn (S)',
  ARRAY: 'Mảng chữ nhật / tròn (AR)',
  LIST: 'Thông tin đối tượng (LI)',
  XLINE: 'Đường dựng vô hạn (XL)',
  SPLINE: 'Đường cong trơn (SPL)',
  REVCLOUD: 'Đường mây (RC)',
  MTEXT: 'Chữ nhiều dòng (MT)',
};

interface DocTab {
  name: string;
  state: DocState | null;
  /** Dữ liệu JSON chụp khi rời tab (để lưu tạm mà không phải dựng lại). */
  json?: string;
  view: { scale: number; cx: number; cy: number } | null;
}

type MenuItem = { label: string; cmd?: string; act?: string; key?: string } | '-';

/** Thanh menu (bố cục riêng của MHCAD). cmd = lệnh, act = thao tác giao diện. */
const MENUS: { label: string; items: MenuItem[] }[] = [
  {
    label: 'Tệp',
    items: [
      { label: 'Bản vẽ mới', act: 'new' },
      { label: 'Mở DXF / DWG…', act: 'open', key: 'Ctrl+O' },
      { label: 'Đóng bản vẽ', act: 'close' },
      { label: 'Đóng tất cả', cmd: 'CLOSEALL' },
      '-',
      { label: 'Lưu ra DXF', act: 'save', key: 'Ctrl+S' },
      { label: 'Lưu thành…', cmd: 'SAVEAS' },
      { label: 'Lưu tất cả', cmd: 'SAVEALL' },
      { label: 'Ghi đối tượng ra tệp (WBLOCK)', cmd: 'WBLOCK' },
      '-',
      { label: 'In / xuất PDF…', act: 'plot', key: 'Ctrl+P' },
      { label: 'Xuất SVG', act: 'svg' },
      { label: 'Xuất ảnh PNG', cmd: 'PNGOUT' },
      '-',
      { label: 'Đơn vị bản vẽ', cmd: 'UNITS' },
      { label: 'Dọn bản vẽ (PURGE)', cmd: 'PURGE' },
      { label: 'Tình trạng bản vẽ', cmd: 'STATUS' },
    ],
  },
  {
    label: 'Sửa',
    items: [
      { label: 'Hoàn tác', act: 'undo', key: 'Ctrl+Z' },
      { label: 'Làm lại', act: 'redo', key: 'Ctrl+Y' },
      { label: 'Hoàn tác nhiều bước', cmd: 'UNDO' },
      '-',
      { label: 'Cắt', cmd: 'CUTCLIP', key: 'Ctrl+X' },
      { label: 'Sao chép', act: 'copy', key: 'Ctrl+C' },
      { label: 'Sao chép kèm điểm gốc', cmd: 'COPYBASE', key: 'Ctrl+Shift+C' },
      { label: 'Dán', act: 'paste', key: 'Ctrl+V' },
      { label: 'Dán thành block', cmd: 'PASTEBLOCK', key: 'Ctrl+Shift+V' },
      { label: 'Dán đúng toạ độ gốc', cmd: 'PASTEORIG' },
      '-',
      { label: 'Xoá', cmd: 'ERASE', key: 'Del' },
      { label: 'Lấy lại đối tượng vừa xoá', cmd: 'OOPS' },
      { label: 'Chọn tất cả', act: 'selectall', key: 'Ctrl+A' },
      { label: 'Chọn nhanh theo điều kiện', cmd: 'QSELECT' },
      { label: 'Chọn đối tượng giống', cmd: 'SELECTSIMILAR' },
      '-',
      { label: 'Tìm & thay chữ', cmd: 'FIND' },
    ],
  },
  {
    label: 'Xem',
    items: [
      { label: 'Xem toàn bộ', act: 'extents', key: 'Z ↵ ↵' },
      { label: 'Phóng to', act: 'zoomin' },
      { label: 'Thu nhỏ', act: 'zoomout' },
      { label: 'Vẽ lại', cmd: 'REGEN' },
      '-',
      { label: 'Ẩn đối tượng', cmd: 'HIDEOBJECTS' },
      { label: 'Cô lập đối tượng', cmd: 'ISOLATEOBJECTS' },
      { label: 'Hiện lại đối tượng', cmd: 'UNISOLATEOBJECTS' },
      '-',
      { label: 'Toàn màn hình vẽ', cmd: 'CLEANSCREENON', key: 'Ctrl+0' },
      { label: 'Lịch sử lệnh', cmd: 'TEXTSCR', key: 'F2' },
      { label: 'Bảng thuộc tính', act: 'props', key: 'Ctrl+1' },
      { label: 'Nền sáng / tối', act: 'theme' },
    ],
  },
  {
    label: 'Chèn',
    items: [
      { label: 'Tạo block', cmd: 'BLOCK' },
      { label: 'Chèn block', cmd: 'INSERT' },
      { label: 'Thay block', cmd: 'BLOCKREPLACE' },
      { label: 'Đếm block', cmd: 'BCOUNT' },
      '-',
      { label: 'Bảng', cmd: 'TABLE' },
      { label: 'Góp ý (đám mây + ghi chú)', cmd: 'GOPY' },
    ],
  },
  {
    label: 'Định dạng',
    items: [
      { label: 'Quản lý layer', act: 'layers' },
      { label: 'Màu hiện hành', cmd: 'COLOR' },
      { label: 'Kiểu đường hiện hành', cmd: 'CELTYPE' },
      { label: 'Tỉ lệ kiểu đường', cmd: 'LTSCALE' },
      { label: 'Kiểu kích thước', cmd: 'DIMSTYLE' },
      { label: 'Đổi tên layer / block', cmd: 'RENAME' },
      '-',
      { label: 'Tắt layer của đối tượng', cmd: 'LAYOFF' },
      { label: 'Cô lập layer', cmd: 'LAYISO' },
      { label: 'Bỏ cô lập layer', cmd: 'LAYUNISO' },
      { label: 'Bật mọi layer', cmd: 'LAYON' },
      { label: 'Khoá layer của đối tượng', cmd: 'LAYLCK' },
      { label: 'Mở khoá layer của đối tượng', cmd: 'LAYULK' },
      { label: 'Layer của đối tượng thành hiện hành', cmd: 'LAYMCUR' },
      { label: 'Đưa đối tượng về layer hiện hành', cmd: 'LAYCUR' },
      { label: 'Đổi sang layer của đối tượng mẫu', cmd: 'LAYMCH' },
      { label: 'Chép sang layer khác', cmd: 'COPYTOLAYER' },
      { label: 'Gộp layer', cmd: 'LAYMRG' },
    ],
  },
  {
    label: 'Công cụ',
    items: [
      { label: 'Khoảng cách', cmd: 'DIST' },
      { label: 'Diện tích', cmd: 'AREA' },
      { label: 'Toạ độ điểm', cmd: 'ID' },
      { label: 'Tính chất vùng kín', cmd: 'MASSPROP' },
      { label: 'Thông tin đối tượng', cmd: 'LIST' },
      { label: 'Máy tính', cmd: 'CAL' },
      '-',
      { label: 'Đặt biến bản vẽ', cmd: 'SETVAR' },
      { label: 'Bắt điểm', act: 'snap', key: 'F3' },
      { label: 'Lưới', act: 'grid', key: 'F7' },
      { label: 'Vuông góc', act: 'ortho', key: 'F8' },
      { label: 'Dóng theo góc', act: 'polar', key: 'F10' },
    ],
  },
  {
    label: 'Vẽ',
    items: [
      { label: 'Đoạn thẳng', cmd: 'LINE' },
      { label: 'Đa tuyến', cmd: 'PLINE' },
      { label: 'Đường dựng', cmd: 'XLINE' },
      { label: 'Tia', cmd: 'RAY', key: 'RAY' },
      { label: 'Tường 2 nét', cmd: 'MLINE' },
      '-',
      { label: 'Hình chữ nhật', cmd: 'RECTANG' },
      { label: 'Đa giác đều', cmd: 'POLYGON' },
      { label: 'Đường tròn', cmd: 'CIRCLE' },
      { label: 'Cung tròn', cmd: 'ARC' },
      { label: 'Elip', cmd: 'ELLIPSE' },
      { label: 'Đường cong trơn', cmd: 'SPLINE' },
      { label: 'Vành khuyên', cmd: 'DONUT' },
      { label: 'Đường mây', cmd: 'REVCLOUD' },
      { label: 'Ký hiệu đường ngắt', cmd: 'BREAKLINE' },
      { label: 'Điểm', cmd: 'POINT' },
      { label: 'Chia đều', cmd: 'DIVIDE' },
      { label: 'Đo đoạn', cmd: 'MEASURE' },
      '-',
      { label: 'Tô vật liệu', cmd: 'HATCH' },
      { label: 'Đường biên vùng', cmd: 'BOUNDARY' },
      { label: 'Vùng che', cmd: 'WIPEOUT' },
      { label: 'Chữ một dòng', cmd: 'TEXT' },
      { label: 'Chữ nhiều dòng', cmd: 'MTEXT' },
    ],
  },
  {
    label: 'Kích thước',
    items: [
      { label: 'Kích thước nhanh', cmd: 'QDIM' },
      { label: 'Ngang / đứng', cmd: 'DIMLINEAR' },
      { label: 'Song song', cmd: 'DIMALIGNED' },
      { label: 'Chiều dài cung', cmd: 'DIMARC' },
      { label: 'Toạ độ', cmd: 'DIMORDINATE' },
      { label: 'Bán kính', cmd: 'DIMRADIUS' },
      { label: 'Đường kính', cmd: 'DIMDIAMETER' },
      { label: 'Góc', cmd: 'DIMANGULAR' },
      { label: 'Cùng gốc', cmd: 'DIMBASELINE' },
      { label: 'Nối tiếp', cmd: 'DIMCONTINUE' },
      { label: 'Dàn đều kích thước', cmd: 'DIMSPACE' },
      '-',
      { label: 'Đường dẫn ghi chú', cmd: 'MLEADER' },
      { label: 'Dấu tâm', cmd: 'CENTERMARK' },
      { label: 'Đường tâm', cmd: 'CENTERLINE' },
      '-',
      { label: 'Sửa chữ kích thước', cmd: 'DIMEDIT' },
      { label: 'Kiểu kích thước', cmd: 'DIMSTYLE' },
    ],
  },
  {
    label: 'Sửa đổi',
    items: [
      { label: 'Thuộc tính', act: 'props', key: 'Ctrl+1' },
      { label: 'Sao chép thuộc tính', cmd: 'MATCHPROP' },
      { label: 'Về ByLayer', cmd: 'SETBYLAYER' },
      '-',
      { label: 'Di chuyển', cmd: 'MOVE' },
      { label: 'Sao chép', cmd: 'COPY' },
      { label: 'Xoay', cmd: 'ROTATE' },
      { label: 'Tỉ lệ', cmd: 'SCALE' },
      { label: 'Đối xứng', cmd: 'MIRROR' },
      { label: 'Căn chỉnh', cmd: 'ALIGN' },
      { label: 'Kéo giãn', cmd: 'STRETCH' },
      { label: 'Đổi chiều dài', cmd: 'LENGTHEN' },
      { label: 'Mảng', cmd: 'ARRAY' },
      { label: 'Mảng dọc đường dẫn', cmd: 'ARRAYPATH' },
      { label: 'Offset song song', cmd: 'OFFSET' },
      '-',
      { label: 'Cắt bỏ', cmd: 'TRIM' },
      { label: 'Kéo dài', cmd: 'EXTEND' },
      { label: 'Bo góc', cmd: 'FILLET' },
      { label: 'Vát góc', cmd: 'CHAMFER' },
      { label: 'Bẻ gãy', cmd: 'BREAK' },
      { label: 'Cắt tại điểm', cmd: 'BREAKATPOINT' },
      { label: 'Nối', cmd: 'JOIN' },
      { label: 'Sửa đa tuyến', cmd: 'PEDIT' },
      { label: 'Đảo chiều', cmd: 'REVERSE' },
      { label: 'Phá khối', cmd: 'EXPLODE' },
      { label: 'Xoá trùng', cmd: 'OVERKILL' },
      '-',
      { label: 'Thứ tự vẽ', cmd: 'DRAWORDER' },
      { label: 'Sửa vùng tô', cmd: 'HATCHEDIT' },
      { label: 'Sửa chữ', cmd: 'DDEDIT' },
    ],
  },
  {
    label: 'Express',
    items: [
      { label: 'Đổi chiều cao chữ hàng loạt', cmd: 'SCALETEXT' },
      { label: 'Đánh số chữ', cmd: 'TCOUNT' },
      { label: 'Đổi chữ hoa / thường', cmd: 'TCASE' },
      { label: 'Xoay chữ cho dễ đọc', cmd: 'TORIENT' },
      { label: 'Gộp chữ thành chữ nhiều dòng', cmd: 'TXT2MTXT' },
      { label: 'Đổi điểm canh chữ', cmd: 'JUSTIFYTEXT' },
      { label: 'Bao chữ bằng hình', cmd: 'TCIRCLE' },
      { label: 'Che nền dưới chữ', cmd: 'TEXTMASK' },
      { label: 'Bỏ che nền chữ', cmd: 'TEXTUNMASK' },
      { label: 'Chữ & kích thước lên trên', cmd: 'TEXTTOFRONT' },
      { label: 'Hatch xuống dưới', cmd: 'HATCHTOBACK' },
    ],
  },
  {
    label: 'Trợ giúp',
    items: [
      { label: 'Trợ giúp & danh sách lệnh', act: 'help', key: 'F1' },
      { label: 'Giới thiệu', cmd: 'ABOUT' },
      { label: 'Mã nguồn (GitHub)', act: 'source' },
    ],
  },
];

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
  private polarOn = true;
  private polarInc = 45;
  /** Tia dóng theo góc POLAR đang bắt (để vẽ đường gióng). */
  private track: { from: Vec; angle: number } | null = null;
  private propsOpen = false;
  private propsSig = '';
  private acItems: string[] = [];
  private acIdx = -1;
  private cursorScreen: Vec | null = null;
  private hover: number | null = null;
  private snap: { p: Vec; kind: SnapKind } | null = null;
  private box: { a: Vec; b: Vec; startPx: Vec; dragging: boolean } | null = null;
  private pan: { last: Vec } | null = null;
  private touches = new Map<number, Vec>();
  private pinch: { d: number; mid: Vec } | null = null;
  private hotGrip: { id: number; i: number } | null = null;
  private index: GridIndex | null = null;
  private xlines: Entity[] = [];
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
  /** Các bản vẽ đang mở (tab). Bản vẽ đang hoạt động nằm trong this.doc, state = null. */
  private tabs: DocTab[] = [{ name: 'ban-ve.dxf', state: null, view: null }];
  private activeTab = 0;
  private shownDirty = false;
  private menuOpen: HTMLElement | null = null;
  private get fileName(): string {
    return this.tabs[this.activeTab].name;
  }
  private set fileName(v: string) {
    this.tabs[this.activeTab].name = v;
    this.renderTabs();
  }
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
      ui: (a, args) => this.uiAction(a, args),
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
        <nav class="menubar" aria-label="Menu">${MENUS.map((m, i) => `<button data-menu="${i}">${m.label}</button>`).join('')}</nav>
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
          <button data-act="layers" title="Quản lý layer (LA)">${ICONS.layers}</button>
          <button data-act="props" title="Bảng thuộc tính (Ctrl+1)">${ICONS.props}</button>
          <button data-act="theme" title="Đổi nền sáng/tối">${ICONS.theme}</button>
          <button data-act="help" title="Trợ giúp (F1)">${ICONS.help}</button>
        </div>
      </header>
      <div class="tabsrow">
        <div class="tabs" id="tabs" role="tablist" aria-label="Bản vẽ đang mở"></div>
        <div class="propbar" aria-label="Thuộc tính hiện hành">
          <label class="layer" title="Layer hiện hành (đang chọn đối tượng: chuyển chúng sang layer này)"><span class="dot"></span><select id="layer"></select></label>
          <label class="layer prop" title="Màu hiện hành (đang chọn đối tượng: đổi màu chúng)"><span class="dot" id="colordot"></span><select id="colorsel"></select></label>
          <label class="layer prop" title="Kiểu đường hiện hành (đang chọn đối tượng: đổi kiểu đường chúng)"><select id="ltsel"></select></label>
        </div>
      </div>
      <nav class="toolbar" aria-label="Công cụ">
        ${TOOLS.map((t) => (t === '|' ? '<span class="sep"></span>' : `<button data-cmd="${t}" title="${TOOL_LABEL[t]}">${ICONS[t]}</button>`)).join('')}
      </nav>
      <main class="stage"><canvas id="cv" aria-label="Vùng vẽ"></canvas>
        <div class="dyn" id="dyn" hidden></div>
        <input class="inline-edit" id="inline" hidden aria-label="Sửa chữ" />
        <aside class="props" id="props" hidden aria-label="Thuộc tính"></aside>
      </main>
      <section class="cmdline">
        <div class="history" id="history" aria-live="polite"></div>
        <ul class="ac" id="ac" role="listbox" hidden></ul>
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
          <button data-toggle="polar" title="Dóng theo góc 45° (F10)">POLAR</button>
          <button data-toggle="grid" title="Lưới (F7)">GRID</button>
        </span>
        <span class="units" id="units">mm</span>
      </footer>
      <input type="file" id="file" accept=".dxf,.DXF,.dwg,.DWG" hidden />
      <dialog id="help"></dialog>
      <dialog id="layers"></dialog>
      <dialog id="plot"></dialog>
      <dialog id="textdlg" class="textdlg"><form method="dialog"><h3 id="textdlg-title">Nội dung chữ</h3>
        <textarea id="textdlg-area" rows="6" spellcheck="false"></textarea>
        <p class="muted small">Enter xuống dòng · Ctrl+Enter để xong</p>
        <div class="row-end"><button value="cancel" type="submit">Huỷ</button><button value="ok" type="submit" class="primary">Xong</button></div>
      </form></dialog>
      <div class="menu-pop" id="menupop" role="menu" hidden></div>
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
    this.bindMenus();
    this.renderTabs();
    this.bindCanvas();
    this.bindKeys();

    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement!);
    this.resize();

    this.doc.onChange(() => {
      this.index = null;
      if (this.doc.dirty !== this.shownDirty) {
        this.shownDirty = this.doc.dirty;
        this.renderTabs();
      }
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
      b.addEventListener('click', () => this.toggle(b.dataset.toggle as 'snap' | 'ortho' | 'grid' | 'polar')),
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
    // Thanh thuộc tính: màu & kiểu đường (cho đối tượng chọn, hoặc hiện hành cho đối tượng mới).
    const colorSel = this.root.querySelector<HTMLSelectElement>('#colorsel')!;
    const ltSel = this.root.querySelector<HTMLSelectElement>('#ltsel')!;
    const applyProp = (key: 'color' | 'linetype', v: string) => {
      try {
        if (v === 'OTHER') {
          const c = prompt('Số màu ACI (1–255)', '8');
          if (!c) return this.refreshLayers();
          v = c;
        }
        if (this.selection.size && !this.running) {
          this.print(this.api.run('CHPROP', { ids: [...this.selection], [key]: v }).message!);
          this.selection.clear();
        } else this.print(this.api.run(key === 'color' ? 'COLOR' : 'CELTYPE', { [key]: v }).message!);
      } catch (e) {
        this.print((e as Error).message);
      }
      this.refreshLayers();
      this.input.focus();
    };
    colorSel.addEventListener('change', () => applyProp('color', colorSel.value));
    ltSel.addEventListener('change', () => applyProp('linetype', ltSel.value));
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
        if (this.doc.entities.size || this.doc.dirty) await this.newTab();
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
        void this.newTab().then(() => this.print('Bản vẽ mới (tab mới).'));
        break;
      case 'close':
        void this.closeTab(this.activeTab);
        break;
      case 'copy':
        if (this.selection.size) this.copySelection();
        else this.print('Chưa chọn đối tượng để sao chép.');
        break;
      case 'paste':
        void this.pasteClip();
        break;
      case 'selectall':
        this.doc.visible().forEach((x) => this.selection.add(x.id));
        this.redraw();
        break;
      case 'zoomin':
      case 'zoomout':
        this.vp.zoomAt(this.vp.w / 2, this.vp.h / 2, act === 'zoomin' ? 1.5 : 1 / 1.5);
        this.redraw();
        break;
      case 'snap':
      case 'ortho':
      case 'grid':
      case 'polar':
        this.toggle(act);
        break;
      case 'source':
        window.open('https://github.com/mhtiny3ds-a11y/mh_cad_su', '_blank', 'noopener');
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
      case 'props':
        this.toggleProps();
        break;
      case 'plot':
        this.showPlot();
        return;
      case 'svg':
        this.exportSvg();
        break;
    }
    this.input.focus();
  }

  private toggle(k: 'snap' | 'ortho' | 'grid' | 'polar'): void {
    if (k === 'snap') this.snapOn = !this.snapOn;
    if (k === 'ortho') {
      this.orthoOn = !this.orthoOn;
      if (this.orthoOn) this.polarOn = false;
    }
    if (k === 'polar') {
      this.polarOn = !this.polarOn;
      if (this.polarOn) this.orthoOn = false;
    }
    if (k === 'grid') this.showGrid = !this.showGrid;
    const v = { snap: this.snapOn, ortho: this.orthoOn, grid: this.showGrid, polar: this.polarOn }[k];
    this.print(`${k.toUpperCase()} ${v ? 'bật' : 'tắt'}`);
    this.refreshToggles();
    this.redraw();
    this.input.focus();
  }

  private refreshToggles(): void {
    const on = { snap: this.snapOn, ortho: this.orthoOn, grid: this.showGrid, polar: this.polarOn };
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
    // Màu & kiểu đường hiện hành.
    const colorSel = this.root.querySelector<HTMLSelectElement>('#colorsel');
    const ltSel = this.root.querySelector<HTMLSelectElement>('#ltsel');
    if (colorSel && ltSel) {
      const cur = this.doc.getVar<number | undefined>('CECOLOR', undefined);
      const base = [1, 2, 3, 4, 5, 6, 7, 8, 9, 30, 40, 140, 250];
      const list = cur !== undefined && !base.includes(cur) ? [...base, cur] : base;
      const names: Record<number, string> = { 1: 'Đỏ', 2: 'Vàng', 3: 'Xanh lá', 4: 'Lục lam', 5: 'Xanh dương', 6: 'Tím', 7: 'Trắng/Đen', 8: 'Xám', 9: 'Xám nhạt', 30: 'Cam', 40: 'Cam vàng', 140: 'Xanh trời', 250: 'Xám đậm' };
      const csig = `${cur}|${this.themeName}`;
      if (colorSel.dataset.sig !== csig) {
        colorSel.innerHTML =
          `<option value="BYLAYER">ByLayer</option>` +
          list.map((c) => `<option value="${c}">${c} ${names[c] ?? ''}</option>`).join('') +
          `<option value="OTHER">Màu khác…</option>`;
        colorSel.dataset.sig = csig;
      }
      colorSel.value = cur === undefined ? 'BYLAYER' : String(cur);
      const dotc = this.root.querySelector<HTMLElement>('#colordot');
      if (dotc) dotc.style.background = aciToCss(cur ?? l?.color ?? 7, THEMES[this.themeName].fg);
      const lts = ['BYLAYER', ...this.doc.linetypes.keys()];
      const lsig = lts.join('|');
      if (ltSel.dataset.sig !== lsig) {
        ltSel.innerHTML = lts.map((n) => `<option value="${n}">${n === 'BYLAYER' ? 'ByLayer' : n}</option>`).join('');
        ltSel.dataset.sig = lsig;
      }
      ltSel.value = this.doc.getVar<string>('CELTYPE', 'BYLAYER');
    }
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
      track: hideCursor ? null : this.track,
    } as Parameters<typeof render>[1];
    render(this.g, rs);
    if (!hideCursor) this.updateDyn(cursorW);
    if (this.propsOpen) this.refreshProps();
    this.lastRenderMs = performance.now() - t0;
    if (rs.stats) this.lastStats = rs.stats;
  }

  /** Ảnh PNG của vùng vẽ ở k điểm ảnh / px CSS (không có con trỏ, lưới theo cài đặt). */
  private snapshotAt(k: number): string {
    const c = document.createElement('canvas');
    c.width = Math.round(this.vp.w * k);
    c.height = Math.round(this.vp.h * k);
    const g = c.getContext('2d')!;
    g.setTransform(k, 0, 0, k, 0, 0);
    const [cv, cg] = [this.canvas, this.g];
    this.canvas = c;
    this.g = g;
    try {
      this.draw(true);
    } finally {
      this.canvas = cv;
      this.g = cg;
    }
    return c.toDataURL('image/png');
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

    cv.addEventListener('dblclick', (e) => {
      if (this.running || this.hover === null) return;
      const ent = this.doc.get(this.hover);
      if (!ent) return;
      if (ent.type === 'TEXT' || ent.type === 'DIMENSION') this.editTextInline(ent.id);
      else {
        this.selection.clear();
        this.selection.add(ent.id);
        if (!this.propsOpen) this.toggleProps();
        this.redraw();
      }
      void e;
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
    this.track = null;
    if (this.orthoOn && base && this.pending?.kind !== 'selection') {
      const d = sub(w, base);
      w = Math.abs(d[0]) >= Math.abs(d[1]) ? [w[0], base[1]] : [base[0], w[1]];
    } else if (this.polarOn && base && this.pending && this.pending.kind !== 'selection' && this.pending.kind !== 'entity') {
      const d = sub(w, base);
      const L = len(d);
      if (L * this.vp.scale > 10) {
        const ang = rad2deg(angleOf(d));
        const near = Math.round(ang / this.polarInc) * this.polarInc;
        // Lệch không quá ~10 px tính tại vị trí con trỏ thì bắt vào tia.
        const off = L * Math.sin(Math.abs(ang - near) * (Math.PI / 180)) * this.vp.scale;
        if (off < 10) {
          w = polar(base, near * (Math.PI / 180), L * Math.cos((ang - near) * (Math.PI / 180)));
          this.track = { from: base, angle: near };
        }
      }
    }
    return w;
  }

  private updateHoverAndSnap(): void {
    if (!this.cursorScreen) return;
    const w = this.vp.toWorld(this.cursorScreen[0], this.cursorScreen[1]);
    const tol = 6 / this.vp.scale;
    if (!this.index) {
      const vis = this.doc.visible();
      this.index = new GridIndex(vis, this.doc.extents());
      // Đường dựng vô hạn không nằm gọn trong ô lưới nào: luôn xét riêng.
      this.xlines = vis.filter((e) => e.type === 'XLINE');
    }
    const r2 = 12 / this.vp.scale;
    const near = [...new Set([...this.index.query({ minX: w[0] - r2, minY: w[1] - r2, maxX: w[0] + r2, maxY: w[1] + r2 }), ...this.xlines])]
      .filter((e) => {
        if (this.doc.layers.get(e.layer)?.visible === false || this.doc.get(e.id) !== e) return false;
        if (e.type === 'XLINE') return true;
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
    if (base)
      for (const e of near)
        for (const q of tangentPoints(e, base)) {
          const d = dist(q, w);
          if (d < bd * 0.8) {
            bd = d;
            best = { p: q, kind: 'tan' };
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
      } else if (e.key === 'F10') {
        e.preventDefault();
        this.toggle('polar');
      } else if (mod && e.key === '0') {
        e.preventDefault();
        this.uiAction(this.root.classList.contains('clean') ? 'cleanscreenoff' : 'cleanscreenon', {});
      } else if (e.key === 'F2') {
        e.preventDefault();
        this.uiAction('textscr', {});
      } else if (mod && e.key === '1') {
        e.preventDefault();
        this.toggleProps();
      } else if (e.key === 'F8') {
        e.preventDefault();
        this.toggle('ortho');
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        this.redo();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'c' && !this.hasTextSelection()) {
        e.preventDefault();
        void this.start('COPYBASE');
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'x' && !this.hasTextSelection()) {
        e.preventDefault();
        void this.start('CUTBASE');
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'v' && document.activeElement === this.input && !this.input.value) {
        e.preventDefault();
        void this.start('PASTEBLOCK');
      } else if (mod && e.key.toLowerCase() === 'x' && !this.hasTextSelection() && document.activeElement !== this.input) {
        if (!this.selection.size) return;
        e.preventDefault();
        this.tryRun('CUTCLIP', { ids: [...this.selection] });
      } else if (mod && e.key.toLowerCase() === 'x' && !this.hasTextSelection() && !this.input.value && this.selection.size) {
        e.preventDefault();
        this.tryRun('CUTCLIP', { ids: [...this.selection] });
      } else if (mod && e.key.toLowerCase() === 'c' && !this.hasTextSelection()) {
        if (!this.selection.size) return;
        e.preventDefault();
        this.copySelection();
      } else if (mod && e.key.toLowerCase() === 'v' && document.activeElement === this.input && !this.input.value) {
        e.preventDefault();
        void this.pasteClip();
      } else if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        this.fileInput.click();
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

    this.input.addEventListener('input', () => {
      this.updateAutocomplete();
      this.updateDyn(this.cursorScreen ? this.effectivePoint() : null);
    });
    this.input.addEventListener('keydown', (e) => {
      const acOpen = this.acItems.length > 0;
      if (acOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const n = this.acItems.length;
        this.acIdx = e.key === 'ArrowDown' ? (this.acIdx + 1) % n : (this.acIdx - 1 + n) % n;
        this.renderAutocomplete();
        return;
      }
      if (acOpen && e.key === 'Tab') {
        e.preventDefault();
        this.input.value = this.acItems[Math.max(0, this.acIdx)];
        this.closeAutocomplete();
        return;
      }
      if (e.key === 'Enter' || (e.key === ' ' && !(this.pending?.kind === 'string' && this.pending.spaces))) {
        e.preventDefault();
        let v = this.input.value;
        if (acOpen && this.acIdx >= 0) v = this.acItems[this.acIdx];
        this.closeAutocomplete();
        this.input.value = '';
        this.submit(v);
      } else if (e.key === 'Escape') {
        this.closeAutocomplete();
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
    getText: (msg, def) => this.textDialog(msg, def ?? ''),
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

  /** Thao tác giao diện được gọi từ lệnh (cmds/ui.ts). */
  private uiAction(a: string, args: Record<string, unknown>): Record<string, unknown> | void {
    const steps = Math.max(1, Math.round(Number(args.steps ?? 1)) || 1);
    switch (a) {
      case 'new':
      case 'open':
      case 'close':
      case 'plot':
      case 'grid':
      case 'ortho':
      case 'polar':
      case 'layers':
      case 'props':
        // Chạy sau khi lệnh hiện tại kết thúc (tránh lồng lệnh).
        setTimeout(() => this.action(a), 0);
        return;
      case 'preview':
        setTimeout(() => this.showPlot(), 0);
        return;
      case 'osnap':
        setTimeout(() => this.toggle('snap'), 0);
        return;
      case 'properties':
        setTimeout(() => this.action('props'), 0);
        return;
      case 'layman':
        setTimeout(() => this.showLayers(), 0);
        return;
      case 'qsave':
        this.saveDxf();
        return;
      case 'saveas': {
        const n = String(args.name ?? prompt('Lưu thành tên tệp', this.fileName) ?? '').trim();
        if (!n) return;
        this.fileName = n.replace(/\.dxf$/i, '') + '.dxf';
        this.saveDxf();
        return;
      }
      case 'saveall':
        this.tabs.forEach((t, i) => {
          const content = i === this.activeTab ? writeDxf(this.doc.toData()) : t.json ? writeDxf(JSON.parse(t.json)) : null;
          if (content) this.download(content, t.name, 'application/dxf');
          if (i === this.activeTab) this.doc.dirty = false;
          else if (t.state) t.state.dirty = false;
        });
        this.renderTabs();
        return { message: `Đã lưu ${this.tabs.length} bản vẽ` };
      case 'closeall':
        setTimeout(async () => {
          for (let i = this.tabs.length - 1; i >= 0; i--) await this.closeTab(i);
        }, 0);
        return;
      case 'exportsvg':
        this.exportSvg();
        return;
      case 'pngout': {
        const k = Math.min(4, Math.max(1, Number(args.scale ?? 2)));
        this.pngOut(k);
        return;
      }
      case 'clip':
        store.set('mhcad.clip', String(args.data));
        return;
      case 'getclip':
        return { data: store.get('mhcad.clip') ?? undefined };
      case 'undo': {
        let n = 0;
        for (; n < steps && this.doc.undo(); n++);
        this.selection.clear();
        return { message: `Đã hoàn tác ${n} bước` };
      }
      case 'redo': {
        let n = 0;
        for (; n < steps && this.doc.redo(); n++);
        return { message: `Đã làm lại ${n} bước` };
      }
      case 'regen':
        this.index = null;
        this.redraw();
        return;
      case 'textscr':
        this.root.querySelector('.cmdline')?.classList.toggle('tall');
        return;
      case 'cleanscreenon':
      case 'cleanscreenoff':
        this.root.classList.toggle('clean', a === 'cleanscreenon');
        setTimeout(() => this.resize(), 0);
        return;
      case 'about':
        return { message: `MHCAD ${VERSION} — phần mềm CAD 2D miễn phí, mã nguồn mở GPL-3.0. ${this.reg.list().length} lệnh.` };
      case 'download':
        this.download(String(args.content), String(args.name), String(args.type ?? 'application/octet-stream'));
        return;
    }
    throw new Error(`Thao tác giao diện chưa hỗ trợ: ${a}`);
  }

  /** Xuất ảnh PNG của vùng vẽ ở độ phân giải gấp k lần. */
  private pngOut(k: number): void {
    const url = this.snapshotAt(k);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName.replace(/\.dxf$/i, '.png');
    a.click();
    this.print('Đã xuất ảnh PNG');
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

  // ---------- Nhiều bản vẽ (tab) ----------

  private renderTabs(): void {
    const el = this.root.querySelector<HTMLElement>('#tabs');
    if (!el) return;
    this.shownDirty = this.doc.dirty;
    el.innerHTML =
      this.tabs
        .map((t, i) => {
          const dirty = i === this.activeTab ? this.doc.dirty : !!t.state?.dirty;
          return `<div class="tab${i === this.activeTab ? ' on' : ''}" role="tab" aria-selected="${i === this.activeTab}" data-tab="${i}" title="${escapeHtml(t.name)}">
            <span class="name">${escapeHtml(t.name.replace(/\.dxf$/i, ''))}${dirty ? ' •' : ''}</span>
            <button class="x" data-close="${i}" aria-label="Đóng ${escapeHtml(t.name)}">✕</button></div>`;
        })
        .join('') + `<button class="tab-new" data-act="new" title="Bản vẽ mới (tab mới)">+</button>`;
    el.querySelectorAll<HTMLElement>('[data-tab]').forEach((t) =>
      t.addEventListener('mousedown', (ev) => {
        if ((ev.target as HTMLElement).closest('[data-close]')) return;
        if (ev.button === 1) {
          ev.preventDefault();
          void this.closeTab(Number(t.dataset.tab));
        } else void this.switchTab(Number(t.dataset.tab));
      }),
    );
    el.querySelectorAll<HTMLElement>('[data-close]').forEach((b) =>
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void this.closeTab(Number(b.dataset.close));
      }),
    );
    el.querySelector('.tab-new')!.addEventListener('click', () => this.action('new'));
  }

  /** Dừng lệnh đang chạy (nếu có) trước khi đổi bản vẽ. */
  private async stopRunning(): Promise<void> {
    if (this.running) {
      this.cancel();
      await this.running;
    }
  }

  private stashActive(): void {
    const t = this.tabs[this.activeTab];
    t.state = this.doc.saveState();
    t.json = this.doc.entities.size ? JSON.stringify(this.doc.toData()) : undefined;
    t.view = { scale: this.vp.scale, cx: this.vp.cx, cy: this.vp.cy };
  }

  private activate(i: number): void {
    const t = this.tabs[i];
    this.activeTab = i;
    this.selection.clear();
    this.hover = null;
    this.index = null;
    if (t.state) this.doc.restoreState(t.state);
    else this.doc.reset();
    t.state = null;
    if (t.view) {
      this.vp.scale = t.view.scale;
      this.vp.cx = t.view.cx;
      this.vp.cy = t.view.cy;
    } else {
      const b = this.doc.extents();
      this.vp.fit(b ?? { minX: 0, minY: 0, maxX: 10000, maxY: 6000 });
    }
    this.renderTabs();
    this.refreshLayers();
    this.propsSig = '';
    if (this.propsOpen) this.refreshProps();
    this.redraw();
  }

  async switchTab(i: number): Promise<void> {
    if (i === this.activeTab || !this.tabs[i]) return;
    await this.stopRunning();
    this.stashActive();
    this.activate(i);
  }

  async newTab(): Promise<void> {
    await this.stopRunning();
    this.stashActive();
    const used = new Set(this.tabs.map((t) => t.name));
    let n = 1;
    while (used.has(n === 1 ? 'ban-ve.dxf' : `ban-ve-${n}.dxf`)) n++;
    this.tabs.push({ name: n === 1 ? 'ban-ve.dxf' : `ban-ve-${n}.dxf`, state: null, view: null });
    this.activate(this.tabs.length - 1);
  }

  async closeTab(i: number): Promise<void> {
    const t = this.tabs[i];
    if (!t) return;
    const active = i === this.activeTab;
    const dirty = active ? this.doc.dirty && this.doc.entities.size > 0 : !!t.state?.dirty && t.state.entities.size > 0;
    if (dirty && !confirm(`Bản vẽ "${t.name}" chưa lưu ra file. Vẫn đóng?`)) return;
    if (active) await this.stopRunning();
    if (this.tabs.length === 1) {
      this.tabs[0] = { name: 'ban-ve.dxf', state: null, view: null };
      this.activate(0);
      return;
    }
    this.tabs.splice(i, 1);
    if (active) this.activate(Math.min(i, this.tabs.length - 1));
    else {
      if (i < this.activeTab) this.activeTab--;
      this.renderTabs();
    }
  }

  // ---------- Menu ----------

  private bindMenus(): void {
    const pop = this.root.querySelector<HTMLElement>('#menupop')!;
    const open = (btn: HTMLElement) => {
      const m = MENUS[Number(btn.dataset.menu)];
      pop.innerHTML = m.items
        .map((it) =>
          it === '-'
            ? '<hr />'
            : `<button role="menuitem" data-mi="${it.cmd ? 'cmd:' + it.cmd : 'act:' + it.act}"><span>${escapeHtml(it.label)}</span><kbd>${escapeHtml(it.key ?? (it.cmd ? this.aliasOf(it.cmd) : ''))}</kbd></button>`,
        )
        .join('');
      const r = btn.getBoundingClientRect();
      pop.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 270))}px`;
      pop.style.top = `${r.bottom + 2}px`;
      pop.hidden = false;
      this.menuOpen?.classList.remove('on');
      btn.classList.add('on');
      this.menuOpen = btn;
    };
    const close = () => {
      pop.hidden = true;
      this.menuOpen?.classList.remove('on');
      this.menuOpen = null;
    };
    this.root.querySelectorAll<HTMLElement>('[data-menu]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.menuOpen === b) close();
        else open(b);
      });
      b.addEventListener('mouseenter', () => {
        if (this.menuOpen && this.menuOpen !== b) open(b);
      });
    });
    pop.addEventListener('click', (ev) => {
      const it = (ev.target as HTMLElement).closest<HTMLElement>('[data-mi]');
      if (!it) return;
      close();
      const [kind, v] = it.dataset.mi!.split(':');
      if (kind === 'cmd') {
        void this.start(v);
        this.input.focus();
      } else this.action(v);
    });
    document.addEventListener('mousedown', (ev) => {
      if (this.menuOpen && !(ev.target as HTMLElement).closest('#menupop, [data-menu]')) close();
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.menuOpen) close();
    });
  }

  private aliasOf(cmd: string): string {
    const a = this.reg.resolve(cmd)?.aliases ?? [];
    return a.length ? a.reduce((x, y) => (y.length < x.length ? y : x)) : '';
  }

  /** Hộp soạn chữ nhiều dòng. */
  private textDialog(title: string, def: string): Promise<string | null> {
    const dlg = this.root.querySelector<HTMLDialogElement>('#textdlg')!;
    const area = dlg.querySelector<HTMLTextAreaElement>('textarea')!;
    dlg.querySelector('#textdlg-title')!.textContent = title;
    area.value = def;
    dlg.returnValue = '';
    return new Promise((resolve) => {
      area.onkeydown = (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          dlg.close('ok');
        }
      };
      dlg.addEventListener(
        'close',
        () => {
          resolve(dlg.returnValue === 'ok' && area.value.trim() ? area.value.replace(/\r\n?/g, '\n') : null);
          this.input.focus();
        },
        { once: true },
      );
      dlg.showModal();
      area.focus();
    });
  }

  // ---------- File & lưu tạm ----------

  private saveDxf(): void {
    this.download(writeDxf(this.doc.toData()), this.fileName, 'application/dxf');
    this.doc.dirty = false;
    this.renderTabs();
    this.print(`Đã lưu ${this.fileName} (${this.doc.entities.size} đối tượng).`);
  }

  /** Lưu tạm mọi tab vào bộ nhớ trình duyệt (tab không hoạt động dùng bản JSON đã lưu khi rời tab). */
  private autosave(): void {
    const parts = this.tabs.map((t, i) =>
      i === this.activeTab ? JSON.stringify({ name: t.name, data: this.doc.toData() }) : `{"name":${JSON.stringify(t.name)},"data":${t.json ?? 'null'}}`,
    );
    store.set('mhcad.autosave', `{"active":${this.activeTab},"tabs":[${parts.join(',')}]}`);
  }

  private restore(): boolean {
    const raw = store.get('mhcad.autosave');
    if (!raw) return false;
    try {
      const saved = JSON.parse(raw) as { active?: number; tabs?: { name: string; data: DrawingData | null }[]; name?: string; data?: DrawingData };
      // Định dạng cũ: một bản vẽ.
      const list = (saved.tabs ?? [{ name: saved.name ?? 'ban-ve.dxf', data: saved.data ?? null }]).filter((t) => t.data?.format === 'mhcad' && t.data.entities?.length);
      if (!list.length) return false;
      this.tabs = list.map((t) => ({ name: t.name || 'ban-ve.dxf', state: null, view: null }));
      list.forEach((t, i) => {
        this.doc.load(t.data!);
        this.tabs[i].state = this.doc.saveState();
        this.tabs[i].json = JSON.stringify(t.data);
      });
      const act = Math.min(Math.max(0, saved.active ?? 0), list.length - 1);
      this.activate(act);
      const n = list.reduce((s, t) => s + t.data!.entities.length, 0);
      this.print(`Đã khôi phục ${list.length > 1 ? `${list.length} bản vẽ` : 'bản vẽ'} lưu tạm (${n} đối tượng).`);
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Sao chép / dán ----------

  private hasTextSelection(): boolean {
    const a = document.activeElement;
    if (a instanceof HTMLInputElement) return a.selectionStart !== a.selectionEnd;
    return !!window.getSelection()?.toString();
  }

  private copySelection(): void {
    if (!this.selection.size) return;
    this.tryRun('COPYCLIP', { ids: [...this.selection] });
  }

  private async pasteClip(): Promise<void> {
    const raw = store.get('mhcad.clip');
    if (!raw) return this.print('Bộ nhớ tạm trống');
    const data = JSON.parse(raw) as { base: Vec; ents: NewEntity[] };
    if (this.running) {
      this.cancel();
      await this.running;
    }
    this.echo('PASTECLIP', true);
    this.launch('PASTECLIP', async () => {
      const to = await this.io.getPoint('Điểm dán', {
        preview: (c) => data.ents.map((e) => moveEnt(e, sub(c, data.base))),
      });
      if (Array.isArray(to)) this.print(this.api.run('PASTECLIP', { data: raw, from: data.base, to }).message!);
    });
  }

  // ---------- Gợi ý lệnh, nhập động, thuộc tính, sửa chữ ----------

  private updateAutocomplete(): void {
    const t = this.input.value.trim().toUpperCase();
    if (this.pending || !t || /[\s,@<]/.test(t) || /^[-+\d.]/.test(t)) return this.closeAutocomplete();
    const out: { name: string; score: number }[] = [];
    for (const c of this.reg.list()) {
      const al = (c.aliases ?? []).map((a) => a.toUpperCase());
      let score = -1;
      if (al.includes(t)) score = 0;
      else if (c.name === t) score = 1;
      else if (c.name.startsWith(t)) score = 2;
      else if (al.some((a) => a.startsWith(t))) score = 3;
      else if (t.length >= 3 && c.name.includes(t)) score = 4;
      if (score >= 0) out.push({ name: c.name, score });
    }
    for (const extra of ['PLOT', 'LAYERS', 'NEW', 'OPEN', 'SAVE', 'UNDO', 'REDO', 'HELP'])
      if (extra.startsWith(t) && !out.some((o) => o.name === extra)) out.push({ name: extra, score: 5 });
    out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    this.acItems = out.slice(0, 8).map((o) => o.name);
    this.acIdx = -1;
    this.renderAutocomplete();
  }

  private renderAutocomplete(): void {
    const el = this.root.querySelector<HTMLUListElement>('#ac')!;
    if (!this.acItems.length) {
      el.hidden = true;
      return;
    }
    el.innerHTML = this.acItems
      .map((n, i) => {
        const d = this.reg.resolve(n);
        const al = d?.aliases?.length ? ` <span class="muted">${d.aliases.slice(0, 3).join(', ')}</span>` : '';
        return `<li role="option" data-i="${i}" class="${i === this.acIdx ? 'on' : ''}" aria-selected="${i === this.acIdx}"><b>${n}</b>${al}<small>${escapeHtml(d?.desc ?? '')}</small></li>`;
      })
      .join('');
    el.hidden = false;
    el.querySelectorAll<HTMLLIElement>('li').forEach((li) =>
      li.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        const name = this.acItems[Number(li.dataset.i)];
        this.closeAutocomplete();
        this.input.value = '';
        this.submit(name);
      }),
    );
  }

  private closeAutocomplete(): void {
    this.acItems = [];
    this.acIdx = -1;
    const el = this.root.querySelector<HTMLUListElement>('#ac');
    if (el) el.hidden = true;
  }

  private static SNAP_NAME: Record<string, string> = {
    end: 'Điểm cuối',
    mid: 'Trung điểm',
    center: 'Tâm',
    quad: 'Góc phần tư',
    int: 'Giao điểm',
    perp: 'Vuông góc',
    tan: 'Tiếp tuyến',
    node: 'Điểm',
    insert: 'Điểm chèn',
    near: 'Gần nhất',
  };

  /** Ô nhập động cạnh con trỏ: lời nhắc, độ dài/góc, tên điểm bắt, chữ đang gõ. */
  private updateDyn(w: Vec | null): void {
    const el = this.root.querySelector<HTMLElement>('#dyn');
    if (!el) return;
    const pd = this.pending;
    if (!this.cursorScreen || !w || (!pd && !this.input.value)) {
      el.hidden = true;
      return;
    }
    const parts: string[] = [];
    if (pd) parts.push(`<span class="p">${escapeHtml(pd.msg)}</span>`);
    const base = pd?.tempBase ?? pd?.base;
    if (base && pd && pd.kind !== 'selection' && pd.kind !== 'entity') {
      const d = sub(w, base);
      parts.push(`<span class="v">${fmt(len(d))}</span><span class="v">${fmt((rad2deg(angleOf(d)) + 360) % 360)}°</span>`);
    } else if (pd && pd.kind === 'point') parts.push(`<span class="v">${fmt(w[0])}, ${fmt(w[1])}</span>`);
    if (this.snap) parts.push(`<span class="s">${App.SNAP_NAME[this.snap.kind] ?? this.snap.kind}</span>`);
    else if (this.track) parts.push(`<span class="s">Polar ${this.track.angle}°</span>`);
    if (this.input.value) parts.push(`<span class="t">${escapeHtml(this.input.value)}</span>`);
    el.innerHTML = parts.join('');
    el.hidden = false;
    const x = Math.min(this.cursorScreen[0] + 18, this.vp.w - el.offsetWidth - 6);
    const y = Math.min(this.cursorScreen[1] + 22, this.vp.h - el.offsetHeight - 6);
    el.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  }

  private toggleProps(): void {
    this.propsOpen = !this.propsOpen;
    const el = this.root.querySelector<HTMLElement>('#props')!;
    el.hidden = !this.propsOpen;
    this.propsSig = '';
    if (this.propsOpen) this.refreshProps();
    this.root.querySelector('[data-act="props"]')?.classList.toggle('on', this.propsOpen);
  }

  private refreshProps(): void {
    const el = this.root.querySelector<HTMLElement>('#props')!;
    // Dựng lại chỉ khi lựa chọn hoặc đối tượng thay đổi (đối tượng bất biến → so sánh tham chiếu).
    const ids = [...this.selection];
    const sig = ids.length + ':' + ids.slice(0, 50).map((id) => `${id}@${objId(this.doc.get(id))}`).join(',') + '|' + this.doc.entities.size + '|' + this.doc.layers.size;
    if (sig === this.propsSig) return;
    if (el.contains(document.activeElement) && document.activeElement !== el) return; // đang gõ trong bảng
    this.propsSig = sig;
    renderProps(el, this.doc, ids, (cmd, args) => {
      this.tryRun(cmd, args);
      // Bỏ con trỏ khỏi ô vừa sửa để bảng được dựng lại với giá trị mới.
      if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      this.propsSig = '';
      this.redraw();
    });
  }

  /** Sửa chữ tại chỗ (bấm đúp vào TEXT / kích thước). */
  private editTextInline(id: number): void {
    const e = this.doc.get(id);
    if (!e || (e.type !== 'TEXT' && e.type !== 'DIMENSION')) return;
    if (e.type === 'TEXT' && e.text.includes('\n')) {
      void this.textDialog('Sửa chữ nhiều dòng', e.text).then((v) => {
        if (v !== null && v !== e.text) this.tryRun('SETPROP', { ids: [id], set: { text: v } });
      });
      return;
    }
    const inp = this.root.querySelector<HTMLInputElement>('#inline')!;
    const b = bbox(e);
    const q = this.vp.toScreen([b.minX, b.maxY]);
    inp.value = e.type === 'TEXT' ? e.text : (e.text ?? '<>');
    inp.hidden = false;
    inp.style.transform = `translate(${Math.max(4, Math.min(q[0], this.vp.w - 260))}px, ${Math.max(4, q[1] - 6)}px)`;
    inp.focus();
    inp.select();
    const done = (ok: boolean) => {
      inp.hidden = true;
      inp.onkeydown = null;
      inp.onblur = null;
      if (ok && inp.value !== (e.type === 'TEXT' ? e.text : (e.text ?? '<>'))) {
        if (e.type === 'TEXT' && !inp.value.trim()) this.print('Nội dung chữ không được rỗng');
        else this.tryRun('SETPROP', { ids: [id], set: { text: e.type === 'DIMENSION' && inp.value === '<>' ? '' : inp.value } });
      }
      this.input.focus();
    };
    inp.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') done(true);
      else if (ev.key === 'Escape') done(false);
    };
    inp.onblur = () => done(true);
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

// Mã nhận dạng ổn định cho từng đối tượng (để biết đối tượng đã bị thay bằng bản mới chưa).
const objIds = new WeakMap<object, number>();
let objSeq = 0;
function objId(o: object | undefined): number {
  if (!o) return 0;
  let v = objIds.get(o);
  if (v === undefined) objIds.set(o, (v = ++objSeq));
  return v;
}
