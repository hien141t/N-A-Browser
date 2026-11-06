// ==========================================================================
// WM AUTO BACCARAT PRO - CONTENT SCRIPT (PHIÊN BẢN V2.5 TOÀN NĂNG)
// Tự động nhận diện mọi giao diện (H5 Mobile / PC Mới / Cũ), quét toàn bàn
// ==========================================================================

console.log('[WM Bot] Content script đã nạp thành công');

// 1. Kiểm tra ID bàn chuẩn tuyệt đối (loại bỏ 100% thẻ con và hậu tố _BankerRate, _confirm, _cancel...)
function isStrictTableId(id) {
  if (!id || typeof id !== 'string') return false;
  const clean = id.trim();
  if (/(?:_BankerRate|_PlayerRate|_TieRate|_confirm|_cancel|_alert|_prompt|_betArea|_header|_title|_time|_chip|_road|_status|_video|_dealer|_box|_mask|_canvas|_bet|_rate|_count|_close|_open)/i.test(clean)) {
    return false;
  }
  // Loại bỏ hoàn toàn mã bàn ảo 1415 hoặc bàn không hợp lệ
  if (clean.includes('1415') || clean.includes('invalid')) return false;

  // groupMultiple_<gameType>_<code>: Hỗ trợ 100% tất cả các bàn thực của WM Casino (quét đủ 27-36+ bàn)
  if (/^groupMultiple_\d+_\d+$/i.test(clean)) {
    const m = clean.match(/^groupMultiple_(\d+)_(\d+)$/i);
    if (m) {
      const gameType = parseInt(m[1], 10);
      if (gameType !== 101) return false; // Chỉ nhận Baccarat 101, loại bỏ Rồng Hổ (102), Roulette (103), Sicbo (104)
      const code = parseInt(m[2], 10);
      return !isNaN(code) && code > 0;
    }
  }

  // box_pc_<num>
  if (/^box_pc_\d+$/i.test(clean)) {
    const m = clean.match(/^box_pc_(\d+)$/i);
    if (m) {
      const code = parseInt(m[1], 10);
      return !isNaN(code) && code > 0;
    }
  }

  // Bàn chuẩn có tiền tố baccarat (wm_sexy_bac_1..60, classic_bac_1..60, wm_bac_931..1363, ...)
  if (/^(?:wm_)?_?(?:sexy_|classic_|speed_|mi_|special_)?bac_?\d+$/i.test(clean)) {
    const m = clean.match(/\d+$/);
    if (m) {
      const num = parseInt(m[0], 10);
      return !isNaN(num) && num > 0 && num <= 2000;
    }
  }
  return false;
}

// 2. Kiểm tra bàn đóng / bảo trì (chỉ chọn lọc bàn đã mở ở sảnh này)
function isTableClosedOrMaintenance(el) {
  if (!el) return true;
  const text = (el.textContent || '').toLowerCase();
  if (/(bảo trì|maintenance|tạm dừng|tạm đóng|ngưng phục vụ|closed)/i.test(text)) {
    return true;
  }
  if (/(chờ mở|sắp mở)/i.test(text)) {
    return true;
  }
  try {
    const statusEl = el.querySelector('.state, .status, [class*="state"], [class*="status"]');
    if (statusEl) {
      const stText = (statusEl.textContent || '').trim().toLowerCase();
      if (stText === 'đóng' || stText === 'close' || stText === 'closed' || stText === 'bảo trì') {
        return true;
      }
    }
  } catch (e) {}
  if (el.querySelector && el.querySelector('.maintain, .table-close, .is-close, [class*="mask-close"], .table-disabled, .room-disabled')) {
    return true;
  }
  return false;
}

// 3. Trích xuất thời gian đếm ngược chính xác tuyệt đối từ thẻ bàn
function extractTableBetTime(box, tableNum) {
  if (!box) return 0;

  const fullText = box.textContent || '';
  if (/(ngừng cược|no more bet|đang chia|chờ ván mới|dealing|settle|kết toán)/i.test(fullText)) {
    return 0;
  }

  const rawDataTime = box.getAttribute('data-bettime') || box.getAttribute('data-time') || box.getAttribute('data-countdown') || box.getAttribute('data-cd');
  if (rawDataTime !== null && rawDataTime !== undefined && rawDataTime !== '') {
    const v = parseInt(rawDataTime);
    if (!isNaN(v) && v >= 0 && v <= 60) return v;
  }

  const timeSelectors = [
    '.time', '.timer', '.bet-time', '.count-down', '.countdown',
    '[class*="countdown"]', '[class*="count-down"]', '[class*="gameroom-time"]',
    '[class*="gameroom_time"]', '[id$="_time"]', '[id$="_timer"]', '[id$="_countdown"]',
    '.downtime', '[class*="downtime"]', '.second', '[class*="second"]', '.cd', '[class*="_cd"]'
  ];

  for (const sel of timeSelectors) {
    try {
      const el = box.querySelector(sel);
      if (el) {
        const txt = (el.textContent || '').trim();
        const m = txt.match(/^(\d{1,2})\s*s?$/i) || txt.match(/\b(\d{1,2})\s*s\b/i);
        if (m) {
          const val = parseInt(m[1]);
          if (!isNaN(val) && val >= 0 && val <= 60) return val;
        }
      }
    } catch (e) {}
  }

  try {
    const headerEl = box.querySelector('.gameroom-header, .gameroom_header, .header, [class*="header"], [class*="title"]') || box.firstElementChild;
    if (headerEl) {
      const allLeaves = headerEl.querySelectorAll('*');
      for (let i = allLeaves.length - 1; i >= 0; i--) {
        const el = allLeaves[i];
        if (el.children && el.children.length > 0) continue;
        const txt = (el.textContent || '').trim();
        const m = txt.match(/^(\d{1,2})\s*s?$/i);
        if (m) {
          const val = parseInt(m[1]);
          if (tableNum && val === tableNum && /(bac|bàn)/i.test(el.parentElement?.textContent || '')) {
            continue;
          }
          if (!isNaN(val) && val >= 0 && val <= 60) {
            return val;
          }
        }
      }
    }
  } catch (e) {}

  return 0;
}

// 4. Trích xuất thông tin Shoe (Hộp bài) và Round (Số ván) từ thẻ bàn
function extractTableRoundInfo(box) {
  if (!box) return { shoe: '0', round: 0 };
  const txt = (box.textContent || '').replace(/\s+/g, ' ');

  let shoe = '0';
  let round = 0;

  // Pattern 1: Serial game / ván: ví dụ "12191027 / 25" hoặc "12191027/25" hoặc "12191027 - 25"
  const serialMatch = txt.match(/(\d{6,14})\s*[\/\-]\s*(\d{1,3})/);
  if (serialMatch) {
    shoe = serialMatch[1];
    round = parseInt(serialMatch[2], 10);
  }

  // Pattern 2: Đếm số ván đã hoàn thành từ thống kê Banker / Player / Hòa:
  // "Banker 8 Player 14 Hòa 2" -> 8 + 14 + 2 = 24 -> Ván hiện tại là 25
  const bMatch = txt.match(/Banker\s*(\d+)/i);
  const pMatch = txt.match(/Player\s*(\d+)/i);
  const tMatch = txt.match(/(?:Hòa|Hoa|Tie)\s*(\d+)/i);
  if (bMatch && pMatch) {
    const b = parseInt(bMatch[1], 10) || 0;
    const p = parseInt(pMatch[1], 10) || 0;
    const t = tMatch ? (parseInt(tMatch[1], 10) || 0) : 0;
    const completed = b + p + t;
    if (completed > 0 && (!round || round <= completed)) {
      round = completed + 1;
    }
  }

  return { shoe, round };
}

class WMAutoHelper {
  constructor() {
    this.overlay = null;
    this.miniPill = null;
    this.isRunning = false;
    this.isDragging = false;
    this.currentX = 0;
    this.currentY = 0;
    this.initialX = 0;
    this.initialY = 0;
    this.messageIdCounter = 0;
    this.pendingMessages = {};

    // Cấu hình mặc định
    this.selectedChip = 10;
    this.maxTotalBet = 0; // Hạn mức tổng tiền cược tối đa (0 = không giới hạn)
    this.maxConcurrentBets = 5; // Số lệnh cược chạy cùng lúc tối đa (0 = không giới hạn) // Số lệnh cược chạy cùng lúc tối đa (0 = không giới hạn)
    this.maxTables = 50; // Quét toàn bộ bàn sảnh (nâng mặc định lên 50 bàn để bao quát đủ 38+ bàn)

    // Bộ não AI Baccarat thích ứng trực tuyến (Online Adaptive Multi-Model AI Engine)
    this.aiEngine = window.WMBaccaratAIEngine ? new window.WMBaccaratAIEngine() : null;
    this.tableLastHistory = new Map();
    this.recentPredictionsLog = [];

    // Trạng thái bàn & Thống kê
    this.tablesMap = new Map();
    this.wsTableMeta = new Map(); // Lưu metadata chuẩn từ WebSocket (shoeNo, roundNo, gameNo)
    this.tableStates = {}; // Lưu round hiện tại đã cược chưa
    this.activeBettingTables = new Set(); // Khóa Mutex chống cược trùng bàn khi đang thực thi (In-flight Mutex)
    this.isEvaluatingAllTables = false;   // Khóa vòng lặp chống đè cược lặp lại (Loop Mutex)
    this.betHistory = [];
    this.cumulativeStats = {
      totalBets: 0,
      totalAmount: 0,
      bankerBets: 0,
      playerBets: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      totalProfit: 0
    };
    this.stats = {
      totalBets: 0,
      totalAmount: 0,
      bankerBets: 0,
      playerBets: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalProfit: 0
    };

    this.scanInterval = null;
    this.bettingLoopInterval = null;
    this.roadViewMode = localStorage.getItem('wm_road_view_mode') || 'scroll';
    this.actualGameChip = null; // Mệnh giá chip thực tế đang active trên bàn game
    this.license = { valid: false, error: 'Đang kiểm tra...' };

    // TỐI ƯU HIỆU NĂNG CHO 37-50 BÀN (PERFORMANCE HOTFIX)
    this.perfMode = localStorage.getItem('wm_perf_mode') || 'LITE'; // Mặc định LITE để siêu mượt
    this.activeTab = 'settings';
    this.isHeadlessMode = (function() { try { return localStorage.getItem('wm_headless_mode') === 'true'; } catch(e) { return false; } })();
    this.tablesDirty = true;
    this.tableCardsMap = new Map();
    this.cachedIframes = null;
    this.fullLogsHistory = [];
    this.renderLoopInterval = null;
    this.isOverlayMinimized = (localStorage.getItem('wm_overlay_minimized') === 'true');

    // Đồng bộ Báo cáo Quyết toán chính thức từ máy chủ WM Casino (Gateway.php?cmd=GetGameReport)
    this.gatewayUrl = (function() { try { return sessionStorage.getItem('wm_gateway_url'); } catch(e) { return null; } })();
    this.gatewaySid = (function() { try { return sessionStorage.getItem('wm_gateway_sid'); } catch(e) { return null; } })();
    this.officialSessionBaseline = (function() {
      try {
        const b = sessionStorage.getItem('wm_gateway_baseline');
        return b ? JSON.parse(b) : null;
      } catch(e) { return null; }
    })();
    this.gatewaySyncInterval = null;

    this.setupMessageListener();
    this.initApp();
  }

  // ==========================================================================
  // KHỞI TẠO TỰ ĐỘNG & ĐỘC LẬP THEO TAB / DOMAIN
  // ==========================================================================
  getTabStorageKey(prefix = 'wm_bet_history') {
    let tabSessionId = sessionStorage.getItem('wm_tab_session_id');
    if (!tabSessionId) {
      if (this.chromeTabId) {
        tabSessionId = `tab_${this.chromeTabId}`;
      } else {
        tabSessionId = `tab_${Math.random().toString(36).substring(2, 9)}`;
      }
      sessionStorage.setItem('wm_tab_session_id', tabSessionId);
    }
    const host = (window.location.hostname || 'default').replace(/[^a-z0-9_-]/gi, '_');
    return `${prefix}_${host}_${tabSessionId}`;
  }

  getHostStorageKey(prefix = 'wm_bet_history') {
    const host = (window.location.hostname || 'default').replace(/[^a-z0-9_-]/gi, '_');
    return `${prefix}_${host}`;
  }

  async initApp() {
    try {
      // 0. Lấy tabId Chrome thực tế từ Background Worker (Đảm bảo định danh duy nhất không trùng lặp)
      try {
        const bgTabInfo = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'WM_GET_MY_TAB_ID' }, (resp) => {
            if (chrome.runtime.lastError || !resp || !resp.tabId) resolve(null);
            else resolve(resp);
          });
        });
        if (bgTabInfo && bgTabInfo.tabId) {
          this.chromeTabId = bgTabInfo.tabId;
          sessionStorage.setItem('wm_tab_session_id', `tab_${bgTabInfo.tabId}`);
        }
      } catch (e) {}

      // Dọn sạch các key toàn cục legacy (tránh nhiễm chéo số liệu giữa các tab)
      try {
        chrome.storage.local.remove(['wm_cumulative_stats', 'wm_bet_history']);
      } catch (e) {}

      const tabKey = this.getTabStorageKey('wm_bet_history');
      const statsKey = this.getTabStorageKey('wm_cumulative_stats');
      const res = await chrome.storage.local.get([tabKey, statsKey, 'wm_license_cached']);

      // 0. Khôi phục ngay bản quyền máy từ cache (Đồng bộ tức thì với Popup / các tab)
      if (res && res.wm_license_cached) {
        this.license = res.wm_license_cached;
      }

      // Mỗi tab ĐỘC LẬP 100%: CHỈ nạp statsKey của riêng tab này
      // TUYỆT ĐỐI KHÔNG fallback sang wm_cumulative_stats để tránh nhiễm dữ liệu giữa các tab!
      if (res && res[statsKey] && typeof res[statsKey] === 'object') {
        this.cumulativeStats = res[statsKey];
      } else {
        this.cumulativeStats = {
          totalBets: 0,
          totalAmount: 0,
          bankerBets: 0,
          playerBets: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          totalProfit: 0
        };
      }

      // CHỈ nạp lịch sử cược riêng của tab này
      const rawHistory = (res && res[tabKey] && Array.isArray(res[tabKey])) ? res[tabKey] : [];

      if (rawHistory && Array.isArray(rawHistory) && rawHistory.length > 0) {
        this.betHistory = rawHistory
          .filter(item => {
            if (!item) return false;
            const comb = `${item.table || ''} ${item.tableId || ''} ${item.canonicalTableId || ''}`;
            if (comb.includes('1415') || comb.includes('invalid')) return false;
            return true;
          })
          .map(item => {
            if (item && item.result === 'WIN' && item.bet === 'B' && item.profit === item.amount) {
              item.profit = Math.round(item.amount * 0.95 * 100) / 100;
            }
            return item;
          });
        this.trimBetHistoryAndAccumulate(10);
        this.recalculateStats();
        this.saveBetHistory();
      } else {
        this.betHistory = [];
        this.recalculateStats();
      }

      console.log('[WM Bot] Tự động khởi động trên host:', window.location.hostname, '| Tab ID:', sessionStorage.getItem('wm_tab_session_id'));
      this.loadSettings();
      this.init();
      this.setupMessageListener();

      // Kiểm tra bản quyền máy tính qua Local Bridge
      this.checkLicense();
      // Quét định kỳ kiểm tra bản quyền mỗi 60 giây để thu hồi tức thì nếu Admin khóa key trên VPS
      setInterval(() => this.checkLicense(), 60 * 1000);

      // Tự động kiểm tra lại bản quyền ngay khi chuyển sang tab game này
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.checkLicense();
        }
      });

      // Khởi chạy quét bàn nền ngay lập tức (kể cả khi chưa bấm Bắt đầu)
      this.startBackgroundScanner();

      // Kích hoạt Hệ thống chống ngủ đông & chống bóp xung nhịp tab ngầm
      this.initAntiSleep();

      // Kích hoạt đồng bộ báo cáo chính thức từ máy chủ WM Casino nếu đã có credentials
      if (this.gatewayUrl && this.gatewaySid) {
        this.startGatewaySync();
      }

      // Khôi phục nhật ký dự đoán AI từ IndexedDB (nếu có) khi mở lại extension
      if (this.aiEngine && this.aiEngine.db && typeof this.aiEngine.db.getRecentPredictions === 'function') {
        this.aiEngine.db.getRecentPredictions(15).then(list => {
          if (list && list.length > 0 && this.recentPredictionsLog.length === 0) {
            this.recentPredictionsLog = list.map(p => ({
              id: p.id,
              tableId: p.tableId,
              tableName: p.tableName,
              predicted: p.predicted,
              prob: Math.round(((p.predicted === 'B' ? p.probB : p.probP) || 0.5) * 100),
              reason: p.rationale || 'Đánh giá đa mô hình',
              mode: 'REAL',
              time: new Date(p.timestamp || Date.now()).toLocaleTimeString('vi-VN'),
              actualOutcome: p.actualOutcome,
              status: p.status
            }));
            this.updateAILogTable();
          }
        }).catch(() => {});
      }

    } catch (err) {
      console.error('[WM Bot] Lỗi khởi động:', err);
      this.init();
      this.setupMessageListener();
      this.loadSettings();
      this.startBackgroundScanner();
    }
  }

  // ==========================================================================
  // XÁC THỰC BẢN QUYỀN MÁY TÍNH (1 MÁY = 1 LICENSE KEY - KHÔNG GIỚI HẠN TAB)
  // ==========================================================================
  async checkLicense() {
    let res = null;
    let lastError = null;

    // Cơ chế Thử lại (Retry) tối đa 2 lần với timeout 8000ms để chống chập chờn mạng WiFi/lag
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (typeof window.callBridge === 'function') {
          res = await window.callBridge('status', {}, 8000);
        } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          res = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { action: 'WM_BRIDGE_REQUEST', bridgeAction: 'status', payload: {}, timeoutMs: 8000 },
              (resp) => {
                if (chrome.runtime.lastError) resolve(null);
                else resolve(resp);
              }
            );
          });
        }

        if (res && res.ok) break;
      } catch (err) {
        lastError = err;
      }

      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    const statusData = (res && res.data) ? res.data : res;

    // 1. TRƯỜNG HỢP THÀNH CÔNG: Bản quyền hợp lệ và đang hoạt động
    if (res && res.ok && statusData && statusData.active) {
      this.consecutiveLicenseErrors = 0;
      this.license = {
        valid: true,
        keyMasked: statusData.license_key_masked || '***',
        customer: statusData.customer_name || 'VIP',
        daysLeft: statusData.days_left,
        hoursLeft: statusData.hours_left
      };
      try {
        chrome.storage.local.set({ wm_license_cached: this.license });
      } catch (e) {}
      const alertBanner = document.getElementById('wm-license-alert-banner');
      if (alertBanner) alertBanner.style.display = 'none';
      const startBtn = document.getElementById('wm-start-btn');
      if (startBtn && !this.isRunning) startBtn.disabled = false;
      this.updateLicenseUI();
      return true;
    }

    // 2. TRƯỜNG HỢP BẢN QUYỀN BỊ KHÓA RÕ RÀNG TỪ VPS (401, 403, BLOCKED, EXPIRED, REVOKED)
    const errCode = String((res && res.error) || (statusData && statusData.error) || '').toUpperCase();
    const errMsg = String((statusData && statusData.msg) || (res && res.msg) || (res && res.error) || 'Bản quyền không hợp lệ');
    const isExplicitRevocation = Boolean(
      (res && (res.status === 401 || res.status === 403)) ||
      (statusData && statusData.active === false) ||
      errCode.includes('BLOCKED') || errCode.includes('REVOKED') || errCode.includes('DISABLED') ||
      errCode.includes('EXPIRED') || errCode.includes('MISMATCH') || errCode.includes('SUSPENDED') ||
      errMsg.toLowerCase().includes('khóa') || errMsg.toLowerCase().includes('hết hạn')
    );

    if (isExplicitRevocation) {
      this.consecutiveLicenseErrors = 0;
      this.license = {
        valid: false,
        error: errMsg
      };
      try {
        chrome.storage.local.set({ wm_license_cached: this.license });
      } catch (e) {}
      if (this.isRunning) {
        this.stop();
        this.addLog(`⛔ [BẢN QUYỀN] Máy chủ từ chối bản quyền: ${errMsg}`, 'error');
      }
      this.updateLicenseUI();
      const alertBanner = document.getElementById('wm-license-alert-banner');
      if (alertBanner) {
        alertBanner.style.display = 'block';
        alertBanner.innerText = `⛔ BẢN QUYỀN ĐÃ BỊ THU HỒI HOẶC HẾT HẠN: ${errMsg}`;
      }
      const startBtn = document.getElementById('wm-start-btn');
      if (startBtn) startBtn.disabled = true;
      return false;
    }

    // 3. TRƯỜNG HỢP CHẬP CHỜN ĐƯỜNG TRUYỀN TẠM THỜI (Timeout / Lag mạng / 503, 504)
    if (res?.rate_limited || statusData?.rate_limited) {
      return true;
    }
    this.consecutiveLicenseErrors = (this.consecutiveLicenseErrors || 0) + 1;

    // Nếu máy đã có bản quyền hợp lệ từ trước -> Bỏ qua lỗi lag mạng tạm thời (dưới 3 lần) để bot cược liền mạch
    if (this.license && this.license.valid && this.consecutiveLicenseErrors < 3) {
      this.addLog(`⚠️ [MẠNG] Đường truyền tới máy chủ bị trễ tạm thời (Lần ${this.consecutiveLicenseErrors}/3), bot vẫn duy trì hoạt động...`, 'warning');
      return true;
    }

    // Nếu rớt mạng liên tiếp từ 3 lần trở lên -> Mới dừng bot để đảm bảo an toàn
    this.license = {
      valid: false,
      error: 'Mất kết nối đường truyền tới Local Bridge / Máy chủ'
    };
    if (this.isRunning) {
      this.stop();
      this.addLog('⛔ [BẢN QUYỀN] Mất kết nối đường truyền mạng quá lâu, bot tự động dừng để bảo vệ an toàn!', 'error');
    }
    this.updateLicenseUI();
    return false;
  }

  updateLicenseUI() {
    const badge = document.getElementById('wm-license-badge');
    if (!badge) return;
    if (this.license && this.license.valid) {
      badge.style.background = 'rgba(16, 185, 129, 0.2)';
      badge.style.border = '1px solid #10b981';
      badge.style.color = '#6ee7b7';
      badge.innerText = `🟢 Còn ${this.license.daysLeft} ngày`;
      const maskedKey = this.license.keyMasked || '***';
      badge.title = `Bản quyền máy hợp lệ\nKhách: ${this.license.customer}\nKey: ${maskedKey}\nCòn lại: ${this.license.daysLeft} ngày (${this.license.hoursLeft} giờ)\n(Bấm để kiểm tra lại)`;
    } else {
      badge.style.background = 'rgba(239, 68, 68, 0.2)';
      badge.style.border = '1px solid #ef4444';
      badge.style.color = '#fca5a5';
      const errText = (this.license && this.license.error) ? this.license.error : 'Chưa kích hoạt';
      const isBlocked = errText.toLowerCase().includes('khóa') || errText.toLowerCase().includes('thu hồi') || errText.toLowerCase().includes('disabled');
      badge.innerText = isBlocked ? `🔴 ĐÃ BỊ KHÓA` : `🔴 Chưa kích hoạt`;
      badge.title = `Trạng thái bản quyền: ${errText}\nVui lòng liên hệ Admin để mở khóa hoặc chạy ActivateWM.bat\n(Bấm để thử lại)`;
    }
  }

  loadSettings() {
    try {
      const tabSessionId = sessionStorage.getItem('wm_tab_session_id');
      const getVal = (key) => {
        // Ưu tiên cấu hình riêng của tab hiện tại trong sessionStorage
        if (tabSessionId) {
          const tabVal = sessionStorage.getItem(`${key}_${tabSessionId}`);
          if (tabVal !== null && tabVal !== undefined) return tabVal;
        }
        // Riêng maxTotalBet: không kế thừa mù quáng từ localStorage để tránh kẹt hạn mức trên tab mới
        if (key === 'wm_max_total_bet') return null;
        return localStorage.getItem(key);
      };

      const chip = getVal('wm_chip');
      if (chip) this.selectedChip = parseInt(chip);

      const maxLimit = getVal('wm_max_total_bet');
      if (maxLimit !== null) {
        const val = parseInt(maxLimit);
        this.maxTotalBet = (val === 5000) ? 0 : (isNaN(val) || val < 0 ? 0 : val);
      } else {
        this.maxTotalBet = 0;
      }

      const maxConcurrent = getVal('wm_max_concurrent_bets');
      if (maxConcurrent !== null) {
        const val = parseInt(maxConcurrent);
        this.maxConcurrentBets = isNaN(val) || val < 0 ? 5 : val;
      } else {
        this.maxConcurrentBets = 5;
      }

      const maxTables = getVal('wm_max_tables');
      if (maxTables) {
        const parsed = parseInt(maxTables);
        this.maxTables = isNaN(parsed) ? 50 : Math.max(50, parsed);
      } else {
        this.maxTables = 50;
      }

      const patterns = getVal('wm_patterns');
      if (patterns) this.patterns = JSON.parse(patterns);

      const savedFilter = getVal('wm_ai_filter_mode');
      if (savedFilter && (savedFilter === 'FLASH' || savedFilter === 'LOW' || savedFilter === 'HIGH')) {
        if (this.aiEngine && typeof this.aiEngine.setFilterMode === 'function') {
          this.aiEngine.setFilterMode(savedFilter);
        }
      }
    } catch (e) {}

    // Cập nhật lại giao diện nếu các input đã được khởi tạo
    this.loadSettingsToUI();
  }

  saveSettings() {
    try {
      const tabSessionId = sessionStorage.getItem('wm_tab_session_id');
      const curFilterMode = (this.aiEngine && (this.aiEngine.currentFilterMode || this.aiEngine.filterMode)) || 'LOW';
      if (tabSessionId) {
        sessionStorage.setItem(`wm_chip_${tabSessionId}`, this.selectedChip);
        sessionStorage.setItem(`wm_max_total_bet_${tabSessionId}`, this.maxTotalBet);
        sessionStorage.setItem(`wm_max_concurrent_bets_${tabSessionId}`, this.maxConcurrentBets);
        sessionStorage.setItem(`wm_max_tables_${tabSessionId}`, this.maxTables);
        sessionStorage.setItem(`wm_patterns_${tabSessionId}`, JSON.stringify(this.patterns));
        sessionStorage.setItem(`wm_ai_filter_mode_${tabSessionId}`, curFilterMode);
      }

      localStorage.setItem('wm_chip', this.selectedChip);
      localStorage.setItem('wm_max_total_bet', this.maxTotalBet);
      localStorage.setItem('wm_max_concurrent_bets', this.maxConcurrentBets);
      localStorage.setItem('wm_max_tables', this.maxTables);
      localStorage.setItem('wm_patterns', JSON.stringify(this.patterns));
      localStorage.setItem('wm_ai_filter_mode', curFilterMode);
    } catch (e) {}
  }

  syncSettingsFromUI() {
    try {
      const chipSelect = document.getElementById('wm-chip-select');
      if (chipSelect) this.selectedChip = parseInt(chipSelect.value) || 10;

      const maxTotalBetInput = document.getElementById('wm-max-total-bet');
      if (maxTotalBetInput) {
        const val = parseInt(maxTotalBetInput.value);
        this.maxTotalBet = isNaN(val) || val < 0 ? 0 : val;
      }

      const maxConcurrentInput = document.getElementById('wm-max-concurrent-bets');
      if (maxConcurrentInput) {
        const val = parseInt(maxConcurrentInput.value);
        this.maxConcurrentBets = isNaN(val) || val < 0 ? 5 : val;
      }

      const maxTablesInput = document.getElementById('wm-max-tables');
      if (maxTablesInput) {
        const val = parseInt(maxTablesInput.value);
        this.maxTables = isNaN(val) || val <= 0 ? 50 : val;
      }

      this.saveSettings();
      this.updateLimitProgressUI();
    } catch (e) {}
  }

  trimBetHistoryAndAccumulate(maxKeep = 10) {
    if (!this.cumulativeStats) {
      this.cumulativeStats = {
        totalBets: 0,
        totalAmount: 0,
        bankerBets: 0,
        playerBets: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        totalProfit: 0
      };
    }

    if (this.betHistory.length <= maxKeep) return;

    // Tự động giải phóng các ván cược cũ đã hoàn tất và đã nạp vào AI để giảm tải RAM/DOM tuyệt đối
    while (this.betHistory.length > maxKeep) {
      let pruneIdx = -1;
      for (let i = this.betHistory.length - 1; i >= 0; i--) {
        if (this.betHistory[i].result !== 'PENDING') {
          pruneIdx = i;
          break;
        }
      }
      if (pruneIdx === -1) break;

      const item = this.betHistory.splice(pruneIdx, 1)[0];
      if (item.result !== 'FAILED' && item.success !== false) {
        this.cumulativeStats.totalBets++;
        this.cumulativeStats.totalAmount += (item.amount || 0);
        if (item.bet === 'B') this.cumulativeStats.bankerBets++;
        if (item.bet === 'P') this.cumulativeStats.playerBets++;
        if (item.result === 'WIN') {
          this.cumulativeStats.wins++;
          const profitVal = item.profit !== undefined ? item.profit : item.amount;
          this.cumulativeStats.totalProfit += profitVal;
        } else if (item.result === 'LOSS') {
          this.cumulativeStats.losses++;
          this.cumulativeStats.totalProfit += (item.profit !== undefined ? item.profit : -item.amount);
        } else if (item.result === 'TIE') {
          this.cumulativeStats.ties++;
        }
      }
    }

    this.cumulativeStats.totalProfit = Math.round(this.cumulativeStats.totalProfit * 100) / 100;
  }

  saveBetHistory() {
    try {
      const tabKey = this.getTabStorageKey('wm_bet_history');
      const statsKey = this.getTabStorageKey('wm_cumulative_stats');
      const slice = this.betHistory.slice(0, 10);
      chrome.storage.local.set({
        [tabKey]: slice,
        [statsKey]: this.cumulativeStats
      });
    } catch (e) {}
  }

  recalculateStats() {
    const wasOfficial = Boolean(this.stats && this.stats.isOfficial);
    const savedOfficialWinLoss = this.stats ? this.stats.officialWinLoss : undefined;
    const savedOfficialTotalBet = this.stats ? this.stats.officialTotalBet : undefined;
    const savedOfficialCount = this.stats ? this.stats.officialTotalBetsCount : undefined;
    const savedRealBalance = this.stats ? this.stats.realBalance : undefined;

    if (!this.cumulativeStats) {
      this.cumulativeStats = {
        totalBets: 0,
        totalAmount: 0,
        bankerBets: 0,
        playerBets: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        totalProfit: 0
      };
    }

    this.stats = {
      totalBets: this.cumulativeStats.totalBets || 0,
      totalAmount: this.cumulativeStats.totalAmount || 0,
      bankerBets: this.cumulativeStats.bankerBets || 0,
      playerBets: this.cumulativeStats.playerBets || 0,
      wins: this.cumulativeStats.wins || 0,
      losses: this.cumulativeStats.losses || 0,
      ties: this.cumulativeStats.ties || 0,
      pending: 0,
      winRate: 0,
      totalProfit: this.cumulativeStats.totalProfit || 0
    };

    this.betHistory.forEach(item => {
      // Chỉ tính các lệnh đặt cược thành công vào bàn (bỏ qua lệnh lỗi/không đặt được)
      if (item.result === 'FAILED' || item.success === false) return;

      this.stats.totalBets++;
      this.stats.totalAmount += (item.amount || 0);
      if (item.bet === 'B') this.stats.bankerBets++;
      if (item.bet === 'P') this.stats.playerBets++;

      if (item.result === 'WIN') {
        this.stats.wins++;
        // Tự động chuẩn hóa lại các ván Banker trước đó nếu từng bị làm tròn thành item.amount
        if (item.bet === 'B' && (item.profit === undefined || item.profit === null || item.profit === item.amount)) {
          item.profit = Math.round(item.amount * 0.95 * 100) / 100;
        }
        const profitVal = item.profit !== undefined ? item.profit : item.amount;
        this.stats.totalProfit += profitVal;
      } else if (item.result === 'LOSS') {
        this.stats.losses++;
        this.stats.totalProfit += (item.profit !== undefined ? item.profit : -item.amount);
      } else if (item.result === 'TIE') {
        this.stats.ties++;
      } else if (item.result === 'PENDING') {
        this.stats.pending++;
      }
    });

    this.stats.totalProfit = Math.round(this.stats.totalProfit * 100) / 100;

    const settled = this.stats.wins + this.stats.losses;
    this.stats.winRate = settled > 0 ? Math.round((this.stats.wins / settled) * 100) : 0;

    // Đảm bảo tổng số ván cược luôn tối thiểu bằng tổng các ván đã kết toán (wins + losses + ties)
    const minSettledCount = (this.stats.wins || 0) + (this.stats.losses || 0) + (this.stats.ties || 0);
    if (this.stats.totalBets < minSettledCount) {
      this.stats.totalBets = minSettledCount;
    }

    // Lưu các chỉ số chính thức từ Gateway.php (nếu có) để tham chiếu
    if (wasOfficial && savedOfficialWinLoss !== undefined) {
      this.stats.isOfficial = true;
      this.stats.officialWinLoss = savedOfficialWinLoss;
      this.stats.officialTotalBet = savedOfficialTotalBet;
      this.stats.officialTotalBetsCount = savedOfficialCount;
      if (savedRealBalance !== undefined) this.stats.realBalance = savedRealBalance;
    }

    this.updateLimitProgressUI();
  }

  // ==========================================================================
  // XÂY DỰNG GIAO DIỆN OVERLAY
  // ==========================================================================
  init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.createOverlay());
    } else {
      this.createOverlay();
    }
  }

  createOverlay() {
    if (document.getElementById('wm-auto-helper-overlay')) return;

    // 1. Mini Floating Pill (Thu nhỏ - Siêu gọn & Kéo thả di chuyển)
    const logoUrl = chrome.runtime.getURL('icons/icon48.png');
    this.miniPill = document.createElement('div');
    this.miniPill.id = 'wm-auto-mini-pill';
    this.miniPill.title = 'Bấm để mở Cửa Sổ Rời Độc Lập (Hoặc giữ chuột kéo thả)';
    this.miniPill.innerHTML = `
      <img src="${logoUrl}" style="width:16px; height:16px; border-radius:50%; vertical-align:middle; margin-right:4px; box-shadow:0 0 6px rgba(0,242,254,0.4);" alt="N/A DEV">
      <span class="pill-title">N/A DEV</span>
      <span id="wm-mini-badge"><span class="pill-metric-bets">0 ván</span><span class="pill-metric-sep">|</span><span class="pill-metric-profit" style="color:#94a3b8;">0k</span></span>
      <button id="wm-mini-open-btn" class="pill-popout-icon-btn" title="Mở Cửa Sổ Rời Độc Lập (Chỉ 1 cửa sổ duy nhất)">🪟</button>
      <span id="wm-mini-status-dot"></span>
    `;
    document.body.appendChild(this.miniPill);
    this.createMiniPillActionBubble();
    this.setupMiniPillDragging();

    // 2. Bảng điều khiển chính
    const badgeText = (this.license && this.license.valid)
      ? `🟢 Còn ${this.license.daysLeft} ngày`
      : ((this.license && this.license.error && this.license.error !== 'Đang kiểm tra...') ? `🔴 Chưa kích hoạt` : `🔒 Đang kiểm tra...`);
    const badgeBg = (this.license && this.license.valid) ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
    const badgeBorder = (this.license && this.license.valid) ? '1px solid #10b981' : '1px solid #ef4444';
    const badgeColor = (this.license && this.license.valid) ? '#6ee7b7' : '#fca5a5';

    this.overlay = document.createElement('div');
    this.overlay.id = 'wm-auto-helper-overlay';
    if (this.perfMode === 'LITE') {
      this.overlay.className = 'wm-lite-mode';
    }
    this.overlay.innerHTML = `
      <!-- HEADER -->
      <div id="wm-auto-helper-header">
        <h3 id="wm-auto-helper-title" style="display:flex; align-items:center; gap:8px;">
          <img src="${logoUrl}" style="width:22px; height:22px; border-radius:50%; vertical-align:middle; box-shadow:0 0 8px rgba(0,242,254,0.5); border:1px solid #38bdf8;" alt="N/A DEV">
          <span>N/A DEV</span>
          <span id="wm-license-badge" style="font-size:10px; font-weight:600; padding:2px 8px; border-radius:10px; background:${badgeBg}; border:${badgeBorder}; color:${badgeColor}; margin-left:6px; cursor:pointer;" title="Bấm để kiểm tra lại bản quyền máy">${badgeText}</span>
        </h3>
        <div id="wm-auto-helper-controls">
          <button class="wm-ctrl-btn perf-btn ${this.perfMode === 'LITE' ? 'lite' : ''}" id="wm-btn-perf-mode" title="Chuyển chế độ: FULL (Đầy đủ) / LITE (Siêu mượt, tối ưu CPU/RAM cho 37-50 bàn)">${this.perfMode === 'LITE' ? '⚡ LITE' : '💎 FULL'}</button>
          <button class="wm-ctrl-btn" id="wm-btn-minimize" title="Thu nhỏ">−</button>
          <button class="wm-ctrl-btn close" id="wm-btn-close" title="Đóng">×</button>
        </div>
      </div>

      <!-- CẢNH BÁO BẢN QUYỀN BỊ THU HỒI / HẾT HẠN (TỰ ĐỘNG HIỆN KHI CÓ LỖI) -->
      <div id="wm-license-alert-banner" style="display:none; background:#dc2626; color:#ffffff; padding:9px 12px; font-size:11.5px; font-weight:700; text-align:center; border-radius:6px; margin:6px 10px; box-shadow:0 0 10px rgba(220,38,38,0.5);">
        ⛔ BẢN QUYỀN ĐÃ BỊ THU HỒI HOẶC HẾT HẠN! Toàn bộ tính năng cược đã dừng. Vui lòng liên hệ Admin.
      </div>

      <!-- STATUS TOP BAR -->
      <div class="wm-top-status-bar">
        <div class="wm-status-pill stopped" id="wm-status-pill">
          <span style="font-size:8px;">●</span>
          <span id="wm-status-text">ĐÃ DỪNG</span>
        </div>
        <div class="wm-top-metric">
          Đang nắm: <b id="wm-metric-tables">0</b> bàn
        </div>
        <div class="wm-top-metric">
          Tổng cược: <b id="wm-metric-bets">0</b> (<b id="wm-metric-total-amount" style="color:#00f2fe;">0</b>)
        </div>
        <div class="wm-top-metric">
          Thắng: <b id="wm-metric-wins" style="color:#10b981;">0</b>
        </div>
        <div class="wm-top-metric">
          Lãi: <b id="wm-metric-profit" style="color:#facc15;">0</b>
        </div>
      </div>

      <!-- NAVIGATION TABS -->
      <div class="wm-nav-tabs">
        <button class="wm-tab-btn active" data-tab="settings">⚙️ Cài Đặt</button>
        <button class="wm-tab-btn" data-tab="tables">
          📊 Bàn Chơi <span class="wm-tab-badge" id="wm-tab-badge-tables">0</span>
        </button>
        <button class="wm-tab-btn" data-tab="history">
          📜 Lịch Sử <span class="wm-tab-badge" id="wm-tab-badge-history">0</span>
        </button>
        <button class="wm-tab-btn" data-tab="logs">📝 Nhật Ký</button>
      </div>

      <!-- TAB 1: CÀI ĐẶT -->
      <div class="wm-tab-content active" id="wm-tab-settings" style="display: block !important;">
        <div class="wm-action-row">
          <button class="wm-btn-start" id="wm-start-btn">▶ Bắt Đầu Tự Động Cược</button>
          <button class="wm-btn-stop" id="wm-stop-btn" disabled>⏹ Dừng Lại</button>
          <button type="button" class="wm-refresh-tables-btn" id="wm-btn-diagnostics" style="background:linear-gradient(135deg, #4f46e5, #06b6d4); color:#fff; border:none; padding:6px 12px; font-weight:600; border-radius:6px; cursor:pointer;" title="Chạy báo cáo chẩn đoán đa bàn N/A DEV — MULTI-TABLE DIAGNOSTICS">📋 Chẩn Đoán Đa Bàn</button>
        </div>

        <div class="wm-card">
          <div class="wm-card-title">
            <span>💰 Cấu hình tiền cược & Hạn mức</span>
          </div>
          <div class="wm-form-grid">
            <div class="wm-form-group">
              <label class="wm-label">Mệnh giá Chip:</label>
              <select class="wm-select" id="wm-chip-select">
                <option value="10">Chip 10</option>
                <option value="20">Chip 20</option>
                <option value="50">Chip 50</option>
                <option value="100">Chip 100</option>
                <option value="500">Chip 500</option>
                <option value="1000">Chip 1,000</option>
                <option value="5000">Chip 5,000</option>
              </select>
            </div>
            <div class="wm-form-group">
              <label class="wm-label">Hạn mức tổng cược (Dừng bot):</label>
              <input type="number" class="wm-input" id="wm-max-total-bet" min="0" step="100" value="0" placeholder="0 = Không giới hạn" title="Khi tổng tiền cược đạt mức này, bot sẽ tự động dừng lại (0 = không giới hạn)">
            </div>
            <div class="wm-form-group">
              <label class="wm-label">Số bàn tối đa theo dõi:</label>
              <input type="number" class="wm-input" id="wm-max-tables" min="1" max="50" value="50">
            </div>
            <div class="wm-form-group">
              <label class="wm-label">Tiến độ hạn mức cược:</label>
              <div id="wm-limit-progress-wrap" style="background:#0f121a; border:1px solid #2d384d; border-radius:6px; padding:7px 10px; font-size:11px; display:flex; justify-content:space-between; align-items:center; box-sizing:border-box; height:34px;">
                <span id="wm-limit-progress-text" style="font-weight:600; color:#94a3b8;">0 (Không giới hạn)</span>
                <span id="wm-limit-percent" style="font-weight:bold; color:#38bdf8;">∞</span>
              </div>
            </div>
            <div class="wm-form-group">
              <label class="wm-label">Cược tối đa cùng lúc (lệnh):</label>
              <input type="number" class="wm-input" id="wm-max-concurrent-bets" min="0" max="30" value="5" placeholder="0 = Không giới hạn" title="Số lệnh cược đang chờ kết quả chạy cùng một lúc tối đa (mặc định 5)">
            </div>
            <div class="wm-form-group">
              <label class="wm-label">Đang cược đồng thời:</label>
              <div id="wm-concurrent-status-wrap" style="background:#0f121a; border:1px solid #2d384d; border-radius:6px; padding:7px 10px; font-size:11px; display:flex; justify-content:space-between; align-items:center; box-sizing:border-box; height:34px;">
                <span id="wm-concurrent-status-text" style="font-weight:600; color:#38bdf8;">0 / 5 lệnh</span>
                <span id="wm-concurrent-badge" style="font-weight:bold; color:#10b981;">SẴN SÀNG</span>
              </div>
            </div>
          </div>
        </div>

        <!-- CARD 2: CHIẾN LƯỢC & MÔ HÌNH AI GỌN GÀNG (N/A DEV) -->
        <div class="wm-card wm-ai-card" style="margin-top: 10px;">
          <div class="wm-card-title" style="display:flex; justify-content:space-between; align-items:center;">
            <span>⚡ Chiến lược Mô Hình AI (N/A DEV)</span>
            <span class="wm-ai-mode-pill real" id="wm-ai-mode-badge" style="background:rgba(239,68,68,0.18); border:1px solid #ef4444; color:#f87171; font-weight:700; padding:2px 8px; border-radius:10px; font-size:11px;">CƯỢC THẬT (REAL)</span>
          </div>

          <!-- Chế độ giao dịch: Cược thật 100% tự động cho khách hàng -->
          <div class="wm-ai-mode-bar" id="wm-ai-trading-bar" style="background: rgba(239, 68, 68, 0.08); padding: 7px 12px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.25); display: flex; justify-content: space-between; align-items: center;">
            <span id="wm-ai-trading-mode-label" style="font-size:11.5px; color:#f87171; font-weight:700;">🔴 CHẾ ĐỘ: CƯỢC THẬT (TỰ ĐỘNG VÀO LỆNH)</span>
            <span style="font-size:10.5px; color:#10b981; font-weight:700;">● Tự động 100%</span>
          </div>

          <!-- Chế độ nhạy mô hình AI: Flash (≥3), Low (≥6), High (≥8) -->
          <div class="wm-ai-mode-bar" style="margin-top: 6px; flex-wrap: wrap;">
            <span style="font-size:11px; color:#94a3b8; font-weight:600;">Độ nhạy AI:</span>
            <div class="wm-ai-filter-toggle">
              <button type="button" class="wm-filter-btn active" data-mode="FLASH" title="Flash (≥3): Đánh sớm liên tục, tốc độ suy luận nhanh">⚡ Flash (≥3)</button>
              <button type="button" class="wm-filter-btn" data-mode="LOW" title="Low (≥6): Kiểm tra với nhiều quan sát hơn">🛡️ Low (≥6)</button>
              <button type="button" class="wm-filter-btn" data-mode="HIGH" title="High (≥8): Yêu cầu số mẫu cao hơn">🎯 High (≥8)</button>
            </div>
          </div>

          <!-- Thanh tóm tắt nhanh AI -->
          <div class="wm-ai-quick-summary">
            <span>Cầu: <b id="wm-ai-quick-pattern" style="color:#00f2fe;">Chưa nhận diện</b></span>
            <span>Độ chính xác: <b id="wm-ai-quick-accuracy" style="color:#00ff88;">0.0%</b></span>
            <span>Tổng cược: <b id="wm-ai-quick-rounds">0</b></span>
          </div>

          <!-- NÚT MỞ POPUP CHI TIẾT MÔ HÌNH HỌC SÂU -->
          <button type="button" class="wm-btn-open-ai-popup" id="wm-btn-open-ai-modal">
            <span>🔮</span>
            <span>Mở Chi Tiết Mô Hình AI & Nhật Ký Phân Tích (Popup) ↗</span>
          </button>
        </div>
      </div>

      <!-- TAB 2: THỐNG KÊ BÀN CHƠI (LIVE TABLES) -->
      <div class="wm-tab-content" id="wm-tab-tables" style="display: none !important;">
        <div class="wm-tables-summary-bar">
          <div>
            <span>Đã nắm: <b id="wm-live-count">0</b> bàn</span> | 
            <span>Mở cược: <b id="wm-live-open-count" style="color:#00f2fe;">0</b></span>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button class="wm-refresh-tables-btn" id="wm-btn-toggle-all-view" title="Chuyển chế độ xem: Cuộn ngang 1 hàng hoặc Xem hết 2 hàng">
              ${this.roadViewMode === 'wrap' ? '↔️ Cuộn 1 hàng' : '▦ Xem 2 hàng'}
            </button>
            <button class="wm-refresh-tables-btn" id="wm-btn-force-scroll">🔄 Cuộn Quét Toàn Bàn</button>
          </div>
        </div>

        <div class="wm-tables-grid" id="wm-tables-list">
          <div style="text-align:center; padding:30px 10px; color:#64748b; font-size:12px;">
            Đang quét danh sách bàn chơi...
          </div>
        </div>
      </div>

      <!-- TAB 3: LỊCH SỬ ĐẶT CƯỢC -->
      <div class="wm-tab-content" id="wm-tab-history" style="display: none !important;">
        <div class="wm-history-stats-bar">
          <div class="wm-stat-box">
            <div class="wm-stat-num" id="wm-stat-total-bets">0</div>
            <div class="wm-stat-label">Số lần cược</div>
          </div>
          <div class="wm-stat-box">
            <div class="wm-stat-num" style="color:#00f2fe;" id="wm-stat-total-amount">0</div>
            <div class="wm-stat-label">Tổng tiền cược</div>
          </div>
          <div class="wm-stat-box">
            <div class="wm-stat-num" style="color:#38bdf8;" id="wm-stat-winrate">0%</div>
            <div class="wm-stat-label">Tỷ lệ thắng</div>
          </div>
          <div class="wm-stat-box">
            <div class="wm-stat-num" style="color:#10b981;" id="wm-stat-wins">0</div>
            <div class="wm-stat-label">Thắng (Win)</div>
          </div>
          <div class="wm-stat-box">
            <div class="wm-stat-num" style="color:#ef4444;" id="wm-stat-losses">0</div>
            <div class="wm-stat-label">Thua (Loss)</div>
          </div>
          <div class="wm-stat-box">
            <div class="wm-stat-num" id="wm-stat-profit" style="color:#facc15;">0</div>
            <div class="wm-stat-label">Lợi nhuận (P/L)</div>
          </div>
        </div>

        <div class="wm-history-table-container">
          <table class="wm-history-table">
            <thead>
              <tr>
                <th class="col-time">Giờ</th>
                <th class="col-table">Bàn</th>
                <th class="col-bet">Cửa</th>
                <th class="col-amount">Tiền</th>
                <th class="col-pattern">Cầu khớp</th>
                <th class="col-result">Kết quả</th>
                <th class="col-profit">Lãi / Lỗ</th>
              </tr>
            </thead>
            <tbody id="wm-history-tbody">
              <!-- Render lịch sử cược -->
            </tbody>
            <tfoot id="wm-history-tfoot" style="display:none;">
              <tr style="background:#0f172a; font-weight:800; border-top:2px solid #334155;">
                <td colspan="3" style="color:#94a3b8; font-size:10px;">TỔNG:</td>
                <td id="wm-tfoot-total-amount" class="col-amount" style="color:#00f2fe;">0</td>
                <td class="col-pattern"></td>
                <td id="wm-tfoot-win-loss" class="col-result" style="color:#10b981;">0W - 0L</td>
                <td id="wm-tfoot-profit" class="col-profit" style="color:#facc15;">0</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <button class="wm-clear-history-btn" id="wm-btn-clear-history">🗑️ Xóa Lịch Sử Cược</button>
      </div>

      <!-- TAB 4: NHẬT KÝ -->
      <div class="wm-tab-content" id="wm-tab-logs" style="display: none !important;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="font-size: 12px; font-weight: 700; color: #f1f2f6; display: flex; align-items: center; gap: 6px;">
            <span>📝</span><span>Nhật Ký Hệ Thống (Live Logs)</span>
          </div>
          <button class="wm-clear-log-btn" id="wm-btn-clear-log" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">🗑️ Xóa nhật ký</button>
        </div>
        <div id="wm-auto-helper-log"></div>
      </div>
    `;

    // Đính kèm Popup Modal AI Center vào DOM
    const existingModal = document.getElementById('wm-ai-modal');
    if (existingModal) existingModal.remove();

    this.aiModal = document.createElement('div');
    this.aiModal.id = 'wm-ai-modal';
    this.aiModal.className = 'wm-modal-overlay';
    this.aiModal.style.display = 'none';
    this.aiModal.innerHTML = `
      <div class="wm-modal-content">
        <div class="wm-modal-header">
          <div class="wm-modal-title">
            <span>🧠</span>
            <span>N/A DEV — TRUNG TÂM PHÂN TÍCH SOI CẦU AI PRO</span>
          </div>
          <button type="button" class="wm-modal-close" id="wm-btn-close-ai-modal" title="Đóng">✕</button>
        </div>
        <div class="wm-modal-body">
          <!-- Thống kê AI thời gian thực -->
          <div class="wm-ai-stats-grid">
            <div class="wm-ai-stat-box">
              <div class="wm-ai-stat-val" id="wm-ai-total-rounds">0</div>
              <div class="wm-ai-stat-lbl">Bàn đang quét</div>
            </div>
            <div class="wm-ai-stat-box">
              <div class="wm-ai-stat-val" id="wm-ai-scored">0</div>
              <div class="wm-ai-stat-lbl">Lệnh soi cầu</div>
            </div>
            <div class="wm-ai-stat-box">
              <div class="wm-ai-stat-val" id="wm-ai-accuracy" style="color:#00ff88;">0.0%</div>
              <div class="wm-ai-stat-lbl">Độ chuẩn xác</div>
            </div>
            <div class="wm-ai-stat-box">
              <div class="wm-ai-stat-val" id="wm-ai-net-profit" style="color:#38bdf8;">0</div>
              <div class="wm-ai-stat-lbl">Lợi nhuận (P/L)</div>
            </div>
          </div>

          <!-- Trạng thái học & Tín hiệu thuật toán -->
          <div class="wm-ai-learning-status" style="margin-top: 10px;">
            <div class="wm-ai-status-row">
              <span class="lbl">🧬 Thế cầu nhận diện:</span>
              <span class="val" id="wm-ai-active-pattern" style="color:#00f2fe; font-weight:bold;">Đang quét bàn...</span>
            </div>
            <div class="wm-ai-status-row">
              <span class="lbl">🎯 Tín hiệu thuật toán:</span>
              <span class="val" id="wm-ai-brier-score" style="color:#38bdf8; font-weight:600;">⚡ Tự động lọc điểm vào tối ưu</span>
            </div>
            <div class="wm-ai-status-row">
              <span class="lbl">⚡ Trạng thái đặt cược:</span>
              <span class="val" id="wm-ai-modal-bet-status" style="color:#10b981; font-weight:700;">🟢 CƯỢC THẬT (REAL BET) — Tự động 100%</span>
            </div>
          </div>

          <!-- Bảng dự đoán mới nhất & giải thích lý do -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; margin-bottom:6px;">
            <div style="font-size:11.5px; font-weight:700; color:#f1f2f6; display:flex; align-items:center; gap:6px;">
              <span>📋</span><span>Nhật ký soi cầu thời gian thực:</span>
            </div>
            <button type="button" class="wm-clear-log-btn" id="wm-ai-reset-memory-btn" style="color:#f87171; font-size:10.5px; padding:3px 8px; border-radius:6px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.25); cursor:pointer;">🧹 Làm mới danh sách</button>
          </div>
          <div class="wm-ai-log-table-wrap">
            <table class="wm-table wm-ai-table">
              <thead>
                <tr>
                  <th>Bàn</th>
                  <th>Dự đoán</th>
                  <th>Độ tin cậy</th>
                  <th>Lý do phân tích</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody id="wm-ai-predictions-body">
                <tr>
                  <td colspan="5" style="text-align:center; color:#64748b; padding:14px;">Đang quét dữ liệu đa bàn để phân tích cầu đẹp...</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Footer trạng thái tinh tế -->
          <div class="wm-modal-footer-status">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="wm-live-pulse-dot"></span>
              <span id="wm-ai-bridge-status" style="font-size:11px; font-weight:600; color:#10b981;">Hệ Thống AI N/A DEV: Đang phân tích tối ưu & bảo mật 100%</span>
            </div>
            <span style="font-size:10px; color:#64748b; font-weight:500;">Bản Quyền Đã Kích Hoạt 🟢</span>
          </div>
        </div>
      </div>`;
    document.body.appendChild(this.overlay);
    document.body.appendChild(this.aiModal);

    this.setupEventListeners();
    this.setupOverlayDragging();
    this.loadSettingsToUI();
    this.renderBetHistory();
    this.addLog('⚡ N/A DEV — Baccarat AI Pro đã sẵn sàng! Đang tự động quét bàn...', 'success');

    // MẶC ĐỊNH KHI TẢI TRANG / F5: Luôn thu nhỏ thành Mini Pill gọn gàng (không che khuất màn hình game)
    this.toggleMinimize(true);
    if (this.isHeadlessMode) {
      if (this.miniPill) this.miniPill.style.display = 'none';
      if (this.overlay) this.overlay.style.display = 'none';
    }

    // Luôn cập nhật ngay lập tức trạng thái bản quyền lên badge khi giao diện vừa render xong
    this.updateLicenseUI();
  }

  // ==========================================================================
  // SỰ KIỆN GIAO DIỆN
  // ==========================================================================
  setupEventListeners() {
    // Thu nhỏ / Đóng (cả 2 nút '-' và '×' đều thu gọn về Mini Pill an toàn)
    document.getElementById('wm-btn-minimize').addEventListener('click', () => this.toggleMinimize(true));
    document.getElementById('wm-btn-close').addEventListener('click', () => this.toggleMinimize(true));

    // Nút chuyển chế độ hiệu năng FULL / LITE (Performance Hotfix)
    const perfBtn = document.getElementById('wm-btn-perf-mode');
    if (perfBtn) {
      perfBtn.addEventListener('click', () => {
        this.perfMode = (this.perfMode === 'LITE' ? 'FULL' : 'LITE');
        perfBtn.textContent = this.perfMode === 'LITE' ? '⚡ LITE' : '💎 FULL';
        perfBtn.classList.toggle('lite', this.perfMode === 'LITE');
        if (this.overlay) {
          this.overlay.classList.toggle('wm-lite-mode', this.perfMode === 'LITE');
        }
        try { localStorage.setItem('wm_perf_mode', this.perfMode); } catch (e) {}
        this.addLog(`⚡ Chế độ hiệu năng: ${this.perfMode} (${this.perfMode === 'LITE' ? 'Tối ưu CPU/RAM cho 37-50 bàn' : 'Đầy đủ hiệu ứng'})`, 'info');
      });
    }

    // Bấm vào badge bản quyền để kiểm tra lại
    const licenseBadge = document.getElementById('wm-license-badge');
    if (licenseBadge) {
      licenseBadge.addEventListener('click', () => {
        this.addLog('🔄 Đang kiểm tra lại trạng thái bản quyền máy tính...', 'info');
        this.checkLicense();
      });
    }

    // Lắng nghe sự kiện thu hồi bản quyền thời gian thực từ VPS
    window.addEventListener('WM_LICENSE_REVOKED', (e) => {
      this.addLog(`⛔ BẢN QUYỀN ĐÃ HẾT HẠN HOẶC BỊ KHÓA: ${e.detail}`, 'error');
      if (this.isRunning) {
        this.stop();
        this.addLog(`⛔ [DỪNG BOT] Bản quyền đã bị khóa hoặc hết hạn: ${e.detail || 'Khóa bởi Admin'}`, 'error');
      }
      this.license = { valid: false, error: e.detail };
      try {
        chrome.storage.local.set({ wm_license_cached: this.license });
      } catch (err) {}
      this.updateLicenseUI();
      const alertBanner = document.getElementById('wm-license-alert-banner');
      if (alertBanner) {
        alertBanner.style.display = 'block';
        alertBanner.innerText = `⛔ BẢN QUYỀN ĐÃ BỊ THU HỒI HOẶC HẾT HẠN: ${e.detail || 'Khóa bởi Admin'}`;
      }
      const startBtn = document.getElementById('wm-start-btn');
      if (startBtn) startBtn.disabled = true;
    });

    // Chuyển đổi an toàn giữa Paper Trading và Real Bet
    if (this.aiEngine) {
      this.aiEngine.setTradingMode('REAL');
      this.updateTradingModeUI('REAL');
    }

    // Mở / Đóng Modal Popup AI Center (N/A DEV)
    const openAiModalBtn = document.getElementById('wm-btn-open-ai-modal');
    const closeAiModalBtn = document.getElementById('wm-btn-close-ai-modal');
    const aiModal = document.getElementById('wm-ai-modal');

    if (openAiModalBtn && aiModal) {
      openAiModalBtn.addEventListener('click', () => {
        aiModal.style.display = 'flex';
        aiModal.style.zIndex = '2147483650';
        if (this.aiEngine && typeof this.aiEngine.getStats === 'function') {
          try {
            this.renderAIStats(this.aiEngine.getStats(), this.aiEngine.currentFilterMode, this.aiEngine.bridgeConnected);
          } catch (e) {}
        }
      });
    }

    if (closeAiModalBtn && aiModal) {
      closeAiModalBtn.addEventListener('click', () => {
        aiModal.style.display = 'none';
      });
    }

    if (aiModal) {
      aiModal.addEventListener('click', (e) => {
        if (e.target === aiModal) {
          aiModal.style.display = 'none';
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && aiModal && aiModal.style.display === 'flex') {
        aiModal.style.display = 'none';
      }
    });

    // Chuyển Tab (Bulletproof logic: inline display !important + class active)
    const tabButtons = this.overlay.querySelectorAll('.wm-tab-btn');
    const tabContents = this.overlay.querySelectorAll('.wm-tab-content');

    const switchTab = (targetTab) => {
      if (!targetTab) return;
      this.activeTab = targetTab;
      tabButtons.forEach(b => {
        if (b.getAttribute('data-tab') === targetTab) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
      if (targetTab === 'tables') {
        this.tablesDirty = true;
        this.renderTablesList();
      }

      tabContents.forEach(c => {
        if (c.id === `wm-tab-${targetTab}`) {
          c.classList.add('active');
          c.style.setProperty('display', 'block', 'important');
        } else {
          c.classList.remove('active');
          c.style.setProperty('display', 'none', 'important');
        }
      });
    };
    this.switchTab = switchTab;

    tabButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetTab = btn.getAttribute('data-tab');
        switchTab(targetTab);
      });
    });

    // Form Cài đặt
    const chipSelect = document.getElementById('wm-chip-select');
    chipSelect.addEventListener('change', (e) => {
      if (this.isRunning) return;
      this.selectedChip = parseInt(e.target.value);
      this.saveSettings();
      this.addLog(`Đã chọn Chip: ${this.selectedChip}`, 'info');
      this.selectGameChip(this.selectedChip);
    });

    const maxTotalBetInput = document.getElementById('wm-max-total-bet');
    if (maxTotalBetInput) {
      ['input', 'change'].forEach(evt => {
        maxTotalBetInput.addEventListener(evt, (e) => {
          if (this.isRunning) return;
          const val = parseInt(e.target.value);
          this.maxTotalBet = isNaN(val) || val < 0 ? 0 : val;
          this.saveSettings();
          this.updateLimitProgressUI();
        });
      });
    }

    const maxConcurrentInput = document.getElementById('wm-max-concurrent-bets');
    if (maxConcurrentInput) {
      ['input', 'change'].forEach(evt => {
        maxConcurrentInput.addEventListener(evt, (e) => {
          if (this.isRunning) return;
          const val = parseInt(e.target.value);
          this.maxConcurrentBets = isNaN(val) || val < 0 ? 5 : val;
          this.saveSettings();
          this.updateLimitProgressUI();
        });
      });
    }

    const maxTablesInput = document.getElementById('wm-max-tables');
    if (maxTablesInput) {
      ['input', 'change'].forEach(evt => {
        maxTablesInput.addEventListener(evt, (e) => {
          if (this.isRunning) return;
          this.maxTables = Math.max(1, parseInt(e.target.value) || 10);
          this.saveSettings();
        });
      });
    }

    // Chế độ nhạy mô hình AI (Filter Mode: FLASH, LOW, HIGH)
    const filterBtns = document.querySelectorAll('.wm-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.isRunning) return;
        const mode = btn.getAttribute('data-mode');
        if (this.aiEngine && mode) {
          this.aiEngine.setFilterMode(mode);
          filterBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const label = btn.textContent.trim();
          this.resetBettingLoopSpeed();
          this.saveSettings();
          if (mode === 'FLASH') {
            this.addLog(`⚡ [CHẾ ĐỘ FLASH KÍCH HOẠT] Đã chuyển sang Flash (≥3): Suy luận tốc độ cao, nhịp quét 600ms, vào lệnh liên tục!`, 'success');
          } else {
            this.addLog(`🎯 Đã đổi chế độ mô hình AI sang: ${label}`, 'info');
          }
        }
      });
    });

    // Xuất báo cáo thống kê phiên Cloud AI thành file JSON (không lộ weights/brain)
    const exportAiBtn = document.getElementById('wm-ai-export-btn');
    if (exportAiBtn) {
      exportAiBtn.addEventListener('click', () => {
        if (!this.aiEngine) return;
        const baseKnowledge = typeof this.aiEngine.exportKnowledge === 'function'
          ? this.aiEngine.exportKnowledge()
          : {};
        const reportData = {
          ...baseKnowledge,
          exportedAt: new Date().toISOString(),
          stats: this.aiEngine.stats || {},
          recentPredictions: this.recentPredictionsLog || []
        };
        const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wm_cloud_ai_report_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.addLog('📤 Đã xuất báo cáo thống kê phiên Cloud AI thành công!', 'success');
      });
    }

    // Đồng bộ trạng thái kết nối Cloud AI VPS
    const importAiBtn = document.getElementById('wm-ai-import-btn');
    if (importAiBtn) {
      importAiBtn.addEventListener('click', async () => {
        this.addLog('🔄 Đang đồng bộ trạng thái bản quyền & kết nối Cloud AI VPS...', 'info');
        const valid = await this.checkLicense();
        if (this.aiEngine) {
          if (typeof this.aiEngine.syncCloudState === 'function') {
            await this.aiEngine.syncCloudState();
          }
          this.renderAIStats(
            this.aiEngine.stats,
            this.aiEngine.tradingMode,
            this.aiEngine.isCloudHealthy ? this.aiEngine.isCloudHealthy() : this.aiEngine.bridgeConnected
          );
        }
        if (valid) {
          this.addLog('🟢 Đồng bộ Cloud AI VPS thành công!', 'success');
        } else {
          this.addLog('⚠️ Chưa kết nối được Cloud AI VPS hoặc máy chưa kích hoạt bản quyền.', 'warning');
        }
      });
    }

    // Xóa nhật ký dự đoán cục bộ (bảo toàn Master Brain trên VPS Cloud)
    const resetAiBtn = document.getElementById('wm-ai-reset-memory-btn');
    if (resetAiBtn) {
      resetAiBtn.addEventListener('click', async () => {
        if (confirm('Bạn có chắc chắn muốn làm mới nhật ký dự đoán cục bộ? (Master Brain trên VPS Cloud vẫn được bảo toàn)')) {
          if (this.aiEngine && typeof this.aiEngine.resetMemory === 'function') {
            await this.aiEngine.resetMemory();
          }
          this.recentPredictionsLog = [];
          this.updateAILogTable();
          if (this.aiEngine) {
            this.renderAIStats(
              this.aiEngine.stats,
              this.aiEngine.tradingMode,
              this.aiEngine.isCloudHealthy ? this.aiEngine.isCloudHealthy() : this.aiEngine.bridgeConnected
            );
          }
          this.addLog('🧹 Đã làm mới nhật ký dự đoán cục bộ (Master Brain trên VPS Cloud được bảo toàn).', 'info');
        }
      });
    }

    // Kết nối sự kiện cập nhật thống kê AI
    if (this.aiEngine) {
      this.aiEngine.onStatsChange = (stats, mode, bridgeConnected) => {
        this.renderAIStats(stats, mode, bridgeConnected);
      };
      this.renderAIStats(this.aiEngine.stats, this.aiEngine.currentFilterMode, this.aiEngine.bridgeConnected);
      if (this.aiEngine.isReadyPromise) {
        this.aiEngine.isReadyPromise.then(() => {
          this.renderAIStats(this.aiEngine.stats, this.aiEngine.currentFilterMode, this.aiEngine.bridgeConnected);
        });
      }
    }

    // Nút Bắt đầu / Dừng
    document.getElementById('wm-start-btn').addEventListener('click', () => this.start());
    document.getElementById('wm-stop-btn').addEventListener('click', () => this.stop());

    // Nút Cuộn quét toàn bàn
    document.getElementById('wm-btn-force-scroll').addEventListener('click', () => {
      this.forceScrollAllTables();
    });

    // Nút Chẩn đoán đa bàn N/A DEV — MULTI-TABLE DIAGNOSTICS
    const diagBtn = document.getElementById('wm-btn-diagnostics');
    if (diagBtn) {
      diagBtn.addEventListener('click', () => {
        const diag = this.generateMultiTableDiagnostics();
        console.log(diag.text);
        this.addLog(diag.text, 'info');
      });
    }

    // Nút chuyển chế độ xem tất cả các bàn (1 Hàng cuộn / 2 Hàng xem hết)
    const toggleAllBtn = document.getElementById('wm-btn-toggle-all-view');
    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', () => {
        this.roadViewMode = this.roadViewMode === 'wrap' ? 'scroll' : 'wrap';
        localStorage.setItem('wm_road_view_mode', this.roadViewMode);
        toggleAllBtn.textContent = this.roadViewMode === 'wrap' ? '↔️ Cuộn 1 hàng' : '▦ Xem 2 hàng';

        // Cập nhật tất cả các card hiện tại
        const allDots = document.querySelectorAll('#wm-tables-list .wm-road-dots');
        allDots.forEach(dotsEl => {
          if (this.roadViewMode === 'wrap') {
            dotsEl.classList.add('wm-wrap-mode');
          } else {
            dotsEl.classList.remove('wm-wrap-mode');
            dotsEl.scrollLeft = dotsEl.scrollWidth;
          }
        });

        // Cập nhật text trên các nút con
        const allModeBtns = document.querySelectorAll('#wm-tables-list .wm-road-mode-btn');
        allModeBtns.forEach(btn => {
          btn.textContent = this.roadViewMode === 'wrap' ? '↔️ Cuộn' : '▦ 2 Hàng';
        });
      });
    }

    // Xóa lịch sử / log
    document.getElementById('wm-btn-clear-history').addEventListener('click', () => {
      this.betHistory = [];
      this.cumulativeStats = {
        totalBets: 0,
        totalAmount: 0,
        bankerBets: 0,
        playerBets: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        totalProfit: 0
      };
      this.recalculateStats();
      try {
        const tabKey = this.getTabStorageKey('wm_bet_history');
        const statsKey = this.getTabStorageKey('wm_cumulative_stats');
        chrome.storage.local.remove([tabKey, statsKey]);
      } catch (e) {}
      this.saveBetHistory();
      this.renderBetHistory();
      this.addLog('Đã xóa toàn bộ lịch sử cược và giải phóng bộ nhớ của tab này!', 'info');
    });

    document.getElementById('wm-btn-clear-log').addEventListener('click', () => {
      document.getElementById('wm-auto-helper-log').innerHTML = '';
    });
  }

  loadSettingsToUI() {
    try {
      const chipSelect = document.getElementById('wm-chip-select');
      if (chipSelect) chipSelect.value = String(this.selectedChip);

      const maxTotalBetInput = document.getElementById('wm-max-total-bet');
      if (maxTotalBetInput) maxTotalBetInput.value = String(this.maxTotalBet);

      const maxConcurrentInput = document.getElementById('wm-max-concurrent-bets');
      if (maxConcurrentInput) maxConcurrentInput.value = String(this.maxConcurrentBets);

      const maxTablesInput = document.getElementById('wm-max-tables');
      if (maxTablesInput) maxTablesInput.value = String(this.maxTables);

      const patternsInput = document.getElementById('wm-patterns-input');
      if (patternsInput && this.patterns.length > 0) {
        patternsInput.value = this.patterns.map(p => `${p.condition}=${p.bet}`).join('\n');
      }

      // Khôi phục chính xác chế độ nhạy AI (Mặc định TIÊU CHUẨN LOW nếu chưa chọn)
      const tabSessionId = sessionStorage.getItem('wm_tab_session_id');
      let activeMode = (this.aiEngine && this.aiEngine.currentFilterMode) || 'LOW';
      try {
        const saved = (tabSessionId && sessionStorage.getItem(`wm_ai_filter_mode_${tabSessionId}`)) || localStorage.getItem('wm_ai_filter_mode');
        if (saved === 'FLASH' || saved === 'LOW' || saved === 'HIGH') activeMode = saved;
      } catch (e) {}
      if (this.aiEngine && typeof this.aiEngine.setFilterMode === 'function') {
        this.aiEngine.setFilterMode(activeMode);
      }
      const filterBtns = document.querySelectorAll('.wm-filter-btn');
      filterBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-mode') === activeMode);
      });

      this.updateLimitProgressUI();
      this.setControlsLocked(this.isRunning);
    } catch (e) {}
  }

  toggleMinimize(minimize) {
    this.isOverlayMinimized = !!minimize;
    if (minimize) {
      this.overlay.style.display = 'none';
      this.miniPill.style.display = 'flex';
      this.updateMiniPill();
      try { localStorage.setItem('wm_overlay_minimized', 'true'); } catch (e) {}
    } else {
      this.overlay.style.display = 'flex';
      this.miniPill.style.display = 'none';
      try { localStorage.setItem('wm_overlay_minimized', 'false'); } catch (e) {}
      if (this.activeTab === 'tables') {
        this.tablesDirty = true;
        this.renderTablesList();
      }
    }
  }

  formatCompactMoney(val, withPlusSign = false) {
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

  updateMiniPill() {
    if (!this.miniPill) return;
    const badge = document.getElementById('wm-mini-badge');
    const dot = document.getElementById('wm-mini-status-dot');
    if (badge) {
      const totalBets = (this.stats && this.stats.totalBets) || 0;
      const p = (this.stats && this.stats.totalProfit) || 0;
      const pFormatted = this.formatCompactMoney(p, true);
      const pColor = p > 0 ? '#10b981' : (p < 0 ? '#ef4444' : '#94a3b8');

      const isOfficial = Boolean(this.stats && this.stats.isOfficial);
      const officialIcon = isOfficial ? '<span style="color:#10b981; font-weight:800; font-size:9.5px; margin-left:2px;" title="Số liệu đã đối soát chuẩn 100% từ máy chủ WM Casino (Gateway.php)">✓</span>' : '';
      badge.innerHTML = `<span class="pill-metric-bets">${totalBets} ván</span><span class="pill-metric-sep">|</span><span class="pill-metric-profit" style="color:${pColor};">${pFormatted}${officialIcon}</span>`;
    }
    if (dot) {
      dot.style.background = this.isRunning ? '#10b981' : '#ef4444';
      dot.title = this.isRunning ? 'Đang chạy auto cược' : 'Đang tạm dừng cược';
    }
  }

  // ==========================================================================
  // KÉO THẢ DI CHUYỂN VIÊN PIN (MINI PILL DRAG & CLICK)
  // ==========================================================================
  setupMiniPillDragging() {
    let isPointerDown = false;
    let hasMoved = false;
    let startX = 0, startY = 0;
    let initialX = 0, initialY = 0;
    const DRAG_THRESHOLD = 8; // Ngưỡng 8px chuẩn chống rung tay khi nhấp chuột

    // Nạp vị trí đã lưu trước đó nếu có
    const savedPos = localStorage.getItem('wm_mini_pill_pos');
    if (savedPos) {
      try {
        const { x, y } = JSON.parse(savedPos);
        const maxW = Math.max(10, window.innerWidth - 60);
        const maxH = Math.max(10, window.innerHeight - 30);
        if (x >= 0 && x <= maxW && y >= 0 && y <= maxH) {
          this.miniPill.style.left = `${x}px`;
          this.miniPill.style.top = `${y}px`;
          this.miniPill.style.right = 'auto';
        }
      } catch (e) {}
    }

    const onStart = (e) => {
      // Bấm vào nút mở trên bubble thì không kích hoạt kéo thả
      if (e.target && e.target.closest('#wm-btn-launch-popout')) return;
      if (e.button && e.button !== 0) return; // Chỉ nhận chuột trái

      isPointerDown = true;
      hasMoved = false;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      startX = clientX;
      startY = clientY;

      const rect = this.miniPill.getBoundingClientRect();
      initialX = clientX - rect.left;
      initialY = clientY - rect.top;
    };

    const onMove = (e) => {
      if (!isPointerDown) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const dist = Math.hypot(clientX - startX, clientY - startY);
      if (dist > DRAG_THRESHOLD) {
        hasMoved = true;
        document.body.classList.add('wm-dragging-active');
        this.miniPill.style.cursor = 'grabbing';
        this.miniPill.style.transition = 'none';

        // Ẩn bubble khi đang kéo để không vướng màn hình
        const bubble = document.getElementById('wm-mini-action-bubble');
        if (bubble) bubble.style.display = 'none';

        if (e.cancelable) e.preventDefault();
        let newX = clientX - initialX;
        let newY = clientY - initialY;

        // Giới hạn trong màn hình
        const maxW = Math.max(4, window.innerWidth - this.miniPill.offsetWidth - 4);
        const maxH = Math.max(4, window.innerHeight - this.miniPill.offsetHeight - 4);
        newX = Math.max(4, Math.min(maxW, newX));
        newY = Math.max(4, Math.min(maxH, newY));

        this.miniPill.style.left = `${newX}px`;
        this.miniPill.style.top = `${newY}px`;
        this.miniPill.style.right = 'auto';
      }
    };

    const onEnd = () => {
      if (!isPointerDown) return;
      isPointerDown = false;
      document.body.classList.remove('wm-dragging-active');
      this.miniPill.style.cursor = 'pointer';
      this.miniPill.style.transition = 'transform 0.15s ease, box-shadow 0.2s ease';

      if (hasMoved) {
        try {
          const rect = this.miniPill.getBoundingClientRect();
          localStorage.setItem('wm_mini_pill_pos', JSON.stringify({ x: rect.left, y: rect.top }));
        } catch (e) {}
      }
    };

    // Sự kiện Chuột
    this.miniPill.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('blur', onEnd);

    // Sự kiện Cảm ứng (Touch / Mobile mode)
    this.miniPill.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);

    // Xử lý Click thống nhất trên viên pin
    this.miniPill.addEventListener('click', (e) => {
      // Nếu vừa thực hiện thao tác kéo thả thì hủy bỏ sự kiện click
      if (hasMoved) {
        e.stopPropagation();
        e.preventDefault();
        hasMoved = false;
        return;
      }

      // 1. Nếu click trực tiếp vào nút biểu tượng 🪟 hoặc nút trong bubble -> Mở/Focus cửa sổ ngay
      if (e.target.closest('#wm-mini-open-btn') || e.target.closest('#wm-btn-launch-popout')) {
        e.stopPropagation();
        this.openPopoutWindow();
        return;
      }

      // 2. Nếu click vào thân viên pin (N/A DEV hoặc 50 ván | +32k) -> Bật/tắt bong bóng nút "🪟 Mở Cửa Sổ Rời"
      e.stopPropagation();
      this.toggleMiniPillActionBubble();
    });

    // Tự động đóng nếu click ngoài
    document.addEventListener('click', (e) => {
      const bubble = document.getElementById('wm-mini-action-bubble');
      if (bubble && bubble.style.display !== 'none') {
        if (!this.miniPill?.contains(e.target)) {
          bubble.style.display = 'none';
        }
      }
    });
  }

  // Tạo bong bóng nút bấm mở Cửa Sổ Rời (Gắn trực tiếp vào Mini-Pill để đi theo chuẩn xác)
  createMiniPillActionBubble() {
    if (document.getElementById('wm-mini-action-bubble')) return;
    if (!this.miniPill) return;

    const bubble = document.createElement('div');
    bubble.id = 'wm-mini-action-bubble';
    bubble.className = 'wm-mini-action-bubble';
    bubble.style.display = 'none';
    bubble.innerHTML = `
      <button id="wm-btn-launch-popout" class="wm-launch-popout-btn" title="Mở bảng điều khiển rời độc lập (Chỉ 1 cửa sổ duy nhất)">
        <span>🪟 Mở Cửa Sổ Rời</span>
      </button>
    `;
    this.miniPill.appendChild(bubble);
  }

  toggleMiniPillActionBubble() {
    let bubble = document.getElementById('wm-mini-action-bubble');
    if (!bubble) {
      this.createMiniPillActionBubble();
      bubble = document.getElementById('wm-mini-action-bubble');
    }
    if (!bubble || !this.miniPill) return;

    if (bubble.style.display === 'flex' || bubble.style.display === 'block') {
      bubble.style.display = 'none';
      return;
    }

    // Tự động căn chỉnh hướng hiển thị dựa theo cạnh màn hình
    const rect = this.miniPill.getBoundingClientRect();
    bubble.classList.remove('bubble-above', 'align-left', 'align-right');

    if (rect.bottom + 55 > window.innerHeight) {
      bubble.classList.add('bubble-above');
    }
    if (rect.left < 75) {
      bubble.classList.add('align-left');
    } else if (window.innerWidth - rect.right < 75) {
      bubble.classList.add('align-right');
    }

    bubble.style.display = 'flex';

    if (this._miniBubbleTimeout) clearTimeout(this._miniBubbleTimeout);
    this._miniBubbleTimeout = setTimeout(() => {
      if (bubble) bubble.style.display = 'none';
    }, 5000);
  }

  openPopoutWindow() {
    const bubble = document.getElementById('wm-mini-action-bubble');
    if (bubble) bubble.style.display = 'none';

    // Hiệu ứng phản hồi xúc giác nhẹ trên viên pin khi click
    if (this.miniPill) {
      this.miniPill.style.transform = 'scale(0.95)';
      setTimeout(() => {
        if (this.miniPill) this.miniPill.style.transform = '';
      }, 150);
    }

    try {
      chrome.runtime.sendMessage({ action: 'WM_OPEN_POPOUT' }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('[WM] openPopoutWindow sendMessage lastError:', chrome.runtime.lastError.message);
        }
      });
    } catch (e) {
      console.error('[WM] Lỗi gửi lệnh WM_OPEN_POPOUT:', e);
    }
  }

  // ==========================================================================
  // KÉO THẢ DI CHUYỂN BẢNG ĐIỀU KHIỂN CHÍNH (OVERLAY DRAG MƯỢT MÀ, NHỚ VỊ TRÍ)
  // ==========================================================================
  setupOverlayDragging() {
    const header = document.getElementById('wm-auto-helper-header');
    if (!header || !this.overlay) return;

    let isDragging = false;
    let shiftX = 0, shiftY = 0;
    let currentX = 0, currentY = 0;

    // Nạp vị trí đã lưu của bảng điều khiển nếu có
    const savedPos = localStorage.getItem('wm_overlay_pos');
    if (savedPos) {
      try {
        const { x, y } = JSON.parse(savedPos);
        const maxW = Math.max(10, window.innerWidth - 100);
        const maxH = Math.max(10, window.innerHeight - 50);
        if (x >= 0 && x <= maxW && y >= 0 && y <= maxH) {
          this.overlay.style.left = `${x}px`;
          this.overlay.style.top = `${y}px`;
          this.overlay.style.right = 'auto';
          this.overlay.style.bottom = 'auto';
          this.overlay.style.transform = 'none';
          currentX = x;
          currentY = y;
        }
      } catch (e) {}
    }

    const onStart = (e) => {
      // Không kéo nếu click vào nút bấm (thu nhỏ, đóng)
      if (e.target.closest('button') || e.target.closest('.wm-ctrl-btn')) return;

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const rect = this.overlay.getBoundingClientRect();
      shiftX = clientX - rect.left;
      shiftY = clientY - rect.top;

      isDragging = true;
      document.body.classList.add('wm-dragging-active');
      header.style.cursor = 'grabbing';
      this.overlay.style.transition = 'none';
    };

    const onMove = (e) => {
      if (!isDragging) return;
      if (e.cancelable) e.preventDefault();

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      let newX = clientX - shiftX;
      let newY = clientY - shiftY;

      // Giới hạn trong màn hình
      const maxW = window.innerWidth - this.overlay.offsetWidth - 4;
      const maxH = window.innerHeight - this.overlay.offsetHeight - 4;
      newX = Math.max(4, Math.min(maxW, newX));
      newY = Math.max(4, Math.min(maxH, newY));

      this.overlay.style.left = `${newX}px`;
      this.overlay.style.top = `${newY}px`;
      this.overlay.style.right = 'auto';
      this.overlay.style.bottom = 'auto';
      this.overlay.style.transform = 'none';
      currentX = newX;
      currentY = newY;
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.classList.remove('wm-dragging-active');
      header.style.cursor = 'grab';
      this.overlay.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';

      // Lưu vị trí vào localStorage
      if (currentX > 0 || currentY > 0) {
        try {
          localStorage.setItem('wm_overlay_pos', JSON.stringify({ x: currentX, y: currentY }));
        } catch (e) {}
      }
    };

    // Sự kiện Chuột
    header.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('blur', onEnd);

    // Sự kiện Cảm ứng (Touch / Mobile mode)
    header.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  }

  close() {
    if (this.isRunning) this.stop();
    if (this.overlay) this.overlay.remove();
    if (this.miniPill) this.miniPill.remove();
    if (this.aiModal) this.aiModal.remove();
  }

  parsePatterns() {
    return true;
  }

  updateStatus(statusText, type = 'stopped') {
    const pill = document.getElementById('wm-status-pill');
    const text = document.getElementById('wm-status-text');
    if (pill) pill.className = `wm-status-pill ${type}`;
    if (text) text.textContent = statusText;
    this.updateMiniPill();
  }

  addLog(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('vi-VN');
    const entryData = { time, msg, type };
    if (!this.fullLogsHistory) this.fullLogsHistory = [];
    this.fullLogsHistory.push(entryData);
    if (this.fullLogsHistory.length > 60) {
      this.fullLogsHistory.shift();
    }

    const container = document.getElementById('wm-auto-helper-log');
    if (!container) return;

    const entry = document.createElement('div');
    entry.className = `wm-log-entry ${type}`;
    entry.textContent = `[${time}] ${msg}`;

    container.appendChild(entry);
    while (container.children.length > 50) {
      container.removeChild(container.firstChild);
    }
    container.scrollTop = container.scrollHeight;
  }

  // ==========================================================================
  // THUẬT TOÁN QUÉT BÀN ĐA NĂNG (UNIVERSAL TABLE SCANNER) - PHIÊN BẢN TỐI ƯU SIÊU TỐC
  // Quét cả Document chính và bất kỳ Iframe nào, nhận diện mọi bàn H5 & PC
  // Đồng bộ thuật toán quét nhẹ, mượt, không lag từ bản chuẩn
    // ==========================================================================
  // THUẬT TOÁN QUÉT BÀN ĐA NĂNG (UNIVERSAL TABLE SCANNER) - CONTAINER-FIRST SIÊU TỐC
  // Quét cả Document chính và Iframe, nhận diện mọi bàn H5 & PC (0% CPU, <0.2ms)
  // ==========================================================================
  startBackgroundScanner() {
    this.scanAllTables();

    if (this.scanInterval) clearInterval(this.scanInterval);
    this.scanInterval = setInterval(() => {
      this.scanAllTables();
    }, 1500);
  }

  // ==========================================================================
  // HỆ THỐNG CHỐNG NGỦ ĐÔNG & CHỐNG BÓP XUNG NHỊP TAB NỀN (ANTI-SLEEP ENGINE)
  // ==========================================================================
  initAntiSleep() {
    if (this._antiSleepStarted) return;
    this._antiSleepStarted = true;

    // 1. Web Audio Keep-Alive: Phát luồng âm thanh im lặng (Silent Buffer)
    // Giúp Chrome luôn coi tab này là "Media Playing" -> Miễn nhiễm 100% việc bóp xung nhịp timer và Tab Discarding
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
        const buffer = this.audioCtx.createBuffer(1, 22050, 22050); // 1s buffer im lặng
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const gainNode = this.audioCtx.createGain();
        gainNode.gain.value = 0.00001; // Cực nhỏ, không phát ra tiếng ồn

        source.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);
        source.start(0);

        const resumeCtx = () => {
          if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
          }
        };
        window.addEventListener('click', resumeCtx, { once: true });
        window.addEventListener('keydown', resumeCtx, { once: true });
        console.log('[WM AntiSleep] AudioContext Keep-Alive đã kích hoạt');
      }
    } catch (e) {
      console.warn('[WM AntiSleep] AudioContext:', e);
    }

    // 2. Dedicated Web Worker Ticker (Chạy ở luồng OS riêng biệt, không bị Chrome bóp nhịp khi chạy nền)
    try {
      const workerCode = `
        setInterval(() => {
          postMessage('TICK');
        }, 1000);
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.tickerWorker = new Worker(workerUrl);
      this.tickerWorker.onmessage = () => {
        // Đối soát kết quả cược theo nguyên tắc đặt thành công & đoán trúng mỗi giây
        this.checkPendingBetResults();
        // Nhịp tim đảm bảo bot luôn quét ván và cược đúng giờ ngay cả khi tab game bị thu nhỏ
        if (this.isRunning && !this.isEvaluatingAllTables) {
          this.evaluateAllTablesForBetting();
        }
      };
      console.log('[WM AntiSleep] Worker Ticker đã kích hoạt');
    } catch (e) {
      console.warn('[WM AntiSleep] Worker:', e);
    }
  }

  isGameLoading() {
    try {
      if (document.querySelector('.gameroom-box, [id^="groupMultiple_"], [id^="box_pc_"], [class*="gameroom"], .gameroom-list')) {
        return false;
      }
      const bodyText = document.body ? (document.body.textContent || '') : '';
      if (/Loading\s*\.{2,3}\s*\d{1,3}%/i.test(bodyText) || /WMCASINO\s+BRAND\s+NEW\s+UPGRADE/i.test(bodyText)) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  scanAllTables() {
    const allFound = [];

    // 1. Quét trong Document hiện tại (nếu sảnh mở trực tiếp ngoài top document)
    try {
      const mainTables = this.findTablesInDocument(document);
      if (mainTables.length > 0) {
        allFound.push(...mainTables);
      }
    } catch (e) {}

    // 2. Với Iframe: Bắn tín hiệu GET_TABLES tới TẤT CẢ các frame (kể cả frame lồng nhau và window.frames)
    const targetWindows = this.getAllTargetWindows();
    targetWindows.forEach((win) => {
      try {
        win.postMessage({
          action: 'GET_TABLES',
          messageId: ++this.messageIdCounter
        }, '*');
      } catch (e) {}
    });

    // Dọn dẹp bất kỳ bàn phantom nào còn sót trong tablesMap (loại bỏ 100% bàn ảo 1415 và thẻ con)
    for (const [key, t] of this.tablesMap.entries()) {
      const rawId = t?.id || '';
      const name = t?.name || '';
      if (!isStrictTableId(rawId) || !isStrictTableId(key) || key === 'wm_invalid_table' || rawId === 'wm_invalid_table') {
        this.tablesMap.delete(key);
        continue;
      }
      const combined = `${key} ${rawId} ${name}`;
      if (combined.includes('1415') || combined.includes('invalid')) {
        this.tablesMap.delete(key);
        continue;
      }
      const m = combined.match(/_bac_(\d+)/i) || combined.match(/bac_?(\d+)/i);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > 60 && num < 100) {
          this.tablesMap.delete(key);
        }
      }
    }

    const isValidTableItem = (item) => {
      if (!item || !item.id) return false;
      const combined = `${item.id} ${item.name || ''}`;
      if (combined.includes('1415') || combined.includes('invalid')) return false;
      return isStrictTableId(item.id);
    };

    // 3. Cập nhật vào tablesMap theo canonicalId chuẩn duy nhất
    if (allFound.length > 0) {
      allFound.forEach(t => {
        if (!isValidTableItem(t)) return;
        const canonicalId = (window.WMBaccaratAIEngine && typeof window.WMBaccaratAIEngine.canonicalizeTableId === 'function')
          ? window.WMBaccaratAIEngine.canonicalizeTableId(t.id, t.name)
          : t.id;
        if (!canonicalId || canonicalId === 'wm_invalid_table' || !isStrictTableId(canonicalId)) return;
        t.canonicalId = canonicalId;
        t.rawId = t.id;

        const existing = this.tablesMap.get(canonicalId) || this.tablesMap.get(t.id);
        if (existing) {
          existing.inDom = true;
          existing.lastSeenInDom = Date.now();
          const oldHist = existing.history || [];
          const newHist = t.history || [];
          if (newHist.length > oldHist.length) {
            for (let i = oldHist.length; i < newHist.length; i++) {
              const prev = newHist.slice(0, i);
              const outcome = newHist[i];
              if (this.aiEngine) {
                this.aiEngine.onRoundCompleted(canonicalId, t.name || existing.name || canonicalId, prev, outcome);
              }
            }
            const recentLog = this.recentPredictionsLog.find(p => (p.tableId === canonicalId || p.tableId === t.id) && p.status === 'PENDING');
            if (recentLog) {
              const newOutcome = newHist[newHist.length - 1];
              recentLog.actualOutcome = newOutcome;
              if (newOutcome === 'T') {
                recentLog.status = 'TIE_PUSH';
              } else if (recentLog.predicted === newOutcome) {
                recentLog.status = 'WIN';
              } else {
                recentLog.status = 'LOSS';
              }
              this.updateAILogTable();
            }
          }
          existing.name = t.name || existing.name;
          existing.canonicalId = canonicalId;
          existing.rawId = t.id || existing.rawId;
          if (t.shoe && t.shoe !== '0') existing.shoe = t.shoe;
          if (t.round && t.round > 0) existing.round = t.round;
          existing.betTime = (t.betTime !== undefined && t.betTime !== null) ? t.betTime : existing.betTime;
          if (t.history && t.history.length > 0) existing.history = t.history;
          existing.cardNode = t.cardNode || existing.cardNode;
          existing.playerBtn = t.playerBtn || existing.playerBtn;
          existing.bankerBtn = t.bankerBtn || existing.bankerBtn;

          this.tablesMap.set(canonicalId, existing);
          if (t.id && t.id !== canonicalId && this.tablesMap.has(t.id)) {
            this.tablesMap.delete(t.id);
          }
          if (existing.id && existing.id !== canonicalId && this.tablesMap.has(existing.id)) {
            this.tablesMap.delete(existing.id);
          }
        } else {
          this.tablesMap.set(canonicalId, t);
          this.addLog(`✨ Đã phát hiện bàn mới: ${t.name || canonicalId}`, 'info');
        }
      });
    }

    this.checkPendingBetResults();
    this.updateTableMetricsUI();
  }

  // Trích xuất tên bàn thân thiện (dịch từ ID hoặc đọc DOM cực nhanh bằng textContent)
  extractTableName(box, id) {
    const rawId = (id || (box && box.id) || '').trim();

    // 1. NẾU CÓ ID CHUẨN (groupMultiple hoặc box_pc): ƯU TIÊN TUYỆT ĐỐI VÌ ĐÂY LÀ ĐỊNH DANH 100% CHÍNH XÁC CỦA GAME
    if (rawId) {
      if (rawId.includes('1415') || rawId.includes('invalid')) return null;

      const sexyMatch = rawId.match(/_sexy_bac_(\d+)/i);
      if (sexyMatch) {
        let num = parseInt(sexyMatch[1], 10);
        return `(Sexy)Bac ${num}`;
      }
      const classicMatch = rawId.match(/_classic_bac_(\d+)/i);
      if (classicMatch) return `(Classic)Bac ${classicMatch[1]}`;
      const speedMatch = rawId.match(/_speed_bac_(\d+)/i);
      if (speedMatch) return `(Speed)Bac ${speedMatch[1]}`;
      const miMatch = rawId.match(/_mi_bac_(\d+)/i);
      if (miMatch) return `(Mi)Bac ${miMatch[1]}`;
      const specialMatch = rawId.match(/_special_bac_(\d+)/i);
      if (specialMatch) return `(Special)Bac ${specialMatch[1]}`;

      const idMatch = rawId.match(/groupMultiple_(\d+)_(\d+)/i) || rawId.match(/box_pc_(\d+)/i) || rawId.match(/_(\d{1,4})$/);
      if (idMatch) {
        const tableNum = parseInt(idMatch[2] || idMatch[1], 10);
        if (tableNum >= 501 && tableNum <= 599) return `(Sexy)Bac ${tableNum - 500}`;
        if (tableNum >= 101 && tableNum <= 199) return `(Classic)Bac ${tableNum - 100}`;
        if (tableNum >= 201 && tableNum <= 299) return `(Speed)Bac ${tableNum - 200}`;
        if (tableNum >= 301 && tableNum <= 399) return `(Mi)Bac ${tableNum - 300}`;
        if (tableNum >= 601 && tableNum <= 699) return `(Special)Bac ${tableNum - 600}`;
        if (tableNum >= 1 && tableNum <= 99) return `Bac ${tableNum}`;
        if (tableNum > 60) return `Bac ${tableNum}`;
      }
    }

    if (box) {
      const titleSelectors = [
        '.gameroom-header-title', '.gameroom_title', '.gameroom-title', '.gameroom_name',
        '.table-name', '.title', '.table_title', '.room_title', '.name',
        '[class*="gameroom-title"]', '[class*="table-name"]', '[class*="tableName"]',
        '[class*="title"]', '.gameroom_header', '.header'
      ];
      for (const sel of titleSelectors) {
        try {
          const el = box.querySelector(sel);
          if (el) {
            const txt = (el.textContent || '').trim();
            const m = txt.match(/(?:\(([^)]+)\)|(Classic|Sexy|Speed|Mi|Special))?\s*(?:Bac(?:carat)?|Bàn|百家乐)\s*0*(\d{1,4})/i);
            if (m) {
              const grp = m[1] || m[2] || '';
              const prefix = grp ? `(${grp.charAt(0).toUpperCase() + grp.slice(1).toLowerCase()})` : '';
              let num = parseInt(m[3], 10);
              if (num >= 1 && num <= 2000) return `${prefix}Bac ${num}`;
            }
          }
        } catch (e) {}
      }

      // Quét lá con leaf nodes
      try {
        const allSub = box.querySelectorAll('*');
        for (let i = 0; i < allSub.length; i++) {
          const el = allSub[i];
          if (!el.children || el.children.length === 0) {
            const txt = (el.textContent || '').trim();
            const m = txt.match(/^(?:\(([^)]+)\)|(Classic|Sexy|Speed|Mi|Special))?\s*(?:Bac(?:carat)?|Bàn|百家乐)\s*0*([1-9]\d{0,3})$/i);
            if (m) {
              const grp = m[1] || m[2] || '';
              const prefix = grp ? `(${grp.charAt(0).toUpperCase() + grp.slice(1).toLowerCase()})` : '';
              let num = parseInt(m[3], 10);
              if (num >= 1 && num <= 2000) return `${prefix}Bac ${num}`;
            }
          }
        }
      } catch (e) {}

      try {
        const fullTxt = (box.textContent || '');
        const m = fullTxt.match(/(?:\(([^)]+)\)|(Classic|Sexy|Speed|Mi|Special))\s*Bac\s*0*([1-9]\d{0,3})/i) ||
                  fullTxt.match(/\bBac\s*0*([1-9]\d{0,3})\b/i);
        if (m) {
          const grp = m[1] || m[2] || '';
          let num = parseInt(m[3] || (m[1] && !isNaN(m[1]) ? m[1] : m[2]), 10);
          if (num >= 1 && num <= 2000) {
            const prefix = grp ? `(${grp.charAt(0).toUpperCase() + grp.slice(1).toLowerCase()})` : '';
            return `${prefix}Bac ${num}`;
          }
        }
      } catch (e) {}
    }

    if (id) {
      if (id.includes('1415') || id.includes('invalid')) return null;

      const sexyMatch = id.match(/_sexy_bac_(\d+)/i);
      if (sexyMatch) {
        let num = parseInt(sexyMatch[1], 10);
        if (num > 25 && num < 100 && num % 10 !== 0) num = Math.floor(num / 10);
        return `(Sexy)Bac ${num}`;
      }
      const classicMatch = id.match(/_classic_bac_(\d+)/i);
      if (classicMatch) return `(Classic)Bac ${classicMatch[1]}`;
      const speedMatch = id.match(/_speed_bac_(\d+)/i);
      if (speedMatch) return `(Speed)Bac ${speedMatch[1]}`;
      const miMatch = id.match(/_mi_bac_(\d+)/i);
      if (miMatch) return `(Mi)Bac ${miMatch[1]}`;
      const specialMatch = id.match(/_special_bac_(\d+)/i);
      if (specialMatch) return `(Special)Bac ${specialMatch[1]}`;

      const idMatch = id.match(/groupMultiple_(\d+)_(\d+)/i) || id.match(/box_pc_(\d+)/i) || id.match(/_(\d{1,4})$/);
      if (idMatch) {
        const tableNum = parseInt(idMatch[2] || idMatch[1], 10);
        if (tableNum >= 501 && tableNum <= 599) return `(Sexy)Bac ${tableNum - 500}`;
        if (tableNum >= 101 && tableNum <= 199) return `(Classic)Bac ${tableNum - 100}`;
        if (tableNum >= 201 && tableNum <= 299) return `(Speed)Bac ${tableNum - 200}`;
        if (tableNum >= 301 && tableNum <= 399) return `(Mi)Bac ${tableNum - 300}`;
        if (tableNum >= 601 && tableNum <= 699) return `(Special)Bac ${tableNum - 600}`;
        if (tableNum >= 1 && tableNum <= 99) return `Bac ${tableNum}`;

        if (box) {
          const rawMatch = (box.textContent || '').match(/\b(?:Bac|Bàn)\s*0*([1-9]\d{0,3})\b/i);
          if (rawMatch) {
            const num = parseInt(rawMatch[1], 10);
            return `(Classic)Bac ${num}`;
          }
        }
        return `Bac ${tableNum}`;
      }
      return id;
    }

    return null;
  }

  // Trích xuất lịch sử cầu siêu nhẹ (Châu Bàn, Đại Lộ, SVG, Text - 0% CPU)
  extractRoadHistory(box) {
    if (!box) return [];

    // LAYER 1: ZhuPan Road (Châu Bàn / Bead Road) - type61..type72
    try {
      const zhuPanNodes = box.querySelectorAll(
        '.zhuPanRoad [class*="type"], [class*="zhuPan"] [class*="type"], [class*="cardroad_item"] [class*="type"], [class*="type6"], [class*="type7"]'
      );
      if (zhuPanNodes && zhuPanNodes.length > 0) {
        const zhuPanReg = /\btype[_-]?(6[1-9]|7[0-2])\b/i;
        const validZhuPan = [];
        for (let i = 0; i < zhuPanNodes.length; i++) {
          const el = zhuPanNodes[i];
          const classStr = (typeof el.className === 'string') ? el.className : (el.classList ? Array.from(el.classList).join(' ') : '');
          const m = classStr.match(zhuPanReg);
          if (m) {
            const code = parseInt(m[1]);
            if (code >= 61 && code <= 64) validZhuPan.push('B');
            else if (code >= 65 && code <= 68) validZhuPan.push('P');
            else if (code >= 69 && code <= 72) validZhuPan.push('T');
          }
        }
        if (validZhuPan.length > 0) {
          return validZhuPan.slice(-24);
        }
      }
    } catch (e) {}

    // LAYER 2: DaLu Road (Đại Lộ / Big Road) - type1..type12
    try {
      const daLuNodes = box.querySelectorAll(
        '.daLuRoad [class*="type"], [class*="daLu"] [class*="type"], [class*="type1"], [class*="type2"], [class*="type3"], [class*="type4"], [class*="type5"]'
      );
      if (daLuNodes && daLuNodes.length > 0) {
        const daLuReg = /\btype[_-]?([1-9]|1[0-2])\b/i;
        const validDaLu = [];
        for (let i = 0; i < daLuNodes.length; i++) {
          const el = daLuNodes[i];
          const classStr = (typeof el.className === 'string') ? el.className : (el.classList ? Array.from(el.classList).join(' ') : '');
          const m = classStr.match(daLuReg);
          if (m) {
            const code = parseInt(m[1]);
            if (code >= 1 && code <= 4) validDaLu.push('B');
            else if (code >= 5 && code <= 8) validDaLu.push('P');
            else if (code >= 9 && code <= 12) validDaLu.push('T');
          }
        }
        if (validDaLu.length > 0) {
          return validDaLu.slice(-24);
        }
      }
    } catch (e) {}

    // LAYER 3: Semantic classes (banker, player, zhuang, xian, tie)
    try {
      const roadItems = box.querySelectorAll('[class*="road"] [class*="dot"], [class*="road"] [class*="item"], [class*="cardroad"] > *');
      if (roadItems && roadItems.length > 0) {
        const validSemantic = [];
        for (let i = 0; i < roadItems.length; i++) {
          const el = roadItems[i];
          const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
          if (cls.includes('banker') || cls.includes('zhuang') || cls.includes('red')) {
            validSemantic.push('B');
          } else if (cls.includes('player') || cls.includes('xian') || cls.includes('blue')) {
            validSemantic.push('P');
          } else if (cls.includes('tie') || cls.includes('he') || cls.includes('green')) {
            validSemantic.push('T');
          }
        }
        if (validSemantic.length > 0) return validSemantic.slice(-24);
      }
    } catch (e) {}

    // LAYER 4: SVG circles / rects / paths
    try {
      const svgDots = box.querySelectorAll('svg circle, svg rect, svg path');
      if (svgDots && svgDots.length > 0) {
        const validSvg = [];
        for (let i = 0; i < svgDots.length; i++) {
          const dot = svgDots[i];
          const fill = (dot.getAttribute ? dot.getAttribute('fill') : '') || '';
          const stroke = (dot.getAttribute ? dot.getAttribute('stroke') : '') || '';
          const cls = (dot.getAttribute ? dot.getAttribute('class') : '') || '';
          const f = (fill + ' ' + stroke + ' ' + cls).toLowerCase();

          if (f.includes('red') || f.includes('#ef') || f.includes('#b9') || f.includes('#dc') || f.includes('banker')) {
            validSvg.push('B');
          } else if (f.includes('blue') || f.includes('#3b') || f.includes('#1d') || f.includes('#25') || f.includes('player')) {
            validSvg.push('P');
          } else if (f.includes('green') || f.includes('#10') || f.includes('#16') || f.includes('tie')) {
            validSvg.push('T');
          }
        }
        if (validSvg.length > 0) return validSvg.slice(-24);
      }
    } catch (e) {}

    // LAYER 5: Text leaf nodes (dùng textContent, KHÔNG innerText)
    try {
      const textNodes = box.querySelectorAll('.zhuPanRoad span, .daLuRoad span, [class*="road"] span');
      if (textNodes && textNodes.length > 0) {
        const validText = [];
        for (let i = 0; i < textNodes.length; i++) {
          const node = textNodes[i];
          if (!node.children || node.children.length === 0) {
            const txt = (node.textContent || '').trim();
            if (txt === 'B' || txt === '庄') validText.push('B');
            else if (txt === 'P' || txt === '闲') validText.push('P');
            else if (txt === 'T' || txt === '和') validText.push('T');
          }
        }
        if (validText.length > 0) return validText.slice(-24);
      }
    } catch (e) {}

    return [];
  }

  // Quét bên trong 1 Document cụ thể (Container-first siêu tốc)
    // Quét bên trong 1 Document cụ thể (Container-first siêu tốc)
  findTablesInDocument(doc) {
    const results = [];
    if (!doc || !doc.body) return results;

    const isBotElement = (el) => {
      if (!el || !el.closest) return false;
      return !!(el.closest('#wm-auto-helper-overlay') || el.closest('#wm-auto-mini-pill') || el.closest('.wm-table-card'));
    };

    // PHƯƠNG ÁN 1 (ƯU TIÊN SIÊU TỐC - CONTAINER-FIRST):
    // Quét trực tiếp các container bàn chuẩn WM Casino
    // CHỈ lấy container bàn thực thụ, TUYỆT ĐỐI BỎ QUA mọi thẻ con bên trong
    // Loại bỏ hoàn toàn selector [id^="groupMultiple_"] tổng quát để tránh dính 500+ thẻ con (_BankerRate, _confirm...)
    const rawCandidates = doc.querySelectorAll(
      '.gameroom-box.multiSelectContentItem, .gameroom-box, [class*="gameroom-box"], [class*="gameroom_box"], [class*="gameroom-item"], [id^="groupMultiple_"], [id^="box_pc_"], #pc_multi_bet_tablebox > div, [class*="table-box"]'
    );
    const candidateElements = Array.from(rawCandidates).filter(box => {
      if (!box) return false;
      const id = (box.id || '').trim();
      if (id && !isStrictTableId(id)) return false;
      return true;
    });

    if (candidateElements && candidateElements.length > 0) {
      for (let i = 0; i < candidateElements.length; i++) {
        const box = candidateElements[i];
        if (isBotElement(box)) continue;

        // BỎ QUA NẾU NẰM BÊN TRONG MỘT CONTAINER BÀN KHÁC (loại bỏ hoàn toàn thẻ con)
        const parentTable = box.parentElement ? box.parentElement.closest('.gameroom-box.multiSelectContentItem, .gameroom-box, [class*="gameroom-box"], [id^="groupMultiple_"], [id^="box_pc_"]') : null;
        if (parentTable && parentTable !== box) continue;

        const rawId = (box.id || '').trim();

        // Nếu có ID, phải khớp chuẩn bàn (loại bỏ hoàn toàn _BankerRate, _confirm, _cancel...)
        if (rawId && !isStrictTableId(rawId)) continue;

        // Lọc bàn: Chỉ lấy các bàn ở sảnh này đã mở (bỏ qua bàn đóng / bảo trì)
        if (isTableClosedOrMaintenance(box)) continue;

        const friendlyName = this.extractTableName(box, rawId);
        if (!friendlyName) continue;

        let tableId = rawId;
        if (!tableId || !isStrictTableId(tableId)) {
          tableId = friendlyName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        }
        if (!isStrictTableId(tableId)) continue;

        if (!results.some(r => r.cardNode === box || r.id === tableId)) {
          const tableData = this.extractH5TableData(box, friendlyName);
          if (tableData && isStrictTableId(tableData.id)) {
            tableData.id = tableId;
            results.push(tableData);
          }
        }
      }
    }

    // PHƯƠNG ÁN 2 (BỔ SUNG CHO MỌI BÀN CÒN LẠI DỰA THEO TIÊU ĐỀ BÀN):
    const titleRegex = /(?:(?:\(([^)]+)\)|(Classic|Sexy|Speed|Mi|Special))\s*)?(?:Bac(?:carat)?|Bàn|百家乐|Table|Room)\s*0*([1-9]\d{0,3})\b/i;
    const targetedNodes = doc.querySelectorAll('.gameroom-header-title, .gameroom-title, .table-name, [class*="gameroom-title"], [class*="table-name"], [class*="tableName"], .room_title, span, div, b, p, h1, h2, h3, h4, [class*="title"], [class*="name"], [class*="room"]');

    for (let i = 0; i < targetedNodes.length; i++) {
      const el = targetedNodes[i];
      if (isBotElement(el)) continue;
      if (el.children && el.children.length > 0) continue; // Chỉ xét leaf node
      const txt = (el.textContent || '').trim();
      const m = txt.match(titleRegex);
      if (m) {
        let grp = m[1] || m[2] || '';
        let tableNum = parseInt(m[3], 10);
        if (tableNum >= 501 && tableNum <= 599) {
          if (!grp) grp = 'Sexy';
          tableNum = tableNum - 500;
        } else if (tableNum >= 101 && tableNum <= 199) {
          if (!grp) grp = 'Classic';
          tableNum = tableNum - 100;
        } else if (tableNum >= 201 && tableNum <= 299) {
          if (!grp) grp = 'Speed';
          tableNum = tableNum - 200;
        } else if (tableNum >= 301 && tableNum <= 399) {
          if (!grp) grp = 'Mi';
          tableNum = tableNum - 300;
        } else if (tableNum >= 601 && tableNum <= 699) {
          if (!grp) grp = 'Special';
          tableNum = tableNum - 600;
        } else if (tableNum > 25 && tableNum < 100 && tableNum % 10 !== 0) {
          const candidate = Math.floor(tableNum / 10);
          if (candidate >= 1 && candidate <= 25) tableNum = candidate;
        }
        if (tableNum < 1 || tableNum > 2000) continue;

        const groupName = grp ? `(${grp.charAt(0).toUpperCase() + grp.slice(1).toLowerCase()})` : '';
        const cleanTitle = groupName ? `${groupName}Bac ${tableNum}` : `Bac ${tableNum}`;
        const foundCard = el.closest ? el.closest('[id^="groupMultiple_"], [id^="box_pc_"], .gameroom-box, [class*="gameroom-box"], [class*="gameroom_box"], [class*="gameroom-item"], [class*="table-box"], [class*="room"]') : null;

        if (foundCard && !isBotElement(foundCard)) {
          if (isTableClosedOrMaintenance(foundCard)) continue;
          const rawId = (foundCard.id || '').trim();
          let cleanId = rawId && isStrictTableId(rawId) ? rawId : cleanTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          if (!isStrictTableId(cleanId)) continue;

          if (!results.some(r => r.cardNode === foundCard || r.id === cleanId)) {
            const tableData = this.extractH5TableData(foundCard, cleanTitle);
            if (tableData && isStrictTableId(tableData.id)) {
              tableData.id = cleanId;
              results.push(tableData);
            }
          }
        }
      }
    }

    return results;
  }

  extractH5TableData(cardNode, rawTitle) {
    if (!cardNode) return null;
    let cleanId = cardNode.id;
    if (!cleanId || cleanId.startsWith('elem_') || cleanId.startsWith('box_')) {
      const gmNode = (cardNode.id && cardNode.id.startsWith('groupMultiple_')) ? cardNode : (cardNode.closest ? cardNode.closest('[id^="groupMultiple_"]') : null);
      if (gmNode && gmNode.id) {
        cleanId = gmNode.id;
      } else {
        cleanId = rawTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      }
    }

    // 1. Tìm nút cược Player & Banker (CHỈ tìm trong cardNode hoặc qua getElementById, KHÔNG quét toàn bộ DOM)
    let playerBtn = null;
    let bankerBtn = null;
    const docOwner = cardNode.ownerDocument || document;

    const candidates = (typeof this.getCandidateTableIds === 'function') ? this.getCandidateTableIds({ id: cleanId, name: rawTitle, cardNode: cardNode }) : [];
    if (cleanId && !candidates.includes(cleanId)) candidates.unshift(cleanId);

    for (const cid of candidates) {
      if (!cid) continue;
      if (!playerBtn) {
        playerBtn = (cardNode.querySelector ? cardNode.querySelector(`[id="${cid}_betAreaPlayer"]`) : null) ||
                    (docOwner.getElementById ? docOwner.getElementById(`${cid}_betAreaPlayer`) : null);
      }
      if (!bankerBtn) {
        bankerBtn = (cardNode.querySelector ? cardNode.querySelector(`[id="${cid}_betAreaBanker"]`) : null) ||
                    (docOwner.getElementById ? docOwner.getElementById(`${cid}_betAreaBanker`) : null);
      }
      if (playerBtn && bankerBtn) break;
    }

    if (!playerBtn && cardNode.querySelector) {
      playerBtn = cardNode.querySelector('[id$="_betAreaPlayer"], [id*="_betAreaPlayer"], .betAreaPlayer');
    }
    if (!bankerBtn && cardNode.querySelector) {
      bankerBtn = cardNode.querySelector('[id$="_betAreaBanker"], [id*="_betAreaBanker"], .betAreaBanker');
    }

    // 2. Tìm thời gian đếm ngược (betTime) chính xác
    const betTime = extractTableBetTime(cardNode);

    // 3. Trích xuất thông tin Shoe và Round từ thẻ bàn
    const roundInfo = extractTableRoundInfo(cardNode);

    // 4. Lấy lịch sử cầu đa tầng
    const history = this.extractRoadHistory(cardNode);
    const canonicalId = (window.WMBaccaratAIEngine && typeof window.WMBaccaratAIEngine.canonicalizeTableId === 'function')
      ? window.WMBaccaratAIEngine.canonicalizeTableId(cleanId, rawTitle)
      : cleanId;

    return {
      id: cleanId,
      canonicalId: canonicalId,
      rawId: cleanId,
      name: rawTitle,
      shoe: roundInfo.shoe,
      round: roundInfo.round,
      betTime: betTime,
      history: history,
      cardNode: cardNode,
      playerBtn: playerBtn,
      bankerBtn: bankerBtn
    };
  }

  // Lấy số dư tài khoản thực tế từ giao diện hoặc báo cáo của nhà cái WM
  getGameUserBalance() {
    try {
      // 1. Quét tìm theo chữ VNDK trong toàn trang DOM (khớp chuẩn giao diện WM Casino)
      const allEls = document.querySelectorAll('span, div, b, p, a, strong');
      for (let i = 0; i < allEls.length; i++) {
        const txt = (allEls[i].textContent || '').trim();
        if (txt.includes('VNDK') || txt.includes('VND')) {
          const m = txt.match(/VNDK?\s*([\d,]+(?:\.\d+)?)/i);
          if (m) {
            const val = parseFloat(m[1].replace(/,/g, ''));
            if (!isNaN(val) && val >= 0) return val;
          }
        }
      }

      // 2. Tìm thẻ hiển thị số dư theo selector ID/class
      const selectors = [
        '#user_money', '#user_balance', '#top_money', '#head_money', '#money',
        '.user-money', '.user_money', '.user-balance', '.balance',
        '[class*="user-money"]', '[class*="user_money"]', '[class*="balance"]', '[id*="money"]', '[id*="balance"]'
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const txt = (el.textContent || '').trim();
          if (txt) {
            const m = txt.match(/([\d,]+(?:\.\d+)?)/);
            if (m) {
              const val = parseFloat(m[1].replace(/,/g, ''));
              if (!isNaN(val) && val >= 0) return val;
            }
          }
        }
      }

      // 3. Fallback từ dữ liệu cash của Gateway Report
      if (this.stats && typeof this.stats.realBalance === 'number') {
        return this.stats.realBalance;
      }
    } catch (e) {}
    return null;
  }

  // Kiểm tra xem thẻ bàn đã có cược (chip hoặc badge tiền) ở cửa cụ thể không
  hasPlacedBetOnSide(cardNode, side, candidateIds = []) {
    if (!cardNode) return false;
    const sideSuffix = side === 'B' ? 'Banker' : 'Player';
    const docOwner = cardNode.ownerDocument || document;

    let betArea = null;
    const allCandidates = Array.isArray(candidateIds) ? [...candidateIds] : [];
    if (cardNode.id && !allCandidates.includes(cardNode.id)) allCandidates.unshift(cardNode.id);

    for (const cid of allCandidates) {
      if (!cid) continue;
      betArea = (cardNode.querySelector ? cardNode.querySelector(`[id="${cid}_betArea${sideSuffix}"]`) : null) ||
                (docOwner.getElementById ? docOwner.getElementById(`${cid}_betArea${sideSuffix}`) : null);
      if (betArea) break;
    }

    if (!betArea && cardNode.querySelector) {
      betArea = cardNode.querySelector(
        `[id$="_betArea${sideSuffix}"], [id*="_betArea${sideSuffix}"], .betArea${sideSuffix}, ` +
        `[class*="betArea${sideSuffix}"], [class*="betArea_${sideSuffix}"], [data-bet="${sideSuffix}"]`
      );
    }

    if (!betArea) return false;

    // Kiểm tra xem trong betArea có chip hoặc badge tiền cược không
    const chipIndicators = betArea.querySelectorAll(
      '[class*="chip"], [class*="badge"], [class*="bet-num"], [class*="bet_val"], ' +
      '[class*="coin"], [class*="amount"], img[src*="chip"], svg circle'
    );
    if (chipIndicators && chipIndicators.length > 0) {
      return true;
    }

    // Kiểm tra các phần tử text leaf bên trong betArea (tìm số tiền cược thực tế như "10", "20", "50"...)
    const spans = betArea.querySelectorAll('span, div, b, p');
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      if (el.children && el.children.length > 0) continue;
      const txt = (el.textContent || '').trim();
      if (/^(?:1:0\.95|1:1|0\.95|1:0\.9|banker|player|cái|con|nhà cái|nhà con)$/i.test(txt)) {
        continue;
      }
      if (/^[1-9]\d{0,6}[kK]?$/.test(txt)) {
        return true;
      }
    }

    return false;
  }

  // ==========================================================================
  updateSummaryCounts() {
    const totalCount = this.tablesMap.size;
    let openCount = 0;

    for (const t of this.tablesMap.values()) {
      if (t.betTime > 0) openCount++;
    }

    const metricTables = document.getElementById('wm-metric-tables');
    if (metricTables) metricTables.textContent = totalCount;

    const badgeTables = document.getElementById('wm-tab-badge-tables');
    if (badgeTables) badgeTables.textContent = totalCount;

    const liveCount = document.getElementById('wm-live-count');
    if (liveCount) liveCount.textContent = totalCount;

    const liveOpenCount = document.getElementById('wm-live-open-count');
    if (liveOpenCount) liveOpenCount.textContent = openCount;

    this.updateMiniPill();
  }

  updateTableMetricsUI() {
    if (this.isHeadlessMode) return;
    this.updateSummaryCounts();
    if (!this.isOverlayMinimized && this.activeTab === 'tables') {
      this.renderTablesList();
      this.tablesDirty = false;
    }
  }

  // Gắn sự kiện kéo chuột mượt mà (Drag-to-scroll) & lăn chuột cuộn ngang
  attachRoadScrollHandlers(dotsEl) {
    if (!dotsEl || dotsEl.dataset.scrollAttached) return;
    dotsEl.dataset.scrollAttached = 'true';

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    dotsEl.addEventListener('mousedown', (e) => {
      isDown = true;
      dotsEl.classList.add('is-dragging');
      startX = e.pageX - dotsEl.offsetLeft;
      scrollLeft = dotsEl.scrollLeft;
    });

    window.addEventListener('mouseup', () => {
      if (isDown) {
        isDown = false;
        dotsEl.classList.remove('is-dragging');
      }
    });

    dotsEl.addEventListener('mouseleave', () => {
      isDown = false;
      dotsEl.classList.remove('is-dragging');
    });

    dotsEl.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - dotsEl.offsetLeft;
      const walk = (x - startX) * 1.6;
      dotsEl.scrollLeft = scrollLeft - walk;
    });

    // Lăn chuột dọc để cuộn ngang mượt mà
    dotsEl.addEventListener('wheel', (e) => {
      if (dotsEl.classList.contains('wm-wrap-mode')) return;
      if (e.deltaY !== 0) {
        e.preventDefault();
        dotsEl.scrollLeft += (e.deltaY * 0.9);
      }
    }, { passive: false });
  }

  renderTablesList() {
    if (this.isHeadlessMode) return;
    const container = document.getElementById('wm-tables-list');
    if (!container) return;

    // QUAN TRỌNG: Không render lại danh sách bàn nếu overlay đang thu nhỏ hoặc không ở tab bàn
    if (this.isOverlayMinimized || this.activeTab !== 'tables') {
      return;
    }

    if (this.tablesMap.size === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px 10px; color:#64748b; font-size:12px;">
          Chưa tìm thấy bàn chơi.<br>Hãy mở chế độ <b>"Nhiều bàn"</b> hoặc bấm <b>"Cuộn Quét Toàn Bàn"</b>.
        </div>
      `;
      return;
    }

    // Xóa thông báo chờ nếu có
    const emptyMsg = container.querySelector('div[style*="text-align:center"]');
    if (emptyMsg) {
      container.innerHTML = '';
    }

    const tables = Array.from(this.tablesMap.values());
    const currentTableIds = new Set(tables.map(t => t.id));

    // 1. Dọn dẹp card của các bàn không còn tồn tại
    if (this.tableCardsMap.size > 0) {
      for (const [cid, cEl] of this.tableCardsMap.entries()) {
        if (!currentTableIds.has(cid)) {
          if (cEl && cEl.parentNode) cEl.remove();
          this.tableCardsMap.delete(cid);
        }
      }
    } else {
      Array.from(container.children).forEach(child => {
        const cardId = child.getAttribute('data-table-id');
        if (cardId && !currentTableIds.has(cardId)) {
          child.remove();
        }
      });
    }

    // 2. Cập nhật in-place hoặc tạo mới từng card (giữ nguyên vị trí cuộn của người dùng)
    tables.forEach(t => {
      let timeClass = 'closed';
      let timeText = 'Chờ';
      if (t.betTime > 10) {
        timeClass = 'green';
        timeText = `${t.betTime}s`;
      } else if (t.betTime > 4) {
        timeClass = 'yellow';
        timeText = `${t.betTime}s`;
      } else if (t.betTime > 0) {
        timeClass = 'red';
        timeText = `${t.betTime}s`;
      }

      let roadDotsHtml = '';
      let statsHtml = '';
      const historyLen = t.history ? t.history.length : 0;
      const historySig = t.history ? t.history.join('') : '';

      if (historyLen > 0) {
        let bCount = 0;
        let pCount = 0;
        let tCount = 0;

        roadDotsHtml = t.history.map((res, idx) => {
          if (res === 'B') bCount++;
          else if (res === 'P') pCount++;
          else if (res === 'T') tCount++;

          const isLatest = idx === historyLen - 1 ? 'latest' : '';
          const cls = res === 'B' ? 'banker' : (res === 'P' ? 'player' : 'tie');
          const title = res === 'B' ? 'Banker' : (res === 'P' ? 'Player' : 'Hòa (Tie)');
          return `<div class="wm-road-dot ${cls} ${isLatest}" title="${title}">${res}</div>`;
        }).join('');

        statsHtml = `
          <span style="color:#f87171;">🔴 B: ${bCount}</span>
          <span style="color:#60a5fa;">🔵 P: ${pCount}</span>
          <span style="color:#34d399;">🟢 T: ${tCount}</span>
          <span style="color:#94a3b8; margin-left:auto; font-size:9px;">(Tổng: ${historyLen})</span>
        `;
      } else {
        roadDotsHtml = '<span style="font-size:10px; color:#94a3b8; font-style:italic;">⏳ Đang đọc chuỗi cầu... (chờ ván mới hoặc cuộn bàn)</span>';
        statsHtml = '<span style="color:#64748b; font-size:9px;">Chưa có thống kê</span>';
      }

      const lastRes = historyLen > 0 ? t.history[historyLen - 1] : null;
      let lastResBadge = '<span style="color:#64748b;">Chưa có</span>';
      if (lastRes === 'B') lastResBadge = '<b style="color:#f87171;">🔴 Banker</b>';
      else if (lastRes === 'P') lastResBadge = '<b style="color:#60a5fa;">🔵 Player</b>';
      else if (lastRes === 'T') lastResBadge = '<b style="color:#34d399;">🟢 Hòa (Tie)</b>';

      let card = this.tableCardsMap.get(t.id);
      if (!card || !card.isConnected) {
        card = container.querySelector(`[data-table-id="${t.id}"]`);
        if (card) this.tableCardsMap.set(t.id, card);
      }

      if (!card) {
        // TẠO MỚI CARD CHO BÀN NÀY
        card = document.createElement('div');
        card.className = `wm-table-card ${t.betTime > 5 && t.betTime < 25 ? 'active-betting' : ''}`;
        card.setAttribute('data-table-id', t.id);
        card.dataset.sig = historySig;

        const isWrapGlobal = this.roadViewMode === 'wrap';

        const safeTableName = this.escapeHtml(t.name || t.id);
        const safeTableId = this.escapeHtml(t.id);

        card.innerHTML = `
          <div class="wm-table-card-header">
            <div class="wm-table-title">
              <span>🎲</span>
              <span style="font-weight:700;">${safeTableName}</span>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              <button class="wm-road-mode-btn" data-table="${safeTableId}" title="Chuyển chế độ: 1 Hàng Cuộn / 2 Hàng Xem Hết">
                ${isWrapGlobal ? '↔️ Cuộn' : '▦ 2 Hàng'}
              </button>
              <div class="wm-bettime-badge ${timeClass}">
                ⏱️ ${timeText}
              </div>
            </div>
          </div>
          <div class="wm-road-dots ${isWrapGlobal ? 'wm-wrap-mode' : ''}">
            ${roadDotsHtml}
          </div>
          <div class="wm-road-stats">
            ${statsHtml}
          </div>
          <div class="wm-table-footer">
            <span style="font-size:10px; color:#64748b;">ID: ${safeTableId}</span>
            <span style="font-size:11px;">Ván gần nhất: <span class="wm-footer-last-badge">${lastResBadge}</span></span>
          </div>
        `;

        container.appendChild(card);
        this.tableCardsMap.set(t.id, card);

        const dotsEl = card.querySelector('.wm-road-dots');
        if (dotsEl) {
          this.attachRoadScrollHandlers(dotsEl);
          // Tự động cuộn sang phải để ván MỚI NHẤT luôn hiển thị ngay lập tức
          requestAnimationFrame(() => {
            dotsEl.scrollLeft = dotsEl.scrollWidth;
          });
        }

        const modeBtn = card.querySelector('.wm-road-mode-btn');
        if (modeBtn) {
          modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dotsEl) {
              const isWrap = dotsEl.classList.toggle('wm-wrap-mode');
              modeBtn.textContent = isWrap ? '↔️ Cuộn' : '▦ 2 Hàng';
              if (!isWrap) {
                dotsEl.scrollLeft = dotsEl.scrollWidth;
              }
            }
          });
        }

      } else {
        // CẬP NHẬT IN-PLACE TRÊN CARD ĐÃ CÓ (KHÔNG LÀM MẤT VỊ TRÍ CUỘN CỦA NGƯỜI DÙNG)
        // 1. Cập nhật thời gian đếm ngược
        const badge = card.querySelector('.wm-bettime-badge');
        if (badge) {
          badge.className = `wm-bettime-badge ${timeClass}`;
          badge.textContent = `⏱️ ${timeText}`;
        }

        // 2. Cập nhật trạng thái active betting
        if (t.betTime > 5 && t.betTime < 25) {
          card.classList.add('active-betting');
        } else {
          card.classList.remove('active-betting');
        }

        // 3. Chỉ vẽ lại cầu khi thực sự có ván mới
        if (card.dataset.sig !== historySig) {
          card.dataset.sig = historySig;

          const dotsEl = card.querySelector('.wm-road-dots');
          if (dotsEl) {
            dotsEl.innerHTML = roadDotsHtml;
            // Tự động cuộn sang phải để ván mới nhất luôn trong tầm mắt
            if (!dotsEl.classList.contains('wm-wrap-mode')) {
              dotsEl.scrollLeft = dotsEl.scrollWidth;
            }
          }

          const statsEl = card.querySelector('.wm-road-stats');
          if (statsEl) {
            statsEl.innerHTML = statsHtml;
          }

          const footerLast = card.querySelector('.wm-footer-last-badge');
          if (footerLast) {
            footerLast.innerHTML = lastResBadge;
          }
        }
      }
    });
  }

  // Cuộn nạp toàn bộ danh sách bàn (kích hoạt lazy loading)
  forceScrollAllTables() {
    this.addLog('🔄 Đang kích hoạt cuộn nạp và làm mới toàn bộ danh sách bàn...', 'info');

    // Xóa sạch bộ nhớ bàn cũ để dọn dẹp triệt để bàn ảo
    this.tablesMap.clear();

    // Bắn tín hiệu FORCE_SCROLL_TABLES tới tất cả iframe để dọn sạch cachedTablesMap
    const targetWindows = this.getAllTargetWindows();
    targetWindows.forEach(win => {
      try {
        win.postMessage({
          action: 'FORCE_SCROLL_TABLES',
          messageId: ++this.messageIdCounter
        }, '*');
      } catch (e) {}
    });

    // Tìm các thẻ có thanh cuộn trên Document chính
    const scrollers = Array.from(document.querySelectorAll('.gameroom-list, [class*="tablebox"], [class*="room-list"], [class*="gameroom"], [class*="scroll"], #pc_multi_bet_tablebox, .content, main')).filter(el => {
      try {
        return el.scrollHeight > el.clientHeight + 50;
      } catch (e) {
        return false;
      }
    });

    if (scrollers.length > 0) {
      scrollers.forEach(s => {
        const oldTop = s.scrollTop;
        s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
        setTimeout(() => {
          s.scrollTo({ top: oldTop, behavior: 'smooth' });
          this.scanAllTables();
        }, 600);
      });
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        this.scanAllTables();
      }, 600);
    }

    setTimeout(() => {
      this.scanAllTables();
      this.addLog(`Đã quét xong! Nắm được tổng cộng ${this.tablesMap.size} bàn.`, 'success');
    }, 1200);
  }

  setControlsLocked(locked) {
    if (!this.overlay) return;
    const chipSelect = document.getElementById('wm-chip-select');
    if (chipSelect) chipSelect.disabled = locked;

    const tradingModeSelect = document.getElementById('wm-trading-mode');
    if (tradingModeSelect) tradingModeSelect.disabled = locked;

    const filterBtns = document.querySelectorAll('.wm-filter-btn');
    filterBtns.forEach(b => {
      b.disabled = locked;
      b.style.pointerEvents = locked ? 'none' : 'auto';
      b.style.opacity = locked ? '0.45' : '1';
    });

    const maxTotalBetInput = document.getElementById('wm-max-total-bet');
    if (maxTotalBetInput) maxTotalBetInput.disabled = locked;

    const maxConcurrentInput = document.getElementById('wm-max-concurrent-bets');
    if (maxConcurrentInput) maxConcurrentInput.disabled = locked;

    const maxTablesInput = document.getElementById('wm-max-tables');
    if (maxTablesInput) maxTablesInput.disabled = locked;

    const resetBtn = document.getElementById('wm-ai-reset-memory-btn');
    if (resetBtn) resetBtn.disabled = locked;

    const exportBtn = document.getElementById('wm-ai-export-btn');
    if (exportBtn) exportBtn.disabled = locked;

    const importBtn = document.getElementById('wm-ai-import-btn');
    if (importBtn) importBtn.disabled = locked;

    const clearHistoryBtn = document.getElementById('wm-clear-history-btn');
    if (clearHistoryBtn) clearHistoryBtn.disabled = locked;
  }

  // ==========================================================================
  // BẮT ĐẦU / DỪNG TỰ ĐỘNG CƯỢC
  // ==========================================================================
  async start() {
    if (this.isRunning) return { success: true, isRunning: true };

    // RÀNG BUỘC BẢN QUYỀN MÁY TÍNH - Xác thực online, đọc cache nếu rớt mạng tạm thời
    const isValid = await this.checkLicense();
    if (!isValid || !this.license || !this.license.valid) {
      let cachedValid = false;
      try {
        const stored = await new Promise(r => chrome.storage.local.get(['wm_license_cached'], r));
        if (stored && stored.wm_license_cached && stored.wm_license_cached.valid) {
          this.license = stored.wm_license_cached;
          cachedValid = true;
        }
      } catch (e) {}

      if (!cachedValid) {
        const errDetail = (this.license && this.license.error) ? this.license.error : 'Máy chưa kích hoạt hoặc key đã bị khóa';
        this.addLog(`❌ Chưa thể cược: ${errDetail}`, 'error');
        this.updateStatus('CHƯA KÍCH HOẠT', 'stopped');
        return { success: false, error: 'LICENSE_INVALID', message: errDetail };
      }
    }

    // Đồng bộ ngay các giá trị đang hiển thị trên giao diện
    this.syncSettingsFromUI();

    // Ràng buộc hạn mức tổng tiền cược
    if (this.maxTotalBet > 0 && this.stats.totalAmount >= this.maxTotalBet) {
      const msg = `Tổng tiền cược hiện tại (${this.stats.totalAmount.toLocaleString('vi-VN')}k) đã đạt hạn mức (${this.maxTotalBet.toLocaleString('vi-VN')}k)! Vui lòng bấm "Xóa DL" hoặc nâng hạn mức cược trước khi bắt đầu.`;
      this.addLog(`❌ Không thể bắt đầu: ${msg}`, 'error');
      return { success: false, error: 'LIMIT_EXCEEDED', message: msg, currentAmount: this.stats.totalAmount, maxLimit: this.maxTotalBet };
    }

    if (!this.parsePatterns()) return { success: false, error: 'PATTERN_ERROR', message: 'Lỗi cấu hình mẫu cược' };

    // Tự động giải phóng các lệnh PENDING cũ (>60s) để tránh kẹt giới hạn cược đồng thời
    const now = Date.now();
    let cleanedPending = 0;
    this.betHistory.forEach(item => {
      if (item.result === 'PENDING' && (now - (item.timestamp || 0) > 60000)) {
        item.result = 'TIMEOUT';
        item.profit = 0;
        cleanedPending++;
      }
    });
    if (cleanedPending > 0) {
      this.recalculateStats();
      this.saveBetHistory();
      this.renderBetHistory();
      this.addLog(`🧹 Đã giải phóng ${cleanedPending} lệnh cược chờ cũ để sẵn sàng cược mới.`, 'info');
    }

    // Chế độ cược thật 100% cho khách hàng - Bắt đầu ngay không cần hỏi lại lần 2
    if (this.aiEngine) {
      this.aiEngine.setTradingMode('REAL');
      this.updateTradingModeUI('REAL');
    }

    this.isRunning = true;
    document.getElementById('wm-start-btn').disabled = true;
    document.getElementById('wm-stop-btn').disabled = false;
    this.setControlsLocked(true);
    this.updateStatus('ĐANG TỰ ĐỘNG CƯỢC', 'running');
    this.addLog(`=== BẮT ĐẦU AUTO BET (Đang quét ${this.tablesMap.size} bàn) ===`, 'success');

    // Chạy vòng lặp đánh giá cược (FLASH: 600ms, LOW/HIGH: 1500ms)
    this.resetBettingLoopSpeed();
    return { success: true, isRunning: true };
  }

  // Tự động điều chỉnh nhịp vòng lặp theo chế độ nhạy AI
  resetBettingLoopSpeed() {
    if (this.bettingLoopInterval) clearInterval(this.bettingLoopInterval);
    if (!this.isRunning) return;
    const isFlash = (this.aiEngine && this.aiEngine.currentFilterMode === 'FLASH');
    const intervalMs = isFlash ? 800 : 1500;
    this.bettingLoopInterval = setInterval(() => {
      this.evaluateAllTablesForBetting();
    }, intervalMs);
  }

  stop() {
    this.isRunning = false;
    if (this.bettingLoopInterval) clearInterval(this.bettingLoopInterval);
    document.getElementById('wm-start-btn').disabled = false;
    document.getElementById('wm-stop-btn').disabled = true;
    this.setControlsLocked(false);
    this.updateStatus('ĐÃ DỪNG', 'stopped');
    this.addLog('=== ĐÃ DỪNG TỰ ĐỘNG CƯỢC ===', 'error');
  }

  async evaluateAllTablesForBetting() {
    if (!this.isRunning) return;
    if (this.isGameLoading()) return;

    // Kiểm tra bản quyền máy còn hiệu lực trước khi xét cược
    if (!this.license || !this.license.valid) {
      if (this.isRunning) this.stop();
      this.addLog('⛔ [BẢN QUYỀN] Đã dừng tự động cược do bản quyền không hợp lệ hoặc bị thu hồi.', 'error');
      return;
    }

    // Ràng buộc hạn mức tổng tiền cược: tự động dừng nếu chạm trần
    if (this.maxTotalBet > 0 && this.stats.totalAmount >= this.maxTotalBet) {
      this.stop();
      this.addLog(`🛑 [HẠN MỨC] ĐÃ ĐẠT HẠN MỨC TỔNG TIỀN CƯỢC (${this.stats.totalAmount.toLocaleString('vi-VN')} / ${this.maxTotalBet.toLocaleString('vi-VN')}). Bot tự động dừng!`, 'error');
      return;
    }

    if (this.isEvaluatingAllTables) return;
    this.isEvaluatingAllTables = true;

    try {
      // PHA 1: ĐÁNH GIÁ TÍN HIỆU NHANH TRÊN TOÀN BỘ BÀN (KHÔNG BỊ CẮT NGẮN Ở 20 BÀN)
      const maxLimit = Math.max(50, this.maxTables || 50);
      const allTables = Array.from(this.tablesMap.values()).slice(0, maxLimit);
      const now = Date.now();

      // Đánh giá đồng loạt các bàn trên Cloud VPS (Bảo mật 100% thuật toán)
      if (this.aiEngine && typeof this.aiEngine.evaluateTablesBatch === 'function') {
        const candidateTables = allTables.filter(t => t.history && t.history.length >= 2);
        if (candidateTables.length > 0) {
          const batchResult = await this.aiEngine.evaluateTablesBatch(candidateTables);
          const isHealthy = typeof this.aiEngine.isCloudHealthy === 'function'
            ? this.aiEngine.isCloudHealthy()
            : Boolean(this.aiEngine.bridgeConnected && this.aiEngine.licenseActive);
          if (!batchResult || !isHealthy) {
            if (!this._lastCloudWarnTime || now - this._lastCloudWarnTime > 10000) {
              this._lastCloudWarnTime = now;
              this.addLog('⚠️ [CLOUD AI] Mất kết nối Cloud AI VPS hoặc tín hiệu hết hạn — Tạm ngưng đặt cược mới để bảo vệ vốn!', 'warning');
            }
            return;
          }
        }
      }

      const actionableBets = [];

      for (const table of allTables) {
        if (!this.isRunning) break;
        const rawName = String(table?.name || '');
        const rawIdStr = String(table?.id || '');
        if (rawName.includes('1415') || rawIdStr.includes('1415') || !isStrictTableId(rawIdStr)) {
          this.tablesMap.delete(table.id);
          if (table.canonicalId) this.tablesMap.delete(table.canonicalId);
          continue;
        }
        const canonicalId = table.canonicalId || (window.WMBaccaratAIEngine ? window.WMBaccaratAIEngine.canonicalizeTableId(table.id, table.name) : table.id);
        const history = table.history;
        const betTime = table.betTime;

        if (!history || history.length < 2) continue;

        // Hỗ trợ đặt cược cả bàn nhận diện qua DOM lẫn qua WebSocket Protocol 26

        // LỚP 1: In-flight Mutex theo canonicalId và rawId
        if (this.activeBettingTables.has(canonicalId) || this.activeBettingTables.has(table.id)) continue;

        // LỚP 2: Quản lý trạng thái ván theo canonicalId chuẩn duy nhất
        const state = this.tableStates[canonicalId] || {
          lastRoundKey: '',
          lastHistoryLength: 0,
          betPlaced: false,
          betSide: null,
          betRoundNo: null,
          betShoeNo: null,
          lastBetTimestamp: 0
        };

        // Xác định shoeNo và roundNo chính xác từ thẻ bàn hoặc wsTableMeta
        const roundInfo = (table.cardNode ? extractTableRoundInfo(table.cardNode) : { shoe: '0', round: 0 });
        const wsMeta = this.wsTableMeta ? this.wsTableMeta.get(canonicalId) : null;
        const currentShoe = (roundInfo.shoe && roundInfo.shoe !== '0')
          ? roundInfo.shoe
          : ((table.shoe && table.shoe !== '0') ? String(table.shoe) : (wsMeta?.shoeId || '0'));
        const currentRound = roundInfo.round || table.round || wsMeta?.roundIndex || (history.length + 1);

        // Chữ ký định danh ván cược hiện tại (không bị reset do dao động DOM khi đếm ngược)
        const roundKey = `${canonicalId}_shoe:${currentShoe}_r:${currentRound}`;

        // Kiểm tra chuyển ván mới:
        // CHỈ reset khi:
        // 1. roundNo tiến lên (currentRound > state.betRoundNo)
        // 2. Hoặc history.length tăng (kết quả ván trước đã được ghi nhận vào bảng cầu)
        // 3. Hoặc shoeId thay đổi
        const isNewRound = (
          !state.lastRoundKey ||
          (state.betRoundNo && currentRound > state.betRoundNo) ||
          (history.length > (state.lastHistoryLength || 0)) ||
          (currentShoe && state.betShoeNo && currentShoe !== state.betShoeNo)
        );

        if (isNewRound) {
          state.lastRoundKey = roundKey;
          state.lastHistoryLength = history.length;
          // Chỉ mở lại cược nếu ván trước không bị lỗi cược hoặc đã qua cooldown 30s
          if (!state.lastBetFailed || (now - (state.failedBetTimestamp || 0) >= 30000)) {
            state.betPlaced = false;
            state.betSide = null;
            state.betRoundNo = null;
            state.betShoeNo = null;
            state.lastBetFailed = false;
          }
          this.tableStates[canonicalId] = state;
        }

        // Nếu ván này ĐÃ ĐẶT CƯỢC -> TUYỆT ĐỐI BỎ QUA, đợi kết toán ra ván mới
        if (state.betPlaced) {
          continue;
        }

        // LỚP 3: Chống cược trùng lặp (Pending Bet Check theo canonicalId)
        const hasPendingBet = this.betHistory.some(item => {
          if (item.result !== 'PENDING' || !item.success) return false;
          if (item.timestamp && (now - item.timestamp > 60000)) return false;
          const itemCanonical = item.canonicalTableId || (window.WMBaccaratAIEngine ? window.WMBaccaratAIEngine.canonicalizeTableId(item.tableId, item.table) : item.tableId);
          return itemCanonical === canonicalId || item.tableId === table.id;
        });
        if (hasPendingBet) continue;

        // LỚP 3b: Chống spam lỗi cược (Failed Bet Cooldown 30s trên bàn lỗi)
        if (state.lastBetFailed && (now - (state.failedBetTimestamp || 0) < 30000)) {
          continue;
        }
        const hasRecentFailedBet = this.betHistory.some(item => {
          if (item.result !== 'FAILED') return false;
          if (item.timestamp && (now - item.timestamp < 30000)) {
            const itemCanonical = item.canonicalTableId || (window.WMBaccaratAIEngine ? window.WMBaccaratAIEngine.canonicalizeTableId(item.tableId, item.table) : item.tableId);
            return itemCanonical === canonicalId || item.tableId === table.id;
          }
          return false;
        });
        if (hasRecentFailedBet) continue;

        // LỚP 4: Cooldown an toàn (Flash: 2s, Low/High: 10s)
        const isFlash = (this.aiEngine && this.aiEngine.currentFilterMode === 'FLASH');
        const cooldownMs = isFlash ? 2000 : 10000;
        if (state.lastBetTimestamp && (now - state.lastBetTimestamp < cooldownMs)) continue;

        // LỚP 5: Cửa sổ thời gian đếm ngược hợp lệ (3s <= betTime <= 45s)
        const minTime = isFlash ? 3 : 4;
        const maxTime = 45;
        const isBetTimeValid = (typeof betTime === 'number' && betTime >= minTime && betTime <= maxTime);

        if (!isBetTimeValid) {
          continue;
        }

        if (this.aiEngine) {
          const prediction = this.aiEngine.generatePrediction(canonicalId, table.name || canonicalId, history, currentShoe);
          if (prediction && !prediction.stale && prediction.predicted && prediction.predicted !== 'PASS') {
            const nowMs = Date.now();
            if (prediction.cachedAt && (nowMs - prediction.cachedAt > 30000)) {
              continue;
            }
            if (prediction.shoeId && String(prediction.shoeId) !== String(currentShoe)) {
              const isSynth = typeof prediction.shoeId === 'string' && prediction.shoeId.startsWith('shoe_');
              const isDomZero = !currentShoe || String(currentShoe) === '0';
              if (!(isSynth && isDomZero)) {
                continue;
              }
            }
            const currentRoundId = this.aiEngine.computeRoundId(canonicalId, currentShoe, history, table.name || canonicalId);
            if (prediction.roundId && prediction.roundId !== currentRoundId) {
              const historySig = history.join('');
              const predSig = (prediction.historySig || (prediction.history ? prediction.history.join('') : ''));
              if (predSig && predSig !== historySig) {
                continue;
              }
            }

            actionableBets.push({
              table,
              canonicalId,
              currentRound,
              currentShoe,
              prediction,
              state,
              betTime,
              confidence: prediction.confidence || 0.5
            });
          }
        }
      }

      // Sắp xếp các bàn có tín hiệu theo độ tin cậy AI cao nhất trước
      actionableBets.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

      // PHA 2: THỰC THI CƯỢC CÓ RÀNG BUỘC CƯỢC ĐỒNG THỜI & CHỐNG TRÙNG BÀN (CHỐNG CƯỢC 2 ĐẦU)
      const uniqueBetsPerTable = new Map();
      for (const item of actionableBets) {
        if (!uniqueBetsPerTable.has(item.canonicalId)) {
          uniqueBetsPerTable.set(item.canonicalId, item);
        }
      }
      const finalBetsToExecute = Array.from(uniqueBetsPerTable.values());

      let availableConcurrentSlots = (this.maxConcurrentBets <= 0)
        ? finalBetsToExecute.length
        : Math.max(0, this.maxConcurrentBets - this.getPendingBetsCount());

      for (let i = 0; i < finalBetsToExecute.length; i++) {
        if (!this.isRunning) break;
        const item = finalBetsToExecute[i];
        const { table, canonicalId, currentRound, currentShoe, prediction, state, betTime } = item;
        const targetSide = prediction.predicted; // 'B' hoặc 'P'
        const sideName = targetSide === 'B' ? 'Banker' : 'Player';
        const confPercent = Math.round((prediction.confidence || 0.5) * 100);

        if (prediction.shouldBet) {
          // Ràng buộc cược đồng thời: kiểm tra slot còn trống
          if (this.maxConcurrentBets > 0 && (availableConcurrentSlots <= 0 || this.getPendingBetsCount() >= this.maxConcurrentBets)) {
            continue;
          }

          // Kiểm tra thời gian đếm ngược thực tế ngay trước khi cược (tránh cược vào bàn sắp đóng <= 2s)
          const liveTable = this.tablesMap.get(canonicalId) || this.tablesMap.get(table.id) || table;
          const liveRemainingTime = (liveTable.betTime !== undefined && liveTable.betTime !== null) ? liveTable.betTime : betTime;
          if (typeof liveRemainingTime === 'number' && liveRemainingTime < 3) {
            this.addLog(`⚠️ [BỎ QUA] Bàn ${prediction.tableName} thời gian còn lại quá ít (${liveRemainingTime}s < 3s), bỏ qua để an toàn!`, 'warning');
            continue;
          }

          const betAmount = this.actualGameChip || this.selectedChip || 10;
          if (this.maxTotalBet > 0 && (this.stats.totalAmount + betAmount) > this.maxTotalBet) {
            this.stop();
            this.addLog(`🛑 [HẠN MỨC] Lệnh cược ${betAmount} sẽ vượt hạn mức tổng cược (${this.stats.totalAmount.toLocaleString('vi-VN')} + ${betAmount} > ${this.maxTotalBet.toLocaleString('vi-VN')}). Bot tự động dừng!`, 'error');
            break;
          }

          state.betPlaced = true;
          state.betSide = targetSide;
          state.betRoundNo = currentRound;
          state.betShoeNo = currentShoe;
          state.lastBetTimestamp = Date.now();
          this.tableStates[canonicalId] = state;
          availableConcurrentSlots--;

          this.addAIPredictionToLog(prediction);

          // Thực thi cược có mutex chống tranh chấp trên cả canonicalId và table.id
          this.activeBettingTables.add(canonicalId);
          this.activeBettingTables.add(table.id);
          try {
            this.addLog(`⚡ [CƯỢC THẬT] ${prediction.tableName} (Còn ${liveRemainingTime}s | Ván ${currentRound}) ➔ ${sideName} (${confPercent}%) | ${prediction.rationale}`, 'success');
            await this.executeBet(table, targetSide, prediction.rationale);
          } finally {
            this.activeBettingTables.delete(canonicalId);
            this.activeBettingTables.delete(table.id);
          }

          // GIÃN CÁCH AN TOÀN (PACING): Tạo khoảng nghỉ 650ms giữa các bàn cược đồng thời
          // Giúp game xử lý mượt mà, chip bám chắc chắn lên bàn, tránh dồn 5 lệnh trong 50ms gây trượt bàn
          if (availableConcurrentSlots > 0 && i < finalBetsToExecute.length - 1 && this.isRunning) {
            await new Promise(r => setTimeout(r, 650));
          }
        } else {
          this.addAIPredictionToLog(prediction);
        }
      }
    } finally {
      this.isEvaluatingAllTables = false;
    }
  }

  // Đánh giá đơn lẻ từng bàn (hỗ trợ kiểm thử và gọi trực tiếp)
  async evaluateSingleTable(table) {
    if (!this.license || !this.license.valid) {
      if (this.isRunning) this.stop();
      return;
    }
    if (!table || !this.aiEngine) return;
    const isHealthy = typeof this.aiEngine.isCloudHealthy === 'function'
      ? this.aiEngine.isCloudHealthy()
      : Boolean(this.aiEngine.bridgeConnected && this.aiEngine.licenseActive);
    if (!isHealthy) return;

    const canonicalId = table.canonicalId || (window.WMBaccaratAIEngine ? window.WMBaccaratAIEngine.canonicalizeTableId(table.id, table.name) : table.id);
    const history = table.history;
    const betTime = table.betTime;

    if (!history || history.length < 2) return;
    if (this.activeBettingTables.has(canonicalId) || this.activeBettingTables.has(table.id)) return;

    const state = this.tableStates[canonicalId] || {
      lastRoundKey: '',
      lastHistoryLength: 0,
      betPlaced: false,
      betSide: null,
      betRoundNo: null,
      betShoeNo: null,
      lastBetTimestamp: 0
    };

    const roundInfo = (table.cardNode ? extractTableRoundInfo(table.cardNode) : { shoe: '0', round: 0 });
    const wsMeta = this.wsTableMeta ? this.wsTableMeta.get(canonicalId) : null;
    const currentShoe = (roundInfo.shoe && roundInfo.shoe !== '0')
      ? roundInfo.shoe
      : ((table.shoe && table.shoe !== '0') ? String(table.shoe) : (wsMeta?.shoeId || '0'));
    const currentRound = roundInfo.round || table.round || wsMeta?.roundIndex || (history.length + 1);

    const roundKey = `${canonicalId}_shoe:${currentShoe}_r:${currentRound}`;

    const isNewRound = (
      !state.lastRoundKey ||
      (state.betRoundNo && currentRound > state.betRoundNo) ||
      (history.length > (state.lastHistoryLength || 0)) ||
      (currentShoe && state.betShoeNo && currentShoe !== state.betShoeNo)
    );

    if (isNewRound) {
      state.lastRoundKey = roundKey;
      state.lastHistoryLength = history.length;
      state.betPlaced = false;
      state.betSide = null;
      state.betRoundNo = null;
      state.betShoeNo = null;
    }

    if (state.betPlaced) return;

    const now = Date.now();
    const hasPendingBet = this.betHistory.some(item => {
      if (item.result !== 'PENDING' || !item.success) return false;
      if (item.timestamp && (now - item.timestamp > 60000)) return false;
      const itemCanonical = item.canonicalTableId || (window.WMBaccaratAIEngine ? window.WMBaccaratAIEngine.canonicalizeTableId(item.tableId, item.table) : item.tableId);
      return itemCanonical === canonicalId || item.tableId === table.id;
    });
    if (hasPendingBet) return;

    const isFlash = (this.aiEngine && this.aiEngine.currentFilterMode === 'FLASH');
    const cooldownMs = isFlash ? 2000 : 10000;
    if (state.lastBetTimestamp && (now - state.lastBetTimestamp < cooldownMs)) return;

    const minTime = isFlash ? 3 : 4;
    const maxTime = 45;
    const isBetTimeValid = (typeof betTime === 'number' && betTime >= minTime && betTime <= maxTime);
    const canBet = isBetTimeValid && !state.betPlaced;

    if (canBet && this.aiEngine) {
      const prediction = this.aiEngine.generatePrediction(canonicalId, table.name || canonicalId, history, currentShoe);
      if (prediction && !prediction.stale && prediction.predicted && prediction.predicted !== 'PASS') {
        const nowMs = Date.now();
        if (prediction.cachedAt && (nowMs - prediction.cachedAt > 15000)) return;
        if (prediction.shoeId && String(prediction.shoeId) !== String(currentShoe)) {
          const isSynth = typeof prediction.shoeId === 'string' && prediction.shoeId.startsWith('shoe_');
          const isDomZero = !currentShoe || String(currentShoe) === '0';
          if (!(isSynth && isDomZero)) return;
        }
        const currentRoundId = this.aiEngine.computeRoundId(canonicalId, currentShoe, history, table.name || canonicalId);
        if (prediction.roundId && prediction.roundId !== currentRoundId) {
          const historySig = history.join('');
          const predSig = (prediction.historySig || (prediction.history ? prediction.history.join('') : ''));
          if (predSig && predSig !== historySig) return;
        }

        const targetSide = prediction.predicted;
        const sideName = targetSide === 'B' ? 'Banker' : 'Player';
        const confPercent = Math.round((prediction.confidence || 0.5) * 100);

        if (prediction.shouldBet) {
          const pendingCount = this.getPendingBetsCount();
          if (this.maxConcurrentBets > 0 && pendingCount >= this.maxConcurrentBets) {
            return;
          }

          const liveTable = this.tablesMap.get(canonicalId) || this.tablesMap.get(table.id) || table;
          const liveRemainingTime = (liveTable.betTime !== undefined && liveTable.betTime !== null) ? liveTable.betTime : betTime;
          if (typeof liveRemainingTime === 'number' && liveRemainingTime < 3) {
            return;
          }

          const betAmount = this.actualGameChip || this.selectedChip || 10;
          if (this.maxTotalBet > 0 && (this.stats.totalAmount + betAmount) > this.maxTotalBet) {
            this.stop();
            this.addLog(`🛑 [HẠN MỨC] Lệnh cược ${betAmount} sẽ vượt hạn mức tổng cược (${this.stats.totalAmount.toLocaleString('vi-VN')} + ${betAmount} > ${this.maxTotalBet.toLocaleString('vi-VN')}). Bot tự động dừng!`, 'error');
            return;
          }

          state.betPlaced = true;
          state.betSide = targetSide;
          state.betRoundNo = currentRound;
          state.betShoeNo = currentShoe;
          state.lastBetTimestamp = now;
          this.tableStates[canonicalId] = state;
          this.addAIPredictionToLog(prediction);

          this.activeBettingTables.add(canonicalId);
          this.activeBettingTables.add(table.id);
          try {
            this.addLog(`⚡ [CƯỢC THẬT] ${prediction.tableName} (Còn ${liveRemainingTime}s | Ván ${currentRound}) ➔ ${sideName} (${confPercent}%) | ${prediction.rationale}`, 'success');
            await this.executeBet(table, targetSide, prediction.rationale);
          } finally {
            this.activeBettingTables.delete(canonicalId);
            this.activeBettingTables.delete(table.id);
          }
        } else {
          this.addAIPredictionToLog(prediction);
        }
      }
    }

    this.tableStates[canonicalId] = state;
  }

  // ==========================================================================
  // CÔNG CỤ CHẨN ĐOÁN ĐA BÀN TOÀN DIỆN (N/A DEV — MULTI-TABLE DIAGNOSTICS)
  // ==========================================================================
  generateMultiTableDiagnostics() {
    const allTables = Array.from(this.tablesMap.values());
    const detectedCount = allTables.length;
    const uniqueIds = new Set(allTables.map(t => t.id)).size;
    const duplicates = detectedCount - uniqueIds;

    const evaluated = [];
    const notEvaluated = [];

    const passStats = {
      insufficientHistory: 0,
      insufficientSupport: 0,
      modelConflict: 0,
      confidenceThreshold: 0,
      tableLearnerProhibited: 0,
      invalidTimer: 0,
      pendingBet: 0,
      cooldown: 0,
      staleSignal: 0
    };

    const modelSignals = {
      markov: { B: 0, P: 0, PASS: 0 },
      streak: { B: 0, P: 0, PASS: 0 },
      table:  { B: 0, P: 0, PASS: 0 },
      ensemble: { B: 0, P: 0, PASS: 0 }
    };

    const idSourceBreakdown = {
      WS_AUTHORITATIVE: 0,
      DOM_SHOE_EXPLICIT: 0,
      DOM_FULL_SHOE_GENESIS: 0,
      DOM_PARTIAL_EARLY: 0
    };

    const tableDetails = [];
    const now = Date.now();
    const isFlash = (this.aiEngine && this.aiEngine.currentFilterMode === 'FLASH');
    const minHistLen = isFlash ? 3 : 4;
    const minTimer = isFlash ? 3 : 4;
    const maxTimer = isFlash ? 50 : 45;

    for (const t of allTables) {
      const history = t.history || [];
      const betTime = t.betTime;
      const isTimerValid = (typeof betTime === 'number' && betTime >= minTimer && betTime <= maxTimer);
      const canonicalId = t.canonicalId || (window.WMBaccaratAIEngine && typeof window.WMBaccaratAIEngine.canonicalizeTableId === 'function'
        ? window.WMBaccaratAIEngine.canonicalizeTableId(t.id, t.name || '')
        : String(t.id));
      const shoeId = t.shoe || '0';
      const roundIdx = (typeof t.fullShoeLength === 'number' && t.fullShoeLength > 0) ? t.fullShoeLength : history.length;
      const idSource = t.idSource || 'DOM_PARTIAL_EARLY';
      idSourceBreakdown[idSource] = (idSourceBreakdown[idSource] || 0) + 1;

      const hasPending = this.betHistory.some(
        item => item.tableId === t.id && item.result === 'PENDING' && (!item.timestamp || (now - item.timestamp < 60000))
      );

      let ensPred = 'PASS';
      let gateReason = 'OK';
      let cloudPattern = 'CLOUD';
      let cloudRationale = '';

      if (!isTimerValid) {
        passStats.invalidTimer++;
        gateReason = `INVALID_TIMER(${betTime}s)`;
      } else if (hasPending) {
        passStats.pendingBet++;
        gateReason = 'PENDING_BET';
      }

      if (history.length < minHistLen) {
        passStats.insufficientHistory++;
        if (gateReason === 'OK') gateReason = `INSUFFICIENT_HISTORY(${history.length})`;
      } else if (this.aiEngine && typeof this.aiEngine.generatePrediction === 'function') {
        evaluated.push(t.id);
        const pred = this.aiEngine.generatePrediction(t.id, t.name || t.id, history, shoeId);
        ensPred = (pred && !pred.stale && pred.predicted) ? pred.predicted : 'PASS';
        modelSignals.ensemble[ensPred] = (modelSignals.ensemble[ensPred] || 0) + 1;

        if (pred && pred.stale) {
          passStats.staleSignal++;
          if (gateReason === 'OK') gateReason = 'STALE_OR_DISCONNECTED';
        } else if (pred && pred.gateReason) {
          if (pred.gateReason === 'MODEL_CONFLICT') passStats.modelConflict++;
          else if (pred.gateReason === 'MARGIN_TOO_THIN') passStats.confidenceThreshold++;
          else if (pred.gateReason === 'LACK_OF_CONSENSUS') passStats.insufficientSupport++;
          else if (pred.gateReason === 'TABLE_LEARNER_STANDALONE_PROHIBITED') passStats.tableLearnerProhibited++;
          if (gateReason === 'OK' && ensPred === 'PASS') gateReason = pred.gateReason;
        }

        if (pred && pred.patternContext && pred.patternContext.id) {
          cloudPattern = `${pred.patternContext.id} ${pred.patternContext.name || ''}`.trim();
        }
        if (pred && pred.rationale) {
          cloudRationale = pred.rationale;
        }
      } else {
        notEvaluated.push(t.id);
      }

      tableDetails.push({
        id: t.id,
        canonicalId: canonicalId,
        name: t.name || t.id,
        shoeId: shoeId,
        roundIdx: roundIdx,
        idSource: idSource,
        betTime: betTime || 0,
        histLen: history.length,
        markov: 'VPS',
        streak: 'VPS',
        table: cloudPattern,
        ensemble: ensPred,
        gateReason: gateReason,
        rationale: cloudRationale
      });
    }

    const lines = [
      '==================================================',
      '        N/A DEV — MULTI-TABLE DIAGNOSTICS          ',
      '==================================================',
      `Detected tables: ${detectedCount}`,
      `Unique table IDs: ${uniqueIds}`,
      `Duplicate table IDs: ${duplicates}`,
      `Evaluated tables: ${evaluated.length}`,
      `Not evaluated (limit/unready): ${detectedCount - evaluated.length}`,
      '',
      '--- IDENTITY SOURCE BREAKDOWN ---',
      `WS_AUTHORITATIVE: ${idSourceBreakdown.WS_AUTHORITATIVE || 0} | DOM_SHOE_EXPLICIT: ${idSourceBreakdown.DOM_SHOE_EXPLICIT || 0} | DOM_FULL_SHOE_GENESIS: ${idSourceBreakdown.DOM_FULL_SHOE_GENESIS || 0} | DOM_PARTIAL_EARLY: ${idSourceBreakdown.DOM_PARTIAL_EARLY || 0}`,
      '',
      '--- PASS / FILTER BREAKDOWN ---',
      `PASS insufficient history (<${minHistLen}): ${passStats.insufficientHistory}`,
      `PASS insufficient support: ${passStats.insufficientSupport}`,
      `PASS model conflict: ${passStats.modelConflict}`,
      `PASS confidence threshold: ${passStats.confidenceThreshold}`,
      `PASS Table Learner standalone prohibited: ${passStats.tableLearnerProhibited}`,
      `PASS stale or disconnected Cloud signal: ${passStats.staleSignal}`,
      `Invalid or stale timer (not ${minTimer}-${maxTimer}s): ${passStats.invalidTimer}`,
      `Has pending bet: ${passStats.pendingBet}`,
      '',
      '--- CLOUD ENSEMBLE SIGNALS DISTRIBUTION ---',
      `Ensemble (Cloud VPS): B: ${modelSignals.ensemble.B || 0} | P: ${modelSignals.ensemble.P || 0} | PASS: ${modelSignals.ensemble.PASS || 0}`,
      '',
      '--- TABLE MAPPINGS & LIVE SIGNALS ---'
    ];

    for (const td of tableDetails.slice(0, 40)) {
      const ratStr = td.rationale ? ` | ${td.rationale}` : '';
      lines.push(`• [${td.name}] (ID: ${td.id} | CanonicalID: ${td.canonicalId} | ShoeID: ${td.shoeId} | RoundIdx: ${td.roundIdx} | IDSource: ${td.idSource}) | Time: ${td.betTime}s | Mẫu: ${td.histLen} | Cầu:${td.table} => Cloud AI:${td.ensemble} [${td.gateReason}]${ratStr}`);
    }
    lines.push('==================================================');

    return {
      text: lines.join('\n'),
      stats: {
        detectedCount,
        uniqueIds,
        evaluatedCount: evaluated.length,
        idSourceBreakdown,
        passStats,
        modelSignals,
        tableDetails
      }
    };
  }

  matchesPattern(historyArray, condition) {
    if (historyArray.length < condition.length) return false;
    const endSlice = historyArray.slice(-condition.length).join('');
    if (endSlice !== condition) return false;

    const prevIndex = historyArray.length - condition.length - 1;
    if (prevIndex >= 0) {
      if (historyArray[prevIndex] === condition[0]) {
        return false;
      }
    }
    return true;
  }

  // ==========================================================================
  // BỘ TỰ ĐỘNG CHỌN CHIP TRÊN BÀN GAME WM CASINO
  // Hỗ trợ XPath chính xác do User cung cấp:
  // Chip 10: (//div[@name='10'])[1]
  // Chip 20: (//div[@name='20'])[1]
  // Chip 50: (//div[@name='50'])[1]
  // ==========================================================================
  selectGameChip(chipValue) {
    const chipStr = String(chipValue);
    try {
      // 1. Thử click trực tiếp trong main document trước
      const localChip = this.findValidVisibleChip(document, chipStr);
      if (localChip) {
        this.simulateRealClick(localChip);
      }

      // 2. Gửi tín hiệu tới các iframes (bao gồm mọi window targets)
      const targets = this.getAllTargetWindows();
      targets.forEach((win) => {
        try {
          win.postMessage({
            action: 'SELECT_CHIP',
            chip: chipStr,
            messageId: ++this.messageIdCounter
          }, '*');
        } catch (e) {}
      });
    } catch (e) {}
    return true;
  }

  simulateRealClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.click();
    } catch (err) {
      try { el.click(); } catch (e) {}
    }
  }

  findValidVisibleChip(doc, chipStr) {
    if (!doc) return null;

    const variants = [chipStr];
    if (chipStr === '1000') variants.push('1k', '1K');
    if (chipStr === '5000') variants.push('5k', '5K');
    if (chipStr === '10000') variants.push('10k', '10K');
    if (chipStr === '20000') variants.push('20k', '20K');
    if (chipStr === '50000') variants.push('50k', '50K');

    // 1. Khung chuẩn của WM: #mult_chips_box hoặc .chip_box
    try {
      const box = doc.getElementById('mult_chips_box') || doc.querySelector('.chip_box');
      if (box) {
        for (const val of variants) {
          const chip = box.querySelector(`[name="${val}"], .chip_b_${val}`);
          if (chip) return chip;
        }
      }
    } catch (e) {}

    // 2. XPath chuẩn người dùng cung cấp: (//div[@name='${val}'])[1]
    for (const val of variants) {
      try {
        const xpath = `(//div[@name='${val}'])[1]`;
        const res = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res && res.singleNodeValue) return res.singleNodeValue;
      } catch (e) {}

      try {
        const xpath = `(//*[@name='${val}'])[1]`;
        const res = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res && res.singleNodeValue) return res.singleNodeValue;
      } catch (e) {}
    }

    // 3. CSS querySelector
    for (const val of variants) {
      try {
        const el = doc.querySelector(`.chip_item[name="${val}"], div[name="${val}"], [name="${val}"], .chip_b_${val}`);
        if (el) return el;
      } catch (e) {}
    }

    return null;
  }

  triggerFullClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
    } catch (e) {}
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 10, height: 10 };
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);
    const win = el.ownerDocument?.defaultView || window;
    const eventInit = { bubbles: true, cancelable: true, view: win, clientX, clientY };

    try { el.dispatchEvent(new PointerEvent('pointerover', eventInit)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerenter', eventInit)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerdown', eventInit)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', eventInit)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', eventInit)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', eventInit)); } catch (e) {}
    try {
      if (typeof Touch !== 'undefined' && typeof TouchEvent !== 'undefined') {
        const touch = new Touch({ identifier: Date.now(), target: el, clientX, clientY });
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
        el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
      }
    } catch (e) {}
    try {
      el.click();
    } catch (err) {}
  }

  // Tạo danh sách ID ứng viên cho bàn chơi theo chuẩn WM Casino
  getCandidateTableIds(table) {
    const candidates = new Set();
    if (!table) return [];

    if (table.id) candidates.add(table.id);
    if (table.rawId) candidates.add(table.rawId);
    if (table.cardNode && table.cardNode.id) candidates.add(table.cardNode.id);
    try {
      const closestContainer = table.cardNode?.closest?.('[id^="groupMultiple_"], [id^="box_pc_"]');
      if (closestContainer && closestContainer.id) candidates.add(closestContainer.id);
    } catch (e) {}

    const allStrings = [table.id, table.rawId, table.name, table.cardNode?.id].filter(Boolean);
    for (const str of allStrings) {
      const gmMatch = str.match(/groupMultiple_(\d+)_(\d+)/i);
      if (gmMatch) {
        candidates.add(`groupMultiple_${gmMatch[1]}_${gmMatch[2]}`);
        candidates.add(`groupMultiple_101_${gmMatch[2]}`);
      }
      const pcMatch = str.match(/box_pc_(\d+)/i);
      if (pcMatch) {
        candidates.add(`box_pc_${pcMatch[1]}`);
      }
    }

    const nameStr = table.name || '';
    const numMatches = (nameStr + ' ' + (table.id || '')).match(/\b\d+\b/g) || [];
    const numbers = Array.from(new Set(numMatches.map(n => parseInt(n)).filter(n => !isNaN(n) && n > 0)));

    for (const num of numbers) {
      // 1. groupMultiple variants
      [0, 1, 101].forEach(gt => {
        candidates.add(`groupMultiple_${gt}_${num}`);
        candidates.add(`groupMultiple_${gt}_${String(num).padStart(2, '0')}`);
        if (num >= 1 && num <= 50) {
          candidates.add(`groupMultiple_${gt}_${100 + num}`);
          candidates.add(`groupMultiple_${gt}_${200 + num}`);
          candidates.add(`groupMultiple_${gt}_${300 + num}`);
          candidates.add(`groupMultiple_${gt}_${500 + num}`);
          candidates.add(`groupMultiple_${gt}_${600 + num}`);
        }
        if (num >= 101 && num <= 699) {
          candidates.add(`groupMultiple_${gt}_${num}`);
        }
      });

      // 2. box_pc variants (Chuẩn giao diện PC WM Casino)
      candidates.add(`box_pc_${num}`);
      candidates.add(`box_pc_${String(num).padStart(2, '0')}`);
      if (num >= 1 && num <= 50) {
        candidates.add(`box_pc_${100 + num}`);
        candidates.add(`box_pc_${200 + num}`);
        candidates.add(`box_pc_${300 + num}`);
        candidates.add(`box_pc_${500 + num}`);
        candidates.add(`box_pc_${600 + num}`);
      }
      if (num >= 101 && num <= 699) {
        candidates.add(`box_pc_${num}`);
      }
    }

    return Array.from(candidates);
  }

  // Tìm nút cược Player / Banker bằng ID, XPath chuẩn và DOM traversal
  findTargetBetButton(table, betTarget) {
    const betSuffix = betTarget === 'B' ? 'Banker' : 'Player';
    const candidateIds = this.getCandidateTableIds(table);

    const docs = [document];
    const allIframes = Array.from(document.querySelectorAll('iframe'));
    for (const ifr of allIframes) {
      try {
        const iDoc = ifr.contentDocument || ifr.contentWindow?.document;
        if (iDoc && !docs.includes(iDoc)) docs.push(iDoc);
      } catch (e) {}
    }

    // 1. Tìm theo ID chính xác trên tất cả documents
    for (const doc of docs) {
      if (!doc) continue;
      for (const cid of candidateIds) {
        try {
          if (doc.getElementById) {
            const el = doc.getElementById(`${cid}_betArea${betSuffix}`) ||
                       doc.getElementById(`${cid}_betArea_${betSuffix}`) ||
                       doc.getElementById(`${cid}_${betSuffix}`);
            if (el) return el;
          }
          if (doc.querySelector) {
            const el = doc.querySelector(`#${cid}_betArea${betSuffix}, #${cid}_betArea_${betSuffix}, #${cid} [id*="betArea${betSuffix}"], #${cid} [class*="betArea${betSuffix}"], #${cid} [data-bet="${betSuffix}"]`);
            if (el) return el;
          }
        } catch (e) {}
      }
    }

    // 2. Tìm theo XPath chính xác người dùng cung cấp: (//div[@id='${cid}_betArea${betSuffix}'])[1]
    for (const doc of docs) {
      if (!doc || !doc.evaluate) continue;
      for (const cid of candidateIds) {
        try {
          const xpath = `(//div[@id='${cid}_betArea${betSuffix}'])[1]`;
          const res = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          if (res && res.singleNodeValue) return res.singleNodeValue;
        } catch (e) {}
        try {
          const xpathAny = `(//*[@id='${cid}_betArea${betSuffix}'])[1]`;
          const res = doc.evaluate(xpathAny, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          if (res && res.singleNodeValue) return res.singleNodeValue;
        } catch (e) {}
      }
    }

    // 3. Tìm trong phạm vi cardNode của bàn nếu có
    if (table.cardNode) {
      try {
        const sel = `[id$="_betArea${betSuffix}"], [id*="_betArea${betSuffix}"], .betArea${betSuffix}, [class*="betArea${betSuffix}"]`;
        const el = table.cardNode.querySelector ? table.cardNode.querySelector(sel) : null;
        if (el) return el;
      } catch (e) {}

      try {
        const allCardEls = table.cardNode.querySelectorAll ? table.cardNode.querySelectorAll('div, button, span, a') : [];
        for (const el of allCardEls) {
          const txt = (el.innerText || el.textContent || '').trim();
          const isPair = /pair|đôi/i.test(txt) || /pair|đôi/i.test(el.className || '') || /pair|đôi/i.test(el.id || '');
          if (isPair) continue;

          if (betSuffix === 'Banker') {
            if (/^(?:Banker|Nhà\s*Cái|Cái|庄|莊)(?:\s*1:0\.95)?$/i.test(txt) || txt === '1:0.95' || txt === '0.95') {
              return (el.closest ? el.closest('[id*="betArea"], [class*="bet"], [class*="area"], button, div') : null) || el;
            }
          } else {
            if (/^(?:Player|Nhà\s*Con|Con|闲|閒)(?:\s*1:1)?$/i.test(txt) || txt === '1:1') {
              return (el.closest ? el.closest('[id*="betArea"], [class*="bet"], [class*="area"], button, div') : null) || el;
            }
          }
        }
      } catch (e) {}
    }

    // 4. Fallback vào nút đã lưu trong table
    const cachedBtn = betTarget === 'B' ? table.bankerBtn : table.playerBtn;
    if (cachedBtn) return cachedBtn;

    return null;
  }

  getAllTargetWindows() {
    const targets = [];
    const seen = new Set();
    function collect(w) {
      if (!w || seen.has(w)) return;
      seen.add(w);
      targets.push(w);
      try {
        for (let i = 0; i < w.frames.length; i++) {
          collect(w.frames[i]);
        }
      } catch (e) {}
    }
    try {
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(ifr => {
        try {
          if (ifr && ifr.contentWindow) collect(ifr.contentWindow);
        } catch (e) {}
      });
      for (let i = 0; i < window.frames.length; i++) {
        collect(window.frames[i]);
      }
    } catch (e) {}
    return targets;
  }

  isTrustedFrameSource(sourceWindow) {
    if (!sourceWindow) return false;
    if (sourceWindow === window) return true;
    try {
      if (sourceWindow.top === window || sourceWindow.top === window.top) return true;
    } catch (e) {}
    try {
      if (sourceWindow.parent === window || sourceWindow.parent === window.top) return true;
    } catch (e) {}
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const ifr of iframes) {
        if (ifr && ifr.contentWindow === sourceWindow) return true;
      }
    } catch (e) {}
    try {
      for (let i = 0; i < window.frames.length; i++) {
        if (window.frames[i] === sourceWindow) return true;
      }
    } catch (e) {}
    return true; // Phản hồi hợp lệ từ frame con trên trang
  }

  // Phát tín hiệu cược tới iframe kèm danh sách Candidate IDs
  async broadcastClickBetZoneToIframes(tableId, candidateIds, betTarget, chip) {
    const allTargets = this.getAllTargetWindows();
    if (allTargets.length === 0) return false;

    const msgId = ++this.messageIdCounter;

    return new Promise((resolve) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', onMessage);
          resolve(false);
        }
      }, 3000);

      const onMessage = (event) => {
        if (!this.isTrustedFrameSource(event.source)) return;
        const data = event.data;
        if (!data || data.type !== 'WM_IFRAME_RESPONSE') return;
        if (data.messageId === msgId && data.action === 'CLICK_BET_ZONE') {
          // Chỉ resolve khi đúng iframe sảnh game thực thi thành công!
          // Bỏ qua phản hồi false từ các iframe con khác không chứa bàn game
          if (data.success) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              window.removeEventListener('message', onMessage);
              resolve(true);
            }
          }
        }
      };

      window.addEventListener('message', onMessage);

      allTargets.forEach((ifr) => {
        try {
          ifr.postMessage({
            action: 'CLICK_BET_ZONE',
            tableId: tableId,
            candidateIds: candidateIds,
            bet: betTarget,
            chip: chip,
            messageId: msgId,
            tradingMode: this.aiEngine ? this.aiEngine.tradingMode : 'PAPER',
            realConfirmed: Boolean(this.aiEngine && this.aiEngine.tradingMode === 'REAL'),
            isPaper: Boolean(!this.aiEngine || this.aiEngine.tradingMode === 'PAPER')
          }, '*');
        } catch (e) {}
      });
    });
  }

  async executeBet(table, pattern, reason = '') {
    const rawTableName = String(table?.name || table?.id || '');
    const rawTableId = String(table?.id || '');
    if (rawTableName.includes('1415') || rawTableId.includes('1415') || !isStrictTableId(rawTableId)) {
      if (table?.id) this.tablesMap.delete(table.id);
      if (table?.canonicalId) this.tablesMap.delete(table.canonicalId);
      return false;
    }

    const betTarget = typeof pattern === 'string' ? pattern : (pattern.bet || 'B');
    const betTargetName = betTarget === 'B' ? 'Banker' : 'Player';
    const oppositeSide = betTarget === 'B' ? 'P' : 'B';
    const oppositeSideName = betTarget === 'B' ? 'Player' : 'Banker';
    const currentChip = this.actualGameChip || this.selectedChip || 10;
    const amount = currentChip;
    const isPaperTrading = Boolean(this.aiEngine && this.aiEngine.tradingMode === 'PAPER');

    const canonicalId = table.canonicalId || (window.WMBaccaratAIEngine ? window.WMBaccaratAIEngine.canonicalizeTableId(table.id, table.name) : table.id);
    const candidateIds = this.getCandidateTableIds(table);

    // BẢO VỆ CẤP ĐỘ 0: KIỂM TRA SỐ DƯ TÀI KHOẢN THỰC TẾ TRÁNH CƯỢC ẢO KHI HẾT TIỀN
    if (!isPaperTrading) {
      const userBal = this.getGameUserBalance();
      if (typeof userBal === 'number' && userBal < currentChip) {
        this.addLog(`🛑 [SỐ DƯ KHÔNG ĐỦ] Số dư thực tế (${userBal.toLocaleString('vi-VN')}k) nhỏ hơn chip cược (${currentChip.toLocaleString('vi-VN')}k)! Hủy lệnh cược ${betTargetName} để bảo vệ tài khoản, tránh tính lãi ảo!`, 'error');
        const state = this.tableStates[canonicalId] || {};
        state.lastBetFailed = true;
        state.failedBetTimestamp = Date.now();
        state.betPlaced = true;
        this.tableStates[canonicalId] = state;
        return false;
      }
    }

    // BẢO VỆ CHỐNG CƯỢC 2 ĐẦU CẤP ĐỘ 1: Kiểm tra lệnh đối diện đang chờ kết quả (Pending Bet)
    const existingOpposite = this.betHistory.find(item => {
      if (item.result !== 'PENDING' || !item.success) return false;
      const itemCan = item.canonicalTableId || (window.WMBaccaratAIEngine ? window.WMBaccaratAIEngine.canonicalizeTableId(item.tableId, item.table) : item.tableId);
      return (itemCan === canonicalId || item.tableId === table.id) && item.bet === oppositeSide;
    });
    if (existingOpposite) {
      this.addLog(`🛑 [CHỐNG CƯỢC 2 ĐẦU] Bàn ${table.name || canonicalId} đang có lệnh ${oppositeSideName} chờ kết quả! Hủy lệnh ${betTargetName} để bảo vệ tài khoản!`, 'error');
      return false;
    }

    // BẢO VỆ CHỐNG CƯỢC 2 ĐẦU CẤP ĐỘ 2: Kiểm tra DOM xem đã có chip trên ô đối diện chưa
    if (table.cardNode && this.hasPlacedBetOnSide(table.cardNode, oppositeSide, candidateIds)) {
      this.addLog(`🛑 [CHỐNG CƯỢC 2 ĐẦU] Bàn ${table.name || canonicalId} phát hiện chip thực tế trên ô ${oppositeSideName}! Hủy lệnh cược ${betTargetName}!`, 'error');
      return false;
    }

    // BẢO VỆ CẤP ĐỘ 3: Kiểm tra xem đã có chip cùng cửa trên bàn chưa (tránh cược đè lặp lại)
    if (table.cardNode && this.hasPlacedBetOnSide(table.cardNode, betTarget, candidateIds)) {
      this.addLog(`ℹ️ Bàn ${table.name || canonicalId} đã có sẵn chip ${betTargetName} trên bàn, không cược đè!`, 'info');
      return true;
    }

    let betSuccess = false;

    // Luôn cược thật 100% cho khách hàng
    this.addLog(`⚡ [CƯỢC THẬT] Đang cược chip ${currentChip} vào ${betTargetName} (${table.name || table.id})...`, 'info');

    try {
      // 1. Tự động chọn chip trước khi cược và chờ game kích hoạt chip
      this.selectGameChip(currentChip);
      await new Promise(r => setTimeout(r, 120));

      // 2. Cuộn bàn vào tầm nhìn tức thì (không dùng smooth animation tránh lệch toạ độ khi cuộn)
      if (table.cardNode && table.cardNode.scrollIntoView) {
        try {
          table.cardNode.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
        } catch (e) {}
        await new Promise(r => setTimeout(r, 60));
      }

      // 3. Tìm nút cược chính xác bằng ID và XPath
      let targetBtn = this.findTargetBetButton(table, betTarget);

      if (targetBtn) {
        this.triggerFullClick(targetBtn);

        // Bấm xác nhận cược nếu có nút confirm
        const docOwner = targetBtn.ownerDocument || document;
        const confirmBtn = (table.cardNode && table.cardNode.querySelector && table.cardNode.querySelector('[id*="confirm"], .confirm, .btn-confirm, [class*="confirm"], [class*="ok"]')) ||
          (docOwner.querySelector ? docOwner.querySelector('[id*="confirm"], .confirm, .btn-confirm, [class*="confirm"], [class*="ok"]') : null);
        if (confirmBtn) {
          await new Promise(r => setTimeout(r, 100));
          this.triggerFullClick(confirmBtn);
        }

        // Đã bấm nút cược & nút xác nhận trên bàn game thành công
        betSuccess = true;
        this.addLog(`✅ Đã đặt cược thật ${amount} vào ${betTargetName} (${table.name || table.id})!`, 'success');
      } else {
        // 4. Nếu DOM chính chưa bắt được, phát lệnh CLICK_BET_ZONE tới iframe
        const iframeSuccess = await this.broadcastClickBetZoneToIframes(table.id, candidateIds, betTarget, currentChip);
        if (iframeSuccess) {
          betSuccess = true;
          this.addLog(`✅ Đã đặt cược thật ${amount} vào ${betTargetName} (${table.name || table.id}) qua iframe!`, 'success');
        } else {
          this.addLog(`Không tìm thấy nút cược ${betTargetName} trên bàn ${table.name || table.id}!`, 'warning');
        }
      }

    } catch (err) {
      this.addLog(`Lỗi cược thật: ${err.message}`, 'error');
    }

    // Ghi vào Lịch sử cược
    const historyItem = {
      id: 'bet_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      time: new Date().toLocaleTimeString('vi-VN'),
      timestamp: Date.now(),
      table: table.name || table.id,
      tableId: table.id,
      canonicalTableId: canonicalId,
      round: table.round || null,
      shoe: table.shoe || null,
      bet: betTarget,
      chip: currentChip,
      amount: amount,
      pattern: reason || (typeof pattern === 'string' ? `AI-${betTarget}` : `${pattern.condition}=${pattern.bet}`),
      success: betSuccess,
      mode: isPaperTrading ? 'PAPER' : 'REAL',
      isPaperTrading: isPaperTrading,
      historyLengthAtBet: (table.history || []).length,
      historySigAtBet: (table.history || []).join(''),
      result: betSuccess ? 'PENDING' : 'FAILED',
      roundOutcome: null,
      profit: 0
    };

    if (!betSuccess) {
      const state = this.tableStates[canonicalId] || {};
      state.lastBetFailed = true;
      state.failedBetTimestamp = Date.now();
      state.betPlaced = true;
      this.tableStates[canonicalId] = state;
    }

    this.betHistory.unshift(historyItem);
    this.trimBetHistoryAndAccumulate(10);
    this.recalculateStats();
    this.saveBetHistory();
    this.renderBetHistory();

    // Kiểm tra nếu tổng tiền cược đã đạt hạn mức tối đa thì lập tức dừng bot
    if (this.isRunning && this.maxTotalBet > 0 && this.stats.totalAmount >= this.maxTotalBet) {
      this.stop();
      this.addLog(`🛑 [HẠN MỨC] ĐÃ ĐẠT HẠN MỨC TỔNG TIỀN CƯỢC (${this.stats.totalAmount.toLocaleString('vi-VN')} / ${this.maxTotalBet.toLocaleString('vi-VN')}). Bot tự động dừng!`, 'error');
    }
  }

  // ==========================================================================
  // BỘ KIỂM TRA & TÍNH KẾT QUẢ THẮNG / THUA TỰ ĐỘNG
  // ==========================================================================
  checkPendingBetResults() {
    let hasChanges = false;
    const now = Date.now();

    this.betHistory.forEach(item => {
      // Xét các lệnh đang PENDING hoặc vừa TIMEOUT trong 120s để đối soát kết quả chính xác
      if ((item.result !== 'PENDING' && item.result !== 'TIMEOUT') || !item.success) return;
      if (item.result === 'TIMEOUT' && (now - (item.timestamp || 0) > 120000)) return;

      // Quá 65 giây không có kết quả -> tạm chuyển TIMEOUT để giải phóng slot cược đồng thời
      if (item.result === 'PENDING' && (now - (item.timestamp || 0) > 65000)) {
        item.result = 'TIMEOUT';
        item.profit = 0;
        hasChanges = true;
      }

      // 1. Tìm trực tiếp theo canonicalId hoặc tableId
      let table = this.tablesMap.get(item.canonicalTableId) || this.tablesMap.get(item.tableId);

      // 2. TÌM KIẾM DỰ PHÒNG THÔNG MINH (FALLBACK MATCHING):
      // Nếu không tìm thấy bàn hoặc chuỗi cầu chưa thay đổi, quét toàn bộ tablesMap tìm bàn có cùng số bàn
      if (!table || !table.history || table.history.join('') === item.historySigAtBet) {
        const numMatch = (item.canonicalTableId || '' + ' ' + (item.table || '')).match(/\b(\d{1,4})\b/);
        if (numMatch) {
          const targetNum = numMatch[1];
          for (const [k, t] of this.tablesMap.entries()) {
            if (!t || !t.history || t.history.length === 0) continue;
            const kNumMatch = (k + ' ' + (t.name || '') + ' ' + (t.rawId || '')).match(/\b(\d{1,4})\b/);
            if (kNumMatch && kNumMatch[1] === targetNum) {
              const sig = t.history.join('');
              if (sig !== item.historySigAtBet) {
                table = t;
                item.canonicalTableId = k; // Cập nhật lại key chuẩn để lần sau khớp ngay lập tức
                break;
              }
            }
          }
        }
      }

      if (!table || !table.history || table.history.length === 0) return;

      const currentSig = table.history.join('');
      // Nếu chuỗi cầu chưa thay đổi gì so với lúc đặt cược -> ván chưa có kết quả
      if (currentSig === item.historySigAtBet) {
        return;
      }

      // Ván đã ra kết quả mới! Xác định outcome
      let outcome = null;
      if (typeof item.historyLengthAtBet === 'number' && table.history.length > item.historyLengthAtBet) {
        outcome = table.history[item.historyLengthAtBet];
      } else {
        // Trường hợp đã chạm trần slice hoặc độ dài bằng nhau, lấy ván mới nhất vừa ra
        outcome = table.history[table.history.length - 1];
      }

      if (!outcome) return;

      item.roundOutcome = outcome;

      const isPaper = Boolean(item.isPaperTrading || item.mode === 'PAPER');
      const tag = isPaper ? ' - PAPER' : '';

      if (outcome === 'T') {
        item.result = 'TIE';
        item.profit = 0;
        this.addLog(`🟡 [HÒA TIỀN${tag}] ${item.table}: Cược ${item.bet === 'B' ? 'Banker' : 'Player'} ➔ Kết quả HÒA (Tie) | Hoàn 0`, 'info');
      } else if (outcome === item.bet) {
        item.result = 'WIN';
        // Tiền thắng: Player ăn 1:1, Banker ăn 1:0.95 (chính xác đến 2 chữ số thập phân)
        item.profit = item.bet === 'B' ? Math.round(item.amount * 0.95 * 100) / 100 : item.amount;
        const profitDisplay = item.profit.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
        this.addLog(`🎉 [THẮNG CƯỢC${tag}] ${item.table}: Cược ${item.bet === 'B' ? 'Banker' : 'Player'} ➔ Ra ${outcome} | +${profitDisplay}`, 'success');
      } else {
        item.result = 'LOSS';
        item.profit = -item.amount;
        this.addLog(`💥 [THUA CƯỢC${tag}] ${item.table}: Cược ${item.bet === 'B' ? 'Banker' : 'Player'} ➔ Ra ${outcome} | -${item.amount}`, 'error');
      }

      hasChanges = true;
    });

    if (hasChanges) {
      this.trimBetHistoryAndAccumulate(10);
      this.recalculateStats();
      this.saveBetHistory();
      this.renderBetHistory();
      if (this.gatewayUrl && this.gatewaySid) {
        setTimeout(() => this.fetchOfficialGameReport(), 1500);
      }
    }
  }

  getPendingBetsCount() {
    const now = Date.now();
    const pendingTableIds = new Set();
    this.betHistory.forEach(item => {
      if (item.result === 'PENDING' && item.success !== false && (!item.timestamp || (now - item.timestamp < 35000))) {
        const cId = item.canonicalTableId || (window.WMBaccaratAIEngine ? window.WMBaccaratAIEngine.canonicalizeTableId(item.tableId, item.table) : item.tableId);
        pendingTableIds.add(cId);
      }
    });
    for (const tid of this.activeBettingTables) {
      const cId = (window.WMBaccaratAIEngine && typeof window.WMBaccaratAIEngine.canonicalizeTableId === 'function')
        ? window.WMBaccaratAIEngine.canonicalizeTableId(tid, '')
        : tid;
      pendingTableIds.add(cId);
    }
    return pendingTableIds.size;
  }

  updateLimitProgressUI() {
    const progressText = document.getElementById('wm-limit-progress-text');
    const percentEl = document.getElementById('wm-limit-percent');
    if (progressText && percentEl) {
      const currentTotal = this.stats.totalAmount || 0;
      const maxLimit = this.maxTotalBet || 0;

      if (maxLimit <= 0) {
        progressText.textContent = `${currentTotal.toLocaleString('vi-VN')} (Không giới hạn)`;
        progressText.style.color = '#94a3b8';
        percentEl.textContent = '∞';
        percentEl.style.color = '#38bdf8';
      } else {
        const percent = Math.min(100, Math.round((currentTotal / maxLimit) * 100));
        progressText.textContent = `${currentTotal.toLocaleString('vi-VN')} / ${maxLimit.toLocaleString('vi-VN')}`;

        if (percent >= 100) {
          progressText.style.color = '#ef4444';
          percentEl.style.color = '#ef4444';
          percentEl.textContent = '100% (ĐẠT HẠN MỨC)';
        } else if (percent >= 80) {
          progressText.style.color = '#f59e0b';
          percentEl.style.color = '#f59e0b';
          percentEl.textContent = `${percent}%`;
        } else {
          progressText.style.color = '#38bdf8';
          percentEl.style.color = '#10b981';
          percentEl.textContent = `${percent}%`;
        }
      }
    }

    // Cập nhật trạng thái cược đồng thời
    const concurrentText = document.getElementById('wm-concurrent-status-text');
    const concurrentBadge = document.getElementById('wm-concurrent-badge');
    if (concurrentText && concurrentBadge) {
      const pendingCount = this.getPendingBetsCount();
      const maxConcurrent = this.maxConcurrentBets || 0;

      if (maxConcurrent <= 0) {
        concurrentText.textContent = `${pendingCount} lệnh (Không giới hạn)`;
        concurrentText.style.color = '#94a3b8';
        concurrentBadge.textContent = 'KHÔNG GIỚI HẠN';
        concurrentBadge.style.color = '#38bdf8';
      } else {
        concurrentText.textContent = `${pendingCount} / ${maxConcurrent} lệnh`;
        if (pendingCount >= maxConcurrent) {
          concurrentText.style.color = '#f59e0b';
          concurrentBadge.textContent = 'ĐANG ĐẦY';
          concurrentBadge.style.color = '#ef4444';
        } else {
          concurrentText.style.color = '#38bdf8';
          concurrentBadge.textContent = 'SẴN SÀNG';
          concurrentBadge.style.color = '#10b981';
        }
      }
    }
  }

  updateHeaderMetrics() {
    const metricBets = document.getElementById('wm-metric-bets');
    if (metricBets) metricBets.textContent = this.stats.totalBets;

    const metricAmount = document.getElementById('wm-metric-total-amount');
    if (metricAmount) metricAmount.textContent = this.stats.totalAmount.toLocaleString('vi-VN');

    const metricWins = document.getElementById('wm-metric-wins');
    if (metricWins) metricWins.textContent = this.stats.wins;

    const metricProfit = document.getElementById('wm-metric-profit');
    if (metricProfit) {
      const p = this.stats.totalProfit;
      const formattedProfit = p.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
      metricProfit.textContent = (p > 0 ? `+${formattedProfit}` : `${formattedProfit}`);
      metricProfit.style.color = p > 0 ? '#10b981' : (p < 0 ? '#ef4444' : '#facc15');
    }

    this.updateLimitProgressUI();
    this.updateMiniPill();
  }

  renderBetHistory() {
    const tbody = document.getElementById('wm-history-tbody');
    const badge = document.getElementById('wm-tab-badge-history');
    if (badge) badge.textContent = this.betHistory.length;

    const statTotal = document.getElementById('wm-stat-total-bets');
    const statAmount = document.getElementById('wm-stat-total-amount');
    const statWins = document.getElementById('wm-stat-wins');
    const statLosses = document.getElementById('wm-stat-losses');
    const statWinrate = document.getElementById('wm-stat-winrate');
    const statProfit = document.getElementById('wm-stat-profit');

    if (statTotal) statTotal.textContent = this.stats.totalBets;
    if (statAmount) statAmount.textContent = this.stats.totalAmount.toLocaleString('vi-VN');
    if (statWins) statWins.textContent = this.stats.wins;
    if (statLosses) statLosses.textContent = this.stats.losses;
    if (statWinrate) statWinrate.textContent = `${this.stats.winRate}%`;
    if (statProfit) {
      const p = this.stats.totalProfit;
      const formattedProfit = p.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
      statProfit.textContent = (p > 0 ? `+${formattedProfit}` : `${formattedProfit}`);
      statProfit.style.color = p > 0 ? '#10b981' : (p < 0 ? '#ef4444' : '#facc15');
    }

    // Cập nhật dòng footer tổng cộng ở chân bảng
    const tfoot = document.getElementById('wm-history-tfoot');
    const tfootAmount = document.getElementById('wm-tfoot-total-amount');
    const tfootWinLoss = document.getElementById('wm-tfoot-win-loss');
    const tfootProfit = document.getElementById('wm-tfoot-profit');

    if (tfoot) {
      if (this.betHistory.length > 0 || (this.stats && this.stats.totalBets > 0)) {
        tfoot.style.display = 'table-footer-group';
        if (tfootAmount) tfootAmount.textContent = this.stats.totalAmount.toLocaleString('vi-VN');
        if (tfootWinLoss) tfootWinLoss.textContent = `${this.stats.wins}W - ${this.stats.losses}L (${this.stats.winRate}%)`;
        if (tfootProfit) {
          const p = this.stats.totalProfit;
          const formattedProfit = p.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
          tfootProfit.textContent = (p > 0 ? `+${formattedProfit}` : `${formattedProfit}`);
          tfootProfit.style.color = p > 0 ? '#10b981' : (p < 0 ? '#ef4444' : '#facc15');
        }
      } else {
        tfoot.style.display = 'none';
      }
    }

    this.updateHeaderMetrics();

    if (!tbody) return;

    if (this.betHistory.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding:25px 10px; color:#64748b;">
            Chưa có lịch sử cược nào được ghi nhận.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this.betHistory.slice(0, 10).map(item => {
      const betBadge = item.bet === 'B' 
        ? '<span class="wm-badge-bet banker">🔴 Banker</span>' 
        : '<span class="wm-badge-bet player">🔵 Player</span>';
      
      let resultHtml = '';
      let profitHtml = '';

      if (item.result === 'WIN') {
        const outStr = item.roundOutcome ? ` (${item.roundOutcome})` : '';
        resultHtml = `<span class="wm-badge-result win">🎉 THẮNG${outStr}</span>`;
        const pNum = Number(item.profit) || 0;
        profitHtml = `<b style="color:#10b981;">+${pNum.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}</b>`;
      } else if (item.result === 'LOSS') {
        const outStr = item.roundOutcome ? ` (${item.roundOutcome})` : '';
        resultHtml = `<span class="wm-badge-result loss">💥 THUA${outStr}</span>`;
        const pNum = Number(item.profit) || 0;
        profitHtml = `<b style="color:#ef4444;">${pNum.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}</b>`;
      } else if (item.result === 'TIE') {
        resultHtml = `<span class="wm-badge-result tie">🟡 HÒA (Tie)</span>`;
        profitHtml = `<span style="color:#94a3b8;">0</span>`;
      } else if (item.result === 'PENDING') {
        resultHtml = `<span class="wm-badge-result pending">⏳ Đang đợi...</span>`;
        profitHtml = `<span style="color:#64748b;">--</span>`;
      } else if (item.result === 'TIMEOUT') {
        resultHtml = `<span class="wm-badge-result failed">⏱️ Hết giờ</span>`;
        profitHtml = `<span style="color:#64748b;">0</span>`;
      } else if (item.success) {
        resultHtml = `<span style="color:#10b981; font-weight:700;">✅ Đã cược</span>`;
        profitHtml = `<span style="color:#64748b;">--</span>`;
      } else {
        resultHtml = `<span class="wm-badge-result failed">❌ Lỗi cược</span>`;
        profitHtml = `<span style="color:#64748b;">0</span>`;
      }

      const patternBadge = this.formatPatternBadgeHtml(item.pattern);
      const amountStr = (Number(item.amount) || 0).toLocaleString('vi-VN');

      const safeTable = this.escapeHtml(item.table);
      return `
        <tr>
          <td class="col-time">${item.time}</td>
          <td class="col-table" title="${safeTable}"><b>${safeTable}</b></td>
          <td class="col-bet">${betBadge}</td>
          <td class="col-amount">${amountStr}</td>
          <td class="col-pattern">${patternBadge}</td>
          <td class="col-result">${resultHtml}</td>
          <td class="col-profit">${profitHtml}</td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // ĐỒNG BỘ BÁO CÁO QUYẾT TOÁN CHÍNH THỨC TỪ SERVER WM CASINO (Gateway.php?cmd=GetGameReport)
  // ==========================================================================
  startGatewaySync() {
    if (this.gatewaySyncInterval) return;
    this.gatewaySyncInterval = setInterval(() => {
      this.fetchOfficialGameReport();
    }, 15000);
    this.fetchOfficialGameReport();
  }

  getTodayDateRange() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return {
      startTime: `${y}-${m}-${d} 00:00:00`,
      endTime: `${y}-${m}-${d} 23:59:59`
    };
  }

  async fetchOfficialGameReport() {
    if (!this.gatewayUrl || !this.gatewaySid) return;
    try {
      const { startTime, endTime } = this.getTodayDateRange();
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage({
          action: 'WM_FETCH_GATEWAY_REPORT',
          gatewayUrl: this.gatewayUrl,
          sid: this.gatewaySid,
          startTime: startTime,
          endTime: endTime
        }, resp => {
          if (chrome.runtime.lastError || !resp || !resp.ok) resolve(null);
          else resolve(resp.data);
        });
      });

      if (res && res.errorCode === 0 && res.result) {
        this.applyOfficialReport(res.result.total, res.result.report);
      }
    } catch (e) {}
  }

  parseReportBets(report) {
    const list = [];
    if (!report || !Array.isArray(report)) return list;

    for (const page of report) {
      if (!page || typeof page !== 'object') continue;
      for (const key of Object.keys(page)) {
        if (key === 'subtotal') continue;
        const roundObj = page[key];
        if (!roundObj || typeof roundObj !== 'object') continue;
        for (const subKey of Object.keys(roundObj)) {
          if (subKey === 'subtotal') continue;
          const b = roundObj[subKey];
          if (b && typeof b === 'object' && b.betId) {
            list.push(b);
          }
        }
      }
    }
    list.sort((a, b) => (b.betTime || '').localeCompare(a.betTime || ''));
    return list;
  }

  applyOfficialReport(total, report) {
    if (!total && !report) return;

    let officialWinLoss = 0;
    let officialTotalBet = 0;
    let officialValidBet = 0;

    if (total) {
      officialWinLoss = parseFloat(total.winLoss) || 0;
      officialTotalBet = parseFloat(total.bet) || 0;
      officialValidBet = parseFloat(total.validbet) || 0;
    }

    const betsList = this.parseReportBets(report);
    let winsCount = 0;
    let lossesCount = 0;
    let tiesCount = 0;
    let latestCash = null;

    for (const b of betsList) {
      const wl = parseFloat(b.winLoss) || 0;
      if (wl > 0) winsCount++;
      else if (wl < 0) lossesCount++;
      else tiesCount++;

      if (latestCash === null && b.cash) {
        const c = parseFloat(b.cash);
        if (!isNaN(c)) latestCash = c;
      }
    }

    const totalBetsCount = betsList.length;

    this.stats.officialWinLoss = officialWinLoss;
    this.stats.officialTotalBet = officialTotalBet;
    this.stats.officialTotalBetsCount = totalBetsCount;

    if (latestCash !== null) {
      this.stats.realBalance = latestCash;
    }

    // ĐỐI CHIẾU VỚI BÁO CÁO NHÀ CÁI ĐỂ QUYẾT TOÁN CÁC LỆNH PENDING NGAY LẬP TỨC:
    if (betsList && betsList.length > 0 && this.betHistory) {
      let settledAny = false;
      this.betHistory.forEach(item => {
        if ((item.result !== 'PENDING' && item.result !== 'TIMEOUT') || !item.success) return;

        // Tìm vé cược tương ứng từ báo cáo chính thức nhà cái
        const matched = betsList.find(b => {
          if (!b) return false;
          // Khớp số tiền nếu có
          const bMoney = Math.round(parseFloat(b.betmoney || b.bet || b.validbet) || 0);
          const iAmount = Math.round(item.amount || item.chip || 0);
          if (bMoney > 0 && iAmount > 0 && bMoney !== iAmount) return false;

          // Khớp thời gian cược trong vòng 90s
          if (b.betTime && item.timestamp) {
            const bTime = new Date(b.betTime.replace(/-/g, '/')).getTime();
            if (!isNaN(bTime) && Math.abs(bTime - item.timestamp) > 90000) return false;
          }
          return true;
        });

        if (matched) {
          const wl = parseFloat(matched.winLoss) || 0;
          if (wl > 0) {
            item.result = 'WIN';
            item.profit = wl;
            this.addLog(`🎉 [XÁC NHẬN NHÀ CÁI - THẮNG] ${item.table}: +${wl.toLocaleString('vi-VN')} VNDK`, 'success');
          } else if (wl < 0) {
            item.result = 'LOSS';
            item.profit = wl;
            this.addLog(`💥 [XÁC NHẬN NHÀ CÁI - THUA] ${item.table}: ${wl.toLocaleString('vi-VN')} VNDK`, 'error');
          } else {
            item.result = 'TIE';
            item.profit = 0;
            this.addLog(`🟡 [XÁC NHẬN NHÀ CÁI - HÒA] ${item.table}: Hoàn tiền`, 'info');
          }
          settledAny = true;
        }
      });
      if (settledAny) {
        this.recalculateStats();
        this.renderBetHistory();
      }
    }

    this.saveBetHistory();
    this.updateMiniPill();
    this.updateLimitProgressUI();
  }

  // ==========================================================================
  // RÚT GỌN & TẠO THẺ CẦU KHỚP CHO BẢNG LỊCH SỬ (GỌN GÀNG, KHÔNG VỠ HÀNG)
  // ==========================================================================
  formatPatternBadgeHtml(raw) {
    if (!raw) return '<span class="wm-pattern-badge empty">--</span>';
    const str = String(raw).trim();
    const fullTooltip = str.replace(/"/g, '&quot;');
    
    // 1. Nhận diện các mẫu P01 - P14 của Spec V3
    const pMatch = str.match(/P(0[1-9]|1[0-4])/i);
    if (pMatch) {
      const pCode = 'P' + pMatch[1];
      let pName = '';
      if (pCode === 'P01') pName = 'Bệt B';
      else if (pCode === 'P02') pName = 'Bệt P';
      else if (pCode === 'P03') pName = 'Đảo 1-1';
      else if (pCode === 'P04') pName = 'Đôi 2-2';
      else if (pCode === 'P05') pName = 'Cầu 3-3';
      else if (pCode === 'P06') pName = 'Cầu 2-1';
      else if (pCode === 'P07') pName = 'Cầu 1-2';
      else if (pCode === 'P08') pName = 'Cầu 3-1';
      else if (pCode === 'P09') pName = 'Cầu 1-3';
      else if (pCode === 'P10') pName = 'Tăng nhịp';
      else if (pCode === 'P11') pName = 'Giảm nhịp';
      else if (pCode === 'P12') pName = 'Gãy đảo';
      else if (pCode === 'P13') pName = 'Lặp nhóm';
      else pName = 'Mẫu cầu';
      
      const pctMatch = str.match(/(\d+(?:\.\d+)?)\s*%/);
      const pctStr = pctMatch ? ' ' + Math.round(parseFloat(pctMatch[1])) + '%' : '';
      return `<span class="wm-pattern-badge pattern" title="${fullTooltip}">${pCode} ${pName}${pctStr}</span>`;
    }

    // 2. Nhận diện Markov chuỗi n-gram [PBB], [BBP],...
    const markovMatch = str.match(/Chuỗi\s*\[([BPT]+)\]/i) || str.match(/\[([BPT]{2,6})\]/);
    if (markovMatch) {
      const seq = markovMatch[1];
      const pctMatch = str.match(/(?:Xác suất\s*|conf=?)(\d+(?:\.\d+)?)\s*%/i) || str.match(/(\d+(?:\.\d+)?)\s*%/);
      const pctStr = pctMatch ? ' ' + Math.round(parseFloat(pctMatch[1])) + '%' : '';
      const isConsensus = str.toLowerCase().includes('đồng thuận') || str.toLowerCase().includes('streak');
      const prefix = isConsensus ? 'M+S' : 'Markov';
      return `<span class="wm-pattern-badge markov" title="${fullTooltip}">${prefix} [${seq}]${pctStr}</span>`;
    }

    // 3. Nhận diện Streak (Bệt)
    if (str.toLowerCase().includes('bệt') || str.toLowerCase().includes('streak')) {
      const isB = str.toLowerCase().includes('banker') || str.includes('B');
      const lenMatch = str.match(/(\d+)\s*nhịp/i) || str.match(/L[=:]\s*(\d+)/i);
      const lenStr = lenMatch ? ' L' + lenMatch[1] : '';
      const pctMatch = str.match(/(\d+(?:\.\d+)?)\s*%/);
      const pctStr = pctMatch ? ' ' + Math.round(parseFloat(pctMatch[1])) + '%' : '';
      return `<span class="wm-pattern-badge streak" title="${fullTooltip}">⚡ Bệt ${isB ? 'B' : 'P'}${lenStr}${pctStr}</span>`;
    }

    // 4. Nhận diện Rule cơ bản ví dụ: BB=P, BP=B
    if (/^[BPT]{2,4}\s*=\s*[BPT]$/i.test(str)) {
      return `<span class="wm-pattern-badge rule" title="${fullTooltip}">${str}</span>`;
    }

    // 5. Chuỗi khác (AI-B, AI-P, v.v...)
    let short = str;
    if (short.length > 15) short = short.substring(0, 14) + '…';
    return `<span class="wm-pattern-badge default" title="${fullTooltip}">${short}</span>`;
  }

  // ==========================================================================
  // HIỂN THỊ THỐNG KÊ & NHẬT KÝ DỰ ĐOÁN AI (AI LEARNING CENTER)
  // ==========================================================================
  updateTradingModeUI(mode) {
    const badge = document.getElementById('wm-ai-mode-badge');
    if (badge) {
      badge.textContent = 'CƯỢC THẬT (REAL)';
      badge.className = 'wm-ai-mode-pill real';
      badge.style.background = 'rgba(239, 68, 68, 0.2)';
      badge.style.border = '1px solid #ef4444';
      badge.style.color = '#fca5a5';
    }
    const label = document.getElementById('wm-ai-trading-mode-label');
    if (label) {
      label.textContent = '🔴 CHẾ ĐỘ: CƯỢC THẬT (TỰ ĐỘNG VÀO LỆNH)';
      label.style.color = '#fca5a5';
    }
    const bar = document.getElementById('wm-ai-trading-bar');
    if (bar) {
      bar.style.background = 'rgba(239, 68, 68, 0.08)';
      bar.style.border = '1px solid rgba(239, 68, 68, 0.25)';
    }
    const modalStatus = document.getElementById('wm-ai-modal-bet-status');
    if (modalStatus) {
      modalStatus.textContent = '🔴 CƯỢC THẬT (REAL BET) — Đang sẵn sàng';
      modalStatus.style.color = '#ef4444';
    }
    const riskEl = document.getElementById('wm-ai-risk-status');
    if (riskEl) {
      riskEl.innerHTML = '<span style="color:#ef4444; font-weight:700;">🔴 CƯỢC THẬT (Real Bet) — Tự động đặt chip</span>';
    }
  }

  renderAIStats(stats = {}, mode, bridgeConnected) {
    if (!this.overlay) return;

    const rawAcc = Number(stats.accuracy) || 0;
    const normAcc = rawAcc > 1 ? rawAcc / 100 : rawAcc;
    const pct = (rawAcc > 1 ? rawAcc : normAcc * 100).toFixed(1);

    // Cập nhật thanh tóm tắt nhanh trên Card chính (Tab Cài Đặt)
    const quickPattern = document.getElementById('wm-ai-quick-pattern');
    if (quickPattern && stats.activePattern) {
      quickPattern.textContent = `${stats.activePattern.id} ${stats.activePattern.name}`;
    } else if (quickPattern && stats.activePatternName) {
      quickPattern.textContent = stats.activePatternName;
    }
    const quickAcc = document.getElementById('wm-ai-quick-accuracy');
    if (quickAcc && stats.accuracy !== undefined) {
      quickAcc.textContent = `${pct}%`;
      quickAcc.style.color = normAcc >= 0.5 ? '#00ff88' : '#ef4444';
    }
    const quickRounds = document.getElementById('wm-ai-quick-rounds');
    if (quickRounds) {
      quickRounds.textContent = (this.stats ? this.stats.totalBets : 0);
    }

    // 0. Cập nhật trạng thái kết nối Cloud AI VPS
    const isBridge = (this.aiEngine && typeof this.aiEngine.isCloudHealthy === 'function')
      ? this.aiEngine.isCloudHealthy()
      : Boolean(bridgeConnected !== undefined ? bridgeConnected : this.aiEngine?.bridgeConnected);
    const bridgeIndicator = document.getElementById('wm-ai-bridge-status');
    if (bridgeIndicator) {
      if (isBridge) {
        bridgeIndicator.innerHTML = '<span style="color:#10b981; font-weight:600;">Hệ Thống AI N/A DEV: <b>Đang phân tích tối ưu & bảo mật 100%</b></span>';
      } else {
        bridgeIndicator.innerHTML = '<span style="color:#f59e0b; font-weight:600;">Hệ Thống AI N/A DEV: <b>Đang kết nối trung tâm dữ liệu...</b></span>';
      }
    }

    // 1. Cập nhật Badge Mode & Độ nhạy AI
    const currentFilter = (mode === 'FLASH' || mode === 'LOW' || mode === 'HIGH')
      ? mode
      : (stats.filterMode || this.aiEngine?.currentFilterMode || 'HIGH');

    this.updateTradingModeUI(this.aiEngine?.tradingMode || 'PAPER');

    // Cập nhật trạng thái nút lọc độ nhạy AI (Filter Mode)
    document.querySelectorAll('.wm-filter-btn').forEach(btn => {
      if (btn.getAttribute('data-mode') === currentFilter) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // 2. Thống kê 4 ô thân thiện cho khách hàng (loại bỏ toàn bộ dữ liệu Big Data máy chủ)
    const totalEl = document.getElementById('wm-ai-total-rounds');
    if (totalEl) totalEl.textContent = `${this.tablesMap ? this.tablesMap.size : 0} bàn`;

    const scoredEl = document.getElementById('wm-ai-scored');
    if (scoredEl) scoredEl.textContent = `${stats.predictionsScored || 0} (${stats.wins || 0}W-${stats.losses || 0}L)`;

    const accEl = document.getElementById('wm-ai-accuracy');
    if (accEl) {
      accEl.textContent = `${pct}%`;
      accEl.style.color = (normAcc >= 0.52) ? '#00ff88' : ((normAcc >= 0.48) ? '#facc15' : '#ef4444');
    }

    const profitEl = document.getElementById('wm-ai-net-profit');
    if (profitEl) {
      const pVal = this.stats ? (this.stats.totalProfit || 0) : 0;
      const pStr = pVal > 0 ? `+${pVal.toLocaleString('vi-VN')}` : (pVal < 0 ? `${pVal.toLocaleString('vi-VN')}` : '0');
      profitEl.textContent = pStr;
      profitEl.style.color = pVal >= 0 ? '#10b981' : '#ef4444';
    }

    const pendingEl = document.getElementById('wm-ai-pending');
    if (pendingEl) {
      const pendingCount = (this.aiEngine && this.aiEngine.pendingPredictions)
        ? this.aiEngine.pendingPredictions.size
        : 0;
      pendingEl.textContent = pendingCount;
    }

    // 3. Cập nhật trạng thái soi cầu & tín hiệu
    const patternEl = document.getElementById('wm-ai-active-pattern');
    if (patternEl) {
      const pName = this.escapeHtml(stats.activePatternName || 'Đang quét bàn...');
      patternEl.textContent = pName;
      patternEl.style.color = '#00f2fe';
    }

    const brierEl = document.getElementById('wm-ai-brier-score');
    if (brierEl) {
      brierEl.innerHTML = '<span style="color:#38bdf8; font-weight:600;">⚡ Tự động lọc điểm vào tối ưu</span>';
    }

    const modalBetStatus = document.getElementById('wm-ai-modal-bet-status');
    if (modalBetStatus) {
      modalBetStatus.innerHTML = '<span style="color:#10b981; font-weight:700;">🟢 CƯỢC THẬT (REAL BET) — Tự động 100%</span>';
    }
  }

  addAIPredictionToLog(prediction) {
    if (!prediction || !prediction.predicted || prediction.predicted === 'PASS') return;

    const item = {
      id: prediction.predictionRecord?.id || ('pred_' + Date.now()),
      tableId: prediction.tableId,
      tableName: prediction.tableName || prediction.tableId,
      predicted: prediction.predicted,
      prob: Math.round(((prediction.predicted === 'B' ? prediction.probB : prediction.probP) || 0.5) * 100),
      reason: prediction.rationale || 'Đánh giá đa mô hình',
      pattern: prediction.patternContext ? `${prediction.patternContext.id} ${prediction.patternContext.name}` : '',
      consensus: prediction.consensusType || (prediction.isSingleModel ? 'SINGLE' : 'MULTI'),
      mode: prediction.isPaperTrading ? 'PAPER' : 'REAL',
      time: new Date().toLocaleTimeString('vi-VN'),
      actualOutcome: null,
      status: 'PENDING'
    };

    const existingIdx = this.recentPredictionsLog.findIndex(p => p.tableId === item.tableId && p.status === 'PENDING');
    if (existingIdx >= 0) {
      this.recentPredictionsLog[existingIdx] = item;
    } else {
      this.recentPredictionsLog.unshift(item);
      if (this.recentPredictionsLog.length > 10) this.recentPredictionsLog.pop();
    }

    this.updateAILogTable();
  }

  updateAILogTable() {
    const tbody = document.getElementById('wm-ai-predictions-body');
    if (!tbody) return;

    if (!this.recentPredictionsLog || this.recentPredictionsLog.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; color:#64748b; padding:12px;">
            Đang quét bàn để phân tích tín hiệu soi cầu...
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this.recentPredictionsLog.slice(0, 10).map(item => {
      const predBadge = item.predicted === 'B'
        ? '<span class="wm-badge-bet banker" style="font-size:10px; padding:2px 6px;">🔴 B</span>'
        : '<span class="wm-badge-bet player" style="font-size:10px; padding:2px 6px;">🔵 P</span>';

      let statusBadge = '<span class="wm-badge-result pending" style="font-size:10px;">⏳ Chờ</span>';
      if (item.status === 'WIN') {
        statusBadge = '<span class="wm-badge-result win" style="font-size:10px;">✅ ĐÚNG</span>';
      } else if (item.status === 'LOSS') {
        statusBadge = '<span class="wm-badge-result loss" style="font-size:10px;">❌ SAI</span>';
      } else if (item.status === 'TIE_PUSH') {
        statusBadge = '<span class="wm-badge-result tie" style="font-size:10px;">🟡 HÒA</span>';
      }

      const safeTableName = this.escapeHtml(item.tableName);
      const safeReason = this.escapeHtml(item.reason);
      const safePattern = this.escapeHtml(item.pattern);
      const fullTitle = `${safePattern ? '[' + safePattern + '] ' : ''}${safeReason}`;
      const patternPill = safePattern ? `<span style="color:#00f2fe; font-weight:600;">[${safePattern}]</span> ` : '';

      return `
        <tr>
          <td style="font-weight:600; color:#f1f5f9;">${safeTableName}</td>
          <td>${predBadge}</td>
          <td><b style="color:#00ff88;">${item.prob}%</b></td>
          <td style="max-width:220px; font-size:10.5px; color:#cbd5e1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${fullTitle}">${patternPill}${safeReason}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // XỬ LÝ GÓI TIN WEBSOCKET & POSTMESSAGE
  // ==========================================================================
  setupMessageListener() {
    if (this._messageListenerRegistered) return;
    this._messageListenerRegistered = true;
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;

      // Xác thực nguồn message đối với phản hồi từ iframe
      if (data.type === 'WM_IFRAME_RESPONSE' || data.type === 'WM_IFRAME_READY') {
        if (!this.isTrustedFrameSource(event.source)) return;
      }

      if (data.type === 'WM_IFRAME_READY') {
        try {
          if (event.source && event.source.postMessage) {
            event.source.postMessage({ action: 'GET_TABLES', messageId: ++this.messageIdCounter }, '*');
          }
        } catch (e) {}
      }

      // Nhận kết quả quét bàn từ iframe-injector
      if (data.type === 'WM_IFRAME_RESPONSE' && Array.isArray(data.tables)) {
        data.tables.forEach(t => {
          if (!t || !t.id) return;
          if (!isStrictTableId(t.id)) return;
          const combinedMsg = `${t.id} ${t.name || ''}`;
          if (combinedMsg.includes('1415') || combinedMsg.includes('invalid')) return;
          const m = t.id.match(/_bac_(\d+)/i) || t.id.match(/bac_?(\d+)/i);
          if (m) {
            const num = parseInt(m[1], 10);
            if (num > 60 && num < 100) return;
          }
          const canonicalId = (window.WMBaccaratAIEngine && typeof window.WMBaccaratAIEngine.canonicalizeTableId === 'function')
            ? window.WMBaccaratAIEngine.canonicalizeTableId(t.id, t.name)
            : t.id;
          if (!canonicalId || canonicalId === 'wm_invalid_table' || !isStrictTableId(canonicalId)) return;
          t.canonicalId = canonicalId;
          t.rawId = t.id;

          const existing = this.tablesMap.get(canonicalId) || this.tablesMap.get(t.id);
          if (existing) {
            existing.inDom = true;
            existing.lastSeenInDom = Date.now();
            const oldHist = existing.history || [];
            const newHist = t.history || [];
            if (newHist.length > oldHist.length) {
              for (let i = oldHist.length; i < newHist.length; i++) {
                const prev = newHist.slice(0, i);
                const outcome = newHist[i];
                if (this.aiEngine) {
                  this.aiEngine.onRoundCompleted(canonicalId, t.name || existing.name || canonicalId, prev, outcome);
                }
              }
              const recentLog = this.recentPredictionsLog.find(p => (p.tableId === canonicalId || p.tableId === t.id) && p.status === 'PENDING');
              if (recentLog) {
                const newOutcome = newHist[newHist.length - 1];
                recentLog.actualOutcome = newOutcome;
                if (newOutcome === 'T') {
                  recentLog.status = 'TIE_PUSH';
                } else if (recentLog.predicted === newOutcome) {
                  recentLog.status = 'WIN';
                } else {
                  recentLog.status = 'LOSS';
                }
                this.updateAILogTable();
              }
            }
            existing.name = t.name || existing.name;
            existing.canonicalId = canonicalId;
            existing.rawId = t.id || existing.rawId;
            if (t.shoe && t.shoe !== '0') existing.shoe = t.shoe;
            if (t.round && t.round > 0) existing.round = t.round;
            existing.betTime = (t.betTime !== undefined && t.betTime !== null) ? t.betTime : existing.betTime;
            if (t.history && t.history.length > 0) existing.history = t.history;
            this.tablesMap.set(canonicalId, existing);
            if (t.id && t.id !== canonicalId && this.tablesMap.has(t.id)) {
              this.tablesMap.delete(t.id);
            }
            if (existing.id && existing.id !== canonicalId && this.tablesMap.has(existing.id)) {
              this.tablesMap.delete(existing.id);
            }
          } else {
            this.tablesMap.set(canonicalId, t);
          }
        });
        this.checkPendingBetResults();
        this.updateTableMetricsUI();
      }

      // Nhận phản hồi chọn Chip từ iframe-injector
      if (data.type === 'WM_IFRAME_RESPONSE' && data.action === 'SELECT_CHIP') {
        if (data.success) {
          this.actualGameChip = parseInt(data.chip) || this.selectedChip;
          this.addLog(`🎯 Đã chọn Chip ${data.chip} trên bàn game thành công!`, 'success');
        } else if (data.error) {
          this.addLog(`⚠️ [Chọn Chip] ${data.error}`, 'warning');
        }
      }

      // Nhận gói tin từ WebSocket hook (chỉ từ window hiện tại hoặc iframe hợp lệ, kiểm tra URL WebSocket)
      if (data.type === 'WM_WS_PACKET_IN' && typeof data.data === 'string') {
        const wsUrl = typeof data.url === 'string' ? data.url : '';
        const isValidWsUrl = wsUrl.startsWith('wss://') || wsUrl.startsWith('ws://');
        if ((event.source === window || this.isTrustedFrameSource(event.source)) && isValidWsUrl) {
          this.handleWsPacket(data.data, wsUrl);
        }
      }

      // Nhận thông báo cược đi từ WebSocket
      if (data.type === 'WM_WS_PACKET_OUT' && typeof data.data === 'string') {
        try {
          if (data.data.includes('"protocol"') && !data.data.includes('999')) {
            console.log('[WM Content] Gói tin cược gửi đi:', data.data);
          }
        } catch (e) {}
      }

      // Nhận thông tin đăng nhập Gateway & Session ID từ ws-hook.js hoặc iframe-injector
      if (data.type === 'WM_GATEWAY_CREDENTIALS') {
        let changed = false;
        if (data.gatewayUrl && data.gatewayUrl !== this.gatewayUrl) {
          this.gatewayUrl = data.gatewayUrl;
          try { sessionStorage.setItem('wm_gateway_url', this.gatewayUrl); } catch (e) {}
          changed = true;
        }
        if (data.sid && data.sid !== this.gatewaySid) {
          this.gatewaySid = data.sid;
          try { sessionStorage.setItem('wm_gateway_sid', this.gatewaySid); } catch (e) {}
          changed = true;
          this.addLog(`🔑 Đã bắt Session ID nhà cái (${data.sid.slice(0, 8)}...). Bật đồng bộ Báo cáo chuẩn!`, 'success');
        }
        if (changed || !this.gatewaySyncInterval) {
          this.startGatewaySync();
        }
      }

      // Nhận dữ liệu báo cáo GetGameReport từ phản hồi XHR/Fetch
      if (data.type === 'WM_GATEWAY_REPORT_DATA') {
        if (data.total || data.report) {
          this.applyOfficialReport(data.total, data.report);
        }
      }
    });

    // Lắng nghe lệnh từ Popup & Background (Điều khiển Đa Tab)
    try {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!request || !request.action) return false;

        // Đồng bộ bản quyền tức thì từ Popup / Background khi bất kỳ đâu kích hoạt thành công
        if (request.action === 'WM_LICENSE_UPDATED' && request.license) {
          this.license = request.license;
          this.updateLicenseUI();
          sendResponse({ success: true });
          return true;
        }

        
        if (request.action === 'WM_GET_FULL_DATA') {
          const tabSessionId = sessionStorage.getItem('wm_tab_session_id') || 'tab';
          const tablesList = [];
          if (this.tablesMap) {
            for (const t of this.tablesMap.values()) {
              let prediction = null;
              if (this.aiEngine && t.history && t.history.length >= 3) {
                try {
                  prediction = this.aiEngine.predict(t.canonicalId || t.id, t.name || t.id, t.history);
                } catch (e) {}
              }
              tablesList.push({
                id: t.id,
                rawId: t.rawId || t.id,
                canonicalId: t.canonicalId || t.id,
                name: t.name || t.id,
                betTime: (t.betTime !== undefined && t.betTime !== null) ? t.betTime : -1,
                shoe: t.shoe || '1',
                round: t.round || (t.history ? t.history.length : 0),
                history: t.history ? Array.from(t.history) : [],
                prediction: prediction
              });
            }
          }

          tablesList.sort((a, b) => {
            const numA = parseInt((a.name || a.id).replace(/\D+/g, '') || '0', 10);
            const numB = parseInt((b.name || b.id).replace(/\D+/g, '') || '0', 10);
            return numA - numB;
          });

          sendResponse({
            success: true,
            alive: true,
            tabSessionId: tabSessionId,
            domain: window.location.hostname || 'Sảnh Game',
            url: window.location.href,
            title: document.title || 'Sảnh WM Casino',
            isRunning: Boolean(this.isRunning),
            selectedChip: this.selectedChip || this.actualGameChip || 10,
            tradingMode: (this.aiEngine && this.aiEngine.tradingMode) || 'REAL',
            aiFilterMode: (this.aiEngine && (this.aiEngine.currentFilterMode || this.aiEngine.filterMode)) || 'FLASH',
            maxTotalBet: this.maxTotalBet || 0,
            maxConcurrentBets: this.maxConcurrentBets || 5,
            maxTables: this.maxTables || 50,
            isHeadless: Boolean(this.isHeadlessMode),
            tablesCount: this.tablesMap ? this.tablesMap.size : 0,
            pendingCount: this.getPendingBetsCount ? this.getPendingBetsCount() : 0,
            stats: this.stats || {},
            cumulativeStats: this.cumulativeStats || {},
            tables: tablesList,
            betHistory: (this.betHistory || []).slice(0, 40),
            logs: (this.fullLogsHistory || []).slice(-40),
            recentPredictions: (this.recentPredictionsLog || []).slice(-20),
            license: this.license || {}
          });
          return true;
        }

        if (request.action === 'WM_SET_HEADLESS') {
          this.isHeadlessMode = Boolean(request.headless);
          try {
            localStorage.setItem('wm_headless_mode', this.isHeadlessMode ? 'true' : 'false');
          } catch (e) {}
          if (this.overlay) {
            this.overlay.style.display = this.isHeadlessMode ? 'none' : (this.isOverlayMinimized ? 'none' : 'flex');
          }
          if (this.miniPill) {
            this.miniPill.style.display = this.isHeadlessMode ? 'none' : (this.isOverlayMinimized ? 'flex' : 'none');
          }
          sendResponse({ success: true, isHeadless: this.isHeadlessMode });
          return true;
        }

        if (request.action === 'WM_UPDATE_SETTINGS') {
          if (this.isRunning) {
            sendResponse({ success: false, error: 'BLOCKED_WHILE_RUNNING' });
            return true;
          }
          if (request.selectedChip !== undefined) {
            const newChip = parseInt(request.selectedChip) || 10;
            this.selectedChip = newChip;
            this.actualGameChip = newChip;
            this.selectGameChip(newChip);
            this.addLog(`🎯 Đã chọn Chip ${newChip}k`, 'info');
          }
          if (request.maxTotalBet !== undefined) this.maxTotalBet = parseInt(request.maxTotalBet) || 0;
          if (request.maxConcurrentBets !== undefined) this.maxConcurrentBets = parseInt(request.maxConcurrentBets) || 5;
          if (request.maxTables !== undefined) this.maxTables = parseInt(request.maxTables) || 50;
          if (request.tradingMode && this.aiEngine) {
            this.aiEngine.setTradingMode(request.tradingMode);
            this.updateTradingModeUI();
          }
          if (request.aiFilterMode && this.aiEngine) {
            this.aiEngine.setFilterMode(request.aiFilterMode);
          }
          this.saveSettings();
          this.loadSettingsToUI();
          sendResponse({ success: true, selectedChip: this.selectedChip });
          return true;
        }

        
        if (request.action === 'WM_CLEAR_HISTORY') {
          if (this.isRunning) {
            sendResponse({ success: false, error: 'BLOCKED_WHILE_RUNNING' });
            return true;
          }

          // Lưu baseline từ báo cáo chính thức của nhà cái tại thời điểm reset
          this.officialSessionBaseline = {
            winLoss: (this.stats && this.stats.officialWinLoss !== undefined) ? this.stats.officialWinLoss : (this.stats ? this.stats.totalProfit : 0),
            totalBet: (this.stats && this.stats.officialTotalBet !== undefined) ? this.stats.officialTotalBet : (this.stats ? this.stats.totalAmount : 0),
            totalBetsCount: (this.stats && this.stats.officialTotalBetsCount !== undefined) ? this.stats.officialTotalBetsCount : (this.stats ? this.stats.totalBets : 0)
          };
          try {
            sessionStorage.setItem('wm_gateway_baseline', JSON.stringify(this.officialSessionBaseline));
          } catch (e) {}

          this.betHistory = [];
          this.cumulativeStats = {
            totalBets: 0,
            totalAmount: 0,
            bankerBets: 0,
            playerBets: 0,
            wins: 0,
            losses: 0,
            ties: 0,
            totalProfit: 0
          };
          this.stats = {
            totalBets: 0,
            totalAmount: 0,
            bankerBets: 0,
            playerBets: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            totalProfit: 0
          };
          try {
            const tabKey = this.getTabStorageKey('wm_bet_history');
            const statsKey = this.getTabStorageKey('wm_cumulative_stats');
            chrome.storage.local.remove([tabKey, statsKey, 'wm_cumulative_stats', 'wm_bet_history']);
          } catch (e) {}
          this.saveBetHistory();
          this.renderBetHistory();
          this.updateLimitProgressUI();
          this.updateMiniPill();
          this.addLog('🗑️ Đã xóa sạch dữ liệu cược của riêng tab này và đặt lại số liệu về 0!', 'info');
          sendResponse({ success: true });
          return true;
        }

        if (request.action === 'WM_FORCE_SCROLL') {
          this.forceScrollAllTables();
          sendResponse({ success: true });
          return true;
        }

        if (request.action === 'WM_MANUAL_BET') {
          const reqTableId = request.tableId;
          const reqSide = request.side;
          let targetTable = this.tablesMap ? this.tablesMap.get(reqTableId) : null;
          if (!targetTable && this.tablesMap) {
            for (const t of this.tablesMap.values()) {
              if (t.id === reqTableId || t.canonicalId === reqTableId || t.rawId === reqTableId) {
                targetTable = t;
                break;
              }
            }
          }
          if (targetTable && reqSide) {
            this.executeBet(targetTable, reqSide, 'Thủ công từ Cửa Sổ Rời');
            sendResponse({ success: true, table: targetTable.name || targetTable.id });
          } else {
            sendResponse({ success: false, error: 'Không tìm thấy bàn ' + reqTableId });
          }
          return true;
        }

        if (request.action === 'WM_GET_TAB_STATUS') {
          const tabSessionId = sessionStorage.getItem('wm_tab_session_id') || 'tab';
          sendResponse({
            success: true,
            alive: true,
            tabSessionId: tabSessionId,
            domain: window.location.hostname || 'Sảnh Game',
            url: window.location.href,
            title: document.title || 'Sảnh WM Casino',
            isRunning: Boolean(this.isRunning),
            betMode: 'REAL',
            tablesCount: this.tablesMap ? this.tablesMap.size : 0,
            pendingCount: this.getPendingBetsCount ? this.getPendingBetsCount() : 0,
            stats: {
              totalBets: this.stats ? this.stats.totalBets : 0,
              totalAmount: this.stats ? this.stats.totalAmount : 0,
              wins: this.stats ? this.stats.wins : 0,
              losses: this.stats ? this.stats.losses : 0,
              winRate: this.stats ? this.stats.winRate : 0,
              totalProfit: this.stats ? this.stats.totalProfit : 0
            }
          });
          return true;
        }

        // Mở bảng điều khiển / cài đặt N/A DEV từ Popup Extension
        if (request.action === 'WM_OPEN_PANEL') {
          if (!this.overlay || !document.body.contains(this.overlay)) {
            this.createOverlay();
          }
          this.toggleMinimize(false);
          if (this.overlay) {
            this.overlay.style.display = 'flex';
            this.overlay.style.zIndex = '2147483647';
            this.overlay.style.top = '20px';
            this.overlay.style.right = '20px';
            this.overlay.style.left = 'auto';
            try { this.overlay.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
          }
          if (this.miniPill) this.miniPill.style.display = 'none';

          // Mở sang tab Cài Đặt
          const targetTab = request.tab || 'settings';
          if (typeof this.switchTab === 'function') {
            this.switchTab(targetTab);
          } else {
            const tabBtn = this.overlay?.querySelector(`.wm-tab-btn[data-tab="${targetTab}"]`);
            if (tabBtn) tabBtn.click();
          }

          sendResponse({ success: true, opened: true });
          return true;
        }

        if (request.action === 'WM_OPEN_AI_MODAL') {
          if (!this.overlay || !document.body.contains(this.overlay)) {
            this.createOverlay();
          }
          const aiModal = document.getElementById('wm-ai-modal');
          if (aiModal) {
            aiModal.style.display = 'flex';
          }
          sendResponse({ success: true, opened: true });
          return true;
        }

        if (request.action === 'WM_TOGGLE_RUN') {
          if (this.isRunning) {
            this.stop();
            sendResponse({
              success: true,
              isRunning: false
            });
            return true;
          } else {
            this.start().then((startRes) => {
              sendResponse({
                success: Boolean(this.isRunning),
                isRunning: Boolean(this.isRunning),
                error: (startRes && startRes.error) || null,
                message: (startRes && startRes.message) || null
              });
            });
            return true;
          }
        }

        if (request.action === 'WM_START_RUN') {
          if (!this.isRunning) {
            this.start().then((startRes) => {
              sendResponse({
                success: Boolean(this.isRunning),
                isRunning: Boolean(this.isRunning),
                error: (startRes && startRes.error) || null,
                message: (startRes && startRes.message) || null
              });
            });
            return true;
          }
          sendResponse({
            success: true,
            isRunning: true
          });
          return true;
        }

        if (request.action === 'WM_STOP_RUN') {
          if (this.isRunning) {
            this.stop();
          }
          sendResponse({
            success: true,
            isRunning: Boolean(this.isRunning)
          });
          return true;
        }

        if (request.action === 'WM_RELOAD_TAB') {
          window.location.reload();
          sendResponse({ success: true });
          return true;
        }

        return false;
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.wm_license_cached && changes.wm_license_cached.newValue) {
          this.license = changes.wm_license_cached.newValue;
          this.updateLicenseUI();
        }
      });
    } catch (e) {}
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  handleWsPacket(rawData, wsUrl = '') {
    try {
      if (typeof rawData !== 'string') return;
      if (rawData.length > 65536) return; // Chống DoS / payload quá lớn
      if (!rawData.includes('{')) return;

      const parsed = JSON.parse(rawData);
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.protocol === 999) return; // Bỏ qua heartbeat

      if (!this.wsTableMeta) this.wsTableMeta = new Map();

      // BÓC TÁCH PROTOCOL 26: TOÀN BỘ CHUỖI CẦU (ROADMAP) TỪ SERVER WM CASINO (0ms LAG, CHUẨN XÁC 100%)
      if ((parsed.protocol === 26 || parsed.protocol === '26') && parsed.data) {
        const d = parsed.data;

        // BẮT BUỘC CHỈ NHẬN BACCARAT (gameID: 101). Bỏ qua hoàn toàn Rồng Hổ (102), Roulette (103), Tài Xỉu (104)
        if (d.gameID && d.gameID !== 101 && d.gameID !== '101') return;

        const rawGroupId = d.groupID ?? d.tableId ?? d.groupId;
        const historyArr = d.historyArr || d.dataArr1 || [];

        if (rawGroupId !== undefined && rawGroupId !== null && Array.isArray(historyArr) && historyArr.length > 0) {
          const strGroupId = String(rawGroupId).trim();

          // Chuyển mã số 1, 2, 3, 4 sang B, P, T
          // 1: Banker -> B
          // 2: Player -> P
          // 3, 4: Tie (Hòa) -> T
          const convertedHistory = historyArr.map(num => {
            if (num === 1) return 'B';
            if (num === 2) return 'P';
            if (num === 3 || num === 4) return 'T';
            return 'T';
          });

          let shoeNo = '1';
          let roundNo = d.totalCount || convertedHistory.length;
          if (d.historyData && Array.isArray(d.historyData.resultObjArr) && d.historyData.resultObjArr.length > 0) {
            const lastItem = d.historyData.resultObjArr[d.historyData.resultObjArr.length - 1];
            if (lastItem) {
              shoeNo = String(lastItem.gameNo || shoeNo);
              if (lastItem.gameNoRound) roundNo = lastItem.gameNoRound;
            }
          }

          // Chuẩn hóa tên bàn thân thiện cho Baccarat khớp chính xác giao diện sảnh
          let friendlyName = `Bàn ${strGroupId}`;
          const groupNum = parseInt(strGroupId, 10);
          if (!Number.isNaN(groupNum)) {
            if (groupNum >= 501 && groupNum <= 599) {
              friendlyName = `Bàn ${String(groupNum - 500).padStart(2, '0')}`;
            } else if (groupNum >= 101 && groupNum <= 199) {
              friendlyName = `Bàn ${String(groupNum - 100).padStart(2, '0')}`;
            } else if (groupNum >= 201 && groupNum <= 299) {
              friendlyName = `Bàn Siêu Tốc ${String(groupNum - 200).padStart(2, '0')}`;
            } else if (groupNum >= 301 && groupNum <= 399) {
              friendlyName = `Bàn Nặn ${String(groupNum - 300).padStart(2, '0')}`;
            } else if (groupNum >= 601 && groupNum <= 699) {
              friendlyName = `Bàn Đặc Biệt ${String(groupNum - 600).padStart(2, '0')}`;
            } else if (groupNum >= 1 && groupNum <= 99) {
              friendlyName = `Bàn ${String(groupNum).padStart(2, '0')}`;
            }
          }

          // Khớp bàn trong tablesMap
          let matchedTable = null;
          let matchedKey = null;

          const possibleIds = [
            `groupMultiple_101_${strGroupId}`,
            strGroupId,
            `box_pc_${strGroupId}`
          ];

          for (const testId of possibleIds) {
            const cId = (window.WMBaccaratAIEngine && typeof window.WMBaccaratAIEngine.canonicalizeTableId === 'function')
              ? window.WMBaccaratAIEngine.canonicalizeTableId(testId, friendlyName)
              : testId;
            if (this.tablesMap.has(cId)) {
              matchedTable = this.tablesMap.get(cId);
              matchedKey = cId;
              break;
            }
            if (this.tablesMap.has(testId)) {
              matchedTable = this.tablesMap.get(testId);
              matchedKey = testId;
              break;
            }
          }

          if (!matchedTable) {
            for (const [k, tbl] of this.tablesMap.entries()) {
              const combined = `${tbl.id} ${tbl.rawId || ''} ${tbl.name || ''}`;
              if (combined.includes(strGroupId) || (strGroupId.length >= 3 && combined.includes(strGroupId.slice(-2)))) {
                matchedTable = tbl;
                matchedKey = k;
                break;
              }
            }
          }

          if (matchedTable) {
            const oldLen = (matchedTable.history || []).length;
            matchedTable.history = convertedHistory;
            matchedTable.shoe = shoeNo;
            matchedTable.round = roundNo;
            matchedTable.source = 'WS_PROTOCOL_26';
            if (friendlyName && (!matchedTable.name || !matchedTable.name.includes('Bàn'))) {
              matchedTable.name = friendlyName;
            }
            this.tablesMap.set(matchedKey, matchedTable);

            if (convertedHistory.length > oldLen && this.aiEngine) {
              const newOutcome = convertedHistory[convertedHistory.length - 1];
              const prevHist = convertedHistory.slice(0, -1);
              this.aiEngine.onRoundCompleted(matchedKey, matchedTable.name || matchedKey, prevHist, newOutcome);
            }
          } else {
            const canonicalId = (window.WMBaccaratAIEngine && typeof window.WMBaccaratAIEngine.canonicalizeTableId === 'function')
              ? window.WMBaccaratAIEngine.canonicalizeTableId(`groupMultiple_101_${strGroupId}`, friendlyName)
              : `table_${strGroupId}`;

            this.tablesMap.set(canonicalId, {
              id: canonicalId,
              rawId: strGroupId,
              canonicalId: canonicalId,
              name: friendlyName,
              betTime: -1,
              shoe: shoeNo,
              round: roundNo,
              history: convertedHistory,
              source: 'WS_PROTOCOL_26'
            });
          }

          this.tablesDirty = true;
          this.checkPendingBetResults();
        }
      }

      const extractMetaFromItem = (item) => {
        if (!item || typeof item !== 'object') return;
        const gid = item.gameID ?? item.gameId ?? item.gid;
        if (gid !== undefined && gid !== null && gid !== 101 && gid !== '101') return; // Chỉ Baccarat
        const rawTableId = item.tableId ?? item.groupId ?? item.roomId ?? item.tid ?? item.table_id;
        const shoeVal = item.shoeNo ?? item.shoe ?? item.bootNo ?? item.shoeId ?? item.shoe_no;
        const roundVal = item.roundNo ?? item.round ?? item.handNo ?? item.roundId ?? item.round_no;
        const gameNoVal = item.gameNo ?? item.serialNo ?? item.game_no;
        const rawName = item.tableName ?? item.groupName ?? item.name ?? '';

        if (rawTableId !== undefined && rawTableId !== null) {
          const strTableId = String(rawTableId).trim();
          // Kiểm tra định dạng ID bàn: chỉ cho phép ký tự an toàn alphanumeric và gạch dưới/nối
          if (!/^[a-zA-Z0-9_\-\.]{1,64}$/.test(strTableId)) return;
          if ((strTableId + ' ' + rawName).includes('1415')) return;

          let cleanShoe = '';
          if (shoeVal !== undefined && shoeVal !== null && shoeVal !== '') {
            cleanShoe = String(shoeVal).trim();
            if (!/^[0-9a-zA-Z_\-\.]{1,32}$/.test(cleanShoe)) return;
          }

          let cleanRound = 0;
          if (roundVal !== undefined && roundVal !== null && roundVal !== '') {
            const numRound = Number(roundVal);
            if (!Number.isInteger(numRound) || numRound < 0 || numRound > 150) return;
            cleanRound = numRound;
          }

          let cleanGameNo = '';
          if (gameNoVal !== undefined && gameNoVal !== null && gameNoVal !== '') {
            cleanGameNo = String(gameNoVal).trim();
            if (!/^[0-9a-zA-Z_\-\.]{1,64}$/.test(cleanGameNo)) return;
          }

          const canonicalId = (window.WMBaccaratAIEngine && typeof window.WMBaccaratAIEngine.canonicalizeTableId === 'function')
            ? window.WMBaccaratAIEngine.canonicalizeTableId(strTableId, rawName)
            : strTableId;
          if (!canonicalId || canonicalId === 'wm_invalid_table' || !isStrictTableId(canonicalId)) return;

          if (cleanShoe || cleanRound || cleanGameNo) {
            const prev = this.wsTableMeta.get(canonicalId) || {};
            this.wsTableMeta.set(canonicalId, {
              shoeId: cleanShoe || prev.shoeId || '',
              roundIndex: cleanRound || prev.roundIndex || 0,
              gameNo: cleanGameNo || prev.gameNo || '',
              idSource: 'WS_AUTHORITATIVE',
              updatedAt: Date.now()
            });
          }

          const cdVal = item.betTime ?? item.time ?? item.countdown ?? item.cd ?? item.remainTime ?? item.second;
          if (typeof cdVal === 'number' && cdVal >= 0 && cdVal <= 60) {
            const tObj = this.tablesMap.get(canonicalId) || this.tablesMap.get(strTableId);
            if (tObj) {
              tObj.betTime = cdVal;
            }
          }
        }
      };

      const walkPayload = (node, depth = 0) => {
        if (!node || typeof node !== 'object' || depth > 3) return;
        if (Array.isArray(node)) {
          for (let i = 0; i < node.length && i < 60; i++) {
            walkPayload(node[i], depth + 1);
          }
          return;
        }
        extractMetaFromItem(node);
        const childKeys = ['data', 'tables', 'list', 'tableList', 'groupList', 'roomList', 'info', 'result'];
        for (const k of childKeys) {
          if (node[k] && typeof node[k] === 'object') {
            walkPayload(node[k], depth + 1);
          }
        }
      };

      walkPayload(parsed, 0);
    } catch (e) {}
  }
}

// Khởi tạo
if (window === window.top) {
  new WMAutoHelper();
}
