/**
 * test_diagnostic_mode.js
 * Kiểm thử tính năng Clean Diagnostic Mode.
 * 
 * Đảm bảo khi bật diagnosticMode (true):
 * 1. Không nạp extensions: extPaths rỗng, không có cờ --load-extension hoặc --disable-extensions-except.
 * 2. Không tiêm fingerprint script: injectScript là null, không gọi Page.addScriptToEvaluateOnNewDocument.
 * 3. Không bật debugger / anti-debugger: antiDebugger bị tắt hoặc bỏ qua (không gọi Debugger.enable).
 * 4. So sánh với Normal Mode (diagnosticMode = false): các tính năng trên hoạt động bình thường.
 */

const assert = require('assert');

/**
 * Mô phỏng logic chuẩn bị tham số khởi chạy của main.js
 */
function buildLaunchConfig(profile, allExtensions = []) {
  const isDiagnostic = !!profile.diagnosticMode;
  const extPaths = [];
  let injectScript = null;

  if (!isDiagnostic) {
    // Generate fingerprint script khi KHÔNG ở chế độ diagnostic
    injectScript = `/* Fingerprint for ${profile.deviceId || 'device'} */ window.__fp = true;`;

    // Nạp extension nếu có
    const selectedIds = new Set(Array.isArray(profile.selectedExtensions) ? profile.selectedExtensions : []);
    for (const item of allExtensions) {
      if (selectedIds.has(item.id) && item.enabled !== false) {
        extPaths.push(item.path);
      }
    }
  }

  // Build Chrome args
  const chromeArgs = [
    `--user-data-dir=profiles/${isDiagnostic ? 'clean_' : ''}${profile.id}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check'
  ];

  if (extPaths.length > 0) {
    chromeArgs.push(`--load-extension=${extPaths.join(',')}`);
    chromeArgs.push(`--disable-extensions-except=${extPaths.join(',')}`);
  }

  if (!isDiagnostic) {
    chromeArgs.push('--disable-blink-features=AutomationControlled');
    chromeArgs.push('--force-webrtc-ip-handling-policy=default_public_interface_only');
  }

  return {
    isDiagnostic,
    extPaths,
    injectScript,
    chromeArgs
  };
}

/**
 * Mô phỏng logic CDP setup của main.js
 */
async function simulateCDPSetup(profile, launchConfig) {
  const cdpActions = [];

  const mockClient = {
    send: async (method, params) => {
      cdpActions.push({ method, params });
      if (method === 'Browser.getWindowForTarget') {
        return { windowId: 1 };
      }
      return {};
    }
  };

  // 1. Diagnostic Mode check
  if (profile && profile.diagnosticMode === true) {
    // Diagnostic Mode: chỉ điều chỉnh bounds cửa sổ nếu cần, KHÔNG tiêm fingerprint, KHÔNG anti-debugger
    const winInfo = await mockClient.send('Browser.getWindowForTarget');
    if (winInfo && winInfo.windowId) {
      await mockClient.send('Browser.setWindowBounds', { windowId: winInfo.windowId, bounds: { width: 380, height: 675 } });
    }
    return { cdpActions, isClean: true };
  }

  // 2. Tiêm fingerprint khi diagnosticMode = false
  if (launchConfig.injectScript) {
    await mockClient.send('Page.addScriptToEvaluateOnNewDocument', { source: launchConfig.injectScript });
  }

  // 3. Anti-Debugger khi profile.antiDebugger = true & diagnosticMode = false
  if (profile.antiDebugger === true && !profile.diagnosticMode) {
    await mockClient.send('Debugger.enable');
    await mockClient.send('Debugger.setSkipAllPauses', { skip: true });
  }

  return { cdpActions, isClean: false };
}

/**
 * Chạy test suite cho Clean Diagnostic Mode
 */
async function runDiagnosticModeTests() {
  console.log('====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Clean Diagnostic Mode');
  console.log('====================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  async function runTest(testName, testFn) {
    totalTests++;
    try {
      await testFn();
      console.log(`  ✅ PASS: ${testName}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${testName}`);
      console.error(`     Nguyên nhân: ${err.message}`);
    }
  }

  const sampleExtensions = [
    { id: 'ext1', name: 'Proxy Switcher', path: '/path/to/ext1', enabled: true },
    { id: 'ext2', name: 'Cookie AutoLoad', path: '/path/to/ext2', enabled: true }
  ];

  // 1. Diagnostic Mode = TRUE
  console.log('--- 1. Khi Diagnostic Mode = TRUE (Sạch nguyên bản) ---');
  const cleanProfile = {
    id: 'prof_clean_123',
    name: 'Clean Test Profile',
    diagnosticMode: true,
    antiDebugger: true, // Thử bật antiDebugger khi diagnosticMode=true
    selectedExtensions: ['ext1', 'ext2']
  };

  await runTest('Không nạp bất kỳ extension nào (extPaths rỗng & không có cờ --load-extension)', async () => {
    const cfg = buildLaunchConfig(cleanProfile, sampleExtensions);
    assert.strictEqual(cfg.extPaths.length, 0, 'extPaths phải rỗng khi diagnosticMode=true');
    const hasLoadExtFlag = cfg.chromeArgs.some(a => a.startsWith('--load-extension'));
    const hasExceptFlag = cfg.chromeArgs.some(a => a.startsWith('--disable-extensions-except'));
    assert.strictEqual(hasLoadExtFlag, false, 'Không được có cờ --load-extension');
    assert.strictEqual(hasExceptFlag, false, 'Không được có cờ --disable-extensions-except');
  });

  await runTest('Không tiêm script fingerprint (injectScript = null)', async () => {
    const cfg = buildLaunchConfig(cleanProfile, sampleExtensions);
    assert.strictEqual(cfg.injectScript, null, 'injectScript phải là null');
    const hasFpFlag = cfg.chromeArgs.some(a => a.includes('AutomationControlled'));
    assert.strictEqual(hasFpFlag, false, 'Không được can thiệp AutomationControlled trong Diagnostic Mode');
  });

  await runTest('CDP setup không gọi Page.addScriptToEvaluateOnNewDocument và không bật Debugger', async () => {
    const cfg = buildLaunchConfig(cleanProfile, sampleExtensions);
    const { cdpActions } = await simulateCDPSetup(cleanProfile, cfg);

    const hasFpInjection = cdpActions.some(a => a.method === 'Page.addScriptToEvaluateOnNewDocument');
    const hasDebugger = cdpActions.some(a => a.method === 'Debugger.enable');

    assert.strictEqual(hasFpInjection, false, 'KHÔNG được tiêm script qua CDP trong Diagnostic Mode');
    assert.strictEqual(hasDebugger, false, 'KHÔNG được bật Debugger.enable trong Diagnostic Mode');
  });

  // 2. So sánh với Diagnostic Mode = FALSE (Normal Mode)
  console.log('\n--- 2. Khi Diagnostic Mode = FALSE (Chế độ giả lập vân tay) ---');
  const normalProfile = {
    id: 'prof_normal_456',
    name: 'Normal Fingerprint Profile',
    diagnosticMode: false,
    antiDebugger: true,
    selectedExtensions: ['ext1']
  };

  await runTest('Chế độ thông thường nạp extension, tạo fingerprint script và bật anti-debugger', async () => {
    const cfg = buildLaunchConfig(normalProfile, sampleExtensions);
    assert.strictEqual(cfg.extPaths.length, 1, 'extPaths phải có 1 extension');
    assert(cfg.injectScript !== null, 'injectScript không được null');

    const { cdpActions } = await simulateCDPSetup(normalProfile, cfg);
    const hasFpInjection = cdpActions.some(a => a.method === 'Page.addScriptToEvaluateOnNewDocument');
    const hasDebugger = cdpActions.some(a => a.method === 'Debugger.enable');

    assert.strictEqual(hasFpInjection, true, 'Chế độ thường phải tiêm fingerprint qua CDP');
    assert.strictEqual(hasDebugger, true, 'Chế độ thường có antiDebugger=true phải bật Debugger');
  });

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT DIAGNOSTIC MODE: ${passedTests}/${totalTests} TESTS PASS`);
  console.log('====================================================\n');

  return { passedTests, totalTests, success: passedTests === totalTests };
}

if (require.main === module) {
  runDiagnosticModeTests().then(res => {
    process.exit(res.success ? 0 : 1);
  });
}

module.exports = {
  buildLaunchConfig,
  simulateCDPSetup,
  runDiagnosticModeTests
};
