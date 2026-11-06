// popup.js - Quản lý & Điều khiển Đa Tab WM Baccarat Pro
document.addEventListener('DOMContentLoaded', () => {
  const tabsList = document.getElementById('tabs-list');
  const tabsSummary = document.getElementById('tabs-summary');
  const refreshBtn = document.getElementById('btn-refresh');

  let autoRefreshTimer = null;
  let isScanning = false;
  let lastTabsSignature = '';

  function formatCompactMoney(val, withPlusSign = false) {
    const num = Number(val) || 0;
    if (num === 0) return '0k';
    const abs = Math.abs(num);
    let str = '';
    if (abs >= 1000000) {
      str = (abs / 1000000).toFixed(1).replace(/\.0$/, '') + 'T';
    } else if (abs >= 1000) {
      str = (abs / 1000).toFixed(1).replace(/\.0$/, '') + 'M';
    } else {
      str = (abs % 1 === 0 ? abs.toString() : abs.toFixed(1).replace(/\.0$/, '')) + 'k';
    }
    const sign = num > 0 ? (withPlusSign ? '+' : '') : (num < 0 ? '-' : '');
    return `${sign}${str}`;
  }

  async function scanTabs() {
    if (isScanning) return;
    isScanning = true;

    try {
      const tabs = await chrome.tabs.query({});
      const activeWMTabs = [];

      for (const tab of tabs) {
        if (!tab.id) continue;
        const url = tab.url || '';
        if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('chrome-extension://')) {
          continue;
        }

        try {
          const res = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { action: 'WM_GET_TAB_STATUS' }, (response) => {
              if (chrome.runtime.lastError || !response || !response.alive) {
                resolve(null);
              } else {
                resolve(response);
              }
            });
          });

          if (res && res.alive) {
            const tc = Number(res.tablesCount) || 0;
            // Chỉ hiển thị tab ĐÃ THẤY BÀN hoặc đang chạy
            if (tc > 0 || res.isRunning) {
              activeWMTabs.push({ tab, info: res });
            }
          }
        } catch (e) {}
      }

      renderTabs(activeWMTabs);
    } catch (err) {
      console.error('[Popup] Lỗi quét tab:', err);
    } finally {
      isScanning = false;
    }
  }

  function renderTabs(activeWMTabs) {
    if (tabsSummary) {
      tabsSummary.innerHTML = `Đang chạy: <b>${activeWMTabs.length} tab</b>`;
    }

    if (!tabsList) return;

    if (activeWMTabs.length === 0) {
      if (lastTabsSignature !== '__EMPTY__') {
        lastTabsSignature = '__EMPTY__';
        tabsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📡</div>
          <div class="empty-title">Chưa phát hiện tab sảnh WM nào</div>
          <div class="empty-desc">
            Hãy mở một hoặc nhiều tab trang web sảnh game WM Casino. Tool sẽ tự động nhận diện và hiển thị tại đây!
          </div>
        </div>
      `;
      }
      return;
    }

    // Tối ưu hiệu năng: So sánh chữ ký trạng thái các tab, không render lại DOM nếu không có thay đổi
    const currentSig = activeWMTabs.map(({ tab, info }) => {
      const s = info.stats || {};
      return `${tab.id}_${info.isRunning}_${info.betMode}_${info.tablesCount}_${s.totalBets || 0}_${s.totalProfit || 0}_${info.pendingCount || 0}`;
    }).join('|');

    if (currentSig === lastTabsSignature && tabsList.children.length === activeWMTabs.length) {
      return; // Trạng thái không đổi -> Giữ nguyên DOM, tiết kiệm CPU/RAM
    }
    lastTabsSignature = currentSig;

    tabsList.innerHTML = activeWMTabs.map(({ tab, info }) => {
      const isRunning = Boolean(info.isRunning);
      const stats = info.stats || { totalBets: 0, wins: 0, losses: 0, winRate: 0, totalProfit: 0 };
      const p = stats.totalProfit || 0;
      
      const profitFormatted = formatCompactMoney(p, true);
      const profitClass = p > 0 ? 'positive' : (p < 0 ? 'negative' : 'zero');

      const isPaper = Boolean(info.tradingMode === 'PAPER');
      let badgeText = '⚪ TẠM DỪNG';
      let badgeClass = 'badge-stopped';
      if (isRunning) {
        if (isPaper) {
          badgeText = '🔵 GIẢ LẬP (PAPER)';
          badgeClass = 'badge-paper';
        } else {
          badgeText = '🟢 CƯỢC THẬT (REAL)';
          badgeClass = 'badge-running';
        }
      }

      return `
        <div class="tab-card" data-tab-id="${tab.id}">
          <div class="tab-card-header">
            <div class="tab-domain" title="${tab.url || ''}">
              <span class="tab-dot ${isRunning ? 'running' : 'stopped'}"></span>
              <span>${escapeHtml(info.domain || 'Sảnh Game')}</span>
              <span class="tab-id-tag">Tab #${tab.id}</span>
            </div>
            <span class="tab-badge ${badgeClass}">${badgeText}</span>
          </div>

          <div class="tab-card-body">
            <div class="tab-metric">
              <span class="label">Bàn theo dõi</span>
              <span class="val">${info.tablesCount || 0} bàn ${info.pendingCount > 0 ? `<b style="color:#f59e0b;">(${info.pendingCount} chờ)</b>` : ''}</span>
            </div>
            <div class="tab-metric">
              <span class="label">Tỷ lệ thắng</span>
              <span class="val">${stats.wins || 0}W - ${stats.losses || 0}L (${stats.winRate || 0}%)</span>
            </div>
            <div class="tab-metric span-2">
              <span class="label">Lợi nhuận ròng (P/L):</span>
              <span class="val profit ${profitClass}">${profitFormatted}</span>
            </div>
          </div>

          <div style="margin-bottom: 6px; display: flex; gap: 6px;">
            <button class="btn-action popout-tab-btn" data-tab-id="${tab.id}" style="flex: 1.2; background: linear-gradient(135deg, #0284c7, #00f2fe); color: #080c14; font-weight: 800; border: none; border-radius: 6px; padding: 7px 8px; cursor: pointer;" title="Mở bảng điều khiển rời độc lập (không che tab game)">
              🪟 Cửa Sổ Rời
            </button>
            <button class="btn-action open-panel-btn" data-tab-id="${tab.id}" data-window-id="${tab.windowId || ''}" style="flex: 1; background: #1e293b; color: #38bdf8; border: 1px solid #334155; border-radius: 6px; padding: 7px 6px; cursor: pointer; font-size: 10.5px;" title="Mở bảng trên trang web game">
              🎛️ Bảng Game
            </button>
          </div>

          <div class="tab-card-actions">
            <button class="btn-action view-btn" data-tab-id="${tab.id}" data-window-id="${tab.windowId || ''}">
              👁️ Xem Tab
            </button>
            <button class="btn-action toggle-btn ${isRunning ? 'btn-stop' : 'btn-start'}" data-tab-id="${tab.id}">
              ${isRunning ? '⏸️ Tạm Dừng' : '▶️ Bắt Đầu Cược'}
            </button>
            <button class="btn-action reload-btn" data-tab-id="${tab.id}" title="Tải lại trang web này">
              🔄
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Gắn sự kiện click cho các nút trên từng Card
    attachTabActions();
  }

  
  // Xử lý mở Cửa Sổ Rời Độc Lập (Pop-out Window)
  // Đảm bảo TUYỆT ĐỐI CHỈ DUY NHẤT 1 CỬA SỔ ĐƯỢC PHÉP TỒN TẠI (Đóng sạch mọi cửa sổ thừa nếu có)
  async function openPopoutWindow(tabId = null) {
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
        if (tabId) {
          chrome.tabs.sendMessage(primaryTab.id, { action: 'PANEL_SELECT_TAB', tabId: tabId }).catch(() => {});
        }
        // Đóng sạch mọi cửa sổ panel bị mở thừa nếu có trước đó
        for (let i = 1; i < panelTabs.length; i++) {
          chrome.windows.remove(panelTabs[i].windowId).catch(() => {});
        }
        return;
      }

      const targetUrl = tabId ? `${panelUrl}?tabId=${tabId}` : panelUrl;
      await chrome.windows.create({
        url: targetUrl,
        type: 'popup',
        width: 520,
        height: 840,
        top: 60,
        left: 60,
        focused: true
      });
    } catch (err) {
      console.error('[Popup] Lỗi mở cửa sổ rời:', err);
    }
  }

  const btnPopout = document.getElementById('btn-popout-panel');
  if (btnPopout) {
    btnPopout.addEventListener('click', async () => {
      await openPopoutWindow();
      window.close();
    });
  }

  function attachTabActions() {
    // 0. Mở Bảng Cài Đặt & Chức năng Tool N/A DEV
    document.querySelectorAll('.popout-tab-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tabId = parseInt(btn.getAttribute('data-tab-id'), 10);
        await openPopoutWindow(tabId);
        window.close();
      });
    });

    document.querySelectorAll('.open-panel-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tabId = parseInt(btn.getAttribute('data-tab-id'));
        const windowId = parseInt(btn.getAttribute('data-window-id'));
        try {
          if (tabId) await chrome.tabs.update(tabId, { active: true });
          if (windowId) await chrome.windows.update(windowId, { focused: true });
          chrome.tabs.sendMessage(tabId, { action: 'WM_OPEN_PANEL' }, () => {
            if (chrome.runtime.lastError) {}
          });
        } catch (err) {}
      });
    });

    // 1. Xem Tab (Chuyển active tab và focus window)
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tabId = parseInt(btn.getAttribute('data-tab-id'));
        const windowId = parseInt(btn.getAttribute('data-window-id'));
        try {
          if (tabId) await chrome.tabs.update(tabId, { active: true });
          if (windowId) await chrome.windows.update(windowId, { focused: true });
        } catch (err) {}
      });
    });

    // 2. Bắt đầu / Tạm dừng
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabId = parseInt(btn.getAttribute('data-tab-id'));
        if (!tabId) return;
        btn.textContent = '⏳...';
        btn.disabled = true;

        chrome.tabs.sendMessage(tabId, { action: 'WM_TOGGLE_RUN' }, (res) => {
          setTimeout(scanTabs, 300);
        });
      });
    });

    // 3. Tải lại tab
    document.querySelectorAll('.reload-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabId = parseInt(btn.getAttribute('data-tab-id'));
        if (!tabId) return;
        btn.textContent = '⏳';
        btn.disabled = true;

        chrome.tabs.sendMessage(tabId, { action: 'WM_RELOAD_TAB' }, () => {
          setTimeout(scanTabs, 1200);
        });
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      checkLicenseStatus();
      scanTabs();
    });
  }

  // Quản lý kiểm tra bản quyền máy tính
  const licenseBanner = document.getElementById('license-banner');
  const licensePill = document.getElementById('license-status-pill');
  const actBox = document.getElementById('license-activation-box');
  const keyInput = document.getElementById('popup-key-input');
  const btnActivate = document.getElementById('popup-btn-activate');
  const actMsg = document.getElementById('popup-activate-msg');

  if (licenseBanner && actBox) {
    licenseBanner.addEventListener('click', () => {
      actBox.style.display = actBox.style.display === 'none' ? 'block' : 'none';
    });
  }

  if (btnActivate && keyInput) {
    btnActivate.addEventListener('click', async () => {
      const keyVal = keyInput.value.trim();
      if (!keyVal) {
        if (actMsg) {
          actMsg.style.display = 'block';
          actMsg.style.color = '#ef4444';
          actMsg.innerText = 'Vui lòng dán mã License Key!';
        }
        return;
      }
      btnActivate.innerText = 'Đang kích hoạt...';
      btnActivate.disabled = true;
      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: 'WM_BRIDGE_REQUEST', bridgeAction: 'activate', payload: { key: keyVal }, timeoutMs: 10000 },
            (resp) => {
              if (chrome.runtime.lastError) resolve(null);
              else resolve(resp);
            }
          );
        });
        if (res && res.ok) {
          if (actMsg) {
            actMsg.style.display = 'block';
            actMsg.style.color = '#10b981';
            actMsg.innerText = '✅ Kích hoạt máy thành công!';
          }
          setTimeout(() => {
            if (actBox) actBox.style.display = 'none';
            checkLicenseStatus();
          }, 1000);
        } else {
          const errMsg = (res && res.msg) || (res && res.error) || 'Kích hoạt thất bại. Kiểm tra lại key!';
          if (actMsg) {
            actMsg.style.display = 'block';
            actMsg.style.color = '#ef4444';
            actMsg.innerText = '❌ ' + errMsg;
          }
        }
      } catch (err) {
        if (actMsg) {
          actMsg.style.display = 'block';
          actMsg.style.color = '#ef4444';
          actMsg.innerText = '❌ Lỗi kết nối: ' + err.message;
        }
      } finally {
        btnActivate.innerText = 'KÍCH HOẠT';
        btnActivate.disabled = false;
      }
    });
  }

  async function checkLicenseStatus() {
    if (!licensePill) return;
    try {
      let res = null;
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          res = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { action: 'WM_BRIDGE_REQUEST', bridgeAction: 'status', payload: {}, timeoutMs: 8000 },
              (resp) => {
                if (chrome.runtime.lastError) resolve(null);
                else resolve(resp);
              }
            );
          });
        } catch (e) {}
      }

      if (!res) {
        const extId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)
          ? chrome.runtime.id
          : 'ckbbfkpiagcdimpojifnelmegkohfpjb';
        let sessionToken = '';
        try {
          const hsResp = await fetch('http://127.0.0.1:48903/handshake', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-WM-Client': 'NADEV-EXT-V2',
              'X-Extension-ID': extId
            },
            body: JSON.stringify({
              client_nonce: Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10),
              extension_id: extId
            })
          });
          const hsJson = await hsResp.json();
          if (hsJson && hsJson.ok && hsJson.session_token) {
            sessionToken = hsJson.session_token;
          }
        } catch (e) {}

        const resp = await fetch('http://127.0.0.1:48903/bridge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-WM-Client': 'NADEV-EXT-V2',
            'X-Extension-ID': extId,
            'X-Bridge-Auth': sessionToken
          },
          body: JSON.stringify({ action: 'status' })
        });
        res = await resp.json();
      }
      if (res && res.ok && res.data && res.data.active) {
        licensePill.style.color = '#10b981';
        licensePill.innerText = `🟢 Còn ${res.data.days_left} ngày`;
        const masked = res.data.license_key_masked || '***';
        if (licenseBanner) {
          licenseBanner.style.background = '';
          licenseBanner.style.border = '';
          licenseBanner.title = `Bản quyền hợp lệ\nKhách: ${res.data.customer_name || 'VIP'}\nKey: ${masked}\nCòn lại: ${res.data.days_left} ngày (${res.data.hours_left} giờ)`;
        }
        if (actBox) actBox.style.display = 'none';

        // Lưu vào cache bộ nhớ tiện ích và đồng bộ tức thì sang tất cả các tab đang mở
        const cached = {
          valid: true,
          keyMasked: masked,
          customer: res.data.customer_name || 'VIP',
          daysLeft: res.data.days_left,
          hoursLeft: res.data.hours_left,
          updatedAt: Date.now()
        };
        try {
          chrome.storage.local.set({ wm_license_cached: cached });
          chrome.tabs.query({}, (tabs) => {
            if (!tabs) return;
            for (const t of tabs) {
              if (t && t.id) {
                chrome.tabs.sendMessage(t.id, { action: 'WM_LICENSE_UPDATED', license: cached }, () => {
                  if (chrome.runtime.lastError) {}
                });
              }
            }
          });
        } catch (e) {}
      } else {
        const msg = (res && res.data && res.data.msg) || (res && res.msg) || (res && res.error) || 'Chưa kích hoạt';
        licensePill.style.color = '#ef4444';
        const isBlocked = msg.toLowerCase().includes('khóa') || msg.toLowerCase().includes('thu hồi') || msg.toLowerCase().includes('disabled') || msg.toLowerCase().includes('expired');
        licensePill.innerText = isBlocked ? `🔴 BẢN QUYỀN ĐÃ BỊ KHÓA / HẾT HẠN` : `🔴 ${msg}`;
        if (licenseBanner) {
          licenseBanner.style.background = 'rgba(239, 68, 68, 0.2)';
          licenseBanner.style.border = '1px solid #ef4444';
          licenseBanner.title = `Trạng thái bản quyền: ${msg}\n${isBlocked ? 'Bản quyền đã bị khóa hoặc hết hạn từ máy chủ' : 'Hãy dán License Key vào ô bên dưới để kích hoạt'}`;
        }
        if (actBox) actBox.style.display = 'block';

        // Đồng bộ trạng thái KHÓA / HẾT HẠN vào cache và gửi thông báo dừng cược tức thì sang toàn bộ tab
        const revoked = {
          valid: false,
          error: msg,
          updatedAt: Date.now()
        };
        try {
          chrome.storage.local.set({ wm_license_cached: revoked });
          chrome.tabs.query({}, (tabs) => {
            if (!tabs) return;
            for (const t of tabs) {
              if (t && t.id) {
                chrome.tabs.sendMessage(t.id, { action: 'WM_LICENSE_UPDATED', license: revoked }, () => {
                  if (chrome.runtime.lastError) {}
                });
              }
            }
          });
        } catch (e) {}
      }
    } catch (e) {
      licensePill.style.color = '#ef4444';
      licensePill.innerText = `🔴 Chưa kích hoạt máy`;
      if (licenseBanner) {
        licenseBanner.title = 'Chưa chạy ActivateWM.bat để liên kết máy';
      }
    }
  }

  if (licenseBanner) {
    licenseBanner.addEventListener('click', checkLicenseStatus);
  }

  // Khôi phục ngay từ cache nếu có (hiển thị tức thì)
  try {
    chrome.storage.local.get(['wm_license_cached'], (st) => {
      if (st && st.wm_license_cached && licensePill) {
        if (st.wm_license_cached.valid) {
          licensePill.style.color = '#10b981';
          licensePill.innerText = `🟢 Còn ${st.wm_license_cached.daysLeft} ngày`;
        } else {
          licensePill.style.color = '#ef4444';
          const err = st.wm_license_cached.error || 'Chưa kích hoạt';
          licensePill.innerText = err.toLowerCase().includes('khóa') ? `🔴 ĐÃ BỊ KHÓA` : `🔴 ${err}`;
        }
      }
    });
  } catch (e) {}

  checkLicenseStatus();

  // Khởi chạy quét lần đầu
  scanTabs();

  // Tự động làm mới số liệu mỗi 2.5s khi popup đang mở
  autoRefreshTimer = setInterval(() => {
    scanTabs();
    if (licensePill && (!licensePill.innerText.includes('Còn') || licensePill.innerText.includes('Failed'))) {
      checkLicenseStatus();
    }
  }, 2500);

  window.addEventListener('unload', () => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  });
});
