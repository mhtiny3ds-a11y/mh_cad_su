# MHCAD

Phần mềm CAD 2D **miễn phí, mã nguồn mở**, chạy ngay trên trình duyệt — không cần cài đặt.

👉 Dùng thử: https://mhtiny3ds-a11y.github.io/mh_cad_su/ (sau khi bật GitHub Pages, xem bên dưới)

## Tính năng (v0.4)

- **Mở file DWG** (phiên bản R2000–R2018) và DXF ngay trên trình duyệt, kéo-thả file vào vùng vẽ
- **Mở nhiều bản vẽ cùng lúc theo tab**, mỗi bản vẽ giữ lịch sử hoàn tác riêng; thanh menu chữ (Tệp, Sửa, Vẽ, Sửa đổi…)
- Vẽ: đoạn thẳng, đa tuyến, **đường dựng vô hạn (XLINE, RAY)**, **tường 2 nét (MLINE)**, hình chữ nhật, đa giác đều, đường tròn, cung tròn, elip,
  **đường cong trơn (SPLINE)**, **đường mây (REVCLOUD)**, vành khuyên (DONUT), điểm, chữ tiếng Việt một dòng và **nhiều dòng (MTEXT)**; tìm & thay chữ (FIND)
- **Tô vật liệu (HATCH)**: bấm vào trong vùng là tự dò biên, nhận đảo; 12 mẫu (gạch, bê tông, đất, thép…)
- Sửa: di chuyển, sao chép, xoay, tỉ lệ, đối xứng, offset, **cắt (TRIM), kéo dài (EXTEND), bo góc (FILLET), vát góc (CHAMFER), bẻ (BREAK), nối (JOIN), kéo giãn (STRETCH), mảng (ARRAY)**, phá, xoá; **sửa nhanh bằng grip**
- **Kích thước**: ngang/đứng, song song, bán kính, đường kính, góc, nối tiếp; chỉnh kiểu kích thước
- **Block**: tạo, chèn, phá; đọc block từ file DXF
- **Kiểu đường** (nét đứt, nét trục…) và LTSCALE; **hộp quản lý layer**
- **In / lưu PDF** theo khổ A4–A0 và tỉ lệ 1:N; xuất SVG
- Diện tích & chu vi (AREA), đổi thuộc tính (CHPROP, MATCHPROP), **bảng thuộc tính** (Ctrl+1), bấm đúp để sửa chữ, Ctrl+C / Ctrl+V
- **Gợi ý lệnh khi gõ**, ô nhập động cạnh con trỏ, POLAR 45°
- Nhanh với bản vẽ lớn (hàng chục nghìn đối tượng)
- Dòng lệnh quen thuộc: gõ `L`, `C`, `REC`, `M`, `CO`, `O`…; toạ độ `x,y`, `@dx,dy`, `@dài<góc`; gõ số để vẽ theo hướng chuột
- Bắt điểm (đầu mút, trung điểm, tâm, góc phần tư, giao điểm, vuông góc, **tiếp tuyến**), ORTHO, lưới
- Chọn bằng bấm, khung trái→phải (nằm trọn) và phải→trái (chạm khung)
- Layer: tạo, màu, đặt hiện hành, khoá/tắt
- Mở / lưu **DXF** (mở được bằng các phần mềm CAD phổ biến); đọc được block, kích thước, cung trong đa tuyến, ellipse, spline, bảng mã tiếng Việt cũ; chữ tiếng Việt giữ nguyên
- Hoàn tác / làm lại không giới hạn (500 bước), tự lưu tạm trong trình duyệt
- Giao diện sáng/tối, dùng được trên điện thoại, cài như ứng dụng (PWA)
- **Điều khiển bằng script và trợ lý AI** qua `window.mhcad` (xem dưới)

## Điều khiển bằng script / AI

Mở Console (F12) hoặc cho trợ lý AI (ví dụ Claude in Chrome) dùng:

```js
mhcad.help()                                   // danh sách lệnh + tham số (JSON)
mhcad.batch('Vẽ phòng', () => {                // nhiều lệnh = 1 lần hoàn tác
  mhcad.run('LAYER', { name: 'TUONG', color: 1 })
  const r = mhcad.run('RECTANG', { p1: [0, 0], p2: [4000, 3000] })
  mhcad.run('OFFSET', { ids: r.ids, distance: 200, side: [-1, -1] })
  mhcad.run('TEXT', { position: [1200, 1400], text: 'Phòng ngủ', height: 250, layer: 'CHU' })
})
mhcad.query.summary()                          // tổng quan bản vẽ
mhcad.query.entities({ layer: 'TUONG' })       // đọc đối tượng
mhcad.view.snapshot()                          // ảnh PNG khung nhìn hiện tại
```

## Phát triển

```bash
npm install
```

```bash
npm run dev        # chạy thử tại http://localhost:5173/mh_cad_su/
```

```bash
npm test           # kiểm thử đơn vị
```

```bash
npm run build && npm run e2e   # kiểm thử đầu-cuối trên Chromium (cần Playwright)
```

Xem [ROADMAP.md](ROADMAP.md) cho kế hoạch và [CLAUDE.md](CLAUDE.md) cho quy ước mã nguồn.

## Triển khai GitHub Pages

1. Repo phải ở chế độ **Public** (Pages miễn phí chỉ áp dụng cho repo công khai).
2. Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
3. Mỗi lần đẩy lên nhánh `main`, workflow `Deploy GitHub Pages` tự build và đăng.
4. Khi mua tên miền: Settings → Pages → Custom domain, và đặt biến repo `MHCAD_BASE` = `/`.

## Thư viện bên ngoài

| Thư viện | Dùng để | Giấy phép |
|---|---|---|
| [@mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web) (LibreDWG) | Đọc file DWG | GPL-3.0 |

## Giấy phép

[GPL-3.0-or-later](LICENSE). Bạn được dùng, sửa và phân phối lại miễn phí, với điều kiện bản phân phối lại cũng mở mã nguồn theo GPL.

MHCAD là dự án độc lập, không liên kết với hay được chứng thực bởi Autodesk, Inc. hoặc Trimble Inc.
AutoCAD là nhãn hiệu của Autodesk, Inc.; SketchUp là nhãn hiệu của Trimble Inc.
