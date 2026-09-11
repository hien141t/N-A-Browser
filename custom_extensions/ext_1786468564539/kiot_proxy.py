import time
import requests

class KiotProxyManager:
    """Quản lý tự động lấy và xoay IP Proxy từ KiotProxy API"""
    
    def __init__(self, key="K38c1182224c34d6c9aed8032397ca2d8"):
        self.key = key
        self.current_ip = None
        self.current_http = None
        self.location = None
        self.next_change_at = 0
        self.update_current_proxy()

    def update_current_proxy(self):
        """Lấy thông tin proxy hiện tại từ API KiotProxy"""
        url = f"https://api.kiotproxy.com/api/v1/proxies/current?key={self.key}"
        try:
            res = requests.get(url, timeout=8)
            if res.status_code == 200:
                data = res.json()
                if data.get("success") and data.get("data"):
                    info = data["data"]
                    self.current_ip = info.get("realIpAddress")
                    self.current_http = info.get("http")
                    self.location = info.get("location", "Việt Nam")
                    ttc = info.get("ttc", 0)
                    self.next_change_at = time.time() + ttc
                    return True
        except Exception as e:
            print(f"[!] Lỗi kết nối API KiotProxy current: {e}")
        return False

    def change_proxy(self, region="random"):
        """Đổi IP Proxy mới (nếu đã đến thời gian ttc <= 0)"""
        url = f"https://api.kiotproxy.com/api/v1/proxies/new?key={self.key}&region={region}"
        try:
            res = requests.get(url, timeout=8)
            if res.status_code == 200:
                data = res.json()
                if data.get("success") and data.get("data"):
                    info = data["data"]
                    self.current_ip = info.get("realIpAddress")
                    self.current_http = info.get("http")
                    self.location = info.get("location", "Việt Nam")
                    ttc = info.get("ttc", 0)
                    self.next_change_at = time.time() + ttc
                    print(f"🔄 [KiotProxy] Đã đổi IP mới: {self.current_http} ({self.location})", flush=True)
                    return True
                else:
                    msg = data.get("message", "")
                    print(f"⚠️ [KiotProxy] Chưa đổi được IP: {msg}", flush=True)
        except Exception as e:
            print(f"[!] Lỗi kết nối API KiotProxy new: {e}")
        
        # Nếu chưa đổi được thì giữ proxy hiện tại
        return self.update_current_proxy()

    def get_dict(self):
        """Trả về dict proxy chuẩn cho requests"""
        if not self.current_http:
            self.update_current_proxy()
        
        if self.current_http:
            proxy_url = f"http://{self.current_http}"
            return {"http": proxy_url, "https": proxy_url}
        return None

    def auto_rotate_if_ready(self):
        """Tự động xoay IP nếu đã hết thời gian chờ (ttc <= 0)"""
        if time.time() >= self.next_change_at:
            return self.change_proxy()
        return False

if __name__ == "__main__":
    kp = KiotProxyManager()
    print("Proxy hien tai:", kp.get_dict())
    print("Location:", kp.location)
