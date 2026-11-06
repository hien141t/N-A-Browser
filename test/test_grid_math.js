/**
 * test_grid_math.js
 * Kiểm thử tự động thuật toán Auto Fit Grid và tính toán tọa độ cửa sổ.
 * 
 * Kiểm tra các trường hợp:
 * 1. Màn hình 1920x1080 với 1, 3, 5, 6, 10 profiles:
 *    - Tính toán (x, y, width, height) cho từng cửa sổ.
 *    - Xác nhận không có cửa sổ nào bị đè lên nhau (overlap).
 *    - Xác nhận không có cửa sổ nào vượt ra ngoài workArea.
 * 2. Màn hình 1366x768 với 1, 3, 4, 6 profiles:
 *    - Xác nhận không bị overflow.
 * 3. Hỗ trợ multi-display (Display 1: 1920x1080, Display 2: 1920x1080 / 2560x1440):
 *    - Xác nhận tọa độ chính xác theo workArea của màn hình đích.
 */

const assert = require('assert');

/**
 * Thuật toán Auto Fit Grid tính toán vị trí và kích thước cửa sổ
 * @param {Object} params
 * @param {number} params.index - Chỉ số của cửa sổ (0-indexed)
 * @param {number} params.totalRunning - Tổng số cửa sổ cần sắp xếp
 * @param {Object} params.workArea - { x, y, width, height }
 * @param {Object} [params.customOpts] - Các tùy chọn bổ sung
 * @param {Object} [params.profileCustomWin] - Tùy chọn riêng của profile
 * @returns {Object} { posX, posY, winW, winH, col, row, totalCols, totalRows }
 */
function calculateAutoFitGridPosition(params) {
  const {
    index,
    totalRunning = 1,
    workArea = { x: 0, y: 0, width: 1920, height: 1080 },
    customOpts = {},
    profileCustomWin = null
  } = params;

  const N = Math.max(1, totalRunning);
  const startX = parseInt(customOpts.startX) >= 0 ? parseInt(customOpts.startX) : 10;
  const startY = parseInt(customOpts.startY) >= 0 ? parseInt(customOpts.startY) : 10;
  const gapX = parseInt(customOpts.gapX) >= 0 ? parseInt(customOpts.gapX) : 10;
  const gapY = parseInt(customOpts.gapY) >= 0 ? parseInt(customOpts.gapY) : 10;
  const autoAdapt = customOpts.autoAdapt !== false;
  const mode = customOpts.mode || 'grid';

  const availW = workArea.width - (2 * startX);
  const availH = workArea.height - (2 * startY);

  if (mode === 'cascade') {
    let winW = parseInt(customOpts.winW || customOpts.windowWidth || 380);
    let winH = parseInt(customOpts.winH || customOpts.windowHeight || 675);
    if (profileCustomWin && profileCustomWin.width && profileCustomWin.height) {
      winW = parseInt(profileCustomWin.width);
      winH = parseInt(profileCustomWin.height);
    }
    winW = Math.min(winW, availW);
    winH = Math.min(winH, availH);
    const posX = workArea.x + startX + (index * gapX);
    const posY = workArea.y + startY + (index * gapY);
    return { posX, posY, winW, winH, mode: 'cascade' };
  }

  // Chế độ Grid: tìm số cột và hàng tối ưu
  let bestCols = 1;
  let bestRows = 1;
  let bestW = 380;
  let bestH = 675;

  if (autoAdapt) {
    // Tìm cấu hình (cols, rows) sao cho cols * rows >= N và tối đa hóa diện tích hiển thị
    // Tỷ lệ mặc định của mobile: ~9:19.5 (khoảng 0.4615) hoặc custom
    let targetRatio = 9 / 19.5;
    if (profileCustomWin && profileCustomWin.width && profileCustomWin.height) {
      targetRatio = profileCustomWin.width / profileCustomWin.height;
    }

    let maxArea = -1;

    for (let c = 1; c <= N; c++) {
      const r = Math.ceil(N / c);
      const cellW = (availW - (c - 1) * gapX) / c;
      const cellH = (availH - (r - 1) * gapY) / r;

      if (cellW <= 50 || cellH <= 50) continue;

      let w = cellW;
      let h = w / targetRatio;

      if (h > cellH) {
        h = cellH;
        w = h * targetRatio;
      }

      // Giới hạn max width/height hợp lý
      w = Math.min(w, cellW, 600);
      h = Math.min(h, cellH, 1000);

      const area = w * h;
      if (area > maxArea) {
        maxArea = area;
        bestCols = c;
        bestRows = r;
        bestW = Math.floor(w);
        bestH = Math.floor(h);
      }
    }
  } else {
    bestCols = parseInt(customOpts.colsPerRow) || 3;
    bestRows = Math.ceil(N / bestCols);
    bestW = parseInt(customOpts.winW || customOpts.windowWidth || 380);
    bestH = parseInt(customOpts.winH || customOpts.windowHeight || 675);

    // Đảm bảo không tràn màn hình ngay cả khi autoAdapt = false
    const maxW = (availW - (bestCols - 1) * gapX) / bestCols;
    const maxH = (availH - (bestRows - 1) * gapY) / bestRows;
    bestW = Math.min(bestW, maxW);
    bestH = Math.min(bestH, maxH);
  }

  const col = index % bestCols;
  const row = Math.floor(index / bestCols);

  const posX = workArea.x + startX + col * (bestW + gapX);
  const posY = workArea.y + startY + row * (bestH + gapY);

  return {
    posX,
    posY,
    winW: bestW,
    winH: bestH,
    col,
    row,
    totalCols: bestCols,
    totalRows: bestRows,
    mode: 'grid'
  };
}

/**
 * Kiểm tra xem 2 hình chữ nhật có đè lên nhau không
 */
function isOverlapping(rect1, rect2) {
  // Hai rect đè lên nhau nếu phần giao nhau có diện tích > 0
  const noOverlap = (
    rect1.x + rect1.w <= rect2.x || // rect1 nằm hoàn toàn bên trái rect2
    rect2.x + rect2.w <= rect1.x || // rect2 nằm hoàn toàn bên trái rect1
    rect1.y + rect1.h <= rect2.y || // rect1 nằm hoàn toàn phía trên rect2
    rect2.y + rect2.h <= rect1.y    // rect2 nằm hoàn toàn phía trên rect1
  );
  return !noOverlap;
}

/**
 * Chạy toàn bộ test suite cho Grid Math
 */
function runGridMathTests() {
  console.log('====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Thuật toán Auto Fit Grid');
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

  // -----------------------------------------------------------
  // 1. MÀN HÌNH 1920x1080 với 1, 3, 5, 6, 10 profiles
  // -----------------------------------------------------------
  console.log('--- 1. Màn hình 1920x1080 (FHD) ---');
  const screenFHD = { x: 0, y: 0, width: 1920, height: 1080 };
  const countsFHD = [1, 3, 5, 6, 10];

  countsFHD.forEach(count => {
    runTest(`1920x1080 với ${count} profiles: Không đè nhau & Không tràn workArea`, () => {
      const windows = [];
      for (let i = 0; i < count; i++) {
        const pos = calculateAutoFitGridPosition({
          index: i,
          totalRunning: count,
          workArea: screenFHD,
          customOpts: { autoAdapt: true }
        });

        // 1. Kiểm tra kích thước hợp lệ
        assert(pos.winW > 50, `Window ${i}: width quá nhỏ (${pos.winW}px)`);
        assert(pos.winH > 50, `Window ${i}: height quá nhỏ (${pos.winH}px)`);

        // 2. Kiểm tra không vượt quá workArea (boundary check)
        assert(pos.posX >= screenFHD.x, `Window ${i}: posX (${pos.posX}) < workArea.x (${screenFHD.x})`);
        assert(pos.posY >= screenFHD.y, `Window ${i}: posY (${pos.posY}) < workArea.y (${screenFHD.y})`);
        assert(
          pos.posX + pos.winW <= screenFHD.x + screenFHD.width,
          `Window ${i}: Tràn viền phải! posX (${pos.posX}) + winW (${pos.winW}) = ${pos.posX + pos.winW} > ${screenFHD.x + screenFHD.width}`
        );
        assert(
          pos.posY + pos.winH <= screenFHD.y + screenFHD.height,
          `Window ${i}: Tràn viền dưới! posY (${pos.posY}) + winH (${pos.winH}) = ${pos.posY + pos.winH} > ${screenFHD.y + screenFHD.height}`
        );

        windows.push({ i, x: pos.posX, y: pos.posY, w: pos.winW, h: pos.winH });
      }

      // 3. Kiểm tra không có cặp cửa sổ nào đè lên nhau
      for (let a = 0; a < windows.length; a++) {
        for (let b = a + 1; b < windows.length; b++) {
          const overlap = isOverlapping(windows[a], windows[b]);
          assert(
            !overlap,
            `Cửa sổ ${windows[a].i} đè lên cửa sổ ${windows[b].i}: A[${windows[a].x},${windows[a].y},${windows[a].w},${windows[a].h}] vs B[${windows[b].x},${windows[b].y},${windows[b].w},${windows[b].h}]`
          );
        }
      }
    });
  });

  // -----------------------------------------------------------
  // 2. MÀN HÌNH 1366x768 (HD Laptop) với 1, 3, 4, 6 profiles
  // -----------------------------------------------------------
  console.log('\n--- 2. Màn hình 1366x768 (HD Laptop) ---');
  const screenHD = { x: 0, y: 0, width: 1366, height: 768 };
  const countsHD = [1, 3, 4, 6];

  countsHD.forEach(count => {
    runTest(`1366x768 với ${count} profiles: Không overflow workArea`, () => {
      const windows = [];
      for (let i = 0; i < count; i++) {
        const pos = calculateAutoFitGridPosition({
          index: i,
          totalRunning: count,
          workArea: screenHD,
          customOpts: { autoAdapt: true }
        });

        // Kiểm tra không overflow
        assert(pos.posX >= screenHD.x, `Window ${i}: posX ngoài màn hình`);
        assert(pos.posY >= screenHD.y, `Window ${i}: posY ngoài màn hình`);
        assert(
          pos.posX + pos.winW <= screenHD.x + screenHD.width,
          `Window ${i}: Overflow chiều ngang! X+W=${pos.posX + pos.winW} > 1366`
        );
        assert(
          pos.posY + pos.winH <= screenHD.y + screenHD.height,
          `Window ${i}: Overflow chiều dọc! Y+H=${pos.posY + pos.winH} > 768`
        );

        windows.push({ i, x: pos.posX, y: pos.posY, w: pos.winW, h: pos.winH });
      }

      // Kiểm tra overlap
      for (let a = 0; a < windows.length; a++) {
        for (let b = a + 1; b < windows.length; b++) {
          assert(!isOverlapping(windows[a], windows[b]), `Overlap giữa ${a} và ${b}`);
        }
      }
    });
  });

  // -----------------------------------------------------------
  // 3. MULTI-DISPLAY (Display 1 và Display 2)
  // -----------------------------------------------------------
  console.log('\n--- 3. Hỗ trợ Multi-Display ---');
  const display1 = { id: 0, name: 'Display 1 (1920x1080)', workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const display2 = { id: 1, name: 'Display 2 (2560x1440)', workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };

  runTest('Display 1: Tọa độ chính xác trong bounds màn 1', () => {
    const pos = calculateAutoFitGridPosition({
      index: 0,
      totalRunning: 4,
      workArea: display1.workArea,
      customOpts: { displayIndex: 0 }
    });
    assert(pos.posX >= 0 && pos.posX + pos.winW <= 1920, 'Vượt ra ngoài Display 1');
    assert(pos.posY >= 0 && pos.posY + pos.winH <= 1040, 'Vượt ra ngoài Display 1');
  });

  runTest('Display 2: Tọa độ bắt đầu từ offset x=1920 và nằm trọn trong màn 2', () => {
    const total = 4;
    const windows = [];
    for (let i = 0; i < total; i++) {
      const pos = calculateAutoFitGridPosition({
        index: i,
        totalRunning: total,
        workArea: display2.workArea,
        customOpts: { displayIndex: 1 }
      });

      assert(pos.posX >= display2.workArea.x, `Window ${i}: posX (${pos.posX}) < Display 2 X (${display2.workArea.x})`);
      assert(
        pos.posX + pos.winW <= display2.workArea.x + display2.workArea.width,
        `Window ${i}: Tràn Display 2 bên phải! (${pos.posX + pos.winW} > ${display2.workArea.x + display2.workArea.width})`
      );
      assert(
        pos.posY + pos.winH <= display2.workArea.y + display2.workArea.height,
        `Window ${i}: Tràn Display 2 bên dưới!`
      );
      windows.push({ i, x: pos.posX, y: pos.posY, w: pos.winW, h: pos.winH });
    }

    for (let a = 0; a < windows.length; a++) {
      for (let b = a + 1; b < windows.length; b++) {
        assert(!isOverlapping(windows[a], windows[b]), `Overlap trên Display 2 giữa ${a} và ${b}`);
      }
    }
  });

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT GRID MATH: ${passedTests}/${totalTests} TESTS PASS`);
  console.log('====================================================\n');

  return { passedTests, totalTests, success: passedTests === totalTests };
}

if (require.main === module) {
  const result = runGridMathTests();
  process.exit(result.success ? 0 : 1);
}

module.exports = {
  calculateAutoFitGridPosition,
  isOverlapping,
  runGridMathTests
};
