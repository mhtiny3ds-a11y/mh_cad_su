# Hướng dẫn cho Claude khi làm việc trên MHCAD

MHCAD là phần mềm CAD 2D chạy trên trình duyệt, miễn phí, GPL-3.0. Chủ dự án nói tiếng Việt: trả lời, chú thích mã và
thông báo giao diện đều bằng **tiếng Việt**; tên lệnh CAD giữ tiếng Anh (LINE, CIRCLE…).

## Lệnh

- `npm test` — kiểm thử đơn vị (Vitest), phải luôn xanh
- `npm run typecheck` — TypeScript strict
- `npm run build && NODE_PATH=$(npm root -g) npm run e2e` — kiểm thử đầu-cuối bằng Playwright, ảnh chụp ở `e2e/out/`
- `npm run dev` — chạy thử

## Kiến trúc

```
src/core/      không phụ thuộc DOM, kiểm thử được bằng Vitest
  geom.ts        hình học 2D thuần (Vec = readonly [x, y])
  entities.ts    LINE, CIRCLE, ARC, LWPOLYLINE, TEXT, DIMENSION, INSERT: hộp bao, chọn, bắt điểm, grip, biến đổi;
                 expand() phân rã INSERT/DIMENSION thành đối tượng cơ bản
  dim.ts         hình vẽ và giá trị của kích thước
  curve.ts       đường cong có tham số (TRIM, EXTEND, BREAK)
  document.ts    Drawing: đối tượng, layer, block, kiểu kích thước, kiểu đường, LTSCALE; hoàn tác theo giao dịch
  commands.ts    Registry + CommandDef (params, run, interactive) + runCommand/runInteractive + lệnh cơ bản + tiện ích tham số
  cmds/modify.ts TRIM, EXTEND, FILLET, CHAMFER, BREAK, JOIN, GRIPEDIT, CHPROP, MATCHPROP
  cmds/annotate.ts POLYGON, AREA, DIM*, DIMSTYLE, BLOCK, INSERT, LTSCALE
  cmds/hatch.ts  HATCH, HATCHEDIT, BOUNDARY, POINT (dò vùng kín khi bấm điểm)
  cmds/edit.ts   SETPROP, ARRAY, STRETCH, ELLIPSE, MLINE, PASTECLIP
  hatch.ts       mẫu tô, cắt nét mẫu theo biên, chia hình thang, findBoundary
  dwg.ts         DWG → DXF bằng LibreDWG WebAssembly (chạy trong src/ui/dwg-worker.ts)
  spatial.ts     chỉ mục lưới cho rê chuột / bắt điểm
  registry.ts    createRegistry(): gom mọi lệnh — lệnh mới phải được thêm vào đây
  offset.ts      OFFSET
  dxf.ts         đọc/ghi DXF ASCII (R12 khi ghi), giải mã bảng mã
  svg.ts         xuất SVG / in theo khổ giấy và tỉ lệ
  input.ts       phân tích toạ độ gõ tay
  api.ts         window.mhcad (cho script / AI)
src/ui/        giao diện
  app.ts         bộ điều khiển: chuột, phím, dòng lệnh, bắt điểm, cài đặt IO cho lệnh tương tác
  view.ts        Viewport + vẽ Canvas 2D theo lô Path2D (KHÔNG dùng closePath: rất chậm trong Chromium)
  props.ts       bảng thuộc tính (Ctrl+1)
  icons.ts       biểu tượng SVG tự vẽ
```

## Quy tắc

1. **Mọi thay đổi bản vẽ đi qua lệnh** (`CommandDef.run`) và `Drawing.add/update/remove`. Không sửa `entities` trực tiếp,
   nếu không hoàn tác sẽ sai.
2. Lệnh mới: khai báo `params` có mô tả tiếng Việt rõ ràng (AI đọc `mhcad.help()` để biết cách gọi), viết `run()` thuần dữ liệu,
   rồi `interactive()` chỉ hỏi người dùng và gọi lại `run()`. Đăng ký trong `registry.ts`. Thêm kiểm thử trong `tests/`.
3. Góc lưu bằng độ, ngược chiều kim đồng hồ. Trục Y thế giới hướng lên.
4. Mỗi tính năng mới kèm kiểm thử; sửa lỗi kèm kiểm thử tái hiện lỗi.
5. Cập nhật `ROADMAP.md` (đánh dấu ✅) khi xong một mục.

## Pháp lý (bắt buộc)

- Không chép mã, icon, logo, văn bản trợ giúp, file mẫu (acad.pgp, .pat, .shx, .dwt) của Autodesk/Trimble hay phần mềm khác.
- Được: dùng tên lệnh/cú pháp quen thuộc, đọc/ghi định dạng file theo đặc tả công khai.
- Không viết "AutoCAD online", "SketchUp trên web"… ở bất kỳ đâu. Chỉ mô tả tương thích kiểu "đọc/ghi DXF".
- Thư viện bên ngoài phải có giấy phép tương thích GPL-3.0; ghi rõ trong README khi thêm.
- Xem phân tích chi tiết: `docs/phan-tich-aicovn-va-ke-hoach.md`.
