/**
 * Test Suite: Opera Launcher Engine & Fingerprint Manager Verification
 * Tests Opera binary detection, State Machine progression, immediate Cancel,
 * Fingerprint CRUD and validation.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
  LAUNCH_STATES,
  findOperaBinary,
  launchOperaProfile,
  cancelLaunch,
  closeOperaProfile,
  getAllBrowserStatuses,
  setStateChangeCallback,
} = require('../src/operaLauncher');

const {
  createDefaultFingerprint,
  getFingerprint,
  updateFingerprint,
  generateFingerprint,
  resetFingerprint,
  validateFingerprint,
} = require('../src/fingerprintManager');

const rootDir = path.resolve(__dirname, '..');
const testAppDataDir = path.join(rootDir, 'test', 'temp_app_data');
fs.mkdirSync(testAppDataDir, { recursive: true });

async function runTests() {
  console.log('====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Opera Launcher & Fingerprint Manager');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ FAIL: ${name}\n     ${e.message}`);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ FAIL: ${name}\n     ${e.message}`);
    }
  }

  // ── 1. CHROMIUM / BROWSER BINARY DETECTION ──
  console.log('--- 1. Kiểm tra Tìm Kiếm & Xác Nhận Chromium / Browser Binary ---');
  test('Tìm thấy Chromium / Google Chrome thật trên hệ thống Windows', () => {
    const res = findOperaBinary();
    assert.strictEqual(res.found, true, 'Phải tìm thấy Chromium/Chrome trên máy');
    assert.ok(fs.existsSync(res.path), `Tệp trình duyệt phải tồn tại: ${res.path}`);
    assert.ok(res.engine.includes('Chromium') || res.path.toLowerCase().includes('chrome') || res.path.toLowerCase().includes('opera'), 'Phải là Chromium engine');
  });

  test('Báo lỗi rõ ràng khi không tìm thấy trình duyệt', () => {
    const res = findOperaBinary('C:\\InvalidPath\\NonExistentBrowser\\chrome.exe');
    assert.strictEqual(res.found, false);
    assert.ok(res.error.length > 0, 'Phải có thông báo lỗi rõ ràng');
  });

  // ── 2. FINGERPRINT MANAGER CRUD & VALIDATION ──
  console.log('\n--- 2. Fingerprint Manager (CRUD & Validation) ---');

  // Prepare dummy profiles.json in testAppDataDir
  const dummyProfile = {
    id: 'test_prof_001',
    name: 'Opera Profile Test',
    device: {
      id: 'samsung_s24',
      brand: 'Samsung',
      model: 'Galaxy S24 Ultra',
      platform: 'Linux armv8l',
      is_mobile: true,
      viewport: { width: 412, height: 915 },
      timezone: 'Asia/Ho_Chi_Minh',
      language: 'vi-VN',
      webgl_vendor: 'Qualcomm',
      webgl_renderer: 'Adreno (TM) 750',
    },
    orientationLock: 'portrait',
  };
  fs.writeFileSync(path.join(testAppDataDir, 'profiles.json'), JSON.stringify([dummyProfile], null, 2));

  test('fingerprint:get tạo mới và trả về cấu trúc 8 nhóm thông số chuẩn', () => {
    const res = getFingerprint(testAppDataDir, 'test_prof_001');
    assert.strictEqual(res.ok, true);
    assert.ok(res.fingerprint);
    const fp = res.fingerprint;
    assert.strictEqual(fp.device.os, 'Android');
    assert.strictEqual(fp.device.brand, 'Samsung');
    assert.strictEqual(fp.screen.width, 412);
    assert.strictEqual(fp.screen.height, 915);
    assert.strictEqual(fp.screen.orientation, 'portrait');
    assert.strictEqual(fp.canvas.noiseEnabled, true);
    assert.ok(typeof fp.canvas.noiseSeed === 'number');
    assert.strictEqual(fp.hardware.hardwareConcurrency, 8);
    assert.strictEqual(fp.timezone.timezone, 'Asia/Ho_Chi_Minh');
  });

  test('fingerprint:update cập nhật chính xác các nhóm mà không làm hỏng nhóm khác', () => {
    const updateRes = updateFingerprint(testAppDataDir, 'test_prof_001', {
      hardware: { hardwareConcurrency: 12, deviceMemory: 16 },
      canvas: { noiseSeed: 999888777 },
    });
    assert.strictEqual(updateRes.ok, true);
    assert.strictEqual(updateRes.fingerprint.hardware.hardwareConcurrency, 12);
    assert.strictEqual(updateRes.fingerprint.hardware.deviceMemory, 16);
    assert.strictEqual(updateRes.fingerprint.canvas.noiseSeed, 999888777);
    // Nhóm khác giữ nguyên
    assert.strictEqual(updateRes.fingerprint.device.brand, 'Samsung');
  });

  test('fingerprint:validate xác thực độ nhất quán (Score & Issues detection)', () => {
    // Current valid profile
    const v1 = validateFingerprint(testAppDataDir, 'test_prof_001');
    assert.strictEqual(v1.ok, true);
    assert.strictEqual(v1.isValid, true);
    assert.strictEqual(v1.score, 100);

    // Conflict case: Android device with Apple GPU and conflicting screen orientation
    updateFingerprint(testAppDataDir, 'test_prof_001', {
      webgl: { vendor: 'Apple Inc.', renderer: 'Apple GPU' },
      screen: { width: 915, height: 412, orientation: 'portrait' }
    });
    const v2 = validateFingerprint(testAppDataDir, 'test_prof_001');
    assert.strictEqual(v2.ok, true);
    assert.strictEqual(v2.isValid, false);
    assert.ok(v2.issues.length >= 2, 'Phải phát hiện ít nhất 2 lỗi xung đột');
    assert.ok(v2.score < 100);
  });

  test('fingerprint:reset khôi phục cấu hình về mặc định', () => {
    const res = resetFingerprint(testAppDataDir, 'test_prof_001');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.fingerprint.webgl.vendor, 'Qualcomm');
    assert.strictEqual(res.fingerprint.screen.width, 412);
    assert.strictEqual(res.fingerprint.screen.height, 915);
  });

  // ── 3. STATE MACHINE & IMMEDIATE CANCEL ──
  console.log('\n--- 3. State Machine & Immediate Cancel ---');

  await testAsync('Launch và Cancel ngay lập tức (Không để kẹt tiến trình, không mất dữ liệu)', async () => {
    const cancelProfile = {
      id: 'test_cancel_prof',
      name: 'Cancel Test Profile',
      startUrl: 'https://example.com',
      device: dummyProfile.device,
    };

    const recordedStates = [];
    setStateChangeCallback((evt) => {
      if (evt.profileId === 'test_cancel_prof') {
        recordedStates.push(evt.state);
      }
    });

    // Start launch in background
    const launchPromise = launchOperaProfile({
      profile: cancelProfile,
      appDataDir: testAppDataDir,
      mainWindow: null,
    });

    // Cancel within 50ms (during STARTING or CONNECTING)
    await new Promise(r => setTimeout(r, 50));
    const cancelRes = await cancelLaunch('test_cancel_prof');
    assert.strictEqual(cancelRes.ok, true);
    assert.strictEqual(cancelRes.cancelled, true);

    const result = await launchPromise;
    assert.strictEqual(result.cancelled, true);

    // Verify states progressed through CANCELLING / CANCELLED
    assert.ok(recordedStates.includes(LAUNCH_STATES.STARTING));
    assert.ok(recordedStates.includes(LAUNCH_STATES.CANCELLING) || recordedStates.includes(LAUNCH_STATES.CANCELLED));

    // Verify session cleaned up
    const statuses = getAllBrowserStatuses();
    assert.ok(!statuses['test_cancel_prof'] || !statuses['test_cancel_prof'].running);

    // Give Windows OS process manager 600ms to complete handle recycling before launching live profile
    await new Promise(r => setTimeout(r, 600));
  });

  // ── 4. LIVE CHROMIUM LAUNCH VERIFICATION ──
  console.log('\n--- 4. Live Chromium Browser Launch & Navigation ---');

  await testAsync('Live Chromium: Mở trang đích thành công (Không kẹt about:blank, báo trạng thái READY)', async () => {
    const liveProfile = {
      id: 'test_live_opera_prof',
      name: 'Chromium Live Profile',
      startUrl: 'https://example.com',
      device: dummyProfile.device,
      orientationLock: 'portrait',
    };

    const recordedStates = [];
    setStateChangeCallback((evt) => {
      if (evt.profileId === 'test_live_opera_prof') {
        recordedStates.push(evt.state);
      }
    });

    const res = await launchOperaProfile({
      profile: liveProfile,
      appDataDir: testAppDataDir,
      mainWindow: null,
    });

    assert.strictEqual(res.ok, true, `Khởi chạy trình duyệt phải thành công: ${res.error || ''}`);
    assert.strictEqual(res.state, LAUNCH_STATES.READY);
    assert.ok(res.pid > 0);

    // Verify sequence: STARTING -> CONNECTING -> NAVIGATING -> READY
    assert.ok(recordedStates.includes(LAUNCH_STATES.STARTING), 'Phải qua STARTING');
    assert.ok(recordedStates.includes(LAUNCH_STATES.CONNECTING), 'Phải qua CONNECTING');
    assert.ok(recordedStates.includes(LAUNCH_STATES.NAVIGATING), 'Phải qua NAVIGATING');
    assert.ok(recordedStates.includes(LAUNCH_STATES.READY), 'Phải đến READY');

    // Close profile cleanly
    await closeOperaProfile('test_live_opera_prof');
    const finalStatuses = getAllBrowserStatuses();
    assert.ok(!finalStatuses['test_live_opera_prof'] || !finalStatuses['test_live_opera_prof'].running);
  });

  // Cleanup temp test directory
  try {
    fs.rmSync(testAppDataDir, { recursive: true, force: true });
  } catch(e) {}

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT OPERA & FINGERPRINT: ${passed}/${total} TESTS PASS (${Math.round(passed/total*100)}%)`);
  console.log('====================================================\n');

  return { passedTests: passed, totalTests: total, success: passed === total };
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}

module.exports = { runOperaLaunchAndFpTests: runTests };
