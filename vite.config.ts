import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// GitHub Pages phục vụ tại /mh_cad_su/. Khi có tên miền riêng, đặt MHCAD_BASE=/ lúc build.
export default defineConfig({
  base: process.env.MHCAD_BASE ?? '/mh_cad_su/',
  resolve: {
    alias: {
      // Gói chỉ công khai lối vào chính; trỏ thẳng tới thư mục wasm để nạp lười khi mở DWG.
      'libredwg-wasm': fileURLToPath(new URL('./node_modules/@mlightcad/libredwg-web/wasm', import.meta.url)),
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
