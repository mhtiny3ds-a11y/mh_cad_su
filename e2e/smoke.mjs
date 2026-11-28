// Kiểm thử đầu-cuối: chạy bản build thật trong Chromium, gõ lệnh như người dùng.
// Chạy: npm run build && npm run e2e
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright cài sẵn toàn cục trong môi trường phát triển; trên máy khác: npm i -D playwright.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4179;
const BASE = `http://localhost:${PORT}/mh_cad_su/`;
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const { preview } = await import('vite');
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' });

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.mhcad);

  const cmd = page.locator('#cmd');
  const type = async (...lines) => {
    for (const l of lines) {
      await cmd.fill(l);
      await cmd.press('Enter');
    }
  };
  const count = () => page.evaluate(() => window.mhcad.query.summary().entityCount);

  // 1. LINE gõ toạ độ, đóng bằng từ khoá Close.
  await type('L', '0,0', '@4000,0', '@0,3000', 'c');
  check('LINE + Close tạo 3 đoạn', (await count()) === 3, `có ${await count()}`);

  // 2. Hoàn tác một lần xoá cả lệnh.
  await type('u');
  check('U hoàn tác cả lệnh LINE', (await count()) === 0);

  // 3. API cho script / AI, gộp một bước undo.
  const r = await page.evaluate(() =>
    window.mhcad.batch('Phòng ngủ', () => {
      window.mhcad.run('LAYER', { name: 'TUONG', color: 1 });
      const a = window.mhcad.run('RECTANG', { p1: [0, 0], p2: [4000, 3000] });
      window.mhcad.run('OFFSET', { ids: a.ids, distance: 200, side: [-100, -100] });
      window.mhcad.run('LAYER', { name: 'CHU', color: 3 });
      window.mhcad.run('TEXT', { position: [1200, 1400], text: 'Phòng ngủ 12m²', height: 250 });
      window.mhcad.run('CIRCLE', { center: [2000, 1500], radius: 600 });
      return window.mhcad.query.summary();
    }),
  );
  check('API batch tạo 4 đối tượng, 3 layer', r.entityCount === 4 && r.layers.length === 3, JSON.stringify(r.byType));
  await page.evaluate(() => window.mhcad.view.zoomExtents());

  // 4. CIRCLE: bấm tâm bằng chuột, gõ bán kính.
  const box = await page.locator('#cv').boundingBox();
  await type('C');
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.25);
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.25);
  await type('300');
  check('CIRCLE bằng chuột + bán kính', (await count()) === 5);

  // 4b. TEXT tương tác: nội dung có dấu cách; MOVE với đối tượng chọn sẵn.
  await type('DT', '-2000,-2000', '300');
  await cmd.fill('Xin chào bạn');
  await cmd.press('Enter');
  const t = await page.evaluate(() => window.mhcad.query.entities({ type: 'TEXT' }).map((e) => e.text));
  check('TEXT nhận chuỗi có dấu cách', t.includes('Xin chào bạn'), JSON.stringify(t));
  const tid = await page.evaluate(() => window.mhcad.query.entities({ type: 'TEXT' }).find((e) => e.text === 'Xin chào bạn').id);
  await page.evaluate((id) => window.mhcad.select([id]), tid);
  await type('M', '0,0', '@100,50');
  const moved = await page.evaluate((id) => window.mhcad.query.entity(id).p, tid);
  check('MOVE dùng đối tượng chọn sẵn', moved[0] === -1900 && moved[1] === -1950, JSON.stringify(moved));
  await page.evaluate((id) => window.mhcad.run('ERASE', { ids: [id] }), tid);
  check('Dọn chữ thử', (await count()) === 5);

  // 5. Bắt điểm: bấm lệch vài pixel cạnh góc (4000,3000) → phải bắt đúng góc.
  await page.evaluate(() => window.mhcad.view.zoomExtents());
  await page.waitForTimeout(50);
  await type('L');
  const target = await page.evaluate(() => {
    const s = window.mhcad.query.summary();
    return s.extents;
  });
  // Ước lượng vị trí màn hình từ phạm vi bản vẽ (zoomExtents đặt bản vẽ ở giữa, lề 8%).
  const [[minX, minY], [maxX, maxY]] = target;
  const scale = Math.min((box.width * 0.84) / (maxX - minX), (box.height * 0.84) / (maxY - minY));
  const toScreen = ([x, y]) => [box.x + box.width / 2 + (x - (minX + maxX) / 2) * scale, box.y + box.height / 2 - (y - (minY + maxY) / 2) * scale];
  const [sx, sy] = toScreen([4000, 3000]);
  await page.mouse.move(sx + 4, sy - 3);
  await page.mouse.click(sx + 4, sy - 3);
  await type('@1000,0', '');
  const last = await page.evaluate(() => {
    const ls = window.mhcad.query.entities({ type: 'LINE' });
    return ls[ls.length - 1];
  });
  check('Bắt điểm góc (4000,3000)', last && Math.abs(last.a[0] - 4000) < 1e-6 && Math.abs(last.a[1] - 3000) < 1e-6, JSON.stringify(last?.a));

  // 6. Chọn bằng khung kéo phải → trái (crossing) cắt mép dưới đường tròn R600 rồi Delete.
  const before = await count();
  const [cx, cy] = toScreen([2000, 900]);
  await page.mouse.move(cx + 15, cy + 15);
  await page.mouse.down();
  await page.mouse.move(cx - 15, cy - 15, { steps: 5 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.mhcad.query.selection().length);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(50);
  check('Crossing chọn đường tròn và Delete xoá', selected >= 1 && (await count()) === before - selected, `chọn ${selected}`);

  // 7. Ghi DXF rồi đọc lại.
  const rt = await page.evaluate(() => {
    const t = window.mhcad.file.toDxf();
    const n = window.mhcad.query.summary().entityCount;
    const res = window.mhcad.file.loadDxf(t);
    return { n, loaded: res.entities, unicode: t.includes('\\U+00F2') };
  });
  check('DXF ghi/đọc lại đủ đối tượng, chữ Việt mã hoá \\U+', rt.n === rt.loaded && rt.unicode, JSON.stringify(rt));

  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await page.screenshot({ path: `${OUT}desktop.png` });

  // 8. Ảnh chụp qua API (cho AI "nhìn").
  const shot = await page.evaluate(() => window.mhcad.view.snapshot());
  check('snapshot() trả ảnh PNG', shot.startsWith('data:image/png;base64,') && shot.length > 5000);

  // 9. Trợ giúp F1.
  await page.keyboard.press('F1');
  check('F1 mở trợ giúp', await page.locator('dialog#help[open]').isVisible());
  await page.screenshot({ path: `${OUT}help.png` });
  await page.keyboard.press('Escape');

  // 10. Giao diện điện thoại.
  const phone = await browser.newPage({ viewport: { width: 390, height: 780 } });
  await phone.goto(BASE);
  await phone.waitForFunction(() => !!window.mhcad);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('Điện thoại: không tràn ngang', !overflow);
  await phone.screenshot({ path: `${OUT}phone.png` });

  check('Không có lỗi JavaScript', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  await server.close();
}

if (failed) {
  console.error(`\n${failed} kiểm tra thất bại`);
  process.exit(1);
}
console.log('\nTất cả kiểm tra đầu-cuối đều qua.');
