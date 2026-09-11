const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const puppeteer = require('puppeteer-core');

// ── Thư mục gốc dự án — lưu profiles, extensions, settings ──
const APP_DATA_DIR = __dirname;

const SupabaseManager = require("./supabaseManager");
const supabaseManager = new SupabaseManager(APP_DATA_DIR);

// ══════════════════════════════════════════════════════════════════
// ── LOCAL PROXY SERVER (AdsPower/Hidemium style) ──────────────────
// Khi proxy có user:pass, khởi động 1 local HTTP proxy server trên
// 127.0.0.1:randomPort. Server này tự thêm Proxy-Authorization header
// khi tunnel đến upstream. Chrome chỉ thấy localhost → KHÔNG bao giờ
// hiện popup đăng nhập proxy.
// ══════════════════════════════════════════════════════════════════

const localProxies = new Map(); // profileId -> { server, port }

function startLocalProxy(profileId, upstreamHost, upstreamPort, upstreamUser, upstreamPass) {
  return new Promise((resolve, reject) => {
    const authB64 = Buffer.from(`${upstreamUser}:${upstreamPass}`).toString('base64');
    const authHeader = `Basic ${authB64}`;

    const server = http.createServer((req, res) => {
      // ── HTTP plain-text requests ──
      try {
        const headers = { ...req.headers, 'Proxy-Authorization': authHeader };
        delete headers['proxy-authorization'];
        const options = {
          hostname: upstreamHost,
          port: parseInt(upstreamPort),
          path: req.url,
          method: req.method,
          headers,
        };
        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        });
        proxyReq.on('error', () => { try { res.end(); } catch(e){} });
        req.pipe(proxyReq, { end: true });
      } catch(e) { try { res.end(); } catch(e2){} }
    });

    server.on('connect', (req, clientSocket, head) => {
      // ── HTTPS CONNECT tunnel ──
      try {
        const upstreamSocket = net.connect(parseInt(upstreamPort), upstreamHost);
        let headerBuf = Buffer.alloc(0);
        let tunneled = false;

        upstreamSocket.on('connect', () => {
          // Gửi CONNECT request kèm auth đến upstream
          upstreamSocket.write(
            `CONNECT ${req.url} HTTP/1.1\r\n` +
            `Host: ${req.url}\r\n` +
            `Proxy-Authorization: ${authHeader}\r\n` +
            `\r\n`
          );
        });

        upstreamSocket.on('data', (chunk) => {
          if (tunneled) return;
          headerBuf = Buffer.concat([headerBuf, chunk]);
          const end = headerBuf.indexOf('\r\n\r\n');
          if (end !== -1) {
            const headerStr = headerBuf.slice(0, end).toString();
            const rest = headerBuf.slice(end + 4);
            if (headerStr.includes(' 200')) {
              tunneled = true;
              clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-agent: NABrowser\r\n\r\n');
              if (head && head.length > 0) upstreamSocket.write(head);
              if (rest.length > 0) clientSocket.write(rest);
              upstreamSocket.pipe(clientSocket);
              clientSocket.pipe(upstreamSocket);
            } else {
              clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
              upstreamSocket.destroy();
            }
          }
        });

        const cleanup = () => { try { upstreamSocket.destroy(); clientSocket.destroy(); } catch(e){} };
        upstreamSocket.on('error', cleanup);
        upstreamSocket.on('close', cleanup);
        clientSocket.on('error', cleanup);
        clientSocket.on('close', () => { try { upstreamSocket.destroy(); } catch(e){} });
      } catch(e) { try { clientSocket.destroy(); } catch(e2){} }
    });

    server.on('error', (e) => reject(e));

    // Tìm port trống ngẫu nhiên
    const tryListen = (port) => {
      server.listen(port, '127.0.0.1', () => {
        localProxies.set(profileId, { server, port });
        console.log(`[LocalProxy] ✅ Profile ${profileId}: 127.0.0.1:${port} → ${upstreamHost}:${upstreamPort} (user: ${upstreamUser})`);
        resolve(port);
      });
    };
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        // Port bị chiếm, thử port khác
        tryListen(Math.floor(Math.random() * 9000) + 40000);
      }
    });
    tryListen(Math.floor(Math.random() * 9000) + 40000);
  });
}

function stopLocalProxy(profileId) {
  const entry = localProxies.get(profileId);
  if (entry) {
    try { entry.server.close(); } catch(e){}
    localProxies.delete(profileId);
    console.log(`[LocalProxy] 🛑 Stopped proxy for profile ${profileId}`);
  }
}

// ── CDP Device Emulation Helper ──
// startUrl: URL thật để navigate SAU KHI proxy auth đã được thiết lập.
// Chrome được spawn với about:blank, sau đó CDP navigate đến startUrl.
// Cách này đảm bảo Fetch.authRequired handler sẵn sàng TRƯỚC khi Chrome tải bất kỳ request nào qua proxy.
async function applyCDPDeviceEmulation(debugPort, device, proxy = null, winW = 380, winH = 675, startUrl = null) {
  let browser = null;
  try {
    // Thử kết nối CDP tối đa 20 lần (Chrome mất vài giây để khởi động)
    for (let i = 0; i < 20; i++) {
      try {
        browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${debugPort}`,
          defaultViewport: null,
        });
        break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    if (!browser) {
      console.warn('[CDP] Không kết nối được sau 20 lần thử, port:', debugPort);
      return;
    }

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    const client = await page.createCDPSession();

    // Khôi phục Cookies & Dữ liệu Web từ Cloud nếu có
    try {
      const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
      let targetProfile = profile;
      if (fs.existsSync(profilePath)) {
        const all = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
        const found = all.find(x => x.id === profile.id);
        if (found) targetProfile = found;
      }
      if (targetProfile && targetProfile.webData && Array.isArray(targetProfile.webData.cookies) && targetProfile.webData.cookies.length > 0) {
        await client.send('Network.setCookies', { cookies: targetProfile.webData.cookies });
        console.log(`[CDP] 🍪 Đã khôi phục ${targetProfile.webData.cookies.length} cookies từ Cloud cho profile "${profile.name}"!`);
      }
    } catch (errCookies) {
      console.warn('[CDP] Lỗi khi nạp cookies từ Cloud:', errCookies.message);
    }

    const dpr   = device.device_scale_factor || 3.0;
    const ua    = device.user_agent || '';
    const tz    = device.timezone  || 'Asia/Ho_Chi_Minh';
    const lang  = device.language  || 'vi-VN';
    const touch = device.max_touch_points || 10;

    // Proxy auth đã được xử lý bởi local proxy server (startLocalProxy).
    // CDP không cần handle 407 nữa.

    // ── 1. SET KÍCH THƯỚC CỬA SỔ VẬT LÝ ngay lúc Chrome vừa mở ──
    // (Chỉ set 1 lần khi mở, user vẫn resize được sau đó)
    let windowId = null;
    try {
      const winInfo = await client.send('Browser.getWindowForTarget');
      windowId = winInfo && winInfo.windowId;
      if (windowId) {
        await client.send('Browser.setWindowBounds', {
          windowId,
          bounds: { left: undefined, top: undefined, width: winW, height: winH, windowState: 'normal' }
        });
        console.log(`[CDP] 📐 Window size set: ${winW}x${winH}`);
      }
    } catch(e) {
      console.warn('[CDP] setWindowBounds failed:', e.message);
    }

    // ── 2. Viewport bám theo vùng nội dung thực của cửa sổ (chế độ Responsive — giống Chrome DevTools Device Toolbar) ──
    // KHÔNG ghim viewport vào kích thước device: cửa sổ vật lý luôn nhỏ hơn độ phân giải điện thoại
    // nên ghim cứng sẽ tạo khoảng trắng thừa bên phải/dưới và cô lập trang web.
    // mobile:true + DPR device + UA mobile ⇒ trang tự render giao diện điện thoại,
    // còn width/height JS thấy = đúng phần hiển thị thật của cửa sổ.

    // Đo phần diện tích bị chiếm bởi thanh UI của Chrome (tab bar + address bar)
    // = chênh lệch giữa kích thước cửa sổ ngoài và CSS viewport NGAY TRƯỚC KHI áp emulation
    let uiDeltaX = 0, uiDeltaY = 120; // fallback: tab + address bar mặc định ~120px
    try {
      if (windowId) {
        const { bounds } = await client.send('Browser.getWindowBounds', { windowId });
        const metrics = await client.send('Page.getLayoutMetrics');
        const vp = metrics.cssVisualViewport || metrics.visualViewport;
        if (bounds && vp && vp.clientWidth > 0) {
          uiDeltaX = Math.max(0, Math.round(bounds.width  - vp.clientWidth));
          uiDeltaY = Math.max(40, Math.round(bounds.height - vp.clientHeight));
        }
        console.log(`[CDP] 📏 Chrome UI chrome measured: ${uiDeltaX}x${uiDeltaY}px`);
      }
    } catch(e) {}

    const getContentSize = async () => {
      try {
        if (windowId) {
          const { bounds } = await client.send('Browser.getWindowBounds', { windowId });
          if (bounds && bounds.width) {
            return {
              w: Math.max(Math.round(bounds.width  - uiDeltaX), 1),
              h: Math.max(Math.round(bounds.height - uiDeltaY), 1),
            };
          }
        }
      } catch(e) {}
      return { w: winW, h: winH };
    };

    const setDeviceMetrics = async (w, h) => {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width:             w,
        height:            h,
        deviceScaleFactor: dpr,
        mobile:            true,
        screenWidth:       w,   // screen.* = đúng màn hình đang hiển thị
        screenHeight:      h,
        positionX:         0,
        positionY:         0,
      });
    };

    const initBounds = await getContentSize();
    await setDeviceMetrics(initBounds.w, initBounds.h);

    // ── Theo dõi resize: cập nhật viewport ngay khi người dùng kéo thay đổi kích thước cửa sổ ──
    let resizeTimer = null;
    let lastAppliedW = initBounds.w, lastAppliedH = initBounds.h;
    const syncViewportIfChanged = async () => {
      try {
        const b = await getContentSize();
        if (b.w !== lastAppliedW || b.h !== lastAppliedH) {
          lastAppliedW = b.w; lastAppliedH = b.h;
          await setDeviceMetrics(b.w, b.h);
          console.log(`[CDP] 🔄 Viewport resized → ${b.w}x${b.h}`);
        }
      } catch(e) {}
    };
    client.on('Browser.windowBoundsChanged', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(syncViewportIfChanged, 120); // debounce — tránh spam CDP khi đang kéo resize liên tục
    });
    // Dự phòng: một số build Chromium không phát sự kiện windowBoundsChanged cho page session
    const resizePoller = setInterval(syncViewportIfChanged, 1000);
    page.on('close', () => clearInterval(resizePoller));

    // ── 3. User-Agent & Client Hints ──
    const isOpera    = ua.includes('OPR/') || ua.includes('Opera/') || device.browser_type === 'opera' || !!device.opera_version;
    const operaMajor = ua.match(/(?:OPR|Opera)\/(\d+)/)?.[1]     || device.opera_version?.split('.')[0]  || '143';
    const operaFull  = ua.match(/(?:OPR|Opera)\/([\d.]+)/)?.[1]  || device.opera_version                 || '143.0.0.0';
    const chromeMajor = ua.match(/Chrome\/(\d+)/)?.[1]           || device.chrome_version?.split('.')[0] || '126';
    const chromeFull  = ua.match(/Chrome\/([\d.]+)/)?.[1]        || device.chrome_version                || '126.0.0.0';
    const platformName = device.is_mobile !== false ? 'Android' : (ua.includes('Windows') ? 'Windows' : 'Android');

    const brands = [
      { brand: 'Not/A)Brand', version: '99' },
      { brand: 'Chromium',    version: chromeMajor },
    ];
    const fullVersionList = [
      { brand: 'Not/A)Brand', version: '99.0.0.0' },
      { brand: 'Chromium',    version: chromeFull },
    ];
    if (isOpera) {
      brands.push({ brand: 'Opera', version: operaMajor });
      fullVersionList.push({ brand: 'Opera', version: operaFull });
    } else {
      brands.push({ brand: 'Google Chrome', version: chromeMajor });
      fullVersionList.push({ brand: 'Google Chrome', version: chromeFull });
    }

    await client.send('Emulation.setUserAgentOverride', {
      userAgent: ua,
      acceptLanguage: lang,
      platform: device.platform || 'Linux armv8l',
      userAgentMetadata: {
        brands,
        fullVersionList,
        platform:        platformName,
        platformVersion: (device.os_version || 'Android 13').replace(/Android |Windows /, ''),
        architecture:    device.is_mobile !== false ? 'arm' : 'x86',
        model:           device.model || 'SM-G998B',
        mobile:          device.is_mobile !== false,
        bitness:         '64',
        wow64:           false,
      },
    });

    // ── 4. Touch Events ──
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: touch });

    // ── 5. Timezone & Locale ──
    await client.send('Emulation.setTimezoneOverride', { timezoneId: tz });
    await client.send('Emulation.setLocaleOverride',   { locale: lang });

    // ── 6. Geolocation ──
    if (device.geo) {
      await client.send('Emulation.setGeolocationOverride', {
        latitude:  device.geo.lat,
        longitude: device.geo.lng,
        accuracy:  18,
      });
    }

    // ── 7. Tắt AutomationControlled ──
    await client.send('Emulation.setAutomationOverride', { enabled: false });

    // ── 8. Media features (Dark Mode) ──
    await client.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme',  value: 'dark' },
        { name: 'prefers-reduced-motion', value: 'no-preference' },
      ]
    });

    console.log(`[CDP] ✅ Emulation applied: ${device.name} | ${initBounds.w}x${initBounds.h} DPR=${dpr} (viewport responsive theo cửa sổ)`);

    // ── Navigate đến URL thật SAU KHI toàn bộ setup xong ──
    // Chrome được spawn với about:blank → giờ mới điều hướng đến startUrl.
    // Proxy auth handler đã sẵn sàng, 407 sẽ được tự trả lời, không có popup.
    if (startUrl && startUrl !== 'about:blank' && startUrl.startsWith('http')) {
      try {
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log(`[CDP] 🌐 Navigated to: ${startUrl}`);
      } catch(e) {
        // Timeout hoặc page đóng trước khi load xong — không phải lỗi nghiêm trọng
        console.warn('[CDP] Navigate warning:', e.message);
      }
    }

    // KHÔNG disconnect — cần giữ CDP session sống để listener windowBoundsChanged
    // tự cập nhật viewport mỗi khi người dùng resize cửa sổ.
    // Kết nối sẽ tự đóng khi trình duyệt profile bị tắt.
  } catch (err) {
    console.error('[CDP] Lỗi emulation:', err.message);
    if (browser) { try { browser.disconnect(); } catch(e){} }
  }
}


// Force X11 backend to fix Wayland frameless window crash/hide issue in Linux Distrobox
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}
app.commandLine.appendSwitch('no-sandbox');
// Fix GPU disk cache access denied warning
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow;
let tray;

// Keep a list of launched browser processes
const launchedBrowsers = new Map(); // profileId -> { pid, url }

function getRunningProfilesCount() {
  let count = 0;
  for (const [id, info] of launchedBrowsers) {
    try {
      process.kill(info.pid, 0); // Check if process is still alive
      count++;
    } catch(e) {
      launchedBrowsers.delete(id);
    }
  }
  return count;
}

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const appIcon = nativeImage.createFromPath(iconPath);

  app.setName('N/A Browser');
  if (process.platform === 'linux') {
    app.setDesktopName('na-browser');
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1000,
    minHeight: 620,
    title: 'N/A Browser',
    frame: false,
    transparent: false,
    backgroundColor: '#070711',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
    icon: appIcon,
    show: false,
  });

  if (appIcon && !appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }

  // --- Hot-Patch OTA Loader ---
  const PATCH_RENDERER_DIR = path.join(APP_DATA_DIR, 'patches', 'renderer');
  let htmlPath = path.join(__dirname, 'src/renderer/index.html');
  const patchHtmlPath = path.join(PATCH_RENDERER_DIR, 'index.html');
  if (fs.existsSync(patchHtmlPath)) {
    htmlPath = patchHtmlPath;
    console.log('[HotPatch] Đang nạp giao diện từ Bản vá:', htmlPath);
  } else {
    console.log('[N/A Browser] Loading gốc:', htmlPath);
  }
  mainWindow.loadFile(htmlPath).catch(err => {
    console.error('[N/A Browser] Failed to load HTML:', err);
    mainWindow.webContents.openDevTools();
  });

  // Catch renderer crashes
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    console.error('[N/A Browser] Renderer crashed!', details?.reason);
  });
  mainWindow.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('[N/A Browser] Load failed:', code, desc);
    mainWindow.webContents.openDevTools();
  });
  // Fix: dùng Event object API mới thay vì deprecated positional args
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level >= 2) console.error('[Renderer Error]', event.message, 'line:', event.lineNumber);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // F12 opens DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isDevTools = (input.key === 'F12') || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (isDevTools && input.type === 'keyDown') {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });

  // Ràng buộc: Không cho đóng ứng dụng khi còn profile đang chạy
  mainWindow.on('close', (e) => {
    const runningCount = getRunningProfilesCount();
    if (runningCount > 0) {
      e.preventDefault();
      dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Đã hiểu'],
        defaultId: 0,
        title: 'Cảnh báo - N/A Browser',
        message: 'Không thể đóng N/A Browser!',
        detail: `Hiện có ${runningCount} profile trình duyệt đang hoạt động.\n\nVui lòng tắt tất cả các cửa sổ profile trước khi đóng ứng dụng N/A Browser.`,
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Remove default menu
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (e) => {
  const runningCount = getRunningProfilesCount();
  if (runningCount > 0) {
    e.preventDefault();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC Handlers ──

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

// Native confirm dialog (dùng thay cho window.confirm bị Electron block)
ipcMain.handle('dialog:confirm', async (event, { title, message, detail, danger }) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: danger ? 'warning' : 'question',
    buttons: [danger ? 'Xóa vĩnh viễn' : 'Xác nhận', 'Hủy bỏ'],
    defaultId: 1,
    cancelId: 1,
    title: title || 'Xác nhận',
    message: message || 'Bạn có chắc chắn không?',
    detail: detail || '',
  });
  return { confirmed: result.response === 0 };
});

// Load devices list
ipcMain.handle('devices:load', async () => {
  const devPath = path.join(__dirname, 'src/devices.json');
  const raw = fs.readFileSync(devPath, 'utf-8');
  return JSON.parse(raw);
});

// Load saved profiles
ipcMain.handle('profiles:load', async () => {
  const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
  if (!fs.existsSync(profilePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
  } catch(e) { return []; }
});

// Save profiles
ipcMain.handle('profiles:save', async (event, profiles) => {
  try {
    const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
    fs.writeFileSync(profilePath, JSON.stringify(profiles, null, 2));
    if (supabaseManager && supabaseManager.currentUser) {
      supabaseManager.pushAllProfiles(profiles).catch(e => console.warn('[Cloud Auto-Push error]:', e.message));
    }
    return true;
  } catch (err) {
    console.error('[Save Profiles Error]', err);
    return false;
  }
});

// --- Supabase & Cloud Sync IPC ---
ipcMain.handle('supabase:getConfig', async () => {
  return supabaseManager.getConfig();
});

ipcMain.handle('supabase:saveConfig', async (event, config) => {
  return supabaseManager.saveConfig(config);
});

ipcMain.handle('supabase:testConnection', async (event, config) => {
  return supabaseManager.testConnection(config?.url, config?.anonKey);
});

ipcMain.handle('auth:loginWithPin', async (event, pin) => {
  return supabaseManager.loginWithPin(pin);
});

ipcMain.handle('auth:signUp', async (event, email, password) => {
  return supabaseManager.signUp(email, password);
});

ipcMain.handle('auth:signIn', async (event, email, password) => {
  return supabaseManager.signIn(email, password);
});

ipcMain.handle('auth:signOut', async () => {
  return supabaseManager.signOut();
});

ipcMain.handle('auth:getSession', async () => {
  return supabaseManager.getSession();
});

ipcMain.handle('sync:pullProfiles', async () => {
  const result = await supabaseManager.pullProfiles();
  if (!result.ok) return result;

  try {
    const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
    let localProfiles = [];
    if (fs.existsSync(profilePath)) {
      try {
        localProfiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      } catch (e) { localProfiles = []; }
    }

    const localMap = new Map();
    localProfiles.forEach(p => localMap.set(String(p.id), p));

    for (const rp of result.profiles) {
      localMap.set(String(rp.id), {
        ...(localMap.get(String(rp.id)) || {}),
        ...rp
      });
    }

    const merged = Array.from(localMap.values());
    fs.writeFileSync(profilePath, JSON.stringify(merged, null, 2), 'utf-8');
    return { ok: true, profiles: merged, count: result.profiles.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sync:pushProfiles', async () => {
  const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
  let localProfiles = [];
  if (fs.existsSync(profilePath)) {
    try {
      localProfiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    } catch (e) { localProfiles = []; }
  }
  return supabaseManager.pushAllProfiles(localProfiles);
});




// Load saved extensions
ipcMain.handle('extensions:load', async () => {
  const extPath = path.join(APP_DATA_DIR, 'extensions.json');
  if (!fs.existsSync(extPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(extPath, 'utf-8'));
  } catch(e) { return []; }
});

// Save extensions
ipcMain.handle('extensions:save', async (event, extensions) => {
  const extPath = path.join(APP_DATA_DIR, 'extensions.json');
  fs.writeFileSync(extPath, JSON.stringify(extensions, null, 2));
  return true;
});

// Select extension folder or zip file
ipcMain.handle('extensions:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'openFile'],
    filters: [{ name: 'Extension', extensions: ['zip', 'crx'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;
  
  const selectedPath = result.filePaths[0];
  const extId = 'ext_' + Date.now();
  const targetDir = path.join(APP_DATA_DIR, 'custom_extensions', extId);
  fs.mkdirSync(targetDir, { recursive: true });

  const stat = fs.statSync(selectedPath);
  let extName = path.basename(selectedPath);

  if (stat.isDirectory()) {
    // Copy folder contents recursively
    fs.cpSync(selectedPath, targetDir, { recursive: true });
    // Try reading manifest.json for extension name
    const manifestFile = path.join(targetDir, 'manifest.json');
    if (fs.existsSync(manifestFile)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
        if (manifest.name) extName = manifest.name;
      } catch(e){}
    }
    return { ok: true, id: extId, name: extName, path: targetDir, enabled: true };
  } else {
    // File .zip or .crx
    return { ok: false, error: 'Vui lòng chọn thư mục extension đã giải nén (có chứa file manifest.json).' };
  }
});

// Load app settings
function getAppSettings() {
  const settingsPath = path.join(APP_DATA_DIR, 'settings.json');
  const defaultSettings = { windowWidth: 380, windowHeight: 675, preset: '380x675' };
  if (!fs.existsSync(settingsPath)) return defaultSettings;
  try {
    const loaded = { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) };
    // Bảo vệ: kích thước cửa sổ phải hợp lý (tránh giá trị rác như 100px)
    loaded.windowWidth  = Math.max(200, parseInt(loaded.windowWidth)  || 380);
    loaded.windowHeight = Math.max(200, parseInt(loaded.windowHeight) || 675);
    return loaded;
  } catch(e) {
    return defaultSettings;
  }
}

ipcMain.handle('settings:load', async () => getAppSettings());
ipcMain.handle('settings:save', async (event, newSettings) => {
  const settingsPath = path.join(APP_DATA_DIR, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
  return true;
});

// Ghi đè Chromium Preferences — BUỘc Chrome mở đúng kích thước & vị trí mỗi lần launch
function setChromiumWindowPreferences(profileDir, posX, posY, winW, winH, profileNum = 1, profileName = '') {
  try {
    const defaultDir = path.join(profileDir, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    const prefsFile = path.join(defaultDir, 'Preferences');

    let prefs = {};
    if (fs.existsSync(prefsFile)) {
      try { prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf-8')); } catch(e){}
    }

    // Luôn ghi đè window_placement — Chrome sẽ bỏ qua --window-size nếu đã có giá trị cũ
    if (!prefs.browser) prefs.browser = {};
    prefs.browser.window_placement = {
      bottom:           posY + winH,
      left:             posX,
      maximized:        false,
      right:            posX + winW,
      top:              posY,
      work_area_bottom: posY + winH + 100,
      work_area_left:   0,
      work_area_right:  posX + winW + 500,
      work_area_top:    0,
      dpi_scale:        1.0,
    };

    if (!prefs.profile) prefs.profile = {};
    prefs.profile.name = `N/A Browser #${profileNum}${profileName ? ' - ' + profileName : ''}`;
    fs.writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));
  } catch(e) {
    console.error('[Prefs write error]', e);
  }
}

// Generate custom PNG & ICO icon with N/A Browser logo + profile number badge
function generateProfileIcon(profileNum, chromeBin) {
  try {
    const iconDir = path.join(APP_DATA_DIR, 'profile_icons');
    fs.mkdirSync(iconDir, { recursive: true });

    const pngPath = path.join(iconDir, `profile_${profileNum}.png`);
    const icoPath = path.join(iconDir, `profile_${profileNum}.ico`);
    const baseIconPath = path.join(__dirname, 'assets', 'icon.png');

    if (process.platform === 'win32') {
      const psScript = path.join(__dirname, 'generate_profile_icon.ps1');
      if (!fs.existsSync(icoPath) && fs.existsSync(psScript)) {
        try {
          const { execSync } = require('child_process');
          execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}" -baseIconPath "${baseIconPath}" -profileNum ${profileNum} -outputDir "${iconDir}" -chromeBin "${chromeBin || ''}"`, { stdio: 'ignore' });
        } catch(e) {
          console.error('[Generate Windows Profile Icon Error]', e);
        }
      }
      return {
        pngPath: fs.existsSync(pngPath) ? pngPath : baseIconPath,
        icoPath: fs.existsSync(icoPath) ? icoPath : baseIconPath
      };
    }

    // Linux
    const labelText = `#${profileNum}`;
    const { execSync } = require('child_process');
    try {
      const convertBin = fs.existsSync('/usr/bin/magick') ? 'magick convert' : 'convert';
      const cmd = `${convertBin} "${baseIconPath}" -resize 256x256 -stroke "#00f0ff" -strokewidth 4 -fill "#0a0a24" -draw "roundrectangle 72,194 184,242 24,24" -stroke none -fill "#ffffff" -pointsize 26 -gravity center -draw "text 0,95 '${labelText}'" "${pngPath}"`;
      execSync(cmd, { stdio: 'ignore' });
    } catch(e) {}
    return {
      pngPath: fs.existsSync(pngPath) ? pngPath : baseIconPath,
      icoPath: pngPath
    };
  } catch(err) {
    console.error('[Generate Profile Icon Error]', err);
    return {
      pngPath: path.join(__dirname, 'assets', 'icon.png'),
      icoPath: path.join(__dirname, 'assets', 'icon.png')
    };
  }
}

// Create custom desktop entry for profile so Linux Desktop Dock maps window WM_CLASS to this icon & name
function createProfileDesktopFile(profile, profileNum, iconPath) {
  try {
    const appsDir = path.join(os.homedir(), '.local/share/applications');
    fs.mkdirSync(appsDir, { recursive: true });

    const wmClass = `na-profile-${profile.id}`;
    const desktopPath = path.join(appsDir, `${wmClass}.desktop`);

    const content = `[Desktop Entry]
Version=1.0
Type=Application
Name=N/A Browser #${profileNum} (${profile.name})
Comment=N/A Browser Profile #${profileNum}
Exec=/usr/bin/true
Icon=${iconPath}
Terminal=false
StartupWMClass=${wmClass}
NoDisplay=true
Categories=Network;Utility;
`;

    fs.writeFileSync(desktopPath, content);

    const { exec } = require('child_process');
    exec(`update-desktop-database "${appsDir}"`, () => {});

    return wmClass;
  } catch(e) {
    console.error('[Create Desktop File Error]', e);
    return `na-profile-${profile.id}`;
  }
}

// Expose displays list to renderer
ipcMain.handle('displays:get', async () => {
  try {
    const { screen } = require('electron');
    return screen.getAllDisplays().map((d, idx) => ({
      id: idx,
      name: `Màn hình ${idx + 1}${d.id === screen.getPrimaryDisplay().id ? ' (Chính)' : ''} (${d.bounds.width}x${d.bounds.height})`,
      bounds: d.bounds,
      workArea: d.workArea,
    }));
  } catch(e) {
    return [{ id: 0, name: 'Màn hình chính (1920x1080)', bounds: { width: 1920, height: 1080 }, workArea: { x:0, y:0, width:1920, height:1080 } }];
  }
});

// Calculate window position with Grid or Cascade layout options
function calculateGridPosition(index, totalRunning = 1, profileCustomWin = null, customOpts = null) {
  try {
    const { screen } = require('electron');
    const displays = screen.getAllDisplays();
    const settings = getAppSettings();
    const opts = { ...settings, ...(customOpts || {}) };

    const displayIdx = parseInt(opts.displayIndex) || 0;
    const targetDisplay = displays[displayIdx] || screen.getPrimaryDisplay();
    const { x, y, width, height } = targetDisplay.workArea;

    const mode = opts.mode || 'grid'; // 'grid' | 'cascade'
    const autoAdapt = opts.autoAdapt !== false;
    // Chú ý: dùng || thay vì ?? — parseInt('') trả NaN, mà NaN ?? 10 vẫn là NaN!
    const startX = parseInt(opts.startX) || 10;
    const startY = parseInt(opts.startY) || 10;
    const gapX = parseInt(opts.gapX) || 10;
    const gapY = parseInt(opts.gapY) || 10;

    let winW = parseInt(opts.winW) || parseInt(opts.windowWidth) || 380;
    let winH = parseInt(opts.winH) || parseInt(opts.windowHeight) || 675;

    if (profileCustomWin && profileCustomWin.width && profileCustomWin.height) {
      winW = parseInt(profileCustomWin.width) || winW;
      winH = parseInt(profileCustomWin.height) || winH;
    }
    // Clamp kích thước — chỉ giới hạn trên (không vượt màn hình), tôn trọng giá trị người dùng nhập
    // Windows/OS sẽ tự enforce minimum vật lý (~112px) nếu giá trị quá nhỏ
    winW = Math.min(Math.max(winW, 1), width - 50);
    winH = Math.min(Math.max(winH, 1), height - 40);

    let colsPerRow = parseInt(opts.colsPerRow) || 3;
    if (autoAdapt) {
      colsPerRow = Math.max(1, Math.floor((width - startX) / (winW + gapX)));
    }

    let posX = x + startX;
    let posY = y + startY;

    if (mode === 'cascade') {
      posX = x + startX + (index * gapX);
      posY = y + startY + (index * gapY);
    } else {
      const colIndex = index % colsPerRow;
      const rowIndex = Math.floor(index / colsPerRow);
      posX = x + startX + (colIndex * (winW + gapX));
      posY = y + startY + (rowIndex * (winH + gapY));
    }

    return { posX, posY, winW, winH, colsPerRow, mode };
  } catch(e) {
    return { posX: 10 + (index * 20), posY: 10 + (index * 20), winW: 380, winH: 675, colsPerRow: 3, mode: 'grid' };
  }
}

// Rearrange all currently running browser windows into clean layout
ipcMain.handle('browser:arrangeWindows', async (event, customOpts = {}) => {
  const runningList = [];
  for (const [id, info] of launchedBrowsers) {
    try {
      process.kill(info.pid, 0); // Check if alive
      runningList.push({ id, ...info });
    } catch(e) {
      launchedBrowsers.delete(id);
    }
  }

  if (runningList.length === 0) {
    return { ok: false, count: 0, error: 'Chưa có trình duyệt nào đang chạy!' };
  }

  // Save new layout settings if provided
  if (customOpts && Object.keys(customOpts).length > 0) {
    const currentSettings = getAppSettings();
    const newSettings = { ...currentSettings, ...customOpts };
    if (customOpts.winW) newSettings.windowWidth = customOpts.winW;
    if (customOpts.winH) newSettings.windowHeight = customOpts.winH;
    // Ghi vào APP_DATA_DIR — đúng nơi getAppSettings() đọc (tránh lệch userData dir)
    const settingsPath = path.join(APP_DATA_DIR, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
  }

  const N = runningList.length;
  const puppeteer = require('puppeteer-core');

  for (let idx = 0; idx < runningList.length; idx++) {
    const pInfo = runningList[idx];
    const pos = calculateGridPosition(idx, N, null, customOpts);

    const profileDir = path.join(APP_DATA_DIR, 'profiles', pInfo.id);
    setChromiumWindowPreferences(profileDir, pos.posX, pos.posY, pos.winW, pos.winH);

    // CDP DevTools Protocol live window move & resize (Works on Windows, Linux, Mac!)
    if (pInfo.debugPort) {
      try {
        const browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${pInfo.debugPort}`,
          defaultViewport: null,
        });
        const pages = await browser.pages();
        if (pages.length > 0) {
          const client = await pages[0].createCDPSession();
          const { windowId } = await client.send('Browser.getWindowForTarget');
          if (windowId) {
            await client.send('Browser.setWindowBounds', {
              windowId,
              bounds: {
                left: pos.posX,
                top: pos.posY,
                width: pos.winW,
                height: pos.winH,
                windowState: 'normal'
              }
            });
          }
        }
        browser.disconnect();
      } catch(err) {
        console.error('[CDP Move Error]', err.message);
      }
    }
  }

  return { ok: true, count: N, mode: customOpts.mode || 'grid' };
});

// Launch browser with fingerprint
// Tạo port debug ngẫu nhiên tránh xung đột khi mở nhiều cửa sổ
function getRandomDebugPort() {
  return Math.floor(Math.random() * (59000 - 49152)) + 49152;
}

ipcMain.handle('browser:launch', async (event, profile) => {
  try {
    const { spawn } = require('child_process');
    const profileDir = path.join(APP_DATA_DIR, 'profiles', profile.id);
    fs.mkdirSync(profileDir, { recursive: true });

    // Write fingerprint inject script & Chrome extension (MV2 for Blocking Proxy Auth)
    const injectScript = generateFingerprintScript(profile.device);

    const extDir = path.join(profileDir, 'cloak_ext');
    fs.mkdirSync(extDir, { recursive: true });

    const manifestJson = {
      manifest_version: 2,
      name: `NA Stealth Fingerprint ${profile.id}`,
      version: '1.0.0',
      description: 'Native C++ Level Stealth Fingerprint Injector',
      permissions: ["<all_urls>"],
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['inject.js'],
          run_at: 'document_start',
          all_frames: true
        }
      ]
    };

    // Proxy auth được xử lý hoàn toàn qua CDP Fetch.authRequired (native, không cần extension).
    // Extension chỉ inject fingerprint script — không cần background.js cho proxy.

    fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifestJson, null, 2));

    const extensionContentJs = injectScript;
    fs.writeFileSync(path.join(extDir, 'inject.js'), extensionContentJs);

    const extPaths = [extDir];
    const allExtsFile = path.join(APP_DATA_DIR, 'extensions.json');
    if (fs.existsSync(allExtsFile)) {
      try {
        const allExts = JSON.parse(fs.readFileSync(allExtsFile, 'utf-8'));
        if (profile.selectedExtensions && Array.isArray(profile.selectedExtensions) && profile.selectedExtensions.length > 0) {
          profile.selectedExtensions.forEach(extId => {
            const item = allExts.find(e => e.id === extId);
            if (item && item.path && fs.existsSync(item.path)) {
              extPaths.push(item.path);
            }
          });
        } else {
          // Tự động nạp TẤT CẢ Extension có trong thư viện
          allExts.forEach(item => {
            if (item && item.path && fs.existsSync(item.path)) {
              extPaths.push(item.path);
            }
          });
        }
      } catch(e){}
    }

    const loadExtArg = `--load-extension=${extPaths.join(',')}`;

    // Determine profile number (1, 2, 3...)
    let profileNum = profile.profileNum;
    if (!profileNum) {
      const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
      if (fs.existsSync(profilePath)) {
        try {
          const allProfiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
          const idx = allProfiles.findIndex(p => p.id === profile.id);
          if (idx >= 0) profileNum = idx + 1;
        } catch(e) {}
      }
    }
    if (!profileNum) {
      const match = (profile.name || '').match(/\d+/);
      profileNum = match ? parseInt(match[0]) : 1;
    }

    const profileIcon = generateProfileIcon(profileNum);
    const wmClass = process.platform === 'linux' ? createProfileDesktopFile(profile, profileNum, profileIcon.pngPath) : '';

    // Auto-calculate position on screen grid so windows don't overlap
    const runningCount = launchedBrowsers.size;
    const gridPos = calculateGridPosition(runningCount, runningCount + 1, profile.customWindow);

    // ── Kích thước cửa sổ VẬT LÝ = gridPos (nhỏ gọn, có thể resize tự do) ──
    // ── Viewport JS báo cho web    = device.viewport (cố định qua CDP)     ──
    const winW = gridPos.winW;  // kích thước cửa sổ thực tế (vd: 380)
    const winH = gridPos.winH;  // kích thước cửa sổ thực tế (vd: 675)

    // ── XÓA window_placement CŨ trong Preferences để Chrome không restore kích thước cũ ──
    // Chrome sẽ bỏ qua --window-size nếu Preferences đã lưu kích thước cũ
    try {
      const oldPrefsFile = path.join(profileDir, 'Default', 'Preferences');
      if (fs.existsSync(oldPrefsFile)) {
        const oldPrefs = JSON.parse(fs.readFileSync(oldPrefsFile, 'utf-8'));
        if (oldPrefs.browser) {
          delete oldPrefs.browser.window_placement;
          delete oldPrefs.browser.window_placement_is_maximized;
        }
        fs.writeFileSync(oldPrefsFile, JSON.stringify(oldPrefs, null, 2));
      }
    } catch(e) {}

    // Tạo debug port ngẫu nhiên để CDP kết nối sau khi Chrome khởi động
    const debugPort = getRandomDebugPort();

    // Build Chrome args với CDP remote debugging port
    const chromeArgs = [
      `--user-data-dir=${profileDir}`,
      `--user-agent=${profile.device.user_agent}`,
      `--lang=${profile.device.language || 'vi-VN'}`,
      `--window-position=${gridPos.posX},${gridPos.posY}`,
      `--window-size=${winW},${winH}`,
      loadExtArg,
      '--no-first-run',
      '--no-default-browser-check',
      '--touch-events=enabled',
      '--enable-touch-drag-drop',
      '--disable-blink-features=AutomationControlled',
      '--disable-pdf-extension',
      '--disable-plugins-discovery',
      '--disable-infobars',
      '--test-type',                          // ← ẩn thanh cảnh báo "cờ không được hỗ trợ"
      `--remote-debugging-port=${debugPort}`,
      `--remote-debugging-address=127.0.0.1`,
      `--remote-allow-origins=*`,
    ];

    // --no-sandbox chỉ cần trên Linux (trong Docker/Distrobox)
    // Trên Windows KHÔNG dùng — gây ra cảnh báo và không cần thiết
    if (process.platform === 'linux') {
      chromeArgs.push('--no-sandbox');
      chromeArgs.push('--disable-setuid-sandbox');
    }


    // Ghi kích thước cửa sổ vật lý vào Chromium Preferences
    setChromiumWindowPreferences(profileDir, gridPos.posX, gridPos.posY, winW, winH, profileNum, profile.name);

    if (process.platform === 'linux') {
      chromeArgs.unshift(`--class=${wmClass}`, `--name=${wmClass}`);
    }

    if (profile.device && profile.device.timezone) {
      chromeArgs.push(`--timezone-for-testing=${profile.device.timezone}`);
    }

    // ── Proxy ──
    // Nếu có user:pass: khởi động local proxy server trên 127.0.0.1:localPort
    // → Chrome chỉ thấy localhost, không bao giờ hiện popup 407.
    // Nếu không có auth: truyền thẳng upstream vào Chrome.
    if (profile.proxy && profile.proxy.host) {
      const pType = (profile.proxy.type || 'http').toLowerCase();
      if ((pType === 'http' || pType === 'https') && profile.proxy.user && profile.proxy.pass) {
        // HTTP proxy có auth → dùng local proxy
        try {
          const localPort = await startLocalProxy(
            profile.id,
            profile.proxy.host.trim(),
            profile.proxy.port || 8080,
            profile.proxy.user,
            profile.proxy.pass
          );
          chromeArgs.push(`--proxy-server=http://127.0.0.1:${localPort}`);
        } catch(e) {
          console.error('[LocalProxy] Không start được local proxy:', e.message);
          // Fallback: truyền thẳng
          const fullHost = `${profile.proxy.host.trim()}:${profile.proxy.port || 8080}`;
          chromeArgs.push(`--proxy-server=http://${fullHost}`);
        }
      } else {
        // SOCKS hoặc HTTP không có auth → truyền thẳng
        const fullHost = `${profile.proxy.host.trim()}:${profile.proxy.port || 8080}`;
        if (pType === 'socks5' || pType === 'socks4') {
          chromeArgs.push(`--proxy-server=${pType}://${fullHost}`);
        } else {
          chromeArgs.push(`--proxy-server=http://${fullHost}`);
        }
      }
      chromeArgs.push('--ignore-certificate-errors');
    }

    // Spawn Chrome với about:blank → CDP navigate đến URL thật sau
    chromeArgs.push('about:blank');

    // Find CloakHQ Stealth Chromium (Patched at C++ Engine Level) or system Chrome
    let cloakBin = null;
    const cloakDir = path.join(os.homedir(), '.cloakbrowser');
    if (fs.existsSync(cloakDir)) {
      try {
        const subdirs = fs.readdirSync(cloakDir);
        for (const sub of subdirs) {
          const exe = path.join(cloakDir, sub, 'chrome.exe');
          const linuxExe = path.join(cloakDir, sub, 'chrome');
          if (fs.existsSync(exe)) { cloakBin = exe; break; }
          if (fs.existsSync(linuxExe)) { cloakBin = linuxExe; break; }
        }
      } catch(e){}
    }

    const chromePaths = [
      cloakBin,
      'C:\\Program Files\\Opera\\launcher.exe',
      'C:\\Program Files (x86)\\Opera\\launcher.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs\\Opera\\launcher.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs\\Opera GX\\launcher.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      '/usr/bin/opera',
      '/snap/bin/opera',
      '/usr/local/bin/opera',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/brave-browser',
      '/snap/bin/chromium',
      '/usr/local/bin/chromium',
    ];
    const chromeBin = chromePaths.find(p => p && fs.existsSync(p));

    if (chromeBin === cloakBin && cloakBin) {
      console.log('[N/A Browser] 🥷 Using CloakHQ C++ Engine Patched Stealth Chromium:', chromeBin);
    } else {
      console.log('[N/A Browser] Using System Browser:', chromeBin);
    }

    if (!chromeBin) {
      return { ok: false, error: 'Chưa cài đặt Chromium/Chrome trên máy!' };
    }

    const proc = spawn(chromeBin, chromeArgs, { detached: true, stdio: 'ignore' });

    // Windows: Apply badged taskbar icon to Chrome window
    if (process.platform === 'win32' && proc.pid) {
      const applyScript = path.join(__dirname, 'apply_window_icon.ps1');
      if (fs.existsSync(applyScript)) {
        const { spawn: spawnBg } = require('child_process');
        spawnBg('powershell', [
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-File', applyScript,
          '-targetPid', String(proc.pid),
          '-icoPath', profileIcon.icoPath
        ], { detached: true, stdio: 'ignore' }).unref();
      }
    }

    return new Promise((resolve) => {
      proc.on('error', (err) => {
        console.error('[Browser Spawn Error]', err);
        resolve({ ok: false, error: err.message });
      });
      setTimeout(() => {
        proc.unref();
        launchedBrowsers.set(profile.id, { pid: proc.pid, startTime: Date.now(), debugPort });
        resolve({ ok: true, pid: proc.pid, debugPort });

        // ── CDP: apply emulation → navigate URL thật ──
        const targetUrl = profile.startUrl || 'https://bot.sannysoft.com';
        applyCDPDeviceEmulation(debugPort, profile.device, profile.proxy, winW, winH, targetUrl).catch(e => {
          console.error('[CDP Apply Error]', e.message);
        });
      }, 500);
    });
  } catch (err) {
    console.error('[Browser Launch Exception]', err);
    return { ok: false, error: err.message };
  }
});

// Close browser (đóng graceful qua CDP rồi mới force kill nếu cần)
ipcMain.handle('browser:close', async (event, profileId) => {
  try {
    await gracefulCloseProfile(profileId);
    return { ok: true };
  } catch (err) {
    console.error('[Close Browser Error]', err);
    return { ok: false, error: err.message };
  }
});

// Get running status
ipcMain.handle('browser:status', async () => {
  const result = {};
  for (const [id, info] of launchedBrowsers) {
    try {
      process.kill(info.pid, 0); // Check if alive
      result[id] = { running: true, pid: info.pid, startTime: info.startTime };
    } catch(e) {
      launchedBrowsers.delete(id);
      result[id] = { running: false };
    }
  }
  return result;
});

// ── Đóng Chrome đúng cách: dùng CDP Browser.close() trước, mới force kill ──
// Giống cách AdsPower/Hidemium đóng trình duyệt:
// 1. Kết nối CDP (nếu được)
// 2. Gọi Browser.close() → Chrome đóng toàn bộ tab + flush sớSession gracefully
// 3. Chờ tối đa 2s để Chrome tự thoát
// 4. Nếu vẫn còn → force kill (taskkill /F /T)

function saveProfileWebData(profileId, webData) {
  try {
    const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
    if (!fs.existsSync(profilePath)) return;
    let profiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    const p = profiles.find(x => x.id === profileId);
    if (p) {
      p.webData = webData;
      fs.writeFileSync(profilePath, JSON.stringify(profiles, null, 2), 'utf-8');
      if (supabaseManager && supabaseManager.currentUser) {
        supabaseManager.pushSingleProfile(p).then(() => {
          console.log(`[Cloud Sync] ☁️ Đã tự động đồng bộ Web Data của profile "${p.name}" lên Cloud!`);
        }).catch(e => console.warn('[Cloud Sync Error]', e.message));
      }
    }
  } catch (e) {
    console.error('[saveProfileWebData Error]', e);
  }
}

async function gracefulCloseProfile(profileId) {
  const info = launchedBrowsers.get(profileId);
  stopLocalProxy(profileId);

  if (info && info.pid && info.debugPort) {
    // Bước 1: Thử đóng graceful qua CDP
    try {
      const b = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${info.debugPort}`,
        defaultViewport: null,
      });

      // Trích xuất Cookies và dữ liệu web trước khi tắt
      try {
        const pages = await b.pages();
        if (pages.length > 0) {
          const client = await pages[0].createCDPSession();
          const { cookies } = await client.send('Network.getAllCookies');
          if (cookies && cookies.length > 0) {
            console.log(`[Sync] 🍪 Thu thập được ${cookies.length} cookies của profile ${profileId}`);
            saveProfileWebData(profileId, { cookies, updatedAt: Date.now() });
          }
        }
      } catch (errCookies) {
        console.warn(`[Sync] Không thể trích xuất cookies trước khi đóng: ${errCookies.message}`);
      }

      // Browser.close() ra lệnh cho Chrome tự đóng toàn bộ tab rồi thoát
      await b.close();
      console.log(`[Close] 🎯 CDP Browser.close() gửi tới profile ${profileId}`);
    } catch(e) {
      console.log(`[Close] CDP không kết nối được, sẽ force kill (${e.message})`);
    }

    // Bước 2: Chờ Chrome tự thoát (tối đa 2s)
    const isAlive = (pid) => {
      try { process.kill(pid, 0); return true; } catch(e) { return false; }
    };
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (!isAlive(info.pid)) {
        console.log(`[Close] ✅ Chrome tự thoát sau ${(i+1)*250}ms`);
        launchedBrowsers.delete(profileId);
        return;
      }
    }
  }

  // Bước 3: Force kill nếu vẫn tồn tại
  killProfileProcessTree(profileId);
}

function killProfileProcessTree(profileId) {
  const info = launchedBrowsers.get(profileId);
  if (info && info.pid) {
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        // taskkill /F /T diệt toàn bộ cây tiến trình (trình duyệt + tab + GPU + renderer)
        execSync(`taskkill /F /T /PID ${info.pid} 2>NUL || true`);
      } else {
        process.kill(info.pid, 'SIGKILL');
      }
    } catch(e){}
    launchedBrowsers.delete(profileId);
  }

  // Dọn dẹp triệt để tất cả các tiến trình trình duyệt ngầm bị kẹt theo profileId
  if (process.platform === 'win32' && profileId) {
    try {
      const { execSync } = require('child_process');
      const safeId = profileId.replace(/[^a-zA-Z0-9_-]/g, '');
      if (safeId) {
        // Tìm tất cả các tiến trình có command line chứa profileId và kill bằng PowerShell
        execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${safeId}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>NUL || true`);
      }
    } catch(e){}
  }
}

// Delete profile (Data file + disk directory)
ipcMain.handle('profile:delete', async (event, profileId) => {
  try {
    // 1. Đóng Chrome graceful (CDP Browser.close → chờ → force kill nếu cần)
    await gracefulCloseProfile(profileId);

    // 2. Chờ thêm 800ms để Windows xả File Lock
    await new Promise(resolve => setTimeout(resolve, 800));

    // 3. Xóa cấu hình trong profiles.json
    const profilesPath = path.join(APP_DATA_DIR, 'profiles.json');
    if (fs.existsSync(profilesPath)) {
      try {
        let profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));
        profiles = profiles.filter(p => p.id !== profileId);
        supabaseManager.deleteRemoteProfile(profileId).catch(()=>{});
        fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
      } catch(e){}
    }

    // 4. Xóa toàn bộ thư mục profile trên ổ đĩa
    const profileDir = path.join(APP_DATA_DIR, 'profiles', profileId);
    if (fs.existsSync(profileDir)) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch(e) {
        console.error('[rmSync retry failed, attempting cmd rmdir]', e);
      }

      // Nếu fs.rmSync vẫn chưa xóa được hoàn toàn (do tệp bị lock), dùng rmdir của Windows CMD với đường dẫn chuẩn hóa
      if (fs.existsSync(profileDir)) {
        if (process.platform === 'win32') {
          try {
            const { execSync } = require('child_process');
            const winNormalizedPath = path.normalize(profileDir).replace(/\//g, '\\');
            execSync(`cmd /c rmdir /s /q "${winNormalizedPath}"`);
          } catch(e) {
            console.error('[cmd rmdir error]', e);
          }
        }
      }
    }

    try {
      const desktopFile = path.join(os.homedir(), '.local/share/applications', `na-profile-${profileId}.desktop`);
      if (fs.existsSync(desktopFile)) fs.unlinkSync(desktopFile);
    } catch(e){}

    return { ok: true };
  } catch(err) {
    console.error('[Delete Profile Error]', err);
    return { ok: false, error: err.message };
  }
});

// Clear profile cache & browsing data on disk
ipcMain.handle('profile:clearCache', async (event, profileId) => {
  try {
    await gracefulCloseProfile(profileId);
    await new Promise(resolve => setTimeout(resolve, 600));

    const profileDir = path.join(APP_DATA_DIR, 'profiles', profileId);
    if (fs.existsSync(profileDir)) {
      const foldersToDelete = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Storage', 'Local Storage', 'IndexedDB', 'Cookies', 'Cookies-journal', 'Web Data'];
      const defaultDir = path.join(profileDir, 'Default');
      
      foldersToDelete.forEach(item => {
        const itemPath = path.join(profileDir, item);
        const defaultItemPath = path.join(defaultDir, item);
        if (fs.existsSync(itemPath)) {
          try { fs.rmSync(itemPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch(e){}
        }
        if (fs.existsSync(defaultItemPath)) {
          try { fs.rmSync(defaultItemPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch(e){}
        }
      });
    }

    return { ok: true };
  } catch(err) {
    console.error('[Clear Profile Cache Error]', err);
    return { ok: false, error: err.message };
  }
});

// Save script to file
ipcMain.handle('script:save', async (event, { content, filename }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: filename,
    filters: [{ name: 'Python', extensions: ['py'] }],
  });
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { ok: true, path: result.filePath };
  }
  return { ok: false };
});

// Open external URL
ipcMain.on('shell:open', (event, url) => shell.openExternal(url));

// Get app info
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  userData: APP_DATA_DIR,
  node: process.versions.node,
  electron: process.versions.electron,
}));

// ── Generate fingerprint injection script (Stealth Native Patch) ──
function generateFingerprintScript(device) {
  const tz = device.timezone || 'Asia/Ho_Chi_Minh';
  const touchPoints = device.max_touch_points || 10;
  const renderer = device.webgl_renderer || 'Adreno (TM) 650';
  const vendor = device.webgl_vendor || 'Qualcomm';

  return `(function() {
  'use strict';

  // ── STEALTH NATIVE FUNCTION MASKING ──
  // Che giấu dấu vết Function override để vượt qua kiểm tra toString() & Proxy detection của Anti-bot
  const nativeToStrings = new WeakMap();
  const _origToString = Function.prototype.toString;

  function makeNative(fn, name) {
    const fnName = name || fn.name || '';
    const str = 'function ' + fnName + '() { [native code] }';
    nativeToStrings.set(fn, str);
    try {
      Object.defineProperty(fn, 'name', { value: fnName, configurable: true });

// --- Hot-Patch & OTA Auto-Updater IPC ---
const PATCHES_DIR = path.join(APP_DATA_DIR, 'patches');
const PATCH_INFO_FILE = path.join(PATCHES_DIR, 'patch_info.json');

ipcMain.handle('updater:getPatchInfo', async () => {
  const currentPatch = fs.existsSync(PATCH_INFO_FILE) ? JSON.parse(fs.readFileSync(PATCH_INFO_FILE, 'utf-8')) : null;
  return {
    appVersion: app.getVersion(),
    hasPatch: fs.existsSync(path.join(APP_DATA_DIR, 'patches', 'renderer', 'index.html')),
    currentPatch: currentPatch,
    patchesDir: PATCHES_DIR
  };
});

ipcMain.handle('updater:checkPatch', async (event, customUrl) => {
  try {
    const settingsPath = path.join(APP_DATA_DIR, 'settings.json');
    let manifestUrl = customUrl;
    if (!manifestUrl && fs.existsSync(settingsPath)) {
      try {
        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        manifestUrl = s.updateManifestUrl;
      } catch(e) {}
    }

    if (!manifestUrl) {
      const localManifest = path.join(APP_DATA_DIR, 'update_manifest.json');
      if (fs.existsSync(localManifest)) {
        const data = JSON.parse(fs.readFileSync(localManifest, 'utf-8'));
        return { ok: true, source: 'local', ...data };
      }
      return { ok: false, error: 'Chưa cấu hình đường dẫn máy chủ kiểm tra bản vá (Update URL)!' };
    }

    const resp = await fetch(manifestUrl, { headers: { 'Cache-Control': 'no-cache' } });
    if (!resp.ok) return { ok: false, error: 'Máy chủ phản hồi mã lỗi HTTP: ' + resp.status };
    const manifest = await resp.json();
    return { ok: true, source: 'remote', ...manifest };
  } catch (err) {
    return { ok: false, error: 'Không thể kết nối máy chủ kiểm tra bản vá: ' + err.message };
  }
});

ipcMain.handle('updater:applyPatch', async (event, patchData) => {
  try {
    if (!patchData || !Array.isArray(patchData.files) || patchData.files.length === 0) {
      return { ok: false, error: 'Dữ liệu bản vá không hợp lệ hoặc danh sách file rỗng!' };
    }

    const targetRendererDir = path.join(APP_DATA_DIR, 'patches', 'renderer');
    fs.mkdirSync(targetRendererDir, { recursive: true });

    // Copy base renderer files if not existing in patches dir yet
    const baseRendererDir = path.join(__dirname, 'src', 'renderer');
    if (fs.existsSync(baseRendererDir)) {
      const baseFiles = fs.readdirSync(baseRendererDir);
      for (const bf of baseFiles) {
        const dest = path.join(targetRendererDir, bf);
        const src = path.join(baseRendererDir, bf);
        if (!fs.existsSync(dest) && fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dest);
        }
      }
    }

    // Download/write each patch file
    for (const f of patchData.files) {
      const destPath = path.join(targetRendererDir, f.filename);
      if (f.content) {
        fs.writeFileSync(destPath, f.content, 'utf-8');
      } else if (f.url) {
        const fileResp = await fetch(f.url, { headers: { 'Cache-Control': 'no-cache' } });
        if (!fileResp.ok) throw new Error('Lỗi tải file ' + f.filename + ': HTTP ' + fileResp.status);
        const text = await fileResp.text();
        fs.writeFileSync(destPath, text, 'utf-8');
      }
    }

    // Save patch_info.json
    const info = {
      patchNumber: patchData.patchNumber || 1,
      version: patchData.version || app.getVersion(),
      title: patchData.title || 'Bản vá cập nhật',
      changelog: patchData.changelog || '',
      appliedAt: new Date().toISOString()
    };
    fs.writeFileSync(PATCH_INFO_FILE, JSON.stringify(info, null, 2), 'utf-8');

    return { ok: true, message: 'Đã áp dụng bản vá thành công!' };
  } catch (err) {
    return { ok: false, error: 'Áp dụng bản vá thất bại: ' + err.message };
  }
});

ipcMain.handle('updater:relaunch', async () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('updater:resetPatches', async () => {
  try {
    if (fs.existsSync(PATCHES_DIR)) {
      fs.rmSync(PATCHES_DIR, { recursive: true, force: true });
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      const origHtml = path.join(__dirname, 'src', 'renderer', 'index.html');
      mainWindow.loadFile(origHtml);
    }
    return { ok: true, message: 'Đã khôi phục về bản gốc của phần mềm!' };
  } catch(err) {
    return { ok: false, error: err.message };
  }
});

    } catch(e){}
    return fn;
  }

  Function.prototype.toString = function() {
    if (nativeToStrings.has(this)) {
      return nativeToStrings.get(this);
    }
    return _origToString.call(this);
  };
  nativeToStrings.set(Function.prototype.toString, 'function toString() { [native code] }');

  const navProto = Object.getPrototypeOf(navigator) || Navigator.prototype;
  const screenProto = Object.getPrototypeOf(screen) || Screen.prototype;

  // 1. HIDDEN WEBDRIVER ➔ Xóa sạch cờ navigator.webdriver (Native Getter)
  try {
    delete navProto.webdriver;
    delete navigator.webdriver;
    const getWebdriver = makeNative(function webdriver() { return false; }, 'get webdriver');
    Object.defineProperty(navProto, 'webdriver', {
      get: getWebdriver,
      configurable: true,
      enumerable: true
    });
  } catch(e){}

  // 2. NAVIGATOR PLATFORM ➔ Linux armv8l (Native Getter)
  try {
    delete navProto.platform;
    delete navigator.platform;
    const getPlatform = makeNative(function platform() { return 'Linux armv8l'; }, 'get platform');
    Object.defineProperty(navProto, 'platform', { get: getPlatform, configurable: true, enumerable: true });
    Object.defineProperty(navigator, 'platform', { get: getPlatform, configurable: true, enumerable: true });
  } catch(e){}

  // 3. MAX TOUCH POINTS ➔ 10 / 5 (Native Getter)
  try {
    delete navProto.maxTouchPoints;
    delete navigator.maxTouchPoints;
    const getTouch = makeNative(function maxTouchPoints() { return ${touchPoints}; }, 'get maxTouchPoints');
    Object.defineProperty(navProto, 'maxTouchPoints', { get: getTouch, configurable: true, enumerable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: getTouch, configurable: true, enumerable: true });
  } catch(e){}

  // 4. WEBGL VENDOR & RENDERER (Patch cả getParameter lẫn getExtension WEBGL_debug_renderer_info)
  try {
    const patchGL = (glProto) => {
      if (!glProto || !glProto.prototype) return;
      const _origGetParam = glProto.prototype.getParameter;
      const _origGetExt = glProto.prototype.getExtension;

      const patchedGetParam = makeNative(function getParameter(param) {
        if (param === 37445 || param === 0x9245) return '${renderer}'; // UNMASKED_RENDERER_WEBGL
        if (param === 37444 || param === 0x9244) return '${vendor}';   // UNMASKED_VENDOR_WEBGL
        if (param === 7936  || param === 0x1F00) return 'WebKit';
        if (param === 7937  || param === 0x1F01) return 'WebKit WebGL';
        return _origGetParam.call(this, param);
      }, 'getParameter');

      glProto.prototype.getParameter = patchedGetParam;

      const patchedGetExt = makeNative(function getExtension(name) {
        const ext = _origGetExt.call(this, name);
        if (name === 'WEBGL_debug_renderer_info' && ext) {
          return new Proxy(ext, {
            get(target, prop) {
              if (prop === 'UNMASKED_RENDERER_WEBGL') return 37445;
              if (prop === 'UNMASKED_VENDOR_WEBGL') return 37444;
              return Reflect.get(target, prop);
            }
          });
        }
        return ext;
      }, 'getExtension');

      glProto.prototype.getExtension = patchedGetExt;
    };

    if (window.WebGLRenderingContext) patchGL(WebGLRenderingContext);
    if (window.WebGL2RenderingContext) patchGL(WebGL2RenderingContext);
  } catch(e){}

  // 5. PLUGINS & MIMETYPES ➔ Length = 0 (Native Getter)
  try {
    const emptyPlugins = Object.create(PluginArray.prototype);
    Object.defineProperty(emptyPlugins, 'length', {
      get: makeNative(function length() { return 0; }, 'get length'),
      configurable: true, enumerable: true
    });

    const getPlugins = makeNative(function plugins() { return emptyPlugins; }, 'get plugins');
    Object.defineProperty(navProto, 'plugins', { get: getPlugins, configurable: true, enumerable: true });
    Object.defineProperty(navigator, 'plugins', { get: getPlugins, configurable: true, enumerable: true });

    const emptyMimeTypes = Object.create(MimeTypeArray.prototype);
    Object.defineProperty(emptyMimeTypes, 'length', {
      get: makeNative(function length() { return 0; }, 'get length'),
      configurable: true, enumerable: true
    });

    const getMimeTypes = makeNative(function mimeTypes() { return emptyMimeTypes; }, 'get mimeTypes');
    Object.defineProperty(navProto, 'mimeTypes', { get: getMimeTypes, configurable: true, enumerable: true });
    Object.defineProperty(navigator, 'mimeTypes', { get: getMimeTypes, configurable: true, enumerable: true });
  } catch(e){}

  // 6. SCREEN & WINDOW METRICS (Native Getter Override)
  // Chú ý: KHÔNG override window.innerWidth/outerWidth — CDP setDeviceMetricsOverride
  // đã báo giá trị đúng bằng vùng hiển thị thật của cửa sổ rồi (responsive).
  // Override cứng ở đây sẽ phá vỡ layout khi người dùng resize cửa sổ.
  try {
    const patchMetric = (target, prop, val, name) => {
      try {
        delete target[prop];
        const getter = makeNative(function() { return val; }, name || ('get ' + prop));
        Object.defineProperty(target, prop, { get: getter, configurable: true, enumerable: true });
      } catch(err){}
    };

    patchMetric(window, 'devicePixelRatio', ${device.device_scale_factor || 3.0}, 'get devicePixelRatio');
  } catch(e){}

  // 7. BATTERY & HARDWARE METRICS
  try {
    patchMetric(navProto, 'deviceMemory', 8, 'get deviceMemory');
    patchMetric(navigator, 'deviceMemory', 8, 'get deviceMemory');
    patchMetric(navProto, 'hardwareConcurrency', 8, 'get hardwareConcurrency');
    patchMetric(navigator, 'hardwareConcurrency', 8, 'get hardwareConcurrency');

    if (navigator.getBattery) {
      navigator.getBattery = makeNative(function getBattery() {
        return Promise.resolve({
          charging: false, chargingTime: Infinity, dischargingTime: 14400, level: 0.75,
          addEventListener: () => {}, removeEventListener: () => {}
        });
      }, 'getBattery');
    }
  } catch(e){}

  // 8. TIMEZONE OVERRIDE
  try {
    const _resOpt = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = makeNative(function resolvedOptions() {
      const o = _resOpt.call(this);
      o.timeZone = '${tz}';
      return o;
    }, 'resolvedOptions');
  } catch(e){}

  // 9. GEOLOCATION OVERRIDE
  ${device.geo ? `
  try {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = makeNative(function getCurrentPosition(cb) {
        if (typeof cb === 'function') {
          cb({
            coords: {
              latitude: ${device.geo.lat},
              longitude: ${device.geo.lng},
              accuracy: 18,
              altitude: null, altitudeAccuracy: null, heading: null, speed: null
            },
            timestamp: Date.now()
          });
        }
      }, 'getCurrentPosition');
    }
  } catch(e){}
  ` : ''}

  console.log('[N/A Browser] 🥷 Stealth Native-Masked Mobile Fingerprint Applied: ${device.name}');
})();`;
}


// ══════════════════════════════════════════════════════════════════
// ── HTTP REST API Server (built-in http — không cần Express) ──────
// Endpoint: http://127.0.0.1:9399/api/...
// ══════════════════════════════════════════════════════════════════

const API_PORT = 9399;
let apiServer = null;

// ── Helpers ──────────────────────────────────────────────────────

function loadProfilesFromDisk() {
  const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
  if (!fs.existsSync(profilePath)) return [];
  try { return JSON.parse(fs.readFileSync(profilePath, 'utf-8')); } catch(e) { return []; }
}

function saveProfilesToDisk(profiles) {
  const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
  fs.writeFileSync(profilePath, JSON.stringify(profiles, null, 2));
}

function loadDevicesFromDisk() {
  try {
    const devPath = path.join(__dirname, 'src/devices.json');
    const raw = JSON.parse(fs.readFileSync(devPath, 'utf-8'));
    // devices.json có thể là { devices: [...] } hoặc trực tiếp [...]
    return Array.isArray(raw) ? raw : (raw.devices || []);
  } catch(e) { return []; }
}

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) reject(new Error('Body quá lớn')); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch(e) { reject(new Error('JSON không hợp lệ')); }
    });
    req.on('error', reject);
  });
}

// VN Cities giống renderer (copy minimal set để dùng độc lập)
const VN_CITIES_API = {
  hcm:   { name: 'Hồ Chí Minh', lat: 10.8231, lng: 106.6297 },
  hn:    { name: 'Hà Nội',       lat: 21.0285, lng: 105.8542 },
  dn:    { name: 'Đà Nẵng',      lat: 16.0471, lng: 108.2068 },
  ct:    { name: 'Cần Thơ',      lat: 10.0452, lng: 105.7469 },
  hp:    { name: 'Hải Phòng',    lat: 20.8449, lng: 106.6881 },
  bd:    { name: 'Bình Dương',   lat: 11.3254, lng: 106.4770 },
  bn:    { name: 'Bắc Ninh',     lat: 21.1861, lng: 106.0763 },
  hue:   { name: 'Huế',          lat: 16.4637, lng: 107.5909 },
  vt:    { name: 'Vũng Tàu',     lat: 10.4113, lng: 107.1362 },
  qn:    { name: 'Quảng Ninh',   lat: 21.0064, lng: 107.2925 },
};

// ── Route Handler ─────────────────────────────────────────────────

async function handleApiRequest(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${API_PORT}`);
  const pathname = url.pathname;
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // ── GET /api/profiles ── lấy danh sách tất cả profile
  if (method === 'GET' && pathname === '/api/profiles') {
    const profiles = loadProfilesFromDisk();
    return sendJSON(res, 200, { ok: true, total: profiles.length, profiles });
  }

  // ── GET /api/profiles/:id ── lấy 1 profile theo id
  const matchSingle = pathname.match(/^\/api\/profiles\/([^/]+)$/);
  if (method === 'GET' && matchSingle) {
    const id = matchSingle[1];
    const profiles = loadProfilesFromDisk();
    const profile = profiles.find(p => p.id === id);
    if (!profile) return sendJSON(res, 404, { ok: false, error: `Profile "${id}" không tồn tại.` });
    return sendJSON(res, 200, { ok: true, profile });
  }

  // ── POST /api/profiles ── tạo mới profile
  if (method === 'POST' && pathname === '/api/profiles') {
    let body;
    try { body = await readBody(req); } catch(e) { return sendJSON(res, 400, { ok: false, error: e.message }); }

    const { name, deviceId, proxy, cityKey, startUrl, notes, customWindow, selectedExtensions } = body;

    // Validation
    if (!name || typeof name !== 'string' || !name.trim()) {
      return sendJSON(res, 400, { ok: false, error: 'Thiếu trường "name" (tên profile).' });
    }

    // Chọn device
    const devices = loadDevicesFromDisk();
    let chosenDevice = null;
    if (deviceId) {
      chosenDevice = devices.find(d => d.id === deviceId);
      if (!chosenDevice) return sendJSON(res, 400, { ok: false, error: `Không tìm thấy device id="${deviceId}".` });
    } else {
      chosenDevice = devices[Math.floor(Math.random() * devices.length)];
    }
    if (!chosenDevice) return sendJSON(res, 400, { ok: false, error: 'Không có device nào trong hệ thống.' });

    // Chọn thành phố
    const cityKeys = Object.keys(VN_CITIES_API);
    let resolvedCityKey = cityKey;
    if (!cityKey || cityKey === 'random' || !VN_CITIES_API[cityKey]) {
      resolvedCityKey = cityKeys[Math.floor(Math.random() * cityKeys.length)];
    }
    const cityInfo = VN_CITIES_API[resolvedCityKey] || VN_CITIES_API.hcm;

    // Xử lý proxy
    let parsedProxy = null;
    if (proxy) {
      if (typeof proxy === 'string') {
        // Hỗ trợ format: "host:port:user:pass" hoặc "type://user:pass@host:port" hoặc "host:port"
        const proxyStr = proxy.trim();
        const urlMatch = proxyStr.match(/^(https?|socks5?):\/\/(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)/i);
        if (urlMatch) {
          parsedProxy = { type: urlMatch[1], user: urlMatch[2] || '', pass: urlMatch[3] || '', host: urlMatch[4], port: parseInt(urlMatch[5]) };
        } else {
          const parts = proxyStr.split(':');
          if (parts.length >= 2) {
            parsedProxy = { type: 'http', host: parts[0], port: parseInt(parts[1]) || 80, user: parts[2] || '', pass: parts[3] || '' };
          }
        }
      } else if (typeof proxy === 'object' && proxy.host) {
        parsedProxy = {
          type: proxy.type || 'http',
          host: proxy.host,
          port: parseInt(proxy.port) || 80,
          user: proxy.user || '',
          pass: proxy.pass || '',
        };
      }
    }

    // Tạo profile
    const newProfile = {
      id: require('crypto').randomUUID(),
      name: name.trim(),
      deviceId: chosenDevice.id,
      proxy: parsedProxy,
      cityKey: resolvedCityKey,
      cityName: cityInfo.name,
      geo: { lat: cityInfo.lat, lng: cityInfo.lng },
      timezone: 'Asia/Ho_Chi_Minh',
      language: 'vi-VN',
      selectedExtensions: Array.isArray(selectedExtensions) ? selectedExtensions : [],
      customWindow: customWindow || null,
      startUrl: (startUrl || '').trim(),
      notes: (notes || '').trim(),
      createdAt: Date.now(),
    };

    const profiles = loadProfilesFromDisk();
    profiles.push(newProfile);
    saveProfilesToDisk(profiles);

    // Notify renderer để UI tự reload nếu đang mở
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('profiles:reload');
    }

    console.log(`[API] ✅ Tạo profile: "${newProfile.name}" | device: ${chosenDevice.name} | city: ${cityInfo.name}`);
    return sendJSON(res, 201, { ok: true, message: 'Profile đã được tạo thành công.', profile: newProfile });
  }

  // ── DELETE /api/profiles/:id ── xóa profile theo id
  if (method === 'DELETE' && matchSingle) {
    const id = matchSingle[1];
    let profiles = loadProfilesFromDisk();
    const target = profiles.find(p => p.id === id);
    if (!target) return sendJSON(res, 404, { ok: false, error: `Profile "${id}" không tồn tại.` });

    profiles = profiles.filter(p => p.id !== id);
    saveProfilesToDisk(profiles);

    // Xóa thư mục data của profile nếu tồn tại
    const profileDir = path.join(APP_DATA_DIR, 'profiles', id);
    if (fs.existsSync(profileDir)) {
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch(e) { console.warn('[API] Không xóa được thư mục:', e.message); }
    }

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('profiles:reload');
    }

    console.log(`[API] 🗑️ Đã xóa profile: "${target.name}" (${id})`);
    return sendJSON(res, 200, { ok: true, message: `Profile "${target.name}" đã được xóa.`, id });
  }

  // ── POST /api/profiles/:id/launch ── khởi động browser cho profile
  const matchLaunch = pathname.match(/^\/api\/profiles\/([^/]+)\/launch$/);
  if (method === 'POST' && matchLaunch) {
    const id = matchLaunch[1];
    const profiles = loadProfilesFromDisk();
    const profile = profiles.find(p => p.id === id);
    if (!profile) return sendJSON(res, 404, { ok: false, error: `Profile "${id}" không tồn tại.` });

    // Nếu đã đang chạy, trả về info luôn
    const existing = launchedBrowsers.get(id);
    if (existing) {
      try {
        process.kill(existing.pid, 0);
        return sendJSON(res, 200, { ok: true, pid: existing.pid, debugPort: existing.debugPort, message: 'Đã đang chạy.' });
      } catch(e) {
        launchedBrowsers.delete(id);
      }
    }

    try {
      const { spawn } = require('child_process');
      const devices = loadDevicesFromDisk();

      // Lấy device — devices.json trả về { devices: [...] } hoặc [...]
      const deviceList = Array.isArray(devices) ? devices : (devices.devices || []);
      const device = deviceList.find(d => d.id === profile.deviceId) || deviceList[0];
      if (!device) return sendJSON(res, 500, { ok: false, error: 'Không tìm thấy device.' });

      const profileDir = path.join(APP_DATA_DIR, 'profiles', id);
      fs.mkdirSync(profileDir, { recursive: true });

      // Fingerprint extension
      const injectScript = generateFingerprintScript(device);
      const extDir = path.join(profileDir, 'cloak_ext');
      fs.mkdirSync(extDir, { recursive: true });

      const manifestJson = {
        manifest_version: 2,
        name: `NA Stealth ${id}`,
        version: '1.0.0',
        permissions: ['<all_urls>'],
        content_scripts: [{ matches: ['<all_urls>'], js: ['inject.js'], run_at: 'document_start', all_frames: true }]
      };

      // ── Proxy Auth Extension (webRequest MV2 blocking) ──
      if (profile.proxy && profile.proxy.user && profile.proxy.pass) {
        manifestJson.permissions = ['webRequest', 'webRequestBlocking', '<all_urls>'];
        manifestJson.background = { scripts: ['background.js'] };
        const bgJs = `
chrome.webRequest.onAuthRequired.addListener(
  function(details) {
    return {
      authCredentials: {
        username: ${JSON.stringify(profile.proxy.user)},
        password: ${JSON.stringify(profile.proxy.pass)}
      }
    };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);
`;
        fs.writeFileSync(path.join(extDir, 'background.js'), bgJs);
      }

      fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifestJson, null, 2));
      fs.writeFileSync(path.join(extDir, 'inject.js'), injectScript);

      const extPaths = [extDir];

      // Tính vị trí cửa sổ
      const runningCount = launchedBrowsers.size;
      const gridPos = calculateGridPosition(runningCount, runningCount + 1, profile.customWindow);
      setChromiumWindowPreferences(profileDir, gridPos.posX, gridPos.posY, gridPos.winW, gridPos.winH);

      const debugPort = getRandomDebugPort();
      const startUrl = profile.startUrl || 'https://bot.sannysoft.com';

      // Tìm Chrome binary
      const cloakDir = path.join(os.homedir(), '.cloakbrowser');
      let cloakBin = null;
      if (fs.existsSync(cloakDir)) {
        try {
          for (const sub of fs.readdirSync(cloakDir)) {
            const exe = path.join(cloakDir, sub, 'chrome.exe');
            const lin = path.join(cloakDir, sub, 'chrome');
            if (fs.existsSync(exe)) { cloakBin = exe; break; }
            if (fs.existsSync(lin)) { cloakBin = lin; break; }
          }
        } catch(e){}
      }
      const chromePaths = [
        cloakBin,
        'C:\\Program Files\\Opera\\launcher.exe',
        'C:\\Program Files (x86)\\Opera\\launcher.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Programs\\Opera\\launcher.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs\\Opera GX\\launcher.exe'),
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        '/usr/bin/opera', '/snap/bin/opera', '/usr/bin/chromium',
        '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
      ];
      const chromeBin = chromePaths.find(p => p && fs.existsSync(p));
      if (!chromeBin) return sendJSON(res, 500, { ok: false, error: 'Chưa cài Chrome/Chromium!' });

      const args = [
        `--user-data-dir=${profileDir}`,
        `--user-agent=${device.user_agent || ''}`,
        `--lang=${device.language || 'vi-VN'}`,
        `--window-position=${gridPos.posX},${gridPos.posY}`,
        `--window-size=${gridPos.winW},${gridPos.winH}`,
        `--load-extension=${extPaths.join(',')}`,
        '--no-first-run', '--no-default-browser-check',
        '--touch-events=enabled', '--enable-touch-drag-drop',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars', '--test-type',
        `--remote-debugging-port=${debugPort}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-allow-origins=*',
        'about:blank', // Luôn spawn với about:blank → CDP navigate đến URL thật sau khi proxy auth sẵn sàng
      ];
      if (process.platform === 'linux') { args.push('--no-sandbox', '--disable-setuid-sandbox'); }

      // ── Proxy Server Arg ──
      if (profile.proxy && profile.proxy.host) {
        const pType = (profile.proxy.type || 'http').toLowerCase();
        if ((pType === 'http' || pType === 'https') && profile.proxy.user && profile.proxy.pass) {
          // HTTP proxy có auth → dùng local proxy
          try {
            const localPort = await startLocalProxy(
              id,
              profile.proxy.host.trim(),
              profile.proxy.port || 8080,
              profile.proxy.user,
              profile.proxy.pass
            );
            args.push(`--proxy-server=http://127.0.0.1:${localPort}`);
          } catch(e) {
            console.error('[API LocalProxy] Không start được local proxy:', e.message);
            const fullHost = `${profile.proxy.host.trim()}:${profile.proxy.port || 8080}`;
            args.push(`--proxy-server=http://${fullHost}`);
          }
        } else {
          const fullHost = `${profile.proxy.host.trim()}:${profile.proxy.port || 8080}`;
          if (pType === 'socks5' || pType === 'socks4') {
            args.push(`--proxy-server=${pType}://${fullHost}`);
          } else {
            args.push(`--proxy-server=http://${fullHost}`);
          }
        }
        args.push('--ignore-certificate-errors');
      }

      const proc = spawn(chromeBin, args, { detached: true, stdio: 'ignore' });

      await new Promise(resolve => {
        proc.on('error', (err) => {
          console.error('[API Launch Error]', err);
          sendJSON(res, 500, { ok: false, error: err.message });
          resolve();
        });
        setTimeout(() => {
          proc.unref();
          launchedBrowsers.set(id, { pid: proc.pid, startTime: Date.now(), debugPort });
          // CDP: setup proxy auth → apply emulation → navigate URL thật
          applyCDPDeviceEmulation(debugPort, device, profile.proxy, gridPos.winW, gridPos.winH, startUrl).catch(e => {});
          // Notify renderer UI
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('profiles:reload');
          console.log(`[API] 🚀 Launched profile "${profile.name}" PID=${proc.pid} debugPort=${debugPort}`);
          sendJSON(res, 200, { ok: true, pid: proc.pid, debugPort, profileId: id, profileName: profile.name });
          resolve();
        }, 600);
      });
      return;
    } catch(err) {
      console.error('[API Launch Exception]', err);
      return sendJSON(res, 500, { ok: false, error: err.message });
    }
  }

  // ── POST /api/profiles/:id/stop ── dừng browser
  const matchStop = pathname.match(/^\/api\/profiles\/([^/]+)\/stop$/);
  if (method === 'POST' && matchStop) {
    const id = matchStop[1];
    stopLocalProxy(id); // Dừng local proxy server nếu có
    killProfileProcessTree(id);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('profiles:reload');
    return sendJSON(res, 200, { ok: true, message: `Profile ${id} đã dừng.` });
  }

  // ── GET /api/devices ── lấy danh sách device
  if (method === 'GET' && pathname === '/api/devices') {
    const devices = loadDevicesFromDisk();
    return sendJSON(res, 200, { ok: true, total: devices.length, devices });
  }

  // ── GET /api/status ── kiểm tra server sống
  if (method === 'GET' && pathname === '/api/status') {
    const profiles = loadProfilesFromDisk();
    return sendJSON(res, 200, {
      ok: true,
      app: 'N/A Browser API',
      version: '1.0.0',
      port: API_PORT,
      profiles_count: profiles.length,
      running_count: getRunningProfilesCount(),
      timestamp: new Date().toISOString(),
    });
  }

  // 404 fallback
  return sendJSON(res, 404, { ok: false, error: `Endpoint "${method} ${pathname}" không tồn tại.` });
}

// ── Khởi động API server ──────────────────────────────────────────

function startApiServer() {
  apiServer = http.createServer((req, res) => {
    handleApiRequest(req, res).catch(err => {
      console.error('[API Server Error]', err);
      sendJSON(res, 500, { ok: false, error: 'Lỗi server nội bộ: ' + err.message });
    });
  });

  apiServer.listen(API_PORT, '127.0.0.1', () => {
    console.log(`[API] 🚀 HTTP REST API Server đang chạy tại: http://127.0.0.1:${API_PORT}`);
    console.log(`[API]    GET    http://127.0.0.1:${API_PORT}/api/status`);
    console.log(`[API]    GET    http://127.0.0.1:${API_PORT}/api/profiles`);
    console.log(`[API]    POST   http://127.0.0.1:${API_PORT}/api/profiles`);
    console.log(`[API]    DELETE http://127.0.0.1:${API_PORT}/api/profiles/:id`);
    console.log(`[API]    GET    http://127.0.0.1:${API_PORT}/api/devices`);
  });

  apiServer.on('error', (err) => {
    console.error(`[API] ❌ Lỗi khởi động API server port ${API_PORT}:`, err.message);
  });
}

// Khởi động API khi Electron app sẵn sàng
app.whenReady().then(() => {
  startApiServer();
});

// Đóng API server khi app thoát
app.on('before-quit', () => {
  if (apiServer) {
    apiServer.close(() => console.log('[API] Server đã đóng.'));
  }
});
