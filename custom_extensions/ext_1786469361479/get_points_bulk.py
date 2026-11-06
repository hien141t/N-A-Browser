import os
import sys
import csv
import time
import subprocess
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

API_URL = "https://api.svnet.vn/"

HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "authorization": os.environ.get("SVNET_JWT_TOKEN", ""),
    "companyid": "",
    "content-type": "application/json",
    "namespace": "Main",
    "origin": "https://cms.svnet.vn",
    "priority": "u=1, i",
    "referer": "https://cms.svnet.vn/",
    "sec-ch-ua": '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
}

PROXIES = {
    "http": "http://116.107.59.182:16249",
    "https": "http://116.107.59.182:16249"
}

def query_svnet_point(ma_sv, max_retries=3):
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
            response = requests.post(API_URL, headers=HEADERS, json=payload, proxies=PROXIES, timeout=12)
            if response.status_code == 200:
                res_json = response.json()
                if res_json.get("success") and res_json.get("data") and len(res_json["data"]) > 0:
                    member_info = res_json["data"][0]
                    return {
                        "ma_sv": ma_sv.strip(),
                        "fullName": member_info.get("fullName", ""),
                        "point": member_info.get("point", 0),
                        "mobile": member_info.get("mobile", ""),
                        "email": member_info.get("email", ""),
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
        except Exception:
            time.sleep(0.3)

    return {
        "ma_sv": ma_sv.strip(),
        "fullName": "",
        "point": 0,
        "mobile": "",
        "email": "",
        "status": "Timeout"
    }

def process_bulk(input_path):
    if not os.path.exists(input_path):
        print(f"[X] Error: File not found at {input_path}", flush=True)
        return

    print(f"[+] Reading input file: {input_path}", flush=True)
    with open(input_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    codes = [line.strip() for line in lines if line.strip() and not line.startswith("#")]
    total_codes = len(codes)
    print(f"[+] Total student codes to query: {total_codes}", flush=True)
    print(f"[+] Using Proxy: {PROXIES['http']}", flush=True)

    start_time = time.time()
    results = {}
    completed = 0

    with ThreadPoolExecutor(max_workers=30) as executor:
        future_to_code = {executor.submit(query_svnet_point, code): (idx, code) for idx, code in enumerate(codes)}
        for future in as_completed(future_to_code):
            idx, code = future_to_code[future]
            res = future.result()
            results[idx] = res
            completed += 1
            if completed % 100 == 0 or completed == total_codes:
                elapsed = time.time() - start_time
                rate = completed / elapsed if elapsed > 0 else 0
                print(f"Progress: [{completed}/{total_codes}] ({completed/total_codes*100:.1f}%) - Speed: {rate:.1f} req/s", flush=True)

    ordered_results = [results[i] for i in range(total_codes)]

    # 1. Save TXT (ONLY POINTS, 1 line per point)
    txt_output_path = r"C:\Users\hien1\Downloads\diem_only_6623.txt"
    points_only = [str(r["point"]) for r in ordered_results]
    txt_content = "\n".join(points_only)

    with open(txt_output_path, "w", encoding="utf-8") as f:
        f.write(txt_content)

    # 2. Save CSV (Full details)
    csv_output_path = r"C:\Users\hien1\Downloads\ket_qua_full_6623.csv"
    with open(csv_output_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["ma_sv", "fullName", "point", "mobile", "email", "status"])
        writer.writeheader()
        writer.writerows(ordered_results)

    # 3. Copy points directly to Windows Clipboard
    try:
        cmd = f"Set-Clipboard -Value @'\n{txt_content}\n'@"
        subprocess.run(["powershell", "-Command", cmd], capture_output=True)
        print("[+] Points copied to Windows Clipboard!", flush=True)
    except Exception:
        pass

    elapsed_total = time.time() - start_time
    print(f"\n[OK] COMPLETED {total_codes} STUDENT CODES IN {elapsed_total:.1f} SECONDS!", flush=True)
    print(f"[📄] Points only file: {txt_output_path}", flush=True)
    print(f"[📊] Full CSV file:    {csv_output_path}", flush=True)

if __name__ == "__main__":
    file_path = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\hien1\Downloads\Ma_SV_1_den_6623.txt"
    process_bulk(file_path)
