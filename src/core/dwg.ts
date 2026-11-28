// Đọc DWG: dùng LibreDWG (WebAssembly, GPL-3.0, gói @mlightcad/libredwg-web) chuyển DWG → DXF,
// rồi dùng bộ đọc DXF của MHCAD. Chạy trong Web Worker để giao diện không bị đứng.

import { decodeDxfBytes } from './dxf';

type LibreModule = {
  FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array; unlink(p: string): void };
  dwg_write_dxf(input: string, output: string): number;
};

let modPromise: Promise<LibreModule> | null = null;

/** Nạp mô-đun LibreDWG (một lần). wasmUrl: đường dẫn tới libredwg-web.wasm. */
export function loadLibreDwg(wasmUrl?: string): Promise<LibreModule> {
  if (!modPromise) {
    modPromise = import('libredwg-wasm/libredwg-web.js').then(async (m) => {
      const create = (m as { default: (o?: object) => Promise<LibreModule> }).default;
      return create(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
    });
  }
  return modPromise;
}

/** Kiểm tra chữ ký file DWG (AC10xx). */
export function isDwg(bytes: Uint8Array): boolean {
  return bytes.length > 6 && bytes[0] === 0x41 && bytes[1] === 0x43 && bytes[2] === 0x31 && bytes[3] === 0x30;
}

/** Chuyển nội dung DWG thành văn bản DXF. */
export async function dwgToDxf(bytes: Uint8Array, wasmUrl?: string): Promise<string> {
  if (!isDwg(bytes)) throw new Error('Không phải file DWG');
  const m = await loadLibreDwg(wasmUrl);
  const id = Math.random().toString(36).slice(2);
  const inp = `/in-${id}.dwg`;
  const out = `/out-${id}.dxf`;
  m.FS.writeFile(inp, bytes);
  try {
    const rc = m.dwg_write_dxf(inp, out);
    let data: Uint8Array;
    try {
      data = m.FS.readFile(out);
    } catch {
      throw new Error(`Không đọc được file DWG (mã lỗi ${rc})`);
    }
    return decodeDxfBytes(data);
  } finally {
    try {
      m.FS.unlink(inp);
      m.FS.unlink(out);
    } catch {
      /* bỏ qua */
    }
  }
}
