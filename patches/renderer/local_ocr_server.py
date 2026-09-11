"""
Local Captcha OCR Server cho i9 Auto Tool
Hỗ trợ 2 chế độ giải:
1. "digits" (Mặc định cho Đăng ký): Chỉ ra 4 chữ số (0-9).
2. "alphanumeric" (Cho Xin Khuyến Mãi): Ra 4 ký tự gồm cả chữ và số (a-z, 0-9).
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

print("[Local OCR] Khởi động ddddocr engines...")

# Engine 1: Chuyên giải Số (0-9)
ocr_digits = ddddocr.DdddOcr(show_ad=False)
try:
    ocr_digits.set_ranges("0123456789")
    print("[Local OCR] ✅ Engine 1: Đã khóa bộ số (0-9)")
except Exception as e:
    print(f"[Local OCR] Error setting ranges: {e}")

# Engine 2: Chuyên giải Chữ + Số (Alphanumeric) cho Xin Khuyến Mãi
ocr_alphanumeric = ddddocr.DdddOcr(show_ad=False)
print("[Local OCR] ✅ Engine 2: Giải hỗn hợp Chữ + Số (a-z, 0-9)")

print("[Local OCR] Ready at http://127.0.0.1:5588 !")

@app.route('/ocr', methods=['POST'])
def solve_captcha():
    """
    Body JSON: { "image": "<base64>", "mode": "digits" | "alphanumeric" }
    """
    try:
        data = request.get_json()
        if not data or 'image' not in data:
            return jsonify({'success': False, 'error': 'Thiếu dữ liệu ảnh base64'}), 400

        image_data = data.get('image', '').strip()
        mode = data.get('mode', 'digits').lower()

        if ',' in image_data:
            image_data = image_data.split(',')[1]

        if not image_data:
            return jsonify({'success': False, 'error': 'Chuỗi base64 rỗng'}), 400

        try:
            image_bytes = base64.b64decode(image_data)
        except Exception as b64_err:
            return jsonify({'success': False, 'error': f'Lỗi Base64: {b64_err}'}), 400

        if image_bytes.strip().startswith(b'<!DOCTYPE') or image_bytes.strip().startswith(b'<html'):
            print(f"[{time.strftime('%H:%M:%S')}] ❌ Lỗi: Trả về HTML (WAF block)")
            return jsonify({'success': False, 'error': 'Bị trang web chặn WAF (trả về HTML)'}), 400

        try:
            img = Image.open(io.BytesIO(image_bytes))
            img.load()
        except Exception as img_err:
            print(f"[{time.strftime('%H:%M:%S')}] ❌ Lỗi: Ảnh hỏng ({img_err})")
            return jsonify({'success': False, 'error': f'Ảnh hỏng: {img_err}'}), 400

        if mode == 'alphanumeric' or mode == 'all':
            # Chế độ giải Chữ + Số cho Xin Khuyến Mãi
            result = ocr_alphanumeric.classification(image_bytes)
            cleaned = ''.join(c for c in result if c.isalnum())
            print(f"[{time.strftime('%H:%M:%S')}] 🎁 OCR KM (Chữ+Số): Gốc='{result}' -> Mã='{cleaned}'")
        else:
            # Chế độ giải Số (0-9) mặc định cho Đăng ký
            result = ocr_digits.classification(image_bytes)
            cleaned = ''.join(c for c in result if c.isdigit())
            print(f"[{time.strftime('%H:%M:%S')}] 📸 OCR ĐK (Số): Gốc='{result}' -> Mã='{cleaned}'")

        if len(cleaned) == 0:
            return jsonify({'success': False, 'error': f'Không nhận dạng được ký tự (Gốc: {result})'}), 422

        return jsonify({'success': True, 'text': cleaned})

    except Exception as e:
        print(f"[Local OCR] ❌ Lỗi nội bộ: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'engine': 'ddddocr_dual_mode', 'message': 'OCR Server (Hỗ trợ cả Số và Chữ+Số)'})

if __name__ == '__main__':
    print("=" * 60)
    print("  i9 Local Captcha OCR Server (HỖ TRỢ ĐĂNG KÝ & XIN KM)")
    print("  Endpoint: http://127.0.0.1:5588/ocr")
    print("=" * 60)
    app.run(host='127.0.0.1', port=5588, debug=False)
