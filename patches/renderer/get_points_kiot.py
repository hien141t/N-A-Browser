import os
import sys
import csv
import time
import random
import subprocess
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from kiot_proxy import KiotProxyManager

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

API_URL = "https://api.svnet.vn/"

# 2 JWT Tokens từ 2 tài khoản khác nhau
TOKENS = [
    "JWT eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJJZCI6MjY5NCwiQXBwQ2xpZW50SWQiOjAsIlVzZXJOYW1lIjoiQnR2ZG9hbiIsIkZ1bGxOYW1lIjoiQmFuIFRoxrDhu51uZyBW4bulIMSQb8OgbiBUcsaw4budbmciLCJDb2RlIjoiZkkrajA4STdoK1VpS2ZMM2FoanhYUT09IiwiRXhwaXJlZERhdGUiOiIwMDAxLTAxLTAxVDAwOjAwOjAwIn0.LygvP39bGalyj_lWYBe92YOQTDUWO-d0gOChSsP8NK8",
    "JWT eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJJZCI6MjMyMywiQXBwQ2xpZW50SWQiOjAsIlVzZXJOYW1lIjoiY2xic2FjaHZhaGFuaGRvbmciLCJGdWxsTmFtZSI6IkPDonUgTOG6oWMgQuG7mSBTw6FjaCBWw6AgSMOgbmggxJDhu5luZyIsIkNvZGUiOiI0QXBiM3NzMWZUcGIxK3lxNm5QM0hRPT0iLCJFeHBpcmVkRGF0ZSI6IjAwMDEtMDEtMDFUMDA6MDA6MDAifQ.CPS8MWHn2-nWtbO2y5tY3doWflnm924epUMPsuGQVNQ"
]

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0"
]

# Khởi tạo KiotProxy Manager với key của bạn
proxy_mgr = KiotProxyManager(key="K38c1182224c34d6c9aed8032397ca2d8")

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
            time.sleep(random.uniform(0.3, 0.5))
            
            headers = get_headers(token_idx)
            current_proxies = proxy_mgr.get_dict()
            
            response = session.post(API_URL, headers=headers, json=payload, proxies=current_proxies, timeout=10)
            
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
                        "proxy_used": proxy_mgr.current_http,
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
                        "proxy_used": proxy_mgr.current_http,
                        "status": "Not Found"
                    }
            elif response.status_code in [429, 403]:
                # Nếu gặp rate limit, thử xoay IP Proxy KiotProxy
                proxy_mgr.change_proxy()
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
        "proxy_used": "Error",
        "status": "Timeout"
    }

def run_kiot_crawler(input_path):
    if not os.path.exists(input_path):
        downloads_path = os.path.join(os.path.expanduser("~"), "Downloads", os.path.basename(input_path))
        if os.path.exists(downloads_path):
            input_path = downloads_path
        else:
            print(f"[X] Không tìm thấy tệp: {input_path}", flush=True)
            return

    with open(input_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    codes = [line.strip() for line in lines if line.strip() and not line.startswith("#")]
    total_codes = len(codes)
    
    print("=" * 70, flush=True)
    print("🕵️ CHẾ ĐỘ THÔNG MINH: KIOTPROXY XOAY IP + 2 TÀI KHOẢN (2 JWT TOKENS)", flush=True)
    print(f"[+] Input File: {input_path}", flush=True)
    print(f"[+] Tổng số mã SV: {total_codes}", flush=True)
    print(f"[+] IP Proxy ban đầu: {proxy_mgr.current_http} ({proxy_mgr.location})", flush=True)
    print(f"[+] Chế độ: Xoay vòng 2 tài khoản (Btvdoan & clbsachvahanhdong)", flush=True)
    print(f"[+] Delay: 0.3s - 0.5s / request - Tự động xoay IP khi đủ thời gian", flush=True)
    print("=" * 70, flush=True)

    start_time = time.time()
    results = {}
    completed = 0

    session = requests.Session()

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
            print(f"[{completed}/{total_codes}] ({percent:.1f}%) {res['ma_sv']} -> Điểm: {res['point']} ({res['fullName']}) [{res['account_used']}] [IP: {res['proxy_used']}]", flush=True)

            # Tự động xoay IP Proxy KiotProxy nếu đến giờ (ttc <= 0)
            proxy_mgr.auto_rotate_if_ready()

            if completed % 30 == 0:
                time.sleep(2.0)

    ordered_results = [results[k] for k in range(total_codes)]

    # 1. Xuất file TXT chỉ chứa Điểm
    txt_path = r"C:\Users\hien1\Downloads\diem_only_200.txt"
    points_only = [str(r["point"]) for r in ordered_results]
    txt_content = "\n".join(points_only)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt_content)

    # 2. Xuất file CSV đầy đủ
    csv_path = r"C:\Users\hien1\Downloads\ket_qua_200.csv"
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["ma_sv", "fullName", "point", "mobile", "email", "account_used", "proxy_used", "status"])
        writer.writeheader()
        writer.writerows(ordered_results)

    # 3. Copy vào Clipboard
    try:
        cmd = f"Set-Clipboard -Value @'\n{txt_content}\n'@"
        subprocess.run(["powershell", "-Command", cmd], capture_output=True)
        print("📋 Đã copy toàn bộ điểm vào Clipboard!", flush=True)
    except Exception:
        pass

    total_time = time.time() - start_time
    print("=" * 70, flush=True)
    print(f"✅ HOÀN THÀNH XONG {total_codes} MÃ TRONG {total_time:.1f} GIÂY!", flush=True)
    print(f"📄 File TXT riêng điểm: {txt_path}", flush=True)
    print(f"📊 File CSV đầy đủ:    {csv_path}", flush=True)
    print("=" * 70, flush=True)

if __name__ == "__main__":
    file_arg = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\hien1\Downloads\Ma_SV_2002_den_2200.txt"
    run_kiot_crawler(file_arg)
