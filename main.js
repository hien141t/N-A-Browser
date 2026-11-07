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

let layoutEngineModule;
try {
  layoutEngineModule = require('./src/layoutEngine');
} catch (e) {
  try {
    layoutEngineModule = require('./patches/layoutEngine');
  } catch (e2) {
    layoutEngineModule = require('./layoutEngine');
  }
}
const {
  UI_DELTA_X,
  UI_DELTA_Y,
  MIN_WIN_WIDTH,
  MIN_WIN_HEIGHT,
  normalizeDeviceRatio,
  getDisplayCapacity,
  calculateOptimalGridCols,
  calculateGridPosition: engineCalculateGridPosition,
  computeEmulationState: engineComputeEmulationState,
  getProfileDirectoryName,
} = layoutEngineModule;

let fingerprintGeneratorModule;
try {
  fingerprintGeneratorModule = require('./src/fingerprintGenerator');
} catch (e) {
  try {
    fingerprintGeneratorModule = require('./patches/fingerprintGenerator');
  } catch (e2) {
    fingerprintGeneratorModule = require('./fingerprintGenerator');
  }
}
const { generateFingerprintScript } = fingerprintGeneratorModule;

let browserLauncherModule;
try {
  browserLauncherModule = require('./src/browserLauncher');
} catch (e) {
  try {
    browserLauncherModule = require('./src/operaLauncher');
  } catch (e2) {
    try {
      browserLauncherModule = require('./patches/browserLauncher');
    } catch (e3) {
      browserLauncherModule = require('./patches/operaLauncher');
    }
  }
}
const {
  LAUNCH_STATES,
  findBrowserBinary,
  findChromiumBinary,
  findOperaBinary,
  launchBrowserProfile,
  launchChromiumProfile,
  launchOperaProfile,
  cancelLaunch,
  closeBrowserProfile,
  closeOperaProfile,
  getAllBrowserStatuses,
  setStateChangeCallback,
} = browserLauncherModule;

let fingerprintManagerModule;
try {
  fingerprintManagerModule = require('./src/fingerprintManager');
} catch (e) {
  try {
    fingerprintManagerModule = require('./patches/fingerprintManager');
  } catch (e2) {
    fingerprintManagerModule = require('./fingerprintManager');
  }
}
const {
  getFingerprint,
  updateFingerprint,
  generateFingerprint,
  resetFingerprint,
  validateFingerprint,
} = fingerprintManagerModule;

// ══════════════════════════════════════════════════════════════════
// ── MIGRATION: DỌN DẸP EXTENSION RÁC ĐÓNG GÓI CŨ TRÊN MÁY KHÁCH ───
// Tự động gỡ các extension rác mẫu cũ khỏi custom_extensions và
// extensions.json mà KHÔNG làm mất profile, cookie hay dữ liệu người dùng.
// ══════════════════════════════════════════════════════════════════
function runLegacyExtensionCleanupMigration() {
  try {
    const LEGACY_PACKAGED_EXTENSIONS = [
      'ext_1786469361479', 'ext_1786515448618', 'ext_1789551710577',
      'ext_1789553895819', 'ext_1789553926880', 'ext_1789554568979',
      'ext_1789569933387', 'ext_1791086690787', 'ext_1793961703501',
      'ext_1793995763303', 'ext_1794001027896'
    ];

    const dirsToClean = [
      path.join(APP_DATA_DIR, 'custom_extensions'),
      path.join(APP_DATA_DIR, 'patches', 'custom_extensions')
    ];

    dirsToClean.forEach(dir => {
      if (fs.existsSync(dir)) {
        LEGACY_PACKAGED_EXTENSIONS.forEach(extId => {
          const target = path.join(dir, extId);
          if (fs.existsSync(target)) {
            try {
              fs.rmSync(target, { recursive: true, force: true });
            } catch (err) {}
          }
        });
      }
    });

    const extJsonPath = path.join(APP_DATA_DIR, 'extensions.json');
    if (fs.existsSync(extJsonPath)) {
      try {
        let list = JSON.parse(fs.readFileSync(extJsonPath, 'utf8'));
        if (Array.isArray(list)) {
          const filtered = list.filter(item => !LEGACY_PACKAGED_EXTENSIONS.includes(item.id));
          if (filtered.length !== list.length) {
            fs.writeFileSync(extJsonPath, JSON.stringify(filtered, null, 2), 'utf8');
          }
        }
      } catch (err) {}
    }
  } catch (e) {
    console.warn('[Migration] Legacy extension cleanup notice:', e.message);
  }
}
runLegacyExtensionCleanupMigration();

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
async function applyCDPDeviceEmulation(debugPort, device, proxy = null, winW = 380, winH = 675, startUrl = null, profile = null, injectScript = null) {
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

    // ── Diagnostic Mode (Clean Profile): Không can thiệp fingerprint hay tiêm script giả mạo ──
    if (profile && profile.diagnosticMode === true) {
      console.log(`[CDP] 🧪 Diagnostic Mode kích hoạt cho Profile "${profile.name || profile.id}": Bỏ qua giả mạo fingerprint, CDP emulation & anti-debugger (Chromium sạch 100%).`);
      try {
        const winInfo = await client.send('Browser.getWindowForTarget');
        const windowId = winInfo && winInfo.windowId;
        if (windowId) {
          await client.send('Browser.setWindowBounds', {
            windowId,
            bounds: { left: undefined, top: undefined, width: winW, height: winH, windowState: 'normal' }
          });
        }
      } catch (e) {}

      if (startUrl && startUrl !== 'about:blank' && startUrl.startsWith('http')) {
        try {
          await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          console.log(`[CDP] 🌐 (Diagnostic) Navigated to: ${startUrl}`);
        } catch(e) {
          console.warn('[CDP] (Diagnostic) Navigate warning:', e.message);
        }
      }
      return;
    }

    // ── Kích hoạt Page & Network domain ổn định (không kích hoạt Runtime.enable để tránh rò rỉ runtime bindings) ──
    await client.send('Page.enable').catch(() => {});
    await client.send('Network.enable').catch(() => {});

    // ── Tiêm Fingerprint script ở tầng CDP trước cả khi extension nạp ──
    const fpScript = injectScript || (device && typeof generateFingerprintScript === 'function' ? generateFingerprintScript(device, profile?.orientationLock) : null);
    if ((!profile || !profile.diagnosticMode) && fpScript) {
      try {
        await client.send('Page.addScriptToEvaluateOnNewDocument', { source: fpScript });
        console.log('[CDP] 💉 Tiêm mã fingerprint thành công qua Page.addScriptToEvaluateOnNewDocument');
      } catch (errInj) {
        console.warn('[CDP] Lỗi Page.addScriptToEvaluateOnNewDocument:', errInj.message);
      }
    }

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
        const cleanCookies = sanitizeCookiesForCDP(targetProfile.webData.cookies);
        if (cleanCookies.length > 0) {
          await client.send('Network.setCookies', { cookies: cleanCookies });
          console.log(`[CDP] 🍪 Đã khôi phục thành công ${cleanCookies.length}/${targetProfile.webData.cookies.length} cookies từ Cloud cho profile "${targetProfile.name || targetProfile.id}"!`);
        }
      }
    } catch (errCookies) {
      console.warn('[CDP] Lỗi khi nạp cookies từ Cloud:', errCookies.message);
    }

    let dev = device;
    if ((!dev || Object.keys(dev).length === 0) && profile) {
      if (profile.device) {
        dev = profile.device;
      } else if (profile.deviceId) {
        const devices = loadDevicesFromDisk();
        const deviceList = Array.isArray(devices) ? devices : (devices.devices || []);
        dev = deviceList.find(d => d.id === profile.deviceId);
      }
    }
    dev = dev || {};

    const isMobile = dev.is_mobile !== false;

    let orientationLock = profile?.orientationLock;
    if (!orientationLock) {
      orientationLock = isMobile ? 'portrait' : 'auto';
    }
    if (orientationLock !== 'portrait' && orientationLock !== 'landscape') {
      orientationLock = 'auto';
    }

    const norm = normalizeDeviceRatio(dev, orientationLock);

    const dpr   = dev.device_scale_factor || 3.0;
    const ua    = dev.user_agent || '';
    const tz    = dev.timezone || (profile && profile.timezone) || 'Asia/Ho_Chi_Minh';
    const lang  = dev.language || (profile && profile.language) || 'vi-VN';
    const touch = dev.max_touch_points || 10;

    // Thiết lập Network.setExtraHTTPHeaders đồng bộ Accept-Language theo device.language
    const primaryLang = lang.trim();
    const langCode = primaryLang.split('-')[0];
    const acceptLanguageHeader = primaryLang.includes('-')
      ? `${primaryLang},${langCode};q=0.9,en-US;q=0.8,en;q=0.7`
      : `${primaryLang};q=0.9,en-US;q=0.8,en;q=0.7`;

    await client.send('Network.setExtraHTTPHeaders', {
      headers: {
        'Accept-Language': acceptLanguageHeader,
      }
    }).catch(e => console.warn('[CDP] setExtraHTTPHeaders warning:', e.message));

    // Proxy auth đã được xử lý bởi local proxy server (startLocalProxy).
    // CDP không cần handle 407 nữa.

    // ── 1. SET KÍCH THƯỚC CỬA SỔ VẬT LÝ ngay lúc Chrome vừa mở ──
    let windowId = null;
    try {
      const winInfo = await client.send('Browser.getWindowForTarget');
      windowId = winInfo && winInfo.windowId;
      if (windowId) {
        await client.send('Browser.setWindowBounds', {
          windowId,
          bounds: { left: undefined, top: undefined, width: winW, height: winH, windowState: 'normal' }
        });
        console.log(`[CDP] 📐 Initial window size set: ${winW}x${winH}`);
      }
    } catch(e) {
      console.warn('[CDP] setWindowBounds failed:', e.message);
    }

    // ── 2. Đo Chrome UI chrome (khung viền + tab bar + address bar) ──
    let uiDeltaX = 16, uiDeltaY = 110; // Fallback an toàn trên Windows (~16px viền, ~110px tab bar + omnibox)
    try {
      if (windowId) {
        const { bounds } = await client.send('Browser.getWindowBounds', { windowId });
        const metrics = await client.send('Page.getLayoutMetrics');
        const vp = metrics.cssVisualViewport || metrics.visualViewport;
        if (bounds && vp && vp.clientWidth > 0 && vp.clientHeight > 0) {
          const mX = bounds.width - vp.clientWidth;
          const mY = bounds.height - vp.clientHeight;
          if (mX >= 0 && mX <= 60) uiDeltaX = mX;
          if (mY >= 30 && mY <= 220) uiDeltaY = mY;
        }
        console.log(`[CDP] 📏 Chrome UI measured: ${uiDeltaX}x${uiDeltaY}px`);
      }
    } catch(e) {}

    // ── 3. Đồng bộ Viewport & Khung hình theo tỷ lệ chuẩn device / orientationLock ──
    let lastKnownWinW = winW;
    let lastKnownWinH = winH;
    let isProgrammaticResize = false;
    let currentMetricsState = null;

    const computeEmulationState = (currentWinW, currentWinH) => {
      return engineComputeEmulationState({
        currentWinW,
        currentWinH,
        lastKnownWinW,
        lastKnownWinH,
        device: dev,
        orientationLock,
        uiDeltaX,
        uiDeltaY
      });
    };

    const applyMetricsOverride = async (vpW, vpH, orientation) => {
      try {
        await client.send('Emulation.setDeviceMetricsOverride', {
          width:             vpW,
          height:            vpH,
          deviceScaleFactor: dpr,
          mobile:            isMobile,
          screenOrientation: orientation,
          screenWidth:       vpW,
          screenHeight:      vpH,
          positionX:         0,
          positionY:         0,
        });
        currentMetricsState = { viewportW: vpW, viewportH: vpH, screenOrientation: orientation };
        console.log(`[CDP] 📱 Synced Emulation: ${vpW}x${vpH} (${orientation.type}) DPR=${dpr}`);
      } catch(e) {
        console.warn('[CDP] setDeviceMetricsOverride warning:', e.message);
      }
    };

    const syncViewportAndBounds = async () => {
      if (isProgrammaticResize) return;
      try {
        if (!windowId) return;
        const { bounds } = await client.send('Browser.getWindowBounds', { windowId });
        if (!bounds || bounds.windowState === 'minimized') return;

        const state = computeEmulationState(bounds.width, bounds.height);
        lastKnownWinW = bounds.width;
        lastKnownWinH = bounds.height;

        if (state.needsResize) {
          isProgrammaticResize = true;
          lastKnownWinW = state.targetWinW;
          lastKnownWinH = state.targetWinH;
          try {
            await client.send('Browser.setWindowBounds', {
              windowId,
              bounds: {
                width: state.targetWinW,
                height: state.targetWinH
              }
            });
            console.log(`[CDP] 📐 Ratio-locked window resize: ${state.targetWinW}x${state.targetWinH}`);
          } catch(e){}
          finally {
            setTimeout(() => { isProgrammaticResize = false; }, 200);
          }
        }

        // Lưu hướng cũ trước khi gọi applyMetricsOverride() để so sánh trước/sau chính xác
        const prevOrientationType = currentMetricsState?.screenOrientation?.type;

        await applyMetricsOverride(state.viewportW, state.viewportH, state.screenOrientation);

        // Đồng bộ hóa động runtime screen.orientation trong chế độ 'auto' khi xoay khung hình
        if (orientationLock === 'auto' && state.screenOrientation && prevOrientationType && prevOrientationType !== state.screenOrientation.type) {
          console.log(`[CDP] 🔄 Auto Orientation dynamically switched: ${prevOrientationType} -> ${state.screenOrientation.type} (${state.viewportW}x${state.viewportH})`);
          // Xác định hướng mới trực tiếp từ state.screenOrientation.type thay vì phụ thuộc state.isLandscape
          const isLandscape = state.screenOrientation.type.toLowerCase().includes('landscape');
          const orientJs = isLandscape ? 'landscape-primary' : 'portrait-primary';
          const orientAngle = isLandscape ? 90 : 0;
          try {
            await client.send('Runtime.evaluate', {
              expression: `(function() {
                try {
                  if (typeof screen !== 'undefined' && screen.orientation) {
                    Object.defineProperty(screen.orientation, 'type', { get: function() { return "${orientJs}"; }, configurable: true });
                    Object.defineProperty(screen.orientation, 'angle', { get: function() { return ${orientAngle}; }, configurable: true });
                  }
                  if (typeof window !== 'undefined') {
                    Object.defineProperty(window, 'orientation', { get: function() { return ${orientAngle}; }, configurable: true });
                    window.dispatchEvent(new Event('orientationchange'));
                  }
                } catch(e){}
              })()`,
              returnByValue: true
            }).catch(() => {});
          } catch(e){}
        }
      } catch(e) {}
    };

    // Áp dụng ngay lúc khởi động
    await syncViewportAndBounds();

    // ── Theo dõi resize: debounce 150-200ms chống giật lag và vòng lặp ──
    let resizeTimer = null;
    const debouncedResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(syncViewportAndBounds, 180);
    };

    client.on('Browser.windowBoundsChanged', debouncedResize);
    const resizePoller = setInterval(syncViewportAndBounds, 1500);

    page.on('close', () => {
      clearInterval(resizePoller);
      clearTimeout(resizeTimer);
    });

    browser.on('disconnected', () => {
      clearInterval(resizePoller);
      clearTimeout(resizeTimer);
      if (profile && profile.id) {
        launchedBrowsers.delete(profile.id);
        triggerAutoArrangeIfNeeded();
      }
    });

    // ── 3. User-Agent & Client Hints (Chuẩn Hóa High Entropy) ──
    const isOpera    = ua.includes('OPR/') || ua.includes('Opera/') || dev.browser_type === 'opera' || !!dev.opera_version;
    const operaMajor = ua.match(/(?:OPR|Opera)\/(\d+)/)?.[1]     || dev.opera_version?.split('.')[0]  || '143';
    const operaFull  = ua.match(/(?:OPR|Opera)\/([\d.]+)/)?.[1]  || dev.opera_version                 || `${operaMajor}.0.0.0`;
    const chromeMajor = ua.match(/Chrome\/(\d+)/)?.[1]           || dev.chrome_version?.split('.')[0] || '126';
    const chromeFull  = ua.match(/Chrome\/([\d.]+)/)?.[1]        || dev.chrome_version                || `${chromeMajor}.0.0.0`;

    const ensureFullVersion = (v, defaultVer = '126.0.0.0') => {
      if (!v) return defaultVer;
      const parts = String(v).split('.');
      while (parts.length < 4) parts.push('0');
      return parts.slice(0, 4).join('.');
    };
    const cFull = ensureFullVersion(chromeFull, `${chromeMajor}.0.0.0`);
    const oFull = ensureFullVersion(operaFull, `${operaMajor}.0.0.0`);

    // isMobile đã được định nghĩa ở trên theo dev.is_mobile !== false
    const isApple = (dev.brand && dev.brand.toLowerCase() === 'apple') || dev.platform === 'iPhone' || dev.platform === 'iPad';
    const platformName = isApple ? (dev.platform || (dev.model && dev.model.includes('iPad') ? 'iPad' : 'iPhone')) : (isMobile ? 'Android' : (ua.includes('Windows') ? 'Windows' : 'Android'));

    const brands = [
      { brand: 'Not/A)Brand', version: '99' },
      { brand: 'Chromium',    version: chromeMajor },
    ];
    const fullVersionList = [
      { brand: 'Not/A)Brand', version: '99.0.0.0' },
      { brand: 'Chromium',    version: cFull },
    ];
    if (isOpera) {
      brands.push({ brand: 'Opera', version: operaMajor });
      fullVersionList.push({ brand: 'Opera', version: oFull });
    } else {
      brands.push({ brand: 'Google Chrome', version: chromeMajor });
      fullVersionList.push({ brand: 'Google Chrome', version: cFull });
    }

    // Chuẩn hóa Client Hints High Entropy platformVersion:
    // Android 14 -> '14.0.0', Android 13 -> '13.0.0', Android 12 -> '12.0.0'
    const osVerRaw = String(dev.os_version || 'Android 13').replace(/^Android\s*|^Windows\s*/i, '').trim();
    const osDigits = osVerRaw.replace(/[^0-9.]/g, '');
    const osParts = osDigits ? osDigits.split('.') : ['13'];
    while (osParts.length < 3) osParts.push('0');
    const platformVersion = osParts.slice(0, 3).join('.');

    const userAgentMetadata = {
      brands,
      fullVersionList,
      platform:        platformName,
      platformVersion: platformVersion,
      architecture:    isMobile ? 'arm' : 'x86',
      model:           isMobile ? (dev.model || 'SM-G998B') : '',
      mobile:          isMobile,
      bitness:         '64',
      wow64:           false,
    };

    const uaOverrideParams = {
      userAgent: ua,
      acceptLanguage: lang,
      platform: dev.platform || (isMobile ? 'Linux armv8l' : 'Win32'),
      userAgentMetadata,
    };

    // Bổ sung Network.setUserAgentOverride song song với Emulation.setUserAgentOverride
    // đảm bảo tất cả Web Worker, Service Worker, background network requests và DOM
    // đều nhận 100% Android User-Agent & Client Hints metadata.
    await client.send('Network.setUserAgentOverride', uaOverrideParams);
    await client.send('Emulation.setUserAgentOverride', uaOverrideParams);

    // ── 4. Touch Events & Mouse-to-Touch Gesture Emulation ──
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: touch });
    if (isMobile) {
      await client.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }).catch(() => {});
    }

    // ── 5. Timezone & Locale ──
    await client.send('Emulation.setTimezoneOverride', { timezoneId: tz });
    await client.send('Emulation.setLocaleOverride',   { locale: lang });

    // ── 6. Geolocation ──
    if (dev.geo) {
      await client.send('Emulation.setGeolocationOverride', {
        latitude:  dev.geo.lat,
        longitude: dev.geo.lng,
        accuracy:  18,
      });
    }

    // ── 7. Tắt AutomationControlled ──
    await client.send('Emulation.setAutomationOverride', { enabled: false });

    // ── Anti-Debugger Bypass (Bỏ qua toàn bộ bẫy debugger; của game/website khi mở DevTools F12) ──
    if (profile && profile.antiDebugger === true && !profile.diagnosticMode) {
      try {
        await client.send('Debugger.enable');
        await client.send('Debugger.setSkipAllPauses', { skip: true });
      } catch(e) {}
    }

    // ── 8. Media features (Dark Mode) ──
    await client.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme',  value: 'dark' },
        { name: 'prefers-reduced-motion', value: 'no-preference' },
      ]
    });

    // ── 9. Đồng bộ Emulation cho các Tab mới / Popups tạo trong phiên mà không để lộ runtime bindings ──
    browser.on('targetcreated', async (target) => {
      if (target.type() === 'page') {
        try {
          const newPage = await target.page();
          if (newPage && !newPage.isClosed()) {
            const newClient = await newPage.createCDPSession();
            await newClient.send('Page.enable').catch(() => {});
            await newClient.send('Network.enable').catch(() => {});
            if ((!profile || !profile.diagnosticMode) && fpScript) {
              await newClient.send('Page.addScriptToEvaluateOnNewDocument', { source: fpScript }).catch(() => {});
            }
            await newClient.send('Network.setExtraHTTPHeaders', {
              headers: { 'Accept-Language': acceptLanguageHeader }
            }).catch(() => {});
            await newClient.send('Network.setUserAgentOverride', uaOverrideParams).catch(() => {});
            await newClient.send('Emulation.setUserAgentOverride', uaOverrideParams).catch(() => {});
            await newClient.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: touch }).catch(() => {});
            if (isMobile) {
              await newClient.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }).catch(() => {});
            }
            if (currentMetricsState) {
              await newClient.send('Emulation.setDeviceMetricsOverride', {
                width:             currentMetricsState.viewportW,
                height:            currentMetricsState.viewportH,
                deviceScaleFactor: dpr,
                mobile:            isMobile,
                screenOrientation: currentMetricsState.screenOrientation,
              }).catch(() => {});
            }
            await newClient.send('Emulation.setTimezoneOverride', { timezoneId: tz }).catch(() => {});
            await newClient.send('Emulation.setLocaleOverride', { locale: lang }).catch(() => {});
            if (dev.geo) {
              await newClient.send('Emulation.setGeolocationOverride', {
                latitude: dev.geo.lat,
                longitude: dev.geo.lng,
                accuracy: 18,
              }).catch(() => {});
            }
            await newClient.send('Emulation.setAutomationOverride', { enabled: false }).catch(() => {});
            if (profile && profile.antiDebugger === true && !profile.diagnosticMode) {
              await newClient.send('Debugger.enable').catch(() => {});
              await newClient.send('Debugger.setSkipAllPauses', { skip: true }).catch(() => {});
            }
          }
        } catch (e) {}
      }
    });

    console.log(`[CDP] ✅ Emulation applied: ${dev.name || dev.model || 'Device'} | ${initBounds.w}x${initBounds.h} DPR=${dpr} | Android CH: ${platformVersion} | arm64 (viewport responsive theo cửa sổ)`);

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

  setStateChangeCallback((stateData) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:state-changed', stateData);
    }
  });

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
        try {
          const defaultDir = path.join(APP_DATA_DIR, 'profiles', String(p.id), 'Default');
          fs.mkdirSync(defaultDir, { recursive: true });
          const historyFile = path.join(defaultDir, 'History');
          const buf = zlib.gunzipSync(Buffer.from(p.webData.historyGz, 'base64'));
          fs.writeFileSync(historyFile, buf);
          if (p.webData.faviconsGz) {
            const fBuf = zlib.gunzipSync(Buffer.from(p.webData.faviconsGz, 'base64'));
            fs.writeFileSync(path.join(defaultDir, 'Favicons'), fBuf);
          }
          console.log(`[Sync Pull] 📜 Đã khôi phục thành công Lịch sử (Ctrl+H) cho profile "${p.name}"!`);
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
    if (fs.existsSync(profilePath)) {
      try {
        const all = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
        const p = all.find(x => x.id === profileId);
        if (p) {
          profileName = p.name || profileId;
          if (res.cookies && res.cookies.length > 0) {
            p.webData = { cookies: res.cookies, count: res.cookies.length, updatedAt: Date.now() };
            fs.writeFileSync(profilePath, JSON.stringify(all, null, 2), 'utf-8');
          }
          if (supabaseManager) {
            await supabaseManager.pushSingleProfile(p);
          }
        }
      } catch(e) {}
    }
    const hasHistory = !!(res.hasHistory || (p && p.webData && p.webData.historyGz));
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
      await supabaseManager.pushAllProfiles(profiles);
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
    if (!manifestUrl && fs.existsSync(settingsPath)) {
      try {
        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        manifestUrl = s.updateManifestUrl;
      } catch(e) {}
    }

    // Nếu người dùng chỉ định URL riêng trong settings
    if (manifestUrl) {
      const resp = await fetch(manifestUrl, { headers: { 'Cache-Control': 'no-cache' } });
      if (!resp.ok) return { ok: false, error: 'Máy chủ phản hồi mã lỗi HTTP: ' + resp.status };
      const manifest = await resp.json();
      return { ok: true, source: 'custom_url', ...manifest };
    }

    // ── Kiểm tra đồng thời từ CẢ 2 NGUỒN GIT (hien151306-byte & hien141t) ──
    const results = await Promise.allSettled(PATCH_SOURCES.map(fetchManifestFromSource));
    const validManifests = results
      .filter(r => r.status === 'fulfilled' && r.value && r.value.ok)
      .map(r => r.value);

    if (validManifests.length === 0) {
      return { ok: false, error: 'Không thể kết nối máy chủ kiểm tra bản vá từ cả 2 nguồn Git (hien151306-byte và hien141t)' };
    }

    // Chọn bản vá có patchNumber cao nhất (mới nhất) giữa 2 nguồn Git
    validManifests.sort((a, b) => (b.patchNumber || 0) - (a.patchNumber || 0));
    const bestManifest = validManifests[0];

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

// Lấy tên extension từ manifest.json (hỗ trợ resolve locale __MSG_xxx__)
function getManifestName(dirPath, fallbackName) {
  const manifestFile = path.join(dirPath, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return fallbackName;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
    let name = manifest.name || fallbackName;
    if (typeof name === 'string' && name.startsWith('__MSG_') && name.endsWith('__')) {
      const key = name.slice(6, -2);
      const locales = [manifest.default_locale, 'en', 'vi', 'en_US', 'vi_VN'].filter(Boolean);
      for (const loc of locales) {
        const msgFile = path.join(dirPath, '_locales', loc, 'messages.json');
        if (fs.existsSync(msgFile)) {
          try {
            const msgs = JSON.parse(fs.readFileSync(msgFile, 'utf-8'));
            if (msgs[key]?.message) {
              name = msgs[key].message;
              break;
            }
          } catch(e){}
        }
      }
    }
    return name;
  } catch(e) {
    return fallbackName;
  }
}

// Tìm kiếm thư mục chứa manifest.json đệ quy (tối đa độ sâu 5)
function findManifestDir(dir, depth = 0) {
  if (depth > 5) return null;
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== '__MACOSX') {
        const found = findManifestDir(path.join(dir, e.name), depth + 1);
        if (found) return found;
      }
    }
  } catch(e){}
  return null;
}

// Giải nén file .zip hoặc .crx an toàn bằng PowerShell Expand-Archive (fallback tar)
function extractArchiveToDir(archivePath, destinationDir) {
  const { execFileSync } = require('child_process');
  const ext = path.extname(archivePath).toLowerCase();
  let zipPath = archivePath;
  const tempExtractDir = path.join(os.tmpdir(), `agy_ext_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(tempExtractDir, { recursive: true });

  try {
    // Nếu là file .crx, bóc header CRX (Cr24) nếu có để chuyển thành zip chuẩn
    if (ext === '.crx') {
      const buf = fs.readFileSync(archivePath);
      let zipOffset = 0;
      if (buf.length > 16 && buf.subarray(0, 4).toString('utf-8') === 'Cr24') {
        const version = buf.readUInt32LE(4);
        if (version === 2) {
          const pubkeyLen = buf.readUInt32LE(8);
          const sigLen = buf.readUInt32LE(12);
          zipOffset = 16 + pubkeyLen + sigLen;
        } else if (version === 3) {
          const headerLen = buf.readUInt32LE(8);
          zipOffset = 12 + headerLen;
        }
      } else {
        const pkIndex = buf.indexOf(Buffer.from([0x50, 0x4B, 0x03, 0x04]));
        if (pkIndex !== -1) {
          zipOffset = pkIndex;
        }
      }

      zipPath = path.join(tempExtractDir, 'archive.zip');
      if (zipOffset > 0 && zipOffset < buf.length) {
        fs.writeFileSync(zipPath, buf.subarray(zipOffset));
      } else {
        fs.copyFileSync(archivePath, zipPath);
      }
    }

    let extracted = false;
    let extractError = null;

    // 1. Thử giải nén bằng PowerShell Expand-Archive (tương thích hoàn hảo Windows, ổ đĩa D:, khoảng trắng)
    if (process.platform === 'win32') {
      try {
        const psScript = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`;
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { stdio: 'pipe' });
        extracted = true;
      } catch (err) {
        extractError = err;
        console.warn('[extractArchiveToDir] PowerShell Expand-Archive failed, trying tar:', err.message);
      }
    }

    // 2. Fallback sang tar -xf
    if (!extracted) {
      try {
        fs.mkdirSync(destinationDir, { recursive: true });
        execFileSync('tar', ['-xf', zipPath, '-C', destinationDir], { stdio: 'pipe' });
        extracted = true;
      } catch (err) {
        console.warn('[extractArchiveToDir] tar -xf failed:', err.message);
        throw new Error(extractError?.message || err.message || 'Không thể giải nén tệp.');
      }
    }
  } finally {
    try {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    } catch(e){}
  }
}

// Xử lý nạp extension từ đường dẫn (thư mục, file zip, crx, manifest.json)
async function importExtensionFromPath(selectedPath) {
  if (!selectedPath || typeof selectedPath !== 'string') {
    return { ok: false, error: 'Đường dẫn tiện ích không hợp lệ.' };
  }

  const cleanPath = selectedPath.trim().replace(/^["']|["']$/g, '');
  if (!fs.existsSync(cleanPath)) {
    return { ok: false, error: `Không tìm thấy đường dẫn: ${cleanPath}` };
  }

  const extId = 'ext_' + Date.now();
  const targetDir = path.join(APP_DATA_DIR, 'custom_extensions', extId);
  const stagingDir = path.join(APP_DATA_DIR, 'custom_extensions', `_staging_${extId}`);

  try {
    const stat = fs.statSync(cleanPath);
    let extName = path.basename(cleanPath);

    if (stat.isDirectory()) {
      const manifestDir = findManifestDir(cleanPath) || cleanPath;
      if (!fs.existsSync(path.join(manifestDir, 'manifest.json'))) {
        return { ok: false, error: 'Không tìm thấy file manifest.json trong thư mục đã chọn!' };
      }
      fs.mkdirSync(targetDir, { recursive: true });
      fs.cpSync(manifestDir, targetDir, { recursive: true });
    } else if (stat.isFile()) {
      const ext = path.extname(cleanPath).toLowerCase();
      if (ext === '.zip' || ext === '.crx') {
        fs.mkdirSync(stagingDir, { recursive: true });
        extractArchiveToDir(cleanPath, stagingDir);

        const manifestDir = findManifestDir(stagingDir);
        if (!manifestDir || !fs.existsSync(path.join(manifestDir, 'manifest.json'))) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
          return { ok: false, error: 'Không tìm thấy file manifest.json trong tệp nén!' };
        }

        fs.mkdirSync(targetDir, { recursive: true });
        // Tự động sao chép nội dung thư mục chứa manifest.json về targetDir (làm phẳng thư mục lồng)
        fs.cpSync(manifestDir, targetDir, { recursive: true });
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } else if (path.basename(cleanPath).toLowerCase() === 'manifest.json') {
        const parentDir = path.dirname(cleanPath);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.cpSync(parentDir, targetDir, { recursive: true });
      } else {
        return { ok: false, error: 'Vui lòng chọn thư mục chứa tiện ích hoặc file nén .zip / .crx.' };
      }
    }

    // Kiểm tra manifest.json ở targetDir
    const manifestFile = path.join(targetDir, 'manifest.json');
    if (!fs.existsSync(manifestFile)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      return { ok: false, error: 'Không tìm thấy file manifest.json trong tiện ích này!' };
    }

    extName = getManifestName(targetDir, extName);
    const extInfo = { ok: true, id: extId, name: extName, path: targetDir, enabled: true };

    // Tự động bổ sung vào extensions.json
    try {
      const extPath = path.join(APP_DATA_DIR, 'extensions.json');
      let list = [];
      if (fs.existsSync(extPath)) {
        try { list = JSON.parse(fs.readFileSync(extPath, 'utf-8')) || []; } catch(e){}
      }
      if (!list.some(e => e.id === extId)) {
        list.push(extInfo);
        fs.writeFileSync(extPath, JSON.stringify(list, null, 2), 'utf-8');
      }
    } catch(e) {
      console.warn('[importExtensionFromPath] Lỗi lưu extensions.json:', e.message);
    }

    return extInfo;
  } catch (err) {
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch(e){}
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch(e){}
    console.error('[importExtensionFromPath] Lỗi:', err);
    return { ok: false, error: 'Lỗi khi nạp tiện ích: ' + err.message };
  }
}

// Load saved extensions & Auto-discovery from APP_DATA_DIR/custom_extensions/
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

  // Tự động quét (Auto-discovery) trong APP_DATA_DIR/custom_extensions/
  let hasDiscovered = false;
  const scanDirs = [
    path.join(APP_DATA_DIR, 'custom_extensions'),
    path.join(__dirname, 'custom_extensions')
  ];

  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_staging_')) continue;
        const subDir = path.join(dir, entry.name);
        const manifestFile = path.join(subDir, 'manifest.json');
        if (fs.existsSync(manifestFile)) {
          // Kiểm tra xem đã có trong validList chưa
          const exists = validList.some(v => v.id === entry.name || (v.path && path.resolve(v.path) === path.resolve(subDir)));
          if (!exists) {
            const extName = getManifestName(subDir, entry.name);
            validList.push({
              ok: true,
              id: entry.name,
              name: extName,
              path: path.resolve(subDir),
              enabled: true
            });
            hasDiscovered = true;
          }
        }
      }
    } catch(e) {
      console.warn('[extensions:load] Lỗi quét custom_extensions:', e.message);
    }
  }

  // Nếu có extension mới phát hiện hoặc danh sách bị thay đổi, lưu lại vào extensions.json
  if (hasDiscovered || validList.length !== list.length) {
    try {
      fs.writeFileSync(extPath, JSON.stringify(validList, null, 2), 'utf-8');
    } catch(e) {
      console.warn('[extensions:load] Lỗi ghi extensions.json:', e.message);
    }
  }

  return validList;
});

// Save extensions
ipcMain.handle('extensions:save', async (event, extensions) => {
  const extPath = path.join(APP_DATA_DIR, 'extensions.json');
  fs.writeFileSync(extPath, JSON.stringify(extensions, null, 2));
  return true;
});

// Select extension folder (unpacked)
ipcMain.handle('extensions:selectFolder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục tiện ích mở rộng (Unpacked Extension)',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return await importExtensionFromPath(result.filePaths[0]);
  } catch (err) {
    console.error('[extensions:selectFolder] Lỗi:', err);
    return { ok: false, error: 'Lỗi khi chọn thư mục tiện ích: ' + err.message };
  }
});

// Select extension file (.zip, .crx)
ipcMain.handle('extensions:selectFile', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn gói tiện ích mở rộng (.zip, .crx)',
      properties: ['openFile'],
      filters: [{ name: 'Extension Pack (.zip, .crx)', extensions: ['zip', 'crx'] }]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return await importExtensionFromPath(result.filePaths[0]);
  } catch (err) {
    console.error('[extensions:selectFile] Lỗi:', err);
    return { ok: false, error: 'Lỗi khi chọn tệp tiện ích: ' + err.message };
  }
});

// Backward compatibility: extensions:select (thông minh dùng openDirectory)
ipcMain.handle('extensions:select', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn tiện ích mở rộng (Thư mục unpacked)',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return await importExtensionFromPath(result.filePaths[0]);
  } catch (err) {
    console.error('[extensions:select] Lỗi:', err);
    return { ok: false, error: 'Lỗi khi nạp tiện ích: ' + err.message };
  }
});

// Import direct path (supporting Drag & Drop from UI)
ipcMain.handle('extensions:importPath', async (event, selectedPath) => {
  try {
    return await importExtensionFromPath(selectedPath);
  } catch (err) {
    console.error('[extensions:importPath] Lỗi:', err);
    return { ok: false, error: 'Lỗi khi nạp tiện ích từ đường dẫn: ' + err.message };
  }
});

// Load app settings
function getAppSettings() {
  const settingsPath = path.join(APP_DATA_DIR, 'settings.json');
  const defaultSettings = { windowWidth: 380, windowHeight: 675, preset: '380x675', mode: 'autoFit', gap: 10, autoArrangeOnLaunch: false, operaPath: '' };
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

    // Cấu hình DevTools tự động mở ở dạng cửa sổ rời (Undocked / Detached)
    // Giúp khi bấm F12:
    // 1. Không làm co giật kích thước cửa sổ game
    // 2. Không làm mất WebGL context của game
    // 3. Website không phát hiện DevTools qua chênh lệch outerWidth/innerHeight
    // 4. Device Toolbar của DevTools không đè lên màn hình game
    if (!prefs.devtools) prefs.devtools = {};
    if (!prefs.devtools.preferences) prefs.devtools.preferences = {};
    prefs.devtools.preferences.currentDockState = '"undocked"';
    prefs.devtools.preferences.lastDockState = '"undocked"';

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

// Calculate window position with Auto Fit Grid, Grid or Cascade layout options
function calculateGridPosition(index, totalRunning = 1, profileCustomWin = null, customOpts = null, profile = null) {
  try {
    const settings = getAppSettings();
    const opts = { ...settings, ...(customOpts || {}) };
    return engineCalculateGridPosition(index, totalRunning, profileCustomWin, opts, profile);
  } catch(e) {
    console.error('[calculateGridPosition error]', e);
    return { posX: 10 + (index * 20), posY: 10 + (index * 20), winW: 380, winH: 675, colsPerRow: 3, mode: 'autoFit' };
  }
}

// (Legacy helper retained for safety)
function legacyCalculateGridPosition(index, totalRunning = 1, profileCustomWin = null, customOpts = null, profile = null) {
  try {
    const { screen } = require('electron');
    const displays = screen ? screen.getAllDisplays() : [];
    const settings = getAppSettings();
    const opts = { ...settings, ...(customOpts || {}) };

    const displayIdx = parseInt(opts.displayIndex) || 0;
    const targetDisplay = (displays && displays[displayIdx]) || (screen ? screen.getPrimaryDisplay() : null) || {
      bounds: { width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 }
    };
    const { x, y, width, height } = targetDisplay.workArea || targetDisplay.bounds;

    const actualProfile = profile || (profileCustomWin && (profileCustomWin.id || profileCustomWin.device || profileCustomWin.deviceId) ? profileCustomWin : null);
    const customWin = (profileCustomWin && profileCustomWin.width && profileCustomWin.height) ? profileCustomWin : (actualProfile ? actualProfile.customWindow : null);

    // Resolve device
    let dev = null;
    if (actualProfile) {
      if (actualProfile.device) {
        dev = actualProfile.device;
      } else if (actualProfile.deviceId) {
        const devices = loadDevicesFromDisk();
        const list = Array.isArray(devices) ? devices : (devices.devices || []);
        dev = list.find(d => d.id === actualProfile.deviceId);
      }
    }
    dev = dev || {};

    const devW = dev?.viewport?.width || dev?.screen_width || 412;
    const devH = dev?.viewport?.height || dev?.screen_height || 915;
    const baseRatio = devW / devH;
    const isMobile = dev.is_mobile !== false;

    let orientationLock = actualProfile?.orientationLock;
    if (!orientationLock) {
      orientationLock = isMobile ? 'portrait' : 'auto';
    }
    if (orientationLock !== 'portrait' && orientationLock !== 'landscape') {
      orientationLock = 'auto';
    }

    const mode = opts.mode || opts.layoutMode || 'autoFit'; // 'autoFit' | 'grid' | 'cascade'

    // Gaps and margins (defaults to 10px)
    const gap = opts.gap !== undefined ? parseInt(opts.gap) : (opts.gapX !== undefined ? parseInt(opts.gapX) : 10);
    const gapX = opts.gapX !== undefined ? parseInt(opts.gapX) : (isNaN(gap) ? 10 : gap);
    const gapY = opts.gapY !== undefined ? parseInt(opts.gapY) : (isNaN(gap) ? 10 : gap);
    const startX = opts.startX !== undefined ? parseInt(opts.startX) : gapX;
    const startY = opts.startY !== undefined ? parseInt(opts.startY) : gapY;

    // Chrome UI chrome padding constants (tab bar + address bar + window border)
    const UI_DELTA_X = 16;
    const UI_DELTA_Y = 110;

    let posX = x + startX;
    let posY = y + startY;
    let winW = parseInt(opts.winW) || parseInt(opts.windowWidth) || 380;
    let winH = parseInt(opts.winH) || parseInt(opts.windowHeight) || 675;

    if (customWin && customWin.width && customWin.height) {
      winW = parseInt(customWin.width) || winW;
      winH = parseInt(customWin.height) || winH;
    }

    if (mode === 'autoFit') {
      const total = Math.max(1, totalRunning);
      let cols = 1;
      let rows = 1;

      if (total <= 1) {
        cols = 1; rows = 1;
      } else if (total === 2) {
        cols = 2; rows = 1;
      } else if (total === 3) {
        cols = (width >= 1200) ? 3 : 2;
        rows = Math.ceil(total / cols);
      } else if (total === 4) {
        cols = 2; rows = 2;
      } else if (total <= 6) {
        cols = 3; rows = 2;
      } else if (total <= 8) {
        cols = 4; rows = 2;
      } else if (total <= 10) {
        cols = 5; rows = 2;
      } else if (total <= 12) {
        cols = 4; rows = 3;
      } else if (total <= 15) {
        cols = 5; rows = 3;
      } else if (total <= 16) {
        cols = 4; rows = 4;
      } else if (total <= 20) {
        cols = 5; rows = 4;
      } else {
        cols = Math.min(8, Math.max(2, Math.ceil(Math.sqrt(total * (width / height)))));
        rows = Math.ceil(total / cols);
      }

      const availAreaW = width - (startX * 2) - (cols - 1) * gapX;
      const cellW = Math.max(120, Math.floor(availAreaW / cols));
      const availAreaH = height - (startY * 2) - (rows - 1) * gapY;
      const cellH = Math.max(150, Math.floor(availAreaH / rows));

      if (orientationLock === 'portrait') {
        const targetRatio = baseRatio;
        const maxContentH = Math.max(80, cellH - UI_DELTA_Y);
        let contentW = Math.round(maxContentH * targetRatio);
        let candWinW = contentW + UI_DELTA_X;
        let candWinH = cellH;

        if (candWinW > cellW) {
          candWinW = cellW;
          const constrainedContentW = Math.max(50, cellW - UI_DELTA_X);
          candWinH = Math.min(cellH, Math.round(constrainedContentW / targetRatio) + UI_DELTA_Y);
        }
        winW = candWinW;
        winH = candWinH;
      } else if (orientationLock === 'landscape') {
        const targetRatio = devH / devW;
        const maxContentW = Math.max(80, cellW - UI_DELTA_X);
        let contentH = Math.round(maxContentW / targetRatio);
        let candWinH = contentH + UI_DELTA_Y;
        let candWinW = cellW;

        if (candWinH > cellH) {
          candWinH = cellH;
          const constrainedContentH = Math.max(50, cellH - UI_DELTA_Y);
          candWinW = Math.min(cellW, Math.round(constrainedContentH * targetRatio) + UI_DELTA_X);
        }
        winW = candWinW;
        winH = candWinH;
      } else {
        // 'auto' mode: fills the cell completely
        winW = cellW;
        winH = cellH;
      }

      // Clamp so never overflows display workArea
      winW = Math.min(winW, width - startX);
      winH = Math.min(winH, height - startY);

      const colIndex = index % cols;
      const rowIndex = Math.floor(index / cols);

      const cellX = x + startX + (colIndex * (cellW + gapX));
      const cellY = y + startY + (rowIndex * (cellH + gapY));

      // Left align inside cell
      posX = cellX;
      posY = cellY;

      // Ensure window does not overflow screen boundaries
      if (posX + winW > x + width) posX = Math.max(x, x + width - winW);
      if (posY + winH > y + height) posY = Math.max(y, y + height - winH);

      return { posX, posY, winW, winH, colsPerRow: cols, rows, mode: 'autoFit' };
    }

    if (mode === 'cascade') {
      if (orientationLock === 'portrait') {
        const availH = Math.max(100, winH - UI_DELTA_Y);
        winW = Math.round(availH * baseRatio) + UI_DELTA_X;
      } else if (orientationLock === 'landscape') {
        const availH = Math.max(100, winH - UI_DELTA_Y);
        winW = Math.round(availH * (devH / devW)) + UI_DELTA_X;
      }
      winW = Math.min(Math.max(winW, 120), width - 40);
      winH = Math.min(Math.max(winH, 150), height - 40);

      const cascadeStep = Math.max(25, gapX || 30);
      const maxCols = Math.max(1, Math.floor((width - winW - startX) / cascadeStep));
      const maxRows = Math.max(1, Math.floor((height - winH - startY) / cascadeStep));
      const cycle = Math.min(maxCols, maxRows) || 8;
      const stepIndex = index % cycle;

      posX = x + startX + (stepIndex * cascadeStep);
      posY = y + startY + (stepIndex * cascadeStep);

      if (posX + winW > x + width) posX = Math.max(x, x + width - winW);
      if (posY + winH > y + height) posY = Math.max(y, y + height - winH);

      return { posX, posY, winW, winH, colsPerRow: 1, mode: 'cascade' };
    }

    // Default 'grid' mode:
    if (orientationLock === 'portrait') {
      const availH = Math.max(100, winH - UI_DELTA_Y);
      winW = Math.round(availH * baseRatio) + UI_DELTA_X;
    } else if (orientationLock === 'landscape') {
      const availH = Math.max(100, winH - UI_DELTA_Y);
      winW = Math.round(availH * (devH / devW)) + UI_DELTA_X;
    }
    winW = Math.min(Math.max(winW, 120), width - 40);
    winH = Math.min(Math.max(winH, 150), height - 40);

    let colsPerRow = parseInt(opts.colsPerRow) || 3;
    if (opts.autoAdapt !== false) {
      colsPerRow = Math.max(1, Math.floor((width - startX) / (winW + gapX)));
    }

    const colIndex = index % colsPerRow;
    const rowIndex = Math.floor(index / colsPerRow);
    posX = x + startX + (colIndex * (winW + gapX));
    posY = y + startY + (rowIndex * (winH + gapY));

    if (posX + winW > x + width) posX = Math.max(x, x + width - winW);
    if (posY + winH > y + height) posY = Math.max(y, y + height - winH);

    return { posX, posY, winW, winH, colsPerRow, mode: 'grid' };
  } catch(e) {
    console.error('[calculateGridPosition error]', e);
    return { posX: 10 + (index * 20), posY: 10 + (index * 20), winW: 380, winH: 675, colsPerRow: 3, mode: 'autoFit' };
  }
}

// Rearrange all currently running browser windows into clean layout
async function arrangeRunningWindows(customOpts = {}) {
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
    const settingsPath = path.join(APP_DATA_DIR, 'settings.json');
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
    } catch(e){}
  }

  const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
  let allProfiles = [];
  if (fs.existsSync(profilePath)) {
    try {
      allProfiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    } catch(e){}
  }

  const N = runningList.length;
  const puppeteer = require('puppeteer-core');

  for (let idx = 0; idx < runningList.length; idx++) {
    const pInfo = runningList[idx];
    const profile = allProfiles.find(p => p.id === pInfo.id) || null;
    const pos = calculateGridPosition(idx, N, profile ? profile.customWindow : null, customOpts, profile);

    const isDiagnostic = !!(profile && profile.diagnosticMode);
    const profileDirName = getProfileDirectoryName(pInfo.id, isDiagnostic);
    const profileDir = path.join(APP_DATA_DIR, 'profiles', profileDirName);
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

  const currentSettings = getAppSettings();
  return { ok: true, count: N, mode: customOpts.mode || currentSettings.mode || 'autoFit' };
}

let autoArrangeTimer = null;
function triggerAutoArrangeIfNeeded() {
  try {
    const settings = getAppSettings();
    if (settings && settings.autoArrangeOnLaunch === true) {
      clearTimeout(autoArrangeTimer);
      autoArrangeTimer = setTimeout(() => {
        arrangeRunningWindows().catch(err => {
          console.warn('[AutoArrange Error]', err.message);
        });
      }, 300);
    }
  } catch(e) {}
}

ipcMain.handle('windows:arrange', async (event, opts = {}) => {
  return await arrangeRunningWindows(opts);
});

ipcMain.handle('browser:arrangeWindows', async (event, customOpts = {}) => {
  return await arrangeRunningWindows(customOpts);
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

// ══════════════════════════════════════════════════════════════════
// ── OPERA BROWSER LIFECYCLE & FINGERPRINT MANAGER IPC HANDLERS ──
// ══════════════════════════════════════════════════════════════════

// Launch browser (Opera Engine với State Machine & Navigation Verification)
ipcMain.handle('browser:launch', async (event, profile) => {
  console.log(`[IPC browser:launch] Nhận yêu cầu khởi chạy profile: "${profile?.name || profile?.id}" (ID: ${profile?.id})`);
  try {
    if (!profile || !profile.id) {
      const err = '[INVALID_ARGUMENT] Profile không hợp lệ hoặc thiếu profileId';
      console.error(`[IPC browser:launch] Lỗi: ${err}`);
      return { ok: false, errorCode: 'INVALID_ARGUMENT', error: err };
    }

    const isDiagnostic = !!profile.diagnosticMode;
    const profileDirName = isDiagnostic ? `clean_${profile.id}` : profile.id;
    const profileDir = path.join(APP_DATA_DIR, 'profiles', profileDirName);
    fs.mkdirSync(profileDir, { recursive: true });

    // Khôi phục Lịch sử web & Favicons nếu có
    const defaultDir = path.join(profileDir, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    if (!isDiagnostic && profile.webData && profile.webData.historyGz) {
      try {
        const historyFile = path.join(defaultDir, 'History');
        let shouldRestore = !fs.existsSync(historyFile);
        if (!shouldRestore && profile.webData.historyUpdatedAt) {
          const stats = fs.statSync(historyFile);
          if (profile.webData.historyUpdatedAt > stats.mtimeMs) shouldRestore = true;
        }
        if (shouldRestore) {
          const buf = zlib.gunzipSync(Buffer.from(profile.webData.historyGz, 'base64'));
          fs.writeFileSync(historyFile, buf);
        }
      } catch (errH) {}
    }

    const extPaths = [];
    let injectScript = null;
    if (!isDiagnostic) {
      const fpResult = getFingerprint(APP_DATA_DIR, profile.id);
      const fpData = fpResult.ok ? fpResult.fingerprint : null;
      injectScript = generateFingerprintScript(profile.device, profile.orientationLock, fpData);

      const selectedIds = new Set(Array.isArray(profile.selectedExtensions) ? profile.selectedExtensions : []);
      const allExtsFile = path.join(APP_DATA_DIR, 'extensions.json');
      if (fs.existsSync(allExtsFile) && selectedIds.size > 0) {
        try {
          const allExts = JSON.parse(fs.readFileSync(allExtsFile, 'utf-8'));
          for (const item of allExts) {
            if (!selectedIds.has(item.id)) continue;
            if (item.enabled === false) continue;
            const resolved = resolveExtensionPath(item);
            if (resolved) extPaths.push(resolved);
          }
        } catch(e) {}
      }
    }

    const settings = getAppSettings();
    const customBrowserPath = profile.browserPath || profile.chromePath || profile.operaPath || settings.browserPath || settings.chromePath || settings.operaPath || null;

    const launchResult = await launchBrowserProfile({
      profile,
      appDataDir: APP_DATA_DIR,
      customBrowserPath,
      injectScript,
      extPaths,
      mainWindow,
      getProfileNum: (p) => {
        let num = p.profileNum;
        if (!num) {
          try {
            const allProfiles = JSON.parse(fs.readFileSync(path.join(APP_DATA_DIR, 'profiles.json'), 'utf-8'));
            const idx = allProfiles.findIndex(x => x.id === p.id);
            if (idx >= 0) num = idx + 1;
          } catch(e) {}
        }
        return num || 1;
      },
      startLocalProxy,
      generateProfileIcon,
    });

    if (launchResult.ok && launchResult.pid) {
      console.log(`[IPC browser:launch] 🚀 Khởi chạy THÀNH CÔNG profile "${profile.name}" (PID: ${launchResult.pid}, CDP Port: ${launchResult.debugPort})`);
      launchedBrowsers.set(profile.id, {
        pid: launchResult.pid,
        startTime: Date.now(),
        debugPort: launchResult.debugPort
      });
      triggerAutoArrangeIfNeeded();
    } else {
      console.error(`[IPC browser:launch] ❌ Khởi chạy THẤT BẠI profile "${profile.name}":`, launchResult.error);
    }

    return launchResult;
  } catch (err) {
    console.error('[Browser Launch Exception]', err);
    return { ok: false, errorCode: 'LAUNCH_EXCEPTION', error: `[LAUNCH_EXCEPTION] ${err.message}` };
  }
});

// Immediate Cancel during launch
ipcMain.handle('browser:cancel', async (event, profileId) => {
  try {
    launchedBrowsers.delete(profileId);
    const res = await cancelLaunch(profileId);
    triggerAutoArrangeIfNeeded();
    return res;
  } catch (err) {
    console.error('[Browser Cancel Error]', err);
    return { ok: false, error: err.message };
  }
});

// Close browser
ipcMain.handle('browser:close', async (event, profileId) => {
  try {
    launchedBrowsers.delete(profileId);
    await closeOperaProfile(profileId);
    triggerAutoArrangeIfNeeded();
    return { ok: true };
  } catch (err) {
    console.error('[Close Browser Error]', err);
    return { ok: false, error: err.message };
  }
});

// Browser status query
ipcMain.handle('browser:status', async () => {
  return getAllBrowserStatuses();
});

// Browser discovery & validation API (Chromium / Google Chrome / CloakBrowser)
ipcMain.handle('browser:info', async (event, customPath) => {
  return findBrowserBinary(customPath);
});
ipcMain.handle('opera:info', async (event, customPath) => {
  return findBrowserBinary(customPath);
});

// ── Fingerprint Manager IPC Handlers ──
ipcMain.handle('fingerprint:get', async (event, profileId) => {
  return getFingerprint(APP_DATA_DIR, profileId);
});

ipcMain.handle('fingerprint:update', async (event, profileId, settings) => {
  return updateFingerprint(APP_DATA_DIR, profileId, settings);
});

ipcMain.handle('fingerprint:generate', async (event, profileId, opts) => {
  return generateFingerprint(APP_DATA_DIR, profileId, opts);
});

ipcMain.handle('fingerprint:reset', async (event, profileId) => {
  return resetFingerprint(APP_DATA_DIR, profileId);
});

ipcMain.handle('fingerprint:validate', async (event, profileId) => {
  return validateFingerprint(APP_DATA_DIR, profileId);
});

// ── Helper trích xuất file History và Favicons của profile ──
function getProfileHistoryData(profileId) {
  let historyGz = null;
  let faviconsGz = null;
  try {
    const defaultDir = path.join(APP_DATA_DIR, 'profiles', String(profileId), 'Default');
    const historyFile = path.join(defaultDir, 'History');
    if (fs.existsSync(historyFile)) {
      const hBuf = fs.readFileSync(historyFile);
      if (hBuf.length > 0) {
        historyGz = zlib.gzipSync(hBuf).toString('base64');
      }
    }
    const faviconsFile = path.join(defaultDir, 'Favicons');
    if (fs.existsSync(faviconsFile)) {
      const fBuf = fs.readFileSync(faviconsFile);
      if (fBuf.length > 0) {
        faviconsGz = zlib.gzipSync(fBuf).toString('base64');
      }
    }
  } catch (err) {
    console.warn(`[Sync History] Không thể đọc History/Favicons cho ${profileId}:`, err.message);
  }
  return { historyGz, faviconsGz };
}

// ── Trích xuất Cookies & Lịch sử (Ctrl+H) toàn diện cho Profile (Hỗ trợ cả khi profile đang MỞ hoặc đã ĐÓNG) ──
async function extractProfileCookies(profileId) {
  const runningInfo = launchedBrowsers.get(profileId);
  const { historyGz, faviconsGz } = getProfileHistoryData(profileId);

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
            updatedAt: Date.now()
          };
          if (historyGz) {
            payload.historyGz = historyGz;
            payload.historyUpdatedAt = Date.now();
          }
          if (faviconsGz) payload.faviconsGz = faviconsGz;
          saveProfileWebData(profileId, payload);
          return { ok: true, cookies: clean, count: clean.length, hasHistory: !!historyGz, source: 'active' };
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
              updatedAt: Date.now()
            };
            if (historyGz) {
              payload.historyGz = historyGz;
              payload.historyUpdatedAt = Date.now();
            }
            if (faviconsGz) payload.faviconsGz = faviconsGz;
            saveProfileWebData(profileId, payload);
            return { ok: true, cookies: clean, count: clean.length, hasHistory: !!historyGz, source: 'headless' };
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
        if (historyGz) {
          p.webData.historyGz = historyGz;
          p.webData.historyUpdatedAt = Date.now();
          if (faviconsGz) p.webData.faviconsGz = faviconsGz;
          saveProfileWebData(profileId, p.webData);
        }
        return { ok: true, cookies: p.webData.cookies, count: p.webData.cookies.length, hasHistory: !!(historyGz || p.webData.historyGz), source: 'cache' };
      }
    } catch(e){}
  }

  if (historyGz) {
    saveProfileWebData(profileId, { historyGz, faviconsGz, historyUpdatedAt: Date.now(), updatedAt: Date.now() });
    return { ok: true, cookies: [], count: 0, hasHistory: true, source: 'history-only' };
  }

  return { ok: true, cookies: [], count: 0, hasHistory: false, source: 'empty' };
}

// ── Đóng Chrome đúng cách: dùng CDP Browser.close() trước, mới force kill ──
function saveProfileWebData(profileId, webData) {
  try {
    const profilePath = path.join(APP_DATA_DIR, 'profiles.json');
    if (!fs.existsSync(profilePath)) return;
    let profiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    const p = profiles.find(x => x.id === profileId);
    if (p) {
      p.webData = {
        ...(p.webData || {}),
        ...webData,
        updatedAt: Date.now()
      };
      fs.writeFileSync(profilePath, JSON.stringify(profiles, null, 2), 'utf-8');
      if (supabaseManager && supabaseManager.currentUser) {
        supabaseManager.pushSingleProfile(p).then(() => {
          console.log(`[Cloud Sync] ☁️ Đã tự động đồng bộ Web Data & History của profile "${p.name}" lên Cloud!`);
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
          await client.send('Network.enable');
          const { cookies } = await client.send('Network.getAllCookies');
          const clean = (cookies && cookies.length > 0) ? sanitizeCookiesForCDP(cookies) : [];
          const { historyGz, faviconsGz } = getProfileHistoryData(profileId);
          console.log(`[Sync] 🍪 Thu thập được ${clean.length} cookies ${historyGz ? '+ Lịch sử Ctrl+H' : ''} của profile ${profileId}`);
          saveProfileWebData(profileId, {
            cookies: clean,
            count: clean.length,
            historyGz,
            faviconsGz,
            historyUpdatedAt: historyGz ? Date.now() : undefined,
            updatedAt: Date.now()
          });
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
        triggerAutoArrangeIfNeeded();
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
    triggerAutoArrangeIfNeeded();
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

    // 5. Xóa toàn bộ thư mục profile trên ổ đĩa (bao gồm cả thư mục clean profile nếu có)
    const dirsToDelete = [
      path.join(APP_DATA_DIR, 'profiles', String(profileId)),
      path.join(APP_DATA_DIR, 'profiles', `clean_${profileId}`)
    ];
    for (const pDir of dirsToDelete) {
      if (fs.existsSync(pDir)) {
        try {
          fs.rmSync(pDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        } catch(e) {
          console.error('[rmSync retry failed, attempting cmd rmdir]', e);
        }
        // Fallback: dùng rmdir của Windows CMD
        if (fs.existsSync(pDir)) {
          if (process.platform === 'win32') {
            try {
              const { execSync } = require('child_process');
              const winNormalizedPath = path.normalize(pDir).replace(/\//g, '\\');
              execSync(`cmd /c rmdir /s /q "${winNormalizedPath}"`);
            } catch(e) {
              console.error('[cmd rmdir error]', e);
            }
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
// ── Generate fingerprint injection script (Stealth Native Patch) ──
// (Modularized in src/fingerprintGenerator.js - imported at top of file)

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

    const { name, deviceId, proxy, cityKey, startUrl, notes, customWindow, selectedExtensions, diagnosticMode, antiDebugger, orientationLock, autoArrangeOnLaunch } = body;

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

    const isDiag = !!diagnosticMode;
    const isAntiDbg = isDiag ? false : !!antiDebugger;
    const validOrientations = ['auto', 'portrait', 'landscape'];
    const resolvedOrientation = validOrientations.includes(orientationLock) ? orientationLock : 'auto';

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
      orientationLock: resolvedOrientation,
      autoArrangeOnLaunch: autoArrangeOnLaunch === true,
      diagnosticMode: isDiag,
      antiDebugger: isAntiDbg,
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

    console.log(`[API] ✅ Tạo profile: "${newProfile.name}" | device: ${chosenDevice.name} | city: ${cityInfo.name} | diag: ${isDiag} | antiDbg: ${isAntiDbg}`);
    return sendJSON(res, 201, { ok: true, message: 'Profile đã được tạo thành công.', profile: newProfile });
  }

  // ── PUT /api/profiles/:id ── cập nhật profile
  if (method === 'PUT' && matchSingle) {
    const id = matchSingle[1];
    let body;
    try { body = await readBody(req); } catch(e) { return sendJSON(res, 400, { ok: false, error: e.message }); }

    let profiles = loadProfilesFromDisk();
    const idx = profiles.findIndex(p => p.id === id);
    if (idx < 0) return sendJSON(res, 404, { ok: false, error: `Profile "${id}" không tồn tại.` });

    const existing = profiles[idx];
    const isDiag = body.diagnosticMode !== undefined ? !!body.diagnosticMode : !!existing.diagnosticMode;
    const isAntiDbg = isDiag ? false : (body.antiDebugger !== undefined ? !!body.antiDebugger : !!existing.antiDebugger);
    const validOrientations = ['auto', 'portrait', 'landscape'];
    const resolvedOrientation = body.orientationLock !== undefined && validOrientations.includes(body.orientationLock)
      ? body.orientationLock
      : (existing.orientationLock || 'auto');

    profiles[idx] = {
      ...existing,
      name: body.name ? body.name.trim() : existing.name,
      deviceId: body.deviceId || existing.deviceId,
      proxy: body.proxy !== undefined ? body.proxy : existing.proxy,
      startUrl: body.startUrl !== undefined ? body.startUrl.trim() : existing.startUrl,
      notes: body.notes !== undefined ? body.notes.trim() : existing.notes,
      customWindow: body.customWindow !== undefined ? body.customWindow : existing.customWindow,
      selectedExtensions: Array.isArray(body.selectedExtensions) ? body.selectedExtensions : existing.selectedExtensions,
      orientationLock: resolvedOrientation,
      autoArrangeOnLaunch: body.autoArrangeOnLaunch !== undefined ? !!body.autoArrangeOnLaunch : !!existing.autoArrangeOnLaunch,
      diagnosticMode: isDiag,
      antiDebugger: isAntiDbg,
      updatedAt: Date.now(),
    };

    saveProfilesToDisk(profiles);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('profiles:reload');
    }
    return sendJSON(res, 200, { ok: true, message: 'Profile đã được cập nhật.', profile: profiles[idx] });
  }

  // ── DELETE /api/profiles/:id ── soft-delete profile vào Thùng Rác
  if (method === 'DELETE' && matchSingle) {
    const id = matchSingle[1];
    let profiles = loadProfilesFromDisk();
    const target = profiles.find(p => p.id === id);
    if (!target) return sendJSON(res, 404, { ok: false, error: `Profile "${id}" không tồn tại.` });

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
    for (const pName of [String(id), `clean_${id}`]) {
      const profileDir = path.join(APP_DATA_DIR, 'profiles', pName);
      if (fs.existsSync(profileDir)) {
        try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch(e) { console.warn('[API] Không xóa được thư mục:', e.message); }
      }
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

      const isDiagnostic = !!profile.diagnosticMode;
      const profileDirName = isDiagnostic ? `clean_${id}` : id;
      const profileDir = path.join(APP_DATA_DIR, 'profiles', profileDirName);
      fs.mkdirSync(profileDir, { recursive: true });

      const extPaths = [];
      let injectScript = null;

      if (!isDiagnostic) {
        // Fingerprint được tiêm độc quyền và an toàn qua CDP Page.addScriptToEvaluateOnNewDocument (tránh tiêm 2 lần)
        injectScript = generateFingerprintScript(device, profile.orientationLock);

        const selectedIds = new Set(Array.isArray(profile.selectedExtensions) ? profile.selectedExtensions : []);
        const allExtsFile = path.join(APP_DATA_DIR, 'extensions.json');
        if (fs.existsSync(allExtsFile) && selectedIds.size > 0) {
          try {
            const allExts = JSON.parse(fs.readFileSync(allExtsFile, 'utf-8'));
            for (const item of allExts) {
              if (!selectedIds.has(item.id)) continue;
              if (item.enabled === false) continue;
              const resolved = resolveExtensionPath(item);
              if (resolved) extPaths.push(resolved);
            }
          } catch(e) {
            console.warn('[API Launch] Lỗi đọc extensions.json:', e.message);
          }
        }
      }

      const settings = getAppSettings();
      const customBrowserPath = profile.browserPath || profile.chromePath || profile.operaPath || settings.browserPath || settings.chromePath || settings.operaPath || null;

      const launchResult = await launchBrowserProfile({
        profile: { ...profile, id },
        appDataDir: APP_DATA_DIR,
        customBrowserPath,
        injectScript,
        extPaths,
        mainWindow,
        getProfileNum: (p) => {
          let num = p.profileNum;
          if (!num) {
            try {
              const allProfiles = JSON.parse(fs.readFileSync(path.join(APP_DATA_DIR, 'profiles.json'), 'utf-8'));
              const idx = allProfiles.findIndex(x => x.id === (p.id || id));
              if (idx >= 0) num = idx + 1;
            } catch(e) {}
          }
          return num || 1;
        },
        startLocalProxy,
        generateProfileIcon,
      });

      if (!launchResult.ok) {
        return sendJSON(res, 500, {
          ok: false,
          errorCode: launchResult.errorCode || 'LAUNCH_FAILED',
          error: launchResult.error || 'Khởi chạy Opera thất bại'
        });
      }

      launchedBrowsers.set(id, {
        pid: launchResult.pid,
        startTime: Date.now(),
        debugPort: launchResult.debugPort
      });
      triggerAutoArrangeIfNeeded();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('profiles:reload');

      return sendJSON(res, 200, {
        ok: true,
        pid: launchResult.pid,
        debugPort: launchResult.debugPort,
        profileId: id,
        profileName: profile.name,
        state: 'READY'
      });
    } catch(err) {
      console.error('[API Launch Exception]', err);
      return sendJSON(res, 500, { ok: false, error: err.message });
    }
  }

  // ── POST /api/windows/arrange ── sắp xếp lại tất cả cửa sổ
  if (method === 'POST' && pathname === '/api/windows/arrange') {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch(e){}
    const result = await arrangeRunningWindows(body);
    return sendJSON(res, 200, result);
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
