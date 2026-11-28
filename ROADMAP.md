# Lộ trình MHCAD

Nguyên tắc: làm **ít lệnh nhưng chạy chắc**, có kiểm thử. Mỗi phiên làm một mục nhỏ, rõ ràng.

## ✅ v0.1 — Khung dự án (xong)

- Vite + TypeScript, GPL-3.0, CI, GitHub Pages
- Mô hình bản vẽ + hoàn tác theo giao dịch; API lệnh dùng chung cho giao diện, script và AI
- Canvas 2D: pan/zoom, lưới, bắt điểm, ORTHO, chọn khung window/crossing
- Lệnh: LINE, PLINE, RECTANG, CIRCLE, ARC, TEXT, ERASE, MOVE, COPY, ROTATE, SCALE, MIRROR, OFFSET, EXPLODE, LAYER, DIST, LIST, ZOOM, U/REDO
- DXF R12 đọc/ghi (chữ tiếng Việt mã hoá `\U+`), tự lưu tạm
- `window.mhcad`: run, batch, query, view.snapshot

## ✅ v0.2 — Sửa hình học, ghi chú, block, in (xong)

- ✅ TRIM, EXTEND, FILLET (bán kính, 0 = nối góc), CHAMFER, BREAK, JOIN (LINE và đa tuyến)
- ✅ Grip: bấm đối tượng đang chọn rồi kéo đầu mút / tâm / bán kính / đỉnh
- ✅ Bắt điểm vuông góc (PER)
- ✅ POLYGON, AREA, CHPROP, MATCHPROP, LAYDEL, đổi tên layer
- ✅ Kích thước: DIMLINEAR, DIMALIGNED, DIMRADIUS, DIMDIAMETER, DIMANGULAR, DIMCONTINUE, DIMSTYLE
- ✅ Hộp quản lý layer (hiện, khoá, màu, kiểu đường, đổi tên, xoá); đổi layer đối tượng đang chọn bằng ô layer
- ✅ Kiểu đường do MHCAD định nghĩa (DASHED, HIDDEN, CENTER, DASHDOT, DOT, PHANTOM) + LTSCALE
- ✅ BLOCK, INSERT, EXPLODE block/kích thước
- ✅ DXF: đọc/ghi block, kích thước (kèm block hình vẽ), kiểu đường, căn chữ; đọc cung trong đa tuyến, ELLIPSE,
  SPLINE, SOLID, LEADER, MINSERT, ATTRIB; bỏ qua paper space; bảng mã ANSI_1258 / UTF-8
- ✅ In / lưu PDF theo khổ A4–A0, tỉ lệ 1:N hoặc vừa khổ, đen trắng; xuất SVG
- ✅ Cảm ứng: chụm hai ngón để zoom/di chuyển

## v0.3 — Còn thiếu so với các phần mềm CAD web đầy đủ

- [ ] FILLET/CHAMFER cho đa tuyến và cung; TRIM/EXTEND cho đa tuyến tự cắt; OFFSET có cung
- [ ] Đa tuyến có cung (bulge) giữ nguyên khi sửa (hiện nhập vào được chia thành đoạn thẳng)
- [ ] Bắt điểm tiếp tuyến (TAN), đường dóng (tracking), POLAR 15°/30°/45°
- [ ] HATCH (mẫu tự soạn) + đọc HATCH từ DXF
- [ ] MTEXT nhiều dòng thật sự, sửa chữ tại chỗ (DDEDIT), tìm & thay chữ
- [ ] Chuyển mã TCVN3 / VNI → Unicode khi mở file cũ
- [ ] Bảng thuộc tính (Properties) cho đối tượng đang chọn
- [ ] Kích thước đọc từ DXF giữ được giá trị đo (hiện hiển thị qua block hình vẽ gốc)
- [ ] STRETCH, ARRAY (chữ nhật, tròn, theo đường), ELLIPSE, SPLINE, XLINE, POINT, DONUT, REVCLOUD
- [ ] Layout / paper space, viewport, khung tên

## v0.4 — File & hiệu năng

- [ ] Đọc DWG bằng LibreDWG (WebAssembly, GPL-3.0) trong Web Worker
- [ ] Ghi DXF R2000+ (LWPOLYLINE, handle), giữ lại dữ liệu chưa hiểu khi ghi lại
- [ ] Chỉ mục không gian + bộ nhớ đệm hình vẽ block cho bản vẽ lớn
- [ ] Bảng alias tự sửa; nạp file `.pgp` của người dùng
- [ ] WBLOCK, thư viện block dùng chung

## v0.5 — Trợ lý AI điều khiển MHCAD

- [ ] Gói `mhcad-mcp`: cầu nối MCP (Claude Desktop / Claude Code) ↔ tab MHCAD qua WebSocket `localhost` + mã ghép cặp
- [ ] Hỏi xác nhận trước thao tác lớn (xoá nhiều, ghi đè file)
- [ ] Hỗ trợ WebMCP (`navigator.modelContext`) khi chuẩn ổn định
- [ ] (Tuỳ chọn) khung chat trong MHCAD dùng khoá API của chính người dùng
- [ ] Đánh dấu rõ chữ trong bản vẽ là dữ liệu, không phải chỉ dẫn (chống prompt injection)

## v0.6 — Bản địa hoá Việt Nam

- [ ] Mẫu bản vẽ theo ngành (kiến trúc, kết cấu, giao thông, cấp thoát nước)
- [ ] Toạ độ VN2000 ↔ WGS84, xuất KML
- [ ] Thống kê diện tích phòng, bảng khối lượng ra Excel

## Sau này

- Chế độ 3D cơ bản (three.js): vẽ mặt, Push/Pull, cầu nối 2D → 3D
- Hiệu năng bản vẽ lớn (chỉ mục không gian, vẽ bằng WebGL)
- Cảm ứng: chụm hai ngón để zoom, kéo để pan
