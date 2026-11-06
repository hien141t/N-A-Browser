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
    const ws = (arguments.length > 1 && protocols !== undefined)
      ? new OriginalWebSocket(url, protocols)
      : new OriginalWebSocket(url);

    try {
      const urlStr = url != null ? String(url) : '';

      const origWsSend = ws.send;
      if (typeof origWsSend === 'function') {
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
      }

      if (typeof ws.addEventListener === 'function') {
        ws.addEventListener('message', function(event) {
          try {
            if (!event) return;
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
      }
    } catch (e) {
      console.error('[WM Hook] Lỗi gắn hook WebSocket:', e);
    }

    return ws;
  };

  try {
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    window.WebSocket.OPEN = OriginalWebSocket.OPEN;
    window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
    window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
  } catch (e) {}

  // 2. Bộ chuyển tiếp thông điệp đa tầng (cho cả window hiện tại, parent frame và top frame)
  function broadcastGatewayMessage(payload) {
    if (!payload || typeof payload !== 'object') return;
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

    if (typeof origOpen === 'function') {
      XMLHttpRequest.prototype.open = function(method, url) {
        try {
          if (url != null) {
            this._wm_url = typeof url === 'string' ? url : (url.href ? url.href : String(url));
          } else {
            this._wm_url = '';
          }
          this._wm_method = method != null ? String(method) : '';
        } catch (e) {}
        return origOpen.apply(this, arguments);
      };
    }

    if (typeof origSend === 'function') {
      XMLHttpRequest.prototype.send = function(body) {
        try {
          const urlStr = typeof this._wm_url === 'string' ? this._wm_url : '';
          if (urlStr && (urlStr.includes('Gateway.php') || urlStr.includes('/api/web/'))) {
            let fullUrl = urlStr;
            try {
              if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
                fullUrl = window.location.origin + (fullUrl.startsWith('/') ? '' : '/') + fullUrl;
              }
            } catch (e) {}

            let sid = null;
            if (typeof body === 'string') {
              try {
                const match = body.match(/[?&]?sid=([^&]+)/);
                if (match && match[1]) {
                  sid = decodeURIComponent(match[1]);
                }
              } catch (e) {}
            }

            if (sid) {
              try {
                broadcastGatewayMessage({
                  type: 'WM_GATEWAY_CREDENTIALS',
                  gatewayUrl: fullUrl,
                  sid: sid
                });
              } catch (e) {}
            }

            try {
              this.addEventListener('load', function() {
                try {
                  if (this.status === 200 && typeof this.responseText === 'string' && this.responseText) {
                    let resJson = null;
                    try {
                      resJson = JSON.parse(this.responseText);
                    } catch (e) {}

                    if (resJson && typeof resJson === 'object' && resJson.errorCode === 0 && resJson.result && typeof resJson.result === 'object') {
                      if (resJson.result.total !== undefined || resJson.result.report !== undefined) {
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
            } catch (e) {}
          }
        } catch (e) {
          // Bảo vệ tối đa: Tránh mọi exception trong hook làm gián đoạn request gốc của web
        }

        return origSend.apply(this, arguments);
      };
    }

    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = async function(...args) {
        let reqUrl = '';
        try {
          if (args && args.length > 0 && args[0] != null) {
            const firstArg = args[0];
            if (typeof firstArg === 'string') {
              reqUrl = firstArg;
            } else if (typeof firstArg === 'object') {
              if (typeof firstArg.url === 'string') {
                reqUrl = firstArg.url;
              } else if (typeof firstArg.href === 'string') {
                reqUrl = firstArg.href;
              } else {
                reqUrl = String(firstArg);
              }
            } else {
              reqUrl = String(firstArg);
            }
          }
        } catch (e) {
          reqUrl = '';
        }

        const response = await origFetch.apply(this, args);

        try {
          if (reqUrl && typeof reqUrl === 'string' && (reqUrl.includes('Gateway.php') || reqUrl.includes('/api/web/'))) {
            let fullUrl = reqUrl;
            try {
              if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
                fullUrl = window.location.origin + (fullUrl.startsWith('/') ? '' : '/') + fullUrl;
              }
            } catch (e) {}

            let sid = null;
            try {
              const init = (args && args.length > 1 && args[1] != null && typeof args[1] === 'object') ? args[1] : null;
              if (init && typeof init.body === 'string') {
                const match = init.body.match(/[?&]?sid=([^&]+)/);
                if (match && match[1]) {
                  sid = decodeURIComponent(match[1]);
                }
              }
            } catch (e) {}

            if (sid) {
              try {
                broadcastGatewayMessage({
                  type: 'WM_GATEWAY_CREDENTIALS',
                  gatewayUrl: fullUrl,
                  sid: sid
                });
              } catch (e) {}
            }

            if (response && typeof response.clone === 'function') {
              try {
                const clone = response.clone();
                if (clone && typeof clone.json === 'function') {
                  clone.json().then(resJson => {
                    try {
                      if (resJson && typeof resJson === 'object' && resJson.errorCode === 0 && resJson.result && typeof resJson.result === 'object') {
                        if (resJson.result.total !== undefined || resJson.result.report !== undefined) {
                          broadcastGatewayMessage({
                            type: 'WM_GATEWAY_REPORT_DATA',
                            gatewayUrl: fullUrl,
                            sid: sid,
                            total: resJson.result.total,
                            report: resJson.result.report
                          });
                        }
                      }
                    } catch (e) {}
                  }).catch(() => {});
                }
              } catch (e) {}
            }
          }
        } catch (e) {
          // Bảo vệ tối đa: Không làm gián đoạn response cho ứng dụng web bên thứ ba
        }

        return response;
      };
    }
  } catch (e) {
    console.error('[WM Hook] Lỗi gắn hook XHR/Fetch:', e);
  }
})();
