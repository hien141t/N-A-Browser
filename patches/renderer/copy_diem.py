import sys
import csv
import subprocess

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

csv_path = r"C:\Users\hien1\Downloads\ket_qua_diem_svnet.csv"
txt_path = r"C:\Users\hien1\Downloads\diem_only.txt"

with open(csv_path, "r", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    points = [row["point"] for row in reader]

txt_content = "\n".join(points)

# Ghi ra file TXT
with open(txt_path, "w", encoding="utf-8") as f:
    f.write(txt_content)

# Set clipboard trong Windows PowerShell
cmd = f"Set-Clipboard -Value @'\n{txt_content}\n'@"
subprocess.run(["powershell", "-Command", cmd], capture_output=True)

print(f"[OK] Da trich xuat {len(points)} dong diem!")
print(f"[+] File TXT: {txt_path}")
print("[+] Da copy san toan bo cot diem vao Clipboard! Ban chi can sang Excel va bam Ctrl+V.")
