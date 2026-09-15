const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const zlib = require('zlib');
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

// ── CDP Cookie Sanitizer Helper ──
// Loại bỏ các trường không hợp lệ mà Chrome DevTools Protocol từ chối trong Network.setCookies (size, session, expires <= 0)
function sanitizeCookiesForCDP(rawCookies) {
  if (!Array.isArray(rawCookies)) return [];
  return rawCookies.map(c => {
    const clean = {
      name: String(c.name || '').trim(),
      value: String(c.value || ''),
      path: c.path || '/'
    };
    if (c.domain) clean.domain = c.domain;
    if (c.url) clean.url = c.url;
    if (typeof c.secure === 'boolean') clean.secure = c.secure;
    if (typeof c.httpOnly === 'boolean') clean.httpOnly = c.httpOnly;
    if (c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite)) {
      clean.sameSite = c.sameSite;
    }
    if (typeof c.expires === 'number' && c.expires > 0) {
      clean.expires = Math.floor(c.expires);
    }
    if (c.priority && ['Low', 'Medium', 'High'].includes(c.priority)) {
      clean.priority = c.priority;
    }
    return clean;
  }).filter(c => c.name && (c.domain || c.url));
}

// ── CDP Device Emulation Helper ──
// startUrl: URL thật để navigate SAU KHI proxy auth đã được thiết lập.
// Chrome được spawn với about:blank, sau đó CDP navigate đến startUrl.
// Cách này đảm bảo Fetch.authRequired handler sẵn sàng TRƯỚC khi Chrome tải bất kỳ request nào qua proxy.
async function applyCDPDeviceEmulation(debugPort, device, proxy = null, winW = 380, winH = 675, startUrl = null, profile = null) {
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
      let targetProfile = profile;
      if (profile && profile.id) {
        const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
        if (fs.existsSync(profilePath)) {
          const all = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
          const found = all.find(x => x.id === profile.id);
          if (found) targetProfile = found;
        }
      }
      if (targetProfile && targetProfile.webData && Array.isArray(targetProfile.webData.cookies) && targetProfile.webData.cookies.length > 0) {
        await client.send('Network.enable');
        const cleanCookies = sanitizeCookiesForCDP(targetProfile.webData.cookies);
        if (cleanCookies.length > 0) {
          await client.send('Network.setCookies', { cookies: cleanCookies });
          console.log(`[CDP] 🍪 Đã khôi phục thành công ${cleanCookies.length}/${targetProfile.webData.cookies.length} cookies từ Cloud cho profile "${targetProfile.name || targetProfile.id}"!`);
        }
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
    // Máy chủ Cloud là nguồn chân lý duy nhất:
    // Profile nào đã bị máy chính xóa thì Cloud không có -> máy phụ cũng xóa sạch ngay lập tức!
    let remoteProfiles = result.profiles || [];

    // ── Trash Filter: Bỏ qua các profile đang trong Thùng Rác (đã xóa cục bộ, chưa xóa Cloud)
    try {
      const trashPath = path.join(APP_DATA_DIR, 'trash.json');
      if (fs.existsSync(trashPath)) {
        const trashItems = JSON.parse(fs.readFileSync(trashPath, 'utf-8'));
        const trashIds = new Set(trashItems.map(t => String(t.id)));
        const beforeCount = remoteProfiles.length;
        remoteProfiles = remoteProfiles.filter(p => !trashIds.has(String(p.id)));
        if (remoteProfiles.length < beforeCount) {
          console.log(`[Sync Pull] 🗑️ Đã bỏ qua ${beforeCount - remoteProfiles.length} profile trong Thùng Rác.`);
        }
      }
    } catch(e) {
      console.warn('[Sync Pull] Lỗi đọc trash.json:', e.message);
    }

    fs.writeFileSync(profilePath, JSON.stringify(remoteProfiles, null, 2), 'utf-8');

    // Khôi phục Lịch sử duyệt web (Ctrl+H) và Favicons cho từng profile nếu Cloud có lưu
    for (const p of remoteProfiles) {
      if (p.webData && p.webData.historyGz) {
        if (launchedBrowsers.has(p.id) || launchedBrowsers.has(String(p.id))) {
          // Không ghi đè SQLite khi Chrome còn đang mở. Lần đóng/launch kế tiếp
          // sẽ chụp hoặc nạp lại dữ liệu an toàn.
          console.warn(`[Sync Pull] Bỏ qua restore History của profile đang chạy "${p.name}".`);
          continue;
        }
        try {
          const defaultDir = path.join(APP_DATA_DIR, 'profiles', String(p.id), 'Default');
          if (restoreBrowserHistoryData(defaultDir, p.webData, true)) {
            console.log(`[Sync Pull] 📜 Đã khôi phục thành công Lịch sử (Ctrl+H) cho profile "${p.name}"!`);
          }
        } catch(e) {
          console.warn(`[Sync Pull] Lỗi giải nén History cho ${p.name}:`, e.message);
        }
      }
    }

    return { ok: true, profiles: remoteProfiles, count: remoteProfiles.length };
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

// --- Cookies Sync IPC Handlers ---
ipcMain.handle('cookies:syncProfile', async (event, profileId) => {
  try {
    const res = await extractProfileCookies(profileId);
    const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
    let profileName = profileId;
    let profile = null;
    if (fs.existsSync(profilePath)) {
      try {
        const all = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
        profile = all.find(x => x.id === profileId);
        if (profile) {
          profileName = profile.name || profileId;

          // extractProfileCookies đã ghi historyGz/WAL vào profiles.json.
          // Chỉ cập nhật cookies và merge, tuyệt đối không thay thế toàn bộ webData.
          if (Array.isArray(res.cookies) && res.cookies.length > 0) {
            profile.webData = {
              ...(profile.webData || {}),
              cookies: res.cookies,
              count: res.cookies.length,
              updatedAt: Date.now()
            };
            fs.writeFileSync(profilePath, JSON.stringify(all, null, 2), 'utf-8');
          }
          if (supabaseManager) {
            const pushResult = await supabaseManager.pushSingleProfile(profile);
            if (!pushResult?.ok) {
              return { ok: false, error: pushResult?.error || 'Không thể đẩy dữ liệu lên Cloud' };
            }
          }
        }
      } catch(e) {
        return { ok: false, error: e.message };
      }
    }
    const hasHistory = !!(res.hasHistory || (profile && profile.webData && profile.webData.historyGz));
    return {
      ok: true,
      count: res.count || 0,
      profileId,
      profileName,
      hasHistory,
      source: res.source,
      message: (res.count > 0 || hasHistory)
        ? `Đã đồng bộ ${res.count} cookies ${hasHistory ? '+ Lịch sử duyệt web (Ctrl+H) ' : ''}của "${profileName}" lên Cloud!`
        : `Profile "${profileName}" chưa có dữ liệu duyệt web nào để tải lên.`
    };
  } catch(err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('cookies:syncAll', async () => {
  try {
    const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
    if (!fs.existsSync(profilePath)) return { ok: false, error: 'Chưa có profile nào' };

    let profiles = [];
    try {
      profiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    } catch(e) {
      return { ok: false, error: 'Lỗi đọc profiles.json' };
    }

    if (!profiles.length) return { ok: true, count: 0, message: 'Danh sách profile rỗng.' };

    let totalCookies = 0;
    let syncedProfiles = 0;

    for (const p of profiles) {
      try {
        const res = await extractProfileCookies(p.id);
        if (res.ok && ((res.cookies && res.cookies.length > 0) || res.hasHistory)) {
          totalCookies += (res.cookies ? res.cookies.length : 0);
          syncedProfiles++;
        }
      } catch(e) {
        console.warn(`[SyncAllCookies] Lỗi trích xuất profile ${p.id}:`, e.message);
      }
    }

    // Nạp lại profiles mới nhất từ file (vì extractProfileCookies đã ghi webData và historyGz)
    try {
      profiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    } catch(e) {}

    if (supabaseManager) {
      const pushResult = await supabaseManager.pushAllProfiles(profiles);
      if (!pushResult?.ok) {
        return { ok: false, error: pushResult?.error || 'Không thể đẩy dữ liệu lên Cloud' };
      }
    }

    return {
      ok: true,
      totalProfiles: profiles.length,
      syncedProfiles,
      totalCookies,
      message: `Đã đồng bộ ${totalCookies} cookies và Lịch sử duyệt web (Ctrl+H) của ${syncedProfiles}/${profiles.length} profiles lên Cloud!`
    };
  } catch(err) {
    return { ok: false, error: err.message };
  }
});

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

// ── Multi-source Git Repositories for OTA Patches (Dual-Git Redundancy) ──
const PATCH_SOURCES = [
  {
    name: 'hien151306-byte',
    owner: 'hien151306-byte',
    repo: 'N-A-Browser',
    branch: 'main',
    api: 'https://api.github.com/repos/hien151306-byte/N-A-Browser/contents/patches/update_manifest.json',
    raw: 'https://raw.githubusercontent.com/hien151306-byte/N-A-Browser/main/patches/update_manifest.json'
  },
  {
    name: 'hien141t',
    owner: 'hien141t',
    repo: 'N-A-Browser',
    branch: 'main',
    api: 'https://api.github.com/repos/hien141t/N-A-Browser/contents/patches/update_manifest.json',
    raw: 'https://raw.githubusercontent.com/hien141t/N-A-Browser/main/patches/update_manifest.json'
  }
];

// Helper lấy manifest từ 1 nguồn Git (thử GitHub API trước, sau đó raw URL)
async function fetchManifestFromSource(src) {
  // 1. Thử GitHub API (cập nhật ngay lập tức)
  try {
    const apiRes = await fetch(src.api, {
      headers: { 'User-Agent': 'NABrowser-App', 'Accept': 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(5000)
    });
    if (apiRes.ok) {
      const ghData = await apiRes.json();
      if (ghData && ghData.content) {
        const manifestStr = Buffer.from(ghData.content, 'base64').toString('utf8');
        const manifest = JSON.parse(manifestStr);
        return { ok: true, source: `github_api (${src.name})`, repoOwner: src.owner, ...manifest };
      }
    }
  } catch (e) {}

  // 2. Thử raw GitHub content (fallback)
  try {
    const rawUrl = `${src.raw}?t=${Date.now()}`;
    const rawRes = await fetch(rawUrl, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(6000)
    });
    if (rawRes.ok) {
      const manifest = await rawRes.json();
      return { ok: true, source: `raw (${src.name})`, repoOwner: src.owner, ...manifest };
    }
  } catch (e) {}

  return null;
}

ipcMain.handle('updater:checkPatch', async (event, customUrl) => {
  try {
    const settingsPath = path.join(APP_DATA_DIR, 'settings.json');
    let manifestUrl = customUrl;
    let hasCustomInSettings = false;
    if (!manifestUrl && fs.existsSync(settingsPath)) {
      try {
        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (s.updateManifestUrl) {
          manifestUrl = s.updateManifestUrl;
          hasCustomInSettings = true;
        }
      } catch(e) {}
    }

    // ── Kiểm tra đồng thời từ CẢ 2 NGUỒN GIT CHÍNH THỐNG (hien151306-byte & hien141t) ──
    const sourcesToFetch = [...PATCH_SOURCES.map(fetchManifestFromSource)];

    // Nếu có customUrl hoặc updateManifestUrl trong settings, kiểm tra đồng thời như 1 nguồn bổ sung
    if (manifestUrl) {
      sourcesToFetch.push((async () => {
        try {
          const bustUrl = manifestUrl.includes('?') ? `${manifestUrl}&t=${Date.now()}` : `${manifestUrl}?t=${Date.now()}`;
          const resp = await fetch(bustUrl, {
            headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
            signal: AbortSignal.timeout(6000)
          });
          if (resp.ok) {
            const manifest = await resp.json();
            return { ok: true, source: 'custom_url', ...manifest };
          }
        } catch(e) {}
        return null;
      })());
    }

    const results = await Promise.allSettled(sourcesToFetch);
    const validManifests = results
      .filter(r => r.status === 'fulfilled' && r.value && r.value.ok)
      .map(r => r.value);

    if (validManifests.length === 0) {
      return { ok: false, error: 'Không thể kết nối máy chủ kiểm tra bản vá từ các nguồn Git (hien151306-byte và hien141t)' };
    }

    // Luôn chọn bản vá có patchNumber cao nhất (mới nhất) giữa tất cả các nguồn
    validManifests.sort((a, b) => (b.patchNumber || 0) - (a.patchNumber || 0));
    const bestManifest = validManifests[0];

    // Tự động dọn dẹp updateManifestUrl cũ trong settings.json nếu nó trỏ vào GitHub để trả quyền kiểm soát cho Dual-Git
    if (hasCustomInSettings && fs.existsSync(settingsPath)) {
      try {
        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (s.updateManifestUrl && (s.updateManifestUrl.includes('githubusercontent.com') || s.updateManifestUrl.includes('github.com'))) {
          delete s.updateManifestUrl;
          fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf-8');
          console.log('[Updater] Đã tự động dọn dẹp updateManifestUrl cũ khỏi settings.json để luôn dùng Dual-Git tự động.');
        }
      } catch(e) {}
    }

    console.log(`[Updater] Tìm thấy bản vá mới nhất từ nguồn: ${bestManifest.source} (Patch #${bestManifest.patchNumber})`);
    return bestManifest;
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

    // Download/write each patch file (Renderer + Custom Extensions)
    for (const f of patchData.files) {
      const destPath = f.dest
        ? path.join(APP_DATA_DIR, f.dest)
        : path.join(targetRendererDir, f.filename);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      if (f.content) {
        fs.writeFileSync(destPath, f.content, 'utf-8');
      } else if (f.url) {
        // Tự động tải từ URL gốc, nếu lỗi thì tự đổi sang nguồn Git phụ (fallback mirror)
        const urlsToTry = [f.url];
        for (const src of PATCH_SOURCES) {
          const mirrorUrl = f.url.replace(
            /raw\.githubusercontent\.com\/[^/]+\/N-A-Browser/,
            `raw.githubusercontent.com/${src.owner}/N-A-Browser`
          );
          if (!urlsToTry.includes(mirrorUrl)) {
            urlsToTry.push(mirrorUrl);
          }
        }

        let downloaded = false;
        let lastErr = null;
        for (const tryUrl of urlsToTry) {
          try {
            const fileResp = await fetch(tryUrl, {
              headers: { 'Cache-Control': 'no-cache' },
              signal: AbortSignal.timeout(10000)
            });
            if (fileResp.ok) {
              const arrayBuf = await fileResp.arrayBuffer();
              fs.writeFileSync(destPath, Buffer.from(arrayBuf));
              downloaded = true;
              break;
            }
          } catch(e) {
            lastErr = e;
          }
        }

        if (!downloaded) {
          throw new Error(`Lỗi tải file ${f.filename}: thử tải từ cả 2 nguồn Git thất bại (${lastErr ? lastErr.message : 'HTTP error'})`);
        }
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

// ── Proxy Check IPC ──
// Kiểm tra kết nối TCP đến proxy host:port, trả về latency (ms)
ipcMain.handle('proxy:check', async (event, proxyConfig) => {
  const { host, port, type = 'http', user, pass } = proxyConfig || {};
  if (!host || !port) return { ok: false, error: 'Thiếu host hoặc port proxy' };

  const cleanHost = String(host).trim();
  const cleanPort = parseInt(port);
  if (!cleanHost || isNaN(cleanPort) || cleanPort < 1 || cleanPort > 65535) {
    return { ok: false, error: `Proxy không hợp lệ: ${cleanHost}:${port}` };
  }

  const TIMEOUT_MS = 6000; // 6 giây timeout

  return new Promise((resolve) => {
    const t0 = Date.now();
    const socket = new net.Socket();
    let done = false;

    const finish = (ok, error = null) => {
      if (done) return;
      done = true;
      socket.destroy();
      const latencyMs = Date.now() - t0;
      if (ok) {
        console.log(`[ProxyCheck] ✅ ${type}://${cleanHost}:${cleanPort} — ${latencyMs}ms`);
        resolve({ ok: true, latencyMs, host: cleanHost, port: cleanPort, type });
      } else {
        console.log(`[ProxyCheck] ❌ ${type}://${cleanHost}:${cleanPort} — ${error}`);
        resolve({ ok: false, error, latencyMs: Date.now() - t0, host: cleanHost, port: cleanPort, type });
      }
    };

    socket.setTimeout(TIMEOUT_MS);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false, `Timeout sau ${TIMEOUT_MS / 1000}s — proxy không phản hồi`));
    socket.on('error', (err) => {
      const msg = err.code === 'ECONNREFUSED' ? 'Proxy từ chối kết nối (ECONNREFUSED)'
                : err.code === 'ENOTFOUND'    ? `Không phân giải được host "${cleanHost}"`
                : err.code === 'ETIMEDOUT'    ? `Timeout kết nối đến proxy`
                : err.message;
      finish(false, msg);
    });

    try {
      socket.connect(cleanPort, cleanHost);
    } catch(e) {
      finish(false, e.message);
    }
  });
});





function resolveExtensionPath(item) {
  if (!item) return null;
  const extId = item.id || (item.path ? path.basename(item.path) : null);

  // Danh sách các vị trí ứng viên tuyệt đối
  const candidates = [
    item.path && path.isAbsolute(item.path) ? item.path : null,
    extId ? path.join(APP_DATA_DIR, 'custom_extensions', extId) : null,
    extId ? path.join(__dirname, 'custom_extensions', extId) : null,
    extId ? path.join(process.resourcesPath || '', 'custom_extensions', extId) : null,
    extId ? path.join(APP_DATA_DIR, 'patches', 'custom_extensions', extId) : null,
    item.path ? path.resolve(APP_DATA_DIR, item.path) : null,
    item.path ? path.resolve(__dirname, item.path) : null,
    extId ? path.resolve('D:/NABrowser/cloakdroid-app/custom_extensions', extId) : null
  ].filter(Boolean);

  for (const c of candidates) {
    const absPath = path.resolve(c);
    // BẮT BUỘC: Thư mục phải tồn tại VÀ có file manifest.json thì Chrome mới load được!
    if (fs.existsSync(absPath) && fs.existsSync(path.join(absPath, 'manifest.json'))) {
      return absPath;
    }
  }
  return null;
}

// Load saved extensions
ipcMain.handle('extensions:load', async () => {
  const extPath = path.join(APP_DATA_DIR, 'extensions.json');
  const defaultExt = path.join(__dirname, 'extensions.json');
  let list = [];

  if (fs.existsSync(extPath)) {
    try {
      list = JSON.parse(fs.readFileSync(extPath, 'utf-8')) || [];
    } catch(e) { list = []; }
  } else if (fs.existsSync(defaultExt)) {
    try {
      list = JSON.parse(fs.readFileSync(defaultExt, 'utf-8')) || [];
      fs.writeFileSync(extPath, JSON.stringify(list, null, 2), 'utf-8');
    } catch(e) { list = []; }
  }

  // Resolve đường dẫn tuyệt đối hợp lệ và lọc bỏ các extension rác không tồn tại
  const validList = [];
  list.forEach(item => {
    const resolved = resolveExtensionPath(item);
    if (resolved) {
      item.path = resolved;
      // Tránh trùng lặp id
      if (!validList.some(v => v.id === item.id)) {
        validList.push(item);
      }
    }
  });

  return validList;
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

// Ghi đè Chromium Preferences & Local State — BUỘC Chrome mở đúng kích thước & vị trí và hiện Avatar Overlay Badge trên Taskbar
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

    const formattedName = `N/A Browser #${profileNum}${profileName ? ' - ' + profileName : ''}`;

    // Cấu hình profile preferences cho Chromium native avatar badge
    if (!prefs.profile) prefs.profile = {};
    prefs.profile.name = formattedName;
    prefs.profile.avatar_index = 26;
    prefs.profile.using_default_avatar = false;
    prefs.profile.using_default_name = false;
    fs.writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));

    // Cài đặt Google Profile Picture.png cho avatar overlay badge
    const badgeSrc = path.join(APP_DATA_DIR, 'profile_icons', `badge_${profileNum}.png`);
    const avatarDest = path.join(defaultDir, 'Google Profile Picture.png');
    if (fs.existsSync(badgeSrc)) {
      try { fs.copyFileSync(badgeSrc, avatarDest); } catch(e){}
    }

    // Cấu hình Local State để Chromium kích hoạt Overlay Badge trên Taskbar
    const localStateFile = path.join(profileDir, 'Local State');
    let ls = {};
    if (fs.existsSync(localStateFile)) {
      try { ls = JSON.parse(fs.readFileSync(localStateFile, 'utf-8')); } catch(e){}
    }
    if (!ls.profile) ls.profile = {};
    if (!ls.profile.info_cache) ls.profile.info_cache = {};
    ls.profile.info_cache['Default'] = {
      active_time: Date.now() / 1000,
      avatar_icon: 'chrome://theme/IDR_PROFILE_AVATAR_26',
      background_apps: false,
      gaia_picture_file_name: 'Google Profile Picture.png',
      is_using_default_avatar: false,
      is_using_default_name: false,
      name: formattedName,
      user_name: `Profile #${profileNum}`
    };
    // Dummy entry để Chrome nhận diện môi trường đa profile và luôn vẽ overlay badge trên Taskbar
    ls.profile.info_cache['N-A-System'] = {
      active_time: 0,
      avatar_icon: 'chrome://theme/IDR_PROFILE_AVATAR_1',
      is_using_default_avatar: true,
      is_using_default_name: true,
      name: 'System Profile'
    };
    ls.profile.profiles_order = ['Default', 'N-A-System'];
    fs.writeFileSync(localStateFile, JSON.stringify(ls, null, 2));
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
      const needsRegen = !fs.existsSync(icoPath) || (fs.existsSync(icoPath) && fs.statSync(icoPath).size > 500000);
      if (needsRegen && fs.existsSync(psScript)) {
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

// ── Helper xác định đường dẫn trình duyệt Chromium / Chrome / CloakHQ ──
function getSystemBrowserBinary() {
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
  const chromeBin = chromePaths.find(p => p && fs.existsSync(p)) || null;
  return {
    chromeBin,
    isCloak: !!(cloakBin && chromeBin === cloakBin)
  };
}

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

    // ── Khôi phục Lịch sử duyệt web (Ctrl+H) và Favicons từ Cloud nếu có ──
    const defaultDir = path.join(profileDir, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    if (profile.webData && profile.webData.historyGz) {
      try {
        if (restoreBrowserHistoryData(defaultDir, profile.webData)) {
          console.log(`[Launch] 📜 Đã nạp thành công Lịch sử duyệt web (Ctrl+H) cho "${profile.name}"!`);
        }
      } catch (errH) {
        console.warn('[Launch] Lỗi khôi phục History:', errH.message);
      }
    }

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
            const resolved = resolveExtensionPath(item || { id: extId });
            if (resolved) extPaths.push(resolved);
          });
        } else {
          // Tự động nạp TẤT CẢ Extension có trong thư viện
          allExts.forEach(item => {
            const resolved = resolveExtensionPath(item);
            if (resolved) extPaths.push(resolved);
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

    // Find CloakHQ Stealth Chromium or system Chrome
    const { chromeBin, isCloak } = getSystemBrowserBinary();
    if (isCloak) {
      console.log('[N/A Browser] 🥷 Using CloakHQ C++ Engine Patched Stealth Chromium:', chromeBin);
    } else {
      console.log('[N/A Browser] Using System Browser:', chromeBin);
    }

    if (!chromeBin) {
      return { ok: false, error: 'Chưa cài đặt Chromium/Chrome trên máy!' };
    }

    const profileIcon = generateProfileIcon(profileNum, chromeBin);
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
      '--profile-directory=Default',
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
          '-icoPath', profileIcon.icoPath,
          '-appId', `NABrowser.Profile.${profileNum}`
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
        applyCDPDeviceEmulation(debugPort, profile.device, profile.proxy, winW, winH, targetUrl, profile).catch(e => {
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

// ── SQLite browser-data helpers ───────────────────────────────────
// Chrome có thể giữ các lượt truy cập/tìm kiếm mới nhất trong WAL.
// Chỉ copy History mà bỏ History-wal sẽ làm mất chính các bản ghi mới.
function gzipFileToBase64(filePath) {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const raw = fs.readFileSync(filePath);
    return raw.length > 0 ? zlib.gzipSync(raw).toString('base64') : undefined;
  } catch (err) {
    console.warn(`[Sync History] Không thể đọc ${filePath}:`, err.message);
    return undefined;
  }
}

function gunzipBase64ToFile(encoded, filePath) {
  if (!encoded) return false;
  const raw = zlib.gunzipSync(Buffer.from(encoded, 'base64'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, raw);
  return true;
}

function removeIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  } catch (err) {
    console.warn(`[Sync History] Không thể xóa ${filePath}:`, err.message);
  }
}

function restoreBrowserHistoryData(defaultDir, webData, force = false) {
  if (!webData || !webData.historyGz) return false;

  const historyFile = path.join(defaultDir, 'History');
  let shouldRestore = force || !fs.existsSync(historyFile);
  if (!shouldRestore) {
    try {
      const stats = fs.statSync(historyFile);
      shouldRestore = stats.size === 0 || (
        webData.historyUpdatedAt && webData.historyUpdatedAt > stats.mtimeMs
      );
    } catch (err) {
      shouldRestore = true;
    }
  }
  if (!shouldRestore) return false;

  fs.mkdirSync(defaultDir, { recursive: true });

  // Không để WAL/SHM cũ của máy đích trộn với database mới.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    removeIfExists(path.join(defaultDir, `History${suffix}`));
  }
  gunzipBase64ToFile(webData.historyGz, historyFile);
  if (webData.historyWalGz) {
    gunzipBase64ToFile(webData.historyWalGz, path.join(defaultDir, 'History-wal'));
  }
  if (webData.historyJournalGz) {
    gunzipBase64ToFile(webData.historyJournalGz, path.join(defaultDir, 'History-journal'));
  }

  if (webData.faviconsGz) {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      removeIfExists(path.join(defaultDir, `Favicons${suffix}`));
    }
    gunzipBase64ToFile(webData.faviconsGz, path.join(defaultDir, 'Favicons'));
    if (webData.faviconsWalGz) {
      gunzipBase64ToFile(webData.faviconsWalGz, path.join(defaultDir, 'Favicons-wal'));
    }
    if (webData.faviconsJournalGz) {
      gunzipBase64ToFile(webData.faviconsJournalGz, path.join(defaultDir, 'Favicons-journal'));
    }
  }

  return true;
}

// ── Helper trích xuất file History/Favicons của profile ────────────
function getProfileHistoryData(profileId) {
  const webData = {};
  try {
    const defaultDir = path.join(APP_DATA_DIR, 'profiles', String(profileId), 'Default');
    const historyGz = gzipFileToBase64(path.join(defaultDir, 'History'));
    if (historyGz) {
      webData.historyGz = historyGz;
      webData.historyUpdatedAt = Date.now();
      // null có chủ đích: xóa sidecar cũ trên Cloud khi SQLite đã checkpoint WAL.
      webData.historyWalGz = gzipFileToBase64(path.join(defaultDir, 'History-wal')) || null;
      webData.historyJournalGz = gzipFileToBase64(path.join(defaultDir, 'History-journal')) || null;
    }

    const faviconsGz = gzipFileToBase64(path.join(defaultDir, 'Favicons'));
    if (faviconsGz) {
      webData.faviconsGz = faviconsGz;
      webData.faviconsWalGz = gzipFileToBase64(path.join(defaultDir, 'Favicons-wal')) || null;
      webData.faviconsJournalGz = gzipFileToBase64(path.join(defaultDir, 'Favicons-journal')) || null;
    }
  } catch (err) {
    console.warn(`[Sync History] Không thể đọc History/Favicons cho ${profileId}:`, err.message);
  }
  return webData;
}

// ── Trích xuất Cookies & Lịch sử (Ctrl+H) toàn diện cho Profile (Hỗ trợ cả khi profile đang MỞ hoặc đã ĐÓNG) ──
async function extractProfileCookies(profileId) {
  const runningInfo = launchedBrowsers.get(profileId);
  const historyData = getProfileHistoryData(profileId);
  const hasHistory = !!historyData.historyGz;

  // 1. Nếu trình duyệt đang mở: Kết nối CDP trực tiếp trích xuất ngay tức thì
  if (runningInfo && runningInfo.debugPort) {
    try {
      const b = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${runningInfo.debugPort}`,
        defaultViewport: null,
      });
      const pages = await b.pages();
      if (pages.length > 0) {
        const client = await pages[0].createCDPSession();
        await client.send('Network.enable');
        const { cookies } = await client.send('Network.getAllCookies');
        b.disconnect();
        if (cookies && Array.isArray(cookies)) {
          const clean = sanitizeCookiesForCDP(cookies);
          const payload = {
            cookies: clean,
            count: clean.length,
            updatedAt: Date.now(),
            ...historyData
          };
          saveProfileWebData(profileId, payload);
          return { ok: true, cookies: clean, count: clean.length, hasHistory, source: 'active' };
        }
      }
      b.disconnect();
    } catch (errActive) {
      console.warn(`[CookieSync] CDP active extraction failed for ${profileId}:`, errActive.message);
    }
  }

  // 2. Nếu profile đang đóng: Kiểm tra dữ liệu SQLite trên ổ cứng và chạy headless ngắn để Chrome giải mã
  const profileDir = path.join(APP_DATA_DIR, 'profiles', String(profileId));
  const cookieDbFile = path.join(profileDir, 'Default', 'Network', 'Cookies');
  const cookieDbOld = path.join(profileDir, 'Default', 'Cookies');
  if (fs.existsSync(cookieDbFile) || fs.existsSync(cookieDbOld)) {
    const { chromeBin } = getSystemBrowserBinary();
    if (chromeBin) {
      const tempPort = getRandomDebugPort();
      const { spawn } = require('child_process');
      const tempProc = spawn(chromeBin, [
        `--user-data-dir=${profileDir}`,
        '--profile-directory=Default',
        '--headless=new',
        `--remote-debugging-port=${tempPort}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-allow-origins=*',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
      ], { detached: true, stdio: 'ignore' });

      try {
        await new Promise(r => setTimeout(r, 1200));
        const b = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${tempPort}`,
          defaultViewport: null
        });
        const pages = await b.pages();
        if (pages.length > 0) {
          const client = await pages[0].createCDPSession();
          await client.send('Network.enable');
          const { cookies } = await client.send('Network.getAllCookies');
          await b.close();
          if (tempProc && !tempProc.killed) {
            try { process.kill(tempProc.pid); } catch(e){}
          }
          if (cookies && Array.isArray(cookies) && cookies.length > 0) {
            const clean = sanitizeCookiesForCDP(cookies);
            const payload = {
              cookies: clean,
              count: clean.length,
              updatedAt: Date.now(),
              ...historyData
            };
            saveProfileWebData(profileId, payload);
            return { ok: true, cookies: clean, count: clean.length, hasHistory, source: 'headless' };
          }
        } else {
          await b.close();
        }
      } catch (errHeadless) {
        console.warn(`[CookieSync] Headless extraction failed for ${profileId}:`, errHeadless.message);
      } finally {
        if (tempProc && !tempProc.killed) {
          try { process.kill(tempProc.pid); } catch(e){}
        }
      }
    }
  }

  // 3. Fallback: Dùng cookies đã lưu trong file profiles.json (nếu có)
  const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
  if (fs.existsSync(profilePath)) {
    try {
      const all = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      const p = all.find(x => x.id === profileId);
      if (p?.webData?.cookies && Array.isArray(p.webData.cookies) && p.webData.cookies.length > 0) {
        if (Object.keys(historyData).length > 0) {
          saveProfileWebData(profileId, historyData);
        }
        return { ok: true, cookies: p.webData.cookies, count: p.webData.cookies.length, hasHistory: !!(hasHistory || p.webData.historyGz), source: 'cache' };
      }
    } catch(e){}
  }

  if (hasHistory) {
    saveProfileWebData(profileId, { ...historyData, updatedAt: Date.now() });
    return { ok: true, cookies: [], count: 0, hasHistory: true, source: 'history-only' };
  }

  return { ok: true, cookies: [], count: 0, hasHistory: false, source: 'empty' };
}

// ── Lưu Web Data cục bộ; caller sẽ push lên Cloud sau khi snapshot hoàn tất ──
function saveProfileWebData(profileId, webData) {
  try {
    const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
    if (!fs.existsSync(profilePath)) return;
    let profiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    const p = profiles.find(x => x.id === profileId);
    if (p) {
      // Merge từng trường có giá trị để một snapshot thiếu History không
      // vô tình xóa historyGz đã đồng bộ trước đó.
      const mergedWebData = { ...(p.webData || {}) };
      for (const [key, value] of Object.entries(webData || {})) {
        if (value !== undefined) mergedWebData[key] = value;
      }
      mergedWebData.updatedAt = Date.now();
      p.webData = mergedWebData;
      fs.writeFileSync(profilePath, JSON.stringify(profiles, null, 2), 'utf-8');
      return p;
    }
  } catch (e) {
    console.error('[saveProfileWebData Error]', e);
  }
  return null;
}

async function pushProfileFromDisk(profileId) {
  if (!supabaseManager || !supabaseManager.currentUser) return { ok: false, error: 'Chưa đăng nhập Cloud' };
  const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
  if (!fs.existsSync(profilePath)) return { ok: false, error: 'Không tìm thấy profiles.json' };
  try {
    const profiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    const profile = profiles.find(x => x.id === profileId);
    if (!profile) return { ok: false, error: `Không tìm thấy profile ${profileId}` };
    return supabaseManager.pushSingleProfile(profile);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function gracefulCloseProfile(profileId) {
  const info = launchedBrowsers.get(profileId);
  stopLocalProxy(profileId);

  if (!info || !info.pid || !info.debugPort) return;

  let capturedCookies = null;

  // Bước 1: lấy cookies qua CDP, nhưng chụp History SAU khi Chrome đóng.
  // Như vậy SQLite có cơ hội checkpoint WAL vào file History chính.
  try {
    const b = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${info.debugPort}`,
      defaultViewport: null,
    });

    try {
      const pages = await b.pages();
      if (pages.length > 0) {
        const client = await pages[0].createCDPSession();
        await client.send('Network.enable');
        const { cookies } = await client.send('Network.getAllCookies');
        capturedCookies = (cookies && cookies.length > 0) ? sanitizeCookiesForCDP(cookies) : [];
      }
    } catch (errCookies) {
      console.warn(`[Sync] Không thể trích xuất cookies trước khi đóng: ${errCookies.message}`);
    }

    // Browser.close() ra lệnh cho Chrome tự đóng toàn bộ tab rồi thoát.
    await b.close();
    console.log(`[Close] 🎯 CDP Browser.close() gửi tới profile ${profileId}`);
  } catch(e) {
    console.log(`[Close] CDP không kết nối được, sẽ force kill (${e.message})`);
  }

  // Bước 2: Chờ Chrome tự thoát (tối đa 2s)
  const isAlive = (pid) => {
    try { process.kill(pid, 0); return true; } catch(e) { return false; }
  };
  let exited = false;
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (!isAlive(info.pid)) {
      console.log(`[Close] ✅ Chrome tự thoát sau ${(i+1)*250}ms`);
      exited = true;
      break;
    }
  }

  // Bước 3: Force kill nếu vẫn tồn tại
  if (!exited) killProfileProcessTree(profileId);
  else launchedBrowsers.delete(profileId);

  // Bước 4: đọc History sau khi process đã dừng rồi mới lưu/push.
  const historyData = getProfileHistoryData(profileId);
  if (capturedCookies !== null) {
    saveProfileWebData(profileId, {
      cookies: capturedCookies,
      count: capturedCookies.length,
      ...historyData,
      updatedAt: Date.now()
    });
    console.log(`[Sync] 🍪 Đã lưu ${capturedCookies.length} cookies ${historyData.historyGz ? '+ Lịch sử Ctrl+H' : ''} của profile ${profileId}`);
  } else if (Object.keys(historyData).length > 0) {
    saveProfileWebData(profileId, { ...historyData, updatedAt: Date.now() });
  }

  const pushResult = await pushProfileFromDisk(profileId);
  if (!pushResult.ok && pushResult.error !== 'Chưa đăng nhập Cloud') {
    console.warn(`[Cloud Sync] Không thể đồng bộ profile ${profileId}:`, pushResult.error);
  }
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

// ── Trash Helpers ──
function loadTrashFromDisk() {
  const trashPath = path.join(APP_DATA_DIR, 'trash.json');
  if (!fs.existsSync(trashPath)) return [];
  try { return JSON.parse(fs.readFileSync(trashPath, 'utf-8')); } catch(e) { return []; }
}
function saveTrashToDisk(items) {
  const trashPath = path.join(APP_DATA_DIR, 'trash.json');
  fs.writeFileSync(trashPath, JSON.stringify(items, null, 2), 'utf-8');
}

// Soft-Delete profile: xóa disk, ghi vào trash.json, KHÔNG xóa Supabase
ipcMain.handle('profile:delete', async (event, profileId) => {
  try {
    // 1. Đóng Chrome graceful (CDP Browser.close → chờ → force kill nếu cần)
    await gracefulCloseProfile(profileId);

    // 2. Chờ thêm 800ms để Windows xả File Lock
    await new Promise(resolve => setTimeout(resolve, 800));

    // 3. Đọc metadata profile trước khi xóa khỏi profiles.json
    const profilesPath = path.join(APP_DATA_DIR, 'profiles.json');
    let deletedProfile = null;
    if (fs.existsSync(profilesPath)) {
      try {
        let profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));
        deletedProfile = profiles.find(p => String(p.id) === String(profileId)) || null;
        profiles = profiles.filter(p => String(p.id) !== String(profileId));
        fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
      } catch(e){ console.warn('[Soft Delete] profiles.json error:', e.message); }
    }

    // 4. Ghi vào Thùng Rác (trash.json) — giữ metadata để có thể Khôi phục hoặc Xóa Cloud sau
    if (deletedProfile) {
      try {
        const trash = loadTrashFromDisk();
        // Tránh trùng: nếu đã có trong trash thì cập nhật
        const existing = trash.findIndex(t => String(t.id) === String(profileId));
        const trashItem = { ...deletedProfile, deletedAt: Date.now() };
        if (existing >= 0) trash[existing] = trashItem;
        else trash.push(trashItem);
        saveTrashToDisk(trash);
        console.log(`[Trash] 🗑️ Đã đưa profile "${deletedProfile.name}" vào Thùng Rác.`);
      } catch(e) { console.warn('[Trash] Lỗi ghi trash.json:', e.message); }
    }

    // 5. Xóa toàn bộ thư mục profile trên ổ đĩa
    const profileDir = path.join(APP_DATA_DIR, 'profiles', String(profileId));
    if (fs.existsSync(profileDir)) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch(e) {
        console.error('[rmSync retry failed, attempting cmd rmdir]', e);
      }
      // Fallback: dùng rmdir của Windows CMD
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

// ── Trash IPC Handlers ──

// Lấy danh sách Thùng Rác
ipcMain.handle('trash:list', async () => {
  try {
    const items = loadTrashFromDisk();
    return { ok: true, items };
  } catch(e) {
    return { ok: false, error: e.message, items: [] };
  }
});

// Khôi phục profile từ Thùng Rác
ipcMain.handle('trash:restore', async (event, profileId) => {
  try {
    const trash = loadTrashFromDisk();
    const idx = trash.findIndex(t => String(t.id) === String(profileId));
    if (idx < 0) return { ok: false, error: 'Không tìm thấy trong Thùng Rác.' };

    const item = trash[idx];
    // Xóa khỏi trash
    trash.splice(idx, 1);
    saveTrashToDisk(trash);

    // Thêm lại vào profiles.json
    const profilesPath = path.join(APP_DATA_DIR, 'profiles.json');
    let profiles = [];
    if (fs.existsSync(profilesPath)) {
      try { profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf-8')); } catch(e) {}
    }
    // Bỏ field deletedAt trước khi thêm lại
    const { deletedAt, ...restoredProfile } = item;
    // Tránh trùng id
    if (!profiles.find(p => String(p.id) === String(profileId))) {
      profiles.push(restoredProfile);
      fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2), 'utf-8');
    }

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('profiles:reload');
    }

    console.log(`[Trash] ♻️ Đã khôi phục profile "${item.name}" từ Thùng Rác.`);
    return { ok: true, profile: restoredProfile };
  } catch(e) {
    console.error('[Trash Restore Error]', e);
    return { ok: false, error: e.message };
  }
});

// Xóa vĩnh viễn 1 profile trong Thùng Rác (xóa Supabase Cloud)
ipcMain.handle('trash:delete', async (event, profileId) => {
  try {
    const trash = loadTrashFromDisk();
    const idx = trash.findIndex(t => String(t.id) === String(profileId));
    if (idx < 0) return { ok: false, error: 'Không tìm thấy trong Thùng Rác.' };

    const item = trash[idx];

    // Xóa trên Supabase Cloud
    try {
      if (supabaseManager) {
        await supabaseManager.deleteRemoteProfile(String(profileId));
        console.log(`[Trash] ☁️ Đã xóa vĩnh viễn profile "${item.name}" trên Supabase Cloud.`);
      }
    } catch(e) {
      console.warn('[Trash Cloud Delete Warning]', e.message);
    }

    // Xóa khỏi trash.json
    trash.splice(idx, 1);
    saveTrashToDisk(trash);

    return { ok: true };
  } catch(e) {
    console.error('[Trash Delete Error]', e);
    return { ok: false, error: e.message };
  }
});

// Xóa toàn bộ Thùng Rác (xóa tất cả trên Supabase Cloud)
ipcMain.handle('trash:clear', async () => {
  try {
    const trash = loadTrashFromDisk();
    let cloudErrors = 0;

    for (const item of trash) {
      try {
        if (supabaseManager) {
          await supabaseManager.deleteRemoteProfile(String(item.id));
        }
      } catch(e) {
        console.warn(`[Trash Clear] Lỗi xóa Cloud profile "${item.name}":`, e.message);
        cloudErrors++;
      }
    }

    // Clear trash.json dù có lỗi Cloud hay không
    saveTrashToDisk([]);
    console.log(`[Trash] 🧹 Đã dọn sạch Thùng Rác (${trash.length} profiles). Lỗi Cloud: ${cloudErrors}.`);
    return { ok: true, count: trash.length, cloudErrors };
  } catch(e) {
    console.error('[Trash Clear Error]', e);
    return { ok: false, error: e.message };
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

  // ── DELETE /api/profiles/:id ── soft-delete profile vào Thùng Rác
  if (method === 'DELETE' && matchSingle) {
    const id = matchSingle[1];
    let profiles = loadProfilesFromDisk();
    const target = profiles.find(p => p.id === id);
    if (!target) return sendJSON(res, 404, { ok: false, error: `Profile "${id}" không tồn tại.` });

    // Đóng graceful để không làm mất History/Cookies mới nhất trước khi xóa.
    await gracefulCloseProfile(id);

    profiles = profiles.filter(p => p.id !== id);
    saveProfilesToDisk(profiles);

    // Ghi vào Thùng Rác (không xóa Supabase)
    try {
      const trash = loadTrashFromDisk();
      const existing = trash.findIndex(t => String(t.id) === String(id));
      const trashItem = { ...target, deletedAt: Date.now() };
      if (existing >= 0) trash[existing] = trashItem;
      else trash.push(trashItem);
      saveTrashToDisk(trash);
    } catch(e) { console.warn('[API Trash] Lỗi ghi trash.json:', e.message); }

    // Xóa thư mục data của profile nếu tồn tại
    const profileDir = path.join(APP_DATA_DIR, 'profiles', id);
    if (fs.existsSync(profileDir)) {
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch(e) { console.warn('[API] Không xóa được thư mục:', e.message); }
    }

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('profiles:reload');
    }

    console.log(`[API] 🗑️ Đã đưa profile "${target.name}" (${id}) vào Thùng Rác.`);
    return sendJSON(res, 200, { ok: true, message: `Profile "${target.name}" đã được chuyển vào Thùng Rác.`, id });
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
      const defaultDir = path.join(profileDir, 'Default');
      fs.mkdirSync(defaultDir, { recursive: true });

      // API launch phải khôi phục cùng dữ liệu History/Cookies như launch từ UI.
      try {
        if (restoreBrowserHistoryData(defaultDir, profile.webData)) {
          console.log(`[API Launch] 📜 Đã nạp Lịch sử duyệt web cho "${profile.name}"!`);
        }
      } catch (errHistory) {
        console.warn('[API Launch] Lỗi khôi phục History:', errHistory.message);
      }

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
        '--profile-directory=Default',
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
          applyCDPDeviceEmulation(debugPort, device, profile.proxy, gridPos.winW, gridPos.winH, startUrl, profile).catch(e => {});
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
    // Dùng cùng luồng graceful như nút Stop trong UI để lưu History/Cookies.
    await gracefulCloseProfile(id);
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
