// ws-hook.js - Chạy ở execution context MAIN để hook trực tiếp WebSocket của sảnh WM
(function() {
  if (window.__WM_WS_HOOKED__) return;
  window.__WM_WS_HOOKED__ = true;

  console.log('[WM Hook] Đã kích hoạt bộ lắng nghe WebSocket sảnh WM (Tối ưu hóa hiệu năng & Chống ngủ)');

  // 1. Chống trang web sảnh game phát hiện tab bị ẩn / minimize (Page Visibility Spoofing)
  try {
    Object.defineProperty(document, 'hidden', {
      get: () => false,
      configurable: true
    });
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible',
      configurable: true
    });
    window.addEventListener('visibilitychange', (e) => {
      e.stopImmediatePropagation();
    }, true);
  } catch (e) {}

  const OriginalWebSocket = window.WebSocket;
  if (!OriginalWebSocket) return;

  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);

    try {
      const urlStr = String(url || '');

      const origWsSend = ws.send;
      ws.send = function(data) {
        try {
          if (typeof data === 'string' && data.length > 2 && data.length < 65536) {
            if (!data.includes('"protocol":999') && !data.includes('"protocol": 999')) {
              console.log('%c[WM Click / Gói Tin Gửi Đi]', 'color: #38bdf8; font-weight: bold;', data);
              broadcastGatewayMessage({
                type: 'WM_WS_PACKET_OUT',
                url: urlStr,
                data: data
              });
            }
          }
        } catch (err) {}
        return origWsSend.apply(this, arguments);
      };

      ws.addEventListener('message', function(event) {
        try {
          const raw = event.data;
          // Chỉ chuyển tiếp tin nhắn dạng JSON string liên quan đến dữ liệu bàn cược
          // BỎ QUA hoàn toàn dữ liệu nhị phân (video streaming, audio) và gói tin heartbeat để giải phóng 100% CPU
          if (typeof raw === 'string' && raw.length > 8 && raw.length < 131072) {
            const firstChar = raw.charCodeAt(0);
            if (firstChar === 123 || firstChar === 91) { // '{' hoặc '['
              // Bỏ qua heartbeat protocol 999
              if (!raw.includes('"protocol":999') && !raw.includes('"protocol": 999')) {
                broadcastGatewayMessage({
                  type: 'WM_WS_PACKET_IN',
                  url: urlStr,
                  data: raw
                });
              }
            }
          }
        } catch (err) {}
      });
    } catch (e) {
      console.error('[WM Hook] Lỗi gắn hook:', e);
    }

    return ws;
  };

  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

  // 2. Bộ chuyển tiếp thông điệp đa tầng (cho cả window hiện tại, parent frame và top frame)
  function broadcastGatewayMessage(payload) {
    try { window.postMessage(payload, '*'); } catch (e) {}
    try { if (window.parent && window.parent !== window) window.parent.postMessage(payload, '*'); } catch (e) {}
    try { if (window.top && window.top !== window && window.top !== window.parent) window.top.postMessage(payload, '*'); } catch (e) {}
  }

  // Tự động kiểm tra sid từ URL query params, cookie hoặc sessionStorage nếu có
  try {
    const params = new URLSearchParams(window.location.search);
    let sidInUrl = params.get('sid');
    if (!sidInUrl && document.cookie) {
      const cm = document.cookie.match(/sid=([a-zA-Z0-9_\-]+)/);
      if (cm) sidInUrl = cm[1];
    }
    if (!sidInUrl) {
      try {
        sidInUrl = sessionStorage.getItem('wm_gateway_sid') || sessionStorage.getItem('sid');
      } catch (e) {}
    }
    if (sidInUrl) {
      const gUrl = window.location.origin + '/api/web/Gateway.php';
      broadcastGatewayMessage({
        type: 'WM_GATEWAY_CREDENTIALS',
        gatewayUrl: gUrl,
        sid: sidInUrl
      });
    }
  } catch (e) {}

  // 3. Hook XMLHttpRequest & window.fetch để tóm link Gateway.php, sid và phản hồi GetGameReport của nhà cái
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      this._wm_url = String(url || '');
      this._wm_method = method;
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      const urlStr = this._wm_url || '';
      if (urlStr.includes('Gateway.php') || urlStr.includes('/api/web/')) {
        let fullUrl = urlStr;
        if (!fullUrl.startsWith('http')) {
          fullUrl = window.location.origin + (fullUrl.startsWith('/') ? '' : '/') + fullUrl;
        }

        let sid = null;
        if (typeof body === 'string') {
          const match = body.match(/[?&]?sid=([^&]+)/);
          if (match) sid = decodeURIComponent(match[1]);
        }

        if (sid) {
          broadcastGatewayMessage({
            type: 'WM_GATEWAY_CREDENTIALS',
            gatewayUrl: fullUrl,
            sid: sid
          });
        }

        this.addEventListener('load', function() {
          try {
            if (this.status === 200 && this.responseText) {
              const resJson = JSON.parse(this.responseText);
              if (resJson && resJson.errorCode === 0 && resJson.result) {
                if (resJson.result.total || resJson.result.report) {
                  broadcastGatewayMessage({
                    type: 'WM_GATEWAY_REPORT_DATA',
                    gatewayUrl: fullUrl,
                    sid: sid,
                    total: resJson.result.total,
                    report: resJson.result.report
                  });
                }
              }
            }
          } catch (e) {}
        });
      }
      return origSend.apply(this, arguments);
    };

    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = async function(...args) {
        const reqUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        const response = await origFetch.apply(this, args);
        if (reqUrl.includes('Gateway.php') || reqUrl.includes('/api/web/')) {
          try {
            let fullUrl = reqUrl;
            if (!fullUrl.startsWith('http')) {
              fullUrl = window.location.origin + (fullUrl.startsWith('/') ? '' : '/') + fullUrl;
            }
            let sid = null;
            const init = args[1];
            if (init && typeof init.body === 'string') {
              const match = init.body.match(/[?&]?sid=([^&]+)/);
              if (match) sid = decodeURIComponent(match[1]);
            }
            if (sid) {
              broadcastGatewayMessage({
                type: 'WM_GATEWAY_CREDENTIALS',
                gatewayUrl: fullUrl,
                sid: sid
              });
            }

            const clone = response.clone();
            clone.json().then(resJson => {
              if (resJson && resJson.errorCode === 0 && resJson.result) {
                if (resJson.result.total || resJson.result.report) {
                  broadcastGatewayMessage({
                    type: 'WM_GATEWAY_REPORT_DATA',
                    gatewayUrl: fullUrl,
                    sid: sid,
                    total: resJson.result.total,
                    report: resJson.result.report
                  });
                }
              }
            }).catch(() => {});
          } catch (e) {}
        }
        return response;
      };
    }
  } catch (e) {
    console.error('[WM Hook] Lỗi gắn hook XHR/Fetch:', e);
  }
})();
