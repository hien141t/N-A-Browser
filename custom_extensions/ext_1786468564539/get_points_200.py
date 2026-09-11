import os
import sys
import csv
import time
import random
import subprocess
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

API_URL = "https://api.svnet.vn/"

TOKENS = [
    # Token 1: Btvdoan
    "JWT eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJJZCI6MjY5NCwiQXBwQ2xpZW50SWQiOjAsIlVzZXJOYW1lIjoiQnR2ZG9hbiIsIkZ1bGxOYW1lIjoiQmFuIFRoxrDhu51uZyBW4bulIMSQb8OgbiBUcsaw4budbmciLCJDb2RlIjoiZkkrajA4STdoK1VpS2ZMM2FoanhYUT09IiwiRXhwaXJlZERhdGUiOiIwMDAxLTAxLTAxVDAwOjAwOjAwIn0.LygvP39bGalyj_lWYBe92YOQTDUWO-d0gOChSsP8NK8",
    # Token 2: clbsachvahanhdong
    "JWT eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJJZCI6MjMyMywiQXBwQ2xpZW50SWQiOjAsIlVzZXJOYW1lIjoiY2xic2FjaHZhaGFuaGRvbmciLCJGdWxsTmFtZSI6IkPDonUgTOG6oWMgQuG7mSBTw6FjaCBWw6AgSMOgbmggxJDhu5luZyIsIkNvZGUiOiI0QXBiM3NzMWZUcGIxK3lxNm5QM0hRPT0iLCJFeHBpcmVkRGF0ZSI6IjAwMDEtMDEtMDFUMDA6MDA6MDAifQ.CPS8MWHn2-nWtbO2y5tY3doWflnm924epUMPsuGQVNQ"
]

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0"
]

PROXIES = {
    "http": "http://116.107.59.182:16249",
    "https": "http://116.107.59.182:16249"
}

def get_headers(token_idx):
    token = TOKENS[token_idx % len(TOKENS)]
    return {
        "accept": "application/json, text/plain, */*",
        "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "authorization": token,
        "content-type": "application/json",
        "namespace": "Main",
        "origin": "https://cms.svnet.vn",
        "priority": "u=1, i",
        "referer": "https://cms.svnet.vn/",
        "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "user-agent": random.choice(USER_AGENTS)
    }

def query_single_code(session, ma_sv, token_idx, max_retries=3):
    payload = {
        "m": "festival",
        "fn": "list_member",
        "keyword": ma_sv.strip(),
        "pageIndex": 1,
        "pageSize": 20,
        "id": "67980",
        "status": -1
    }

    for attempt in range(max_retries):
        try:
            # Ngẫu nhiên delay 0.3s - 0.5s giả lập thao tác người thật
            time.sleep(random.uniform(0.3, 0.5))
            
            headers = get_headers(token_idx)
            response = session.post(API_URL, headers=headers, json=payload, proxies=PROXIES, timeout=10)
            
            if response.status_code == 200:
                res_json = response.json()
                if res_json.get("success") and res_json.get("data") and len(res_json["data"]) > 0:
                    member = res_json["data"][0]
                    return {
                        "ma_sv": ma_sv.strip(),
                        "fullName": member.get("fullName", ""),
                        "point": member.get("point", 0),
                        "mobile": member.get("mobile", ""),
                        "email": member.get("email", ""),
                        "account_used": f"Token #{token_idx % len(TOKENS) + 1}",
                        "status": "OK"
                    }
                else:
                    return {
                        "ma_sv": ma_sv.strip(),
                        "fullName": "",
                        "point": 0,
                        "mobile": "",
                        "email": "",
                        "account_used": f"Token #{token_idx % len(TOKENS) + 1}",
                        "status": "Not Found"
                    }
            elif response.status_code in [429, 403]:
                time.sleep(3 * (attempt + 1))
        except Exception:
            time.sleep(1)

    return {
        "ma_sv": ma_sv.strip(),
        "fullName": "",
        "point": 0,
        "mobile": "",
        "email": "",
        "account_used": "Error",
        "status": "Timeout"
    }

def run_200_crawler(input_path):
    if not os.path.exists(input_path):
        # Fallback search in Downloads if short filename given
        downloads_path = os.path.join(os.path.expanduser("~"), "Downloads", os.path.basename(input_path))
        if os.path.exists(downloads_path):
            input_path = downloads_path
        else:
            print(f"[X] Khong tim thay tep: {input_path}", flush=True)
            return

    with open(input_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    codes = [line.strip() for line in lines if line.strip() and not line.startswith("#")]
    total_codes = len(codes)
    
    print("=" * 70, flush=True)
    print("🕵️ CẤU HÌNH THÔNG MINH - XOAY VÒNG 2 TÀI KHOẢN (2 JWT TOKENS)", flush=True)
    print(f"[+] Input: {input_path}", flush=True)
    print(f"[+] Tong so ma SV: {total_codes}", flush=True)
    print(f"[+] Che do: 2 luong song song (2 TK: Btvdoan & clbsachvahanhdong)", flush=True)
    print(f"[+] Delay ngau nhien: 0.3s - 0.5s / request", flush=True)
    print(f"[+] Dot nghi: Nghi 2.0s sau moi 30 ma", flush=True)
    print("=" * 70, flush=True)

    start_time = time.time()
    results = {}
    completed = 0

    session = requests.Session()

    # Worker pool với 2 luồng tương ứng 2 JWT tokens
    with ThreadPoolExecutor(max_workers=2) as executor:
        future_map = {
            executor.submit(query_single_code, session, code, idx): (idx, code)
            for idx, code in enumerate(codes)
        }
        for future in as_completed(future_map):
            idx, code = future_map[future]
            res = future.result()
            results[idx] = res
            completed += 1

            percent = (completed / total_codes) * 100
            print(f"[{completed}/{total_codes}] ({percent:.1f}%) {res['ma_sv']} -> Diem: {res['point']} ({res['fullName']}) [{res['account_used']}]", flush=True)

            if completed % 30 == 0:
                time.sleep(2.0)

    ordered_results = [results[k] for k in range(total_codes)]

    # 1. Xuat file TXT chi chua Diem
    txt_path = r"C:\Users\hien1\Downloads\diem_only_200.txt"
    points_only = [str(r["point"]) for r in ordered_results]
    txt_content = "\n".join(points_only)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt_content)

    # 2. Xuat file CSV day du
    csv_path = r"C:\Users\hien1\Downloads\ket_qua_200.csv"
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["ma_sv", "fullName", "point", "mobile", "email", "account_used", "status"])
        writer.writeheader()
        writer.writerows(ordered_results)

    # 3. Copy vao Clipboard
    try:
        cmd = f"Set-Clipboard -Value @'\n{txt_content}\n'@"
        subprocess.run(["powershell", "-Command", cmd], capture_output=True)
        print("[+] Da copy toan bo 200 diem vao Clipboard!", flush=True)
    except Exception:
        pass

    total_time = time.time() - start_time
    print("=" * 70, flush=True)
    print(f"✅ HOAN THANH XONG {total_codes} MA TRONG {total_time:.1f} GIAY!", flush=True)
    print(f"[📄] File TXT diem: {txt_path}", flush=True)
    print(f"[📊] File CSV:     {csv_path}", flush=True)
    print("=" * 70, flush=True)

if __name__ == "__main__":
    file_arg = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\hien1\Downloads\Ma_SV_2002_den_2200.txt"
    run_200_crawler(file_arg)
