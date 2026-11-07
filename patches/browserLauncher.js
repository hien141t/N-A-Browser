/**
 * N/A Browser - Chromium Engine & Browser Lifecycle Manager
 * Primary engine: Chromium / Google Chrome / CloakBrowser
 * 
 * Features:
 * - Multi-platform binary discovery (CloakBrowser, Chrome, Chromium, Edge, Opera fallback)
 * - State Machine: STOPPED -> STARTING -> CONNECTING -> NAVIGATING -> READY
 * - Immediate Cancel without orphan processes or data loss
 * - Isolated Profile Directories (clean_<id> for diagnostic mode)
 * - CDP emulation: Viewport, DPR, Screen Orientation, Touch, Mobile, Timezone, User-Agent
 * - Fingerprint script injection via CDP Page.addScriptToEvaluateOnNewDocument
 * - Authenticated Proxy support with local proxy tunneling
 * - Clear separation: Chromium engine vs device presets (no false "Opera thật" claims)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const { calculateGridPosition } = require('./layoutEngine');

// ── State Machine Constants ──
const LAUNCH_STATES = {
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  CONNECTING: 'CONNECTING',
  NAVIGATING: 'NAVIGATING',
  READY: 'READY',
  CANCELLING: 'CANCELLING',
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR',
};

// Map of currently running or launching sessions: profileId -> LaunchSession
const activeSessions = new Map();

// Global callback for state broadcasts to Electron renderer
let stateChangeCallback = null;

function setStateChangeCallback(cb) {
  stateChangeCallback = cb;
}

function broadcastState(profileId, state, message = '', extra = {}) {
  const session = activeSessions.get(profileId);
  if (session) {
    session.state = state;
    session.message = message;
  }
  if (typeof stateChangeCallback === 'function') {
    stateChangeCallback({
      profileId,
      state,
      message,
      timestamp: Date.now(),
      ...extra,
    });
  }
}

/**
 * Searches and validates Chromium / Chrome / CloakBrowser executable on the host system.
 * Prioritizes:
 * 1. customBrowserPath (from profile or settings.json)
 * 2. CloakHQ C++ Engine Patched Stealth Chromium (.cloakbrowser)
 * 3. Google Chrome Stable (C:\Program Files\Google\Chrome\Application\chrome.exe)
 * 4. Chromium
 * 5. Microsoft Edge (Chromium-based)
 * 6. Opera (fallback if no Chrome/Chromium found)
 */
function findBrowserBinary(customPath = null) {
  if (customPath && typeof customPath === 'string' && customPath.trim().length > 0) {
    const trimmed = customPath.trim();
    if (fs.existsSync(trimmed)) {
      try {
        const stats = fs.statSync(trimmed);
        if (stats.isFile()) {
          const lcase = trimmed.toLowerCase();
          const name = lcase.includes('cloak') ? 'CloakBrowser' : (lcase.includes('chrome') ? 'Google Chrome' : (lcase.includes('edge') ? 'Microsoft Edge' : 'Chromium'));
          return { found: true, path: trimmed, name, engine: 'Chromium Engine', isCustom: true };
        }
      } catch (e) {}
    }
    return {
      found: false,
      path: null,
      error: `Không tìm thấy trình duyệt tại đường dẫn tùy chỉnh: "${trimmed}". Vui lòng kiểm tra lại đường dẫn!`
    };
  }

  // Check saved settings if no explicit customPath provided
  let savedOperaFallback = null;
  try {
    const settingsPaths = [
      path.join(__dirname, '..', 'settings.json'),
      path.join(__dirname, 'settings.json'),
      path.join(process.cwd(), 'settings.json'),
    ];
    for (const sp of settingsPaths) {
      if (fs.existsSync(sp)) {
        const cfg = JSON.parse(fs.readFileSync(sp, 'utf-8'));
        const savedChrome = cfg.chromePath || cfg.browserPath;
        if (savedChrome && typeof savedChrome === 'string' && fs.existsSync(savedChrome.trim())) {
          const stats = fs.statSync(savedChrome.trim());
          if (stats.isFile()) {
            const lcase = savedChrome.toLowerCase();
            const name = lcase.includes('cloak') ? 'CloakBrowser' : (lcase.includes('chrome') ? 'Google Chrome' : (lcase.includes('edge') ? 'Microsoft Edge' : 'Chromium'));
            return { found: true, path: savedChrome.trim(), name, engine: 'Chromium Engine', isCustom: true };
          }
        }
        if (cfg.operaPath && typeof cfg.operaPath === 'string' && fs.existsSync(cfg.operaPath.trim())) {
          savedOperaFallback = cfg.operaPath.trim();
        }
      }
    }
  } catch (e) {}

  // 1. CloakHQ C++ Patched Stealth Chromium
  const cloakCandidates = [
    path.join(os.homedir(), '.cloakbrowser'),
    'C:\\Users\\hien666shop\\.cloakbrowser',
    'C:\\Users\\hien1\\.cloakbrowser',
  ];
  for (const cDir of cloakCandidates) {
    if (fs.existsSync(cDir)) {
      try {
        const subs = fs.readdirSync(cDir);
        for (const sub of subs) {
          const exeWin = path.join(cDir, sub, 'chrome.exe');
          const exeLinux = path.join(cDir, sub, 'chrome');
          if (fs.existsSync(exeWin) && fs.statSync(exeWin).isFile()) {
            return { found: true, path: exeWin, name: 'CloakBrowser', engine: 'CloakHQ Stealth Chromium', isCloak: true };
          }
          if (fs.existsSync(exeLinux) && fs.statSync(exeLinux).isFile()) {
            return { found: true, path: exeLinux, name: 'CloakBrowser', engine: 'CloakHQ Stealth Chromium', isCloak: true };
          }
        }
      } catch (e) {}
    }
  }

  const candidates = [];
  const localAppData = process.env.LOCALAPPDATA || '';
  const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const systemDrive = process.env.SystemDrive || 'C:';

  if (process.platform === 'win32') {
    // 2. Google Chrome (Highest priority for stability and cross-user support)
    candidates.push(
      { path: path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), name: 'Google Chrome' },
      { path: path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), name: 'Google Chrome' },
      { path: path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'), name: 'Google Chrome' },
      { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', name: 'Google Chrome' }
    );

    // 3. Chromium Stable / Portable
    candidates.push(
      { path: path.join(progFiles, 'Chromium', 'Application', 'chrome.exe'), name: 'Chromium' },
      { path: path.join(progFilesX86, 'Chromium', 'Application', 'chrome.exe'), name: 'Chromium' },
      { path: path.join(localAppData, 'Chromium', 'Application', 'chrome.exe'), name: 'Chromium' }
    );

    // 4. Microsoft Edge (Chromium engine)
    candidates.push(
      { path: path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), name: 'Microsoft Edge' },
      { path: path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), name: 'Microsoft Edge' },
      { path: path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), name: 'Microsoft Edge' }
    );

    // Multi-user scan for Chrome / Chromium
    const usersRoot = path.join(systemDrive, 'Users');
    if (fs.existsSync(usersRoot)) {
      try {
        const userDirs = fs.readdirSync(usersRoot);
        for (const u of userDirs) {
          candidates.push(
            { path: path.join(usersRoot, u, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'), name: 'Google Chrome' },
            { path: path.join(usersRoot, u, 'AppData', 'Local', 'Chromium', 'Application', 'chrome.exe'), name: 'Chromium' },
            { path: path.join(usersRoot, u, 'AppData', 'Local', 'Programs', 'Opera', 'opera.exe'), name: 'Opera' }
          );
        }
      } catch (eScan) {}
    }

    // Known account fallbacks
    candidates.push(
      { path: 'C:\\Users\\hien666shop\\AppData\\Local\\Programs\\Opera\\opera.exe', name: 'Opera' },
      { path: 'C:\\Users\\hien1\\AppData\\Local\\Programs\\Opera\\opera.exe', name: 'Opera' }
    );
  } else if (process.platform === 'linux') {
    candidates.push(
      { path: '/usr/bin/google-chrome-stable', name: 'Google Chrome' },
      { path: '/usr/bin/google-chrome', name: 'Google Chrome' },
      { path: '/usr/bin/chromium', name: 'Chromium' },
      { path: '/usr/bin/chromium-browser', name: 'Chromium' },
      { path: '/snap/bin/chromium', name: 'Chromium' },
      { path: '/usr/local/bin/chromium', name: 'Chromium' },
      { path: '/usr/bin/brave-browser', name: 'Brave' },
      { path: '/usr/bin/opera', name: 'Opera' }
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', name: 'Google Chrome' },
      { path: '/Applications/Chromium.app/Contents/MacOS/Chromium', name: 'Chromium' },
      { path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', name: 'Microsoft Edge' },
      { path: '/Applications/Opera.app/Contents/MacOS/Opera', name: 'Opera' }
    );
  }

  if (savedOperaFallback) {
    candidates.push({ path: savedOperaFallback, name: 'Opera' });
  }

  for (const item of candidates) {
    if (item && item.path && fs.existsSync(item.path)) {
      try {
        const stats = fs.statSync(item.path);
        if (stats.isFile()) {
          return {
            found: true,
            path: item.path,
            name: item.name,
            engine: 'Chromium Engine',
            isCustom: false,
          };
        }
      } catch (e) {}
    }
  }

  return {
    found: false,
    path: null,
    error: 'Không tìm thấy trình duyệt Chromium/Google Chrome trên hệ thống. Vui lòng cài đặt Google Chrome hoặc thiết lập đường dẫn trình duyệt trong mục Cài đặt (Settings).'
  };
}

/**
 * Backward-compatibility alias for findOperaBinary
 */
function findOperaBinary(customPath = null) {
  return findBrowserBinary(customPath);
}

/**
 * Generates random ephemeral debugging port between 49152 and 59000
 */
function getRandomDebugPort() {
  return Math.floor(Math.random() * (59000 - 49152)) + 49152;
}

/**
 * Safely kills a process tree on Windows or POSIX without deleting profile data.
 */
function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${pid} >nul 2>&1`);
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch (e) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e2) {}
  }
}

/**
 * Main Launch Orchestrator for Chromium / Chrome / CloakBrowser
 */
async function launchBrowserProfile({
  profile,
  appDataDir,
  customBrowserPath = null,
  customOperaPath = null, // backward compatibility
  injectScript = null,
  extPaths = [],
  mainWindow = null,
  getProfileNum = () => 1,
  startLocalProxy = null,
  generateProfileIcon = null,
}) {
  const profileId = profile.id;

  // 1. Concurrency Check: Prevent double launch of the same profile
  const existing = activeSessions.get(profileId);
  if (existing) {
    if (existing.state === LAUNCH_STATES.READY) {
      return { ok: false, error: `Profile "${profile.name || profileId}" đang chạy!` };
    }
    if ([LAUNCH_STATES.STARTING, LAUNCH_STATES.CONNECTING, LAUNCH_STATES.NAVIGATING].includes(existing.state)) {
      return { ok: false, error: `Profile "${profile.name || profileId}" đang trong quá trình khởi chạy, vui lòng chờ!` };
    }
    if (existing.state === LAUNCH_STATES.CANCELLING) {
      return { ok: false, error: `Profile "${profile.name || profileId}" đang được hủy, vui lòng thử lại sau giây lát!` };
    }
  }

  // 2. Initialize Session
  const session = {
    profileId,
    state: LAUNCH_STATES.STARTING,
    message: 'Khởi động phiên làm việc...',
    startTime: Date.now(),
    pid: null,
    debugPort: null,
    childProcess: null,
    browser: null,
    page: null,
    client: null,
    isCancelled: false,
    error: null,
  };
  activeSessions.set(profileId, session);
  broadcastState(profileId, LAUNCH_STATES.STARTING, 'Đang chuẩn bị môi trường Chromium/Chrome...');

  try {
    // 3. Locate Browser Binary
    const targetPath = customBrowserPath || customOperaPath || profile.browserPath || profile.operaPath || null;
    const browserDetect = findBrowserBinary(targetPath);
    if (!browserDetect.found) {
      session.state = LAUNCH_STATES.ERROR;
      const errMsg = `[BROWSER_NOT_FOUND] ${browserDetect.error}`;
      session.error = errMsg;
      broadcastState(profileId, LAUNCH_STATES.ERROR, errMsg);
      activeSessions.delete(profileId);
      return { ok: false, errorCode: 'BROWSER_NOT_FOUND', error: errMsg };
    }
    const browserBin = browserDetect.path;

    if (session.isCancelled) return handleAbortedSession(session);

    // 4. Setup Isolated User Data Directory
    const isDiagnostic = !!profile.diagnosticMode;
    const profileDirName = isDiagnostic ? `clean_${profile.id}` : profile.id;
    const profileDir = path.join(appDataDir, 'profiles', profileDirName);
    fs.mkdirSync(profileDir, { recursive: true });

    // 5. Calculate Window & Viewport Placement
    const profileNum = getProfileNum(profile);
    const runningCount = Array.from(activeSessions.values()).filter(s => s.state === LAUNCH_STATES.READY).length;
    const gridPos = calculateGridPosition(runningCount, runningCount + 1, profile.customWindow, null, profile);
    const winW = gridPos.winW;
    const winH = gridPos.winH;

    const debugPort = getRandomDebugPort();
    session.debugPort = debugPort;

    // 6. Build Chromium Arguments
    const browserArgs = [
      `--user-data-dir=${profileDir}`,
      '--profile-directory=Default',
      `--window-position=${gridPos.posX},${gridPos.posY}`,
      `--window-size=${winW},${winH}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${debugPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--test-type',
    ];

    if (extPaths.length > 0) {
      browserArgs.push(
        `--load-extension=${extPaths.join(',')}`,
        `--disable-extensions-except=${extPaths.join(',')}`
      );
    }

    if (!isDiagnostic) {
      if (profile.device && profile.device.user_agent) {
        browserArgs.push(`--user-agent=${profile.device.user_agent}`);
      }
      if (profile.device && profile.device.language) {
        browserArgs.push(`--lang=${profile.device.language || 'vi-VN'}`);
      }
      browserArgs.push(
        '--touch-events=enabled',
        '--enable-touch-drag-drop',
        '--force-webrtc-ip-handling-policy=default_public_interface_only',
        '--enforce-webrtc-ip-permission-check',
        '--disable-webrtc-multiple-routes'
      );
      if (profile.device && profile.device.timezone) {
        browserArgs.push(`--timezone-for-testing=${profile.device.timezone}`);
      }
    }

    // 7. Proxy Configuration
    if (profile.proxy && profile.proxy.host) {
      const pType = (profile.proxy.type || 'http').toLowerCase();
      if ((pType === 'http' || pType === 'https') && profile.proxy.user && profile.proxy.pass && typeof startLocalProxy === 'function') {
        try {
          const localPort = await startLocalProxy(
            profile.id,
            profile.proxy.host.trim(),
            profile.proxy.port || 8080,
            profile.proxy.user,
            profile.proxy.pass
          );
          browserArgs.push(`--proxy-server=http://127.0.0.1:${localPort}`);
        } catch (e) {
          const fullHost = `${profile.proxy.host.trim()}:${profile.proxy.port || 8080}`;
          browserArgs.push(`--proxy-server=http://${fullHost}`);
        }
      } else {
        const fullHost = `${profile.proxy.host.trim()}:${profile.proxy.port || 8080}`;
        if (pType.includes('socks')) {
          browserArgs.push(`--proxy-server=${pType}://${fullHost}`);
        } else {
          browserArgs.push(`--proxy-server=http://${fullHost}`);
        }
      }
      browserArgs.push('--ignore-certificate-errors');
    }

    // Always start with blank window while setting up CDP emulation
    browserArgs.push('about:blank');

    if (session.isCancelled) return handleAbortedSession(session);

    // 8. Spawn Browser Process
    broadcastState(profileId, LAUNCH_STATES.STARTING, 'Đang mở tiến trình trình duyệt...');
    let childProc;
    try {
      childProc = spawn(browserBin, browserArgs, { detached: true, stdio: 'ignore' });
      session.childProcess = childProc;
      session.pid = childProc.pid;
    } catch (spawnErr) {
      console.error(`[Browser Launcher Spawn Error] Profile ${profileId}:`, spawnErr);
      session.state = LAUNCH_STATES.ERROR;
      const errMsg = `[SPAWN_FAILED] Không thể khởi động tiến trình trình duyệt: ${spawnErr.message}`;
      session.error = errMsg;
      broadcastState(profileId, LAUNCH_STATES.ERROR, errMsg);
      activeSessions.delete(profileId);
      return { ok: false, errorCode: 'SPAWN_FAILED', error: errMsg };
    }

    childProc.on('error', (err) => {
      console.error(`[Browser Launcher Error] Profile ${profileId}:`, err);
      session.state = LAUNCH_STATES.ERROR;
      session.error = `[SPAWN_FAILED] Lỗi tiến trình trình duyệt: ${err.message}`;
      broadcastState(profileId, LAUNCH_STATES.ERROR, session.error);
      activeSessions.delete(profileId);
    });

    childProc.on('exit', (code) => {
      console.log(`[Browser Process Exit] Profile ${profileId} exited with code ${code}`);
      const wasActive = activeSessions.has(profileId);
      activeSessions.delete(profileId);
      if (wasActive && !session.isCancelled && session.state === LAUNCH_STATES.READY) {
        broadcastState(profileId, LAUNCH_STATES.STOPPED, 'Đã đóng trình duyệt');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('profiles:reload');
        }
      }
    });

    // 9. State: CONNECTING (CDP Connection with Retry & Timeout)
    broadcastState(profileId, LAUNCH_STATES.CONNECTING, 'Đang kết nối giao thức CDP...', { debugPort, pid: childProc.pid });
    let browser = null;
    const maxRetries = 60; // 60 * 300ms = 18.0 seconds max for cold starts under Windows load
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (session.isCancelled) {
        return handleAbortedSession(session);
      }
      try {
        browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${debugPort}`,
          defaultViewport: null,
        });
        if (browser) break;
      } catch (err) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    if (!browser || session.isCancelled) {
      if (session.isCancelled) return handleAbortedSession(session);
      killProcessTree(session.pid);
      activeSessions.delete(profileId);
      const errMsg = `[CDP_TIMEOUT] Không thể kết nối CDP tới trình duyệt (port ${debugPort}) sau ${maxRetries * 300 / 1000}s.`;
      broadcastState(profileId, LAUNCH_STATES.ERROR, errMsg);
      return { ok: false, errorCode: 'CDP_TIMEOUT', error: errMsg };
    }
    session.browser = browser;

    // 10. State: NAVIGATING (Apply Emulation & Navigate to Target URL)
    broadcastState(profileId, LAUNCH_STATES.NAVIGATING, 'Đang thiết lập thông số giả lập...', { debugPort, pid: session.pid });

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    session.page = page;

    const client = await page.createCDPSession();
    session.client = client;

    // Decoupled Emulation Setup (Safe Try/Catches so failure doesn't block navigation)
    if (!isDiagnostic) {
      // Screen & Viewport metrics
      try {
        const vp = (profile.device && profile.device.viewport) ? profile.device.viewport : { width: winW, height: winH };
        const dsf = (profile.device && profile.device.device_scale_factor) || 2.0;
        const isMobile = profile.device?.is_mobile !== false;
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: vp.width || winW,
          height: vp.height || winH,
          deviceScaleFactor: dsf,
          mobile: isMobile,
          screenOrientation: {
            angle: (profile.orientationLock === 'landscape') ? 90 : 0,
            type: (profile.orientationLock === 'landscape') ? 'landscapePrimary' : 'portraitPrimary'
          }
        });
      } catch (eMetric) {
        console.warn(`[CDP Warning] Emulation metrics override skipped:`, eMetric.message);
      }

      // Touch Emulation
      try {
        await client.send('Emulation.setTouchEmulationEnabled', {
          enabled: true,
          maxTouchPoints: profile.device?.max_touch_points || 10
        });
      } catch (eTouch) {
        console.warn(`[CDP Warning] Touch emulation skipped:`, eTouch.message);
      }

      // Stealth & Fingerprint Script Injection
      if (injectScript) {
        try {
          await client.send('Page.addScriptToEvaluateOnNewDocument', { source: injectScript });
        } catch (eScript) {
          console.warn(`[CDP Warning] Fingerprint script injection error:`, eScript.message);
        }
      }
    }

    if (session.isCancelled) return handleAbortedSession(session);

    // 11. Navigate to Target URL (Ensures browser NEVER stays on about:blank)
    const targetUrl = profile.startUrl && profile.startUrl.trim().length > 0
      ? profile.startUrl.trim()
      : 'https://bot.sannysoft.com';

    broadcastState(profileId, LAUNCH_STATES.NAVIGATING, `Đang mở ${targetUrl}...`, { debugPort, pid: session.pid });

    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
    } catch (eNav) {
      if (session.isCancelled) return handleAbortedSession(session);
      console.warn(`[Navigation Warning] Profile ${profileId} không thể tải ${targetUrl}:`, eNav.message);
      
      // Fallback: Nếu trang mặc định tải chậm hoặc lỗi mạng, vẫn giữ trình duyệt mở để người dùng thao tác
      const hasCustomUrl = profile.startUrl && profile.startUrl.trim().length > 0;
      if (!hasCustomUrl) {
        console.log(`[Navigation Fallback] Trang kiểm tra mặc định tải chậm, giữ trình duyệt ở trạng thái READY.`);
      } else {
        try { await browser.close(); } catch(eClose) {}
        if (session.pid) killProcessTree(session.pid);
        session.state = LAUNCH_STATES.ERROR;
        const errMsg = `[NAVIGATION_FAILED] Không thể mở trang "${targetUrl}": ${eNav.message}`;
        session.error = errMsg;
        broadcastState(profileId, LAUNCH_STATES.ERROR, errMsg);
        activeSessions.delete(profileId);
        return { ok: false, errorCode: 'NAVIGATION_FAILED', error: errMsg };
      }
    }

    if (session.isCancelled) return handleAbortedSession(session);

    // 12. State: READY (Launch Successfully Verified)
    session.state = LAUNCH_STATES.READY;
    session.message = 'Sẵn sàng';
    broadcastState(profileId, LAUNCH_STATES.READY, 'Sẵn sàng', { debugPort, pid: session.pid });

    return {
      ok: true,
      pid: session.pid,
      debugPort,
      state: LAUNCH_STATES.READY,
      engine: browserDetect.name || 'Chromium Engine',
    };

  } catch (err) {
    console.error(`[Launch Exception] Profile ${profileId}:`, err);
    if (session.pid) killProcessTree(session.pid);
    activeSessions.delete(profileId);
    const errorMsg = `Lỗi khởi chạy trình duyệt: ${err.message}`;
    broadcastState(profileId, LAUNCH_STATES.ERROR, errorMsg);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Backward-compatibility alias for launchOperaProfile
 */
async function launchOperaProfile(opts) {
  return launchBrowserProfile(opts);
}

/**
 * Immediate Cancel Action:
 * Stops launch without touching profile data, cookies, history or extensions.
 */
async function cancelLaunch(profileId) {
  const session = activeSessions.get(profileId);
  if (!session) {
    return { ok: true, cancelled: true, alreadyStopped: true };
  }

  session.isCancelled = true;
  broadcastState(profileId, LAUNCH_STATES.CANCELLING, 'Đang hủy phiên khởi chạy...');

  return handleAbortedSession(session);
}

/**
 * Handles cleaning up an aborted session cleanly.
 */
async function handleAbortedSession(session) {
  session.isCancelled = true;
  session.state = LAUNCH_STATES.CANCELLED;

  if (session.browser) {
    try {
      await session.browser.close();
    } catch (e) {}
    session.browser = null;
  }

  if (session.pid) {
    killProcessTree(session.pid);
    session.pid = null;
  }

  activeSessions.delete(session.profileId);
  broadcastState(session.profileId, LAUNCH_STATES.CANCELLED, 'Đã hủy khởi chạy an toàn');
  return { ok: true, cancelled: true, state: LAUNCH_STATES.CANCELLED };
}

/**
 * Graceful close for a running profile
 */
async function closeBrowserProfile(profileId) {
  const session = activeSessions.get(profileId);
  if (!session) {
    return { ok: true, alreadyStopped: true };
  }

  broadcastState(profileId, LAUNCH_STATES.CANCELLING, 'Đang đóng trình duyệt...');

  if (session.browser) {
    try {
      await session.browser.close();
    } catch (e) {}
  }

  if (session.pid) {
    killProcessTree(session.pid);
  }

  activeSessions.delete(profileId);
  broadcastState(profileId, LAUNCH_STATES.STOPPED, 'Đã dừng');
  return { ok: true };
}

/**
 * Backward-compatibility alias for closeOperaProfile
 */
async function closeOperaProfile(profileId) {
  return closeBrowserProfile(profileId);
}

/**
 * Returns a map of all profile launch/running states
 */
function getAllBrowserStatuses() {
  const statuses = {};
  for (const [id, session] of activeSessions) {
    statuses[id] = {
      running: session.state === LAUNCH_STATES.READY,
      state: session.state,
      message: session.message || '',
      pid: session.pid,
      startTime: session.startTime,
      debugPort: session.debugPort,
    };
  }
  return statuses;
}

module.exports = {
  LAUNCH_STATES,
  findBrowserBinary,
  findChromiumBinary: findBrowserBinary,
  findOperaBinary,
  launchBrowserProfile,
  launchChromiumProfile: launchBrowserProfile,
  launchOperaProfile,
  cancelLaunch,
  closeBrowserProfile,
  closeOperaProfile,
  getAllBrowserStatuses,
  setStateChangeCallback,
  killProcessTree,
};
