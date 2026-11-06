import os
import sys
import csv
import time
import random
import subprocess
import requests

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

API_URL = "https://api.svnet.vn/"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0"
]

JWT_TOKEN = os.environ.get("SVNET_JWT_TOKEN", "")

PROXIES = {
    "http": "http://116.107.59.182:16249",
    "https": "http://116.107.59.182:16249"
}

def get_headers():
    return {
        "accept": "application/json, text/plain, */*",
        "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "authorization": JWT_TOKEN,
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

def query_single_code(session, ma_sv, delay=0.5, max_retries=4):
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
            time.sleep(delay)
            
            headers = get_headers()
            response = session.post(API_URL, headers=headers, json=payload, proxies=PROXIES, timeout=12)
            
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
                        "status": "OK"
                    }
                else:
                    return {
                        "ma_sv": ma_sv.strip(),
                        "fullName": "",
                        "point": 0,
                        "mobile": "",
                        "email": "",
                        "status": "Not Found"
                    }
            elif response.status_code in [429, 403]:
                print(f"[!] Canh bao rate limit HTTP {response.status_code}. Tu dong nghi {5 * (attempt + 1)}s...", flush=True)
                time.sleep(5 * (attempt + 1))
        except Exception:
            time.sleep(1)

    return {
        "ma_sv": ma_sv.strip(),
        "fullName": "",
        "point": 0,
        "mobile": "",
        "email": "",
        "status": "Timeout"
    }

def run_single_jwt_crawler(input_path, delay_per_req=0.5, batch_size=50, rest_seconds=2.0):
    if not os.path.exists(input_path):
        print(f"[X] Khong tim thay tep: {input_path}", flush=True)
        return

    with open(input_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    codes = [line.strip() for line in lines if line.strip() and not line.startswith("#")]
    total_codes = len(codes)
    
    print("=" * 65, flush=True)
    print("🛡️ STEALTH MODE (1 LUONG DUY NHAT CHO 1 JWT TOKEN)", flush=True)
    print(f"[+] Tong so ma SV: {total_codes}", flush=True)
    print(f"[+] Che do: 1 luong tuan tu (0.5s/ma - 50 ma/dot - Nghii 2.0s)", flush=True)
    print(f"[+] Du kien thoi gian: ~59.5 phut (gần 1 tiếng)", flush=True)
    print("=" * 65, flush=True)

    start_time = time.time()
    results = []
    session = requests.Session()

    for idx, code in enumerate(codes, 1):
        res = query_single_code(session, code, delay=delay_per_req)
        results.append(res)

        # Nghỉ 2.0s sau mỗi 50 mã
        if idx % batch_size == 0 and idx < total_codes:
            elapsed = time.time() - start_time
            percent = (idx / total_codes) * 100
            print(f"Progress: [{idx}/{total_codes}] ({percent:.1f}%) -> Temporary rest {rest_seconds}s...", flush=True)
            time.sleep(rest_seconds)
        elif idx % 10 == 0:
            print(f"[{idx}/{total_codes}] {res['ma_sv']} -> Diem: {res['point']} ({res['fullName']})", flush=True)

    # 1. Xuat file TXT chi chua Diem
    txt_path = r"C:\Users\hien1\Downloads\diem_only_6623.txt"
    points_only = [str(r["point"]) for r in results]
    txt_content = "\n".join(points_only)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt_content)

    # 2. Xuat file CSV day du
    csv_path = r"C:\Users\hien1\Downloads\ket_qua_full_6623.csv"
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["ma_sv", "fullName", "point", "mobile", "email", "status"])
        writer.writeheader()
        writer.writerows(results)

    # 3. Copy vao Clipboard
    try:
        cmd = f"Set-Clipboard -Value @'\n{txt_content}\n'@"
        subprocess.run(["powershell", "-Command", cmd], capture_output=True)
        print("[+] Da copy toan bo 6,623 diem vao Clipboard!", flush=True)
    except Exception:
        pass

    total_time = time.time() - start_time
    minutes = total_time / 60
    print(f"\n[OK] HOAN THANH CHUAN XAC {total_codes} MA TRONG {minutes:.1f} PHUT!", flush=True)
    print(f"[📄] File TXT diem: {txt_path}", flush=True)
    print(f"[📊] File CSV:     {csv_path}", flush=True)

if __name__ == "__main__":
    file_arg = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\hien1\Downloads\Ma_SV_1_den_6623.txt"
    run_single_jwt_crawler(file_arg)
