# Phân tích AicoCad / AicoSu (aicovn.com) và kế hoạch cho dự án mh_cad_su

> Ngày khảo sát: 27/11/2026. Nguồn:
> 1. Nội dung hiển thị của https://aicovn.com/cad và https://aicovn.com/su (đọc qua dịch vụ trung gian).
> 2. Hai gói phân tích do chủ dự án cung cấp, khảo sát trực tiếp trong Chrome: đọc DOM, tài nguyên JS,
>    trạng thái `window.AicoCad`, chạy thử lệnh, ảnh chụp màn hình (`AicoCad-phan-tich-0.3.70.zip`, `aicosu-phan-tich.zip`).
>    Mục 1.4–1.6 dựa trên các gói này. Gói không chứa mã nguồn của AICO.
>
> Phần pháp lý là phân tích tham khảo, **không phải tư vấn pháp lý**. Trước khi thương mại hoá,
> nên hỏi luật sư sở hữu trí tuệ.

---

## 1. Hai trang web đó là gì

### 1.1. AicoCad (`/cad`, phiên bản 0.3.70)

Ứng dụng CAD 2D (có một phần 3D) chạy trên trình duyệt, dạng PWA (có icon 192px, dùng được như app).
Dòng chào trên thanh lệnh: *"AicoCad 0.3.70 — gõ lệnh như AutoCAD. F1: danh sách lệnh."*

Những gì thấy được:

| Nhóm | Chi tiết |
|---|---|
| Menu cổ điển | File, Edit, View, Insert, Format, Tools, Draw, Dimension, Modify, Parametric, Window, Help, **Express** — tên mục và thứ tự gần như **trùng khớp từng dòng** với menu "Classic" của AutoCAD (eTransmit, Plot Style Manager, Drawing Recovery Manager, SteeringWheels, ViewCube, Sheet Set Manager, QuickCalc, Visual LISP Editor, "Edit Program Parameters (acad.pgp)", Express Tools…) |
| Ribbon | Home, Insert, Annotate, Parametric, View, Manage, Output, Add-ins, Collaborate, Express Tools, Featured Apps — **trùng tên tab ribbon AutoCAD** |
| Thanh trạng thái | Grid, Snap Mode, Infer Constraints, Dynamic Input, Ortho, Polar Tracking, Isometric Drafting, Object Snap Tracking, LineWeight, Transparency, Selection Cycling, Annotation Monitor, Clean Screen… — **trùng thanh trạng thái AutoCAD** |
| Workspace | "Drafting & Annotation", "AicoCad Classic" (tương ứng "AutoCAD Classic") |
| Lệnh vẽ/sửa | Line, Polyline, Circle (6 kiểu), Arc (nhiều kiểu), Rectangle, Polygon, Hatch, Multiline ("tường 2 nét"), Revision Cloud, Move/Copy/Stretch/Rotate/Mirror/Scale, Trim/Extend, Fillet/Chamfer, Array (rect/polar/path), Overkill, Block/Block Editor/Attributes, Group, Layer, Dimension, Multileader, Table, Constraint hình học & kích thước |
| File | Open/Save, **DWG Convert**, **Save As DXF**, Export PDF/PNG, PDF Import, DWG Compare |
| Việt hoá | Font **SHX**, chuyển mã **TCVN3 / VNI**, nhiều chú thích tiếng Việt |
| Mở rộng | **AutoLISP** (Load .lsp, VLISP), "Lisp L3", "L3 Hub", "L3 Open", App Store, App Manager |
| Hệ sinh thái | Nút "Dựng 3D AicoSu", AicoCloud (Push to AicoCloud, Share Drawing), AiRenderVIP, nhập lệnh bằng giọng nói (🎤), Performance Analyzer, Send Feedback |

### 1.2. AicoSu (`/su`, đường dẫn thật `/h3-su-web/`, phiên bản 1.90.2)

Mô hình hoá 3D kiểu SketchUp trên trình duyệt. Liên kết từ AicoCad ghi rõ tooltip:
**"Mở AicoSu (SketchUp trên web)"**.

| Nhóm | Chi tiết |
|---|---|
| Menu | File, Edit, View, Camera, Draw, Tools, Window, Extensions, Help — **trùng menu SketchUp** |
| Công cụ | Select, Draw, Edit, Camera, Unhide, Undo; khay **"Large Tool Set"**; ô **"Measurements"** (VCB) — đều là thuật ngữ SketchUp |
| Màn hình chào | "Create new model", mẫu *Architectural – Millimeters, Plan View – Millimeters, Simple – Millimeters, Interior – Centimeters*, "More templates", "Show on launch" — bố cục **giống Welcome screen của SketchUp** |
| File | Kéo-thả mở **.skp / .skb** (định dạng độc quyền của SketchUp) |
| Tài khoản | "Tiếp tục bằng Google" |
| Extension riêng | H3 Hub, H3 Open, H3 Fullhouse (thiết kế nhà), H3 Render, Scene, lọc theo tầng ("Tầng: tất cả") |

### 1.3. Nhận xét tổng quan

- Đây là một sản phẩm "clone giao diện + tương thích định dạng": người dùng AutoCAD/SketchUp tại Việt Nam
  vào là dùng được ngay, không phải học lại. Đó là điểm mạnh kinh doanh chính của họ.
- Mô hình kinh doanh suy ra: miễn phí/giá rẻ cho công cụ lõi, kiếm tiền qua **render AI (AiRenderVIP)**,
  cloud, app store/plugin (L3, H3), tài khoản Google.
- Số phiên bản (0.3.x cho CAD, 1.90.x cho SU) cho thấy AicoSu ra đời trước và đã lặp nhiều lần.
- Khối lượng tính năng hiển thị rất lớn, nhưng **nhiều mục menu có thể chỉ là "vỏ"** (chưa chạy thật) — phổ biến ở các
  bản clone, không kiểm chứng được nếu không dùng thử.

### 1.4. Công nghệ (đã xác nhận từ mã đang chạy)

| | AicoCad 0.3.70 (`/aicocad/`) | AicoSu 1.90.2 (`/h3-su-web/`) |
|---|---|---|
| Mã ứng dụng | 1 file `app.js` ~1,3 MB (ES module gộp, tên biến rút gọn) + `app.css` 78 KB | 1 file `app.js` ~2,8 MB (minify, không source map) |
| Hiển thị | **Canvas 2D** (không dùng three.js) | **three.js 0.186.1** (WebGL), OrbitControls, GLTFExporter, dùng importmap, không bundler |
| Định dạng gốc | **DXF** đọc/ghi bằng JS; giữ nguyên cặp mã DXF gốc (`rawS`, `pairs`) để ghi lại không mất dữ liệu | **.skp/.skb** qua thư viện **OpenSKP 1.5.0** (ghi là MIT, có bản vá riêng) chạy trong Web Worker (`skp-worker.js`) |
| DWG | Đọc bằng **WebAssembly/WASI** (`dwgWasi → dwgToDxfWasi`), 2 Web Worker; có `SAVEASDWG`, `DWGOUT`. **Chưa rõ thư viện nào** | Nhập .dwg/.dxf làm nền |
| Khác | PDF xuất/nhập thành nét vẽ (PDF2CAD), SVG, PNG, KML/GIS, VN2000→WGS84, font SHX + TTF, **trình thông dịch AutoLISP**, 483 lệnh, 416 alias | Xuất OBJ/STL/glTF/DXF, mặt cắt, Dynamic Component (`dc-core.js`), undo, chưa có IFC |
| Tài khoản/cloud | **Supabase 2.118.0**, `/api/config`, `/api/me`; gói "Lisp L3" mở theo quyền tài khoản | **Supabase 2.118.0**, IndexedDB, localStorage |
| Cài như app | PWA | PWA, hỗ trợ cảm ứng điện thoại (con trỏ ảo, nút khoá trục) |
| Render AI | — | Qua dịch vụ bên ngoài ("Google Flow"), AiRenderVIP |

Mô hình đối tượng của AicoCad khá gọn, đáng học hỏi:
`{"t":"LWPOLYLINE","hd":"63","layer":"HA-FURNITURE","color":251,"lt":"ByLayer","lw":-1,"pts":[[x,y,z],…],"closed":true}`
(`t` = loại, `hd` = handle DXF, `color` = mã ACI, 256 = ByLayer).

Kết quả chạy thử trong báo cáo: CIRCLE, LIST (diện tích πR² đúng), U (undo) chạy đúng trên AicoCad. Chọn, camera,
Tape Measure có bắt điểm "Endpoint in Component" chạy đúng trên AicoSu. Alias của AicoCad theo kiểu "pgp Việt Nam"
(`C`=COPY, `CC`=CIRCLE, `Q`=PLINE…), khác AutoCAD gốc.

### 1.5. Các điểm có ý nghĩa pháp lý phát hiện thêm

| # | Phát hiện | Nguồn |
|---|---|---|
| 1 | Dòng đầu `app.js`: `/* AicoCad 0.3.70 — AutoCAD trên trình duyệt (AICO). */` | báo cáo AicoCad mục 2 |
| 2 | Ngay sau đó là **nguyên văn bảng acad.pgp** (`3DMIRROR,*MIRROR3D`, `A,*ARC`…). Bảng alias đang nạp chứa cả hàng trăm alias của lệnh 3D, render, mesh, point cloud mà AicoCad **không hề có** (EXTRUDE, RENDER, MESHSMOOTH…) → dấu hiệu chép nguyên file của Autodesk chứ không tự soạn | `aliases.txt` |
| 3 | **Logo AicoCad là chữ "A" trắng trên nền ô vuông đỏ** — rất giống logo AutoCAD. Giao diện tối, ô la bàn "TOP / N-E-S-W" giống ViewCube, dòng `[-][Top][2D Wireframe]`, bố cục toolbar giống AutoCAD Classic | ảnh `01-giao-dien-ban-ve-goc.jpg` |
| 4 | AicoSu: link "Mở AicoSu (SketchUp trên web)"; menu File có "Send to LayOut", "3D Warehouse", "Trimble Connect" (đổi thành dịch vụ của AICO). Logo AicoSu **không** giống logo SketchUp | báo cáo AicoSu mục 3.1, ảnh chụp |
| 5 | Đọc .skp bằng thư viện giải mã ngược (OpenSKP) chứ không dùng SDK chính thức của Trimble | `skp-worker.js` |
| 6 | DWG đọc bằng WASM; nếu đó là LibreDWG (GPLv3) thì việc gửi file WASM xuống trình duyệt là *phân phối* và kéo theo nghĩa vụ GPL. Chưa xác định được thư viện | báo cáo AicoCad mục 2 |
| 7 | Render AI "miễn phí qua Google Flow": cần xem điều khoản dịch vụ của Google có cho phép tích hợp/tự động hoá như vậy không | báo cáo AicoSu mục 3.3 |

### 1.6. Bài học kỹ thuật cho dự án mh_cad_su

- **Một người cũng làm được**: cả hai sản phẩm là ES module thuần, không framework UI nặng; 2D dùng Canvas 2D là đủ.
- **Lấy DXF làm mô hình dữ liệu gốc**, giữ lại các cặp mã không hiểu để ghi lại không mất thông tin. Đây là quyết định kiến trúc hay nhất của AicoCad.
- **Đọc/ghi file trong Web Worker** để giao diện không bị đứng khi mở file nặng.
- **Đừng gộp mọi thứ vào một file 1,3–2,8 MB**: dùng Vite để tách mã (code splitting), tải nhanh hơn trên di động.
- 3D thì three.js là lựa chọn chuẩn. Cầu nối 2D → 3D (`CAD2SU`, `DUNG3D`) là tính năng giá trị.
- Bản địa hoá Việt Nam (VN2000, mẫu theo ngành, TCVN3/VNI, lệnh tiếng Việt) là lợi thế thật, và không vướng bản quyền ai.

---

## 2. Phân tích pháp lý

Ba câu hỏi riêng biệt, đừng gộp: (A) **bản quyền** (code, giao diện, hình ảnh, tài liệu), (B) **nhãn hiệu / cạnh tranh không lành mạnh**
(tên gọi, gây nhầm lẫn), (C) **định dạng file & thư viện** (DWG, SKP, giấy phép mã nguồn mở).

### 2.1. Bản quyền

**Cái KHÔNG được bảo hộ (nhìn chung làm được):**

- Ý tưởng "phần mềm CAD/3D", chức năng, cách làm việc, quy trình. Luật SHTT Việt Nam (Điều 15) không bảo hộ
  "ý tưởng, quy trình, hệ thống, phương pháp hoạt động". Tương tự ở Mỹ (17 U.S.C. §102(b)) và EU.
- **Tên lệnh, phím tắt, cấu trúc menu** ở mức "phương pháp vận hành": án lệ Mỹ *Lotus v. Borland* (1995) cho rằng cây
  lệnh menu của Lotus 1-2-3 là phương pháp vận hành, không được bảo hộ bản quyền.
- **Ngôn ngữ lập trình và định dạng dữ liệu**: CJEU *SAS Institute v. World Programming* (C‑406/10, 2012) — chức năng,
  ngôn ngữ lập trình, định dạng file không phải là "biểu hiện" được bảo hộ. Nên viết trình thông dịch tương thích AutoLISP,
  đọc `acad.pgp`, đọc/ghi DXF là hợp lệ về nguyên tắc.
- Thực tế ngành: ZWCAD, GstarCAD, BricsCAD, progeCAD, DraftSight… đã mô phỏng lệnh và giao diện AutoCAD công khai hàng chục năm.

**Cái ĐƯỢC bảo hộ (không được sao chép):**

- **Mã nguồn / mã máy** của AutoCAD, SketchUp (kể cả dịch ngược rồi viết lại sát).
  Các vụ Autodesk kiện thường xoay quanh việc bị cho là chép code, không phải chép tên lệnh.
- **Icon, hình ảnh, màu sắc/đồ hoạ đặc trưng**, splash screen, ảnh mẫu, âm thanh.
- **Văn bản trợ giúp, tooltip dài, tài liệu** chép từ Autodesk/Trimble.
- **Nội dung đi kèm**: font SHX của Autodesk (`txt.shx`, `romans.shx`…), file mẫu hatch `acad.pat`/`acadiso.pat`,
  thư viện block, template `.dwt`, vật liệu, 3D Warehouse model, template của SketchUp.

**Vùng xám với AicoCad/AicoSu:** chép *toàn bộ* menu, ribbon, thanh trạng thái, màn hình chào gần như 1:1. Từng tên lệnh riêng lẻ
thì khó bảo hộ, nhưng **tổng thể "look and feel"** khi sao chép quá sát có thể bị lập luận là sao chép sự lựa chọn và sắp xếp sáng tạo,
hoặc là cạnh tranh không lành mạnh (mục 2.2). Án lệ về "look and feel" không thống nhất giữa các nước; ở Việt Nam gần như chưa có án lệ.

**Bảng acad.pgp chép nguyên văn (mục 1.5 #2):** danh sách "alias → lệnh" thuần chức năng thì khó được bảo hộ. Nhưng file `acad.pgp`
là văn bản do Autodesk soạn và phát hành kèm AutoCAD; chép nguyên văn cả file, kể cả hàng trăm alias cho lệnh mình không có,
cho thấy nguồn gốc là bản sao chứ không phải tự soạn. Rủi ro thấp đến trung bình. **Với dự án của bạn:** tự soạn bảng alias chỉ
cho các lệnh mình thật sự có, và cho phép người dùng **nạp file acad.pgp của chính họ** (đọc định dạng thì hợp lệ).

### 2.2. Nhãn hiệu và cạnh tranh không lành mạnh

- **AutoCAD**, **Autodesk**, **SketchUp**, **Trimble**, **DWG TrueView**, **RealDWG**, **TrustedDWG** là nhãn hiệu đã đăng ký.
- **"DWG"** bản thân: Autodesk từng tranh chấp với Open Design Alliance và không giữ được độc quyền chữ "DWG" như một định dạng —
  nói "đọc/ghi file DWG" là mô tả hợp lệ.
- Dùng tên nhãn hiệu **để mô tả tính tương thích** ("mở được file .skp", "lệnh tương thích AutoCAD") là sử dụng mô tả hợp lý
  (nominative fair use), **miễn là không gây hiểu lầm có liên kết/được cấp phép**.
- Các điểm rủi ro rõ nhất của aicovn, xếp từ cao xuống thấp:
  1. **Logo AicoCad: chữ "A" trắng trên ô vuông đỏ**, cùng giao diện tối và la bàn kiểu ViewCube. Đây là *trade dress* (tổng thể nhận diện)
     dễ gây nhầm với AutoCAD nhất, nặng hơn mọi chuyện tên lệnh.
  2. Câu **"AutoCAD trên trình duyệt"** (đầu mã nguồn) và **"SketchUp trên web"** (tooltip): dùng nhãn hiệu người khác để *định danh* sản phẩm
     của mình, chứ không chỉ mô tả tính tương thích.
  3. Mục menu mang tên dịch vụ của Trimble ("3D Warehouse", "Send to LayOut", "Trimble Connect") nhưng thực chất dẫn tới dịch vụ của AICO.
  4. Tên "AicoSu" ("Su" là cách gọi tắt phổ biến của SketchUp ở VN) và workspace "AicoCad Classic" đi gần ranh giới.
- Căn cứ có thể bị áp dụng: Luật SHTT VN Điều 129 (xâm phạm nhãn hiệu), Điều 130 (chỉ dẫn thương mại gây nhầm lẫn), Luật Cạnh tranh 2018.

### 2.3. Định dạng file và thư viện

| Định dạng | Cách hợp pháp | Lưu ý |
|---|---|---|
| **DXF** | Autodesk công bố tài liệu đặc tả DXF công khai | An toàn nhất. Nên là định dạng trao đổi chính lúc đầu. |
| **DWG** | (1) **LibreDWG** (GNU, giấy phép **GPLv3**); (2) **ODA Drawings SDK** (thành viên trả phí); (3) Autodesk RealDWG (trả phí, điều khoản chặt) | Nếu biên dịch LibreDWG sang WASM rồi **gửi cho trình duyệt** thì đó là *phân phối* → phần code liên kết với nó phải phát hành theo GPLv3. Cách tránh: chạy chuyển đổi DWG→DXF ở server dưới dạng tiến trình riêng, hoặc chấp nhận mở mã nguồn dự án theo GPL. |
| **SKP** | (1) SketchUp C SDK của Trimble (miễn phí, cần đăng ký, chỉ có bản Windows/macOS); (2) thư viện giải mã ngược bên thứ ba như **OpenSKP** mà AicoSu dùng | SDK chính thức: đọc kỹ giấy phép, không chạy được trong trình duyệt. Thư viện bên thứ ba: **tự kiểm tra** giấy phép thật (báo cáo ghi MIT) và nguồn gốc (giải mã bằng cách nào, có vi phạm EULA không) trước khi dùng; rủi ro pháp lý chủ yếu nằm ở người viết thư viện, nhưng định dạng mới của SketchUp có thể làm hỏng tương thích bất cứ lúc nào. Với dự án cá nhân: **để SKP sau cùng**, ưu tiên glTF/OBJ/STL/DAE (SketchUp xuất được). |
| glTF, OBJ, STL, IFC | Chuẩn mở | IFC đọc được bằng `web-ifc` (MPL‑2.0). |

**Dịch ngược để tương thích:** EU (Chỉ thị 2009/24/EC, Điều 6) và Mỹ (DMCA §1201(f)) có ngoại lệ hẹp cho mục đích tương thích.
Luật Việt Nam không có ngoại lệ tương tự rõ ràng như vậy, và EULA của AutoCAD/SketchUp cấm dịch ngược → **không nên** dịch ngược phần mềm của họ.

### 2.4. Các vấn đề pháp lý khác (nếu đưa lên mạng công khai)

- **Dữ liệu cá nhân**: có đăng nhập Google/email → tuân thủ Nghị định 13/2023/NĐ‑CP và Luật Bảo vệ dữ liệu cá nhân (hiệu lực từ 01/01/2026):
  chính sách quyền riêng tư, xin đồng ý, xoá dữ liệu theo yêu cầu.
- **Nội dung người dùng tải lên** (bản vẽ của khách hàng): điều khoản sử dụng, bảo mật, không dùng để huấn luyện AI nếu không có đồng ý.
- **Dịch vụ AI bên ngoài** (như render qua Google Flow của AicoSu): chỉ tích hợp qua API chính thức và đúng điều khoản; tự động hoá
  một sản phẩm tiêu dùng của bên khác để bán lại/cho dùng miễn phí có thể vi phạm điều khoản dịch vụ của họ.
- **Thu tiền**: đăng ký kinh doanh, thuế, hoá đơn điện tử; nếu là website thương mại điện tử thì thủ tục thông báo với Bộ Công Thương.
- **Giấy phép thư viện mã nguồn mở** bạn dùng: giữ file LICENSE/NOTICE, tránh trộn GPL/AGPL vào code đóng.

### 2.5. Kết luận pháp lý cho dự án của bạn

**Dùng cá nhân, không phát hành:** rủi ro thực tế gần như bằng 0, miễn là không dùng code/tài nguyên lậu.

**Nếu public/thương mại**, giữ 10 quy tắc:

1. 100% code tự viết hoặc từ thư viện có giấy phép rõ ràng. Không dịch ngược AutoCAD/SketchUp.
2. **Tên sản phẩm riêng biệt**, không chứa "Auto", "CAD" kiểu ghép gợi nhớ, "Su", "Sketch", "Up". Không mua tên miền chứa nhãn hiệu của họ.
3. **Không** viết "AutoCAD trên web", "SketchUp online". Được viết: "Hỗ trợ lệnh quen thuộc kiểu AutoCAD", "Nhập file DXF/DWG".
4. Thêm dòng miễn trừ: *"AutoCAD và DWG TrueView là nhãn hiệu của Autodesk, Inc.; SketchUp là nhãn hiệu của Trimble Inc. Sản phẩm này không liên kết với hay được chứng thực bởi các công ty đó."*
5. **Logo và icon tự thiết kế**, màu nhận diện khác hẳn (tránh chữ "A" trên ô đỏ như AicoCad). Icon công cụ dùng bộ mở như Lucide/Tabler/Phosphor — không chụp/đồ lại icon Autodesk/SketchUp.
6. Tên lệnh, phím tắt, cú pháp dòng lệnh kiểu AutoCAD: dùng được. Nhưng **thiết kế lại bố cục giao diện** (ribbon, thanh trạng thái, màn hình chào) theo cách của mình, không sao chép 1:1.
7. Tự soạn bảng alias (không chép acad.pgp); cho người dùng nạp file .pgp của họ. Không đóng gói font SHX, `acad.pat`, template, block library của Autodesk. Cho người dùng tự trỏ tới font của họ; dùng font mở (ví dụ bản tương đương của LibreCAD/ISOCP từ nguồn có giấy phép).
8. Tự viết trợ giúp/tài liệu.
9. DWG: bắt đầu bằng DXF; DWG để sau, qua LibreDWG (chấp nhận GPL) hoặc ODA (trả phí).
10. SKP: không hỗ trợ trực tiếp ở giai đoạn đầu.

---

## 3. Kế hoạch kỹ thuật đề xuất cho mh_cad_su

### 3.1. Kiến trúc

```
mh_cad_su/  (monorepo, TypeScript, Vite, pnpm)
├─ packages/
│  ├─ core-geom     # vector, ma trận, giao cắt, offset, trim/extend, B-spline (thuần TS, có test)
│  ├─ cad-doc       # mô hình tài liệu 2D: entity, layer, block, style; undo/redo (command pattern)
│  ├─ cad-io        # DXF đọc/ghi; JSON gốc; xuất SVG/PDF; (sau) DWG qua WASM/server
│  ├─ cad-app       # UI 2D: canvas WebGL/Canvas2D, dòng lệnh, object snap, ortho/polar, grip
│  ├─ mesh3d        # half-edge mesh: mặt, cạnh, push/pull, follow-me, group/component
│  ├─ model-app     # UI 3D: three.js, inference engine (điểm cuối, trung điểm, trục màu), VCB
│  └─ lisp          # (tuỳ chọn) trình thông dịch tập con AutoLISP
└─ apps/web         # PWA gộp 2 chế độ, lưu IndexedDB, (sau) đồng bộ cloud
```

### 3.2. Lựa chọn thư viện (kiểm tra giấy phép)

| Nhu cầu | Gợi ý | Giấy phép |
|---|---|---|
| Hiển thị 2D | Canvas 2D (có sẵn trong trình duyệt), giống AicoCad | — |
| Hiển thị 3D | three.js | MIT |
| Tài khoản/cloud (khi cần) | Supabase (giống AICO) hoặc chỉ lưu IndexedDB lúc đầu | MIT/Apache‑2.0 |
| Hình học solid/B-rep (nếu cần) | opencascade.js | LGPL‑2.1 |
| Đọc DXF | dxf-parser (hoặc tự viết, DXF khá đơn giản) | MIT |
| DWG | LibreDWG (WASM hoặc server) | GPL‑3.0 |
| IFC | web-ifc | MPL‑2.0 |
| Xuất PDF | jsPDF / pdf-lib | MIT |
| Icon | Lucide / Tabler | ISC / MIT |
| Tham khảo thuật toán | LibreCAD (GPL‑2.0), FreeCAD (LGPL) | chỉ đọc để học, không chép nếu không muốn GPL |

### 3.3. Lộ trình

1. **MVP 2D (4–8 tuần):** canvas pan/zoom, dòng lệnh, Line/Polyline/Circle/Arc/Rectangle, Move/Copy/Rotate/Scale/Mirror/Erase,
   Trim/Extend/Offset/Fillet, object snap (end/mid/center/intersection/perpendicular), Ortho, layer, undo/redo, lưu JSON + DXF.
2. **2D nâng cao:** Text/MText (font TTF + tiếng Việt Unicode, chuyển mã TCVN3/VNI), Dimension, Hatch, Block/Insert, in PDF theo tỉ lệ.
3. **MVP 3D:** vẽ đường trên mặt phẳng tự sinh mặt kín, Push/Pull, Move/Rotate/Scale, Orbit/Pan/Zoom, inference theo trục, Group, xuất glTF/OBJ/STL.
4. **Cầu nối 2D↔3D:** nhập bản vẽ 2D làm nền rồi dựng tường/nâng khối (đúng ý tưởng nút "Dựng 3D" của aicovn).
5. **Mở rộng:** DWG, AutoLISP tập con, plugin API, render (path tracing WebGL hoặc dịch vụ AI).

### 3.4. Bước tiếp theo đề xuất

Dựng khung monorepo + package `core-geom` và một canvas 2D có dòng lệnh vẽ được Line/Circle với snap, có test tự động.
