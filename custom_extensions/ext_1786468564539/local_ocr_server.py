"""
Local Captcha OCR Server cho i9 Auto Tool
Chạy trực tiếp trên máy cục bộ (localhost:5588) sử dụng ddddocr offline.
Ép giải CHỈ MÃ SỐ (0-9) & Xử lý an toàn ảnh hỏng / WAF block.
"""

import sys
import os
import base64
import json
import time
import io
from PIL import Image

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass

import ddddocr
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

print("[Local OCR] Khởi động ddddocr engine...")
ocr = ddddocr.DdddOcr(show_ad=False)
try:
    ocr.set_ranges("0123456789")
    print("[Local OCR] ✅ Đã khóa bộ ký tự: CHỈ GIẢI MÃ SỐ (0-9)")
except Exception as e:
    print(f"[Local OCR] Cảnh báo set_ranges: {e}")

print("[Local OCR] Engine sẵn sàng tại http://127.0.0.1:5588 !")

@app.route('/ocr', methods=['POST'])
def solve_captcha():
    """
    Giải Captcha trực tiếp offline bằng ddddocr (Ép ra 4 số)
    Body JSON: { "image": "<base64>" }
    """
    try:
        data = request.get_json()
        if not data or 'image' not in data:
            return jsonify({'success': False, 'error': 'Thiếu dữ liệu ảnh base64'}), 400

        image_data = data.get('image', '').strip()
        if ',' in image_data:
            image_data = image_data.split(',')[1]

        if not image_data:
            return jsonify({'success': False, 'error': 'Chuỗi base64 rỗng'}), 400

        # 解码 Base64
        try:
            image_bytes = base64.b64decode(image_data)
        except Exception as b64_err:
            return jsonify({'success': False, 'error': f'Lỗi giải mã Base64: {b64_err}'}), 400

        # Kiểm tra xem dữ liệu có phải là HTML / Text không (WAF block)
        if image_bytes.strip().startswith(b'<!DOCTYPE') or image_bytes.strip().startswith(b'<html'):
            print(f"[{time.strftime('%H:%M:%S')}] ❌ Lỗi: Dữ liệu nhận vào là HTML (Bị WAF chặn)")
            return jsonify({'success': False, 'error': 'Bị trang web chặn WAF (trả về HTML)'}), 400

        # Kiểm tra tính hợp lệ của tệp ảnh với PIL
        try:
            img = Image.open(io.BytesIO(image_bytes))
            img.load()
        except Exception as img_err:
            print(f"[{time.strftime('%H:%M:%S')}] ❌ Lỗi: Ảnh bị hỏng hoặc chưa load xong ({img_err})")
            return jsonify({'success': False, 'error': f'Dữ liệu ảnh bị hỏng: {img_err}'}), 400

        # Giải captcha với ddddocr đã khóa số
        result = ocr.classification(image_bytes)
        
        # Lọc chỉ lấy các chữ số 0-9
        cleaned = ''.join(c for c in result if c.isdigit())

        print(f"[{time.strftime('%H:%M:%S')}] 📸 OCR thành công: Gốc='{result}' -> Mã số='{cleaned}'")

        if len(cleaned) == 0:
            return jsonify({'success': False, 'error': f'Không nhận dạng được số nào (Gốc: {result})'}), 422

        return jsonify({'success': True, 'text': cleaned})

    except Exception as e:
        print(f"[Local OCR] ❌ Lỗi nội bộ OCR: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'engine': 'ddddocr_local_digits_only', 'message': 'OCR Server Cục Bộ Chuyên Giải Số'})

if __name__ == '__main__':
    print("=" * 60)
    print("  i9 Local Captcha OCR Server (CHUYÊN GIẢI SỐ 0-9)")
    print("  Endpoint: http://127.0.0.1:5588/ocr")
    print("  Health:   http://127.0.0.1:5588/health")
    print("=" * 60)
    app.run(host='127.0.0.1', port=5588, debug=False)
