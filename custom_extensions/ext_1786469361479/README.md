# TOOL i9 AUTO REGISTER CHROME EXTENSION

Bộ công cụ Chrome Extension tự động hóa đăng ký tài khoản i9 (`m.9922999.com`, `m.9922044.com` và domain tùy chỉnh).

---

## 📁 DANH SÁCH FILE TIỆN ÍCH (`E:\i9`)

- `manifest.json`: File cấu hình Chrome Extension Manifest V3.
- `popup.html`: Giao diện điều khiển Popup extension.
- `popup.js`: Bộ tạo dữ liệu ngẫu nhiên & quản lý trạng thái.
- `background.js`: Service worker tự động điền form, gửi ảnh OCR & bấm Đăng ký.
- `content.js`: Tương tác DOM trực tiếp theo Exact XPath.
- `icon128.png`: Icon tiện ích.
- `local_ocr_server.py`: Engine OCR ddddocr cục bộ (Ép giải số 0-9).
- `run_local_ocr.bat`: File nhấp đúp bật OCR Server trên máy.
- `README.md`: Hướng dẫn sử dụng.

---

## 🚀 HƯỚNG DẪN CHẠY TOOL

1. **Khởi động OCR Server**:
   - Bật file `run_local_ocr.bat`.

2. **Nạp Extension vào Trình duyệt**:
   - Truy cập `chrome://extensions` -> Bật **Developer mode** -> Chọn **Load unpacked** dẫn tới thư mục `E:\i9`.

3. **Chạy Đăng ký**:
   - Mở web i9 trên trình duyệt -> Mở Extension Popup -> Bấm **🚀 ĐĂNG KÝ** hoặc **⚡ CHẠY ALL**.
