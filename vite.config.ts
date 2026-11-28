import { defineConfig } from 'vitest/config';

// GitHub Pages phục vụ tại /mh_cad_su/. Khi có tên miền riêng, đặt MHCAD_BASE=/ lúc build.
export default defineConfig({
  base: process.env.MHCAD_BASE ?? '/mh_cad_su/',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
