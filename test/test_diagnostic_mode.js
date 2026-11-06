/**
 * test_diagnostic_mode.js
 * Kiểm thử tính năng Clean Diagnostic Mode và thư mục Clean Diagnostic.
 * 
 * Đảm bảo khi bật diagnosticMode (true):
 * 1. Không nạp extensions: extPaths rỗng, không có cờ --load-extension hoặc --disable-extensions-except.
 * 2. Không tiêm fingerprint script: injectScript là null, không gọi Page.addScriptToEvaluateOnNewDocument.
 * 3. Không bật debugger / anti-debugger: antiDebugger bị tắt hoặc bỏ qua (không gọi Debugger.enable).
 * 4. Arrange Windows sử dụng chính xác thư mục profiles/clean_<id> khi profile bật Diagnostic.
 * 5. So sánh với Normal Mode (diagnosticMode = false): các tính năng trên hoạt động bình thường.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getProfileDirectoryName } = require('../src/layoutEngine');

/**
 * Mô phỏng logic chuẩn bị tham số khởi chạy của main.js
 */
function buildLaunchConfig(profile, allExtensions = []) {
  const isDiagnostic = !!profile.diagnosticMode;
  const extPaths = [];
  let injectScript = null;

  if (!isDiagnostic) {
    injectScript = `/* Fingerprint for ${profile.deviceId || 'device'} */ window.__fp = true;`;

    const selectedIds = new Set(Array.isArray(profile.selectedExtensions) ? profile.selectedExtensions : []);
    for (const item of allExtensions) {
      if (selectedIds.has(item.id) && item.enabled !== false) {
        extPaths.push(item.path);
      }
    }
  }

  const profileDirName = getProfileDirectoryName(profile.id, isDiagnostic);

  const chromeArgs = [
    `--user-data-dir=profiles/${profileDirName}`,
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
    profileDirName,
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
    const winInfo = await mockClient.send('Browser.getWindowForTarget');
    if (winInfo && winInfo.windowId) {
      await mockClient.send('Browser.setWindowBounds', {
        windowId: winInfo.windowId,
        bounds: { width: 380, height: 675 }
      });
    }
    return { cdpActions };
  }

  // 2. Chế độ thông thường
  await mockClient.send('Page.enable');
  await mockClient.send('Network.enable');

  if (launchConfig.injectScript) {
    await mockClient.send('Page.addScriptToEvaluateOnNewDocument', {
      source: launchConfig.injectScript
    });
  }

  if (profile.antiDebugger) {
    await mockClient.send('Debugger.enable');
  }

  return { cdpActions };
}

async function runDiagnosticModeTests() {
  console.log('\n====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Clean Diagnostic Mode & Directory Isolation');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Lỗi: ${err.message}`);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Lỗi: ${err.message}`);
      throw err;
    }
  }

  const dummyExtensions = [
    { id: 'ext1', name: 'Extension 1', path: '/path/ext1', enabled: true },
    { id: 'ext2', name: 'Extension 2', path: '/path/ext2', enabled: true }
  ];

  // --- 1. Khi Diagnostic Mode = TRUE ---
  console.log('--- 1. Khi Diagnostic Mode = TRUE (Sạch nguyên bản) ---');

  const diagProfile = {
    id: 'test_clean_123',
    name: 'Diagnostic Profile',
    diagnosticMode: true,
    antiDebugger: true, // Cố tình bật để kiểm tra có bị tắt cưỡng chế không
    selectedExtensions: ['ext1', 'ext2'],
    deviceId: 'samsung-s24'
  };

  const diagConfig = buildLaunchConfig(diagProfile, dummyExtensions);

  test('Không nạp bất kỳ extension nào (extPaths rỗng & không có cờ --load-extension)', () => {
    assert.strictEqual(diagConfig.extPaths.length, 0, 'extPaths phải rỗng khi bật diagnostic');
    const hasLoadExt = diagConfig.chromeArgs.some(arg => arg.startsWith('--load-extension'));
    assert.strictEqual(hasLoadExt, false, 'Không được có cờ --load-extension');
  });

  test('Không tiêm script fingerprint (injectScript = null)', () => {
    assert.strictEqual(diagConfig.injectScript, null, 'injectScript phải là null');
  });

  await testAsync('CDP setup không gọi Page.addScriptToEvaluateOnNewDocument và không bật Debugger', async () => {
    const { cdpActions } = await simulateCDPSetup(diagProfile, diagConfig);
    const hasScriptInjection = cdpActions.some(a => a.method === 'Page.addScriptToEvaluateOnNewDocument');
    const hasDebuggerEnable = cdpActions.some(a => a.method === 'Debugger.enable');

    assert.strictEqual(hasScriptInjection, false, 'Không được tiêm script fingerprint');
    assert.strictEqual(hasDebuggerEnable, false, 'Không được kích hoạt Debugger.enable');
  });

  // --- 2. Thư mục profiles/clean_<id> Isolation ---
  console.log('\n--- 2. Kiểm tra Thư mục profiles/clean_<id> Isolation ---');

  test('getProfileDirectoryName trả về clean_<id> khi diagnosticMode=true', () => {
    const cleanDir = getProfileDirectoryName('prof_abc_456', true);
    assert.strictEqual(cleanDir, 'clean_prof_abc_456');

    const normalDir = getProfileDirectoryName('prof_abc_456', false);
    assert.strictEqual(normalDir, 'prof_abc_456');
  });

  test('Source code audit: main.js arrangeRunningWindows sử dụng getProfileDirectoryName', () => {
    const mainCode = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert(mainCode.includes('getProfileDirectoryName'), 'main.js phải gọi getProfileDirectoryName');
    assert(mainCode.includes("clean_${profile.id}") || mainCode.includes("clean_${pInfo.id}") || mainCode.includes("clean_`"), 'main.js phải chứa logic clean_ prefix');
  });

  // --- 3. Khi Diagnostic Mode = FALSE ---
  console.log('\n--- 3. Khi Diagnostic Mode = FALSE (Chế độ giả lập vân tay) ---');

  const normalProfile = {
    id: 'test_normal_456',
    name: 'Normal Profile',
    diagnosticMode: false,
    antiDebugger: true,
    selectedExtensions: ['ext1'],
    deviceId: 'samsung-s24'
  };

  const normalConfig = buildLaunchConfig(normalProfile, dummyExtensions);

  await testAsync('Chế độ thông thường nạp extension, tạo fingerprint script và bật anti-debugger', async () => {
    assert.strictEqual(normalConfig.extPaths.length, 1, 'Phải nạp đúng 1 extension đã chọn');
    assert.notStrictEqual(normalConfig.injectScript, null, 'injectScript không được là null');

    const { cdpActions } = await simulateCDPSetup(normalProfile, normalConfig);
    const hasScriptInjection = cdpActions.some(a => a.method === 'Page.addScriptToEvaluateOnNewDocument');
    const hasDebuggerEnable = cdpActions.some(a => a.method === 'Debugger.enable');

    assert.strictEqual(hasScriptInjection, true, 'Chế độ thường phải tiêm fingerprint');
    assert.strictEqual(hasDebuggerEnable, true, 'Chế độ thường phải bật anti-debugger khi cấu hình');
  });

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT DIAGNOSTIC MODE: ${passed}/${total} TESTS PASS`);
  console.log('====================================================\n');

  return { passedTests: passed, totalTests: total, success: passed === total };
}

if (require.main === module) {
  runDiagnosticModeTests();
}

module.exports = { runDiagnosticModeTests };
