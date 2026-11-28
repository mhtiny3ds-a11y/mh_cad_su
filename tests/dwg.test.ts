import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dwgToDxf, isDwg } from '../src/core/dwg';
import { readDxf } from '../src/core/dxf';

const wasm = fileURLToPath(new URL('../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm', import.meta.url));

describe('DWG', () => {
  it('mở file DWG 2018 (AC1032) qua LibreDWG rồi đọc như DXF', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/example_2018.dwg', import.meta.url)));
    expect(isDwg(bytes)).toBe(true);
    const dxf = await dwgToDxf(bytes, wasm);
    expect(dxf).toMatch(/SECTION/);
    const { data, skipped } = readDxf(dxf);
    console.log('DWG:', data.entities.length, 'đối tượng,', data.layers.length, 'layer,', data.blocks?.length, 'block; bỏ qua', skipped);
    expect(data.entities.length).toBeGreaterThan(5);
  }, 60000);
});
