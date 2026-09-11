# 🚀 N/A Browser — Stealth Android Anti-Detect Browser

**N/A Browser** là ứng dụng desktop xây dựng trên nền tảng **Electron & Puppeteer-Core**, cung cấp giải pháp quản lý đa hồ sơ trình duyệt ẩn danh (Anti-Detect Profiles) với khả năng giả lập vân tay thiết bị Android ở cấp độ **CDP (Chrome DevTools Protocol - Native Engine)**.

Dự án được thiết kế mã nguồn mở nhằm phục vụ cộng đồng kiểm thử tự động, nuôi tài khoản đa nền tảng, quản lý proxy và tự động hóa tác vụ trình duyệt.

---

## 🌟 Tính Năng Nổi Bật

- 📱 **Native CDP Device Emulation:** Giả lập toàn diện thông số thiết bị Android (Viewport, Device Pixel Ratio - DPR, Client Hints `sec-ch-ua-*`, Touch Events, Timezone, Geolocation, WebGL Vendor/Renderer) giống 100% Chrome DevTools trên thiết bị thật.
- 🛡️ **Bypass Anti-Bot & Fingerprinting:** Tự động che giấu biến `navigator.webdriver`, inject fingerprint scripts qua giao diện extension native MV2.
- 🌐 **Quản lý Proxy Riêng biệt:** Hỗ trợ cấu hình HTTP/HTTPS và SOCKS5 proxy (có xác thực User/Password) cho từng profile độc lập.
- 📐 **Grid Layout Auto-Arrange:** Tự động xếp gọn và chia lưới hàng chục cửa sổ trình duyệt điện thoại đang chạy theo ma trận chuẩn xác trên màn hình.
- 🔒 **Khóa Ứng dụng & Bảo mật:** Tích hợp màn hình khóa với mã truy cập PIN (`151206`), tùy chọn lưu phiên đăng nhập và trang quản lý tài khoản bảo mật.
- ⚡ **Hệ thống Cập nhật Bản vá Nóng (OTA Hot-Patch):** Khả năng tải và nạp trực tiếp các bản vá lỗi giao diện/logic (chỉ vài chục KB) mà không cần khách hàng phải tải lại toàn bộ gói cài đặt 87 MB.
- 🔌 **Local REST API (Cổng 9399):** Cung cấp API nội bộ cho phép các công cụ tự động hóa bên ngoài (Python, C#, AutoIt, Golang...) điều khiển tạo, khởi động, dừng profile và quản lý cookie.

---

## 📂 Cấu Trúc Thư Mục Dự Án

```
cloakdroid-app/
├── assets/                 # Logo, icon ứng dụng
├── libs/                   # Thư viện binary bổ trợ (nếu có)
├── src/                    # Mã nguồn giao diện chính (Renderer Process)
│   └── renderer/
│       ├── app.js          # Logic chính, quản lý state, sự kiện nút, IPC
│       ├── index.html      # Giao diện người dùng HTML5
│       └── style.css       # Toàn bộ CSS giao diện, Dark Glassmorphism
├── main.js                 # Electron Main Process (quản lý lifecycle, window, CDP, IPC)
├── preload.js              # Electron Context Bridge (bảo mật IPC an toàn)
├── supabaseManager.js      # Module quản lý đồng bộ Cloud qua Supabase
├── supabase_config.example.json # Mẫu cấu hình Supabase
├── update_manifest.json    # File mẫu thông tin bản vá OTA
├── start.bat               # Script khởi chạy nhanh trên Windows
├── package.json            # Cấu hình dự án & dependencies
└── README.md               # Tài liệu dự án
```

---

## 🛠️ Yêu Cầu Môi Trường & Cài Đặt

### 1. Yêu cầu hệ thống
- **Hệ điều hành:** Windows 10 / 11 (64-bit)
- **Node.js:** Phiên bản `18.x` trở lên (Khuyên dùng Node 20 LTS hoặc 22)
- **Trình duyệt Google Chrome:** Đã cài sẵn trên máy (dùng cho CDP Puppeteer)

### 2. Cài đặt các gói phụ thuộc
Mở terminal (PowerShell hoặc CMD) tại thư mục dự án và chạy:
```bash
npm install
```

### 3. Khởi chạy ứng dụng (Chế độ Development)
Chạy trực tiếp bằng file `start.bat` hoặc lệnh:
```bash
npm run dev
# Hoặc
npm run start:win
```

---

## 📦 Đóng Gói Ứng Dụng (Build Release)

Dự án sử dụng **electron-builder** để đóng gói ra file cài đặt Windows (`.exe` NSIS Installer & Portable):

```bash
npm run build:win
```

Sau khi quá trình hoàn tất, các file cài đặt hoàn chỉnh sẽ nằm trong thư mục `release/`:
- `NA Browser Setup 1.0.0.exe` (Bộ cài đặt tự động)
- `win-unpacked/` (Thư mục ứng dụng chạy ngay không cần cài đặt)

---

## ⚡ Cơ Chế Cập Nhật Bản Vá Nóng (OTA Hot-Patch)

Để phát hành bản vá sửa lỗi nhanh mà không cần build lại file `.exe` 87 MB:

1. **Sửa file:** Sửa các file cần thiết trong thư mục `src/renderer/` (ví dụ `app.js`).
2. **Tải lên Server:** Đưa file `app.js` đã sửa lên GitHub raw hoặc hosting.
3. **Cập nhật Manifest:** Cập nhật file `update_manifest.json` với số `patchNumber` mới:
   ```json
   {
     "version": "1.0.1",
     "patchNumber": 1,
     "title": "Bản vá v1.0.1",
     "changelog": "Sửa lỗi giao diện và cập nhật tính năng mới",
     "files": [
       {
         "filename": "app.js",
         "url": "https://raw.githubusercontent.com/username/repo/main/src/renderer/app.js"
       }
     ]
   }
   ```
4. **Phía người dùng:** App tự động thông báo bản vá mới, người dùng chỉ cần bấm **"Tải & Áp dụng bản vá ngay"** (mất 2 giây) là hoàn tất.

---

## 🤝 Hướng Dẫn Đóng Góp (Contributing)

Chúng tôi rất hoan nghênh sự đóng góp của cộng đồng lập trình viên:

1. **Fork** kho lưu trữ này về tài khoản GitHub của bạn.
2. Tạo nhánh tính năng mới (`git checkout -b feature/tinh-nang-moi`).
3. Commit các thay đổi (`git commit -m 'Thêm tính năng X'`).
4. Đẩy lên nhánh của bạn (`git push origin feature/tinh-nang-moi`).
5. Tạo một **Pull Request (PR)** mới để chúng tôi xem xét và gộp vào dự án.

Nếu phát hiện lỗi hoặc có đề xuất tính năng mới, vui lòng tạo một **Issue** trên GitHub!

---

## 📜 Giấy Phép & Tuyên Bố Miễn Trừ

- Dự án được phát triển phục vụ mục đích nghiên cứu, học tập và kiểm thử tự động hợp pháp.
- Người sử dụng tự chịu trách nhiệm về mục đích và hành vi sử dụng phần mềm tuân thủ theo pháp luật hiện hành.
