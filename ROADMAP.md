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

## ✅ v0.3 — Mở DWG, HATCH, trải nghiệm mượt (xong)

- ✅ **Mở DWG** (R2000–R2018) bằng LibreDWG WebAssembly (`@mlightcad/libredwg-web`, GPL-3.0) trong Web Worker, tải khi cần
- ✅ **HATCH**: 12 mẫu tự soạn, dò biên khi bấm điểm (kể cả biên tạo bởi các đoạn rời), nhận đảo; HATCHEDIT, BOUNDARY;
  đọc HATCH từ DXF/DWG (biên đa tuyến/cạnh/cung/ellipse, mẫu theo file), ghi ra block `*X`
- ✅ ARRAY (chữ nhật, tròn), STRETCH, ELLIPSE, MLINE (tường 2 nét), POINT, SETPROP, PASTECLIP
- ✅ Đọc MLINE, MULTILEADER, ACAD_TABLE, ARC_DIMENSION
- ✅ Gợi ý lệnh khi gõ, ô nhập động cạnh con trỏ (độ dài, góc, tên điểm bắt), POLAR 45° (F10)
- ✅ Bảng thuộc tính (Ctrl+1), bấm đúp để sửa chữ tại chỗ, Ctrl+C / Ctrl+V, kéo-thả file
- ✅ Hiệu năng: vẽ theo lô Path2D, lưu đệm hộp bao / hình vẽ block, chỉ mục lưới — 37.500 đối tượng vẽ ~25 ms

## ✅ v0.4 (phần 1) — Nhiều bản vẽ, menu, lệnh vẽ bổ sung

- ✅ Mở nhiều bản vẽ theo tab (mở file khi đang có bản vẽ → tab mới; lịch sử hoàn tác riêng từng tab; tự lưu tạm mọi tab)
- ✅ Thanh menu chữ Tệp / Sửa / Vẽ / Sửa đổi / Chú thích / Xem / Đo / Trợ giúp (bố cục riêng của MHCAD)
- ✅ XLINE, RAY (đối tượng vô hạn: vẽ, chọn, bắt điểm, cắt, offset; đọc từ DXF/DWG, ghi R12 thành LINE đủ dài)
- ✅ SPLINE vẽ mới (đường cong trơn qua các điểm), DONUT, REVCLOUD (chữ nhật / tự do / biến đối tượng thành mây)
- ✅ MTEXT nhiều dòng (hộp soạn, tự ngắt dòng theo bề rộng khung), FIND tìm & thay chữ
- ✅ Bắt điểm tiếp tuyến (TAN)

## ✅ v0.4 (phần 2) — Bộ lệnh mở rộng (đối chiếu danh sách tính năng AicoCad 0.3.77)

- ✅ Layer: LAYOFF, LAYFRZ, LAYLCK, LAYULK, LAYON, LAYISO, LAYUNISO, LAYCUR, LAYMCUR, LAYMCH, COPYTOLAYER, LAYMRG
- ✅ Chọn: SELECTALL, QSELECT, SELECTSIMILAR, HIDEOBJECTS, ISOLATEOBJECTS, UNISOLATEOBJECTS
- ✅ Chữ: DDEDIT, SCALETEXT, TCOUNT, TCASE, TORIENT, TXT2MTXT, JUSTIFYTEXT, TCIRCLE, TEXTMASK, TEXTUNMASK
- ✅ Thứ tự vẽ: DRAWORDER, TEXTTOFRONT, HATCHTOBACK; WIPEOUT (vẽ, đọc DXF)
- ✅ Sửa: LENGTHEN, DIVIDE, MEASURE, OVERKILL, ALIGN, OOPS, BREAKATPOINT, REVERSE, SETBYLAYER, PEDIT, ARRAYPATH
- ✅ Tra cứu & quản lý: ID, CAL, MASSPROP, STATUS, TIME, BCOUNT, PURGE, RENAME, BLOCKREPLACE, UNITS, COLOR, CELTYPE, SETVAR
- ✅ Kích thước & ghi chú: DIMBASELINE, DIMORDINATE, DIMARC, QDIM, DIMEDIT, DIMSPACE, MLEADER, TABLE, CENTERMARK, CENTERLINE,
  BREAKLINE, GOPY
- ✅ Tệp & bộ nhớ tạm: QSAVE, SAVEAS, SAVEALL, CLOSEALL, PNGOUT, WBLOCK, COPYCLIP, CUTCLIP, COPYBASE, CUTBASE, PASTEBLOCK,
  PASTEORIG, UNDO n bước, MREDO, TEXTSCR (F2), CLEANSCREEN (Ctrl+0)
- ✅ Thanh menu 12 mục, thanh thuộc tính (layer / màu / kiểu đường hiện hành)
- ✅ Lệnh chưa có hỏi đáp riêng tự hỏi tham số bắt buộc trên dòng lệnh

## v0.4 — Còn thiếu

- [ ] Chuyển mã TCVN3 / VNI → Unicode khi mở file cũ
- [ ] AutoLISP (trình thông dịch tập con)
- [ ] Layout / paper space, viewport, khung tên
- [ ] Kích thước đọc từ DXF giữ được giá trị đo (hiện hiển thị qua block hình vẽ gốc)
- [ ] Đa tuyến có cung (bulge) giữ nguyên khi sửa (hiện chia thành đoạn thẳng)
- [ ] FILLET/CHAMFER cho đa tuyến và cung; OFFSET có cung
- [ ] Đường dóng theo điểm (object tracking)
- [ ] AutoLISP (trình thông dịch + APPLOAD), độ dày nét (lineweight), thuộc tính block (ATTDEF / ATTEDIT), GROUP, BEDIT
- [ ] PDFIMPORT, GRADIENT, thư viện mẫu hatch, nhập ảnh tham chiếu
- [ ] Ghi DXF R2000+ (LWPOLYLINE, HATCH gốc, handle), giữ lại dữ liệu chưa hiểu khi ghi lại
- [ ] Bảng alias tự sửa; nạp file `.pgp` của người dùng; WBLOCK, thư viện block

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
