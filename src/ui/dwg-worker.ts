// Web Worker chuyển DWG → DXF.
import { dwgToDxf } from '../core/dwg';
import wasmUrl from 'libredwg-wasm/libredwg-web.wasm?url';

self.onmessage = async (ev: MessageEvent<{ id: number; bytes: Uint8Array }>) => {
  const { id, bytes } = ev.data;
  try {
    const dxf = await dwgToDxf(bytes, wasmUrl);
    (self as unknown as Worker).postMessage({ id, dxf });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: (e as Error).message });
  }
};
