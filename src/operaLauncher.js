/**
 * N/A Browser - Opera Browser Engine & Lifecycle Manager
 * Handles Opera discovery, process spawning, CDP orchestration,
 * state machine (STOPPED -> STARTING -> CONNECTING -> NAVIGATING -> READY),
 * graceful cancel/abort without data loss, and isolated profile multi-instance support.
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

// Map of currently running or launching sessions
// profileId -> LaunchSession
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
 * Searches and validates Opera Stable executable on the host system.
 * DOES NOT silently fallback to Chrome.
 */
function findOperaBinary(customPath = null) {
  if (customPath && typeof customPath === 'string' && customPath.trim().length > 0) {
    const trimmed = customPath.trim();
    if (fs.existsSync(trimmed)) {
      try {
        const stats = fs.statSync(trimmed);
        if (stats.isFile()) {
          return { found: true, path: trimmed, isCustom: true };
        }
      } catch (e) {}
    }
    return {
      found: false,
      path: null,
      error: `Không tìm thấy trình duyệt Opera tại đường dẫn: "${trimmed}". Vui lòng kiểm tra lại đường dẫn!`
    };
  }

  const candidates = [];
  const localAppData = process.env.LOCALAPPDATA || '';
  const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  if (process.platform === 'win32') {
    candidates.push(
      path.join(localAppData, 'Programs', 'Opera', 'launcher.exe'),
      path.join(localAppData, 'Programs', 'Opera', 'opera.exe'),
      path.join(progFiles, 'Opera', 'launcher.exe'),
      path.join(progFiles, 'Opera', 'opera.exe'),
      path.join(progFilesX86, 'Opera', 'launcher.exe'),
      path.join(progFilesX86, 'Opera', 'opera.exe'),
      path.join(localAppData, 'Programs', 'Opera GX', 'launcher.exe'),
      path.join(localAppData, 'Programs', 'Opera GX', 'opera.exe')
    );
  } else if (process.platform === 'linux') {
    candidates.push(
      '/usr/bin/opera',
      '/snap/bin/opera',
      '/usr/local/bin/opera',
      '/opt/opera/opera'
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Opera.app/Contents/MacOS/Opera'
    );
  }

  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      try {
        const stats = fs.statSync(p);
        if (stats.isFile()) {
          return {
            found: true,
            path: p,
            isCustom: customPath ? p === customPath.trim() : false,
          };
        }
      } catch (e) {}
    }
  }

  return {
    found: false,
    path: null,
    error: 'Không tìm thấy trình duyệt Opera trên hệ thống. Vui lòng cài đặt Opera Stable hoặc thiết lập đường dẫn Opera executable trong mục Cài đặt (Settings).'
  };
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
 * Main Launch Orchestrator for Opera
 */
async function launchOperaProfile({
  profile,
  appDataDir,
  customOperaPath = null,
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
  broadcastState(profileId, LAUNCH_STATES.STARTING, 'Đang chuẩn bị môi trường Opera...');

  try {
    // 3. Locate Opera Binary
    const operaDetect = findOperaBinary(customOperaPath);
    if (!operaDetect.found) {
      session.state = LAUNCH_STATES.ERROR;
      session.error = operaDetect.error;
      broadcastState(profileId, LAUNCH_STATES.ERROR, operaDetect.error);
      activeSessions.delete(profileId);
      return { ok: false, error: operaDetect.error };
    }
    const operaBin = operaDetect.path;

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

    // 6. Build Opera Arguments
    const operaArgs = [
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
      operaArgs.push(
        `--load-extension=${extPaths.join(',')}`,
        `--disable-extensions-except=${extPaths.join(',')}`
      );
    }

    if (!isDiagnostic) {
      if (profile.device && profile.device.user_agent) {
        operaArgs.push(`--user-agent=${profile.device.user_agent}`);
      }
      if (profile.device && profile.device.language) {
        operaArgs.push(`--lang=${profile.device.language || 'vi-VN'}`);
      }
      operaArgs.push(
        '--touch-events=enabled',
        '--enable-touch-drag-drop',
        '--force-webrtc-ip-handling-policy=default_public_interface_only',
        '--enforce-webrtc-ip-permission-check',
        '--disable-webrtc-multiple-routes'
      );
      if (profile.device && profile.device.timezone) {
        operaArgs.push(`--timezone-for-testing=${profile.device.timezone}`);
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
          operaArgs.push(`--proxy-server=http://127.0.0.1:${localPort}`);
        } catch (e) {
          const fullHost = `${profile.proxy.host.trim()}:${profile.proxy.port || 8080}`;
          operaArgs.push(`--proxy-server=http://${fullHost}`);
        }
      } else {
        const fullHost = `${profile.proxy.host.trim()}:${profile.proxy.port || 8080}`;
        if (pType.includes('socks')) {
          operaArgs.push(`--proxy-server=${pType}://${fullHost}`);
        } else {
          operaArgs.push(`--proxy-server=http://${fullHost}`);
        }
      }
      operaArgs.push('--ignore-certificate-errors');
    }

    // Always start with blank window while setting up CDP emulation
    operaArgs.push('about:blank');

    if (session.isCancelled) return handleAbortedSession(session);

    // 8. Spawn Opera Child Process
    broadcastState(profileId, LAUNCH_STATES.STARTING, 'Đang mở tiến trình Opera...');
    const childProc = spawn(operaBin, operaArgs, { detached: true, stdio: 'ignore' });
    session.childProcess = childProc;
    session.pid = childProc.pid;

    childProc.on('error', (err) => {
      console.error(`[Opera Launcher Error] Profile ${profileId}:`, err);
      session.state = LAUNCH_STATES.ERROR;
      session.error = `Lỗi tiến trình Opera: ${err.message}`;
      broadcastState(profileId, LAUNCH_STATES.ERROR, session.error);
      activeSessions.delete(profileId);
    });

    childProc.on('exit', (code) => {
      console.log(`[Opera Process Exit] Profile ${profileId} exited with code ${code}`);
      const wasActive = activeSessions.has(profileId);
      activeSessions.delete(profileId);
      if (wasActive && !session.isCancelled) {
        broadcastState(profileId, LAUNCH_STATES.STOPPED, 'Đã đóng trình duyệt');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('profiles:reload');
        }
      }
    });

    // 9. State: CONNECTING (CDP Connection with Retry & Timeout)
    broadcastState(profileId, LAUNCH_STATES.CONNECTING, 'Đang kết nối giao thức CDP...');
    let browser = null;
    const maxRetries = 35; // 35 * 300ms = 10.5 seconds max
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
      const errMsg = `Không thể kết nối CDP tới Opera (port ${debugPort}) sau ${maxRetries * 300 / 1000}s.`;
      broadcastState(profileId, LAUNCH_STATES.ERROR, errMsg);
      return { ok: false, error: errMsg };
    }
    session.browser = browser;

    // 10. State: NAVIGATING (Apply Emulation & Navigate to Target URL)
    broadcastState(profileId, LAUNCH_STATES.NAVIGATING, 'Đang thiết lập thông số giả lập...');

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

    // 11. Navigate to Target URL
    const targetUrl = profile.startUrl && profile.startUrl.trim().length > 0
      ? profile.startUrl.trim()
      : 'https://bot.sannysoft.com';

    broadcastState(profileId, LAUNCH_STATES.NAVIGATING, `Đang mở ${targetUrl}...`);

    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
    } catch (eNav) {
      if (session.isCancelled) return handleAbortedSession(session);
      // If navigation failed (e.g. offline or invalid URL), log warning but still proceed if page opened
      console.warn(`[Navigation Warning] Profile ${profileId} page.goto warning:`, eNav.message);
    }

    if (session.isCancelled) return handleAbortedSession(session);

    // 12. State: READY (Launch Successfully Verified)
    session.state = LAUNCH_STATES.READY;
    session.message = 'Sẵn sàng';
    broadcastState(profileId, LAUNCH_STATES.READY, 'Sẵn sàng');

    return {
      ok: true,
      pid: session.pid,
      debugPort,
      state: LAUNCH_STATES.READY,
    };

  } catch (err) {
    console.error(`[Launch Exception] Profile ${profileId}:`, err);
    if (session.pid) killProcessTree(session.pid);
    activeSessions.delete(profileId);
    const errorMsg = `Lỗi khởi chạy Opera: ${err.message}`;
    broadcastState(profileId, LAUNCH_STATES.ERROR, errorMsg);
    return { ok: false, error: errorMsg };
  }
}

/**
 * Immediate Cancel Action:
 * Stops launch without touching profile data, cookies, history or extensions.
 */
async function cancelLaunch(profileId) {
  const session = activeSessions.get(profileId);
  if (!session) {
    return { ok: false, error: 'Không tìm thấy phiên khởi chạy để hủy.' };
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
async function closeOperaProfile(profileId) {
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
  findOperaBinary,
  launchOperaProfile,
  cancelLaunch,
  closeOperaProfile,
  getAllBrowserStatuses,
  setStateChangeCallback,
  getRandomDebugPort,
};
