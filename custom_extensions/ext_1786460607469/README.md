# TOOL i9 AUTO REGISTER CHROME EXTENSION

Tool tự động hóa đăng ký tài khoản cho các hệ thống game **i9** (`m.9922999.com`, `m.9922044.com` và các domain tùy chỉnh khác).

---

## 🌟 Tính Năng Nổi Bật

1. **Điền Form Tự Động Theo Exact XPath**:
   - **Tên TK**: `/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[1]/div[1]/input`
   - **Mật khẩu**: `/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[1]/div[2]/div/input`
   - **Nhập lại MK (Confirm Password)**: `/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[1]/div[3]/div/input`
   - **Chủ khoản (Họ và tên)**: `/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[2]/div/input`
   - **Mã xác minh (Captcha input)**: `/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[3]/div[1]/div/input`
   - **Ảnh Captcha**: `/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[3]/div[1]/div/img` (curl endpoint: `/Account/Register/captcha`)

2. **Giải Captcha Tự Động Qua OCR VPS**:
   - Tự động lấy ảnh Base64 Captcha và gửi đến OCR Server (`http://180.93.106.208:5588/ocr` hoặc server chạy tại `D:\proxy\shop`).
   - Nhận mã 4 chữ số và điền trực tiếp vào ô Mã xác minh.
   - Thử lại thông minh nếu Captcha cập nhật.

3. **Quy Trình Tự Động Đa Bước (CHẠY ALL)**:
   - Bước 1: Điền thông tin form đăng ký & giải Captcha.
   - Bước 2: Tự động chuyển hướng cài đặt **Mật khẩu rút tiền**.
   - Bước 3: Gửi thông báo chi tiết tài khoản vừa tạo về **Telegram Bot**.
   - Bước 4: Tự động chuyển hướng thêm thông tin **Thẻ ngân hàng**.

4. **Bộ Tạo Dữ Liệu Ngẫu Nhiên (Random Data Generator)**:
   - Tạo tên tài khoản hợp lệ, mật khẩu chữ + số.
   - Tự động đồng bộ mật khẩu nhập lại.
   - Tạo họ tên tiếng Việt chuẩn, số điện thoại, mật khẩu rút tiền 6 số, số tài khoản ngân hàng ngẫu nhiên.

---

## 🚀 Hướng Dẫn Cài Đặt Vào Trình Duyệt Chrome / Cốc Cốc

1. Mở trình duyệt Chrome hoặc Cốc Cốc, truy cập vào đường dẫn:
   ```text
   chrome://extensions
   ```
2. Bật chế độ nhà phát triển (**Developer mode**) ở góc trên bên phải.
3. Nhấn vào nút **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn thư mục:
   ```text
   E:\i9
   ```
5. Tiện ích **Tool i9 Auto Register** sẽ xuất hiện trên thanh công cụ trình duyệt.

---

## ⚙️ Hướng Dẫn Sử Dụng Tool

1. Click vào icon tiện ích trên góc trình duyệt để mở Popup.
2. Nhập API Key OCR Server (nếu có) và nhấn **Lưu**.
3. Chọn đường dẫn website mục tiêu (mặc định sẵn `https://m.9922999.com/Account/Register` và `https://m.9922044.com/Account/Register`).
4. Bấm **🎲 Random Data** để tạo thông tin ngẫu nhiên.
5. Nhấn:
   - **🚀 ĐĂNG KÝ**: Chỉ tự động điền form và gửi đăng ký trang i9 hiện tại.
   - **⚡ CHẠY ALL**: Tự động đăng ký + Cài mật khẩu rút tiền + Liên kết ngân hàng + Gửi Telegram.
   - **💳 LIÊN KẾT NH**: Chạy riêng bước cài mật khẩu rút tiền & liên kết ngân hàng.
