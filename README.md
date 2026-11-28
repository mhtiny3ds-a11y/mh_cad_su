# MHCAD

Phần mềm CAD 2D **miễn phí, mã nguồn mở**, chạy ngay trên trình duyệt — không cần cài đặt.

👉 Dùng thử: https://mhtiny3ds-a11y.github.io/mh_cad_su/ (sau khi bật GitHub Pages, xem bên dưới)

## Tính năng (v0.1)

- Vẽ: đoạn thẳng, đa tuyến, hình chữ nhật, đường tròn, cung tròn, chữ tiếng Việt
- Sửa: di chuyển, sao chép, xoay, tỉ lệ, đối xứng, offset, phá đa tuyến, xoá
- Dòng lệnh quen thuộc: gõ `L`, `C`, `REC`, `M`, `CO`, `O`…; toạ độ `x,y`, `@dx,dy`, `@dài<góc`; gõ số để vẽ theo hướng chuột
- Bắt điểm (đầu mút, trung điểm, tâm, góc phần tư, giao điểm), ORTHO, lưới
- Chọn bằng bấm, khung trái→phải (nằm trọn) và phải→trái (chạm khung)
- Layer: tạo, màu, đặt hiện hành, khoá/tắt
- Mở / lưu **DXF** (mở được bằng các phần mềm CAD phổ biến); chữ tiếng Việt giữ nguyên
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

## Giấy phép

[GPL-3.0-or-later](LICENSE). Bạn được dùng, sửa và phân phối lại miễn phí, với điều kiện bản phân phối lại cũng mở mã nguồn theo GPL.

MHCAD là dự án độc lập, không liên kết với hay được chứng thực bởi Autodesk, Inc. hoặc Trimble Inc.
AutoCAD là nhãn hiệu của Autodesk, Inc.; SketchUp là nhãn hiệu của Trimble Inc.
