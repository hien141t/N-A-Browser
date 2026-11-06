// WM Auto Helper - Background Service Worker (Manifest V3)
// Đóng vai trò Network Proxy an toàn tới Local License Bridge (127.0.0.1:48903)
// Sử dụng cơ chế Handshake động (X-Bridge-Auth HMAC Session Token) — Không tin cậy header tĩnh.
// Toàn bộ Master Brain đã được chuyển 100% lên VPS Cloud — Không đọc/lưu não AI cục bộ.

console.log('[WM Background] Cloud Thin-Client Service Worker v2.1 đã khởi chạy');

const BRIDGE_BASE_URL = 'http://127.0.0.1:48903';
const BRIDGE_HANDSHAKE_ENDPOINT = `${BRIDGE_BASE_URL}/handshake`;
const BRIDGE_ENDPOINT = `${BRIDGE_BASE_URL}/bridge`;
const DEFAULT_EXTENSION_ID = 'ckbbfkpiagcdimpojifnelmegkohfpjb';
const ALLOWED_BRIDGE_ACTIONS = new Set(['status', 'evaluate', 'observe', 'ping', 'heartbeat', 'activate']);

let cachedSessionToken = null;
let cachedSessionExpiresAt = 0;
let handshakeInFlight = null;

function getExtensionId() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      return chrome.runtime.id;
    }
  } catch (e) {}
  return DEFAULT_EXTENSION_ID;
}

function generateClientNonce() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const arr = new Uint8Array(12);
      crypto.getRandomValues(arr);
      return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {}
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

async function ensureBridgeSessionToken(forceRefresh = false, timeoutMs = 8000) {
  const now = Date.now();
  if (!forceRefresh && cachedSessionToken && now < cachedSessionExpiresAt) {
    return cachedSessionToken;
  }

  if (forceRefresh) {
    cachedSessionToken = null;
    cachedSessionExpiresAt = 0;
  }

  if (handshakeInFlight) {
    return handshakeInFlight;
  }

  handshakeInFlight = (async () => {
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timerId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const resp = await fetch(BRIDGE_HANDSHAKE_ENDPOINT, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_nonce: generateClientNonce(),
          extension_id: getExtensionId()
        }),
        signal: controller ? controller.signal : undefined
      });

      if (timerId) clearTimeout(timerId);
      if (!resp.ok) {
        return null;
      }

      const data = await resp.json();
      if (data && data.ok && typeof data.session_token === 'string' && data.session_token.length > 10) {
        const ttlSec = (typeof data.expires_in === 'number' && data.expires_in > 120) ? data.expires_in : 3600;
        cachedSessionToken = data.session_token;
        cachedSessionExpiresAt = Date.now() + Math.max(60, ttlSec - 60) * 1000;
        return cachedSessionToken;
      }
      return null;
    } catch (e) {
      if (timerId) clearTimeout(timerId);
      return null;
    } finally {
      handshakeInFlight = null;
    }
  })();

  return handshakeInFlight;
}

async function executeSingleBridgeCall(action, rawPayload, effectiveTimeout, sessionToken) {
  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timerId = controller ? setTimeout(() => controller.abort(), effectiveTimeout) : null;

  try {
    const bodyObj = { action };
    if (rawPayload !== undefined && rawPayload !== null) {
      bodyObj.payload = (typeof rawPayload === 'string') ? rawPayload : JSON.stringify(rawPayload);
    }

    const headers = {
      'Content-Type': 'application/json'
    };
    if (sessionToken) {
      headers['X-Bridge-Auth'] = sessionToken;
    }

    const resp = await fetch(BRIDGE_ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      headers,
      body: JSON.stringify(bodyObj),
      signal: controller ? controller.signal : undefined
    });

    if (timerId) clearTimeout(timerId);

    let parsed = null;
    try {
      parsed = await resp.json();
    } catch (parseErr) {
      parsed = null;
    }

    const status = (parsed && typeof parsed.status === 'number')
      ? parsed.status
      : (resp.status || 200);

    const innerData = (parsed && parsed.data !== undefined) ? parsed.data : parsed;
    const isExplicitlyRevoked = Boolean(innerData && innerData.active === false);
    const isConflict = Boolean(
      (innerData && (innerData.status === 'CONFLICT' || innerData.conflict)) ||
      (parsed && (parsed.status === 'CONFLICT' || parsed.conflict))
    );
    const isAck = Boolean(
      (innerData && (innerData.ack || innerData.status === 'COMMITTED' || innerData.status === 'ALREADY_COMMITTED' || innerData.status === 'AI_PROCESSED')) ||
      (parsed && (parsed.ack || parsed.status === 'COMMITTED' || parsed.status === 'ALREADY_COMMITTED' || parsed.status === 'AI_PROCESSED'))
    );
    const ok = Boolean(resp.ok && status >= 200 && status < 400 && (parsed && parsed.ok !== false || isConflict || isAck) && !isExplicitlyRevoked);

    const errorCode = !ok
      ? String(
          (parsed && parsed.error) ||
          (innerData && innerData.error) ||
          (status === 401 ? 'BRIDGE_AUTH_REQUIRED' : (status === 403 || isExplicitlyRevoked ? 'LICENSE_REVOKED' : `HTTP_${status}`))
        )
      : '';

    const userMsg = String(
      (parsed && parsed.msg) ||
      (innerData && innerData.msg) ||
      errorCode ||
      ''
    );

    // Khi máy chủ VPS từ chối bản quyền (Khóa key hoặc hết hạn) -> lập tức phát lệnh thu hồi tới tất cả các tab
    if (isExplicitlyRevoked || (status === 403 && (errorCode.includes('LICENSE') || errorCode.includes('DISABLED') || errorCode.includes('REVOKED') || errorCode.includes('EXPIRED')))) {
      try {
        const revokedCache = { valid: false, error: userMsg || 'Bản quyền đã bị khóa từ máy chủ' };
        chrome.storage.local.set({ wm_license_cached: revokedCache });
        chrome.tabs.query({}, (tabs) => {
          if (!tabs) return;
          for (const t of tabs) {
            if (t && t.id) {
              chrome.tabs.sendMessage(t.id, { action: 'WM_LICENSE_UPDATED', license: revokedCache }, () => {
                if (chrome.runtime.lastError) {}
              });
            }
          }
        });
      } catch (e) {}
    }

    return {
      ok,
      status: (!ok && (isExplicitlyRevoked || errorCode.includes('LICENSE') || errorCode.includes('DISABLED') || errorCode.includes('REVOKED') || errorCode.includes('EXPIRED'))) ? 403 : status,
      data: innerData,
      error: errorCode,
      msg: userMsg
    };
  } catch (err) {
    if (timerId) clearTimeout(timerId);
    const isAbort = Boolean(err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('abort')));
    return {
      ok: false,
      status: isAbort ? 504 : 503,
      data: null,
      error: isAbort ? 'BRIDGE_TIMEOUT' : 'BRIDGE_UNREACHABLE',
      msg: isAbort
        ? `Quá thời gian phản hồi từ Local Bridge (${effectiveTimeout}ms)`
        : (err && err.message ? err.message : 'Không thể kết nối Local Bridge trên cổng 48903')
    };
  }
}

async function forwardBridgeRequest(bridgeAction, rawPayload, timeoutMs) {
  const action = String(bridgeAction || '').trim();
  if (!ALLOWED_BRIDGE_ACTIONS.has(action)) {
    return {
      ok: false,
      status: 400,
      data: null,
      error: 'INVALID_BRIDGE_ACTION',
      msg: `Hành động Bridge không hợp lệ: ${action}`
    };
  }

  const effectiveTimeout = (typeof timeoutMs === 'number' && timeoutMs >= 500 && timeoutMs <= 30000)
    ? timeoutMs
    : 8000;

  let sessionToken = await ensureBridgeSessionToken(false, Math.min(5000, effectiveTimeout));
  let res = await executeSingleBridgeCall(action, rawPayload, effectiveTimeout, sessionToken);

  // Nếu Local Bridge vừa khởi động lại (đổi SessionSecret trong RAM) trả 401 BRIDGE_AUTH_REQUIRED -> Handshake lại 1 lần
  if (!res.ok && (res.status === 401 || res.error === 'BRIDGE_AUTH_REQUIRED')) {
    sessionToken = await ensureBridgeSessionToken(true, Math.min(5000, effectiveTimeout));
    if (sessionToken) {
      res = await executeSingleBridgeCall(action, rawPayload, effectiveTimeout, sessionToken);
    }
  }

  return res;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request !== 'object') {
    return false;
  }

  // 1. Chặn hoàn toàn đường đọc/ghi não AI cục bộ ở bản Cloud Client
  if (request.action === 'AI_FETCH_BRAIN' || request.action === 'AI_SAVE_BRAIN') {
    sendResponse({
      success: false,
      ok: false,
      error: 'LOCAL_BRAIN_DISABLED_IN_CLOUD_CLIENT'
    });
    return false;
  }

  // 2. Tải lại tab hiện tại
  if (request.action === 'reloadTab') {
    if (sender && sender.tab && sender.tab.id) {
      chrome.tabs.reload(sender.tab.id);
    }
    sendResponse({ ok: true });
    return false;
  }

  // 2.05 Lấy tabId thực tế của tab gửi tin nhắn (Định danh độc lập 100% cho từng tab Chrome)
  if (request.action === 'WM_GET_MY_TAB_ID') {
    const tid = sender && sender.tab ? sender.tab.id : null;
    sendResponse({ ok: true, tabId: tid });
    return false;
  }

  // 2.1 Mở hoặc Focus Cửa Sổ Rời Độc Lập (Pop-out Window panel.html)
  // Đảm bảo TUYỆT ĐỐI CHỈ DUY NHẤT 1 CỬA SỔ ĐƯỢC PHÉP TỒN TẠI (Đóng sạch mọi cửa sổ thừa nếu có)
  if (request.action === 'WM_OPEN_POPOUT') {
    const senderTabId = (sender && sender.tab && sender.tab.id) ? sender.tab.id : request.tabId;
    (async () => {
      try {
        const panelUrl = chrome.runtime.getURL('panel.html');
        const allTabs = await chrome.tabs.query({});
        const panelTabs = allTabs.filter(t => t.url && t.url.includes('panel.html'));

        if (panelTabs.length > 0) {
          const primaryTab = panelTabs[0];
          try {
            const winInfo = await chrome.windows.get(primaryTab.windowId);
            if (winInfo && winInfo.state === 'minimized') {
              await chrome.windows.update(primaryTab.windowId, { state: 'normal', focused: true, drawAttention: true });
            } else {
              await chrome.windows.update(primaryTab.windowId, { focused: true, drawAttention: true });
            }
          } catch (e) {
            await chrome.windows.update(primaryTab.windowId, { focused: true }).catch(() => {});
          }
          if (senderTabId) {
            chrome.tabs.sendMessage(primaryTab.id, { action: 'PANEL_SELECT_TAB', tabId: senderTabId }).catch(() => {});
          }
          // Đóng triệt để bất kỳ cửa sổ panel nào bị mở thừa nếu có trước đó
          for (let i = 1; i < panelTabs.length; i++) {
            chrome.windows.remove(panelTabs[i].windowId).catch(() => {});
          }
          sendResponse({ ok: true, focused: true });
          return;
        }

        const targetUrl = senderTabId ? `${panelUrl}?tabId=${senderTabId}` : panelUrl;
        await chrome.windows.create({
          url: targetUrl,
          type: 'popup',
          width: 520,
          height: 860,
          top: 60,
          left: 60,
          focused: true
        });
        sendResponse({ ok: true, created: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 3. Proxy an toàn tới Local Bridge (WM_BRIDGE_REQUEST & tương thích ngược BRIDGE_CALL)
  if (request.action === 'WM_BRIDGE_REQUEST' || request.action === 'BRIDGE_CALL') {
    let bridgeAction = request.bridgeAction;
    let payload = request.payload;
    const timeoutMs = request.timeoutMs;

    if (!bridgeAction && request.action === 'BRIDGE_CALL' && payload && typeof payload === 'object') {
      bridgeAction = payload.action;
      payload = payload.payload;
    }

    forwardBridgeRequest(bridgeAction, payload, timeoutMs)
      .then((result) => sendResponse(result))
      .catch((err) => {
        sendResponse({
          ok: false,
          status: 503,
          data: null,
          error: 'BRIDGE_PROXY_EXCEPTION',
          msg: (err && err.message) ? err.message : 'Lỗi proxy tới Local Bridge'
        });
      });

    return true;
  }

  // 4. Proxy truy vấn Báo cáo cược chính thức từ máy chủ WM Casino (Gateway.php?cmd=GetGameReport)
  if (request.action === 'WM_FETCH_GATEWAY_REPORT') {
    (async () => {
      try {
        const { gatewayUrl, sid, startTime, endTime } = request;
        if (!gatewayUrl || !sid) {
          sendResponse({ ok: false, error: 'MISSING_GATEWAY_CREDENTIALS' });
          return;
        }

        const params = new URLSearchParams();
        params.set('cmd', 'GetGameReport');
        params.set('lang', 'vi');
        params.set('sid', sid);
        params.set('gid', '');
        params.set('startTime', startTime);
        params.set('endTime', endTime);
        params.set('cardtype', '1');
        params.set('packet', '1');

        const resp = await fetch(gatewayUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': '*/*'
          },
          body: params.toString()
        });

        if (!resp.ok) {
          sendResponse({ ok: false, error: `HTTP_${resp.status}` });
          return;
        }

        const json = await resp.json();
        sendResponse({ ok: true, data: json });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
});
