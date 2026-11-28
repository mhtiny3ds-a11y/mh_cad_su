# Lộ trình MHCAD

Nguyên tắc: làm **ít lệnh nhưng chạy chắc**, có kiểm thử. Mỗi phiên làm một mục nhỏ, rõ ràng.

## ✅ v0.1 — Khung dự án (xong)

- Vite + TypeScript, GPL-3.0, CI, GitHub Pages
- Mô hình bản vẽ + hoàn tác theo giao dịch; API lệnh dùng chung cho giao diện, script và AI
- Canvas 2D: pan/zoom, lưới, bắt điểm, ORTHO, chọn khung window/crossing
- Lệnh: LINE, PLINE, RECTANG, CIRCLE, ARC, TEXT, ERASE, MOVE, COPY, ROTATE, SCALE, MIRROR, OFFSET, EXPLODE, LAYER, DIST, LIST, ZOOM, U/REDO
- DXF R12 đọc/ghi (chữ tiếng Việt mã hoá `\U+`), tự lưu tạm
- `window.mhcad`: run, batch, query, view.snapshot

## v0.2 — Sửa hình học cốt lõi

- [ ] TRIM, EXTEND, FILLET (bán kính, 0 = nối góc), CHAMFER, BREAK, JOIN
- [ ] OFFSET đa tuyến: xử lý tự cắt, cung trong đa tuyến (bulge)
- [ ] Grip: kéo đầu mút / tâm để sửa nhanh
- [ ] Bắt điểm: vuông góc (PER), tiếp tuyến (TAN), đường dóng (tracking)
- [ ] Nhập độ dài theo POLAR (góc 15°/30°/45°)

## v0.3 — Ghi chú bản vẽ

- [ ] Kích thước: DIMLINEAR, DIMALIGNED, DIMRADIUS, DIMDIAMETER, DIMANGULAR, DIMCONTINUE; kiểu kích thước
- [ ] MTEXT nhiều dòng, sửa chữ (DDEDIT), font TTF tiếng Việt
- [ ] Chuyển mã TCVN3 / VNI → Unicode khi mở file cũ
- [ ] HATCH (mẫu tự soạn, không dùng file mẫu của hãng khác)
- [ ] Bảng layer đầy đủ (bật/tắt, khoá, màu, kiểu đường, đổi tên, xoá)
- [ ] Kiểu đường (nét đứt, nét chấm gạch), độ dày nét

## v0.4 — Block & file

- [ ] BLOCK, INSERT, WBLOCK, thuộc tính (ATTDEF)
- [ ] Đọc DXF đầy đủ hơn: INSERT, DIMENSION, HATCH, SPLINE, ELLIPSE; giữ lại dữ liệu chưa hiểu khi ghi lại
- [ ] Ghi DXF R2000+ (LWPOLYLINE, handle)
- [ ] Đọc DWG bằng LibreDWG (WebAssembly, GPL-3.0) trong Web Worker
- [ ] In / xuất PDF theo tỉ lệ, khổ giấy A4–A0, khung tên
- [ ] Bảng alias tự sửa; nạp file `.pgp` của người dùng

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
