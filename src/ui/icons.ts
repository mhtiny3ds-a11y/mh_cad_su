// Biểu tượng tự vẽ (SVG 20×20, nét theo màu chữ). Không dùng hình của phần mềm khác.

const svg = (body: string) =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS: Record<string, string> = {
  LINE: svg('<path d="M3 16 17 4"/><circle cx="3" cy="16" r="1.4" fill="currentColor"/><circle cx="17" cy="4" r="1.4" fill="currentColor"/>'),
  PLINE: svg('<path d="M3 16 7 6l5 7 5-9"/>'),
  RECTANG: svg('<rect x="3" y="5" width="14" height="10" rx="0.5"/>'),
  CIRCLE: svg('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="0.8" fill="currentColor"/>'),
  ARC: svg('<path d="M3 15a8 8 0 0 1 14 0"/>'),
  TEXT: svg('<path d="M4 5h12M10 5v11M7 16h6"/>'),
  MOVE: svg('<path d="M10 2v16M2 10h16M10 2 7.5 4.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5"/>'),
  COPY: svg('<rect x="3" y="7" width="9" height="9"/><path d="M7 7V4h9v9h-4"/>'),
  ROTATE: svg('<path d="M16 10a6 6 0 1 1-2-4.5"/><path d="M14.5 2.5V6H11"/>'),
  SCALE: svg('<rect x="3" y="9" width="8" height="8"/><path d="M9 3h8v8M17 3l-7 7"/>'),
  MIRROR: svg('<path d="M10 2v16" stroke-dasharray="2 2"/><path d="M8 5 3 15h5zM12 5l5 10h-5z"/>'),
  OFFSET: svg('<path d="M3 13 9 4h8"/><path d="M3 17l6-9h8" opacity=".6"/>'),
  ERASE: svg('<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/>'),
  EXPLODE: svg('<path d="M4 4l3 3M16 4l-3 3M4 16l3-3M16 16l-3-3"/><rect x="8" y="8" width="4" height="4"/>'),
  DIST: svg('<path d="M2 14h16M2 11v6M18 11v6"/><path d="M5 14V9M8 14v-3M11 14V9M14 14v-3"/>'),
  LIST: svg('<path d="M7 5h10M7 10h10M7 15h10"/><circle cx="3.5" cy="5" r="0.9" fill="currentColor"/><circle cx="3.5" cy="10" r="0.9" fill="currentColor"/><circle cx="3.5" cy="15" r="0.9" fill="currentColor"/>'),
  new: svg('<path d="M5 2h7l4 4v12H5z"/><path d="M12 2v4h4"/>'),
  open: svg('<path d="M2 6h6l2 2h8v9H2z"/>'),
  save: svg('<path d="M4 3h10l3 3v11H4z"/><path d="M7 3v5h6V3M7 17v-5h7v5"/>'),
  undo: svg('<path d="M7 8H13a4 4 0 0 1 0 8H8"/><path d="M7 4 3 8l4 4"/>'),
  redo: svg('<path d="M13 8H7a4 4 0 0 0 0 8h5"/><path d="M13 4l4 4-4 4"/>'),
  extents: svg('<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/><rect x="7" y="7" width="6" height="6"/>'),
  help: svg('<circle cx="10" cy="10" r="7.5"/><path d="M8 8a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.6"/><circle cx="10" cy="14.2" r="0.6" fill="currentColor"/>'),
  theme: svg('<path d="M16 12.5A7 7 0 0 1 7.5 4a7 7 0 1 0 8.5 8.5z"/>'),
};

/** Logo MHCAD: hai chữ M/H lồng trong khung, màu xanh ngọc — nhận diện riêng. */
export const LOGO = `<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="7" fill="#0f766e"/><path d="M7 23V9l5 7 5-7v14M20 9v14M26 9v14M20 16h6" fill="none" stroke="#ecfeff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
