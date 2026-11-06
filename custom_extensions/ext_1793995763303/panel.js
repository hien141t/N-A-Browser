// panel.js - Bộ điều khiển rời độc lập WM AI Baccarat Pro
document.addEventListener('DOMContentLoaded', () => {
  let currentTabId = null;
  let pollTimer = null;
  let isPolling = false;
  let lastTablesSignature = '';
  let activeView = 'view-tables';
  let isHeadlessState = false;
  let isCurrentTabRunning = false;
  let userSelectedChip = parseInt(localStorage.getItem('wm_chip'), 10) || 10;
  let lastChipUserInteraction = 0;

  // DOM Elements
  const tabSelector = document.getElementById('tab-selector');
  const licenseBadge = document.getElementById('license-badge');
  const headlessSwitchBtn = document.getElementById('headless-switch-btn');
  const headlessToggle = document.getElementById('headless-toggle');

  const multitabCountBadge = document.getElementById('multitab-count-badge');
  const multitabTotalProfit = document.getElementById('multitab-total-profit');
  const btnRunAllTabs = document.getElementById('btn-run-all-tabs');
  const btnStopAllTabs = document.getElementById('btn-stop-all-tabs');
  const multitabStrip = document.getElementById('multitab-strip');
  let cachedWmTabs = [];

  const btnMasterToggle = document.getElementById('btn-master-toggle');
  const btnMasterScan = document.getElementById('btn-master-scan');
  const currentChipDisplay = document.getElementById('current-chip-display');
  const chipItems = document.querySelectorAll('.chip-item');

  const optTradingMode = document.getElementById('opt-trading-mode');
  const optAiFilter = document.getElementById('opt-ai-filter');
  const optMaxBet = document.getElementById('opt-max-bet');
  const optMaxConcurrent = document.getElementById('opt-max-concurrent');
  const optChipSelect = document.getElementById('opt-chip-select');
  const optMaxTables = document.getElementById('opt-max-tables');
  const limitProgressText = document.getElementById('limit-progress-text');
  const limitPercent = document.getElementById('limit-percent');
  const concurrentText = document.getElementById('concurrent-status-text');
  const concurrentBadge = document.getElementById('concurrent-badge');
  const btnClearData = document.getElementById('btn-clear-data');
  const btnClearHistoryTab = document.getElementById('btn-clear-history-tab');
  const histTotalBadge = document.getElementById('hist-total-badge');

  const settingsAccordion = document.getElementById('settings-accordion');
  const settingsHeaderBtn = document.getElementById('settings-header-btn');
  const settingsChevron = document.getElementById('settings-chevron');
  const settingsLockNotice = document.getElementById('settings-lock-notice');
  const smTagMode = document.getElementById('sm-tag-mode');
  const smTagAi = document.getElementById('sm-tag-ai');
  const smTagLimit = document.getElementById('sm-tag-limit');

  const kpiTotalBets = document.getElementById('kpi-total-bets');
  const kpiWinRate = document.getElementById('kpi-win-rate');
  const kpiProfit = document.getElementById('kpi-profit');
  const kpiProgress = document.getElementById('kpi-progress');
  const kpiProgressTitle = document.getElementById('kpi-progress-title');
  const kpiTablesCount = document.getElementById('kpi-tables-count');
  const tabTableCount = document.getElementById('tab-table-count');

  const tablesContainer = document.getElementById('tables-container');
  const historyContainer = document.getElementById('history-container');
  const tabHistoryCount = document.getElementById('tab-history-count');
  const signalsContainer = document.getElementById('signals-container');
  const terminalLogs = document.getElementById('terminal-logs');
  const navTabBtns = document.querySelectorAll('.nav-tab-btn');

  // Lấy tabId từ URL query param nếu có
  const urlParams = new URLSearchParams(window.location.search);
  const paramTabId = parseInt(urlParams.get('tabId'), 10);
  if (!isNaN(paramTabId) && paramTabId > 0) {
    currentTabId = paramTabId;
  }

  // Lắng nghe lệnh chuyển tab từ game hoặc background khi mở/focus cửa sổ
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PANEL_SELECT_TAB' && request.tabId) {
      const tid = parseInt(request.tabId, 10);
      if (!isNaN(tid) && tid > 0) {
        currentTabId = tid;
        if (tabSelector) tabSelector.value = String(tid);
        if (multitabStrip) {
          multitabStrip.querySelectorAll('.tab-pill').forEach(p => {
            p.classList.toggle('active', parseInt(p.getAttribute('data-tab-id'), 10) === currentTabId);
          });
        }
        lastTablesSignature = '';
        fetchFullData();
      }
      sendResponse({ ok: true });
    }
  });

  // =========================================================================
  
  // 0. Đọc bản quyền ngay lập tức từ cache Chrome Storage
  function loadLicenseDirectly() {
    if (!licenseBadge) return;
    try {
      chrome.storage.local.get(['wm_license_cached'], (st) => {
        if (st && st.wm_license_cached) {
          if (st.wm_license_cached.valid) {
            licenseBadge.style.color = '#34d399';
            licenseBadge.style.borderColor = '#10b981';
            licenseBadge.style.background = 'rgba(16, 185, 129, 0.15)';
            licenseBadge.innerText = `🟢 Còn ${st.wm_license_cached.daysLeft} ngày`;
          } else {
            const err = st.wm_license_cached.error || 'Chưa kích hoạt';
            licenseBadge.style.color = '#f87171';
            licenseBadge.style.borderColor = '#ef4444';
            licenseBadge.style.background = 'rgba(239, 68, 68, 0.15)';
            licenseBadge.innerText = `🔴 ${err}`;
          }
        }
      });
    } catch (e) {}
  }
  loadLicenseDirectly();

  function updateChipUI(val) {
    if (currentChipDisplay) currentChipDisplay.innerText = `${val}k`;
    if (optChipSelect && optChipSelect.value !== String(val)) optChipSelect.value = String(val);
    chipItems.forEach(item => {
      const v = parseInt(item.getAttribute('data-chip'), 10);
      item.classList.toggle('active', v === val);
    });
  }
  updateChipUI(userSelectedChip);

  // Khóa / Mở khóa toàn bộ cài đặt bên dưới khi đang cược Auto (Đảm bảo an toàn không đổi nhầm thông số)
  function setPanelControlsLocked(locked) {
    isCurrentTabRunning = Boolean(locked);

    // 1. Phỉnh cược (Chip selection): không cho bấm đổi phỉnh khi đang cược auto
    chipItems.forEach(item => {
      item.classList.toggle('disabled', locked);
      item.style.pointerEvents = locked ? 'none' : 'auto';
      item.style.cursor = locked ? 'not-allowed' : 'pointer';
      item.style.opacity = locked ? '0.45' : '1';
    });

    // 2. Các trường cấu hình cược & chiến lược AI
    if (optTradingMode) optTradingMode.disabled = locked;
    if (optAiFilter) optAiFilter.disabled = locked;
    if (optMaxBet) optMaxBet.disabled = locked;
    if (optMaxConcurrent) optMaxConcurrent.disabled = locked;
    if (optMaxTables) optMaxTables.disabled = locked;
    if (optChipSelect) optChipSelect.disabled = locked;

    // 3. Nút xóa dữ liệu
    if (btnClearData) btnClearData.disabled = locked;
    if (btnClearHistoryTab) btnClearHistoryTab.disabled = locked;

    // 4. Banner thông báo khóa cài đặt trong Accordion
    if (settingsLockNotice) {
      settingsLockNotice.style.display = locked ? 'flex' : 'none';
    }
  }

  // Hàm định dạng tiền tệ rút gọn siêu gọn gàng (VD: 10 -> 10k, 500 -> 500k, 50000 -> 50M, 1000000 -> 1T)
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

  // Quản lý tên hiển thị tùy chỉnh của Tab (Mặc định: Tab 1, Tab 2, Tab 3... hoặc tên do người dùng tự đặt)
  function getTabCustomName(tab, info, index) {
    const key = `wm_tab_alias_${info.tabSessionId || tab.id}`;
    const custom = localStorage.getItem(key);
    if (custom && custom.trim()) {
      return custom.trim();
    }
    return `Tab ${index + 1}`;
  }

  function setTabCustomName(tabId, tabSessionId, defaultName) {
    const key = `wm_tab_alias_${tabSessionId || tabId}`;
    const currentName = localStorage.getItem(key) || defaultName;
    const newName = prompt(`Đặt tên hiển thị cho tab này (VD: Tab 1, Acc Chính, Vốn 50M...):`, currentName);
    if (newName !== null) {
      const clean = newName.trim();
      if (clean) {
        localStorage.setItem(key, clean);
      } else {
        localStorage.removeItem(key);
      }
      refreshTabsList();
    }
  }

  // Quản lý danh sách tab bị người dùng xóa/bỏ qua
  const ignoredTabIds = new Set();
  try {
    const rawIgnored = localStorage.getItem('wm_ignored_tab_ids');
    if (rawIgnored) {
      JSON.parse(rawIgnored).forEach(id => ignoredTabIds.add(id));
    }
  } catch (e) {}

  function saveIgnoredTabs() {
    try {
      localStorage.setItem('wm_ignored_tab_ids', JSON.stringify([...ignoredTabIds]));
    } catch (e) {}
  }

  // 1. Quét tìm danh sách các Tab WM Casino đang mở
  // =========================================================================
  async function refreshTabsList() {
    try {
      const tabs = await chrome.tabs.query({});
      const wmTabs = [];

      for (const t of tabs) {
        if (!t.id) continue;
        if (ignoredTabIds.has(t.id)) continue;
        const u = t.url || '';
        if (u.startsWith('chrome://') || u.startsWith('edge://') || u.startsWith('chrome-extension://')) {
          continue;
        }

        try {
          const res = await new Promise((resolve) => {
            chrome.tabs.sendMessage(t.id, { action: 'WM_GET_TAB_STATUS' }, (resp) => {
              if (chrome.runtime.lastError || !resp || !resp.alive) resolve(null);
              else resolve(resp);
            });
          });
          if (res && res.alive) {
            wmTabs.push({ tab: t, info: res });
            // Chống đóng băng / chống Chrome Memory Saver tự ý ngủ tab ngầm
            try {
              chrome.tabs.update(t.id, { autoDiscardable: false }, () => {
                if (chrome.runtime.lastError) {}
              });
            } catch (e) {}
          }
        } catch (e) {}
      }

      // CHỈ GIỮ LẠI CÁC TAB ĐÃ VÀO SẢNH VÀ CÓ BÀN (Ẩn các tab không có bàn hoặc 0 bàn)
      const validWmTabs = wmTabs.filter(w => w.info && w.info.tablesCount > 0);
      const activeTabsList = validWmTabs.length > 0 ? validWmTabs : wmTabs;

      cachedWmTabs = activeTabsList;

      // Nếu tab hiện tại không nằm trong danh sách các tab có bàn -> tự động chuyển sang tab có bàn đầu tiên
      const currentTabStillHasTables = activeTabsList.some(w => w.tab.id === currentTabId);
      if (!currentTabStillHasTables && activeTabsList.length > 0) {
        currentTabId = activeTabsList[0].tab.id;
        lastTablesSignature = '';
        fetchFullData();
      }

      renderTabSelector(activeTabsList);
      renderMultitabSummary(activeTabsList);
    } catch (err) {
      console.error('[Panel] Lỗi quét danh sách tab:', err);
    }
  }

  function renderMultitabSummary(wmTabs) {
    const tabDropdownTrigger = document.getElementById('tab-dropdown-trigger');
    const tabTriggerDot = document.getElementById('tab-trigger-dot');
    const tabTriggerName = document.getElementById('tab-trigger-name');
    const tabTriggerDomain = document.getElementById('tab-trigger-domain');
    const tabTriggerBadge = document.getElementById('tab-trigger-badge');
    const tabTriggerProfit = document.getElementById('tab-trigger-profit');
    const dropdownTabCount = document.getElementById('dropdown-tab-count');
    const dropdownTabsList = document.getElementById('dropdown-tabs-list');

    if (!wmTabs || wmTabs.length === 0) {
      if (multitabCountBadge) multitabCountBadge.innerText = '🌐 0 tab';
      if (dropdownTabCount) dropdownTabCount.innerText = '0 tab';
      if (multitabTotalProfit) {
        multitabTotalProfit.className = 'hub-profit zero';
        multitabTotalProfit.innerText = '0k';
      }
      if (tabTriggerDot) tabTriggerDot.className = 'tab-trigger-dot stopped';
      if (tabTriggerName) tabTriggerName.innerText = 'Chưa có tab';
      if (tabTriggerDomain) tabTriggerDomain.innerText = 'Hãy mở sảnh WM';
      if (tabTriggerBadge) tabTriggerBadge.innerText = '0 bàn';
      if (tabTriggerProfit) {
        tabTriggerProfit.className = 'tab-trigger-profit zero';
        tabTriggerProfit.innerText = '0k';
      }
      if (dropdownTabsList) {
        dropdownTabsList.innerHTML = '<div class="dropdown-empty">⏳ Chưa có tab sảnh game nào... Hãy mở sảnh WM Casino hoặc bấm [➕ Thêm Tab]!</div>';
      }
      return;
    }

    let totalProfitSum = 0;
    let runningCount = 0;

    wmTabs.forEach(({ info }) => {
      if (info.isRunning) runningCount++;
      const p = (info.stats && info.stats.totalProfit) || 0;
      totalProfitSum += p;
    });

    if (multitabCountBadge) multitabCountBadge.innerText = `🌐 ${wmTabs.length} tab`;
    if (dropdownTabCount) dropdownTabCount.innerText = `${wmTabs.length} tab`;
    if (typeof updateHiddenTabsCount === 'function') updateHiddenTabsCount();

    const pSign = totalProfitSum > 0 ? '+' : (totalProfitSum < 0 ? '-' : '');
    const pClass = totalProfitSum > 0 ? 'positive' : (totalProfitSum < 0 ? 'negative' : 'zero');
    if (multitabTotalProfit) {
      multitabTotalProfit.className = `hub-profit ${pClass}`;
      multitabTotalProfit.innerText = formatCompactMoney(totalProfitSum, true);
    }

    // 1. Cập nhật nút Select Trigger hiển thị tab đang chọn hiện tại
    const activeEntry = wmTabs.find(w => w.tab.id === currentTabId) || wmTabs[0];
    if (activeEntry) {
      const isRunning = Boolean(activeEntry.info.isRunning);
      const p = (activeEntry.info.stats && activeEntry.info.stats.totalProfit) || 0;
      const pillClass = p > 0 ? 'positive' : (p < 0 ? 'negative' : 'zero');
      const pFormatted = formatCompactMoney(p, true);
      const tablesCount = activeEntry.info.tablesCount || 0;
      const tabName = getTabCustomName(activeEntry.tab, activeEntry.info, wmTabs.indexOf(activeEntry));
      const domainShort = (activeEntry.info.domain || '').replace(/^www\./i, '');

      if (tabTriggerDot) tabTriggerDot.className = `tab-trigger-dot ${isRunning ? 'running' : 'stopped'}`;
      if (tabTriggerName) tabTriggerName.innerText = tabName;
      if (tabTriggerDomain) tabTriggerDomain.innerText = domainShort;
      if (tabTriggerBadge) tabTriggerBadge.innerText = tablesCount > 0 ? `${tablesCount} bàn` : 'Đang quét...';
      if (tabTriggerProfit) {
        tabTriggerProfit.className = `tab-trigger-profit ${pillClass}`;
        tabTriggerProfit.innerText = pFormatted;
      }
    }

    // 2. Render danh sách Tab vào Popup List
    if (dropdownTabsList) {
      dropdownTabsList.innerHTML = wmTabs.map(({ tab, info }, index) => {
        const isRunning = Boolean(info.isRunning);
        const isActive = tab.id === currentTabId;
        const p = (info.stats && info.stats.totalProfit) || 0;
        const pillClass = p > 0 ? 'positive' : (p < 0 ? 'negative' : 'zero');
        const pFormatted = formatCompactMoney(p, true);
        const tablesCount = info.tablesCount || 0;
        const tabName = getTabCustomName(tab, info, index);
        const domainShort = (info.domain || '').replace(/^www\./i, '');

        return `
          <div class="dropdown-tab-item ${isActive ? 'active' : ''}" data-tab-id="${tab.id}" data-session-id="${info.tabSessionId || ''}" data-default-name="${escapeHtml(tabName)}" title="Bấm để chuyển sang tab này">
            <div class="dropdown-tab-left">
              <span class="tab-pill-dot ${isRunning ? 'running' : 'stopped'}"></span>
              <span class="pill-name"><b>${escapeHtml(tabName)}</b></span>
              <span class="pill-domain">${escapeHtml(domainShort)}</span>
              <span class="pill-tables-badge">${tablesCount > 0 ? tablesCount + ' bàn' : 'Đang quét...'}</span>
              <span class="tab-pill-profit ${pillClass}">${pFormatted}</span>
            </div>
            <div class="dropdown-tab-right">
              <span class="pill-rename-btn" title="Đổi tên tab này">✏️</span>
              <span class="pill-hide-btn" title="Ẩn tab này khỏi thanh công cụ (không đóng tab trình duyệt)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none; display:inline-block; vertical-align:middle;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
              </span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  function renderTabSelector(wmTabs) {
    if (!tabSelector) return;
    const previousVal = currentTabId ? String(currentTabId) : tabSelector.value;

    if (wmTabs.length === 0) {
      tabSelector.innerHTML = '<option value="">⚠️ Chưa kết nối tab sảnh game có bàn</option>';
      currentTabId = null;
      renderEmptyState(`
        <div class="empty-state-title">⏳ ĐANG CHỜ VÀO SẢNH GAME WM CASINO</div>
        <div class="empty-state-desc">
          Hệ thống chỉ hiển thị các tab <b>đã vào sảnh và phát hiện bàn chơi</b>.<br>
          Vui lòng vào sảnh game WM Casino hoặc bấm tải lại trang tab game!
        </div>
        <button id="btn-reload-game-tabs" style="background:linear-gradient(135deg, #0284c7, #00f2fe); color:#080c14; border:none; padding:10px 18px; border-radius:8px; font-weight:700; font-size:12px; cursor:pointer; box-shadow:0 4px 14px rgba(0,242,254,0.3); text-transform:uppercase; letter-spacing:0.3px;">
          🔄 BẤM ĐÂY ĐỂ TẢI LẠI TAB GAME (F5)
        </button>
      `);
      const btnRel = document.getElementById('btn-reload-game-tabs');
      if (btnRel) {
        btnRel.addEventListener('click', async () => {
          btnRel.innerText = '⏳ Đang tải lại tab game...';
          btnRel.disabled = true;
          try {
            const allTabs = await chrome.tabs.query({});
            for (const t of allTabs) {
              const u = t.url || '';
              if (!u.startsWith('chrome://') && !u.startsWith('chrome-extension://') && !u.startsWith('edge://')) {
                chrome.tabs.reload(t.id);
              }
            }
            setTimeout(() => {
              refreshTabsList();
            }, 1800);
          } catch(e) {}
        });
      }
      return;
    }

    tabSelector.innerHTML = wmTabs.map(({ tab, info }, index) => {
      const isRunning = info.isRunning ? '🟢' : '⏸️';
      const tabName = getTabCustomName(tab, info, index);
      const tablesTxt = (info.tablesCount && info.tablesCount > 0) ? `${info.tablesCount} bàn` : 'Đang quét bàn...';
      const label = `${isRunning} ${tabName} - ${info.domain || 'Sảnh Game'} (${tablesTxt})`;
      return `<option value="${tab.id}">${escapeHtml(label)}</option>`;
    }).join('');

    // Nếu tab hiện tại còn tồn tại -> giữ nguyên
    const stillExists = wmTabs.some(w => w.tab.id === currentTabId);
    if (stillExists) {
      tabSelector.value = String(currentTabId);
    } else {
      currentTabId = wmTabs[0].tab.id;
      tabSelector.value = String(currentTabId);
      lastTablesSignature = '';
    }
  }

  if (tabSelector) {
    tabSelector.addEventListener('change', () => {
      const selected = parseInt(tabSelector.value, 10);
      if (!isNaN(selected) && selected > 0) {
        currentTabId = selected;
        lastTablesSignature = '';
        if (multitabStrip) {
          multitabStrip.querySelectorAll('.tab-pill').forEach(p => {
            p.classList.toggle('active', parseInt(p.getAttribute('data-tab-id'), 10) === currentTabId);
          });
        }
        fetchFullData();
      }
    });
  }

  // Chuyển tab nhanh bằng cách nhấp thẻ Tab Pill hoặc Đổi tên
  if (multitabStrip) {
    multitabStrip.addEventListener('click', (e) => {
      // 1. Nút thêm tab mới
      const addBtn = e.target.closest('#strip-add-tab-btn');
      if (addBtn) {
        e.stopPropagation();
        openAddTabModal();
        return;
      }

      // 2. Nút xóa / đóng tab
      const closeBtn = e.target.closest('.pill-close-btn');
      if (closeBtn) {
        e.stopPropagation();
        const pill = closeBtn.closest('.tab-pill');
        if (!pill) return;
        const tid = parseInt(pill.getAttribute('data-tab-id'), 10);
        const defName = pill.getAttribute('data-default-name') || 'Tab';

        if (confirm(`Bạn có chắc chắn muốn xóa & đóng "${defName}" khỏi danh sách bot?`)) {
          ignoredTabIds.add(tid);
          saveIgnoredTabs();
          try {
            chrome.tabs.remove(tid, () => {
              if (chrome.runtime.lastError) {}
              refreshTabsList();
            });
          } catch (err) {
            refreshTabsList();
          }
        }
        return;
      }

      // 3. Nút đổi tên tab
      const renameBtn = e.target.closest('.pill-rename-btn');
      if (renameBtn) {
        e.stopPropagation();
        const pill = renameBtn.closest('.tab-pill');
        if (pill) {
          const tid = parseInt(pill.getAttribute('data-tab-id'), 10);
          const sid = pill.getAttribute('data-session-id') || '';
          const defName = pill.getAttribute('data-default-name') || 'Tab 1';
          setTabCustomName(tid, sid, defName);
        }
        return;
      }

      const pill = e.target.closest('.tab-pill');
      if (!pill) return;
      const tid = parseInt(pill.getAttribute('data-tab-id'), 10);
      if (isNaN(tid) || tid === currentTabId) return;

      currentTabId = tid;
      if (tabSelector) tabSelector.value = String(tid);

      multitabStrip.querySelectorAll('.tab-pill').forEach(p => {
        p.classList.toggle('active', parseInt(p.getAttribute('data-tab-id'), 10) === currentTabId);
      });

      lastTablesSignature = '';
      fetchFullData();
    });

    // Nhấp đúp chuột vào thẻ tab cũng cho phép đổi tên
    multitabStrip.addEventListener('dblclick', (e) => {
      const pill = e.target.closest('.tab-pill');
      if (!pill) return;
      const tid = parseInt(pill.getAttribute('data-tab-id'), 10);
      const sid = pill.getAttribute('data-session-id') || '';
      const defName = pill.getAttribute('data-default-name') || 'Tab 1';
      setTabCustomName(tid, sid, defName);
    });
  }

  // Nút Chạy Toàn Dàn (Batch Start All Tabs)
  if (btnRunAllTabs) {
    btnRunAllTabs.addEventListener('click', async () => {
      if (!cachedWmTabs || cachedWmTabs.length === 0) return;
      btnRunAllTabs.innerText = '⏳ Đang bật...';
      btnRunAllTabs.disabled = true;

      const blockedTabs = [];

      for (const { tab, info } of cachedWmTabs) {
        try {
          const resp = await new Promise(res => chrome.tabs.sendMessage(tab.id, { action: 'WM_START_RUN' }, res));
          if (resp && !resp.isRunning && resp.error === 'LIMIT_EXCEEDED') {
            const tName = getTabCustomName(tab, info, cachedWmTabs.findIndex(w => w.tab.id === tab.id));
            blockedTabs.push(`${tName}: ${resp.message || 'Đạt hạn mức tổng cược'}`);
          }
        } catch (e) {}
      }

      setTimeout(() => {
        btnRunAllTabs.innerText = '▶️ Chạy Toàn Dàn';
        btnRunAllTabs.disabled = false;
        if (blockedTabs.length > 0) {
          alert(`⚠️ Có ${blockedTabs.length} tab không thể bật cược Auto vì chạm hạn mức cược:\n\n- ${blockedTabs.join('\n- ')}\n\n👉 Vui lòng chuyển sang tab đó và bấm "🗑️ Xóa DL" để bắt đầu lại hoặc nâng hạn mức cược!`);
        }
        refreshTabsList();
        fetchFullData();
      }, 600);
    });
  }

  // Nút Dừng Toàn Dàn (Batch Stop All Tabs)
  if (btnStopAllTabs) {
    btnStopAllTabs.addEventListener('click', async () => {
      if (!cachedWmTabs || cachedWmTabs.length === 0) return;
      btnStopAllTabs.innerText = '⏳ Đang dừng...';
      btnStopAllTabs.disabled = true;

      for (const { tab } of cachedWmTabs) {
        try {
          await new Promise(res => chrome.tabs.sendMessage(tab.id, { action: 'WM_STOP_RUN' }, res));
        } catch (e) {}
      }

      setTimeout(() => {
        btnStopAllTabs.innerText = '⏹️ Dừng Toàn Dàn';
        btnStopAllTabs.disabled = false;
        refreshTabsList();
        fetchFullData();
      }, 600);
    });
  }

  if (tabSelector) {
    tabSelector.addEventListener('change', () => {
      const selected = parseInt(tabSelector.value, 10);
      if (!isNaN(selected) && selected > 0) {
        currentTabId = selected;
        lastTablesSignature = '';
        fetchFullData();
      }
    });
  }

  // =========================================================================
  // 2. Định kỳ kéo toàn bộ dữ liệu (Poll Full Data) từ Tab Game
  // =========================================================================
  async function fetchFullData() {
    if (!currentTabId || isPolling) return;
    isPolling = true;

    try {
      const res = await new Promise((resolve) => {
        chrome.tabs.sendMessage(currentTabId, { action: 'WM_GET_FULL_DATA' }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.success) resolve(null);
          else resolve(resp);
        });
      });

      if (res) {
        renderPanelData(res);
      } else {
        // Có thể tab vừa đóng hoặc reload
        refreshTabsList();
      }
    } catch (e) {
    } finally {
      isPolling = false;
    }
  }

  function renderPanelData(data) {
    // 1. Trạng thái chạy & Nút Master
    const isRunning = Boolean(data.isRunning);
    setPanelControlsLocked(isRunning);
    if (btnMasterToggle) {
      if (isRunning) {
        btnMasterToggle.className = 'btn-master-run stop';
        btnMasterToggle.innerHTML = '⏸️ Tạm Dừng';
      } else {
        btnMasterToggle.className = 'btn-master-run start';
        btnMasterToggle.innerHTML = '▶️ Auto Cược';
      }
    }

    // 2. Trạng thái Headless Mode (Ẩn bảng trên game)
    isHeadlessState = Boolean(data.isHeadless);
    if (headlessToggle) {
      headlessToggle.classList.toggle('active', isHeadlessState);
    }

    // 3. Phỉnh cược đang chọn (chỉ đồng bộ từ game nếu người dùng không vừa bấm đổi)
    if (Date.now() - lastChipUserInteraction > 3000) {
      const chip = data.selectedChip || userSelectedChip || 10;
      userSelectedChip = chip;
      updateChipUI(chip);
    }

    // 4. Các tùy chọn nhanh (chỉ cập nhật nếu người dùng không đang gõ)
    if (optTradingMode && document.activeElement !== optTradingMode) {
      optTradingMode.value = data.tradingMode || 'REAL';
    }
    if (optAiFilter && document.activeElement !== optAiFilter) {
      optAiFilter.value = data.aiFilterMode || 'LOW';
    }
    if (optMaxBet && document.activeElement !== optMaxBet) {
      optMaxBet.value = data.maxTotalBet || 0;
    }
    if (optMaxConcurrent && document.activeElement !== optMaxConcurrent) {
      optMaxConcurrent.value = data.maxConcurrentBets || 5;
    }
    updateSettingsMiniTags();

    
    // 4b. Cập nhật tiến độ hạn mức cược & cược đồng thời
    const currentTotalAmount = (data.stats && data.stats.totalAmount) || 0;
    const maxTotalBet = data.maxTotalBet || 0;
    if (limitProgressText && limitPercent) {
      if (maxTotalBet <= 0) {
        limitProgressText.textContent = `${formatCompactMoney(currentTotalAmount)} (K.giới hạn)`;
        limitProgressText.style.color = '#94a3b8';
        limitPercent.textContent = '∞';
        limitPercent.style.color = '#38bdf8';
      } else {
        const pct = Math.min(100, Math.round((currentTotalAmount / maxTotalBet) * 100));
        limitProgressText.textContent = `${formatCompactMoney(currentTotalAmount)} / ${formatCompactMoney(maxTotalBet)}`;
        limitPercent.textContent = `${pct}%`;
        if (pct >= 100) {
          limitProgressText.style.color = '#ef4444';
          limitPercent.style.color = '#ef4444';
        } else if (pct >= 80) {
          limitProgressText.style.color = '#f59e0b';
          limitPercent.style.color = '#f59e0b';
        } else {
          limitProgressText.style.color = '#38bdf8';
          limitPercent.style.color = '#10b981';
        }
      }
    }

    if (concurrentText && concurrentBadge) {
      const pendingCount = data.pendingCount || 0;
      const maxConcurrent = data.maxConcurrentBets || 5;
      if (maxConcurrent <= 0) {
        concurrentText.textContent = `${pendingCount} lệnh (K.giới hạn)`;
        concurrentBadge.textContent = 'K.GIỚI HẠN';
        concurrentBadge.style.color = '#38bdf8';
      } else {
        concurrentText.textContent = `${pendingCount} / ${maxConcurrent} lệnh`;
        if (pendingCount >= maxConcurrent) {
          concurrentBadge.textContent = 'ĐẦY LỆNH';
          concurrentBadge.style.color = '#ef4444';
        } else {
          concurrentBadge.textContent = 'SẴN SÀNG';
          concurrentBadge.style.color = '#10b981';
        }
      }
    }

    if (optMaxTables && document.activeElement !== optMaxTables) {
      optMaxTables.value = data.maxTables || 50;
    }

    // 5. KPI Stats
    const s = data.stats || {};
    const minBets = (s.wins || 0) + (s.losses || 0) + (s.ties || 0);
    const displayTotalBets = Math.max(s.totalBets || 0, minBets);
    if (kpiTotalBets) kpiTotalBets.innerText = `${displayTotalBets} ván`;
    if (kpiWinRate) kpiWinRate.innerText = `${s.wins || 0}W - ${s.losses || 0}L (${s.winRate || 0}%)`;

    const p = s.totalProfit || 0;
    const pClass = p > 0 ? 'positive' : (p < 0 ? 'negative' : 'zero');
    if (kpiProfit) {
      kpiProfit.className = `kpi-val ${pClass}`;
      kpiProfit.innerText = formatCompactMoney(p, true);
      kpiProfit.title = 'Tính chuẩn 100% theo các ván Đặt Thành Công & Đoán Trúng';
    }

    if (kpiProgress) {
      if (maxTotalBet <= 0) {
        kpiProgress.innerText = `${formatCompactMoney(currentTotalAmount)} / ∞`;
        if (kpiProgressTitle) kpiProgressTitle.innerText = 'Tiến Độ';
        kpiProgress.className = 'kpi-val zero';
      } else {
        const pct = Math.min(100, Math.round((currentTotalAmount / maxTotalBet) * 100));
        kpiProgress.innerText = `${formatCompactMoney(currentTotalAmount)} / ${formatCompactMoney(maxTotalBet)}`;
        if (kpiProgressTitle) kpiProgressTitle.innerText = `Tiến Độ (${pct}%)`;
        kpiProgress.className = `kpi-val ${pct >= 100 ? 'negative' : (pct >= 80 ? 'zero' : 'positive')}`;
      }
      kpiProgress.title = `Tiến độ hạn mức: ${formatCompactMoney(currentTotalAmount)} trên tổng hạn mức ${maxTotalBet > 0 ? formatCompactMoney(maxTotalBet) : 'Không giới hạn'}`;
    }

    const tables = data.tables || [];
    const pendingCount = data.pendingCount || 0;
    if (kpiTablesCount) {
      kpiTablesCount.innerText = `${tables.length} bàn ${pendingCount > 0 ? `(${pendingCount} chờ)` : ''}`;
    }
    if (tabTableCount) {
      tabTableCount.innerText = tables.length;
    }

    // 6. License Status
    if (licenseBadge) {
      if (data.license && data.license.valid) {
        licenseBadge.style.color = '#34d399';
        licenseBadge.style.borderColor = '#10b981';
        licenseBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        licenseBadge.innerText = `🟢 Còn ${data.license.daysLeft} ngày`;
      } else {
        const err = (data.license && data.license.error) || 'Chưa kích hoạt';
        licenseBadge.style.color = '#f87171';
        licenseBadge.style.borderColor = '#ef4444';
        licenseBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        licenseBadge.innerText = `🔴 ${err}`;
      }
    }

    // 6b. Cập nhật số lượng lịch sử cược
    const historyList = data.betHistory || [];
    if (tabHistoryCount) tabHistoryCount.innerText = historyList.length;
    if (histTotalBadge) histTotalBadge.innerText = historyList.length;

    // 7. Render nội dung theo Tab đang chọn
    if (activeView === 'view-tables') {
      renderTables(tables);
    } else if (activeView === 'view-history') {
      renderHistory(historyList);
    } else if (activeView === 'view-signals') {
      renderSignals(data.recentPredictions || []);
    } else if (activeView === 'view-logs') {
      renderLogs(data.logs || []);
    }
  }

  // =========================================================================
  // 3. Render danh sách bàn chơi & Chuỗi hạt Châu Bàn (ZhuPan)
  // =========================================================================
  const tableCardsCache = new Map();

  function renderTables(tables) {
    if (!tablesContainer) return;

    if (!tables || tables.length === 0) {
      tableCardsCache.clear();
      renderEmptyState('Đang quét bàn... Nếu chưa thấy, hãy bấm nút "🔄 Quét 36 Bàn" ở trên!');
      return;
    }

    const emptyMsg = tablesContainer.querySelector('.empty-state');
    if (emptyMsg) {
      tablesContainer.innerHTML = '';
      tableCardsCache.clear();
    }

    const currentIds = new Set(tables.map(t => t.id));

    // Dọn dẹp card của bàn không còn tồn tại
    for (const [id, entry] of tableCardsCache.entries()) {
      if (!currentIds.has(id)) {
        if (entry.card && entry.card.parentNode) entry.card.remove();
        tableCardsCache.delete(id);
      }
    }

    // Cập nhật in-place từng card (KHÔNG BAO GIỜ XÓA ĐI TẠO LẠI -> 0% LAG NÚT CƯỢC)
    tables.forEach(t => {
      let timeClass = 'closed';
      let timeText = 'Chờ';
      const bt = t.betTime;
      if (bt > 10) {
        timeClass = 'green';
        timeText = `⏳ ${bt}s`;
      } else if (bt > 4) {
        timeClass = 'yellow';
        timeText = `⏳ ${bt}s`;
      } else if (bt > 0) {
        timeClass = 'red';
        timeText = `⏳ ${bt}s`;
      }

      const hist = t.history || [];
      const histSig = hist.join('');

      let entry = tableCardsCache.get(t.id);

      if (!entry || !entry.card || !tablesContainer.contains(entry.card)) {
        // TẠO MỚI CARD LẦN ĐẦU DUY NHẤT
        const card = document.createElement('div');
        card.className = 'table-card';
        card.setAttribute('data-table-id', t.id);

        const beadsHtml = hist.length > 0
          ? hist.map(r => `<span class="bead-dot ${r}">${r}</span>`).join('')
          : '<span style="font-size:10px; color:#475569;">Chưa có lịch sử ván</span>';

        let aiHtml = '';
        if (t.prediction && t.prediction.bet) {
          const betSide = t.prediction.bet === 'B' ? 'BANKER' : 'PLAYER';
          const color = t.prediction.bet === 'B' ? '#ef4444' : '#38bdf8';
          const conf = t.prediction.confidence ? Math.round(t.prediction.confidence * 100) : 80;
          aiHtml = `
            <div class="ai-signal-banner">
              <span class="ai-signal-badge" style="color:${color};">🤖 AI: ĐÁNH ${betSide} (${conf}%)</span>
              <span style="color:#94a3b8; font-size:10px;">${escapeHtml(formatPatternShort(t.prediction.pattern || t.prediction.reason))}</span>
            </div>
          `;
        }

        card.innerHTML = `
          <div class="t-header">
            <div class="t-name-wrap">
              <span class="t-name">${escapeHtml(t.name || t.id)}</span>
              <span class="t-shoe">Bàn #${escapeHtml(t.canonicalId || t.id)}</span>
            </div>
            <span class="t-timer ${timeClass}">${timeText}</span>
          </div>
          <div class="road-wrap" title="Chuỗi Châu Bàn (ZhuPan Road)">
            ${beadsHtml}
          </div>
          <div class="ai-box">${aiHtml}</div>
          <div class="bet-actions">
            <button class="btn-manual-bet bet-p" data-table-id="${t.id}" data-side="P" title="Cược ngay cửa Player">
              🔵 [P] Player
            </button>
            <button class="btn-manual-bet bet-t" data-table-id="${t.id}" data-side="T" title="Cược ngay cửa Tie">
              🟢 [T] Tie
            </button>
            <button class="btn-manual-bet bet-b" data-table-id="${t.id}" data-side="B" title="Cược ngay cửa Banker">
              🔴 [B] Banker
            </button>
          </div>
        `;

        tablesContainer.appendChild(card);
        const roadEl = card.querySelector('.road-wrap');
        if (roadEl) roadEl.scrollLeft = roadEl.scrollWidth;

        entry = {
          card,
          timerEl: card.querySelector('.t-timer'),
          roadEl,
          aiBox: card.querySelector('.ai-box'),
          lastHistSig: histSig,
          lastAiSig: t.prediction ? `${t.prediction.bet}_${t.prediction.pattern}` : ''
        };
        tableCardsCache.set(t.id, entry);
      } else {
        // CẬP NHẬT TRỰC TIẾP TỪNG THẺ (GIỮ NGUYÊN 100% CÁC NÚT BẤM, KHÔNG RESET NÚT)
        if (entry.timerEl && entry.timerEl.textContent !== timeText) {
          entry.timerEl.textContent = timeText;
          entry.timerEl.className = `t-timer ${timeClass}`;
        }

        if (entry.lastHistSig !== histSig) {
          entry.lastHistSig = histSig;
          if (entry.roadEl) {
            entry.roadEl.innerHTML = hist.length > 0
              ? hist.map(r => `<span class="bead-dot ${r}">${r}</span>`).join('')
              : '<span style="font-size:10px; color:#475569;">Chưa có lịch sử ván</span>';
            entry.roadEl.scrollLeft = entry.roadEl.scrollWidth;
          }
        }

        const currentAiSig = t.prediction ? `${t.prediction.bet}_${t.prediction.pattern}` : '';
        if (entry.lastAiSig !== currentAiSig) {
          entry.lastAiSig = currentAiSig;
          if (entry.aiBox) {
            if (t.prediction && t.prediction.bet) {
              const betSide = t.prediction.bet === 'B' ? 'BANKER' : 'PLAYER';
              const color = t.prediction.bet === 'B' ? '#ef4444' : '#38bdf8';
              const conf = t.prediction.confidence ? Math.round(t.prediction.confidence * 100) : 80;
              entry.aiBox.innerHTML = `
                <div class="ai-signal-banner">
                  <span class="ai-signal-badge" style="color:${color};">🤖 AI: ĐÁNH ${betSide} (${conf}%)</span>
                  <span style="color:#94a3b8; font-size:10px;">${escapeHtml(formatPatternShort(t.prediction.pattern || t.prediction.reason))}</span>
                </div>
              `;
            } else {
              entry.aiBox.innerHTML = '';
            }
          }
        }
      }
    });
  }

  // Lắng nghe sự kiện cược tay theo cơ chế Event Delegation (Bấm là ăn ngay lập tức, 0ms lag)
  if (tablesContainer) {
    tablesContainer.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('.btn-manual-bet');
      if (btn) btn.style.transform = 'scale(0.93)';
    });

    tablesContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-manual-bet');
      if (!btn) return;
      btn.style.transform = '';

      const tableId = btn.getAttribute('data-table-id');
      const side = btn.getAttribute('data-side');
      if (!currentTabId || !tableId || !side) return;

      // Phản hồi xúc giác thị giác tức thì (Instant Visual Flash)
      btn.classList.add('active-bet-click');
      setTimeout(() => btn.classList.remove('active-bet-click'), 200);

      chrome.tabs.sendMessage(currentTabId, {
        action: 'WM_MANUAL_BET',
        tableId: tableId,
        side: side
      });
    });
  }

  
  function renderHistory(history) {
    if (histTotalBadge) histTotalBadge.innerText = (history && history.length) || 0;
    if (!historyContainer) return;
    if (!history || history.length === 0) {
      historyContainer.innerHTML = `
        <div class="empty-state">
          📊 Chưa có lịch sử cược nào được ghi nhận.<br>
          Bấm <b>"BẮT ĐẦU CƯỢC AUTO"</b> hoặc đặt cược tay trên từng bàn để ghi nhận lịch sử!
        </div>
      `;
      return;
    }

    historyContainer.innerHTML = history.slice(0, 50).map(item => {
      const isBanker = item.bet === 'B';
      const isTie = item.bet === 'T';
      const betClass = isBanker ? 'banker' : (isTie ? 'tie' : 'player');
      const betText = isBanker ? '🔴 Banker' : (isTie ? '🟢 Tie' : '🔵 Player');

      let resClass = 'pending';
      let resText = '⏳ ĐANG ĐỢI';
      let profitHtml = '<span style="color:#64748b;">--</span>';

      if (item.result === 'WIN') {
        resClass = 'win';
        resText = '✅ THẮNG';
        const pNum = Number(item.profit) || 0;
        profitHtml = `<span class="hist-profit win">+${pNum.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}k</span>`;
      } else if (item.result === 'LOSS') {
        resClass = 'loss';
        resText = '❌ THUA';
        const pNum = Number(item.profit) || 0;
        profitHtml = `<span class="hist-profit loss">${pNum.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}k</span>`;
      } else if (item.result === 'TIE') {
        resClass = 'tie';
        resText = '🟡 HÒA';
        profitHtml = `<span class="hist-profit tie">0k</span>`;
      } else if (item.result === 'TIMEOUT') {
        resClass = 'loss';
        resText = '⏱️ HẾT GIỜ';
        profitHtml = `<span class="hist-profit tie">0k</span>`;
      } else if (item.result === 'FAILED' || !item.success) {
        resClass = 'loss';
        resText = '❌ TRƯỢT (KHÔNG VÀO TIỀN)';
        profitHtml = `<span class="hist-profit pending">--</span>`;
      } else if (item.success && item.result === 'PENDING') {
        resClass = 'pending';
        resText = '✅ ĐÃ CƯỢC';
        profitHtml = `<span class="hist-profit pending">--</span>`;
      }

      const amountStr = (Number(item.amount) || 10) + 'k';
      const safeTable = escapeHtml(item.table || item.tableId || 'Bàn cược');
      const rawPattern = item.pattern || item.reason || '';
      const cleanPattern = escapeHtml(formatPatternShort(rawPattern));

      return `
        <div class="history-item" title="${escapeHtml(rawPattern)}">
          <div class="hist-row-main">
            <div class="hist-main-left">
              <span class="hist-table">${safeTable}</span>
              <span class="hist-badge ${betClass}">${betText}</span>
              <span class="hist-amount">${amountStr}</span>
            </div>
            <div class="hist-main-right">
              ${profitHtml}
              <span class="hist-result-tag ${resClass}">${resText}</span>
            </div>
          </div>
          <div class="hist-row-sub">
            <span>⏱️ ${escapeHtml(item.time || '')}</span>
            <span class="hist-pattern-short">${cleanPattern ? '⚡ ' + cleanPattern : ''}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderSignals(signals) {
    if (!signalsContainer) return;
    if (!signals || signals.length === 0) {
      signalsContainer.innerHTML = `
        <div class="empty-state">
          🤖 Chưa có tín hiệu dự đoán AI gần đây.<br>
          Hệ thống đang quét cầu tự động trên 36 bàn!
        </div>
      `;
      return;
    }

    signalsContainer.innerHTML = signals.slice().reverse().map(s => {
      const sideName = s.predicted === 'B' ? '🔴 BANKER' : (s.predicted === 'P' ? '🔵 PLAYER' : s.predicted);
      let statusColor = '#38bdf8';
      let statusText = 'CHỜ';
      if (s.status === 'WIN') {
        statusColor = '#10b981';
        statusText = '✅ THẮNG';
      } else if (s.status === 'LOSS') {
        statusColor = '#ef4444';
        statusText = '❌ THUA';
      } else if (s.status === 'TIE_PUSH') {
        statusColor = '#f59e0b';
        statusText = '🟡 HÒA';
      }

      return `
        <div class="signal-item">
          <div>
            <b>${escapeHtml(s.tableName || s.tableId)}</b>: Cửa <b>${sideName}</b>
            <div style="font-size:10px; color:#64748b;">${escapeHtml(s.pattern || 'Dự đoán học sâu')} • ${escapeHtml(s.time || '')}</div>
          </div>
          <div style="font-weight:800; color:${statusColor}; font-size:11.5px;">
            ${statusText}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderLogs(logs) {
    if (!terminalLogs) return;
    if (!logs || logs.length === 0) {
      terminalLogs.innerHTML = '<div class="log-line info">Chưa có nhật ký hoạt động nào.</div>';
      return;
    }

    const isScrolledToBottom = terminalLogs.scrollHeight - terminalLogs.clientHeight <= terminalLogs.scrollTop + 40;

    terminalLogs.innerHTML = logs.map(l => {
      const type = l.type || 'info';
      const msg = typeof l === 'string' ? l : `[${l.time || ''}] ${l.msg || l.message || ''}`;
      return `<div class="log-line ${type}">${escapeHtml(msg)}</div>`;
    }).join('');

    if (isScrolledToBottom) {
      terminalLogs.scrollTop = terminalLogs.scrollHeight;
    }
  }

  function renderEmptyState(text) {
    if (tablesContainer) {
      tablesContainer.innerHTML = `
        <div class="empty-state">
          ${text.replace(/\n/g, '<br>')}
        </div>
      `;
    }
  }

  // =========================================================================
  // 4. Các nút tương tác & Điều khiển Master
  // =========================================================================
  // Bật/Tắt cược Auto
  if (btnMasterToggle) {
    btnMasterToggle.addEventListener('click', () => {
      if (!currentTabId) return;
      btnMasterToggle.innerText = '⏳ Đang gửi lệnh...';
      btnMasterToggle.disabled = true;

      // Phản hồi giao diện lập tức: khóa hoặc mở khóa controls tương ứng
      const willBeRunning = !isCurrentTabRunning;
      setPanelControlsLocked(willBeRunning);

      chrome.tabs.sendMessage(currentTabId, { action: 'WM_TOGGLE_RUN' }, (resp) => {
        btnMasterToggle.disabled = false;
        if (chrome.runtime.lastError) {
          alert('⚠️ Không thể kết nối tới Tab game này. Vui lòng kiểm tra lại trang sảnh game hoặc tải lại trang (F5)!');
        } else if (resp && !resp.isRunning && resp.error === 'LIMIT_EXCEEDED') {
          alert(`⚠️ KHÔNG THỂ BẬT CƯỢC AUTO CHO TAB NÀY:\n\n${resp.message || 'Đã đạt hạn mức tổng cược!'}\n\n👉 Giải pháp: Bấm nút "🗑️ Xóa DL" để đặt lại dữ liệu tab này về 0, hoặc nâng "Hạn mức tổng cược" trong bảng Cấu hình.`);
        } else if (resp && !resp.isRunning && resp.error) {
          alert(`⚠️ Không thể bật cược Auto: ${resp.message || resp.error}`);
        }
        fetchFullData();
        refreshTabsList();
      });
    });
  }

  // Bấm Quét 36 bàn
  if (btnMasterScan) {
    btnMasterScan.addEventListener('click', () => {
      if (!currentTabId) return;
      btnMasterScan.innerText = '⏳ Quét...';
      btnMasterScan.disabled = true;

      chrome.tabs.sendMessage(currentTabId, { action: 'WM_FORCE_SCROLL' }, () => {
        setTimeout(() => {
          btnMasterScan.innerText = '🔄 Quét 36 Bàn';
          btnMasterScan.disabled = false;
          lastTablesSignature = '';
          fetchFullData();
        }, 1200);
      });
    });
  }

  // Bật/Tắt Headless Mode (Ẩn bảng trên game)
  if (headlessSwitchBtn) {
    headlessSwitchBtn.addEventListener('click', () => {
      if (!currentTabId) return;
      const targetState = !isHeadlessState;

      chrome.tabs.sendMessage(currentTabId, {
        action: 'WM_SET_HEADLESS',
        headless: targetState
      }, () => {
        isHeadlessState = targetState;
        if (headlessToggle) headlessToggle.classList.toggle('active', isHeadlessState);
      });
    });
  }

  // Chọn phỉnh cược - Bấm là phản hồi tức thì 100% (Khóa khi đang cược auto)
  chipItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      if (isCurrentTabRunning) return;
      const chipVal = parseInt(item.getAttribute('data-chip'), 10);
      if (isNaN(chipVal) || chipVal <= 0) return;

      userSelectedChip = chipVal;
      lastChipUserInteraction = Date.now();
      localStorage.setItem('wm_chip', String(chipVal));
      updateChipUI(chipVal);

      if (currentTabId) {
        chrome.tabs.sendMessage(currentTabId, {
          action: 'WM_UPDATE_SETTINGS',
          selectedChip: chipVal
        });
      }
    });
  });

  // Cập nhật tag tóm tắt cấu hình trên header Accordion
  function updateSettingsMiniTags() {
    if (smTagMode && optTradingMode) {
      smTagMode.innerText = optTradingMode.value === 'REAL' ? '🟢 REAL' : '🔵 PAPER';
    }
    if (smTagAi && optAiFilter) {
      smTagAi.innerText = optAiFilter.value === 'FLASH' ? '⚡ FLASH' : (optAiFilter.value === 'HIGH' ? '🔒 HIGH' : '🛡️ STD');
    }
    if (smTagLimit && optMaxBet) {
      const v = parseInt(optMaxBet.value, 10);
      smTagLimit.innerText = (!isNaN(v) && v > 0) ? `Max: ${formatCompactMoney(v)}` : 'Max: ∞';
    }
  }

  // Bật/Tắt Popup Cấu hình tiền cược & Hạn mức
  if (settingsHeaderBtn && settingsAccordion) {
    settingsHeaderBtn.addEventListener('click', (e) => {
      if (e.target.closest('#btn-clear-data') || e.target.closest('#btn-close-settings-popup')) return;
      settingsAccordion.classList.toggle('collapsed');
      const isCollapsed = settingsAccordion.classList.contains('collapsed');
      if (settingsChevron) settingsChevron.innerText = isCollapsed ? '▾' : '▴';
      // Đóng dropdown tab nếu đang mở để tránh chồng chéo
      if (!isCollapsed && tabDropdownMenu) {
        tabDropdownMenu.style.display = 'none';
      }
    });

    // Nút đóng popup [✕]
    const btnCloseSettings = document.getElementById('btn-close-settings-popup');
    if (btnCloseSettings) {
      btnCloseSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsAccordion.classList.add('collapsed');
        if (settingsChevron) settingsChevron.innerText = '▾';
      });
    }

    // Đóng popup khi click ra bên ngoài
    document.addEventListener('click', (e) => {
      if (!settingsAccordion || settingsAccordion.classList.contains('collapsed')) return;
      if (!settingsAccordion.contains(e.target)) {
        settingsAccordion.classList.add('collapsed');
        if (settingsChevron) settingsChevron.innerText = '▾';
      }
    });
  }

  // Chế độ cược Real / Paper
  if (optTradingMode) {
    optTradingMode.addEventListener('change', () => {
      if (isCurrentTabRunning) return;
      updateSettingsMiniTags();
      if (!currentTabId) return;
      chrome.tabs.sendMessage(currentTabId, {
        action: 'WM_UPDATE_SETTINGS',
        tradingMode: optTradingMode.value
      });
    });
  }

  // Độ nhạy AI
  if (optAiFilter) {
    optAiFilter.addEventListener('change', () => {
      if (isCurrentTabRunning) return;
      updateSettingsMiniTags();
      if (!currentTabId) return;
      chrome.tabs.sendMessage(currentTabId, {
        action: 'WM_UPDATE_SETTINGS',
        aiFilterMode: optAiFilter.value
      });
    });
  }

  // Giới hạn cược
  if (optMaxBet) {
    optMaxBet.addEventListener('change', () => {
      if (isCurrentTabRunning) return;
      updateSettingsMiniTags();
      if (!currentTabId) return;
      chrome.tabs.sendMessage(currentTabId, {
        action: 'WM_UPDATE_SETTINGS',
        maxTotalBet: parseInt(optMaxBet.value, 10) || 0
      });
    });
  }

  // Số bàn tối đa cùng lúc
  if (optMaxConcurrent) {
    optMaxConcurrent.addEventListener('change', () => {
      if (isCurrentTabRunning) return;
      if (!currentTabId) return;
      chrome.tabs.sendMessage(currentTabId, {
        action: 'WM_UPDATE_SETTINGS',
        maxConcurrentBets: parseInt(optMaxConcurrent.value, 10) || 5
      });
    });
  }

  
  // Đồng bộ chọn chip từ dropdown
  if (optChipSelect) {
    optChipSelect.addEventListener('change', () => {
      if (isCurrentTabRunning) return;
      const chipVal = parseInt(optChipSelect.value, 10);
      if (isNaN(chipVal) || chipVal <= 0) return;
      userSelectedChip = chipVal;
      lastChipUserInteraction = Date.now();
      localStorage.setItem('wm_chip', String(chipVal));
      updateChipUI(chipVal);
      if (currentTabId) {
        chrome.tabs.sendMessage(currentTabId, {
          action: 'WM_UPDATE_SETTINGS',
          selectedChip: chipVal
        });
      }
    });
  }

  // Cài đặt số bàn tối đa theo dõi
  if (optMaxTables) {
    optMaxTables.addEventListener('change', () => {
      if (isCurrentTabRunning) return;
      const val = parseInt(optMaxTables.value, 10) || 50;
      localStorage.setItem('wm_max_tables', String(val));
      if (currentTabId) {
        chrome.tabs.sendMessage(currentTabId, {
          action: 'WM_UPDATE_SETTINGS',
          maxTables: val
        });
      }
    });
  }

  // Hàm xử lý Xóa Dữ Liệu Lịch Sử & Thống Kê
  function handleClearData() {
    if (isCurrentTabRunning) {
      alert('⚠️ Tool đang trong tiến trình CƯỢC AUTO!\nVui lòng bấm "TẠM DỪNG CƯỢC AUTO" trước khi xóa dữ liệu.');
      return;
    }
    const activeEntry = cachedWmTabs.find(w => w.tab.id === currentTabId);
    const tabName = activeEntry ? getTabCustomName(activeEntry.tab, activeEntry.info, cachedWmTabs.indexOf(activeEntry)) : 'Tab đang chọn';

    if (!confirm(`Bạn có chắc chắn muốn xóa toàn bộ lịch sử cược và đặt lại doanh thu của "${tabName}" về 0?`)) return;

    // Xóa hiển thị cục bộ ngay lập tức
    if (kpiTotalBets) kpiTotalBets.innerText = '0 ván';
    if (kpiWinRate) kpiWinRate.innerText = '0W - 0L';
    if (kpiProfit) {
      kpiProfit.className = 'kpi-val zero';
      kpiProfit.innerText = '0k';
    }
    if (kpiProgress) {
      kpiProgress.className = 'kpi-val zero';
      kpiProgress.innerText = '0k / ∞';
    }
    if (kpiProgressTitle) kpiProgressTitle.innerText = 'Tiến Độ';
    if (tabHistoryCount) tabHistoryCount.innerText = '0';
    if (histTotalBadge) histTotalBadge.innerText = '0';
    if (historyContainer) {
      historyContainer.innerHTML = `
        <div class="empty-state">
          📊 Chưa có lịch sử cược nào được ghi nhận.<br>
          Bấm <b>"BẮT ĐẦU CƯỢC AUTO"</b> hoặc đặt cược tay trên từng bàn để ghi nhận lịch sử!
        </div>
      `;
    }

    // Xóa legacy global cache nếu có
    try {
      chrome.storage.local.remove(['wm_cumulative_stats', 'wm_bet_history']);
    } catch (e) {}

    // Gửi lệnh xóa dữ liệu sang tab game hiện tại (ĐỘC LẬP 100%, KHÔNG ẢNH HƯỞNG CÁC TAB KHÁC)
    if (currentTabId) {
      chrome.tabs.sendMessage(currentTabId, { action: 'WM_CLEAR_HISTORY' }, () => {
        fetchFullData();
        refreshTabsList();
      });
    }
  }

  // Gán sự kiện cho cả 2 nút Xóa Dữ Liệu (ở bảng Cấu hình & ở đầu Tab Lịch Sử)
  if (btnClearData) {
    btnClearData.addEventListener('click', handleClearData);
  }
  if (btnClearHistoryTab) {
    btnClearHistoryTab.addEventListener('click', handleClearData);
  }

  // Chuyển Tab Navigation (Bàn chơi / Tín hiệu AI / Nhật ký)
  navTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.getAttribute('data-view');
      activeView = target;

      document.querySelectorAll('.view-content').forEach(vc => {
        vc.classList.toggle('active', vc.id === target);
      });

      lastTablesSignature = '';
      fetchFullData();
    });
  });

  
  function formatPatternShort(str) {
    if (!str) return 'Cược thủ công';
    // Lọc sạch các chuỗi chẩn đoán dài dòng (+ Chuỗi [...] đã gặp ... lần ...)
    let clean = str.replace(/\+?\s*Chuỗi\s*\[[A-Z]+\][\s\S]*/i, '').trim();
    clean = clean.replace(/\+?\s*Nhịp\s*bệt[\s\S]*/i, '').trim();
    if (!clean) clean = str.split('+')[0].trim();
    return clean.length > 32 ? clean.substring(0, 30) + '...' : clean;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // =========================================================================
  // 5. Khởi chạy & Vòng lặp tự động cập nhật
  // =========================================================================
  refreshTabsList().then(() => {
    fetchFullData();
  });

  // Quét danh sách tab mỗi 3 giây và kéo dữ liệu mỗi 800ms
  pollTimer = setInterval(() => {
    fetchFullData();
  }, 800);

  const tabScanTimer = setInterval(() => {
    refreshTabsList();
  }, 3500);

  window.addEventListener('unload', () => {
    if (pollTimer) clearInterval(pollTimer);
    if (tabScanTimer) clearInterval(tabScanTimer);
  });


  // =========================================================================
  // LOGIC MODAL THÊM TAB THỦ CÔNG
  // =========================================================================
  const modalAddTab = document.getElementById('modal-add-tab');
  const btnCloseAddTabModal = document.getElementById('btn-close-add-tab-modal');
  const btnAddTabManual = document.getElementById('btn-add-tab-manual');
  const inputAddTabUrl = document.getElementById('input-add-tab-url');
  const btnConfirmOpenTab = document.getElementById('btn-confirm-open-tab');
  const btnPasteCurrentUrl = document.getElementById('btn-paste-current-url');
  const otherChromeTabsList = document.getElementById('other-chrome-tabs-list');

  function openAddTabModal() {
    if (!modalAddTab) return;
    modalAddTab.style.display = 'flex';

    // Tự động điền URL của tab hiện tại nếu có
    if (inputAddTabUrl) {
      const activeTabInfo = cachedWmTabs.find(w => w.tab && w.tab.id === currentTabId);
      const curUrl = (activeTabInfo && activeTabInfo.info && activeTabInfo.info.url) ||
                     (activeTabInfo && activeTabInfo.tab && activeTabInfo.tab.url) || '';
      if (curUrl && !inputAddTabUrl.value) {
        inputAddTabUrl.value = curUrl;
      }
    }

    loadOtherChromeTabs();
  }

  function closeAddTabModal() {
    if (modalAddTab) modalAddTab.style.display = 'none';
  }

  async function loadOtherChromeTabs() {
    if (!otherChromeTabsList) return;
    otherChromeTabsList.innerHTML = '<div style="color:#64748b; font-size:11px; padding:6px;">⏳ Đang tìm kiếm các tab Chrome...</div>';

    try {
      const allTabs = await chrome.tabs.query({});
      const activeIds = new Set(cachedWmTabs.map(w => w.tab.id));
      const candidates = allTabs.filter(t => {
        if (!t.id || activeIds.has(t.id)) return false;
        const u = t.url || '';
        if (u.startsWith('chrome://') || u.startsWith('edge://') || u.startsWith('chrome-extension://')) return false;
        return true;
      });

      if (candidates.length === 0) {
        otherChromeTabsList.innerHTML = '<div style="color:#64748b; font-size:11px; padding:6px;">Không còn tab nào khác đang mở. Bạn có thể nhập link ở trên để mở tab mới!</div>';
        return;
      }

      otherChromeTabsList.innerHTML = candidates.map(t => {
        let domain = '';
        try { domain = new URL(t.url).hostname.replace(/^www\./i, ''); } catch (e) {}
        const titleSafe = escapeHtml(t.title || 'Tab Chrome');
        const domainSafe = escapeHtml(domain || t.url || '');

        return `
          <div class="tab-candidate-item">
            <div style="display:flex; flex-direction:column; overflow:hidden;">
              <span class="tab-candidate-title">${titleSafe}</span>
              <span style="font-size:10.5px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${domainSafe}</span>
            </div>
            <button class="btn-connect-tab" data-tab-id="${t.id}">🔗 Kết Nối</button>
          </div>
        `;
      }).join('');
    } catch (e) {
      otherChromeTabsList.innerHTML = '<div style="color:#ef4444; font-size:11px; padding:6px;">Lỗi tải danh sách tab: ' + escapeHtml(e.message) + '</div>';
    }
  }

  if (btnAddTabManual) {
    btnAddTabManual.addEventListener('click', openAddTabModal);
  }

  if (btnCloseAddTabModal) {
    btnCloseAddTabModal.addEventListener('click', closeAddTabModal);
  }

  if (modalAddTab) {
    modalAddTab.addEventListener('click', (e) => {
      if (e.target === modalAddTab) closeAddTabModal();
    });
  }

  if (btnPasteCurrentUrl && inputAddTabUrl) {
    btnPasteCurrentUrl.addEventListener('click', () => {
      const activeTabInfo = cachedWmTabs.find(w => w.tab && w.tab.id === currentTabId);
      const curUrl = (activeTabInfo && activeTabInfo.info && activeTabInfo.info.url) ||
                     (activeTabInfo && activeTabInfo.tab && activeTabInfo.tab.url) || '';
      if (curUrl) {
        inputAddTabUrl.value = curUrl;
      } else {
        alert('Chưa có link từ tab game hiện tại.');
      }
    });
  }

  if (btnConfirmOpenTab && inputAddTabUrl) {
    btnConfirmOpenTab.addEventListener('click', () => {
      let url = inputAddTabUrl.value.trim();
      if (!url) {
        const activeTabInfo = cachedWmTabs.find(w => w.tab && w.tab.id === currentTabId);
        url = (activeTabInfo && activeTabInfo.info && activeTabInfo.info.url) ||
              (activeTabInfo && activeTabInfo.tab && activeTabInfo.tab.url) || '';
      }
      if (!url) {
        alert('Vui lòng nhập đường link (URL) trang web sảnh game!');
        return;
      }
      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }

      btnConfirmOpenTab.innerText = '⏳ Đang mở tab...';
      btnConfirmOpenTab.disabled = true;

      chrome.tabs.create({ url: url, active: true }, (newTab) => {
        btnConfirmOpenTab.innerText = '🚀 Mở Tab Trình Duyệt Mới';
        btnConfirmOpenTab.disabled = false;
        closeAddTabModal();
        if (newTab && newTab.id) {
          ignoredTabIds.delete(newTab.id);
          saveIgnoredTabs();
          currentTabId = newTab.id;
        }
        setTimeout(() => refreshTabsList(), 1500);
      });
    });
  }

  if (otherChromeTabsList) {
    otherChromeTabsList.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-connect-tab');
      if (!btn) return;
      const tid = parseInt(btn.getAttribute('data-tab-id'), 10);
      if (isNaN(tid)) return;

      ignoredTabIds.delete(tid);
      saveIgnoredTabs();
      currentTabId = tid;
      closeAddTabModal();

      btn.innerText = '⏳ Đang nạp...';
      btn.disabled = true;

      chrome.tabs.sendMessage(tid, { action: 'WM_GET_TAB_STATUS' }, () => {
        refreshTabsList();
        fetchFullData();
      });
    });
  }


  // =========================================================================
  // XỬ LÝ ĐÓNG / MỞ POPUP LIST TAB DẠNG SELECT & QUẢN LÝ CÁC TRANG ĐÃ ẨN
  // =========================================================================
  const tabDropdownTriggerBtn = document.getElementById('tab-dropdown-trigger');
  const tabDropdownMenu = document.getElementById('tab-dropdown-menu');
  const dropdownTabsList = document.getElementById('dropdown-tabs-list');
  const dropdownHiddenTabsList = document.getElementById('dropdown-hidden-tabs-list');
  let isShowingHiddenView = false;

  function toggleDropdownMenu(forceState) {
    if (!tabDropdownMenu) return;
    const isCurrentlyOpen = tabDropdownMenu.style.display === 'block';
    const nextState = (forceState !== undefined) ? forceState : !isCurrentlyOpen;
    tabDropdownMenu.style.display = nextState ? 'block' : 'none';
    if (tabDropdownTriggerBtn) tabDropdownTriggerBtn.classList.toggle('open', nextState);
    const multitabHub = document.querySelector('.multitab-hub');
    if (multitabHub) {
      multitabHub.style.zIndex = nextState ? '99999' : '1000';
    }
    if (nextState) {
      updateHiddenTabsCount();
    }
  }

  function closeDropdownMenu() {
    toggleDropdownMenu(false);
    if (isShowingHiddenView) {
      switchToActiveView();
    }
  }

  if (tabDropdownTriggerBtn) {
    tabDropdownTriggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdownMenu();
    });
  }

  // Đóng dropdown khi nhấp chuột ra ngoài
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#tab-dropdown-wrap') && !e.target.closest('#modal-add-tab')) {
      closeDropdownMenu();
    }
  });

  // 1. Quản lý số lượng và danh sách tab đã ẩn
  async function updateHiddenTabsCount() {
    try {
      const allTabs = await chrome.tabs.query({});
      const openTabMap = new Map();
      allTabs.forEach(t => { if (t.id) openTabMap.set(t.id, t); });

      let cleaned = false;
      for (const tid of Array.from(ignoredTabIds)) {
        if (!openTabMap.has(tid)) {
          ignoredTabIds.delete(tid);
          cleaned = true;
        }
      }
      if (cleaned) saveIgnoredTabs();

      const count = ignoredTabIds.size;
      const btn = document.getElementById('dropdown-hidden-tabs-btn');
      const badge = document.getElementById('hidden-tabs-count-badge');
      if (btn) {
        btn.classList.toggle('has-hidden', count > 0);
      }
      if (badge) {
        badge.innerText = String(count);
        badge.style.display = count > 0 ? 'inline-block' : 'none';
      }
    } catch (e) {}
  }

  async function renderHiddenTabsList() {
    if (!dropdownHiddenTabsList) return;
    dropdownHiddenTabsList.innerHTML = '<div class="dropdown-empty">⏳ Đang tải các trang đã ẩn...</div>';

    try {
      const allTabs = await chrome.tabs.query({});
      const openTabMap = new Map();
      allTabs.forEach(t => { if (t.id) openTabMap.set(t.id, t); });

      let cleaned = false;
      for (const tid of Array.from(ignoredTabIds)) {
        if (!openTabMap.has(tid)) {
          ignoredTabIds.delete(tid);
          cleaned = true;
        }
      }
      if (cleaned) saveIgnoredTabs();

      const hiddenTabs = [];
      for (const tid of ignoredTabIds) {
        const t = openTabMap.get(tid);
        if (t) hiddenTabs.push(t);
      }

      updateHiddenTabsCount();

      if (hiddenTabs.length === 0) {
        dropdownHiddenTabsList.innerHTML = '<div class="dropdown-empty">Không có trang nào đang bị ẩn.</div>';
        return;
      }

      dropdownHiddenTabsList.innerHTML = hiddenTabs.map(t => {
        let domain = '';
        try { domain = new URL(t.url).hostname.replace(/^www\./i, ''); } catch (e) {}
        const titleSafe = escapeHtml(t.title || 'Tab Chrome #' + t.id);
        const domainSafe = escapeHtml(domain || t.url || '');

        return `
          <div class="dropdown-tab-item" data-tab-id="${t.id}" style="cursor:default;">
            <div class="dropdown-tab-left">
              <span class="tab-pill-dot stopped" style="background:#64748b;"></span>
              <span class="pill-name"><b>${titleSafe}</b></span>
              <span class="pill-domain">${domainSafe}</span>
              <span class="pill-tables-badge" style="background:rgba(245,158,11,0.15); color:#fbbf24; border-color:rgba(245,158,11,0.35);">Đang ẩn</span>
            </div>
            <div class="dropdown-tab-right">
              <button class="btn-restore-tab" data-tab-id="${t.id}" title="Hiện lại tab này trên thanh công cụ">👁️ Hiện lại</button>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      dropdownHiddenTabsList.innerHTML = '<div class="dropdown-empty" style="color:#ef4444;">Lỗi: ' + escapeHtml(e.message) + '</div>';
    }
  }

  function switchToHiddenView() {
    isShowingHiddenView = true;
    if (dropdownTabsList) dropdownTabsList.style.display = 'none';
    if (dropdownHiddenTabsList) dropdownHiddenTabsList.style.display = 'block';

    const titleWrap = document.getElementById('dropdown-title-wrap');
    const actionsWrap = document.getElementById('dropdown-header-actions');

    if (titleWrap) {
      titleWrap.innerHTML = `
        <button class="btn-dropdown-back" id="btn-back-to-active-tabs" type="button" title="Quay lại danh sách tab sảnh">← Quay lại</button>
        <span style="color:#fbbf24; margin-left:4px; font-weight:800; font-size:11px;">CÁC TRANG ĐÃ ẨN</span>
      `;
      const btnBack = document.getElementById('btn-back-to-active-tabs');
      if (btnBack) {
        btnBack.addEventListener('click', (e) => {
          e.stopPropagation();
          switchToActiveView();
        });
      }
    }

    if (actionsWrap) {
      actionsWrap.innerHTML = `
        <button class="btn-dropdown-unhide-all" id="btn-unhide-all-tabs" type="button" title="Hiện lại tất cả các tab đã ẩn">👁️ Hiện tất cả</button>
      `;
      const btnUnhideAll = document.getElementById('btn-unhide-all-tabs');
      if (btnUnhideAll) {
        btnUnhideAll.addEventListener('click', (e) => {
          e.stopPropagation();
          ignoredTabIds.clear();
          saveIgnoredTabs();
          refreshTabsList();
          switchToActiveView();
        });
      }
    }

    renderHiddenTabsList();
  }

  function switchToActiveView() {
    isShowingHiddenView = false;
    if (dropdownTabsList) dropdownTabsList.style.display = 'block';
    if (dropdownHiddenTabsList) dropdownHiddenTabsList.style.display = 'none';

    const titleWrap = document.getElementById('dropdown-title-wrap');
    const actionsWrap = document.getElementById('dropdown-header-actions');

    if (titleWrap) {
      titleWrap.innerHTML = `
        <span id="dropdown-title-text">DANH SÁCH TAB SẢNH</span>
        <span class="dropdown-count-badge" id="dropdown-tab-count">${cachedWmTabs.length} tab</span>
      `;
    }

    if (actionsWrap) {
      actionsWrap.innerHTML = `
        <button class="btn-dropdown-hidden" id="dropdown-hidden-tabs-btn" type="button" title="Xem danh sách các tab đã ẩn">👁️ Đã Ẩn <span id="hidden-tabs-count-badge" style="display:none; background:rgba(255,255,255,0.22); border-radius:10px; padding:0 5px; font-size:9.5px; margin-left:2px;">0</span></button>
        <button class="btn-dropdown-add" id="dropdown-add-tab-btn" type="button">➕ Thêm Tab</button>
      `;
      attachDropdownHeaderActions();
    }

    updateHiddenTabsCount();
  }

  function attachDropdownHeaderActions() {
    const btnHidden = document.getElementById('dropdown-hidden-tabs-btn');
    if (btnHidden) {
      btnHidden.addEventListener('click', (e) => {
        e.stopPropagation();
        switchToHiddenView();
      });
    }
    const btnAdd = document.getElementById('dropdown-add-tab-btn');
    if (btnAdd) {
      btnAdd.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDropdownMenu();
        openAddTabModal();
      });
    }
  }

  attachDropdownHeaderActions();

  // Xử lý sự kiện bên trong danh sách tab ĐÃ ẨN
  if (dropdownHiddenTabsList) {
    dropdownHiddenTabsList.addEventListener('click', (e) => {
      const restoreBtn = e.target.closest('.btn-restore-tab');
      if (!restoreBtn) return;
      e.stopPropagation();
      const tid = parseInt(restoreBtn.getAttribute('data-tab-id'), 10);
      if (isNaN(tid)) return;

      ignoredTabIds.delete(tid);
      saveIgnoredTabs();
      currentTabId = tid;
      refreshTabsList();
      renderHiddenTabsList();
    });
  }

  // Xử lý sự kiện bên trong danh sách Popup List (tab đang hoạt động)
  if (dropdownTabsList) {
    dropdownTabsList.addEventListener('click', (e) => {
      // 1. Nút ẩn tab (chỉ ẩn khỏi thanh công cụ của tool, KHÔNG đóng tab trình duyệt)
      const hideBtn = e.target.closest('.pill-hide-btn, .pill-close-btn');
      if (hideBtn) {
        e.stopPropagation();
        const item = hideBtn.closest('.dropdown-tab-item');
        if (!item) return;
        const tid = parseInt(item.getAttribute('data-tab-id'), 10);
        if (isNaN(tid)) return;

        ignoredTabIds.add(tid);
        saveIgnoredTabs();

        if (currentTabId === tid) {
          const remaining = cachedWmTabs.filter(w => w.tab.id !== tid);
          currentTabId = remaining.length > 0 ? remaining[0].tab.id : null;
        }

        refreshTabsList();
        updateHiddenTabsCount();
        return;
      }

      // 2. Nút đổi tên tab
      const renameBtn = e.target.closest('.pill-rename-btn');
      if (renameBtn) {
        e.stopPropagation();
        const item = renameBtn.closest('.dropdown-tab-item');
        if (item) {
          const tid = parseInt(item.getAttribute('data-tab-id'), 10);
          const sid = item.getAttribute('data-session-id') || '';
          const defName = item.getAttribute('data-default-name') || 'Tab 1';
          setTabCustomName(tid, sid, defName);
        }
        return;
      }

      // 3. Nhấp chọn tab để chuyển đổi
      const item = e.target.closest('.dropdown-tab-item');
      if (!item) return;
      const tid = parseInt(item.getAttribute('data-tab-id'), 10);
      if (isNaN(tid)) return;

      currentTabId = tid;
      if (tabSelector) tabSelector.value = String(tid);
      closeDropdownMenu();
      lastTablesSignature = '';
      try {
        chrome.tabs.update(tid, { active: true });
      } catch (e) {}
      fetchFullData();
      renderMultitabSummary(cachedWmTabs);
    });
  }

  // Nút liên hệ CSKH Telegram
  const linkCskh = document.getElementById('link-cskh');
  if (linkCskh) {
    linkCskh.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        chrome.tabs.create({ url: 'https://t.me/niadev01' });
      } catch (err) {
        window.open('https://t.me/niadev01', '_blank');
      }
    });
  }

  // Quản lý chuyển đổi giao diện Sáng / Tối (Liquid Glass iOS)
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const themeIcon = document.getElementById('theme-icon');
  const themeText = document.getElementById('theme-text');

  function applyTheme(theme) {
    const isLight = theme === 'light';
    document.body.classList.toggle('light-theme', isLight);
    if (themeIcon) themeIcon.innerText = isLight ? '🌙' : '☀️';
    if (themeText) themeText.innerText = isLight ? 'Tối' : 'Sáng';
    try {
      localStorage.setItem('wm_panel_theme', theme);
    } catch(e) {}
  }

  // Khởi tạo theme: mặc định chuyển sang Giao diện Sáng (Liquid Glass iOS)
  const savedTheme = localStorage.getItem('wm_panel_theme') || 'light';
  applyTheme(savedTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentIsLight = document.body.classList.contains('light-theme');
      applyTheme(currentIsLight ? 'dark' : 'light');
    });
  }
});
