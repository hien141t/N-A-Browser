/* ═══════════════════════════════════════════
   N/A Browser — Renderer Process (app.js)
   ═══════════════════════════════════════════ */

// Safe API wrapper — fallback nếu preload không load
const API = window.electronAPI || {
  minimize: () => {},
  maximize: () => {},
  close:    () => window.close(),
  loadDevices:  async () => {
    const r = await fetch('../devices.json');
    return r.json();
  },
  loadProfiles: async () => JSON.parse(localStorage.getItem('profiles') || '[]'),
  saveProfiles: async (p) => { localStorage.setItem('profiles', JSON.stringify(p)); return true; },
  launchBrowser: async () => ({ ok: false, error: 'No Electron API' }),
  closeBrowser:  async () => ({ ok: false }),
  getBrowserStatus: async () => ({}),
  saveScript: async () => ({ ok: false }),
  openUrl: (url) => window.open(url),
  getAppInfo: async () => ({ version:'1.0.0', platform:'linux', electron:'—', node:'—', userData:'—' }),
  supabaseGetConfig: async () => ({ url: '', anonKey: '' }),
  supabaseSaveConfig: async () => ({ ok: true }),
  supabaseTestConnection: async () => ({ ok: false, error: 'No Electron' }),
  authSignUp: async () => ({ ok: false, error: 'No Electron' }),
  authSignIn: async () => ({ ok: false, error: 'No Electron' }),
  authSignOut: async () => ({ ok: true }),
  authGetSession: async () => ({ ok: false, loggedIn: false }),
  syncPullProfiles: async () => ({ ok: false }),
  syncPushProfiles: async () => ({ ok: false }),
  syncProfileCookies: async () => ({ ok: false, error: 'No Electron' }),
  syncAllCookies: async () => ({ ok: false, error: 'No Electron' }),
  updaterGetPatchInfo: async () => ({ appVersion: '1.0.0', hasPatch: false, currentPatch: null }),
  updaterCheckPatch: async () => ({ ok: false, error: 'No Electron' }),
  updaterApplyPatch: async () => ({ ok: false, error: 'No Electron' }),
  updaterRelaunch: async () => {},
  updaterResetPatches: async () => ({ ok: true }),
  trashList:    async () => ({ ok: true, items: [] }),
  trashRestore: async () => ({ ok: false, error: 'No Electron' }),
  trashDelete:  async () => ({ ok: false, error: 'No Electron' }),
  trashClear:   async () => ({ ok: false, error: 'No Electron' }),
  proxyCheck:   async () => ({ ok: false, error: 'No Electron' }),
};

// ── State ──
let devices = [];
let profiles = [];
let extensions = [];
let browserStatus = {};
let editingId = null;
let selectedDeviceId = null;
let isGridView = false; // Mặc định là List View (Danh sách) đẹp mắt

// ── Init ──
async function init() {
  initLockScreen();
  await loadDevices();
  await loadProfiles();
  await loadExtensions();
  await refreshStatus();
  setupNav();
  setupTitlebar();
  setupModal();
  setupBatchModal();
  setupArrangeModal();
  setupToolbar();
  setupDeviceLibrary();
  setupExtensionsPage();
  setupSettings();
  setupAuth();
  await checkAuthStatus();
  setupLockAndAccount();
  setupUpdater();
  setupTrashPage();
  renderProfiles();
  refreshTrashBadge(); // Hiển thị badge Thùng Rác nếu có

  // Auto-refresh status every 5s
  setInterval(refreshStatus, 5000);

  // Lắng nghe event từ HTTP API: tự reload profiles khi có thay đổi
  if (window.electronAPI?.onProfilesReload) {
    window.electronAPI.onProfilesReload(async () => {
      await loadProfiles();
      renderProfiles();
      toast('🔄 Profiles đã được cập nhật từ API!', 'info');
    });
  }
}

// ── Titlebar ──
function setupTitlebar() {
  document.getElementById('btnMin').addEventListener('click', () => API.minimize());
  document.getElementById('btnMax').addEventListener('click', () => API.maximize());
  document.getElementById('btnClose').addEventListener('click', () => API.close());
}

// ── Navigation ──
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById(`page-${page}`)?.classList.add('active');
    });
  });
}

// ── Load Data ──
async function loadDevices() {
  const data = await API.loadDevices();
  devices = data.devices;
}

async function loadProfiles() {
  profiles = await API.loadProfiles();
}

async function saveProfiles() {
  await API.saveProfiles(profiles);
  if (currentUser && API.syncPushProfiles) {
    API.syncPushProfiles().catch(e => console.warn('Auto cloud push failed:', e));
  }
}

// ── Browser Status ──
async function refreshStatus() {
  browserStatus = await API.getBrowserStatus();
  updateStatusIndicators();
  renderProfiles();
}

function updateStatusIndicators() {
  const runningCount = Object.values(browserStatus).filter(s => s.running).length;
  document.getElementById('statRunning').textContent = runningCount;
  document.getElementById('statTotal').textContent = profiles.length;
  const elStatDev = document.getElementById('statDevices');
  if (elStatDev) elStatDev.textContent = devices.length;

  const dot = document.getElementById('sidebarDot');
  const statusTxt = document.getElementById('sidebarStatus');
  if (runningCount > 0) {
    dot.classList.add('active');
    statusTxt.textContent = `${runningCount} running`;
  } else {
    dot.classList.remove('active');
    statusTxt.textContent = '0 running';
  }
}

// ── Toolbar ──
function setupToolbar() {
  document.getElementById('searchProfiles').addEventListener('input', renderProfiles);
  document.getElementById('filterStatus').addEventListener('change', renderProfiles);
  document.getElementById('filterBrand').addEventListener('change', renderProfiles);
  document.getElementById('btnNewProfile').addEventListener('click', openNewProfileModal);
  document.getElementById('btnManualSyncCloud')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnManualSyncCloud');
    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.innerHTML = '⏳ Đang đồng bộ...';
      btn.style.opacity = '0.7';
      btn.disabled = true;
    }
    try {
      await syncWithCloud(ACCESS_CODE, true);
    } finally {
      if (btn) {
        btn.innerHTML = oldHtml;
        btn.style.opacity = '1';
        btn.disabled = false;
      }
    }
  });

  document.getElementById('btnSyncAllCookies')?.addEventListener('click', handleSyncAllCookies);

  document.getElementById('btnRefreshStatus').addEventListener('click', async () => {
    await refreshStatus();
    if (typeof syncWithCloud === 'function') await syncWithCloud(ACCESS_CODE);
    toast('🔄 Đã làm mới & đồng bộ hồ sơ', 'info');
  });
  document.getElementById('btnArrangeWindows')?.addEventListener('click', openArrangeModal);

  // Đọc chế độ xem đã lưu (Mặc định: List View)
  const savedViewMode = localStorage.getItem('viewMode') || 'list';
  isGridView = (savedViewMode === 'grid');
  if (isGridView) {
    document.getElementById('viewGrid').classList.add('active');
    document.getElementById('viewList').classList.remove('active');
  } else {
    document.getElementById('viewList').classList.add('active');
    document.getElementById('viewGrid').classList.remove('active');
  }

  document.getElementById('viewGrid').addEventListener('click', () => {
    isGridView = true;
    localStorage.setItem('viewMode', 'grid');
    document.getElementById('viewGrid').classList.add('active');
    document.getElementById('viewList').classList.remove('active');
    renderProfiles();
  });
  document.getElementById('viewList').addEventListener('click', () => {
    isGridView = false;
    localStorage.setItem('viewMode', 'list');
    document.getElementById('viewList').classList.add('active');
    document.getElementById('viewGrid').classList.remove('active');
    renderProfiles();
  });
}

// ── Render Profiles ──
function renderProfiles() {
  const q       = document.getElementById('searchProfiles').value.toLowerCase();
  const fStatus = document.getElementById('filterStatus').value;
  const fBrand  = document.getElementById('filterBrand').value;

  let filtered = profiles.filter(p => {
    const dev = devices.find(d => d.id === p.deviceId);
    if (q && !p.name.toLowerCase().includes(q) && !dev?.name.toLowerCase().includes(q)) return false;
    const running = browserStatus[p.id]?.running;
    if (fStatus === 'running' && !running) return false;
    if (fStatus === 'stopped' && running) return false;
    if (fBrand !== 'all' && dev?.brand !== fBrand) return false;
    return true;
  });

  const container = document.getElementById('profileContainer');
  const emptyState = document.getElementById('emptyState');

  // Remove old cards (keep emptyState)
  Array.from(container.children).forEach(c => {
    if (c !== emptyState) c.remove();
  });

  container.className = `profile-container ${isGridView ? 'grid-view' : 'list-view'}`;

  if (filtered.length === 0) {
    emptyState.style.display = '';
    return;
  }
  emptyState.style.display = 'none';

  filtered.forEach(profile => {
    const device = devices.find(d => d.id === profile.deviceId);
    const running = browserStatus[profile.id]?.running || false;
    const el = isGridView
      ? createProfileCard(profile, device, running)
      : createProfileListRow(profile, device, running);
    container.appendChild(el);
  });

  updateStatusIndicators();
}

// ── Profile Card (Grid) ──
function createProfileCard(profile, device, running) {
  const card = document.createElement('div');
  card.className = `profile-card${running ? ' running' : ''}`;
  card.style.setProperty('--card-accent', device?.color || '#6366f1');

  const proxy = profile.proxy?.host
    ? `${profile.proxy.type}://${profile.proxy.host}`
    : 'No proxy';

  const cookieCount = (profile.webData && Array.isArray(profile.webData.cookies)) ? profile.webData.cookies.length : (profile.webData?.count || 0);
  const hasHistory = !!(profile.webData && profile.webData.historyGz);
  const cookieTag = (cookieCount > 0 || hasHistory)
    ? `<span class="fp-tag ok" title="${cookieCount} cookies ${hasHistory ? '+ Lịch sử Ctrl+H ' : ''}đã lưu trên Cloud" style="border-color:rgba(245,158,11,0.4);background:rgba(245,158,11,0.12);color:#fbbf24">🍪 ${cookieCount}${hasHistory ? ' · 📜 History' : ''}</span>`
    : '';

  card.innerHTML = `
    <div class="card-top">
      <div class="card-device-icon">${device?.icon || '📱'}</div>
      <div class="card-info">
        <div class="card-name" title="${profile.name}">${profile.name}</div>
        <div class="card-device">${device?.name || 'Unknown device'}</div>
      </div>
      <div class="card-status-badge ${running ? 'running' : 'stopped'}">${running ? 'Running' : 'Stopped'}</div>
    </div>
    <div class="card-fp">
      <span class="fp-tag ok">✓ Touch</span>
      <span class="fp-tag ok">✓ WebGL</span>
      <span class="fp-tag ok">✓ Canvas</span>
      <span class="fp-tag ok">✓ Client Hints</span>
      <span class="fp-tag">${device?.os_version || 'Android'}</span>
      <span class="fp-tag">${device?.opera_version ? `Opera ${device.opera_version.split('.')[0]}` : `Chrome ${device?.chrome_version?.split('.')[0] || '?'}`}</span>
      ${cookieTag}
    </div>
    <div class="card-proxy">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      ${proxy}
      ${profile.proxy?.host ? `<span class="proxy-status-badge" data-proxy-badge="${profile.id}" style="margin-left:6px;font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(99,102,241,0.15);color:#a5b4fc;cursor:pointer;" title="Bấm để kiểm tra proxy">🔌 Test</span>` : ''}
    </div>
    <div class="card-actions">
      <button class="btn-launch ${running ? 'stop' : ''}" data-id="${profile.id}">
        ${running
          ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg> Stop'
          : '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Launch'
        }
      </button>
      <button class="btn-icon" data-action="sync-cookie" data-id="${profile.id}" title="Đồng bộ Cookie & Lịch sử (Ctrl+H) của profile này lên Cloud" style="color:#fbbf24">🍪</button>
      <button class="btn-icon" data-action="clear-cache" data-id="${profile.id}" title="Làm sạch Cookie & Cache (Xóa dữ liệu duyệt web)">🧹</button>
      <button class="btn-icon" data-action="edit" data-id="${profile.id}" title="Chỉnh sửa Profile">✏️</button>
      <button class="btn-icon btn-danger" data-action="delete" data-id="${profile.id}" title="Xóa hoàn toàn Profile & Thư mục ổ đĩa">🗑️</button>
    </div>
  `;

  card.querySelector('.btn-launch').addEventListener('click', () => toggleBrowser(profile.id, running));
  card.querySelector('[data-action="sync-cookie"]').addEventListener('click', () => syncProfileCookie(profile.id));
  card.querySelector('[data-action="clear-cache"]').addEventListener('click', () => clearProfileCache(profile.id));
  card.querySelector('[data-action="edit"]').addEventListener('click', () => openEditProfileModal(profile.id));
  card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteProfileData(profile.id));
  if (profile.proxy?.host) {
    card.querySelector(`[data-proxy-badge="${profile.id}"]`)?.addEventListener('click', (e) => {
      e.stopPropagation();
      testProxyOnly(profile);
    });
  }
  return card;
}

// ── Profile Row (List) ──
function createProfileListRow(profile, device, running) {
  const row = document.createElement('div');
  row.className = 'profile-list-row';
  row.style.setProperty('--row-accent', device?.color || '#6366f1');

  const cookieCount = (profile.webData && Array.isArray(profile.webData.cookies)) ? profile.webData.cookies.length : (profile.webData?.count || 0);
  const hasHistory = !!(profile.webData && profile.webData.historyGz);
  const cookieBadge = (cookieCount > 0 || hasHistory)
    ? `<span title="${cookieCount} cookies ${hasHistory ? '+ Lịch sử Ctrl+H ' : ''}đã lưu trên Cloud" style="display:inline-flex;align-items:center;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;border:1px solid rgba(245,158,11,0.4);background:rgba(245,158,11,0.12);color:#fbbf24;margin-left:6px">🍪 ${cookieCount}${hasHistory ? ' · 📜 History' : ''}</span>`
    : '';

  row.innerHTML = `
    <div class="row-icon">${device?.icon || '📱'}</div>
    <div class="row-name" title="${profile.name}">${profile.name} ${cookieBadge}</div>
    <div class="row-device">${device?.name || '—'}</div>
    <div class="row-ua mono">${device?.model || '—'} · ${device?.opera_version ? `Opera ${device.opera_version.split('.')[0]}` : `Chrome ${device?.chrome_version?.split('.')[0] || '?'}`}</div>
    <div class="row-status">
      <div class="card-status-badge ${running ? 'running' : 'stopped'}" style="font-size:9px;padding:2px 6px">${running ? 'Running' : 'Stopped'}</div>
    </div>
    <div class="row-actions">
      <button class="btn-launch ${running ? 'stop' : ''}" data-id="${profile.id}" style="padding:6px 12px;font-size:11px">
        ${running ? '■ Stop' : '▶ Launch'}
      </button>
      ${profile.proxy?.host ? `<button class="btn-icon" data-proxy-badge="${profile.id}" data-action="test-proxy" data-id="${profile.id}" title="Kiểm tra Proxy" style="width:28px;height:28px;border-radius:7px;font-size:13px;">🔌</button>` : ''}
      <button class="btn-icon" data-action="sync-cookie" data-id="${profile.id}" title="Đồng bộ Cookie & Lịch sử (Ctrl+H) của profile này lên Cloud" style="width:28px;height:28px;border-radius:7px;color:#fbbf24">🍪</button>
      <button class="btn-icon" data-action="clear-cache" data-id="${profile.id}" title="Làm sạch Cookie & Cache" style="width:28px;height:28px;border-radius:7px">🧹</button>
      <button class="btn-icon" data-action="edit" data-id="${profile.id}" title="Edit" style="width:28px;height:28px;border-radius:7px">✏️</button>
      <button class="btn-icon btn-danger" data-action="delete" data-id="${profile.id}" title="Xóa hoàn toàn Profile & Ổ đĩa" style="width:28px;height:28px;border-radius:7px">🗑️</button>
    </div>
  `;

  row.querySelector('.btn-launch').addEventListener('click', () => toggleBrowser(profile.id, running));
  row.querySelector('[data-action="sync-cookie"]').addEventListener('click', () => syncProfileCookie(profile.id));
  row.querySelector('[data-action="clear-cache"]').addEventListener('click', () => clearProfileCache(profile.id));
  row.querySelector('[data-action="edit"]').addEventListener('click', () => openEditProfileModal(profile.id));
  row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteProfileData(profile.id));
  if (profile.proxy?.host) {
    row.querySelector('[data-action="test-proxy"]')?.addEventListener('click', () => testProxyOnly(profile));
  }
  return row;
}

// ── Helper cập nhật badge trạng thái proxy ──
function setProxyBadgeState(profileId, status, text, title = '') {
  const elements = document.querySelectorAll(`[data-proxy-badge="${profileId}"]`);
  elements.forEach(el => {
    el.textContent = text;
    if (title) el.title = title;
    if (status === 'loading') {
      el.style.background = 'rgba(234,179,8,0.18)';
      el.style.color = '#eab308';
    } else if (status === 'ok') {
      el.style.background = 'rgba(6,214,160,0.18)';
      el.style.color = '#06d6a0';
    } else if (status === 'error') {
      el.style.background = 'rgba(239,68,68,0.18)';
      el.style.color = '#ef4444';
    } else {
      el.style.background = 'rgba(99,102,241,0.15)';
      el.style.color = '#a5b4fc';
    }
  });
}

// ── Toggle Browser (với Proxy Check trước khi Launch) ──
async function toggleBrowser(profileId, running) {
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return;

  if (running) {
    const res = await API.closeBrowser(profileId);
    if (res.ok) toast('🛑 Browser stopped', 'info');
    else toast('⚠️ Could not stop browser', 'error');
    await refreshStatus();
    return;
  }

  // ── Kiểm tra proxy trước khi mở ──
  if (profile.proxy?.host && profile.proxy?.port) {
    const proxyHost = profile.proxy.host.split(':')[0] || profile.proxy.host;
    const proxyPort = profile.proxy.port || 8080;

    setProxyBadgeState(profileId, 'loading', '⏳', 'Đang kiểm tra proxy...');
    toast(`🔌 Đang kiểm tra proxy ${proxyHost}:${proxyPort}...`, 'info');

    try {
      const checkRes = await API.proxyCheck({ host: proxyHost, port: proxyPort, type: profile.proxy.type || 'http' });

      if (checkRes.ok) {
        // Proxy OK → cập nhật badge xanh + launch luôn
        setProxyBadgeState(profileId, 'ok', `✅ ${checkRes.latencyMs}ms`, `Proxy OK — ${checkRes.latencyMs}ms`);
        toast(`✅ Proxy OK (${checkRes.latencyMs}ms) — Đang mở ${profile.name}...`, 'success');
      } else {
        // Proxy FAIL → cập nhật badge đỏ + hỏi có muốn tiếp tục không
        setProxyBadgeState(profileId, 'error', '❌ Lỗi', `Proxy lỗi: ${checkRes.error}`);
        toast(`⚠️ Proxy không kết nối được: ${checkRes.error}`, 'error');

        const confirmed = await showConfirmModal({
          icon: '⚠️',
          title: 'Proxy không hoạt động!',
          message: `${proxyHost}:${proxyPort} — ${checkRes.error}`,
          sub: 'Vẫn muốn mở profile không? (Trình duyệt sẽ dùng IP thật của máy)',
          confirmText: 'Vẫn mở',
          danger: true
        });
        if (!confirmed) return; // Người dùng huỷ
      }
    } catch(e) {
      console.warn('[ProxyCheck UI error]', e.message);
      // Lỗi check → vẫn cho launch bình thường
    }
  }

  // ── Launch browser ──
  const baseDevice = devices.find(d => d.id === profile.deviceId);
  const device = {
    ...baseDevice,
    timezone: profile.timezone || baseDevice?.timezone || 'Asia/Ho_Chi_Minh'
  };
  const profileIndex = profiles.findIndex(p => p.id === profile.id);
  const profileNum = profileIndex >= 0 ? profileIndex + 1 : 1;
  toast(`🚀 Launching ${profile.name} (#${profileNum})...`, 'info');
  const res = await API.launchBrowser({ ...profile, device, profileNum });
  if (res.ok) toast(`✅ ${profile.name} launched (PID: ${res.pid})`, 'success');
  else toast('❌ Launch failed — Is Chrome/Chromium installed?', 'error');

  await refreshStatus();
}

// ── Test proxy thủ công (bấm nút 🔌 riêng) ──
async function testProxyOnly(profile) {
  if (!profile.proxy?.host) return;
  const proxyHost = profile.proxy.host.split(':')[0] || profile.proxy.host;
  const proxyPort = profile.proxy.port || 8080;

  setProxyBadgeState(profile.id, 'loading', '⏳', 'Đang kiểm tra...');
  toast(`🔌 Đang kiểm tra proxy ${proxyHost}:${proxyPort}...`, 'info');

  try {
    const res = await API.proxyCheck({ host: proxyHost, port: proxyPort, type: profile.proxy.type || 'http' });
    if (res.ok) {
      setProxyBadgeState(profile.id, 'ok', `✅ ${res.latencyMs}ms`, `Proxy OK — Latency: ${res.latencyMs}ms`);
      toast(`✅ Proxy ${proxyHost}:${proxyPort} — OK! Latency: ${res.latencyMs}ms`, 'success');
    } else {
      setProxyBadgeState(profile.id, 'error', '❌', `Proxy lỗi: ${res.error}`);
      toast(`❌ Proxy ${proxyHost}:${proxyPort} — ${res.error}`, 'error');
    }
  } catch(e) {
    setProxyBadgeState(profile.id, 'error', '❌', `Lỗi: ${e.message}`);
    toast(`⚠️ Lỗi kiểm tra proxy: ${e.message}`, 'error');
  }
}

// ── Custom Confirm Modal ──
function showConfirmModal({ icon = '❓', title, message, sub = '', confirmText = 'Xác nhận', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmOverlay');
    if (!overlay) {
      // Fallback nếu không có DOM — resolve true để không chặn xóa
      resolve(true);
      return;
    }

    // Nội dung
    const iconEl   = document.getElementById('confirmIcon');
    const titleEl  = document.getElementById('confirmTitle');
    const msgEl    = document.getElementById('confirmMsg');
    const subEl    = document.getElementById('confirmSub');

    if (iconEl)  iconEl.textContent  = icon;
    if (titleEl) titleEl.textContent = title;
    if (msgEl)   msgEl.textContent   = message;
    if (subEl)   subEl.textContent   = sub;

    // Lấy buttons hiện tại trong DOM (sau mỗi lần cloneNode, id vẫn tồn tại)
    const okBtn     = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');

    // Clone để xoá hết listener cũ
    const newOkBtn     = okBtn     ? okBtn.cloneNode(true)     : null;
    const newCancelBtn = cancelBtn ? cancelBtn.cloneNode(true) : null;

    if (okBtn && newOkBtn) {
      newOkBtn.textContent = confirmText;
      newOkBtn.className   = danger ? 'btn-primary confirm-ok-danger' : 'btn-primary';
      okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    }
    if (cancelBtn && newCancelBtn) {
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    }

    let resolved = false;
    const cleanup = (result) => {
      if (resolved) return;
      resolved = true;
      overlay.classList.remove('open');
      // Dùng timeout nhỏ cho animation fade-out rồi ẩn hẳn
      setTimeout(() => { overlay.style.display = 'none'; }, 220);
      newOkBtn?.removeEventListener('click', onOk);
      newCancelBtn?.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      resolve(result);
    };

    const onOk           = (e) => { e?.stopPropagation(); cleanup(true);  };
    const onCancel       = (e) => { e?.stopPropagation(); cleanup(false); };
    const onOverlayClick = (e) => { if (e.target === overlay) cleanup(false); };

    newOkBtn?.addEventListener('click', onOk);
    newCancelBtn?.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);

    // Hiển thị modal
    overlay.style.display = 'flex';
    // Dùng double-rAF để đảm bảo display:flex render trước khi add class .open (trigger transition)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.add('open');
      });
    });
  });
}

// 🍪 0. Đồng bộ Cookie của 1 Profile cụ thể lên Cloud
async function syncProfileCookie(profileId) {
  const p = profiles.find(x => x.id === profileId);
  const name = p ? p.name : 'Profile';
  toast(`⏳ Đang trích xuất & đẩy Cookie của "${name}" lên Cloud...`, 'info');
  try {
    if (API.syncProfileCookies) {
      const res = await API.syncProfileCookies(profileId);
      if (res && res.ok) {
        if (p) {
          if (!p.webData) p.webData = {};
          if (res.cookies) p.webData.cookies = res.cookies;
          p.webData.count = res.count || (res.cookies ? res.cookies.length : 0);
        }
        renderProfiles();
        toast(`✅ ${res.message || `Đã đồng bộ ${res.count} cookies của "${name}" lên Cloud!`}`, 'success');
      } else {
        toast(`❌ Lỗi đồng bộ: ${res?.error || 'Thất bại'}`, 'error');
      }
    } else {
      toast('⚠️ API đồng bộ chưa sẵn sàng, vui lòng khởi động lại ứng dụng!', 'error');
    }
  } catch (err) {
    toast(`❌ Lỗi: ${err.message}`, 'error');
  }
}

// 🍪 Đồng bộ Cookie của TẤT CẢ Profile lên Cloud
async function handleSyncAllCookies() {
  const btn = document.getElementById('btnSyncAllCookies');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Đang đồng bộ...';
  }
  toast('⏳ Đang quét & trích xuất Cookie của toàn bộ profile...', 'info');
  try {
    if (API.syncAllCookies) {
      const res = await API.syncAllCookies();
      if (res && res.ok) {
        toast(`✅ ${res.message || `Đã đồng bộ ${res.totalCookies} cookies lên Cloud!`}`, 'success');
        if (API.loadProfiles) {
          const fresh = await API.loadProfiles();
          if (Array.isArray(fresh)) {
            profiles = fresh;
            renderProfiles();
          }
        }
      } else {
        toast(`❌ Lỗi: ${res?.error || 'Thất bại'}`, 'error');
      }
    } else {
      toast('⚠️ API đồng bộ chưa sẵn sàng, vui lòng khởi động lại ứng dụng!', 'error');
    }
  } catch(err) {
    toast(`❌ Lỗi: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span style="font-size:14px;line-height:1;">🍪</span> Đồng bộ Cookie';
    }
  }
}

// 🧹 1. Clear Browsing Cache / Cookies Only
async function clearProfileCache(profileId) {
  try {
    const profile = profiles.find(p => p.id === profileId);
    const name = profile ? profile.name : 'Profile';

    const { confirmed } = await API.showConfirm({
      title: 'Làm sạch bộ nhớ duyệt web?',
      message: `Xóa Cache, Cookie & Lịch sử của "${name}"?`,
      detail: 'Cấu hình Profile và Proxy vẫn được giữ nguyên.',
      danger: false
    });
    if (!confirmed) return;

    const res = await API.clearProfileCache(profileId);
    if (res && res.ok) {
      toast(`🧹 Đã làm sạch Cookie & Cache của ${name}!`, 'success');
    } else {
      toast(`❌ Lỗi khi dọn dẹp cache: ${res?.error || ''}`, 'error');
    }
  } catch(err) {
    console.error('[Clear Cache Error]', err);
    toast(`⚠️ Lỗi: ${err.message}`, 'error');
  }
}

// 🗑️ 2. Soft-Delete Profile → Thùng Rác
async function deleteProfileData(profileId) {
  try {
    const profile = profiles.find(p => p.id === profileId);
    const name = profile ? profile.name : 'Profile';

    const { confirmed } = await API.showConfirm({
      title: 'Đưa vào Thùng Rác?',
      message: `Bạn muốn xóa "${name}" khỏi danh sách?`,
      detail: '🗑️ Profile sẽ vào Thùng Rác. Có thể khôi phục hoặc xóa vĩnh viễn trên Cloud từ Thùng Rác bất kỳ lúc nào.',
      danger: false
    });
    if (!confirmed) return;

    // 1. Xóa khỏi danh sách & cập nhật UI ngay
    profiles = profiles.filter(p => p.id !== profileId);
    renderProfiles();

    // 2. Gọi backend: kill process + xóa thư mục ổ đĩa + ghi trash.json (KHÔNG xóa Cloud)
    const res = await API.deleteProfile(profileId);
    if (res && res.ok) {
      toast(`🗑️ "Đã đưa "${name}" vào Thùng Rác!`, 'info');
    } else {
      toast(`🗑️ Đã xóa profile "${name}" khỏi danh sách!`, 'info');
    }
    // Cập nhật badge Thùng Rác
    await refreshTrashBadge();
  } catch(err) {
    console.error('[Delete Profile Error]', err);
    toast(`⚠️ Lỗi khi xóa profile: ${err.message}`, 'error');
  }
}

// ── Modal ──
function setupModal() {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalSave').addEventListener('click', saveProfile);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  });
  document.getElementById('fProxyType').addEventListener('change', (e) => {
    document.getElementById('proxyAuthRow').style.display = e.target.value ? 'flex' : 'none';
  });

  // Tự động phân tích khi DÁN hoặc GÕ Proxy chuỗi dài (VD: 113.187.249.230:20028:UU7651:7KsHB)
  const proxyHostInput = document.getElementById('fProxyHost');
  proxyHostInput.addEventListener('paste', (e) => {
    const pasted = (e.clipboardData || window.clipboardData)?.getData('text');
    if (pasted) setTimeout(() => handleProxyInput(pasted), 10);
  });
  proxyHostInput.addEventListener('input', (e) => {
    handleProxyInput(e.target.value);
  });

  buildDevicePicker();
}

// ── Smart Proxy Parser (AdsPower style — Tự động phân tách IP:Port + User + Pass + Protocol) ──
function handleProxyInput(rawStr) {
  if (!rawStr) return;
  const currentType = document.getElementById('fProxyType')?.value || 'http';
  const parsed = parseProxyString(rawStr, currentType);
  if (parsed && parsed.host) {
    document.getElementById('fProxyHost').value = `${parsed.host}:${parsed.port}`;
    if (parsed.type) {
      document.getElementById('fProxyType').value = parsed.type;
    } else if (!document.getElementById('fProxyType').value) {
      document.getElementById('fProxyType').value = 'http';
    }
    
    // Luôn hiển thị dòng User/Pass khi đã chọn loại Proxy
    document.getElementById('proxyAuthRow').style.display = 'flex';

    if (parsed.user || parsed.pass) {
      document.getElementById('fProxyUser').value = parsed.user || '';
      document.getElementById('fProxyPass').value = parsed.pass || '';
      toast(`⚡ Đã tự phân tích AdsPower Style: ${parsed.host}:${parsed.port} (User: ${parsed.user})`, 'success');
    }
  }
}

function buildDevicePicker() {
  const picker = document.getElementById('devicePicker');
  picker.innerHTML = '';
  devices.forEach(d => {
    const item = document.createElement('div');
    item.className = `device-pick-item${selectedDeviceId === d.id ? ' selected' : ''}`;
    item.dataset.id = d.id;
    item.innerHTML = `
      <span class="dpi-icon">${d.icon}</span>
      <div class="dpi-info">
        <div class="dpi-name">${d.name}</div>
        <div class="dpi-model">${d.model}</div>
      </div>
    `;
    item.addEventListener('click', () => {
      selectedDeviceId = d.id;
      picker.querySelectorAll('.device-pick-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
    });
    picker.appendChild(item);
  });
}

const VN_CITIES = {
  hcm:       { name: "TP. Hồ Chí Minh",          lat: 10.8231, lng: 106.6297 },
  hanoi:     { name: "Hà Nội",                  lat: 21.0285, lng: 105.8542 },
  danang:    { name: "Đà Nẵng",                 lat: 16.0544, lng: 108.2022 },
  haiphong:  { name: "Hải Phòng",               lat: 20.8449, lng: 106.6881 },
  cantho:    { name: "Cần Thơ",                 lat: 10.0452, lng: 105.7469 },
  binhduong: { name: "Bình Dương",              lat: 11.1604, lng: 106.6575 },
  dongnai:   { name: "Đồng Nai",                lat: 10.9460, lng: 106.8238 },
  nhatrang:  { name: "Nha Trang (Khánh Hòa)",   lat: 12.2388, lng: 109.1967 },
  hue:       { name: "Thừa Thiên Huế",          lat: 16.4637, lng: 107.5905 },
  quangninh: { name: "Quảng Ninh (Hạ Long)",    lat: 21.0069, lng: 107.2925 },
  vungtau:   { name: "Bà Rịa - Vũng Tàu",       lat: 10.3460, lng: 107.0843 },
  dalat:     { name: "Đà Lạt (Lâm Đồng)",       lat: 11.9404, lng: 108.4583 },
  thanhhoa:  { name: "Thanh Hóa",               lat: 19.8067, lng: 105.7851 },
  nghean:    { name: "Nghệ An (Vinh)",          lat: 18.6734, lng: 105.6923 },
  angiang:   { name: "An Giang",                lat: 10.5216, lng: 105.1259 },
};

function openNewProfileModal() {
  editingId = null;
  selectedDeviceId = devices[Math.floor(Math.random() * devices.length)]?.id || devices[0]?.id || null;
  document.getElementById('modalTitle').textContent = 'New Profile';
  const nextNum = profiles.length + 1;
  document.getElementById('fName').value = '';
  document.getElementById('fName').placeholder = `Profile ${nextNum}`;
  document.getElementById('fProxyType').value = '';
  document.getElementById('fProxyHost').value = '';
  document.getElementById('fProxyUser').value = '';
  document.getElementById('fProxyPass').value = '';
  document.getElementById('fCity').value = 'random';
  document.getElementById('fStartUrl').value = '';
  document.getElementById('fNotes').value = '';
  document.getElementById('proxyAuthRow').style.display = 'none';

  // Reset Custom Window Size
  const winPresetEl = document.getElementById('fWinPreset');
  if (winPresetEl) winPresetEl.value = 'default';
  const customRow = document.getElementById('fWinCustomRow');
  if (customRow) customRow.style.display = 'none';
  document.getElementById('fWinWidth').value = '380';
  document.getElementById('fWinHeight').value = '675';

  buildDevicePicker();
  buildProfileExtPicker(null); // Pre-select ALL extensions by default
  // Pre-select random device
  document.querySelectorAll('.device-pick-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === selectedDeviceId);
  });
  document.getElementById('modalOverlay').classList.add('open');
}

function openEditProfileModal(profileId) {
  const p = profiles.find(x => x.id === profileId);
  if (!p) return;
  editingId = profileId;
  selectedDeviceId = p.deviceId;
  document.getElementById('modalTitle').textContent = 'Edit Profile';
  document.getElementById('fName').value = p.name;
  document.getElementById('fProxyType').value = p.proxy?.type || '';
  document.getElementById('fProxyHost').value = p.proxy?.host ? `${p.proxy.host}:${p.proxy.port}` : '';
  document.getElementById('fProxyUser').value = p.proxy?.user || '';
  document.getElementById('fProxyPass').value = p.proxy?.pass || '';
  document.getElementById('fCity').value = p.cityKey || 'random';
  document.getElementById('fStartUrl').value = p.startUrl || '';
  document.getElementById('fNotes').value = p.notes || '';
  document.getElementById('proxyAuthRow').style.display = p.proxy?.type ? 'flex' : 'none';

  // Load Custom Window Size for Profile
  if (p.customWindow && p.customWindow.preset) {
    const winPresetEl = document.getElementById('fWinPreset');
    if (winPresetEl) winPresetEl.value = p.customWindow.preset;
    document.getElementById('fWinWidth').value = p.customWindow.width || 380;
    document.getElementById('fWinHeight').value = p.customWindow.height || 675;
    const customRow = document.getElementById('fWinCustomRow');
    if (customRow) customRow.style.display = (p.customWindow.preset === 'custom') ? 'flex' : 'none';
  } else {
    const winPresetEl = document.getElementById('fWinPreset');
    if (winPresetEl) winPresetEl.value = 'default';
    const customRow = document.getElementById('fWinCustomRow');
    if (customRow) customRow.style.display = 'none';
    document.getElementById('fWinWidth').value = '380';
    document.getElementById('fWinHeight').value = '675';
  }

  buildDevicePicker();
  buildProfileExtPicker(p.selectedExtensions || []);
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.style.display = 'none';
    setTimeout(() => { overlay.style.display = ''; }, 200);
  }
  editingId = null;
}

async function saveProfile() {
  try {
    let name = document.getElementById('fName').value.trim();
    if (!name) {
      name = `Profile ${profiles.length + 1}`;
    }
    if (!selectedDeviceId) { toast('⚠️ Chọn thiết bị!', 'error'); return; }

    let proxyType = document.getElementById('fProxyType').value;
    const rawProxyHost = document.getElementById('fProxyHost').value.trim();
    let proxy = null;
    if (rawProxyHost) {
      if (!proxyType) proxyType = 'http';
      const parsed = parseProxyString(rawProxyHost, proxyType);
      const inputUser = document.getElementById('fProxyUser').value.trim();
      const inputPass = document.getElementById('fProxyPass').value.trim();
      if (parsed) {
        proxy = {
          type: parsed.type || proxyType,
          host: parsed.host,
          port: parsed.port,
          user: inputUser || parsed.user || '',
          pass: inputPass || parsed.pass || ''
        };
      }
    }

    let cityKey = document.getElementById('fCity').value;
    const cityKeys = Object.keys(VN_CITIES);
    if (cityKey === 'random') {
      cityKey = cityKeys[Math.floor(Math.random() * cityKeys.length)];
    }
    const cityInfo = VN_CITIES[cityKey] || VN_CITIES.hcm;

    // Collect checked extension IDs
    const selectedExtensions = [];
    document.querySelectorAll('.ext-select-item:checked').forEach(cb => {
      selectedExtensions.push(cb.dataset.id);
    });

    // Custom Window Size
    const winPreset = document.getElementById('fWinPreset')?.value || 'default';
    let customWindow = null;
    if (winPreset !== 'default') {
      let w = 380, h = 675;
      if (winPreset === 'custom') {
        w = parseInt(document.getElementById('fWinWidth').value) || 380;
        h = parseInt(document.getElementById('fWinHeight').value) || 675;
      } else {
        const [pw, ph] = winPreset.split('x').map(Number);
        if (pw && ph) { w = pw; h = ph; }
      }
      customWindow = { preset: winPreset, width: w, height: h };
    }

    const profileData = {
      id: editingId || crypto.randomUUID(),
      name,
      deviceId: selectedDeviceId,
      proxy,
      cityKey,
      cityName: cityInfo.name,
      geo: { lat: cityInfo.lat, lng: cityInfo.lng },
      timezone: 'Asia/Ho_Chi_Minh',
      language: 'vi-VN',
      selectedExtensions,
      customWindow,
      startUrl: document.getElementById('fStartUrl').value.trim(),
      notes: document.getElementById('fNotes').value.trim(),
      webData: editingId ? (profiles.find(p => p.id === editingId)?.webData || null) : null,
      createdAt: editingId ? (profiles.find(p => p.id === editingId)?.createdAt || Date.now()) : Date.now(),
    };

    if (editingId) {
      profiles = profiles.map(p => p.id === editingId ? profileData : p);
      toast('✅ Profile updated!', 'success');
    } else {
      profiles.push(profileData);
      toast('✅ Profile created!', 'success');
    }

    // Tắt Popup NGAY LẬP TỨC!
    closeModal();
    renderProfiles();

    // Lưu async vào file
    await saveProfiles();
  } catch (err) {
    console.error('[Save Profile Error]', err);
    closeModal();
  }
}

// ── Batch Create Profiles ──
function setupBatchModal() {
  const btnBatch = document.getElementById('btnBatchCreate');
  if (btnBatch) btnBatch.addEventListener('click', openBatchModal);

  document.getElementById('batchModalClose')?.addEventListener('click', closeBatchModal);
  document.getElementById('batchModalCancel')?.addEventListener('click', closeBatchModal);
  document.getElementById('batchModalSave')?.addEventListener('click', saveBatchProfiles);

  document.getElementById('batchModalOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('batchModalOverlay')) closeBatchModal();
  });
}

function openBatchModal() {
  document.getElementById('bProxyList').value = '';
  document.getElementById('bNamePrefix').value = '';
  const nextNum = profiles.length + 1;
  document.getElementById('bNamePrefix').placeholder = `Profile (Mặc định: Profile ${nextNum})`;

  // Build device selector in batch modal
  const devSelect = document.getElementById('bDeviceMode');
  devSelect.innerHTML = `<option value="random">🎲 Random Thiết bị (Tự xoay vòng qua ${devices.length} mẫu Android/Opera)</option>`;
  devices.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.icon} ${d.name} (${d.model})`;
    devSelect.appendChild(opt);
  });

  // Build extension picker in batch modal (Checked ALL by default)
  const extContainer = document.getElementById('bExtSelectList');
  if (!extensions.length) {
    extContainer.innerHTML = '<div class="small muted">Chưa có extension nào trong thư viện. Thêm ở mục Extensions bên menu.</div>';
  } else {
    extContainer.innerHTML = '';
    extensions.forEach(ext => {
      const row = document.createElement('label');
      row.className = 'ext-item-row';
      row.innerHTML = `
        <input type="checkbox" class="bext-select-item" data-id="${ext.id}" checked/>
        <span>🧩 ${ext.name}</span>
      `;
      extContainer.appendChild(row);
    });
  }

  const overlay = document.getElementById('batchModalOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  }
}

// ── Arrange Windows Layout Modal (Tùy chỉnh cài đặt bố cục) ──
let currentArrangeMode = 'grid';

function setupArrangeModal() {
  const btnArrange = document.getElementById('btnArrangeWindows');
  if (btnArrange) btnArrange.addEventListener('click', openArrangeModal);

  document.getElementById('arrangeModalClose')?.addEventListener('click', closeArrangeModal);
  document.getElementById('arrBtnCancel')?.addEventListener('click', closeArrangeModal);
  document.getElementById('arrangeModalOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('arrangeModalOverlay')) closeArrangeModal();
  });

  // Mode toggles (Bố cục lưới vs Chồng chéo)
  const btnGrid = document.getElementById('arrBtnModeGrid');
  const btnCascade = document.getElementById('arrBtnModeCascade');
  btnGrid?.addEventListener('click', () => {
    currentArrangeMode = 'grid';
    btnGrid.classList.add('active');
    btnCascade.classList.remove('active');
    updateArrangeFormState();
  });
  btnCascade?.addEventListener('click', () => {
    currentArrangeMode = 'cascade';
    btnCascade.classList.add('active');
    btnGrid.classList.remove('active');
    updateArrangeFormState();
  });

  // Auto Adapt toggle
  document.getElementById('arrAutoAdapt')?.addEventListener('change', updateArrangeFormState);

  // Reset button
  document.getElementById('arrBtnReset')?.addEventListener('click', () => {
    currentArrangeMode = 'grid';
    btnGrid?.classList.add('active');
    btnCascade?.classList.remove('active');
    const autoEl = document.getElementById('arrAutoAdapt'); if (autoEl) autoEl.checked = true;
    const sx = document.getElementById('arrStartX'); if (sx) sx.value = '10';
    const sy = document.getElementById('arrStartY'); if (sy) sy.value = '10';
    const ww = document.getElementById('arrWinWidth'); if (ww) ww.value = '380';
    const wh = document.getElementById('arrWinHeight'); if (wh) wh.value = '675';
    const gx = document.getElementById('arrGapX'); if (gx) gx.value = '10';
    const gy = document.getElementById('arrGapY'); if (gy) gy.value = '10';
    const cols = document.getElementById('arrColsPerRow'); if (cols) cols.value = '3';
    updateArrangeFormState();
    toast('🔄 Đã cài lại thông số bố cục mặc định!', 'info');
  });

  // Apply button
  document.getElementById('arrBtnApply')?.addEventListener('click', applyArrangeLayout);
}

function updateArrangeFormState() {
  const isAuto = document.getElementById('arrAutoAdapt')?.checked;
  const colsInput = document.getElementById('arrColsPerRow');
  if (colsInput && colsInput.parentElement) {
    const disabled = (currentArrangeMode === 'cascade' || isAuto);
    colsInput.disabled = disabled;
    colsInput.parentElement.style.opacity = disabled ? '0.4' : '1';
  }
}

async function openArrangeModal() {
  // Load available displays
  if (API.getDisplays) {
    const displays = await API.getDisplays();
    const sel = document.getElementById('arrScreen');
    if (sel) {
      sel.innerHTML = '';
      displays.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        sel.appendChild(opt);
      });
    }
  }

  // Load saved settings if any
  if (API.loadSettings) {
    const s = await API.loadSettings();
    if (s.mode) {
      currentArrangeMode = s.mode;
      document.getElementById('arrBtnModeGrid')?.classList.toggle('active', s.mode === 'grid');
      document.getElementById('arrBtnModeCascade')?.classList.toggle('active', s.mode === 'cascade');
    }
    if (s.autoAdapt !== undefined) {
      const el = document.getElementById('arrAutoAdapt');
      if (el) el.checked = !!s.autoAdapt;
    }
    if (s.startX !== undefined) document.getElementById('arrStartX').value = s.startX;
    if (s.startY !== undefined) document.getElementById('arrStartY').value = s.startY;
    if (s.winW || s.windowWidth) document.getElementById('arrWinWidth').value = s.winW || s.windowWidth;
    if (s.winH || s.windowHeight) document.getElementById('arrWinHeight').value = s.winH || s.windowHeight;
    if (s.gapX !== undefined) document.getElementById('arrGapX').value = s.gapX;
    if (s.gapY !== undefined) document.getElementById('arrGapY').value = s.gapY;
    if (s.colsPerRow !== undefined) document.getElementById('arrColsPerRow').value = s.colsPerRow;
  }

  updateArrangeFormState();
  const overlay = document.getElementById('arrangeModalOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  }
}

function closeArrangeModal() {
  const overlay = document.getElementById('arrangeModalOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.style.display = 'none';
    setTimeout(() => { overlay.style.display = ''; }, 200);
  }
}

async function applyArrangeLayout() {
  const displayIndex = parseInt(document.getElementById('arrScreen')?.value) || 0;
  const mode = currentArrangeMode;
  const autoAdapt = document.getElementById('arrAutoAdapt')?.checked !== false;
  const startX = parseInt(document.getElementById('arrStartX')?.value) || 10;
  const startY = parseInt(document.getElementById('arrStartY')?.value) || 10;
  const winW = parseInt(document.getElementById('arrWinWidth')?.value) || 380;
  const winH = parseInt(document.getElementById('arrWinHeight')?.value) || 675;
  const gapX = parseInt(document.getElementById('arrGapX')?.value) || 10;
  const gapY = parseInt(document.getElementById('arrGapY')?.value) || 10;
  const colsPerRow = parseInt(document.getElementById('arrColsPerRow')?.value) || 3;

  const opts = { displayIndex, mode, autoAdapt, startX, startY, winW, winH, gapX, gapY, colsPerRow };

  closeArrangeModal();

  const res = await API.arrangeWindows(opts);
  if (res && res.ok) {
    const label = mode === 'cascade' ? 'Chồng chéo' : 'Lưới';
    toast(`📐 Đã áp dụng bố cục ${label} cho ${res.count} cửa sổ trình duyệt!`, 'success');
  } else {
    toast(`⚠️ ${res?.error || 'Không có trình duyệt nào đang chạy!'}`, 'info');
  }
}

function closeBatchModal() {
  const overlay = document.getElementById('batchModalOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.style.display = 'none';
    setTimeout(() => { overlay.style.display = ''; }, 200);
  }
}

function parseProxyString(str, defaultType = 'http') {
  if (!str) return null;
  let cleanStr = str.trim();
  if (!cleanStr) return null;

  let type = defaultType;
  if (cleanStr.toLowerCase().startsWith('socks5://')) {
    type = 'socks5';
    cleanStr = cleanStr.substring(9);
  } else if (cleanStr.toLowerCase().startsWith('socks4://')) {
    type = 'socks4';
    cleanStr = cleanStr.substring(9);
  } else if (cleanStr.toLowerCase().startsWith('http://') || cleanStr.toLowerCase().startsWith('https://')) {
    type = 'http';
    cleanStr = cleanStr.split('://')[1];
  }

  // Chuyển ký tự phân cách | thành : nếu có
  cleanStr = cleanStr.replace(/\|/g, ':');

  let host = '', port = 8080, user = '', pass = '';

  // user:pass@host:port
  if (cleanStr.includes('@')) {
    const [userPass, hostPort] = cleanStr.split('@');
    if (userPass && hostPort) {
      const [u, p] = userPass.split(':');
      const [h, prt] = hostPort.split(':');
      host = h?.trim() || '';
      port = parseInt(prt) || 8080;
      user = u?.trim() || '';
      pass = p?.trim() || '';
    }
  } else {
    const parts = cleanStr.split(':');
    if (parts.length === 4) {
      if (isNaN(parts[1]) && !isNaN(parts[3])) {
        // user:pass:host:port
        user = parts[0].trim();
        pass = parts[1].trim();
        host = parts[2].trim();
        port = parseInt(parts[3]) || 8080;
      } else {
        // host:port:user:pass
        host = parts[0].trim();
        port = parseInt(parts[1]) || 8080;
        user = parts[2].trim();
        pass = parts[3].trim();
      }
    } else if (parts.length === 2) {
      // host:port
      host = parts[0].trim();
      port = parseInt(parts[1]) || 8080;
    }
  }

  if (!host) return null;
  return { type, host, port, user, pass };
}

async function saveBatchProfiles() {
  try {
    const rawProxyList = document.getElementById('bProxyList').value;
    const lines = rawProxyList.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) {
      toast('⚠️ Vui lòng dán ít nhất 1 dòng Proxy vào ô danh sách!', 'error');
      return;
    }

    let prefix = document.getElementById('bNamePrefix').value.trim();
    if (!prefix) prefix = 'Profile';

    const defaultType = document.getElementById('bProxyType').value || 'http';
    const deviceMode = document.getElementById('bDeviceMode').value || 'random';
    const selectedCityKey = document.getElementById('bCity').value || 'random';
    const startUrl = document.getElementById('bStartUrl').value.trim();

    // Extensions selected
    const selectedExtensions = [];
    document.querySelectorAll('.bext-select-item:checked').forEach(cb => {
      selectedExtensions.push(cb.dataset.id);
    });

    const cityKeys = Object.keys(VN_CITIES);
    let createdCount = 0;
    let currentTotal = profiles.length;

    lines.forEach((line, idx) => {
      currentTotal++;
      const profileName = `${prefix} ${currentTotal}`;

      // Proxy
      const proxy = parseProxyString(line, defaultType);

      // Device assignment
      let devId = deviceMode;
      if (deviceMode === 'random') {
        const randDevice = devices[idx % devices.length] || devices[0];
        devId = randDevice ? randDevice.id : devices[0].id;
      }

      // City assignment
      let cKey = selectedCityKey;
      if (selectedCityKey === 'random') {
        cKey = cityKeys[Math.floor(Math.random() * cityKeys.length)];
      }
      const cityInfo = VN_CITIES[cKey] || VN_CITIES.hcm;

      const profileData = {
        id: crypto.randomUUID(),
        name: profileName,
        deviceId: devId,
        proxy: proxy,
        cityKey: cKey,
        cityName: cityInfo.name,
        geo: { lat: cityInfo.lat, lng: cityInfo.lng },
        timezone: 'Asia/Ho_Chi_Minh',
        language: 'vi-VN',
        selectedExtensions,
        startUrl: startUrl,
        notes: `Tạo hàng loạt từ Proxy: ${line}`,
        createdAt: Date.now() + idx,
      };

      profiles.push(profileData);
      createdCount++;
    });

    closeBatchModal();
    renderProfiles();
    await saveProfiles();

    toast(`⚡ Đã tạo hàng loạt ${createdCount} Profile thành công!`, 'success');
  } catch (err) {
    console.error('[Batch Create Error]', err);
    toast(`❌ Lỗi khi tạo hàng loạt: ${err.message}`, 'error');
    closeBatchModal();
  }
}

// ── Extension Picker in Profile Modal ──
function buildProfileExtPicker(selectedIds = null) {
  const container = document.getElementById('fExtSelectList');
  if (!extensions.length) {
    container.innerHTML = '<div class="small muted">Chưa có extension nào trong thư viện. Thêm ở mục Extensions bên menu.</div>';
    return;
  }

  // Mặc định tự động tích chọn TẤT CẢ Extension nếu chưa có cấu hình riêng
  const activeIds = (selectedIds === null) ? extensions.map(e => e.id) : selectedIds;

  container.innerHTML = '';
  extensions.forEach(ext => {
    const isChecked = activeIds.includes(ext.id);
    const row = document.createElement('label');
    row.className = 'ext-item-row';
    row.innerHTML = `
      <input type="checkbox" class="ext-select-item" data-id="${ext.id}" ${isChecked ? 'checked' : ''}/>
      <span>🧩 ${ext.name}</span>
    `;
    container.appendChild(row);
  });
}

// ── Extensions Management Page ──
async function loadExtensions() {
  extensions = await API.loadExtensions();
}

async function saveExtensions() {
  await API.saveExtensions(extensions);
}

function setupExtensionsPage() {
  document.getElementById('btnAddExtension').addEventListener('click', async () => {
    const res = await API.selectExtension();
    if (!res) return;
    if (res.ok) {
      extensions.push(res);
      await saveExtensions();
      renderExtensions();
      toast(`✅ Đã thêm extension: ${res.name}`, 'success');
    } else {
      toast(`❌ ${res.error}`, 'error');
    }
  });
  renderExtensions();
}

function renderExtensions() {
  const grid = document.getElementById('extensionsGrid');
  const empty = document.getElementById('extEmptyState');
  if (!grid || !empty) return;

  if (!extensions.length) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }
  grid.style.display = 'grid';
  empty.style.display = 'none';
  grid.innerHTML = '';

  extensions.forEach(ext => {
    const card = document.createElement('div');
    card.className = 'ext-card';
    card.innerHTML = `
      <div class="ext-card-header">
        <div class="ext-icon">🧩</div>
        <div>
          <div class="ext-title">${ext.name}</div>
          <div class="ext-path">${ext.path}</div>
        </div>
      </div>
      <div class="ext-actions">
        <button class="btn-icon btn-danger" data-id="${ext.id}" title="Remove Extension">🗑️</button>
      </div>
    `;
    card.querySelector('.btn-danger').addEventListener('click', async () => {
      extensions = extensions.filter(e => e.id !== ext.id);
      await saveExtensions();
      renderExtensions();
      toast('🗑️ Đã xóa extension', 'info');
    });
    grid.appendChild(card);
  });
}

// ── Device Library Page ──
function setupDeviceLibrary() {
  const lib = document.getElementById('deviceLibrary');
  lib.innerHTML = '';
  devices.forEach(d => {
    const card = document.createElement('div');
    card.className = 'device-lib-card';
    card.style.borderColor = d.color + '33';
    card.innerHTML = `
      <div class="dlc-top">
        <span class="dlc-icon">${d.icon}</span>
        <div>
          <div class="dlc-name">${d.name}</div>
          <div class="dlc-model">${d.model} · ${d.os_version}</div>
        </div>
      </div>
      <div class="dlc-info">
        <div class="dlc-row"><span class="dlc-key">${d.opera_version ? 'Opera' : 'Chrome'}</span><span class="dlc-val">${d.opera_version || d.chrome_version}</span></div>
        <div class="dlc-row"><span class="dlc-key">Viewport</span><span class="dlc-val">${d.viewport.width}×${d.viewport.height} (DPR ${d.device_scale_factor})</span></div>
        <div class="dlc-row"><span class="dlc-key">Screen</span><span class="dlc-val">${d.screen_width}×${d.screen_height}px</span></div>
        <div class="dlc-row"><span class="dlc-key">GPU</span><span class="dlc-val green">${d.webgl_vendor} ${d.webgl_renderer}</span></div>
        <div class="dlc-row"><span class="dlc-key">Touch Points</span><span class="dlc-val green">${d.max_touch_points}</span></div>
        <div class="dlc-row"><span class="dlc-key">Timezone</span><span class="dlc-val">${d.timezone}</span></div>
      </div>
      <button class="dlc-btn" data-id="${d.id}">+ Use This Device</button>
    `;
    card.querySelector('.dlc-btn').addEventListener('click', () => {
      selectedDeviceId = d.id;
      openNewProfileModal();
      // pre-select this device in picker
      setTimeout(() => {
        document.querySelectorAll('.device-pick-item').forEach(el => {
          el.classList.toggle('selected', el.dataset.id === d.id);
        });
      }, 50);
      // switch to profiles page
      document.querySelector('[data-page="profiles"]').click();
    });
    lib.appendChild(card);
  });
}

// ── Settings ──
async function setupSettings() {
  const info = await API.getAppInfo();
  const elV = document.getElementById('settingVersion'); if (elV) elV.textContent = info.version;
  const elP = document.getElementById('settingPlatform'); if (elP) elP.textContent = info.platform;
  const elE = document.getElementById('settingElectron'); if (elE) elE.textContent = info.electron;
  const elN = document.getElementById('settingNode'); if (elN) elN.textContent = info.node;
  const elD = document.getElementById('settingData'); if (elD) elD.textContent = info.userData;
  const elAppV = document.getElementById('appVersion'); if (elAppV) elAppV.textContent = `v${info.version}`;

  // Load Window Size settings
  if (API.loadSettings) {
    const s = await API.loadSettings();
    const widthInput = document.getElementById('settingWinWidth');
    const heightInput = document.getElementById('settingWinHeight');
    const presetSelect = document.getElementById('settingWinPreset');

    if (widthInput && heightInput) {
      widthInput.value = s.windowWidth || 380;
      heightInput.value = s.windowHeight || 675;
    }
    if (presetSelect && s.preset) {
      presetSelect.value = s.preset;
    }

    presetSelect?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val !== 'custom') {
        const [w, h] = val.split('x').map(Number);
        if (w && h) {
          widthInput.value = w;
          heightInput.value = h;
        }
      }
    });

    document.getElementById('btnSaveWinSettings')?.addEventListener('click', async () => {
      const w = parseInt(widthInput.value) || 380;
      const h = parseInt(heightInput.value) || 675;
      const preset = presetSelect.value;
      await API.saveSettings({ windowWidth: w, windowHeight: h, preset });
      toast(`💾 Đã lưu kích thước cửa sổ thủ công: ${w} × ${h} px!`, 'success');
    });

    // --- Supabase Cloud Settings ---
    if (API.supabaseGetConfig) {
      const sbc = await API.supabaseGetConfig();
      const urlInput = document.getElementById('settingSupabaseUrl');
      const keyInput = document.getElementById('settingSupabaseKey');
      if (urlInput && sbc.url) urlInput.value = sbc.url;
      if (keyInput && sbc.anonKey) keyInput.value = sbc.anonKey;

      const btnSaveSbc = document.getElementById('btnSaveSupabase');
      const btnTestSbc = document.getElementById('btnTestSupabase');
      const statusTxt = document.getElementById('supabaseConnStatus');
      if (statusTxt) {
        statusTxt.textContent = '🟢 Sẵn sàng (Tự động đồng bộ theo mã PIN 151206)';
        statusTxt.style.color = '#06d6a0';
      }

      if (btnSaveSbc) {
        btnSaveSbc.addEventListener('click', async () => {
          const url = urlInput ? urlInput.value.trim() : '';
          const anonKey = keyInput ? keyInput.value.trim() : '';
          const res = await API.supabaseSaveConfig({ url, anonKey });
          if (res && res.ok) {
            toast('✅ Đã lưu cấu hình Supabase!', 'success');
            await checkAuthStatus();
          } else {
            toast('❌ Lỗi lưu cấu hình: ' + (res?.error || 'Thất bại'), 'error');
          }
        });
      }

      if (btnTestSbc) {
        btnTestSbc.addEventListener('click', async () => {
          const url = urlInput ? urlInput.value.trim() : '';
          const anonKey = keyInput ? keyInput.value.trim() : '';
          if (statusTxt) statusTxt.textContent = '⏳ Đang kiểm tra kết nối...';
          const res = await API.supabaseTestConnection({ url, anonKey });
          if (res && res.ok) {
            if (statusTxt) {
              statusTxt.textContent = '🟢 Kết nối thành công!';
              statusTxt.style.color = '#06d6a0';
            }
            toast('🟢 ' + (res.message || 'Kết nối thành công!'), 'success');
          } else {
            if (statusTxt) {
              statusTxt.textContent = '🔴 Thất bại: ' + (res?.error || 'Lỗi');
              statusTxt.style.color = '#ef4444';
            }
            toast('🔴 ' + (res?.error || 'Lỗi kết nối'), 'error');
          }
        });
      }
    }
  }
}

// ── Toast ──
function toast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut .25s ease forwards';
    setTimeout(() => el.remove(), 250);
  }, 3000);
}

// ── API Docs: Live Status Check ──
async function checkApiStatus() {
  const dot  = document.getElementById('apiStatusDot');
  const text = document.getElementById('apiStatusText');
  if (!dot || !text) return;

  text.textContent = 'Đang kiểm tra...';
  dot.style.background = '#f59e0b';

  try {
    const res = await fetch('http://127.0.0.1:9399/api/status', { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    if (data.ok) {
      dot.style.background = '#06d6a0';
      dot.style.boxShadow  = '0 0 6px #06d6a0';
      text.textContent = `🟢 Online — ${data.profiles_count} profiles, ${data.running_count} running`;
    } else {
      throw new Error('not ok');
    }
  } catch(e) {
    dot.style.background = '#ef4444';
    dot.style.boxShadow  = 'none';
    text.textContent = '🔴 Offline (Mở N/A Browser để bật API)';
  }
}

// ── API Docs: Copy helpers ──
function copyCode(elementId, btn) {
  const el = document.getElementById(elementId);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Đã copy!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
    }
  });
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Đã copy!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
    }
  });
}

// ── Start ──
document.addEventListener('DOMContentLoaded', () => {
  init();
  // Auto check API status khi vào tab API
  document.querySelectorAll('.nav-item').forEach(btn => {
    if (btn.dataset.page === 'apidocs') {
      btn.addEventListener('click', () => setTimeout(checkApiStatus, 100));
    }
  });
});



// ══════════════════════════════════════════════════════════════
// SUPABASE AUTH & CLOUD SYNC LOGIC
// ══════════════════════════════════════════════════════════════

let currentUser = null;

function openAuthModal() {
  const ov = document.getElementById('authModalOverlay');
  if (ov) {
    ov.style.display = 'flex';
  }
}

function closeAuthModal() {
  const ov = document.getElementById('authModalOverlay');
  if (ov) {
    ov.style.display = 'none';
  }
}

async function checkAuthStatus() {
  if (!API.authGetSession) return;
  try {
    const res = await API.authGetSession();
    if (res && res.loggedIn && res.user) {
      currentUser = res.user;
      updateAuthUI(true);
    } else {
      currentUser = null;
      updateAuthUI(false);
    }
  } catch (err) {
    console.error('Check auth status error:', err);
  }
}

function updateAuthUI(isLoggedIn) {
  const btn = document.getElementById('btnOpenAuth');
  const txt = document.getElementById('authBtnText');
  const viewLogin = document.getElementById('viewLogin');
  const viewRegister = document.getElementById('viewRegister');
  const viewProfile = document.getElementById('viewProfile');
  const authTabs = document.getElementById('authTabs');

  if (isLoggedIn && currentUser) {
    if (btn) {
      btn.style.borderColor = 'rgba(6, 214, 160, 0.4)';
      btn.style.background = 'rgba(6, 214, 160, 0.1)';
      btn.style.color = '#06d6a0';
    }
    const shortEmail = currentUser.email.length > 20 ? currentUser.email.slice(0, 18) + '...' : currentUser.email;
    if (txt) txt.textContent = '🟢 ' + shortEmail;

    if (authTabs) authTabs.style.display = 'none';
    if (viewLogin) viewLogin.style.display = 'none';
    if (viewRegister) viewRegister.style.display = 'none';
    if (viewProfile) viewProfile.style.display = 'block';

    const emailDisp = document.getElementById('userEmailDisplay');
    const avatar = document.getElementById('userAvatar');
    if (emailDisp) emailDisp.textContent = currentUser.email;
    if (avatar) avatar.textContent = (currentUser.email[0] || 'U').toUpperCase();
  } else {
    if (btn) {
      btn.style.borderColor = 'rgba(99, 102, 241, 0.35)';
      btn.style.background = 'rgba(99, 102, 241, 0.1)';
      btn.style.color = '#c7d2fe';
    }
    if (txt) txt.textContent = 'Đăng nhập';

    if (authTabs) authTabs.style.display = 'flex';
    if (viewProfile) viewProfile.style.display = 'none';
    if (viewLogin) viewLogin.style.display = 'block';
    if (viewRegister) viewRegister.style.display = 'none';
  }
}

function switchAuthTab(tab) {
  const tabBtnLogin = document.getElementById('tabBtnLogin');
  const tabBtnRegister = document.getElementById('tabBtnRegister');
  const viewLogin = document.getElementById('viewLogin');
  const viewRegister = document.getElementById('viewRegister');
  const loginErr = document.getElementById('loginError');
  const regErr = document.getElementById('regError');

  if (loginErr) loginErr.style.display = 'none';
  if (regErr) regErr.style.display = 'none';

  if (tab === 'login') {
    if (tabBtnLogin) { tabBtnLogin.style.color = '#e8e8f8'; tabBtnLogin.style.borderBottom = '2px solid #6366f1'; }
    if (tabBtnRegister) { tabBtnRegister.style.color = '#8888aa'; tabBtnRegister.style.borderBottom = '2px solid transparent'; }
    if (viewLogin) viewLogin.style.display = 'block';
    if (viewRegister) viewRegister.style.display = 'none';
  } else {
    if (tabBtnRegister) { tabBtnRegister.style.color = '#e8e8f8'; tabBtnRegister.style.borderBottom = '2px solid #6366f1'; }
    if (tabBtnLogin) { tabBtnLogin.style.color = '#8888aa'; tabBtnLogin.style.borderBottom = '2px solid transparent'; }
    if (viewRegister) viewRegister.style.display = 'block';
    if (viewLogin) viewLogin.style.display = 'none';
  }
}

function setupAuth() {
  const overlay = document.getElementById('authModalOverlay');
  const btnOpen = document.getElementById('btnOpenAuth');
  const btnClose = document.getElementById('authModalClose');
  // navItemAccount is now managed by setupLockAndAccount()

  // Open modal
  if (btnOpen) {
    btnOpen.onclick = function(e) {
      e.stopPropagation();
      openAuthModal();
    };
  }
  // navItemAccount is handled by setupLockAndAccount()

  // Close modal
  if (btnClose) {
    btnClose.onclick = closeAuthModal;
  }
  if (overlay) {
    overlay.onclick = function(e) {
      if (e.target === overlay) closeAuthModal();
    };
  }

  // Tab switching
  document.getElementById('tabBtnLogin')?.addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tabBtnRegister')?.addEventListener('click', () => switchAuthTab('register'));

  // Login
  const btnLogin = document.getElementById('btnSubmitLogin');
  if (btnLogin) {
    btnLogin.onclick = async function() {
      const email = (document.getElementById('loginEmail')?.value || '').trim();
      const pass = document.getElementById('loginPassword')?.value || '';
      const errEl = document.getElementById('loginError');
      if (!email || !pass) { if (errEl) { errEl.textContent = 'Nhập đủ Email và Mật khẩu!'; errEl.style.display = 'block'; } return; }
      btnLogin.disabled = true; btnLogin.textContent = '⏳ Đang đăng nhập...';
      if (errEl) errEl.style.display = 'none';
      try {
        const res = await API.authSignIn(email, pass);
        if (res && res.ok && res.user) {
          currentUser = res.user;
          updateAuthUI(true);
          toast('🎉 Đăng nhập thành công! Đang đồng bộ...', 'success');
          closeAuthModal();
          await handlePullProfiles(false);
        } else {
          if (errEl) { errEl.textContent = res?.error || 'Đăng nhập thất bại!'; errEl.style.display = 'block'; }
        }
      } catch(err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      } finally {
        btnLogin.disabled = false; btnLogin.textContent = '🚀 Đăng nhập';
      }
    };
  }

  // Register
  const btnReg = document.getElementById('btnSubmitRegister');
  if (btnReg) {
    btnReg.onclick = async function() {
      const email = (document.getElementById('regEmail')?.value || '').trim();
      const pass = document.getElementById('regPassword')?.value || '';
      const confirmPass = document.getElementById('regConfirmPassword')?.value || '';
      const errEl = document.getElementById('regError');
      if (!email || !pass) { if (errEl) { errEl.textContent = 'Nhập đủ Email và Mật khẩu!'; errEl.style.display = 'block'; } return; }
      if (pass.length < 6) { if (errEl) { errEl.textContent = 'Mật khẩu tối thiểu 6 ký tự!'; errEl.style.display = 'block'; } return; }
      if (pass !== confirmPass) { if (errEl) { errEl.textContent = 'Xác nhận mật khẩu không khớp!'; errEl.style.display = 'block'; } return; }
      btnReg.disabled = true; btnReg.textContent = '⏳ Đang tạo tài khoản...';
      if (errEl) errEl.style.display = 'none';
      try {
        const res = await API.authSignUp(email, pass);
        if (res && res.ok) {
          if (res.needsConfirmation) {
            toast('📩 Tạo tài khoản xong! Vui lòng kiểm tra email xác nhận.', 'info');
            switchAuthTab('login');
            const lEmail = document.getElementById('loginEmail');
            if (lEmail) lEmail.value = email;
          } else {
            currentUser = res.user;
            updateAuthUI(true);
            toast('🎉 Tạo tài khoản thành công!', 'success');
            closeAuthModal();
          }
        } else {
          if (errEl) { errEl.textContent = res?.error || 'Đăng ký thất bại!'; errEl.style.display = 'block'; }
        }
      } catch(err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      } finally {
        btnReg.disabled = false; btnReg.textContent = '✨ Tạo tài khoản';
      }
    };
  }

  // Logout
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.onclick = async function() {
      await API.authSignOut();
      currentUser = null;
      updateAuthUI(false);
      closeAuthModal();
      toast('👋 Đã đăng xuất', 'info');
    };
  }

  // Sync Pull
  const btnPull = document.getElementById('btnSyncPull');
  if (btnPull) {
    btnPull.onclick = async function() {
      btnPull.disabled = true; btnPull.textContent = '⏳ Đang tải...';
      await handlePullProfiles(true);
      btnPull.disabled = false; btnPull.textContent = '📥 Tải về (Pull)';
    };
  }

  // Sync Push
  const btnPush = document.getElementById('btnSyncPush');
  if (btnPush) {
    btnPush.onclick = async function() {
      btnPush.disabled = true; btnPush.textContent = '⏳ Đang đẩy...';
      await handlePushProfiles();
      btnPush.disabled = false; btnPush.textContent = '📤 Đẩy lên (Push)';
    };
  }
}

async function handlePullProfiles(showNotification) {
  if (!API.syncPullProfiles) return;
  try {
    const res = await API.syncPullProfiles();
    if (res && res.ok) {
      profiles = res.profiles;
      renderProfiles();
      refreshStatus();
      if (showNotification) toast('✅ Đã đồng bộ ' + res.count + ' profiles từ đám mây!', 'success');
    } else {
      toast('❌ Lỗi đồng bộ: ' + (res?.error || 'Thất bại'), 'error');
    }
  } catch(err) {
    toast('❌ ' + err.message, 'error');
  }
}

async function handlePushProfiles() {
  if (!API.syncPushProfiles) return;
  try {
    const res = await API.syncPushProfiles();
    if (res && res.ok) toast('✅ Đã đẩy ' + (res.count || 0) + ' profiles lên đám mây!', 'success');
    else toast('❌ ' + (res?.error || 'Thất bại'), 'error');
  } catch(err) {
    toast('❌ ' + err.message, 'error');
  }
}


// ══════════════════════════════════════════════════════════════
// ============================================================
// LOCK SCREEN & ACCOUNT MENU
// ============================================================
const ACCESS_CODE = '151206';
const LOCK_STORAGE_KEY = 'na_browser_unlocked';
// ── Supabase Cloud Sync with PIN / Account Code ──
async function syncWithCloud(pin, isManual = false) {
  try {
    const cleanPin = pin || ACCESS_CODE;
    if (API.authLoginWithPin) {
      const logRes = await API.authLoginWithPin(cleanPin);
      if (logRes && logRes.ok) {
        currentUser = logRes.user;
        updateAuthUI(true);
      }
    }

    // TUYỆT ĐỐI KHÔNG gọi syncPushProfiles ở đây:
    // Tránh trường hợp máy phụ có danh sách cũ đẩy ngược lại làm hồi sinh profile đã xóa!

    if (API.syncPullProfiles) {
      const pullRes = await API.syncPullProfiles();
      if (pullRes && pullRes.ok) {
        if (Array.isArray(pullRes.profiles)) {
          profiles = pullRes.profiles;
          renderProfiles();
          // Cập nhật lưu trữ local đồng nhất với Cloud
          if (API.saveProfiles) {
            await API.saveProfiles(profiles);
          }
        } else {
          await loadProfiles();
          renderProfiles();
        }

        if (isManual) {
          toast(`☁️ Đã đồng bộ với Cloud (${profiles.length} hồ sơ)!`, 'success');
        } else if (profiles.length > 0) {
          toast(`☁️ Đã đồng bộ ${profiles.length} hồ sơ từ Cloud!`, 'info');
        }
        return;
      }
    }
    if (isManual) {
      toast('☁️ Đồng bộ đám mây hoàn tất!', 'success');
    }
  } catch (err) {
    console.warn('[syncWithCloud Error]', err);
    if (isManual) toast('⚠️ Lỗi đồng bộ: ' + err.message, 'error');
  }
}


function setupLockAndAccount() {
  // --- Lockscreen buttons ---
  document.getElementById('lockBtnMin')?.addEventListener('click', () => API.minimize());
  document.getElementById('lockBtnMax')?.addEventListener('click', () => API.maximize());
  document.getElementById('lockBtnClose')?.addEventListener('click', () => API.close());
  document.getElementById('btnUnlock')?.addEventListener('click', handleUnlock);

  // Enter key in PIN input
  document.getElementById('pinInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUnlock();
  });

  // Switch to Account tab helper
  const goToAccountPage = () => {
    const accountBtn = document.getElementById('sidebarAccountBtn');
    if (accountBtn) {
      accountBtn.click();
    } else {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-account')?.classList.add('active');
    }
  };

  // Titlebar Account button switches to Account page
  document.getElementById('navItemAccount')?.addEventListener('click', (e) => {
    e.stopPropagation();
    goToAccountPage();
  });

  // Logout button on Account page
  document.getElementById('btnPageLogout')?.addEventListener('click', handleLogout);

  // Temporary lock button on Account page
  document.getElementById('btnPageLockScreen')?.addEventListener('click', () => {
    const lockEl = document.getElementById('lockScreen');
    if (lockEl) {
      lockEl.style.display = 'flex';
      const pinInput = document.getElementById('pinInput');
      if (pinInput) {
        pinInput.value = '';
        setTimeout(() => pinInput.focus(), 100);
      }
    }
  });

  // Logout button inside popup if present
  document.getElementById('btnLogoutApp')?.addEventListener('click', handleLogout);
}

function initLockScreen() {
  const lockEl = document.getElementById('lockScreen');
  if (!lockEl) return;

  const remembered = localStorage.getItem(LOCK_STORAGE_KEY);
  if (remembered === 'true') {
    lockEl.style.display = 'none';
    setTimeout(() => syncWithCloud(ACCESS_CODE), 300);
    return;
  }

  lockEl.style.display = 'flex';
  setTimeout(() => document.getElementById('pinInput')?.focus(), 150);
}

function handleUnlock() {
  const pinInput = document.getElementById('pinInput');
  const errEl = document.getElementById('pinError');
  const rememberEl = document.getElementById('rememberLogin');
  const btnEl = document.getElementById('btnUnlock');
  const lockEl = document.getElementById('lockScreen');

  const entered = (pinInput?.value || '').trim();

  if (entered === ACCESS_CODE) {
    if (errEl) errEl.style.display = 'none';
    if (btnEl) { btnEl.textContent = 'Đang mở...'; btnEl.disabled = true; }
    if (rememberEl?.checked) localStorage.setItem(LOCK_STORAGE_KEY, 'true');
    setTimeout(() => syncWithCloud(entered), 100);
    if (lockEl) {
      lockEl.style.transition = 'opacity 0.3s ease';
      lockEl.style.opacity = '0';
      setTimeout(() => {
        lockEl.style.display = 'none';
        lockEl.style.opacity = '';
        lockEl.style.transition = '';
        if (btnEl) { btnEl.textContent = '🔓 Mở khóa'; btnEl.disabled = false; }
        if (pinInput) pinInput.value = '';
      }, 300);
    }
  } else {
    if (errEl) errEl.style.display = 'block';
    if (pinInput) {
      pinInput.style.borderColor = '#ef4444';
      pinInput.style.animation = 'shakeInput 0.35s ease';
      pinInput.value = '';
      setTimeout(() => {
        pinInput.style.borderColor = 'rgba(255,255,255,0.1)';
        pinInput.style.animation = '';
        pinInput.focus();
      }, 400);
    }
  }
}

function handleLogout() {
  localStorage.removeItem(LOCK_STORAGE_KEY);
  const lockEl = document.getElementById('lockScreen');
  if (lockEl) {
    lockEl.style.display = 'flex';
    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
      pinInput.value = '';
      setTimeout(() => pinInput.focus(), 100);
    }
  }
  // Reset back to profiles page
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-item[data-page="profiles"]')?.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-profiles')?.classList.add('active');

  toast('🔒 Đã đăng xuất & khóa ứng dụng', 'info');
}



// ============================================================
// HOT-PATCH & OTA AUTO-UPDATER
// ============================================================
async function setupUpdater() {
  const badgeEl = document.getElementById('patchBadge');
  const checkBtn = document.getElementById('btnCheckUpdate');
  const msgEl = document.getElementById('checkUpdateMsg');
  const bannerEl = document.getElementById('updateStatusBanner');
  const titleEl = document.getElementById('updateTitle');
  const changelogEl = document.getElementById('updateChangelog');
  const applyBtn = document.getElementById('btnApplyUpdate');
  const relaunchBtn = document.getElementById('btnRelaunchApp');
  const resetBtn = document.getElementById('btnResetPatch');

  if (!checkBtn) return;

  let latestPatch = null;

  // Refresh current patch badge
  async function refreshPatchUI() {
    if (!API.updaterGetPatchInfo) return;
    try {
      const info = await API.updaterGetPatchInfo();
      if (info && info.hasPatch && info.currentPatch) {
        if (badgeEl) {
          badgeEl.textContent = 'Bản vá v' + info.currentPatch.version + ' (Patch #' + info.currentPatch.patchNumber + ')';
          badgeEl.style.background = 'rgba(6,214,160,0.15)';
          badgeEl.style.borderColor = 'rgba(6,214,160,0.35)';
          badgeEl.style.color = '#06d6a0';
        }
        if (resetBtn) resetBtn.style.display = 'inline-block';
      } else {
        if (badgeEl) {
          badgeEl.textContent = 'Bản gốc v' + (info?.appVersion || '1.0.0');
          badgeEl.style.background = 'rgba(99,102,241,0.15)';
          badgeEl.style.borderColor = 'rgba(99,102,241,0.3)';
          badgeEl.style.color = '#c7d2fe';
        }
        if (resetBtn) resetBtn.style.display = 'none';
      }
    } catch(e) {
      console.warn('Get patch info error:', e);
    }
  }

  await refreshPatchUI();

  // Check update button
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    if (msgEl) {
      msgEl.textContent = '⏳ Đang kiểm tra bản vá mới...';
      msgEl.style.color = 'var(--txt3)';
    }
    if (bannerEl) bannerEl.style.display = 'none';
    if (applyBtn) applyBtn.style.display = 'none';
    if (relaunchBtn) relaunchBtn.style.display = 'none';

    try {
      const curInfo = await API.updaterGetPatchInfo?.();
      const curPatchNum = curInfo?.currentPatch?.patchNumber || 0;

      const res = await API.updaterCheckPatch();
      if (res && res.ok) {
        latestPatch = res;
        const newPatchNum = res.patchNumber || 1;

        if (newPatchNum > curPatchNum) {
          const missedCount = newPatchNum - curPatchNum;
          if (msgEl) {
            msgEl.textContent = `🆕 Có ${missedCount} bản vá mới chưa cập nhật!`;
            msgEl.style.color = '#06d6a0';
          }

          if (bannerEl) {
            bannerEl.style.display = 'block';

            // ── Tạo danh sách các bản vá bị bỏ lỡ ──
            const allHistory = [
              { patchNumber: res.patchNumber, version: res.version, title: res.title, changelog: res.changelog, updatedAt: res.updatedAt },
              ...(res.history || [])
            ];
            // Lọc chỉ các bản chưa có (> curPatchNum), sort giảm dần
            const missed = allHistory
              .filter(h => (h.patchNumber || 0) > curPatchNum)
              .sort((a, b) => (b.patchNumber || 0) - (a.patchNumber || 0));

            if (titleEl) titleEl.textContent = `📦 ${missedCount} Bản vá mới — Patch #${curPatchNum + 1}→#${newPatchNum}`;

            // Render danh sách từng bản vá
            if (changelogEl) {
              changelogEl.innerHTML = '';
              missed.forEach(h => {
                const item = document.createElement('div');
                item.style.cssText = `
                  padding:10px 14px;border-radius:8px;margin-bottom:8px;
                  background:rgba(99,102,241,0.07);border:1px solid rgba(99,102,241,0.2);
                `;
                const date = h.updatedAt ? new Date(h.updatedAt).toLocaleDateString('vi-VN') : '';
                item.innerHTML = `
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    <span style="background:rgba(99,102,241,0.2);color:#a5b4fc;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;">v${h.version || '?'} · #${h.patchNumber}</span>
                    ${date ? `<span style="color:var(--text-muted);font-size:10px;">${date}</span>` : ''}
                  </div>
                  <div style="font-size:12px;color:var(--text-muted);line-height:1.5;">${h.changelog || h.title || 'Cải thiện hiệu năng'}</div>
                `;
                changelogEl.appendChild(item);
              });
            }

            if (applyBtn) {
              applyBtn.style.display = 'inline-block';
              applyBtn.disabled = false;
              applyBtn.textContent = `⚡ Cập nhật tất cả ${missedCount} bản vá`;
            }
          }
        } else {
          if (msgEl) {
            msgEl.textContent = '✅ Bạn đang sử dụng bản vá mới nhất!';
            msgEl.style.color = '#06d6a0';
          }
        }
      } else {
        if (msgEl) {
          msgEl.textContent = res?.error || 'Không tìm thấy bản vá mới.';
          msgEl.style.color = 'var(--txt3)';
        }
      }
    } catch(err) {
      if (msgEl) {
        msgEl.textContent = 'Lỗi kết nối: ' + err.message;
        msgEl.style.color = '#ef4444';
      }
    } finally {
      checkBtn.disabled = false;
    }
  });

  // Apply update button
  applyBtn?.addEventListener('click', async () => {
    if (!latestPatch) return;
    applyBtn.disabled = true;
    applyBtn.textContent = '⏳ Đang tải và áp dụng...';

    try {
      const res = await API.updaterApplyPatch(latestPatch);
      if (res && res.ok) {
        toast(' Đã áp dụng bản vá thành công!', 'success');
        applyBtn.style.display = 'none';
        if (relaunchBtn) relaunchBtn.style.display = 'inline-block';
        if (msgEl) {
          msgEl.textContent = ' Đã vá xong! Hãy bấm Khởi động lại.';
          msgEl.style.color = '#06d6a0';
        }
        await refreshPatchUI();
      } else {
        toast(' Lỗi áp dụng bản vá: ' + (res?.error || 'Thất bại'), 'error');
        applyBtn.disabled = false;
        applyBtn.textContent = 'Thử lại';
      }
    } catch(err) {
      toast(' Lỗi: ' + err.message, 'error');
      applyBtn.disabled = false;
      applyBtn.textContent = 'Thử lại';
    }
  });

  // Relaunch app
  relaunchBtn?.addEventListener('click', () => {
    if (API.updaterRelaunch) {
      API.updaterRelaunch();
    } else {
      location.reload();
    }
  });

  // Reset patch (Rollback to clean original)
  resetBtn?.addEventListener('click', async () => {
    if (!confirm('Bạn có chắc muốn gỡ bỏ toàn bộ bản vá để quay về bản gốc ban đầu của phần mềm?')) return;
    try {
      const res = await API.updaterResetPatches();
      if (res && res.ok) {
        toast(' Đã khôi phục về bản gốc!', 'info');
        await refreshPatchUI();
        setTimeout(() => location.reload(), 500);
      } else {
        toast(' Lỗi: ' + (res?.error || 'Không thể khôi phục'), 'error');
      }
    } catch(err) {
      toast(' Lỗi: ' + err.message, 'error');
    }
  });
}

// ══════════════════════════════════════════
// 🗑️ THÙNG RÁC (TRASH BIN)
// ══════════════════════════════════════════

let trashItems = [];

// Cập nhật badge đếm số item trong Thùng Rác trên nav icon
async function refreshTrashBadge() {
  try {
    if (!API.trashList) return;
    const res = await API.trashList();
    const count = (res?.items?.length) || 0;
    const badge = document.getElementById('trashBadge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  } catch(e) { /* ignore */ }
}

// Tải danh sách Thùng Rác và render
async function loadTrash() {
  try {
    if (!API.trashList) {
      document.getElementById('trashEmpty').style.display = '';
      return;
    }
    const res = await API.trashList();
    trashItems = res?.items || [];
    renderTrash();
  } catch(err) {
    console.error('[Trash Load Error]', err);
    toast('⚠️ Lỗi tải Thùng Rác: ' + err.message, 'error');
  }
}

// Render danh sách Thùng Rác
function renderTrash() {
  const container = document.getElementById('trashContainer');
  const emptyState = document.getElementById('trashEmpty');
  const clearBtn = document.getElementById('btnTrashClear');

  if (!container) return;
  container.innerHTML = '';

  if (trashItems.length === 0) {
    if (emptyState) emptyState.style.display = '';
    if (clearBtn) clearBtn.disabled = true;
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (clearBtn) clearBtn.disabled = false;

  trashItems.forEach(item => {
    const device = devices.find(d => d.id === item.deviceId);
    const deletedDate = item.deletedAt ? new Date(item.deletedAt).toLocaleString('vi-VN') : 'Không rõ';
    const proxy = item.proxy?.host ? `${item.proxy.type || 'http'}://${item.proxy.host}` : 'No proxy';

    const row = document.createElement('div');
    row.className = 'trash-row';
    row.style.cssText = `
      display:flex;align-items:center;gap:14px;
      background:rgba(239,68,68,0.05);
      border:1px solid rgba(239,68,68,0.15);
      border-radius:12px;padding:14px 18px;
      transition:all .2s;
    `;
    row.innerHTML = `
      <div style="font-size:24px;flex-shrink:0;opacity:0.5;">${device?.icon || '📱'}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:14px;margin-bottom:3px;display:flex;align-items:center;gap:8px;">
          ${item.name}
          <span style="font-size:10px;font-weight:500;padding:2px 7px;border-radius:4px;background:rgba(239,68,68,0.15);color:#fca5a5;">Đã xóa</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);display:flex;gap:14px;flex-wrap:wrap;">
          <span>📱 ${device?.name || 'Unknown'}</span>
          <span>🌐 ${proxy}</span>
          <span style="color:rgba(239,68,68,0.7)">🗑️ ${deletedDate}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn-restore" data-id="${item.id}" style="
          padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;
          background:rgba(6,214,160,0.15);color:#06d6a0;
          border:1px solid rgba(6,214,160,0.3);border-radius:8px;
          display:flex;align-items:center;gap:5px;transition:all .2s;
        " title="Khôi phục về danh sách">
          ♻️ Khôi phục
        </button>
        <button class="btn-delete-forever" data-id="${item.id}" data-name="${item.name}" style="
          padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;
          background:rgba(239,68,68,0.12);color:#ef4444;
          border:1px solid rgba(239,68,68,0.3);border-radius:8px;
          display:flex;align-items:center;gap:5px;transition:all .2s;
        " title="Xóa vĩnh viễn khỏi Cloud">
          🔥 Xóa vĩnh viễn
        </button>
      </div>
    `;

    // Hover effect
    row.addEventListener('mouseenter', () => { row.style.borderColor = 'rgba(239,68,68,0.35)'; row.style.background = 'rgba(239,68,68,0.08)'; });
    row.addEventListener('mouseleave', () => { row.style.borderColor = 'rgba(239,68,68,0.15)'; row.style.background = 'rgba(239,68,68,0.05)'; });

    // Restore
    row.querySelector('.btn-restore').addEventListener('click', () => trashRestoreProfile(item.id, item.name));
    // Delete Forever
    row.querySelector('.btn-delete-forever').addEventListener('click', () => trashDeleteForever(item.id, item.name));

    container.appendChild(row);
  });

  // Cập nhật badge
  const badge = document.getElementById('trashBadge');
  if (badge) {
    const count = trashItems.length;
    if (count > 0) { badge.textContent = count > 99 ? '99+' : String(count); badge.style.display = 'block'; }
    else badge.style.display = 'none';
  }
}

// Khôi phục profile
async function trashRestoreProfile(profileId, name) {
  try {
    const btn = document.querySelector(`.btn-restore[data-id="${profileId}"]`);
    if (btn) { btn.textContent = '⏳ Đang khôi phục...'; btn.disabled = true; }

    const res = await API.trashRestore(profileId);
    if (res && res.ok) {
      toast(`♻️ Đã khôi phục profile "${name}" về danh sách!`, 'success');
      // reload cả 2 danh sách
      await loadProfiles();
      renderProfiles();
      await loadTrash();
    } else {
      toast(`❌ Lỗi khôi phục: ${res?.error || 'Không rõ'}`, 'error');
      if (btn) { btn.textContent = '♻️ Khôi phục'; btn.disabled = false; }
    }
  } catch(err) {
    toast('⚠️ Lỗi: ' + err.message, 'error');
  }
}

// Xóa vĩnh viễn 1 profile
async function trashDeleteForever(profileId, name) {
  const { confirmed } = await API.showConfirm({
    title: 'Xóa vĩnh viễn?',
    message: `Xóa "${name}" khỏi Cloud vĩnh viễn?`,
    detail: '⚠️ Profile sẽ bị xóa khỏi Supabase Cloud. Không thể phục hồi!',
    danger: true
  });
  if (!confirmed) return;

  try {
    const btn = document.querySelector(`.btn-delete-forever[data-id="${profileId}"]`);
    if (btn) { btn.textContent = '⏳ Đang xóa...'; btn.disabled = true; }

    const res = await API.trashDelete(profileId);
    if (res && res.ok) {
      toast(`🔥 Đã xóa vĩnh viễn "${name}" khỏi Cloud!`, 'info');
      await loadTrash();
    } else {
      toast(`❌ Lỗi xóa: ${res?.error || 'Không rõ'}`, 'error');
      if (btn) { btn.textContent = '🔥 Xóa vĩnh viễn'; btn.disabled = false; }
    }
  } catch(err) {
    toast('⚠️ Lỗi: ' + err.message, 'error');
  }
}

// Dọn sạch toàn bộ Thùng Rác
async function trashClearAll() {
  if (trashItems.length === 0) { toast('🗑️ Thùng Rác đã trống!', 'info'); return; }

  const { confirmed } = await API.showConfirm({
    title: 'Dọn sạch Thùng Rác?',
    message: `Xóa vĩnh viễn ${trashItems.length} profile khỏi Cloud?`,
    detail: '⚠️ Tất cả profile trong Thùng Rác sẽ bị xóa khỏi Supabase Cloud. Không thể phục hồi!',
    danger: true
  });
  if (!confirmed) return;

  try {
    const btn = document.getElementById('btnTrashClear');
    if (btn) { btn.textContent = '⏳ Đang dọn...'; btn.disabled = true; }

    const res = await API.trashClear();
    if (res && res.ok) {
      toast(`🧹 Đã dọn sạch Thùng Rác (${res.count} profiles)!`, 'success');
      await loadTrash();
    } else {
      toast(`❌ Lỗi: ${res?.error || 'Không rõ'}`, 'error');
    }
    if (btn) { btn.textContent = '🧹 Dọn sạch tất cả'; btn.disabled = false; }
  } catch(err) {
    toast('⚠️ Lỗi: ' + err.message, 'error');
  }
}

// Setup trang Thùng Rác
function setupTrashPage() {
  document.getElementById('btnTrashRefresh')?.addEventListener('click', loadTrash);
  document.getElementById('btnTrashClear')?.addEventListener('click', trashClearAll);

  // Tải Thùng Rác khi click vào nav Trash
  document.getElementById('navTrashBtn')?.addEventListener('click', loadTrash);
}
