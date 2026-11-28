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

  // 11. Lệnh sửa tương tác bằng chuột: TRIM, FILLET, grip, kích thước.
  await page.evaluate(() => {
    window.mhcad.file.newDrawing();
    window.mhcad.batch('Dựng thử', () => {
      window.mhcad.run('LINE', { points: [[0, 0], [6000, 0]] });
      window.mhcad.run('LINE', { points: [[2000, -1000], [2000, 1000]] });
      window.mhcad.run('LINE', { points: [[4000, -1000], [4000, 1000]] });
      window.mhcad.run('LINE', { points: [[0, 3000], [2500, 3000]] });
      window.mhcad.run('LINE', { points: [[3000, 3500], [3000, 6000]] });
    });
    window.mhcad.view.zoomExtents();
  });
  await page.waitForTimeout(50);
  const click = async (p) => {
    const [x, y] = await page.evaluate((q) => window.mhcad.view.toClient(q), p);
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
  };
  await type('TR');
  await click([3000, 0]);
  await cmd.press('Enter');
  const trimmed = await page.evaluate(() => window.mhcad.query.entities({ type: 'LINE' }).filter((l) => l.a[1] === 0 && l.b[1] === 0).map((l) => [l.a[0], l.b[0]]));
  check('TRIM bằng chuột cắt đoạn giữa', JSON.stringify(trimmed) === '[[0,2000],[4000,6000]]', JSON.stringify(trimmed));

  await type('F');
  await type('R', '500');
  await type('F');
  await click([1000, 3000]);
  await click([3000, 5000]);
  const arcs = await page.evaluate(() => window.mhcad.query.entities({ type: 'ARC' }));
  check('FILLET R500 bằng chuột tạo cung', arcs.length === 1 && Math.abs(arcs[0].r - 500) < 1e-9, JSON.stringify(arcs[0]?.c));

  // Grip: chọn đoạn thẳng đứng bên trái, kéo đầu trên lên (0, 2000) bằng gõ toạ độ.
  const vid = await page.evaluate(() => window.mhcad.query.entities({ type: 'LINE' }).find((l) => l.a[0] === 2000 && l.b[0] === 2000).id);
  await click([2000, 500]);
  await click([2000, 1000]);
  await type('2000,2000');
  const vl = await page.evaluate((id) => window.mhcad.query.entity(id), vid);
  check('Grip kéo đầu mút', vl.b[1] === 2000, JSON.stringify(vl.b));

  await type('DLI', '0,0', '2000,0', '1000,-800');
  const dims = await page.evaluate(() => window.mhcad.query.entities({ type: 'DIMENSION' }).map((d) => window.mhcad.query.describe(d.id)));
  check('DIMLINEAR gõ toạ độ', dims.length === 1 && dims[0].includes('"2000"'), dims[0]);

  // Hộp quản lý layer và hộp in.
  await type('LA');
  check('LA mở quản lý layer', await page.locator('dialog#layers[open]').isVisible());
  await page.locator('dialog#layers input[name="name"]').fill('TƯỜNG');
  await page.locator('dialog#layers .newlayer button').click();
  const hasLayer = await page.evaluate(() => window.mhcad.query.layers().some((l) => l.name === 'TƯỜNG'));
  check('Thêm layer từ hộp quản lý', hasLayer);
  await page.screenshot({ path: `${OUT}layers.png` });
  await page.keyboard.press('Escape');
  check('Esc đóng hộp quản lý layer', !(await page.locator('dialog#layers[open]').isVisible()));
  await page.keyboard.press('Control+p');
  check('Ctrl+P mở hộp in', await page.locator('dialog#plot[open]').isVisible());
  const info = await page.locator('#plotinfo').textContent();
  check('Hộp in tính tỉ lệ', /1:\d/.test(info), info);
  await page.keyboard.press('Escape');

  // Block + kiểu đường hiển thị.
  await page.evaluate(() => {
    const m = window.mhcad;
    m.run('LAYER', { name: 'TRUC', color: 1, linetype: 'CENTER' });
    m.run('LINE', { points: [[-500, -1500], [6500, -1500]] });
    m.run('LAYER', { name: '0' });
    const r = m.run('RECTANG', { p1: [0, 0], p2: [900, 60] });
    const a = m.run('ARC', { center: [0, 60], radius: 900, startAngle: 0, endAngle: 90 });
    m.run('BLOCK', { name: 'CỬA 900', base: [0, 0], ids: [...r.ids, ...a.ids] });
    m.run('INSERT', { name: 'CỬA 900', position: [4500, 0], rotation: 0 });
    m.view.zoomExtents();
  });
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.screenshot({ path: `${OUT}v2-drawing.png` });

  // 12. HATCH bằng bấm điểm, mở DWG thật, hiệu năng.
  await page.evaluate(() => {
    const m = window.mhcad;
    m.file.newDrawing();
    m.run('RECTANG', { p1: [0, 0], p2: [6000, 4000] });
    m.run('CIRCLE', { center: [3000, 2000], radius: 800 });
    m.view.zoomExtents();
  });
  await page.waitForTimeout(50);
  await type('H');
  await type('P', 'BRICK');
  await click([1000, 1000]);
  await cmd.press('Enter');
  const hatch = await page.evaluate(() => window.mhcad.query.entities({ type: 'HATCH' }));
  check('HATCH bấm điểm có đảo', hatch.length === 1 && hatch[0].loops.length === 2 && hatch[0].pattern === 'BRICK', JSON.stringify(hatch.map((h) => h.loops.length)));
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.screenshot({ path: `${OUT}hatch.png` });

  await page.locator('#file').setInputFiles(new URL('../tests/fixtures/example_2018.dwg', import.meta.url).pathname);
  await page.waitForFunction(() => window.mhcad.query.summary().entityCount > 20, null, { timeout: 30000 });
  const dwg = await page.evaluate(() => window.mhcad.query.summary());
  check('Mở DWG 2018 trong trình duyệt (Web Worker + WebAssembly)', dwg.entityCount > 20, `${dwg.entityCount} đối tượng, ${dwg.blocks} block`);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}dwg.png` });

  // Mở file khi bản vẽ hiện tại đã có nội dung → tab mới; chuyển tab giữ nguyên bản vẽ cũ.
  check('Mở file vào tab mới', (await page.locator('.tab').count()) === 2);
  await page.locator('.tab[data-tab="0"]').click();
  const back = await page.evaluate(() => window.mhcad.query.entities().map((e) => e.type).sort().join(','));
  check('Chuyển về tab cũ còn nguyên bản vẽ', back === 'CIRCLE,HATCH,LWPOLYLINE', back);
  await type('u');
  check('Hoàn tác vẫn hoạt động sau khi đổi tab', (await count()) === 2);
  await page.locator('.tab[data-tab="1"]').click();
  check('Quay lại tab DWG', (await count()) === dwg.entityCount);
  await page.screenshot({ path: `${OUT}tabs.png` });

  const perf = await page.evaluate(() => {
    const m = window.mhcad;
    m.file.newDrawing();
    const t0 = performance.now();
    m.batch('Nhiều đối tượng', () => {
      const pts = [];
      for (let i = 0; i < 200; i++) for (let j = 0; j < 125; j++) {
        const x = i * 1000;
        const y = j * 1000;
        m.run('RECTANG', { p1: [x, y], p2: [x + 800, y + 600] });
        if ((i + j) % 2) m.run('CIRCLE', { center: [x + 400, y + 300], radius: 200 });
      }
    });
    const build = performance.now() - t0;
    m.view.zoomExtents();
    const times = [];
    for (let k = 0; k < 5; k++) times.push(m.view.redrawNow());
    return { n: m.query.summary().entityCount, build: Math.round(build), render: Math.round(Math.min(...times)) };
  });
  check(`Hiệu năng: ${perf.n} đối tượng vẽ trong ${perf.render} ms`, perf.render < 250, JSON.stringify(perf));
  // Rê chuột trên bản vẽ lớn: đo thời gian xử lý một lần di chuyển.
  const moveMs = await page.evaluate(async () => {
    const cv = document.querySelector('#cv');
    const r = cv.getBoundingClientRect();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) cv.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 100 + i * 10, clientY: r.top + 200, bubbles: true }));
    return (performance.now() - t0) / 20;
  });
  check(`Rê chuột trên bản vẽ lớn: ${moveMs.toFixed(1)} ms/lần`, moveMs < 30);

  // 13. Gợi ý lệnh, nhập động, POLAR, bảng thuộc tính, sửa chữ tại chỗ.
  await page.evaluate(() => {
    const m = window.mhcad;
    m.file.newDrawing();
    m.run('RECTANG', { p1: [0, 0], p2: [4000, 3000] });
    m.run('CIRCLE', { center: [6000, 1500], radius: 700 });
    m.run('TEXT', { position: [500, 1200], text: 'Phòng ngủ', height: 300 });
    m.view.zoomExtents();
  });
  await page.waitForTimeout(50);
  await cmd.fill('');
  await cmd.type('TR');
  const acTxt = await page.locator('#ac').innerText();
  check('Gợi ý lệnh khi gõ', (await page.locator('#ac').isVisible()) && acTxt.includes('TRIM'), acTxt.split('\n')[0]);
  await cmd.press('Escape');
  await cmd.fill('');
  await cmd.type('ELL');
  await cmd.press('ArrowDown');
  await cmd.press('Enter');
  const prompt1 = await page.locator('#prompt').innerText();
  check('Chọn gợi ý bằng phím mũi tên + Enter', prompt1.startsWith('ELLIPSE'), prompt1);
  await page.keyboard.press('Escape');

  await type('L', '0,0');
  // Đưa chuột gần hướng 45° (lệch một chút) → POLAR bắt đúng 45°.
  const [ox, oy] = await page.evaluate(() => window.mhcad.view.toClient([0, 0]));
  const [tx, ty] = await page.evaluate(() => window.mhcad.view.toClient([2000, 2050]));
  await page.mouse.move(tx, ty, { steps: 3 });
  const dynTxt = await page.locator('#dyn').innerText();
  check('Ô nhập động hiện độ dài/góc và POLAR', (await page.locator('#dyn').isVisible()) && /45°/.test(dynTxt), dynTxt.replace(/\n/g, ' | '));
  await page.mouse.click(tx, ty);
  await cmd.press('Enter');
  const pl = await page.evaluate(() => window.mhcad.query.entities({ type: 'LINE' }).pop());
  const ang = (Math.atan2(pl.b[1] - pl.a[1], pl.b[0] - pl.a[0]) * 180) / Math.PI;
  check('POLAR khoá góc 45°', Math.abs(ang - 45) < 1e-9, `${ang.toFixed(6)}°`);
  void ox; void oy;

  // Bảng thuộc tính: chọn đường tròn, sửa bán kính.
  const [cxp, cyp] = await page.evaluate(() => window.mhcad.view.toClient([6700, 1500]));
  await page.mouse.click(cxp, cyp);
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(50);
  check('Ctrl+1 mở bảng thuộc tính', await page.locator('#props').isVisible());
  const rIn = page.locator('#props input[data-k="r"]');
  await rIn.fill('900');
  await rIn.press('Enter');
  const r900 = await page.evaluate(() => window.mhcad.query.entities({ type: 'CIRCLE' })[0].r);
  check('Sửa bán kính trong bảng thuộc tính', r900 === 900, String(r900));
  await page.waitForTimeout(80);
  check('Bảng thuộc tính cập nhật sau khi sửa', (await page.locator('#props').innerText()).includes('R = 900'));
  check('Ô nhập động ẩn khi không có lệnh', !(await page.locator('#dyn').isVisible()));
  await page.screenshot({ path: `${OUT}props.png` });
  await page.keyboard.press('Control+1');
  await page.keyboard.press('Escape');

  // Bấm đúp vào chữ → sửa tại chỗ.
  const [txp, typ] = await page.evaluate(() => window.mhcad.view.toClient([700, 1300]));
  await page.mouse.move(txp, typ);
  await page.mouse.dblclick(txp, typ);
  await page.waitForTimeout(50);
  check('Bấm đúp mở ô sửa chữ', await page.locator('#inline').isVisible());
  await page.locator('#inline').fill('Phòng khách 20m²');
  await page.locator('#inline').press('Enter');
  const txt = await page.evaluate(() => window.mhcad.query.entities({ type: 'TEXT' })[0].text);
  check('Sửa chữ tại chỗ', txt === 'Phòng khách 20m²', txt);

  // Thanh menu → lệnh XLINE; MTEXT qua hộp soạn nhiều dòng.
  await page.evaluate(() => window.mhcad.file.newDrawing());
  await page.locator('.menubar button:text-is("Vẽ")').click();
  check('Mở menu Vẽ', await page.locator('#menupop').isVisible());
  await page.screenshot({ path: `${OUT}menu.png` });
  await page.locator('#menupop [data-mi="cmd:XLINE"]').click();
  await type('0,0', '1000,1000');
  await cmd.press('Enter');
  const xl = await page.evaluate(() => window.mhcad.query.entities({ type: 'XLINE' }));
  // Rê chuột lên XLINE ở xa điểm gốc vẫn nhận ra đối tượng (bấm chọn được).
  await page.evaluate(() => window.mhcad.view.zoomWindow([-6000, -6000], [6000, 6000]));
  const [xx, xy] = await page.evaluate(() => window.mhcad.view.toClient([5000, 5000]));
  await page.mouse.move(xx, xy);
  await page.waitForTimeout(50);
  await page.mouse.click(xx, xy);
  const selX = await page.evaluate(() => window.mhcad.query.selection());
  check('Bấm chọn XLINE xa điểm gốc', selX.length === 1, JSON.stringify(selX));
  await page.keyboard.press('Escape');
  check('Vẽ XLINE từ menu', xl.length === 1 && Math.abs(xl[0].dir[0] - Math.SQRT1_2) < 1e-9, JSON.stringify(xl[0]?.dir));
  await type('MT', '0,0', '3000,-1000');
  await page.waitForTimeout(50);
  check('MTEXT mở hộp soạn chữ', await page.locator('#textdlg').isVisible());
  await page.locator('#textdlg-area').fill('Ghi chú:\nTường gạch 220');
  await page.locator('#textdlg button[value="ok"]').click();
  await page.waitForFunction(() => window.mhcad.query.entities({ type: 'TEXT' }).length > 0, null, { timeout: 3000 }).catch(() => {});
  const mt = await page.evaluate(() => window.mhcad.query.entities({ type: 'TEXT' }).map((e) => e.text));
  check('MTEXT tạo chữ nhiều dòng', mt.length === 1 && mt[0] === 'Ghi chú:\nTường gạch 220', JSON.stringify(mt));
  await page.evaluate(() => window.mhcad.view.zoomExtents());
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.screenshot({ path: `${OUT}xline-mtext.png` });

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
