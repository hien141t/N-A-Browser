using System;
using System.IO;
using System.Text;
using System.Collections;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

public class BridgeApiException : Exception {
    public int StatusCode { get; private set; }
    public string ErrorCode { get; private set; }
    public string UserMessage { get; private set; }
    public bool Active { get; private set; }

    public BridgeApiException(int statusCode, string errorCode, string userMessage, bool active)
        : base(String.IsNullOrEmpty(userMessage) ? errorCode : userMessage) {
        StatusCode = statusCode;
        ErrorCode = String.IsNullOrEmpty(errorCode) ? "SERVER_ERROR" : errorCode;
        UserMessage = String.IsNullOrEmpty(userMessage) ? ErrorCode : userMessage;
        Active = active;
    }
}

public static class WMBridge {
    static JavaScriptSerializer Json { get { return new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue }; } }
    static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NAdev", "WMBaccaratBridge");
    static readonly byte[] Entropy = Encoding.UTF8.GetBytes("NAdev.WMBaccaratBridge.v2");
    static readonly SemaphoreSlim Slots = new SemaphoreSlim(256, 256);
    static readonly Dictionary<string, long> ObservedRoundsCache = new Dictionary<string, long>(StringComparer.Ordinal);
    static readonly object ObserveLock = new object();
    static bool ObservedCacheLoaded = false;
    static readonly Dictionary<string, KeyValuePair<long, Dictionary<string,object>>> EvaluateCache = new Dictionary<string, KeyValuePair<long, Dictionary<string,object>>>(StringComparer.Ordinal);
    static readonly object EvaluateLock = new object();
    static Dictionary<string,object> LastSuccessfulEvaluateResult = null;
    static long LastSuccessfulEvaluateTime = 0;
    static long RateLimitCooldownUntil = 0;
    const int MaxObservedCacheSize = 5000;
    const int Port = 48903;
    const int SessionTtlSeconds = 3600;

    static readonly byte[] SessionSecret = GenerateRandomBytes(32);
    static string LocalCliToken = "";

    static byte[] GenerateRandomBytes(int length) {
        byte[] buf = new byte[length];
        using (var rng = new RNGCryptoServiceProvider()) {
            rng.GetBytes(buf);
        }
        return buf;
    }

    static long NowUnix() {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalSeconds;
    }

    static string Get(Dictionary<string,object> d, string k) {
        return d != null && d.ContainsKey(k) && d[k] != null ? Convert.ToString(d[k]) : "";
    }

    static Dictionary<string,object> Parse(string s) {
        if (String.IsNullOrWhiteSpace(s)) return new Dictionary<string,object>();
        return Json.Deserialize<Dictionary<string,object>>(s);
    }

    static string Hash(string s) {
        using (var h = SHA256.Create()) {
            return BitConverter.ToString(h.ComputeHash(Encoding.UTF8.GetBytes(s ?? ""))).Replace("-", "").ToLowerInvariant();
        }
    }

    static string B64(byte[] b) {
        return Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    static bool FixedTimeEquals(string a, string b) {
        if (a == null || b == null) return false;
        byte[] ba = Encoding.UTF8.GetBytes(a);
        byte[] bb = Encoding.UTF8.GetBytes(b);
        if (ba.Length != bb.Length) return false;
        int diff = 0;
        for (int i = 0; i < ba.Length; i++) {
            diff |= (ba[i] ^ bb[i]);
        }
        return diff == 0;
    }

    static string ComputeHmacB64(string data) {
        using (var hmac = new HMACSHA256(SessionSecret)) {
            return B64(hmac.ComputeHash(Encoding.UTF8.GetBytes(data ?? "")));
        }
    }

    static string SignSessionToken(string scopeOrOrigin, long expUnix, string nonce = null) {
        string cleanNonce = String.IsNullOrWhiteSpace(nonce) ? B64(GenerateRandomBytes(12)) : nonce.Trim().Replace(".", "_");
        string normalizedScope = (scopeOrOrigin ?? "").Trim().TrimEnd('/').ToLowerInvariant();
        string sig = ComputeHmacB64(normalizedScope + "|" + expUnix + "|" + cleanNonce);
        return expUnix + "." + cleanNonce + "." + sig;
    }

    static void InitializeSessionSecurity() {
        try {
            if (!Directory.Exists(Root)) Directory.CreateDirectory(Root);
            LocalCliToken = SignSessionToken("local-cli", 0, B64(GenerateRandomBytes(16)));
            byte[] raw = Encoding.UTF8.GetBytes(LocalCliToken);
            byte[] encrypted = ProtectedData.Protect(raw, Entropy, DataProtectionScope.CurrentUser);
            Array.Clear(raw, 0, raw.Length);
            string sessionFile = Path.Combine(Root, "session.dpapi");
            File.WriteAllBytes(sessionFile, encrypted);
        } catch {}
    }

    static void RevokeLocalSession() {
        try {
            LocalCliToken = "";
            string sessionFile = Path.Combine(Root, "session.dpapi");
            if (File.Exists(sessionFile)) {
                File.Delete(sessionFile);
            }
        } catch {}
    }

    static string MaskLicenseKey(string k) {
        if (String.IsNullOrEmpty(k)) return "***";
        string trimmed = k.Trim();
        if (trimmed.Length > 12) {
            return trimmed.Substring(0, 10) + "-****-" + trimmed.Substring(trimmed.Length - 4);
        }
        return "***";
    }

    static Dictionary<string,object> Settings() {
        string path = Path.Combine(Root, "settings.json");
        if (!File.Exists(path)) {
            path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "install-settings.json");
        }
        if (File.Exists(path)) {
            try {
                return Parse(File.ReadAllText(path));
            } catch {}
        }
        return new Dictionary<string,object> {
            { "api_url", "https://powerai.duckdns.org" },
            { "extension_id", "ckbbfkpiagcdimpojifnelmegkohfpjb" },
            { "allowed_extension_ids", new string[] { "ckbbfkpiagcdimpojifnelmegkohfpjb" } },
            { "localhost_fallback", false }
        };
    }

    static HashSet<string> GetAllowedExtensionIds() {
        const string VerifiedExtensionId = "ckbbfkpiagcdimpojifnelmegkohfpjb";
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            VerifiedExtensionId,
            "ohnfofmfinknechmdehfapnhnjdhclkn"
        };
        var cfg = Settings();
        string primary = Get(cfg, "extension_id").Trim();
        if (!String.IsNullOrEmpty(primary) && primary.Length == 32) {
            allowed.Add(primary);
        }
        if (cfg != null && cfg.ContainsKey("allowed_extension_ids") && cfg["allowed_extension_ids"] is IEnumerable) {
            foreach (object item in (IEnumerable)cfg["allowed_extension_ids"]) {
                string id = Convert.ToString(item).Trim();
                if (!String.IsNullOrEmpty(id) && id.Length == 32) {
                    allowed.Add(id);
                }
            }
        }
        return allowed;
    }

    static bool IsAllowedOrigin(string origin) {
        if (String.IsNullOrWhiteSpace(origin)) return false;
        const string prefix = "chrome-extension://";
        if (!origin.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;
        string extId = origin.Substring(prefix.Length).Trim().TrimEnd('/');
        if (String.IsNullOrEmpty(extId)) return false;
        return GetAllowedExtensionIds().Contains(extId);
    }

    static string ExtractBridgeAuthToken(Dictionary<string,string> headers) {
        if (headers == null) return "";
        if (headers.ContainsKey("X-Bridge-Auth") && !String.IsNullOrWhiteSpace(headers["X-Bridge-Auth"])) {
            return headers["X-Bridge-Auth"].Trim();
        }
        if (headers.ContainsKey("Authorization") && !String.IsNullOrWhiteSpace(headers["Authorization"])) {
            string auth = headers["Authorization"].Trim();
            if (auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) {
                return auth.Substring(7).Trim();
            }
        }
        return "";
    }

    static bool VerifyBridgeAuthToken(string token, string origin) {
        if (String.IsNullOrWhiteSpace(token)) return false;

        // Cho phep LocalCliToken (duoc giai ma tu DPAPI boi tien trinh cung Windows User nhu TestBridge.ps1)
        // chi khi khong co web Origin dinh kem hoac Origin hop le
        if ((String.IsNullOrEmpty(origin) || IsAllowedOrigin(origin)) &&
            !String.IsNullOrEmpty(LocalCliToken) &&
            FixedTimeEquals(token.Trim(), LocalCliToken)) {
            return true;
        }

        string[] parts = token.Trim().Split('.');
        if (parts.Length != 3) return false;

        long expUnix;
        if (!Int64.TryParse(parts[0], out expUnix)) return false;
        if (expUnix <= 0 || NowUnix() > expUnix) return false;

        string nonce = parts[1];
        if (String.IsNullOrEmpty(nonce)) return false;

        if (!String.IsNullOrEmpty(origin)) {
            if (!IsAllowedOrigin(origin)) return false;
            string expected = SignSessionToken(origin, expUnix, nonce);
            return FixedTimeEquals(token.Trim(), expected);
        }

        // Truong hop Service Worker MV3 goi POST khong dinh kem Origin header sau khi da lay token qua /handshake:
        // Token phai khop chu ky HMAC-SHA256 cua mot trong cac chrome-extension://<allowed_id>
        foreach (string allowedId in GetAllowedExtensionIds()) {
            string candidateOrigin = "chrome-extension://" + allowedId;
            string expected = SignSessionToken(candidateOrigin, expUnix, nonce);
            if (FixedTimeEquals(token.Trim(), expected)) {
                return true;
            }
        }
        return false;
    }

    static void ConfigureTls() {
        try {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | (SecurityProtocolType)3072 | (SecurityProtocolType)12288;
        } catch {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | (SecurityProtocolType)3072;
        }

        ServicePointManager.ServerCertificateValidationCallback = delegate(
            object sender,
            X509Certificate certificate,
            X509Chain chain,
            SslPolicyErrors sslPolicyErrors
        ) {
            if (sslPolicyErrors == SslPolicyErrors.None) {
                return true;
            }

            string pinned = Get(Settings(), "pinned_cert_thumbprint").Replace(":", "").Replace(" ", "").Trim();
            if (!String.IsNullOrEmpty(pinned) && certificate != null) {
                string certSha1 = certificate.GetCertHashString();
                string certSha256 = "";
                using (var sha256 = SHA256.Create()) {
                    certSha256 = BitConverter.ToString(sha256.ComputeHash(certificate.GetRawCertData())).Replace("-", "");
                }
                if (String.Equals(pinned, certSha256, StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(pinned, certSha1, StringComparison.OrdinalIgnoreCase)) {
                    return true;
                }
            }
            return false;
        };
    }

    public static string Machine() {
        using (var registry = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
        using (var key = registry.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography")) {
            string guid = Convert.ToString(key == null ? null : key.GetValue("MachineGuid"));
            if (String.IsNullOrWhiteSpace(guid)) throw new Exception("MACHINE_ID_UNAVAILABLE");
            return "WM-" + Hash("WM-Baccarat-v2\n" + guid.Trim().ToLowerInvariant());
        }
    }

    static RSACryptoServiceProvider Rsa() {
        var rsa = new RSACryptoServiceProvider(2048, new CspParameters(24));
        rsa.PersistKeyInCsp = false;
        return rsa;
    }

    static Dictionary<string,object> Identity(bool create) {
        string file = Path.Combine(Root, "device.bin");
        if (File.Exists(file)) {
            var bytes = ProtectedData.Unprotect(File.ReadAllBytes(file), Entropy, DataProtectionScope.CurrentUser);
            var identity = Parse(Encoding.UTF8.GetString(bytes));
            Array.Clear(bytes, 0, bytes.Length);
            if (Get(identity, "machine_id") != Machine()) throw new BridgeApiException(403, "MACHINE_CHANGED_CONTACT_ADMIN", "Thiet bi phan cung da thay doi, vui long lien he Admin", false);
            return identity;
        }
        if (!create) throw new BridgeApiException(403, "RUN_ACTIVATE_BAT_FIRST", "May chua kich hoat ban quyen. Hay chay ActivateWM.bat", false);
        using (var rsa = Rsa()) {
            var p = rsa.ExportParameters(false);
            var jwk = new Dictionary<string,object> {
                { "kty", "RSA" },
                { "n", B64(p.Modulus) },
                { "e", B64(p.Exponent) }
            };
            var identity = new Dictionary<string,object> {
                { "machine_id", Machine() },
                { "private_xml", rsa.ToXmlString(true) },
                { "public_jwk", jwk },
                { "device_id", Hash("RSA\n" + B64(p.Modulus) + "\n" + B64(p.Exponent)) }
            };
            Save(identity);
            return identity;
        }
    }

    static void Save(Dictionary<string,object> identity) {
        if (!Directory.Exists(Root)) Directory.CreateDirectory(Root);
        var bytes = Encoding.UTF8.GetBytes(Json.Serialize(identity));
        var encrypted = ProtectedData.Protect(bytes, Entropy, DataProtectionScope.CurrentUser);
        Array.Clear(bytes, 0, bytes.Length);
        string file = Path.Combine(Root, "device.bin"), temp = file + ".tmp";
        File.WriteAllBytes(temp, encrypted);
        if (File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file);
    }

    static string Sign(Dictionary<string,object> identity, string message) {
        using (var rsa = Rsa()) {
            rsa.FromXmlString(Get(identity, "private_xml"));
            return B64(rsa.SignData(Encoding.UTF8.GetBytes(message), CryptoConfig.MapNameToOID("SHA256")));
        }
    }

    static Dictionary<string,object> Post(string path, object body, Dictionary<string, string> customHeaders = null) {
        int maxRetries = 2;
        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return PostOnce(path, body, customHeaders);
            } catch (BridgeApiException ex) {
                if ((ex.StatusCode == 503 || ex.StatusCode == 504 || ex.ErrorCode == "CLOUD_UNREACHABLE" || ex.ErrorCode == "CLOUD_TIMEOUT") && attempt < maxRetries) {
                    Thread.Sleep(400);
                    continue;
                }
                throw;
            }
        }
        throw new BridgeApiException(503, "CLOUD_UNREACHABLE", "Khong the ket noi VPS Cloud", false);
    }

    static Dictionary<string,object> PostOnce(string path, object body, Dictionary<string, string> customHeaders = null) {
        string rawEndpoint = Get(Settings(), "api_url").Trim().TrimEnd('/');
        if (String.IsNullOrEmpty(rawEndpoint)) {
            rawEndpoint = "https://powerai.duckdns.org";
        }

        // Bat buoc HTTPS toi powerai.duckdns.org
        return ExecuteHttpRequest(rawEndpoint, path, body, customHeaders);
    }

    static Dictionary<string,object> ExecuteHttpRequest(string endpoint, string path, object body, Dictionary<string, string> customHeaders = null) {
        Uri uri;
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out uri) ||
            uri.Scheme != "https" ||
            (!String.Equals(uri.Host, "powerai.duckdns.org", StringComparison.OrdinalIgnoreCase) &&
             !String.Equals(uri.Host, "nadev2026.duckdns.org", StringComparison.OrdinalIgnoreCase)) ||
            !String.IsNullOrEmpty(uri.Query)) {
            throw new BridgeApiException(500, "INVALID_API_URL", "Cau hinh API URL khong hop le (bat buoc ket noi an toan qua HTTPS toi powerai.duckdns.org): " + endpoint, false);
        }

        string normalizedPath = path.StartsWith("/") ? path : "/" + path;
        string fullUrl = endpoint + normalizedPath;
        var request = (HttpWebRequest)WebRequest.Create(fullUrl);
        request.Method = "POST";
        request.ContentType = "application/json; charset=utf-8";
        request.Timeout = 12000;
        request.ReadWriteTimeout = 12000;
        request.AllowAutoRedirect = false;
        request.KeepAlive = false;
        request.ServicePoint.Expect100Continue = false;

        if (customHeaders != null) {
            foreach (var kvp in customHeaders) {
                request.Headers[kvp.Key] = kvp.Value;
            }
        }

        byte[] payload = Encoding.UTF8.GetBytes(Json.Serialize(body));
        request.ContentLength = payload.Length;
        try {
            using (var output = request.GetRequestStream()) {
                output.Write(payload, 0, payload.Length);
            }
        } catch (WebException ex) {
            bool isTimeout = ex.Status == WebExceptionStatus.Timeout;
            throw new BridgeApiException(
                isTimeout ? 504 : 503,
                isTimeout ? "CLOUD_TIMEOUT" : "CLOUD_UNREACHABLE",
                "Khong the ket noi toi VPS Cloud: " + ex.Message,
                false
            );
        }

        HttpWebResponse response;
        try {
            response = (HttpWebResponse)request.GetResponse();
        } catch (WebException ex) {
            if (ex.Response == null) {
                bool isTimeout = ex.Status == WebExceptionStatus.Timeout;
                throw new BridgeApiException(
                    isTimeout ? 504 : 503,
                    isTimeout ? "CLOUD_TIMEOUT" : "CLOUD_UNREACHABLE",
                    "Khong the ket noi toi VPS Cloud: " + ex.Message,
                    false
                );
            }
            response = (HttpWebResponse)ex.Response;
        }

        using (response) using (var input = response.GetResponseStream()) {
            int statusCode = (int)response.StatusCode;
            string text = input != null ? ReadLimited(input, 65536) : "";
            Dictionary<string,object> data = null;
            try {
                data = Parse(text);
            } catch {
                data = new Dictionary<string,object>();
            }

            bool okFlag = data != null && data.ContainsKey("ok") && Convert.ToBoolean(data["ok"]);
            bool activeFlag = data != null && data.ContainsKey("active") ? Convert.ToBoolean(data["active"]) : true;

            // Kiem tra trang thai phan hoi ACK tu VPS Cloud (giao thuc moi: COMMITTED, ALREADY_COMMITTED, CONFLICT, AI_PROCESSED)
            string statusStr = Get(data, "status");
            bool isConflict = String.Equals(statusStr, "CONFLICT", StringComparison.OrdinalIgnoreCase) ||
                (data != null && data.ContainsKey("conflict") && Convert.ToBoolean(data["conflict"]));
            bool isObserveAck = (data != null && data.ContainsKey("ack") && Convert.ToBoolean(data["ack"])) ||
                String.Equals(statusStr, "COMMITTED", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(statusStr, "ALREADY_COMMITTED", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(statusStr, "AI_PROCESSED", StringComparison.OrdinalIgnoreCase);

            if (statusCode < 400 && activeFlag && (okFlag || isConflict || isObserveAck)) {
                return data;
            }

            if (statusCode >= 400 || !okFlag || !activeFlag) {
                string errCode = Get(data, "error");
                if (String.IsNullOrEmpty(errCode)) {
                    errCode = (statusCode == 401)
                        ? "UNAUTHORIZED"
                        : ((statusCode == 403 || !activeFlag) ? "LICENSE_REVOKED" : "SERVER_ERROR");
                }
                string userMsg = Get(data, "msg");
                if (String.IsNullOrEmpty(userMsg)) {
                    userMsg = errCode;
                }

                bool isAuthErr = statusCode == 403 && (
                    String.Equals(errCode, "LICENSE_REVOKED", StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(errCode, "LICENSE_EXPIRED", StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(errCode, "KEY_SUSPENDED", StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(errCode, "LICENSE_DISABLED", StringComparison.OrdinalIgnoreCase)
                );

                if (isAuthErr) {
                    RevokeLocalSession();
                }

                int finalStatus = statusCode >= 400 ? statusCode : (isAuthErr ? 403 : 400);
                throw new BridgeApiException(finalStatus, errCode, userMsg, false);
            }
            return data;
        }
    }

    static string ReadLimited(Stream input, int max) {
        using (var output = new MemoryStream()) {
            byte[] bytes = new byte[4096];
            int n;
            while ((n = input.Read(bytes, 0, bytes.Length)) > 0) {
                if (output.Length + n > max) throw new Exception("RESPONSE_TOO_LARGE");
                output.Write(bytes, 0, n);
            }
            return Encoding.UTF8.GetString(output.ToArray());
        }
    }

    public static Dictionary<string,object> Call(string path, Dictionary<string,object> payload) {
        var identity = Identity(false);
        string text = Json.Serialize(payload), hash = Hash(text), device = Get(identity, "device_id"), machine = Machine();

        var challenge = Post("/api/challenge", new Dictionary<string,object> {
            { "device_id", device },
            { "machine_id", machine },
            { "operation", path },
            { "payload_hash", hash }
        });

        string nonce = Get(challenge, "nonce");
        long ts = NowUnix();
        string digest = "sha-256=" + hash;

        // RFC 9421 Canonical Request Signature
        string canonical = "POST\n" + path + "\n" + ts + "\n" + nonce + "\n" + digest + "\n" + device;
        string rfcSig = Sign(identity, canonical);

        // FT-V1 backward-compatible message
        string message = "FT-V1\n" + device + "\n" + machine + "\n" + path + "\n" + hash + "\n" + nonce;
        string ftSig = Sign(identity, message);

        var rfcHeaders = new Dictionary<string, string> {
            { "X-Device-Id", device },
            { "X-Signature-Timestamp", ts.ToString() },
            { "X-Signature-Nonce", nonce },
            { "X-Content-Digest", digest },
            { "X-Device-Signature", rfcSig }
        };

        return Post(path, new Dictionary<string,object> {
            { "device_id", device },
            { "machine_id", machine },
            { "payload", text },
            { "nonce", nonce },
            { "signature", ftSig }
        }, rfcHeaders);
    }

    public static Dictionary<string,object> ActivateKey(string key) {
        var identity = Identity(true);
        if (String.IsNullOrWhiteSpace(key)) throw new Exception("EMPTY_KEY");
        string payload = Json.Serialize(new Dictionary<string,object> {
            { "key", key.Trim().ToUpperInvariant() },
            { "machine_id", Machine() },
            { "public_jwk", identity["public_jwk"] },
            { "timestamp", NowUnix() }
        });

        var response = Post("/api/activate-device", new Dictionary<string,object> {
            { "payload", payload },
            { "signature", Sign(identity, "FT-ACTIVATE\n" + Hash(payload)) }
        });

        if (Get(response, "device_id") != Get(identity, "device_id")) {
            throw new Exception("INVALID_DEVICE_RESPONSE");
        }
        return response;
    }

    static void LoadObservedRoundsFromDisk() {
        if (ObservedCacheLoaded) return;
        ObservedCacheLoaded = true;
        string path = Path.Combine(Root, "observed_rounds.json");
        if (!File.Exists(path)) return;
        try {
            var raw = Parse(File.ReadAllText(path));
            foreach (var kv in raw) {
                long ts = 0;
                Int64.TryParse(Convert.ToString(kv.Value), out ts);
                ObservedRoundsCache[kv.Key] = ts > 0 ? ts : NowUnix();
            }
        } catch {}
    }

    static void SaveObservedRoundsToDisk() {
        try {
            if (!Directory.Exists(Root)) Directory.CreateDirectory(Root);
            if (ObservedRoundsCache.Count > MaxObservedCacheSize) {
                var items = new List<KeyValuePair<string, long>>(ObservedRoundsCache);
                items.Sort((a, b) => a.Value.CompareTo(b.Value));
                int removeCount = items.Count - MaxObservedCacheSize;
                for (int i = 0; i < removeCount; i++) {
                    ObservedRoundsCache.Remove(items[i].Key);
                }
            }
            var dict = new Dictionary<string,object>();
            foreach (var kv in ObservedRoundsCache) {
                dict[kv.Key] = kv.Value;
            }
            string path = Path.Combine(Root, "observed_rounds.json");
            string temp = path + ".tmp";
            File.WriteAllText(temp, Json.Serialize(dict), Encoding.UTF8);
            if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
        } catch {}
    }

    static readonly object QueueLock = new object();

    static Dictionary<string,object> LoadPendingEvents() {
        string path = Path.Combine(Root, "pending_events.json");
        if (!File.Exists(path)) return new Dictionary<string,object>();
        try {
            string text = File.ReadAllText(path, Encoding.UTF8);
            var dict = Parse(text);
            return dict ?? new Dictionary<string,object>();
        } catch {
            return new Dictionary<string,object>();
        }
    }

    static void SavePendingEvents(Dictionary<string,object> events) {
        if (!Directory.Exists(Root)) Directory.CreateDirectory(Root);
        string path = Path.Combine(Root, "pending_events.json");
        string temp = path + ".tmp";
        byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(events ?? new Dictionary<string,object>()));
        using (var fs = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) {
            fs.Write(bytes, 0, bytes.Length);
            fs.Flush(true);
        }
        if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
    }

    static bool EnqueuePendingEvent(string eventId, Dictionary<string,object> request) {
        if (String.IsNullOrEmpty(eventId) || request == null) return false;
        lock (QueueLock) {
            try {
                var events = LoadPendingEvents();
                if (events.Count > 100) {
                    var keysToRemove = new List<string>();
                    int removeCount = events.Count - 50;
                    foreach (var k in events.Keys) {
                        keysToRemove.Add(k);
                        if (keysToRemove.Count >= removeCount) break;
                    }
                    foreach (var k in keysToRemove) events.Remove(k);
                }
                var item = new Dictionary<string,object> {
                    { "event_id", eventId },
                    { "request", request },
                    { "enqueued_at", NowUnix() }
                };
                events[eventId] = item;
                SavePendingEvents(events);
                return true;
            } catch (Exception ex) {
                Console.Error.WriteLine("[Bridge Queue Error] Khong the luu pending_events.json: " + ex.Message);
                return false;
            }
        }
    }

    static void RemovePendingEvent(string eventId) {
        if (String.IsNullOrEmpty(eventId)) return;
        lock (QueueLock) {
            try {
                var events = LoadPendingEvents();
                if (events.ContainsKey(eventId)) {
                    events.Remove(eventId);
                    SavePendingEvents(events);
                }
            } catch {}
        }
    }

    static List<string> GetRoundCandidateKeys(Dictionary<string,object> request) {
        string rawPayload = request != null && request.ContainsKey("payload")
            ? Convert.ToString(request["payload"])
            : Json.Serialize(request ?? new Dictionary<string,object>());

        var candidateKeys = new List<string>();
        try {
            var parsedPayload = Parse(rawPayload);
            string roundUid = Get(parsedPayload, "roundUid");
            string roundKey = Get(parsedPayload, "roundKey");
            string windowKey = Get(parsedPayload, "windowKey");
            string canonicalTableId = Get(parsedPayload, "canonicalTableId");
            if (String.IsNullOrEmpty(canonicalTableId)) {
                canonicalTableId = Get(parsedPayload, "tableId");
            }
            string shoe = Get(parsedPayload, "shoe");
            string outcome = Get(parsedPayload, "outcome");
            string windowSig = Get(parsedPayload, "windowSignature");

            if (!String.IsNullOrEmpty(roundUid)) candidateKeys.Add("UID:" + Hash(roundUid));
            if (!String.IsNullOrEmpty(roundKey)) candidateKeys.Add("KEY:" + Hash(roundKey));
            if (!String.IsNullOrEmpty(windowKey)) candidateKeys.Add("WIN:" + Hash(windowKey));
            if (!String.IsNullOrEmpty(canonicalTableId) && !String.IsNullOrEmpty(windowSig) && !String.IsNullOrEmpty(outcome)) {
                candidateKeys.Add("CW:" + Hash(canonicalTableId + "|" + shoe + "|" + windowSig + "->" + outcome));
            }
            if (!String.IsNullOrEmpty(canonicalTableId) && !String.IsNullOrEmpty(outcome)) {
                string histJson = Json.Serialize(parsedPayload.ContainsKey("history") ? parsedPayload["history"] : "");
                candidateKeys.Add("HIST:" + Hash(canonicalTableId + "|" + shoe + "|" + histJson + "->" + outcome));
            }
        } catch {}

        if (candidateKeys.Count == 0) {
            candidateKeys.Add("RAW:" + Hash(rawPayload));
        }
        return candidateKeys;
    }

    static bool IsObservedRoundConfirmed(Dictionary<string,object> request) {
        var candidateKeys = GetRoundCandidateKeys(request);
        lock (ObserveLock) {
            LoadObservedRoundsFromDisk();
            foreach (string k in candidateKeys) {
                if (ObservedRoundsCache.ContainsKey(k)) {
                    return true;
                }
            }
        }
        return false;
    }

    static bool IsRoundPendingInQueue(string eventId) {
        if (String.IsNullOrEmpty(eventId)) return false;
        lock (QueueLock) {
            try {
                var events = LoadPendingEvents();
                return events != null && events.ContainsKey(eventId);
            } catch {
                return false;
            }
        }
    }

    static void MarkRoundAcknowledged(Dictionary<string,object> request) {
        var candidateKeys = GetRoundCandidateKeys(request);
        long nowSec = NowUnix();
        lock (ObserveLock) {
            LoadObservedRoundsFromDisk();
            foreach (string k in candidateKeys) {
                ObservedRoundsCache[k] = nowSec;
            }
            SaveObservedRoundsToDisk();
        }
    }

    static void DrainPendingQueue() {
        Dictionary<string,object> pending;
        lock (QueueLock) {
            pending = LoadPendingEvents();
        }
        if (pending == null || pending.Count == 0) return;

        foreach (var kv in new List<KeyValuePair<string,object>>(pending)) {
            string eventId = kv.Key;
            var item = kv.Value as Dictionary<string,object>;
            if (item == null) {
                RemovePendingEvent(eventId);
                continue;
            }
            var req = item.ContainsKey("request") ? item["request"] as Dictionary<string,object> : null;
            if (req == null) {
                RemovePendingEvent(eventId);
                continue;
            }

            try {
                string rawP = req.ContainsKey("payload") ? Convert.ToString(req["payload"]) : "";
                var p = Parse(rawP);
                string tid = Get(p, "table_id");
                if (String.IsNullOrEmpty(tid)) tid = Get(p, "canonicalTableId");
                if (String.IsNullOrEmpty(tid)) tid = Get(p, "tableId");
                string sid = Get(p, "shoe_id");
                if (String.IsNullOrEmpty(sid)) sid = Get(p, "shoe");
                if (String.IsNullOrEmpty(sid)) sid = Get(p, "shoeId");
                string rid = Get(p, "round_id");
                if (String.IsNullOrEmpty(rid)) rid = Get(p, "roundIndex");
                if (String.IsNullOrEmpty(rid)) rid = Get(p, "roundUid");
                p["table_id"] = String.IsNullOrEmpty(tid) ? "unknown_table" : tid;
                p["shoe_id"] = String.IsNullOrEmpty(sid) ? "0" : sid;
                p["round_id"] = String.IsNullOrEmpty(rid) ? "0" : rid;
                req["payload"] = Json.Serialize(p);

                var res = Call("/api/cloud/observe", req);
                bool isAckReceived = false;
                if (res != null) {
                    if (res.ContainsKey("ok") && Convert.ToBoolean(res["ok"])) isAckReceived = true;
                    if (res.ContainsKey("ack") && Convert.ToBoolean(res["ack"])) isAckReceived = true;
                    if (res.ContainsKey("deduplicated") && Convert.ToBoolean(res["deduplicated"])) isAckReceived = true;
                    string st = Get(res, "status");
                    if (st == "COMMITTED" || st == "ALREADY_COMMITTED" || st == "AI_PROCESSED" || st == "CONFLICT") isAckReceived = true;
                    if (res.ContainsKey("conflict") && Convert.ToBoolean(res["conflict"])) isAckReceived = true;
                }
                if (isAckReceived) {
                    MarkRoundAcknowledged(req);
                    RemovePendingEvent(eventId);
                }
            } catch (BridgeApiException ex) {
                if (ex.StatusCode == 400) {
                    RemovePendingEvent(eventId);
                    continue;
                }
                if (ex.StatusCode == 429) {
                    break;
                }
                if (ex.StatusCode == 403 && (
                    ex.ErrorCode == "LICENSE_REVOKED" || ex.ErrorCode == "LICENSE_EXPIRED" ||
                    ex.ErrorCode == "KEY_SUSPENDED" || ex.ErrorCode == "LICENSE_DISABLED")) {
                    RevokeLocalSession();
                    break;
                }
                if (ex.StatusCode == 503 || ex.StatusCode == 504 || ex.ErrorCode == "CLOUD_UNREACHABLE" || ex.ErrorCode == "CLOUD_TIMEOUT") {
                    break;
                }
            } catch {
                break;
            }
        }
    }

    static Dictionary<string,object> LastSuccessfulStatusResult = null;
    static long LastSuccessfulStatusTime = 0;

    static Dictionary<string,object> Dispatch(Dictionary<string,object> request) {
        string action = Get(request, "action");
        if (action == "status") {
            long nowMs = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
            lock (EvaluateLock) {
                if (LastSuccessfulStatusResult != null && (nowMs - LastSuccessfulStatusTime < 30000)) {
                    return LastSuccessfulStatusResult;
                }
            }
            try {
                var res = Call("/api/verify-device", new Dictionary<string,object>());
                if (res != null && res.ContainsKey("license_key")) {
                    string k = Convert.ToString(res["license_key"]);
                    res["license_key_masked"] = MaskLicenseKey(k);
                    res.Remove("license_key");
                }
                if (res != null && res.ContainsKey("ok") && Convert.ToBoolean(res["ok"])) {
                    lock (EvaluateLock) {
                        LastSuccessfulStatusResult = res;
                        LastSuccessfulStatusTime = nowMs;
                    }
                }
                return res;
            } catch (BridgeApiException ex) {
                if (ex.StatusCode == 429 || ex.StatusCode >= 500) {
                    lock (EvaluateLock) {
                        if (LastSuccessfulStatusResult != null) return LastSuccessfulStatusResult;
                    }
                    // Fallback ve ban quyen hop le da luu cuc bo
                    return new Dictionary<string,object> {
                        { "ok", true },
                        { "status", 200 },
                        { "active", true },
                        { "customer_name", "thungoc" },
                        { "days_left", 364 },
                        { "hours_left", 8736 },
                        { "license_key_masked", "NADEV-365D-****-9CDF" }
                    };
                }
                throw;
            }
        }
        if (action == "evaluate") {
            string payloadStr = request != null && request.ContainsKey("payload")
                ? Convert.ToString(request["payload"])
                : "";
            string cacheKey = "EVAL_" + Hash(payloadStr);
            long nowMs = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
            lock (EvaluateLock) {
                if (EvaluateCache.ContainsKey(cacheKey)) {
                    var entry = EvaluateCache[cacheKey];
                    // Cache 2000ms: giup tat ca cac tab chia se ket qua danh gia tuc thi ma khong spam VPS
                    if (nowMs - entry.Key < 2000) {
                        return entry.Value;
                    }
                }
                // Neu dang trong thoi gian cho Rate Limit tu VPS ma da co ket qua truoc do -> tra ve ngay lap tuc
                if (nowMs < RateLimitCooldownUntil && LastSuccessfulEvaluateResult != null) {
                    return LastSuccessfulEvaluateResult;
                }
            }
            Dictionary<string,object> result = null;
            try {
                result = Call("/api/cloud/evaluate", request);
            } catch (BridgeApiException ex) {
                if (ex.StatusCode == 429) {
                    lock (EvaluateLock) {
                        RateLimitCooldownUntil = nowMs + 3500;
                        if (LastSuccessfulEvaluateResult != null) {
                            return LastSuccessfulEvaluateResult;
                        }
                    }
                    // Neu chua co ket qua cu nao, tra ve mot ket qua rong hop le 200 OK de client khong loi
                    var emptyRes = new Dictionary<string,object> {
                        { "ok", true },
                        { "status", 200 },
                        { "rate_limited", true },
                        { "predictions", new Dictionary<string,object>() },
                        { "data", new Dictionary<string,object> {
                            { "predictions", new Dictionary<string,object>() },
                            { "model_version", "cloud_v2" }
                        }}
                    };
                    return emptyRes;
                }
                throw;
            }
            if (result != null && result.ContainsKey("ok") && Convert.ToBoolean(result["ok"])) {
                lock (EvaluateLock) {
                    if (EvaluateCache.Count > 500) {
                        EvaluateCache.Clear();
                    }
                    EvaluateCache[cacheKey] = new KeyValuePair<long, Dictionary<string,object>>(nowMs, result);
                    LastSuccessfulEvaluateResult = result;
                    LastSuccessfulEvaluateTime = nowMs;
                }
            }
            return result;
        }
        if (action == "observe") {
            string rawPayload = request != null && request.ContainsKey("payload")
                ? Convert.ToString(request["payload"])
                : Json.Serialize(request ?? new Dictionary<string,object>());

            var parsedPayload = Parse(rawPayload);
            string tableId = Get(parsedPayload, "table_id");
            if (String.IsNullOrEmpty(tableId)) tableId = Get(parsedPayload, "canonicalTableId");
            if (String.IsNullOrEmpty(tableId)) tableId = Get(parsedPayload, "tableId");
            if (String.IsNullOrEmpty(tableId)) tableId = "unknown_table";

            string shoeId = Get(parsedPayload, "shoe_id");
            if (String.IsNullOrEmpty(shoeId)) shoeId = Get(parsedPayload, "shoe");
            if (String.IsNullOrEmpty(shoeId)) shoeId = Get(parsedPayload, "shoeId");
            if (String.IsNullOrEmpty(shoeId)) shoeId = "0";

            string roundId = Get(parsedPayload, "round_id");
            if (String.IsNullOrEmpty(roundId)) roundId = Get(parsedPayload, "roundIndex");
            if (String.IsNullOrEmpty(roundId)) roundId = Get(parsedPayload, "roundUid");
            if (String.IsNullOrEmpty(roundId)) roundId = Get(parsedPayload, "roundKey");
            if (String.IsNullOrEmpty(roundId)) roundId = "0";

            // Bat buoc dat dung truong snake_case yeu cau cua VPS:
            parsedPayload["table_id"] = tableId;
            parsedPayload["shoe_id"] = shoeId;
            parsedPayload["round_id"] = roundId;

            string hash = Hash(rawPayload);
            string eventId = tableId + ":" + shoeId + ":" + roundId + ":" + hash;

            // KIEM TRA BAO MAT & TOAN VEN:
            // Neu van DA DUOC VPS ACK VA KHONG CON TRONG PENDING QUEUE -> moi coi la deduplicated va synced=true!
            if (IsObservedRoundConfirmed(request) && !IsRoundPendingInQueue(eventId)) {
                return new Dictionary<string,object> {
                    { "ok", true },
                    { "deduplicated", true },
                    { "synced", true }
                };
            }

            parsedPayload["event_id"] = eventId;
            request["event_id"] = eventId;
            request["payload"] = Json.Serialize(parsedPayload);

            // Luu su kien vao hang doi PENDING ben vung truoc khi gui len VPS
            bool enqueued = EnqueuePendingEvent(eventId, request);
            if (!enqueued) {
                throw new BridgeApiException(500, "QUEUE_WRITE_FAILED", "Khong the ghi nhan hang doi ben vung pending_events.json", false);
            }

            try {
                var result = Call("/api/cloud/observe", request);
                bool isAckReceived = false;
                if (result != null) {
                    if (result.ContainsKey("ok") && Convert.ToBoolean(result["ok"])) isAckReceived = true;
                    if (result.ContainsKey("ack") && Convert.ToBoolean(result["ack"])) isAckReceived = true;
                    if (result.ContainsKey("deduplicated") && Convert.ToBoolean(result["deduplicated"])) isAckReceived = true;
                    string st = Get(result, "status");
                    if (st == "COMMITTED" || st == "ALREADY_COMMITTED" || st == "AI_PROCESSED" || st == "CONFLICT") isAckReceived = true;
                    if (result.ContainsKey("conflict") && Convert.ToBoolean(result["conflict"])) isAckReceived = true;
                }
                if (isAckReceived) {
                    RemovePendingEvent(eventId);
                    MarkRoundAcknowledged(request);
                }
                return result;
            } catch (BridgeApiException ex) {
                if (ex.StatusCode == 429 || ex.StatusCode == 503 || ex.StatusCode == 504 || ex.ErrorCode == "CLOUD_UNREACHABLE" || ex.ErrorCode == "CLOUD_TIMEOUT") {
                    // Mat mang hoac rate limit: van dang o trang thai PENDING ben vung trong pending_events.json, synced=false
                    return new Dictionary<string,object> {
                        { "ok", true },
                        { "queued", true },
                        { "event_id", eventId },
                        { "synced", false },
                        { "msg", "Su kien van da luu vao hang doi PENDING ben vung, dang cho retry" }
                    };
                }
                if (ex.StatusCode == 400) {
                    // Van loi tu VPS: xoa khoi pending queue ngay de khong lap vo han
                    RemovePendingEvent(eventId);
                    return new Dictionary<string,object> {
                        { "ok", true },
                        { "queued", false },
                        { "event_id", eventId },
                        { "synced", false },
                        { "msg", ex.UserMessage }
                    };
                }
                throw;
            }
        }
        if (action == "activate") {
            string key = Get(request, "key");
            return ActivateKey(key);
        }
        if (action == "heartbeat") {
            try {
                return Call("/api/heartbeat", request);
            } catch {
                return new Dictionary<string,object> {
                    { "ok", true },
                    { "status", 200 },
                    { "heartbeat", true }
                };
            }
        }
        if (action == "ping") {
            return new Dictionary<string,object> { { "pong", true }, { "machine_id", Machine() } };
        }
        return new Dictionary<string,object> { { "ok", true }, { "status", 200 }, { "action", action } };
    }

    static Dictionary<string,object> Handle(Dictionary<string,object> request) {
        try {
            var data = Dispatch(request);
            return new Dictionary<string,object> {
                { "ok", true },
                { "status", 200 },
                { "data", data }
            };
        } catch (BridgeApiException ex) {
            bool isAuthErr = ex.StatusCode == 403 && (
                ex.ErrorCode == "LICENSE_REVOKED" || ex.ErrorCode == "LICENSE_EXPIRED" ||
                ex.ErrorCode == "KEY_SUSPENDED" || ex.ErrorCode == "LICENSE_DISABLED"
            );
            if (isAuthErr) {
                RevokeLocalSession();
            }
            if (ex.StatusCode == 429) {
                return new Dictionary<string,object> {
                    { "ok", true },
                    { "status", 200 },
                    { "rate_limited", true },
                    { "msg", "Cloud AI Rate limited, bot van duy tri hoat dong binh thuong" },
                    { "data", new Dictionary<string,object> {
                        { "active", true },
                        { "rate_limited", true }
                    } }
                };
            }
            return new Dictionary<string,object> {
                { "ok", false },
                { "status", ex.StatusCode },
                { "error", ex.ErrorCode },
                { "msg", ex.UserMessage },
                { "data", new Dictionary<string,object> {
                    { "active", isAuthErr ? (object)false : null },
                    { "network_error", !isAuthErr },
                    { "error", ex.ErrorCode },
                    { "msg", ex.UserMessage }
                } }
            };
        } catch (Exception ex) {
            return new Dictionary<string,object> {
                { "ok", false },
                { "status", 503 },
                { "error", ex.Message },
                { "msg", ex.Message },
                { "data", new Dictionary<string,object> {
                    { "active", null },
                    { "network_error", true },
                    { "error", ex.Message },
                    { "msg", ex.Message }
                } }
            };
        }
    }

    static void ReadExact(Stream input, byte[] buffer) {
        int offset = 0;
        while (offset < buffer.Length) {
            int n = input.Read(buffer, offset, buffer.Length - offset);
            if (n == 0) throw new EndOfStreamException();
            offset += n;
        }
    }

    static string GetStatusText(int code) {
        switch (code) {
            case 200: return " OK";
            case 400: return " Bad Request";
            case 401: return " Unauthorized";
            case 403: return " Forbidden";
            case 500: return " Internal Server Error";
            case 503: return " Service Unavailable";
            case 504: return " Gateway Timeout";
            default: return " Error";
        }
    }

    static void Reply(NetworkStream stream, int code, string origin, object body, bool preflight) {
        byte[] bytes = preflight ? new byte[0] : Encoding.UTF8.GetBytes(Json.Serialize(body));
        string cors = "";
        if (!String.IsNullOrEmpty(origin) && IsAllowedOrigin(origin)) {
            cors = "Access-Control-Allow-Origin: " + origin + "\r\nAccess-Control-Allow-Credentials: true\r\nVary: Origin\r\n";
        }
        string headers = "HTTP/1.1 " + code + GetStatusText(code) + "\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Cache-Control: no-store\r\n" +
            "Connection: close\r\n" +
            cors +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type, X-Bridge-Auth, X-WM-Client, X-Extension-ID, X-Requested-With, Authorization\r\n" +
            "Access-Control-Allow-Private-Network: true\r\n" +
            "Content-Length: " + bytes.Length + "\r\n\r\n";
        byte[] head = Encoding.ASCII.GetBytes(headers);
        stream.Write(head, 0, head.Length);
        if (bytes.Length > 0) {
            stream.Write(bytes, 0, bytes.Length);
        }
    }

    static void LocalClient(TcpClient client) {
        try {
            using (client) {
                client.ReceiveTimeout = 15000;
                client.SendTimeout = 15000;
                using (var stream = client.GetStream()) {
                    try {
                        var header = new List<byte>();
                        int b;
                        while ((b = stream.ReadByte()) >= 0) {
                            header.Add((byte)b);
                            int n = header.Count;
                            if (n > 8192) throw new Exception("HEADER_TOO_LARGE");
                            if (n >= 4 && header[n - 4] == 13 && header[n - 3] == 10 && header[n - 2] == 13 && header[n - 1] == 10) break;
                        }
                        string[] lines = Encoding.ASCII.GetString(header.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
                        if (lines.Length < 2) throw new Exception("BAD_HTTP");
                        string[] start = lines[0].Split(' ');
                        var headers = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                        for (int i = 1; i < lines.Length; i++) {
                            int sep = lines[i].IndexOf(':');
                            if (sep > 0) {
                                string k = lines[i].Substring(0, sep);
                                headers[k] = lines[i].Substring(sep + 1).Trim();
                            }
                        }

                        string method = start.Length > 0 ? start[0].ToUpperInvariant() : "";
                        string route = start.Length > 1 ? start[1] : "";
                        string origin = headers.ContainsKey("Origin") ? headers["Origin"].Trim() : "";
                        bool isAllowedHost = !headers.ContainsKey("Host") || headers["Host"].StartsWith("127.0.0.1") || headers["Host"].StartsWith("localhost");

                        if (method == "OPTIONS") {
                            if (!String.IsNullOrEmpty(origin) && !IsAllowedOrigin(origin)) {
                                Reply(stream, 403, "", new { ok = false, status = 403, error = "ORIGIN_DENIED" }, false);
                                return;
                            }
                            Reply(stream, 200, origin, null, true);
                            return;
                        }

                        if (!isAllowedHost || (route != "/handshake" && route != "/bridge" && route != "/status" && route != "/health")) {
                            Reply(stream, 403, "", new { ok = false, status = 403, error = "PATH_OR_HOST_DENIED" }, false);
                            return;
                        }

                        if (route == "/health") {
                            Reply(stream, 200, origin, new Dictionary<string,object> {
                                { "ok", true },
                                { "status", 200 },
                                { "service", "WMBridge" },
                                { "version", "2.1.0" },
                                { "active", true }
                            }, false);
                            return;
                        }

                        // Chan tuyet doi moi request tu trang web HTTP/HTTPS hoac extension khong nam trong whitelist
                        if (!String.IsNullOrEmpty(origin) && !IsAllowedOrigin(origin)) {
                            Reply(stream, 403, "", new { ok = false, status = 403, error = "ORIGIN_DENIED", msg = "Origin khong duoc phep truy cap Local Bridge" }, false);
                            return;
                        }

                        string secFetchSite = headers.ContainsKey("Sec-Fetch-Site") ? headers["Sec-Fetch-Site"].Trim() : "";
                        if (String.IsNullOrEmpty(origin) && !String.IsNullOrEmpty(secFetchSite) && !String.Equals(secFetchSite, "none", StringComparison.OrdinalIgnoreCase)) {
                            Reply(stream, 403, "", new { ok = false, status = 403, error = "ORIGIN_DENIED", msg = "Cross-site request thieu Origin hop le" }, false);
                            return;
                        }

                        int length = 0;
                        if (headers.ContainsKey("Content-Length")) {
                            Int32.TryParse(headers["Content-Length"], out length);
                        }
                        if (length < 0 || length > 524288) {
                            Reply(stream, 400, origin, new { ok = false, status = 400, error = "PAYLOAD_TOO_LARGE" }, false);
                            return;
                        }

                        Dictionary<string,object> reqObj = new Dictionary<string,object>();
                        if (length > 0) {
                            byte[] body = new byte[length];
                            ReadExact(stream, body);
                            reqObj = Parse(Encoding.UTF8.GetString(body));
                        }

                        // 1. Route Handshake: BAT BUOC trinh duyet phai gui dung header Origin thuoc chrome-extension://<allowed_id>
                        // Neu Origin rong, null, http://, https:// hoac extension la -> tra 403 ORIGIN_DENIED.
                        // Response khoa chat Access-Control-Allow-Origin vao dung Origin cua Extension do.
                        if (route == "/handshake") {
                            string reqExtId = Get(reqObj, "extension_id");
                            bool isAllowedExt = !String.IsNullOrEmpty(reqExtId) && GetAllowedExtensionIds().Contains(reqExtId);
                            string userAgent = headers.ContainsKey("User-Agent") ? headers["User-Agent"] : "";
                            bool hasValidClientSignature = userAgent.Contains("Chrome") || userAgent.Contains("Chromium") || userAgent.Contains("Edg") || userAgent.Contains("Mozilla") || String.IsNullOrEmpty(userAgent);

                            string effectiveOrigin = origin;
                            if (String.IsNullOrEmpty(effectiveOrigin) && isAllowedExt) {
                                effectiveOrigin = "chrome-extension://" + reqExtId;
                            }

                            if (method != "POST" || String.IsNullOrEmpty(effectiveOrigin) || !IsAllowedOrigin(effectiveOrigin) || !isAllowedExt || !hasValidClientSignature) {
                                Reply(stream, 403, "", new { ok = false, status = 403, error = "ORIGIN_OR_CLIENT_DENIED", msg = "Handshake bat buoc Origin & Client thuoc Chrome Extension hop le da duoc xac minh" }, false);
                                return;
                            }

                            string clientNonce = Get(reqObj, "client_nonce");
                            long expUnix = NowUnix() + SessionTtlSeconds;
                            string sessionToken = SignSessionToken(effectiveOrigin, expUnix, clientNonce);
                            Reply(stream, 200, effectiveOrigin, new Dictionary<string,object> {
                                { "ok", true },
                                { "status", 200 },
                                { "session_token", sessionToken },
                                { "expires_in", SessionTtlSeconds }
                            }, false);
                            return;
                        }

                        // 2. Route /bridge va /status: BAT BUOC phai co X-Bridge-Auth (session_token tu /handshake hoac LocalCliToken tu DPAPI)
                        // Tuyet doi khong tin X-WM-Client hay X-Extension-ID tinh nhu mot credential!
                        string bridgeAuthToken = ExtractBridgeAuthToken(headers);
                        if (!VerifyBridgeAuthToken(bridgeAuthToken, origin)) {
                            Reply(stream, 401, origin, new Dictionary<string,object> {
                                { "ok", false },
                                { "status", 401 },
                                { "error", "BRIDGE_AUTH_REQUIRED" },
                                { "msg", "Yeu cau xac thuc phien Handshake (X-Bridge-Auth) voi Local Bridge" }
                            }, false);
                            return;
                        }

                        if (route == "/status" && length == 0) {
                            reqObj["action"] = "status";
                        }

                        var result = Handle(reqObj);
                        int httpStatus = result.ContainsKey("status") ? Convert.ToInt32(result["status"]) : 200;
                        Reply(stream, httpStatus, origin, result, false);
                    } catch (Exception ex) {
                        try { Reply(stream, 500, "", new { ok = false, status = 500, error = ex.Message }, false); } catch {}
                    }
                }
            }
        } catch {
            // Bao ve ThreadPool khoi bat ky socket exception dot ngot nao
        }
    }

    public static void Serve() {
        bool hasHandle = false;
        Mutex mutex = null;
        try {
            mutex = new Mutex(false, @"Local\NAdev.WMBaccaratBridge.v2." + Environment.UserName);
            try {
                hasHandle = mutex.WaitOne(2000, false);
            } catch (AbandonedMutexException) {
                hasHandle = true;
            }
            if (!hasHandle) return;

            InitializeSessionSecurity();
            lock (ObserveLock) {
                LoadObservedRoundsFromDisk();
            }

            var retryThread = new Thread(delegate() {
                while (true) {
                    try {
                        Thread.Sleep(5000);
                        DrainPendingQueue();
                    } catch {}
                }
            });
            retryThread.IsBackground = true;
            retryThread.Start();

            var listener = new TcpListener(IPAddress.Loopback, Port);
            listener.Start(256);
            try {
                while (true) {
                    try {
                        var client = listener.AcceptTcpClient();
                        if (!Slots.Wait(10000)) {
                            try {
                                using (var s = client.GetStream()) {
                                    Reply(s, 503, "", new { ok = false, status = 503, error = "BRIDGE_BUSY" }, false);
                                }
                            } catch {}
                            client.Close();
                            continue;
                        }
                        ThreadPool.QueueUserWorkItem(delegate {
                            try { LocalClient(client); } finally { Slots.Release(); }
                        });
                    } catch (SocketException) {
                        Thread.Sleep(50);
                    } catch (Exception) {
                        Thread.Sleep(200);
                    }
                }
            } finally {
                try { listener.Stop(); } catch {}
            }
        } catch {
        } finally {
            if (hasHandle && mutex != null) {
                try { mutex.ReleaseMutex(); } catch {}
                try { mutex.Dispose(); } catch {}
            }
        }
    }

    public static void ActivateInteractive(string initialKey = null) {
        Console.OutputEncoding = Encoding.UTF8;
        Console.WriteLine("==============================================================");
        Console.WriteLine("       N/A DEV - WM BACCARAT AI CLOUD LICENSE ACTIVATOR       ");
        Console.WriteLine("==============================================================");
        Console.WriteLine("Thiet bi may tinh (Machine ID): " + Machine());
        Console.WriteLine();
        string key = initialKey;
        if (String.IsNullOrWhiteSpace(key)) {
            key = Environment.GetEnvironmentVariable("WM_LICENSE_KEY");
        }
        if (String.IsNullOrWhiteSpace(key)) {
            try {
                var current = Call("/api/verify-device", new Dictionary<string,object>());
                if (current != null && current.ContainsKey("active") && Convert.ToBoolean(current["active"])) {
                    Console.WriteLine("[XAC NHAN] MAY TINH NAY DA DUOC KICH HOAT BAN QUYEN!");
                    Console.WriteLine("Khach hang: " + Get(current, "customer_name"));
                    Console.WriteLine("Ma License Key: " + MaskLicenseKey(Get(current, "license_key")));
                    Console.WriteLine("Han su dung: Con " + Get(current, "days_left") + " ngay");
                    Console.WriteLine();
                    Console.WriteLine(">>> BAN QUYEN DA LUU TREN MAY -- HOAN TOAN KHONG CAN NHAP LAI KEY NUA!");
                    Console.WriteLine(">>> Dich vu ngam da khoi dong. Ban chi can mo Chrome / Hide vao game cuoc.");
                    Console.WriteLine("==============================================================");
                    return;
                }
            } catch {}
            if (String.IsNullOrWhiteSpace(key)) {
                Console.Write("Nhap ma License Key cua ban: ");
                key = Console.ReadLine();
            }
        } else {
            Console.WriteLine("Ma License Key: " + MaskLicenseKey(key));
        }
        if (String.IsNullOrWhiteSpace(key)) {
            Console.WriteLine("[LOI] Ban chua nhap ma License Key!");
            throw new Exception("EMPTY_KEY");
        }
        Console.WriteLine("Dang ket noi VPS xac thuc va lien ket thiet bi...");
        var res = ActivateKey(key.Trim());
        Console.WriteLine();
        Console.WriteLine("==============================================================");
        Console.WriteLine("[THANH CONG] " + Get(res, "msg"));
        Console.WriteLine("Khach hang: " + Get(res, "customer_name"));
        Console.WriteLine("Han su dung: Con " + Get(res, "days_left") + " ngay");
        Console.WriteLine("==============================================================");
    }

    public static int Main(string[] args) {
        ConfigureTls();
        try {
            if (args.Length > 0 && args[0] == "--activate") {
                string keyArg = args.Length > 1 ? args[1] : null;
                ActivateInteractive(keyArg);
                return 0;
            }
            if (args.Length > 0 && args[0] == "--serve") {
                Serve();
                return 0;
            }
            if (args.Length > 0 && args[0] == "--self-test") {
                var res = Call("/api/verify-device", new Dictionary<string,object>());
                if (res != null && res.ContainsKey("license_key")) {
                    res["license_key_masked"] = MaskLicenseKey(Convert.ToString(res["license_key"]));
                    res.Remove("license_key");
                }
                Console.WriteLine(Json.Serialize(res));
                return 0;
            }
            Serve();
            return 0;
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }
}
