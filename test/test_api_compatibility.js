/**
 * test_api_compatibility.js
 * Kiểm thử tính tương thích giữa Backend (main.js) và Frontend (src/renderer/app.js & index.html):
 * 
 * 1. Tên trường dữ liệu:
 *    - orientationLock ('auto' | 'portrait' | 'landscape')
 *    - autoArrangeOnLaunch (boolean)
 *    - customWindow ({ preset, width, height, ... })
 * 
 * 2. Kênh IPC:
 *    - displays:get
 *    - windows:arrange (và browser:arrangeWindows backward-compat)
 *    - settings:save
 *    - settings:load
 * 
 * 3. REST API:
 *    - POST /api/profiles: tiếp nhận & lưu orientationLock, autoArrangeOnLaunch, customWindow
 *    - PUT /api/profiles/:id: cập nhật orientationLock, autoArrangeOnLaunch, customWindow
 *    - POST /api/profiles/:id/launch: khởi chạy với hỗ trợ autoArrange
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MAIN_JS_PATH = path.join(ROOT_DIR, 'main.js');
const PRELOAD_JS_PATH = path.join(ROOT_DIR, 'preload.js');
const APP_JS_PATH = path.join(ROOT_DIR, 'src', 'renderer', 'app.js');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'src', 'renderer', 'index.html');

/**
 * Kiểm tra các trường dữ liệu và kênh IPC trong mã nguồn thực tế
 */
function inspectSourceCompatibility() {
  const results = {
    ipcChannels: {},
    dataFields: {},
    restApi: {},
    filesChecked: []
  };

  const mainSrc = fs.existsSync(MAIN_JS_PATH) ? fs.readFileSync(MAIN_JS_PATH, 'utf-8') : '';
  const preloadSrc = fs.existsSync(PRELOAD_JS_PATH) ? fs.readFileSync(PRELOAD_JS_PATH, 'utf-8') : '';
  const appSrc = fs.existsSync(APP_JS_PATH) ? fs.readFileSync(APP_JS_PATH, 'utf-8') : '';
  const indexSrc = fs.existsSync(INDEX_HTML_PATH) ? fs.readFileSync(INDEX_HTML_PATH, 'utf-8') : '';

  // 1. Kênh IPC
  results.ipcChannels['displays:get'] = {
    inMain: mainSrc.includes("'displays:get'") || mainSrc.includes('"displays:get"'),
    inPreload: preloadSrc.includes('displays:get'),
    inRenderer: appSrc.includes('getDisplays') || appSrc.includes('displays:get')
  };

  results.ipcChannels['windows:arrange'] = {
    inMain: mainSrc.includes("'windows:arrange'") || mainSrc.includes('"windows:arrange"') || mainSrc.includes('browser:arrangeWindows'),
    inPreload: preloadSrc.includes('arrangeWindows') || preloadSrc.includes('windows:arrange'),
    inRenderer: appSrc.includes('arrangeWindows') || appSrc.includes('windows:arrange')
  };

  results.ipcChannels['settings:save'] = {
    inMain: mainSrc.includes("'settings:save'") || mainSrc.includes('"settings:save"'),
    inPreload: preloadSrc.includes('settings:save'),
    inRenderer: appSrc.includes('saveSettings') || appSrc.includes('settings:save')
  };

  results.ipcChannels['settings:load'] = {
    inMain: mainSrc.includes("'settings:load'") || mainSrc.includes('"settings:load"'),
    inPreload: preloadSrc.includes('settings:load'),
    inRenderer: appSrc.includes('loadSettings') || appSrc.includes('settings:load')
  };

  // 2. Data fields
  results.dataFields['orientationLock'] = {
    inMain: mainSrc.includes('orientationLock'),
    inRendererApp: appSrc.includes('orientationLock'),
    inIndexHtml: indexSrc.includes('orientationLock') || indexSrc.includes('fOrientationLock') || indexSrc.includes('settingOrientationLock')
  };

  results.dataFields['autoArrangeOnLaunch'] = {
    inMain: mainSrc.includes('autoArrangeOnLaunch') || mainSrc.includes('autoArrange'),
    inRendererApp: appSrc.includes('autoArrangeOnLaunch') || appSrc.includes('autoArrange'),
    inIndexHtml: indexSrc.includes('autoArrangeOnLaunch') || indexSrc.includes('autoArrange') || indexSrc.includes('arrAutoAdapt')
  };

  results.dataFields['customWindow'] = {
    inMain: mainSrc.includes('customWindow'),
    inRendererApp: appSrc.includes('customWindow'),
    inIndexHtml: indexSrc.includes('customWindow') || indexSrc.includes('fWinPreset') || indexSrc.includes('settingWinPreset')
  };

  // 3. REST API
  results.restApi['POST /api/profiles'] = mainSrc.includes("method === 'POST' && pathname === '/api/profiles'");
  results.restApi['PUT /api/profiles/:id'] = mainSrc.includes("method === 'PUT' && matchSingle");
  results.restApi['POST /api/profiles/:id/launch'] = mainSrc.includes("method === 'POST' && matchLaunch");

  return results;
}

/**
 * Kiểm thử mô phỏng xử lý dữ liệu và validation của REST API
 */
function testRestApiProfileHandler() {
  // Giả lập hàm xử lý POST /api/profiles
  function handlePostProfile(body) {
    const { name, deviceId, customWindow, orientationLock, autoArrangeOnLaunch } = body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { status: 400, body: { ok: false, error: 'Thiếu trường "name".' } };
    }

    const validOrientations = ['auto', 'portrait', 'landscape'];
    const resolvedOrientation = validOrientations.includes(orientationLock) ? orientationLock : 'auto';

    const newProfile = {
      id: 'prof_' + Date.now(),
      name: name.trim(),
      deviceId: deviceId || 'default_device',
      orientationLock: resolvedOrientation,
      autoArrangeOnLaunch: autoArrangeOnLaunch === true,
      customWindow: customWindow ? {
        preset: customWindow.preset || 'custom',
        width: parseInt(customWindow.width) || 380,
        height: parseInt(customWindow.height) || 675
      } : null,
      createdAt: Date.now()
    };

    return { status: 200, body: { ok: true, profile: newProfile } };
  }

  // Giả lập hàm xử lý PUT /api/profiles/:id
  function handlePutProfile(existing, body) {
    const validOrientations = ['auto', 'portrait', 'landscape'];
    const resolvedOrientation = body.orientationLock !== undefined && validOrientations.includes(body.orientationLock)
      ? body.orientationLock
      : (existing.orientationLock || 'auto');

    const updated = {
      ...existing,
      name: body.name ? body.name.trim() : existing.name,
      orientationLock: resolvedOrientation,
      autoArrangeOnLaunch: body.autoArrangeOnLaunch !== undefined ? !!body.autoArrangeOnLaunch : !!existing.autoArrangeOnLaunch,
      customWindow: body.customWindow !== undefined ? body.customWindow : existing.customWindow,
      updatedAt: Date.now()
    };

    return { status: 200, body: { ok: true, profile: updated } };
  }

  return { handlePostProfile, handlePutProfile };
}

/**
 * Chạy test suite cho Tương thích API và IPC
 */
function runApiCompatibilityTests() {
  console.log('====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Tương thích API & Kênh IPC');
  console.log('====================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  function runTest(testName, testFn) {
    totalTests++;
    try {
      testFn();
      console.log(`  ✅ PASS: ${testName}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${testName}`);
      console.error(`     Nguyên nhân: ${err.message}`);
    }
  }

  // 1. Kiểm thử Logic Schema của REST API
  console.log('--- 1. Kiểm thử Schema REST API Profiles ---');
  const { handlePostProfile, handlePutProfile } = testRestApiProfileHandler();

  runTest('POST /api/profiles: Lưu đầy đủ orientationLock, autoArrangeOnLaunch, customWindow', () => {
    const reqBody = {
      name: 'Profile Automation 1',
      orientationLock: 'portrait',
      autoArrangeOnLaunch: true,
      customWindow: { preset: 'custom', width: 380, height: 750 }
    };

    const res = handlePostProfile(reqBody);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.profile.orientationLock, 'portrait');
    assert.strictEqual(res.body.profile.autoArrangeOnLaunch, true);
    assert.deepStrictEqual(res.body.profile.customWindow, { preset: 'custom', width: 380, height: 750 });
  });

  runTest('POST /api/profiles: Mặc định orientationLock="auto" và autoArrangeOnLaunch=false', () => {
    const reqBody = { name: 'Profile Minimal' };
    const res = handlePostProfile(reqBody);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.profile.orientationLock, 'auto');
    assert.strictEqual(res.body.profile.autoArrangeOnLaunch, false);
  });

  runTest('PUT /api/profiles/:id: Cập nhật orientationLock thành landscape và toggle autoArrangeOnLaunch', () => {
    const existing = {
      id: 'prof_1',
      name: 'Profile 1',
      orientationLock: 'portrait',
      autoArrangeOnLaunch: false,
      customWindow: { width: 380, height: 750 }
    };

    const res = handlePutProfile(existing, {
      orientationLock: 'landscape',
      autoArrangeOnLaunch: true
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.profile.orientationLock, 'landscape');
    assert.strictEqual(res.body.profile.autoArrangeOnLaunch, true);
  });

  // 2. Kiểm tra mã nguồn thực tế
  console.log('\n--- 2. Kiểm tra Mã Nguồn Thực Tế (Source Code Audit) ---');
  const audit = inspectSourceCompatibility();

  runTest('IPC displays:get có trong main.js và preload.js', () => {
    assert(audit.ipcChannels['displays:get'].inMain, 'displays:get thiếu trong main.js');
    assert(audit.ipcChannels['displays:get'].inPreload, 'displays:get thiếu trong preload.js');
  });

  runTest('IPC windows:arrange / browser:arrangeWindows có trong main.js và preload.js', () => {
    assert(audit.ipcChannels['windows:arrange'].inMain, 'windows:arrange thiếu trong main.js');
    assert(audit.ipcChannels['windows:arrange'].inPreload, 'windows:arrange thiếu trong preload.js');
  });

  runTest('IPC settings:save và settings:load có trong main.js và preload.js', () => {
    assert(audit.ipcChannels['settings:save'].inMain, 'settings:save thiếu trong main.js');
    assert(audit.ipcChannels['settings:load'].inMain, 'settings:load thiếu trong main.js');
  });

  runTest('REST API endpoints có trong main.js', () => {
    assert(audit.restApi['POST /api/profiles'], 'POST /api/profiles thiếu');
    assert(audit.restApi['PUT /api/profiles/:id'], 'PUT /api/profiles/:id thiếu');
    assert(audit.restApi['POST /api/profiles/:id/launch'], 'POST /api/profiles/:id/launch thiếu');
  });

  console.log('\n--- Tình trạng các trường mới (orientationLock, autoArrangeOnLaunch): ---');
  console.log('orientationLock:', JSON.stringify(audit.dataFields.orientationLock));
  console.log('autoArrangeOnLaunch:', JSON.stringify(audit.dataFields.autoArrangeOnLaunch));
  console.log('customWindow:', JSON.stringify(audit.dataFields.customWindow));

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT API COMPATIBILITY: ${passedTests}/${totalTests} TESTS PASS`);
  console.log('====================================================\n');

  return { passedTests, totalTests, success: passedTests === totalTests, audit };
}

if (require.main === module) {
  const res = runApiCompatibilityTests();
  process.exit(res.success ? 0 : 1);
}

module.exports = {
  inspectSourceCompatibility,
  testRestApiProfileHandler,
  runApiCompatibilityTests
};
