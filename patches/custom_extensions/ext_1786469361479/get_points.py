import os
import sys
import json
import csv
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

# Set UTF-8 encoding for stdout on Windows
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

def query_svnet_point(ma_sv):
    payload = {
        "m": "festival",
        "fn": "list_member",
        "keyword": ma_sv.strip(),
        "pageIndex": 1,
        "pageSize": 20,
        "id": "67980",
        "status": -1
    }
    
    try:
        response = requests.post(API_URL, headers=HEADERS, json=payload, timeout=10)
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
                    "isAttend": member_info.get("isAttend", False),
                    "status": "Thanh cong"
                }
            else:
                return {
                    "ma_sv": ma_sv.strip(),
                    "fullName": "",
                    "point": 0,
                    "mobile": "",
                    "email": "",
                    "isAttend": False,
                    "status": "Khong tim thay"
                }
    except Exception as e:
        return {
            "ma_sv": ma_sv.strip(),
            "fullName": "",
            "point": 0,
            "mobile": "",
            "email": "",
            "isAttend": False,
            "status": f"Loi API: {str(e)}"
        }

def find_file(filename):
    if os.path.exists(filename):
        return filename

    downloads_path = os.path.join(os.path.expanduser("~"), "Downloads", filename)
    if os.path.exists(downloads_path):
        return downloads_path

    quyet_path = os.path.join("E:\\quyet", filename)
    if os.path.exists(quyet_path):
        return quyet_path

    i9_path = os.path.join("E:\\i9", filename)
    if os.path.exists(i9_path):
        return i9_path

    return None

def process_file(input_filename, output_csv_path=None):
    real_path = find_file(input_filename)
    if not real_path:
        print(f"[X] Loi: Khong tim thay file '{input_filename}'")
        return

    print(f"[+] Dang doc file tu: {real_path}")

    if not output_csv_path:
        out_dir = os.path.dirname(real_path) or "."
        output_csv_path = os.path.join(out_dir, "ket_qua_diem_svnet.csv")

    with open(real_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    codes = [line.strip() for line in lines if line.strip() and not line.startswith("#")]
    print(f"[+] Bat dau tra cuu diem SVNet cho {len(codes)} ma sinh vien...")

    results = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        future_to_code = {executor.submit(query_svnet_point, code): code for code in codes}
        completed = 0
        for future in as_completed(future_to_code):
            res = future.result()
            results.append(res)
            completed += 1
            print(f"[{completed}/{len(codes)}] {res['ma_sv']} -> Diem: {res['point']} ({res['fullName']})")

    code_order = {code: i for i, code in enumerate(codes)}
    results.sort(key=lambda x: code_order.get(x["ma_sv"], 999999))

    with open(output_csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["ma_sv", "fullName", "point", "mobile", "email", "isAttend", "status"])
        writer.writeheader()
        writer.writerows(results)

    print(f"\n[OK] Da hoan thanh! Ket qua duoc luu tai:\n{os.path.abspath(output_csv_path)}")
    return results

if __name__ == "__main__":
    input_file = sys.argv[1] if len(sys.argv) > 1 else "Ma_SV_1801_den_2000.txt"
    process_file(input_file)
