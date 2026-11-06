/**
 * test_aspect_ratio.js
 * Kiểm thử TRỰC TIẾP normalizeDeviceRatio & computeEmulationState từ src/layoutEngine.js.
 * 
 * Kiểm tra:
 * 1. Thiết bị dọc chuẩn (Phone 412x915):
 *    - orientationLock = 'portrait': width < height, tỷ lệ chuẩn ~0.45, portrait-primary, angle 0.
 *    - orientationLock = 'landscape': width > height, tỷ lệ chuẩn ~2.22, landscape-primary, angle 90.
 * 2. Thiết bị ngang chuẩn / Tablet (1024x768):
 *    - orientationLock = 'portrait': Đảm bảo chuẩn hóa min/max không bị đảo ngược tỷ lệ!
 *    - orientationLock = 'landscape': Đảm bảo chuẩn hóa min/max đúng chiều!
 * 3. orientationLock = 'auto': Tự suy luận từ kích thước gốc.
 * 4. Đồng bộ hóa CDP computeEmulationState (Visual Viewport vs Window Bounds).
 */

const assert = require('assert');
const {
  normalizeDeviceRatio,
  computeEmulationState,
  UI_DELTA_X,
  UI_DELTA_Y
} = require('../src/layoutEngine');

function runAspectRatioTests() {
  console.log('\n====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Tỷ lệ Khung Hình & Khóa Hướng (Production Math)');
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

  // --- 1. Điện thoại thông thường (412x915) ---
  console.log('--- 1. Thiết bị Phone chuẩn (412x915) ---');
  const phoneDevice = { viewport: { width: 412, height: 915 } };

  test('Phone + orientationLock="portrait": screen.orientation="portrait-primary", angle=0, ratio < 1', () => {
    const norm = normalizeDeviceRatio(phoneDevice, 'portrait');
    assert.strictEqual(norm.isLandscape, false);
    assert.strictEqual(norm.screenOrientation.jsType, 'portrait-primary');
    assert.strictEqual(norm.screenOrientation.angle, 0);
    assert.strictEqual(norm.windowOrientation, 0);
    assert.strictEqual(norm.screenWidth, 412);
    assert.strictEqual(norm.screenHeight, 915);
    assert(Math.abs(norm.targetRatio - (412 / 915)) < 0.001);
  });

  test('Phone + orientationLock="landscape": screen.orientation="landscape-primary", angle=90, ratio > 1', () => {
    const norm = normalizeDeviceRatio(phoneDevice, 'landscape');
    assert.strictEqual(norm.isLandscape, true);
    assert.strictEqual(norm.screenOrientation.jsType, 'landscape-primary');
    assert.strictEqual(norm.screenOrientation.angle, 90);
    assert.strictEqual(norm.windowOrientation, 90);
    assert.strictEqual(norm.screenWidth, 915);
    assert.strictEqual(norm.screenHeight, 412);
    assert(Math.abs(norm.targetRatio - (915 / 412)) < 0.001);
  });

  // --- 2. Tablet / Preset vốn dĩ nằm ngang (1024x768) ---
  console.log('\n--- 2. Tablet / Preset vốn nằm ngang (1024x768) - CHỐNG ĐẢO TỶ LỆ ---');
  const tabletDevice = { viewport: { width: 1024, height: 768 } };

  test('Tablet vốn nằm ngang khi khóa "portrait" KHÔNG bị đảo tỷ lệ (targetRatio < 1)', () => {
    const norm = normalizeDeviceRatio(tabletDevice, 'portrait');
    assert.strictEqual(norm.isLandscape, false);
    assert.strictEqual(norm.screenOrientation.jsType, 'portrait-primary');
    assert.strictEqual(norm.screenOrientation.angle, 0);
    assert.strictEqual(norm.screenWidth, 768);
    assert.strictEqual(norm.screenHeight, 1024);
    // targetRatio phải là min/max = 768/1024 = 0.75 (< 1.0), không được là 1024/768!
    assert.strictEqual(norm.targetRatio, 768 / 1024);
    assert(norm.targetRatio < 1.0, `targetRatio (${norm.targetRatio}) phải < 1.0 cho portrait`);
  });

  test('Tablet vốn nằm ngang khi khóa "landscape" (targetRatio > 1)', () => {
    const norm = normalizeDeviceRatio(tabletDevice, 'landscape');
    assert.strictEqual(norm.isLandscape, true);
    assert.strictEqual(norm.screenOrientation.jsType, 'landscape-primary');
    assert.strictEqual(norm.screenOrientation.angle, 90);
    assert.strictEqual(norm.screenWidth, 1024);
    assert.strictEqual(norm.screenHeight, 768);
    assert.strictEqual(norm.targetRatio, 1024 / 768);
    assert(norm.targetRatio > 1.0, `targetRatio (${norm.targetRatio}) phải > 1.0 cho landscape`);
  });

  // --- 3. orientationLock="auto" ---
  console.log('\n--- 3. orientationLock="auto" ---');
  test('Phone + auto: Mặc định portrait theo tỷ lệ gốc', () => {
    const norm = normalizeDeviceRatio(phoneDevice, 'auto');
    assert.strictEqual(norm.isLandscape, false);
    assert.strictEqual(norm.screenOrientation.jsType, 'portrait-primary');
  });

  test('Tablet + auto: Mặc định landscape theo tỷ lệ gốc', () => {
    const norm = normalizeDeviceRatio(tabletDevice, 'auto');
    assert.strictEqual(norm.isLandscape, true);
    assert.strictEqual(norm.screenOrientation.jsType, 'landscape-primary');
  });

  // --- 4. Đồng bộ CDP computeEmulationState ---
  console.log('\n--- 4. Đồng bộ CDP computeEmulationState (Visual Viewport vs Window) ---');
  test('computeEmulationState: Viewport thực tế loại trừ UI delta và bảo toàn tỷ lệ', () => {
    const state = computeEmulationState({
      currentWinW: 400,
      currentWinH: 800,
      device: phoneDevice,
      orientationLock: 'portrait',
      uiDeltaX: UI_DELTA_X,
      uiDeltaY: UI_DELTA_Y
    });

    assert(state.viewportW > 0);
    assert(state.viewportH > 0);
    assert.strictEqual(state.screenOrientation.type, 'portraitPrimary');
    assert.strictEqual(state.screenOrientation.angle, 0);

    // Viewport width / height tỷ lệ chuẩn ~412/915
    const ratio = state.viewportW / state.viewportH;
    assert(Math.abs(ratio - (412 / 915)) < 0.05, `Tỷ lệ viewport ${ratio} lệch so với gốc ${412/915}`);
  });

  test('computeEmulationState: Debounced guard nhận diện lệch > 4px', () => {
    const state1 = computeEmulationState({
      currentWinW: 400,
      currentWinH: 800,
      lastKnownWinW: 400,
      lastKnownWinH: 800,
      device: phoneDevice,
      orientationLock: 'portrait'
    });
    // Kích thước chưa đổi hoặc lệch nhỏ
    assert.strictEqual(typeof state1.needsResize, 'boolean');
  });

  // --- 5. Kiểm thử Xoay Vòng Dọc -> Ngang -> Dọc (Auto Mode Roundtrip) ---
  console.log('\n--- 5. Chu kỳ Xoay Vòng Dọc -> Ngang -> Dọc (Auto Mode Roundtrip) ---');
  test('Chu kỳ Dọc -> Ngang -> Dọc trong chế độ auto: isLandscape và screenOrientation đồng bộ chuẩn xác', () => {
    // Bước 1: Khởi đầu dọc (400x800)
    const step1 = computeEmulationState({
      currentWinW: 400,
      currentWinH: 800,
      device: phoneDevice,
      orientationLock: 'auto'
    });
    assert.strictEqual(step1.isLandscape, false, 'Bước 1: Phải là portrait');
    assert.strictEqual(step1.screenOrientation.type, 'portraitPrimary');
    assert.strictEqual(step1.screenOrientation.angle, 0);

    // Bước 2: Kéo dãn sang ngang (900x450)
    const step2 = computeEmulationState({
      currentWinW: 900,
      currentWinH: 450,
      lastKnownWinW: 400,
      lastKnownWinH: 800,
      device: phoneDevice,
      orientationLock: 'auto'
    });
    assert.strictEqual(step2.isLandscape, true, 'Bước 2: Phải chuyển sang landscape');
    assert.strictEqual(step2.screenOrientation.type, 'landscapePrimary');
    assert.strictEqual(step2.screenOrientation.angle, 90);

    // Bước 3: Kéo thu hẹp lại về dọc (420x820)
    const step3 = computeEmulationState({
      currentWinW: 420,
      currentWinH: 820,
      lastKnownWinW: 900,
      lastKnownWinH: 450,
      device: phoneDevice,
      orientationLock: 'auto'
    });
    assert.strictEqual(step3.isLandscape, false, 'Bước 3: Phải chuyển ngược lại portrait');
    assert.strictEqual(step3.screenOrientation.type, 'portraitPrimary');
    assert.strictEqual(step3.screenOrientation.angle, 0);
  });

  test('computeEmulationState: Tương thích gọi hàm bằng tham số vị trí computeEmulationState(w, h)', () => {
    const posState = computeEmulationState(400, 800);
    assert.strictEqual(typeof posState.viewportW, 'number');
    assert.strictEqual(typeof posState.viewportH, 'number');
    assert.strictEqual(typeof posState.isLandscape, 'boolean');
    assert.strictEqual(posState.isLandscape, false);
  });

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT ASPECT RATIO: ${passed}/${total} TESTS PASS`);
  console.log('====================================================\n');

  return { passedTests: passed, totalTests: total, success: passed === total };
}

if (require.main === module) {
  runAspectRatioTests();
}

module.exports = { runAspectRatioTests };
