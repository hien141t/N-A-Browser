/**
 * layoutEngine.js - Production Layout & Emulation Engine for N/A Browser
 * Handles:
 * 1. Normalized Device Ratio (minDim / maxDim prevention of landscape-portrait inversion)
 * 2. Optimal Multi-Window Auto Fit Grid calculation for Windows OS
 * 3. CDP Emulation State calculation (Visual Viewport vs Window Bounds)
 * 4. Screen Orientation & Fingerprint generation
 * 5. Diagnostic Mode Profile directory mapping
 */

const UI_DELTA_X = 16;  // Chromium window borders on Windows OS
const UI_DELTA_Y = 110; // Chromium tab bar + omnibox navigation on Windows OS

const MIN_WIN_WIDTH  = 200; // Windows OS Chromium minimum window width
const MIN_WIN_HEIGHT = 180; // Windows OS Chromium minimum window height

/**
 * Normalizes device dimensions and orientation lock.
 * Uses min(w, h) and max(w, h) to guarantee presets with devW > devH (e.g. tablets)
 * never have inverted ratios when locked to portrait or landscape.
 */
function normalizeDeviceRatio(device = {}, orientationLock = 'auto') {
  const devW = device?.viewport?.width || device?.screen_width || 412;
  const devH = device?.viewport?.height || device?.screen_height || 915;

  const minDim = Math.min(devW, devH);
  const maxDim = Math.max(devW, devH);

  const portraitRatio = minDim / maxDim;   // e.g. 412 / 915 ≈ 0.45 (< 1.0)
  const landscapeRatio = maxDim / minDim;  // e.g. 915 / 412 ≈ 2.22 (> 1.0)

  let effectiveOrientation = orientationLock;
  if (!effectiveOrientation || effectiveOrientation === 'auto') {
    // If auto, infer from device's native dimensions
    effectiveOrientation = (devW > devH) ? 'landscape' : 'portrait';
  }

  const isLandscape = effectiveOrientation === 'landscape';
  const targetRatio = isLandscape ? landscapeRatio : portraitRatio;

  const screenOrientation = isLandscape
    ? { type: 'landscapePrimary', angle: 90, cdpType: 'landscapePrimary', jsType: 'landscape-primary' }
    : { type: 'portraitPrimary', angle: 0, cdpType: 'portraitPrimary', jsType: 'portrait-primary' };

  const screenWidth = isLandscape ? maxDim : minDim;
  const screenHeight = isLandscape ? minDim : maxDim;
  const windowOrientation = isLandscape ? 90 : 0;

  return {
    devW,
    devH,
    minDim,
    maxDim,
    portraitRatio,
    landscapeRatio,
    effectiveOrientation,
    isLandscape,
    targetRatio,
    screenOrientation,
    screenWidth,
    screenHeight,
    windowOrientation,
  };
}

/**
 * Calculates optimal columns and rows for Auto Fit mode.
 * Adapts to screen workArea, total count, orientation, and Windows OS minimum limits.
 */
function calculateOptimalGridCols(total, workAreaWidth, workAreaHeight, gapX = 10, startX = 10) {
  const N = Math.max(1, total);
  if (N === 1) return { cols: 1, rows: 1 };
  if (N === 2) return { cols: 2, rows: 1 };

  const isWidescreen = workAreaWidth >= 1600;

  if (isWidescreen) {
    if (N === 3) return { cols: 3, rows: 1 };
    if (N === 4) return { cols: 2, rows: 2 };
    if (N <= 6) return { cols: 3, rows: 2 };
    if (N <= 8) return { cols: 4, rows: 2 };
    if (N <= 10) return { cols: 5, rows: 2 };
    if (N <= 12) return { cols: 4, rows: 3 };
    if (N <= 15) return { cols: 5, rows: 3 };
    if (N <= 16) return { cols: 4, rows: 4 };
    if (N <= 20) return { cols: 5, rows: 4 };
  } else {
    // Laptop / compact screens (e.g. 1366x768)
    if (N === 3) {
      const availCellW = (workAreaWidth - (startX * 2) - (2 * gapX)) / 3;
      return (availCellW >= MIN_WIN_WIDTH) ? { cols: 3, rows: 1 } : { cols: 2, rows: 2 };
    }
    if (N === 4) return { cols: 2, rows: 2 };
    if (N <= 6) return { cols: 3, rows: 2 };
    if (N <= 8) return { cols: 4, rows: 2 };
    if (N <= 9) return { cols: 3, rows: 3 };
    if (N <= 12) return { cols: 4, rows: 3 };
  }

  // Fallback calculation for larger N
  const cols = Math.min(8, Math.max(2, Math.ceil(Math.sqrt(N * (workAreaWidth / workAreaHeight)))));
  const rows = Math.ceil(N / cols);
  return { cols, rows };
}

/**
 * Core production algorithm to calculate window bounds and grid placement.
 */
function calculateGridPosition(index, totalRunning = 1, profileCustomWin = null, customOpts = null, profile = null, displayOverride = null) {
  let displays = [];
  try {
    const electron = require('electron');
    if (electron && electron.screen) {
      displays = electron.screen.getAllDisplays();
    }
  } catch (e) {}

  const opts = { ...(customOpts || {}) };
  const displayIdx = parseInt(opts.displayIndex) || 0;

  const targetDisplay = displayOverride || (displays && displays[displayIdx]) || {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 }
  };

  const workArea = targetDisplay.workArea || targetDisplay.bounds || { x: 0, y: 0, width: 1920, height: 1080 };
  const { x, y, width, height } = workArea;

  const actualProfile = profile || (profileCustomWin && (profileCustomWin.id || profileCustomWin.device || profileCustomWin.deviceId) ? profileCustomWin : null);
  const customWin = (profileCustomWin && profileCustomWin.width && profileCustomWin.height) ? profileCustomWin : (actualProfile ? actualProfile.customWindow : null);

  let dev = null;
  if (actualProfile) {
    if (actualProfile.device) {
      dev = actualProfile.device;
    } else if (actualProfile.deviceId) {
      try {
        const fs = require('fs');
        const path = require('path');
        const devFile = path.join(__dirname, 'devices.json');
        if (fs.existsSync(devFile)) {
          const list = JSON.parse(fs.readFileSync(devFile, 'utf8'));
          dev = (Array.isArray(list) ? list : (list.devices || [])).find(d => d.id === actualProfile.deviceId);
        }
      } catch (e) {}
    }
  }
  dev = dev || {};

  const isMobile = dev.is_mobile !== false;
  let orientationLock = actualProfile?.orientationLock;
  if (!orientationLock) {
    orientationLock = isMobile ? 'portrait' : 'auto';
  }
  if (orientationLock !== 'portrait' && orientationLock !== 'landscape') {
    orientationLock = 'auto';
  }

  const norm = normalizeDeviceRatio(dev, orientationLock);

  const mode = opts.mode || opts.layoutMode || 'autoFit'; // 'autoFit' | 'grid' | 'cascade'

  const gap = opts.gap !== undefined ? parseInt(opts.gap) : (opts.gapX !== undefined ? parseInt(opts.gapX) : 10);
  const gapX = opts.gapX !== undefined ? parseInt(opts.gapX) : (isNaN(gap) ? 10 : gap);
  const gapY = opts.gapY !== undefined ? parseInt(opts.gapY) : (isNaN(gap) ? 10 : gap);
  const startX = opts.startX !== undefined ? parseInt(opts.startX) : gapX;
  const startY = opts.startY !== undefined ? parseInt(opts.startY) : gapY;

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
    const { cols, rows } = calculateOptimalGridCols(total, width, height, gapX, startX);

    const availAreaW = width - (startX * 2) - (cols - 1) * gapX;
    const cellW = Math.max(MIN_WIN_WIDTH, Math.floor(availAreaW / cols));
    const availAreaH = height - (startY * 2) - (rows - 1) * gapY;
    const cellH = Math.max(MIN_WIN_HEIGHT, Math.floor(availAreaH / rows));

    if (orientationLock === 'portrait') {
      const maxContentH = Math.max(80, cellH - UI_DELTA_Y);
      let contentW = Math.round(maxContentH * norm.portraitRatio);
      let candWinW = contentW + UI_DELTA_X;
      let candWinH = cellH;

      if (candWinW > cellW) {
        candWinW = cellW;
        const constrainedContentW = Math.max(50, cellW - UI_DELTA_X);
        candWinH = Math.min(cellH, Math.round(constrainedContentW / norm.portraitRatio) + UI_DELTA_Y);
      }
      winW = Math.max(MIN_WIN_WIDTH, candWinW);
      winH = Math.max(MIN_WIN_HEIGHT, candWinH);
    } else if (orientationLock === 'landscape') {
      const maxContentW = Math.max(80, cellW - UI_DELTA_X);
      let contentH = Math.round(maxContentW / norm.landscapeRatio);
      let candWinH = contentH + UI_DELTA_Y;
      let candWinW = cellW;

      if (candWinH > cellH) {
        candWinH = cellH;
        const constrainedContentH = Math.max(50, cellH - UI_DELTA_Y);
        candWinW = Math.min(cellW, Math.round(constrainedContentH * norm.landscapeRatio) + UI_DELTA_X);
      }
      winW = Math.max(MIN_WIN_WIDTH, candWinW);
      winH = Math.max(MIN_WIN_HEIGHT, candWinH);
    } else {
      // 'auto' mode: fills the cell completely
      winW = cellW;
      winH = cellH;
    }

    // Clamp so window never exceeds screen workArea
    winW = Math.min(winW, width - startX);
    winH = Math.min(winH, height - startY);

    const colIndex = index % cols;
    const rowIndex = Math.floor(index / cols);

    const cellX = x + startX + (colIndex * (cellW + gapX));
    const cellY = y + startY + (rowIndex * (cellH + gapY));

    posX = cellX;
    posY = cellY;

    if (posX + winW > x + width) posX = Math.max(x, x + width - winW);
    if (posY + winH > y + height) posY = Math.max(y, y + height - winH);

    return { posX, posY, winW, winH, colsPerRow: cols, rows, mode: 'autoFit' };
  }

  if (mode === 'cascade') {
    if (orientationLock === 'portrait') {
      const availH = Math.max(100, winH - UI_DELTA_Y);
      winW = Math.round(availH * norm.portraitRatio) + UI_DELTA_X;
    } else if (orientationLock === 'landscape') {
      const availW = Math.max(100, winW - UI_DELTA_X);
      winH = Math.round(availW / norm.landscapeRatio) + UI_DELTA_Y;
    }

    winW = Math.min(winW, width - 40);
    winH = Math.min(winH, height - 40);

    const step = opts.step !== undefined ? parseInt(opts.step) : 36;
    const maxX = Math.max(x, x + width - winW);
    const maxY = Math.max(y, y + height - winH);

    posX = x + startX + (index * step);
    posY = y + startY + (index * step);

    if (posX > maxX) posX = x + startX + ((index * step) % Math.max(1, maxX - x - startX + 1));
    if (posY > maxY) posY = y + startY + ((index * step) % Math.max(1, maxY - y - startY + 1));

    return { posX, posY, winW, winH, colsPerRow: 1, rows: totalRunning, mode: 'cascade' };
  }

  // mode === 'grid' (Manual column selection)
  const cols = Math.max(1, parseInt(opts.cols) || 3);
  const rows = Math.ceil(Math.max(1, totalRunning) / cols);

  const availW = width - (startX * 2) - (cols - 1) * gapX;
  const cellW = Math.max(MIN_WIN_WIDTH, Math.floor(availW / cols));
  const availH = height - (startY * 2) - (rows - 1) * gapY;
  const cellH = Math.max(MIN_WIN_HEIGHT, Math.floor(availH / rows));

  if (opts.autoAdaptRatio !== false) {
    if (orientationLock === 'portrait') {
      const maxContentH = Math.max(80, cellH - UI_DELTA_Y);
      let candWinW = Math.round(maxContentH * norm.portraitRatio) + UI_DELTA_X;
      let candWinH = cellH;
      if (candWinW > cellW) {
        candWinW = cellW;
        candWinH = Math.min(cellH, Math.round((cellW - UI_DELTA_X) / norm.portraitRatio) + UI_DELTA_Y);
      }
      winW = Math.max(MIN_WIN_WIDTH, candWinW);
      winH = Math.max(MIN_WIN_HEIGHT, candWinH);
    } else if (orientationLock === 'landscape') {
      const maxContentW = Math.max(80, cellW - UI_DELTA_X);
      let candWinH = Math.round(maxContentW / norm.landscapeRatio) + UI_DELTA_Y;
      let candWinW = cellW;
      if (candWinH > cellH) {
        candWinH = cellH;
        candWinW = Math.min(cellW, Math.round((cellH - UI_DELTA_Y) * norm.landscapeRatio) + UI_DELTA_X);
      }
      winW = Math.max(MIN_WIN_WIDTH, candWinW);
      winH = Math.max(MIN_WIN_HEIGHT, candWinH);
    } else {
      winW = cellW;
      winH = cellH;
    }
  } else {
    winW = Math.min(winW, cellW);
    winH = Math.min(winH, cellH);
  }

  winW = Math.min(winW, width - startX);
  winH = Math.min(winH, height - startY);

  const cIdx = index % cols;
  const rIdx = Math.floor(index / cols);

  posX = x + startX + (cIdx * (cellW + gapX));
  posY = y + startY + (rIdx * (cellH + gapY));

  if (posX + winW > x + width) posX = Math.max(x, x + width - winW);
  if (posY + winH > y + height) posY = Math.max(y, y + height - winH);

  return { posX, posY, winW, winH, colsPerRow: cols, rows, mode: 'grid' };
}

/**
 * Computes CDP visual viewport vs window dimensions.
 * Ensures that changes in window bounds recompute exact CSS layout viewport
 * that matches the target device ratio without inverted orientation.
 */
function computeEmulationState({
  currentWinW,
  currentWinH,
  lastKnownWinW = currentWinW,
  lastKnownWinH = currentWinH,
  device = {},
  orientationLock = 'auto',
  uiDeltaX = UI_DELTA_X,
  uiDeltaY = UI_DELTA_Y
}) {
  const norm = normalizeDeviceRatio(device, orientationLock);

  if (orientationLock === 'auto') {
    const contentW = Math.max(100, Math.round(currentWinW - uiDeltaX));
    const contentH = Math.max(100, Math.round(currentWinH - uiDeltaY));
    const screenOrientation = (contentW < contentH)
      ? { type: 'portraitPrimary', angle: 0 }
      : { type: 'landscapePrimary', angle: 90 };
    return {
      viewportW: contentW,
      viewportH: contentH,
      targetWinW: currentWinW,
      targetWinH: currentWinH,
      screenOrientation,
      needsResize: false
    };
  }

  const isLandscape = orientationLock === 'landscape';
  const targetRatio = isLandscape ? norm.landscapeRatio : norm.portraitRatio;
  const screenOrientation = isLandscape
    ? { type: 'landscapePrimary', angle: 90 }
    : { type: 'portraitPrimary', angle: 0 };

  const deltaW = Math.abs(currentWinW - lastKnownWinW);
  const deltaH = Math.abs(currentWinH - lastKnownWinH);

  let targetVpW, targetVpH;
  let targetWinW, targetWinH;

  if (deltaW > deltaH && deltaW > 2) {
    const availW = Math.max(100, currentWinW - uiDeltaX);
    targetVpW = availW;
    targetVpH = Math.max(100, Math.round(availW / targetRatio));
    targetWinW = currentWinW;
    targetWinH = targetVpH + uiDeltaY;
  } else {
    const availH = Math.max(100, currentWinH - uiDeltaY);
    targetVpH = availH;
    targetVpW = Math.max(100, Math.round(availH * targetRatio));
    targetWinW = targetVpW + uiDeltaX;
    targetWinH = currentWinH;
  }

  const diffW = Math.abs(currentWinW - targetWinW);
  const diffH = Math.abs(currentWinH - targetWinH);
  const needsResize = (diffW > 4 || diffH > 4);

  return {
    viewportW: targetVpW,
    viewportH: targetVpH,
    targetWinW,
    targetWinH,
    screenOrientation,
    needsResize
  };
}

/**
 * Returns correct profile directory name depending on diagnosticMode.
 */
function getProfileDirectoryName(profileId, isDiagnostic = false) {
  if (!profileId) return 'default';
  return isDiagnostic ? `clean_${profileId}` : String(profileId);
}

module.exports = {
  UI_DELTA_X,
  UI_DELTA_Y,
  MIN_WIN_WIDTH,
  MIN_WIN_HEIGHT,
  normalizeDeviceRatio,
  calculateOptimalGridCols,
  calculateGridPosition,
  computeEmulationState,
  getProfileDirectoryName,
};
