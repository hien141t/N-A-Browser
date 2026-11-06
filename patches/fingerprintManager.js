/**
 * N/A Browser - Fingerprint Manager
 * Provides centralized storage, generation, validation, and CRUD operations
 * for profile fingerprints across 8 functional categories:
 * 1. Device / OS
 * 2. Browser / User-Agent
 * 3. Screen / Resolution / DPR
 * 4. Canvas
 * 5. WebGL / GPU
 * 6. WebRTC
 * 7. Timezone / Language / Geolocation
 * 8. Touch / Hardware / Memory
 */

const fs = require('fs');
const path = require('path');

function getProfilesFilePath(appDataDir) {
  return path.join(appDataDir, 'profiles.json');
}

function loadProfiles(appDataDir) {
  const p = getProfilesFilePath(appDataDir);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function saveProfiles(appDataDir, profiles) {
  const p = getProfilesFilePath(appDataDir);
  fs.writeFileSync(p, JSON.stringify(profiles, null, 2), 'utf-8');
  return true;
}

/**
 * Creates default fingerprint structure for a given device or base profile
 */
function createDefaultFingerprint(device = {}, orientationLock = 'portrait') {
  const isApple = (device.brand && device.brand.toLowerCase() === 'apple') || device.platform === 'iPhone' || device.platform === 'iPad';
  const isMobile = device.is_mobile !== false;
  const platform = device.platform || (isApple ? 'iPhone' : (isMobile ? 'Linux armv8l' : 'Win32'));
  const osName = isApple ? 'iOS' : (isMobile ? 'Android' : 'Windows');

  const screenW = device.screen_width || (device.viewport ? device.viewport.width : 412);
  const screenH = device.screen_height || (device.viewport ? device.viewport.height : 915);
  const dsf = device.device_scale_factor || 3.0;

  // Generate stable seed for canvas
  const seedStr = (device.id || device.name || 'fp_seed') + '_' + (device.webgl_renderer || 'gpu');
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = ((seed << 5) - seed + seedStr.charCodeAt(i)) | 0;
  }
  seed = Math.abs(seed) || 987654321;

  const operaVersion = '139.0.0.0';
  const chromeVersion = '155.0.0.0';

  let defaultUa = device.user_agent;
  if (!defaultUa) {
    if (isApple) {
      defaultUa = `Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1 OPT/${operaVersion}`;
    } else if (isMobile) {
      defaultUa = `Mozilla/5.0 (Linux; Android 14; ${device.model || 'SM-S928B'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36 OPR/${operaVersion}`;
    } else {
      defaultUa = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 OPR/${operaVersion}`;
    }
  }

  return {
    device: {
      os: osName,
      osVersion: device.os_version || 'Android 14',
      brand: device.brand || 'Samsung',
      model: device.model || 'Galaxy S24 Ultra',
      platform: platform,
      isMobile: isMobile,
    },
    browser: {
      name: 'Opera',
      operaVersion: operaVersion,
      chromiumVersion: chromeVersion,
      userAgent: defaultUa,
      secChUa: device.sec_ch_ua || `"Chromium";v="155", "Opera";v="139", "Not?A_Brand";v="24"`,
      secChUaMobile: isMobile ? '?1' : '?0',
      secChUaPlatform: `"${osName}"`,
    },
    screen: {
      width: screenW,
      height: screenH,
      dpr: dsf,
      colorDepth: device.color_depth || 24,
      orientation: orientationLock || 'portrait',
    },
    canvas: {
      noiseEnabled: true,
      noiseSeed: seed,
    },
    webgl: {
      vendor: device.webgl_vendor || (isApple ? 'Apple Inc.' : 'Qualcomm'),
      renderer: device.webgl_renderer || (isApple ? 'Apple GPU' : 'Adreno (TM) 750'),
      unmaskedVendor: isApple ? 'Apple Inc.' : 'Google Inc. (Qualcomm)',
      unmaskedRenderer: isApple ? 'Apple GPU' : 'ANGLE (Qualcomm, Adreno (TM) 750 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.4575)',
    },
    webrtc: {
      policy: 'default_public_interface_only',
      blockUdp: false,
      maskPublicIp: true,
    },
    timezone: {
      timezone: device.timezone || 'Asia/Ho_Chi_Minh',
      language: device.language || 'vi-VN',
      languages: [device.language || 'vi-VN', 'en-US', 'en'],
      geolocation: {
        lat: (device.geo && device.geo.lat) || 10.8231,
        lng: (device.geo && device.geo.lng) || 106.6297,
        accuracy: 15,
        city: device.location || 'TP. Hồ Chí Minh',
      },
    },
    hardware: {
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: device.max_touch_points || (isMobile ? 10 : 0),
    },
    updatedAt: Date.now(),
  };
}

/**
 * 1. GET: fingerprint:get(profileId)
 */
function getFingerprint(appDataDir, profileId) {
  const profiles = loadProfiles(appDataDir);
  const profile = profiles.find(p => String(p.id) === String(profileId));
  if (!profile) return { ok: false, error: 'Profile không tồn tại' };

  if (!profile.fingerprint) {
    profile.fingerprint = createDefaultFingerprint(profile.device || {}, profile.orientationLock || 'portrait');
    saveProfiles(appDataDir, profiles);
  }

  return { ok: true, profileId, fingerprint: profile.fingerprint };
}

/**
 * 2. UPDATE: fingerprint:update(profileId, settings)
 */
function updateFingerprint(appDataDir, profileId, newSettings) {
  const profiles = loadProfiles(appDataDir);
  const idx = profiles.findIndex(p => String(p.id) === String(profileId));
  if (idx < 0) return { ok: false, error: 'Profile không tồn tại' };

  const currentFp = profiles[idx].fingerprint || createDefaultFingerprint(profiles[idx].device || {});

  // Deep merge categories
  const updatedFp = {
    ...currentFp,
    device:   { ...currentFp.device,   ...(newSettings.device || {}) },
    browser:  { ...currentFp.browser,  ...(newSettings.browser || {}) },
    screen:   { ...currentFp.screen,   ...(newSettings.screen || {}) },
    canvas:   { ...currentFp.canvas,   ...(newSettings.canvas || {}) },
    webgl:    { ...currentFp.webgl,    ...(newSettings.webgl || {}) },
    webrtc:   { ...currentFp.webrtc,   ...(newSettings.webrtc || {}) },
    timezone: { ...currentFp.timezone, ...(newSettings.timezone || {}) },
    hardware: { ...currentFp.hardware, ...(newSettings.hardware || {}) },
    updatedAt: Date.now(),
  };

  profiles[idx].fingerprint = updatedFp;

  // Sync back to top-level device if relevant
  if (profiles[idx].device) {
    if (updatedFp.browser.userAgent) profiles[idx].device.user_agent = updatedFp.browser.userAgent;
    if (updatedFp.webgl.renderer) profiles[idx].device.webgl_renderer = updatedFp.webgl.renderer;
    if (updatedFp.webgl.vendor) profiles[idx].device.webgl_vendor = updatedFp.webgl.vendor;
    if (updatedFp.screen.width && updatedFp.screen.height) {
      profiles[idx].device.screen_width = updatedFp.screen.width;
      profiles[idx].device.screen_height = updatedFp.screen.height;
    }
    if (updatedFp.timezone.timezone) profiles[idx].device.timezone = updatedFp.timezone.timezone;
  }

  saveProfiles(appDataDir, profiles);
  return { ok: true, profileId, fingerprint: updatedFp };
}

/**
 * 3. GENERATE: fingerprint:generate(profileId, options)
 */
function generateFingerprint(appDataDir, profileId, options = {}) {
  const profiles = loadProfiles(appDataDir);
  const idx = profiles.findIndex(p => String(p.id) === String(profileId));
  if (idx < 0) return { ok: false, error: 'Profile không tồn tại' };

  const profile = profiles[idx];
  const newFp = createDefaultFingerprint(profile.device || {}, profile.orientationLock || 'portrait');

  // Randomize noise seed
  newFp.canvas.noiseSeed = Math.floor(Math.random() * 900000000) + 100000000;

  // If options specify overrides
  if (options.concurrency) newFp.hardware.hardwareConcurrency = options.concurrency;
  if (options.memory) newFp.hardware.deviceMemory = options.memory;

  profile.fingerprint = newFp;
  saveProfiles(appDataDir, profiles);

  return { ok: true, profileId, fingerprint: newFp };
}

function getBaseDevicePreset(appDataDir, profile) {
  let devicesList = [];
  const devFile = path.join(__dirname, 'devices.json');
  if (fs.existsSync(devFile)) {
    try { devicesList = JSON.parse(fs.readFileSync(devFile, 'utf-8')).devices || []; } catch(e){}
  }
  const devId = profile.deviceId || profile.device?.id;
  const found = devicesList.find(d => d.id === devId);
  if (found) return found;

  const brand = (profile.device?.brand || '').toLowerCase();
  const isApple = brand === 'apple';
  return {
    ...(profile.device || {}),
    webgl_vendor: isApple ? 'Apple Inc.' : 'Qualcomm',
    webgl_renderer: isApple ? 'Apple GPU' : 'Adreno (TM) 750',
    screen_width: 412,
    screen_height: 915,
  };
}

/**
 * 4. RESET: fingerprint:reset(profileId)
 */
function resetFingerprint(appDataDir, profileId) {
  const profiles = loadProfiles(appDataDir);
  const idx = profiles.findIndex(p => String(p.id) === String(profileId));
  if (idx < 0) return { ok: false, error: 'Profile không tồn tại' };

  const profile = profiles[idx];
  const baseDevice = getBaseDevicePreset(appDataDir, profile);
  profile.device = { ...(profile.device || {}), ...baseDevice };
  profile.fingerprint = createDefaultFingerprint(baseDevice, profile.orientationLock || 'portrait');
  saveProfiles(appDataDir, profiles);

  return { ok: true, profileId, fingerprint: profile.fingerprint };
}

/**
 * 5. VALIDATE: fingerprint:validate(profileId)
 * Performs consistency verification across OS, UserAgent, WebGL, Screen, and Timezone
 */
function validateFingerprint(appDataDir, profileId) {
  const profiles = loadProfiles(appDataDir);
  const profile = profiles.find(p => String(p.id) === String(profileId));
  if (!profile) return { ok: false, error: 'Profile không tồn tại' };

  const fp = profile.fingerprint || createDefaultFingerprint(profile.device || {});
  const issues = [];
  const checks = {};

  // Check 1: OS vs Platform
  const isAndroid = fp.device.os === 'Android';
  const isIOS = fp.device.os === 'iOS';
  if (isAndroid && !fp.device.platform.includes('Linux') && !fp.device.platform.includes('Android')) {
    issues.push('Nền tảng (Platform) không khớp với Android: ' + fp.device.platform);
    checks.platform = { valid: false, details: 'Mismatch Android vs ' + fp.device.platform };
  } else if (isIOS && !['iPhone', 'iPad', 'iPod'].includes(fp.device.platform)) {
    issues.push('Nền tảng (Platform) không khớp với iOS: ' + fp.device.platform);
    checks.platform = { valid: false, details: 'Mismatch iOS vs ' + fp.device.platform };
  } else {
    checks.platform = { valid: true, details: fp.device.platform };
  }

  // Check 2: Browser User-Agent
  if (!fp.browser.userAgent || !fp.browser.userAgent.includes('Mozilla')) {
    issues.push('User-Agent không hợp lệ hoặc rỗng');
    checks.userAgent = { valid: false, details: 'User-Agent rỗng hoặc sai chuẩn' };
  } else {
    checks.userAgent = { valid: true, details: 'Hợp lệ' };
  }

  // Check 3: Screen & Orientation
  if (fp.screen.orientation === 'portrait' && fp.screen.width > fp.screen.height) {
    issues.push('Khóa hướng Dọc (Portrait) nhưng chiều rộng lại lớn hơn chiều cao');
    checks.screen = { valid: false, details: `${fp.screen.width}x${fp.screen.height} không phải dọc` };
  } else if (fp.screen.orientation === 'landscape' && fp.screen.height > fp.screen.width) {
    issues.push('Khóa hướng Ngang (Landscape) nhưng chiều cao lại lớn hơn chiều rộng');
    checks.screen = { valid: false, details: `${fp.screen.width}x${fp.screen.height} không phải ngang` };
  } else {
    checks.screen = { valid: true, details: `${fp.screen.width}x${fp.screen.height} (${fp.screen.orientation})` };
  }

  // Check 4: WebGL vs OS
  if (isAndroid && fp.webgl.vendor && fp.webgl.vendor.includes('Apple')) {
    issues.push('Thiết bị Android không thể dùng GPU Apple');
    checks.webgl = { valid: false, details: 'Mismatch Android vs Apple GPU' };
  } else if (isIOS && fp.webgl.vendor && fp.webgl.vendor.includes('Qualcomm')) {
    issues.push('Thiết bị iOS không thể dùng GPU Qualcomm');
    checks.webgl = { valid: false, details: 'Mismatch iOS vs Qualcomm GPU' };
  } else {
    checks.webgl = { valid: true, details: `${fp.webgl.vendor} - ${fp.webgl.renderer}` };
  }

  // Check 5: WebRTC Policy
  checks.webrtc = {
    valid: fp.webrtc.policy === 'default_public_interface_only',
    details: fp.webrtc.policy || 'default',
  };

  // Check 6: Timezone & Locale
  checks.timezone = {
    valid: !!(fp.timezone.timezone && fp.timezone.language),
    details: `${fp.timezone.timezone} / ${fp.timezone.language}`,
  };

  // Check 7: Hardware & Touch
  checks.hardware = {
    valid: fp.hardware.hardwareConcurrency >= 2 && fp.hardware.deviceMemory >= 2,
    details: `${fp.hardware.hardwareConcurrency} Cores / ${fp.hardware.deviceMemory}GB RAM`,
  };

  const score = Math.max(0, 100 - (issues.length * 20));

  return {
    ok: true,
    profileId,
    score,
    isValid: issues.length === 0,
    issues,
    checks,
  };
}

module.exports = {
  createDefaultFingerprint,
  getFingerprint,
  updateFingerprint,
  generateFingerprint,
  resetFingerprint,
  validateFingerprint,
};
