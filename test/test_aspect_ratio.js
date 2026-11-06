/**
 * test_aspect_ratio.js
 * Kiểm thử tỷ lệ khung hình và tính năng khóa hướng màn hình (orientationLock).
 * 
 * Kiểm tra các trường hợp:
 * 1. Profile dọc (portrait): width < height, aspect ratio chuẩn 9:19.5 hoặc 9:20.
 * 2. Profile ngang (landscape): width > height, aspect ratio chuẩn 19.5:9 hoặc 16:9.
 * 3. Khóa hướng orientationLock ('auto' | 'portrait' | 'landscape'):
 *    - 'portrait': Cửa sổ luôn có width < height và tỷ lệ ~9:19.5 hoặc 9:20.
 *    - 'landscape': Cửa sổ luôn có width > height và tỷ lệ ~19.5:9 hoặc 16:9.
 *    - 'auto': Giữ nguyên hướng ban đầu của thiết bị / cấu hình.
 * 4. Hỗn hợp dọc + ngang trên cùng một lưới sắp xếp (Mixed portrait + landscape).
 */

const assert = require('assert');
const { isOverlapping } = require('./test_grid_math');

/**
 * Xử lý kích thước cửa sổ dựa theo orientationLock và device/preset
 */
function resolveWindowDimensions(opts) {
  let {
    width = 380,
    height = 675,
    orientationLock = 'auto', // 'auto' | 'portrait' | 'landscape'
    preset = 'custom',
    targetRatioPortrait = 9 / 19.5, // ~0.4615
    targetRatioLandscape = 19.5 / 9 // ~2.1667
  } = opts;

  width = parseInt(width) || 380;
  height = parseInt(height) || 675;

  if (orientationLock === 'portrait') {
    // Nếu hiện tại đang là landscape (width > height), đổi hướng thành portrait
    if (width > height) {
      const temp = width;
      width = height;
      height = temp;
    }
    // Nếu aspect ratio chưa chuẩn, chuẩn hóa
    const currentRatio = width / height;
    if (Math.abs(currentRatio - targetRatioPortrait) > 0.1) {
      width = Math.round(height * targetRatioPortrait);
    }
  } else if (orientationLock === 'landscape') {
    // Nếu hiện tại đang là portrait (width < height), đổi hướng thành landscape
    if (width < height) {
      const temp = width;
      width = height;
      height = temp;
    }
    // Chuẩn hóa tỷ lệ landscape
    const currentRatio = width / height;
    if (Math.abs(currentRatio - targetRatioLandscape) > 0.1) {
      height = Math.round(width / targetRatioLandscape);
    }
  } else {
    // 'auto': giữ nguyên tỉ lệ gốc hoặc thiết lập ban đầu
  }

  return {
    width,
    height,
    orientation: width < height ? 'portrait' : 'landscape',
    aspectRatio: width / height,
    orientationLock
  };
}

/**
 * Thuật toán sắp xếp hỗn hợp (Mixed Grid Layout) hỗ trợ cả cửa sổ dọc và ngang
 */
function arrangeMixedWindows(profiles, workArea = { x: 0, y: 0, width: 1920, height: 1080 }, options = {}) {
  const startX = options.startX !== undefined ? options.startX : 10;
  const startY = options.startY !== undefined ? options.startY : 10;
  const gapX = options.gapX !== undefined ? options.gapX : 10;
  const gapY = options.gapY !== undefined ? options.gapY : 10;

  const resolvedProfiles = profiles.map(p => {
    const dim = resolveWindowDimensions({
      width: p.customWindow?.width || (p.orientationLock === 'landscape' ? 675 : 380),
      height: p.customWindow?.height || (p.orientationLock === 'landscape' ? 380 : 675),
      orientationLock: p.orientationLock || 'auto'
    });
    return { ...p, dim };
  });

  const placedWindows = [];
  let currentX = workArea.x + startX;
  let currentY = workArea.y + startY;
  let rowMaxHeight = 0;

  for (let i = 0; i < resolvedProfiles.length; i++) {
    const prof = resolvedProfiles[i];
    let winW = prof.dim.width;
    let winH = prof.dim.height;

    // Nếu vượt quá chiều ngang của workArea, xuống hàng mới
    if (currentX + winW > workArea.x + workArea.width - startX && placedWindows.length > 0) {
      currentX = workArea.x + startX;
      currentY += rowMaxHeight + gapY;
      rowMaxHeight = 0;
    }

    // Nếu chiều cao vượt quá workArea, tỉ lệ co lại để vừa
    if (currentY + winH > workArea.y + workArea.height - startY) {
      const scale = (workArea.height - (currentY - workArea.y) - startY) / winH;
      if (scale > 0.5) {
        winW = Math.floor(winW * scale);
        winH = Math.floor(winH * scale);
      }
    }

    placedWindows.push({
      id: prof.id || `win_${i}`,
      orientation: prof.dim.orientation,
      x: currentX,
      y: currentY,
      w: winW,
      h: winH
    });

    rowMaxHeight = Math.max(rowMaxHeight, winH);
    currentX += winW + gapX;
  }

  return placedWindows;
}

/**
 * Chạy test suite cho Aspect Ratio & Khóa Hướng
 */
function runAspectRatioTests() {
  console.log('====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Tỷ lệ khung hình & Khóa hướng');
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

  // 1. Portrait tests
  console.log('--- 1. Profile dọc (Portrait) ---');
  runTest('Profile Portrait: width < height và tỷ lệ chuẩn 9:19.5 (~0.4615)', () => {
    const dim = resolveWindowDimensions({ width: 380, height: 823, orientationLock: 'portrait' });
    assert(dim.width < dim.height, 'Portrait width phải nhỏ hơn height');
    const ratio = dim.width / dim.height;
    const target = 9 / 19.5;
    assert(Math.abs(ratio - target) < 0.05, `Tỷ lệ ${ratio} lệch so với chuẩn 9:19.5 (${target})`);
  });

  runTest('Profile Portrait: tỷ lệ chuẩn 9:20 (0.45)', () => {
    const dim = resolveWindowDimensions({
      width: 360,
      height: 800,
      orientationLock: 'portrait',
      targetRatioPortrait: 9 / 20
    });
    assert(dim.width < dim.height, 'Portrait width < height');
    const ratio = dim.width / dim.height;
    assert(Math.abs(ratio - 0.45) < 0.05, `Tỷ lệ ${ratio} lệch so với chuẩn 9:20 (0.45)`);
  });

  // 2. Landscape tests
  console.log('\n--- 2. Profile ngang (Landscape) ---');
  runTest('Profile Landscape: width > height và tỷ lệ chuẩn 19.5:9 (~2.1667)', () => {
    const dim = resolveWindowDimensions({ width: 823, height: 380, orientationLock: 'landscape' });
    assert(dim.width > dim.height, 'Landscape width phải lớn hơn height');
    const ratio = dim.width / dim.height;
    const target = 19.5 / 9;
    assert(Math.abs(ratio - target) < 0.05, `Tỷ lệ ${ratio} lệch so với chuẩn 19.5:9 (${target})`);
  });

  // 3. Khóa hướng (orientationLock switch)
  console.log('\n--- 3. Khóa hướng orientationLock ---');
  runTest('orientationLock="portrait" tự xoay kích thước landscape (800x400) về portrait', () => {
    const dim = resolveWindowDimensions({ width: 800, height: 400, orientationLock: 'portrait' });
    assert(dim.width < dim.height, `Phải chuyển thành width < height, nhận được: ${dim.width}x${dim.height}`);
    assert.strictEqual(dim.orientation, 'portrait');
  });

  runTest('orientationLock="landscape" tự xoay kích thước portrait (400x800) về landscape', () => {
    const dim = resolveWindowDimensions({ width: 400, height: 800, orientationLock: 'landscape' });
    assert(dim.width > dim.height, `Phải chuyển thành width > height, nhận được: ${dim.width}x${dim.height}`);
    assert.strictEqual(dim.orientation, 'landscape');
  });

  runTest('orientationLock="auto" giữ nguyên kích thước ban đầu', () => {
    const dimPort = resolveWindowDimensions({ width: 380, height: 675, orientationLock: 'auto' });
    assert.strictEqual(dimPort.width, 380);
    assert.strictEqual(dimPort.height, 675);
    assert.strictEqual(dimPort.orientation, 'portrait');

    const dimLand = resolveWindowDimensions({ width: 800, height: 450, orientationLock: 'auto' });
    assert.strictEqual(dimLand.width, 800);
    assert.strictEqual(dimLand.height, 450);
    assert.strictEqual(dimLand.orientation, 'landscape');
  });

  // 4. Hỗn hợp dọc + ngang trên cùng một lưới
  console.log('\n--- 4. Hỗn hợp Dọc + Ngang (Mixed Grid) ---');
  runTest('Sắp xếp 4 profile (2 Portrait + 2 Landscape): Không đè nhau & Trong workArea 1920x1080', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    const profiles = [
      { id: 'p1_port', orientationLock: 'portrait', customWindow: { width: 380, height: 750 } },
      { id: 'p2_land', orientationLock: 'landscape', customWindow: { width: 750, height: 380 } },
      { id: 'p3_port', orientationLock: 'portrait', customWindow: { width: 380, height: 750 } },
      { id: 'p4_land', orientationLock: 'landscape', customWindow: { width: 750, height: 380 } }
    ];

    const arranged = arrangeMixedWindows(profiles, workArea);
    assert.strictEqual(arranged.length, 4);

    // Kiểm tra từng cửa sổ trong workArea
    for (const win of arranged) {
      assert(win.x >= workArea.x, `${win.id}: x ngoài màn hình`);
      assert(win.y >= workArea.y, `${win.id}: y ngoài màn hình`);
      assert(win.x + win.w <= workArea.x + workArea.width, `${win.id}: Tràn viền phải`);
      assert(win.y + win.h <= workArea.y + workArea.height, `${win.id}: Tràn viền dưới`);
    }

    // Kiểm tra không có cặp nào đè lên nhau
    for (let i = 0; i < arranged.length; i++) {
      for (let j = i + 1; j < arranged.length; j++) {
        assert(!isOverlapping(arranged[i], arranged[j]), `Overlap giữa ${arranged[i].id} và ${arranged[j].id}`);
      }
    }
  });

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT ASPECT RATIO: ${passedTests}/${totalTests} TESTS PASS`);
  console.log('====================================================\n');

  return { passedTests, totalTests, success: passedTests === totalTests };
}

if (require.main === module) {
  const res = runAspectRatioTests();
  process.exit(res.success ? 0 : 1);
}

module.exports = {
  resolveWindowDimensions,
  arrangeMixedWindows,
  runAspectRatioTests
};
