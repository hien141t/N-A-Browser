/**
 * test_grid_math.js
 * Kiểm thử TRỰC TIẾP thuật toán production calculateGridPosition từ src/layoutEngine.js.
 * 
 * Kiểm tra:
 * 1. Màn hình 1920x1080 với 1, 3, 5, 6, 10 profiles (Không đè, không tràn, tuân thủ Windows Min Size).
 * 2. Màn hình 1366x768 (HD Laptop) với 1, 3, 4, 6 profiles.
 * 3. Hỗ trợ Multi-Display (Màn 1 offset x=0, Màn 2 offset x=1920).
 * 4. Kiểm tra giới hạn kích thước tối thiểu Windows OS (MIN_WIN_WIDTH, MIN_WIN_HEIGHT).
 * 5. Lưới hỗn hợp Portrait + Landscape không chồng đè.
 */

const assert = require('assert');
const {
  calculateGridPosition,
  MIN_WIN_WIDTH,
  MIN_WIN_HEIGHT
} = require('../src/layoutEngine');

function isOverlapping(rect1, rect2) {
  return !(
    rect1.posX + rect1.winW <= rect2.posX ||
    rect2.posX + rect2.winW <= rect1.posX ||
    rect1.posY + rect1.winH <= rect2.posY ||
    rect2.posY + rect2.winH <= rect1.posY
  );
}

function runGridMathTests() {
  console.log('\n====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Thuật toán Production Auto Fit Grid');
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

  // --- 1. Màn hình 1920x1080 (FHD) ---
  console.log('--- 1. Màn hình 1920x1080 (FHD) ---');
  const displayFHD = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 } // Chừa taskbar 40px
  };

  const countsFHD = [1, 3, 5, 6, 10];
  for (const count of countsFHD) {
    test(`1920x1080 với ${count} profiles (Production Grid): Không đè nhau, không tràn, đạt min size`, () => {
      const windows = [];
      for (let i = 0; i < count; i++) {
        const dummyProfile = {
          id: `p_${i}`,
          orientationLock: 'portrait',
          device: { viewport: { width: 412, height: 915 } }
        };
        const pos = calculateGridPosition(i, count, null, { mode: 'autoFit' }, dummyProfile, displayFHD);
        windows.push(pos);

        // Kiểm tra không tràn màn hình
        assert(pos.posX >= displayFHD.workArea.x, `posX (${pos.posX}) < workArea.x`);
        assert(pos.posY >= displayFHD.workArea.y, `posY (${pos.posY}) < workArea.y`);
        assert(pos.posX + pos.winW <= displayFHD.workArea.x + displayFHD.workArea.width, `Tràn mép phải: ${pos.posX + pos.winW} > ${displayFHD.workArea.width}`);
        assert(pos.posY + pos.winH <= displayFHD.workArea.y + displayFHD.workArea.height, `Tràn mép dưới: ${pos.posY + pos.winH} > ${displayFHD.workArea.height}`);

        // Kiểm tra giới hạn tối thiểu của Windows OS
        assert(pos.winW >= MIN_WIN_WIDTH, `winW (${pos.winW}) < MIN_WIN_WIDTH (${MIN_WIN_WIDTH})`);
        assert(pos.winH >= MIN_WIN_HEIGHT, `winH (${pos.winH}) < MIN_WIN_HEIGHT (${MIN_WIN_HEIGHT})`);
      }

      // Kiểm tra không chồng lấn giữa các cửa sổ
      for (let i = 0; i < windows.length; i++) {
        for (let j = i + 1; j < windows.length; j++) {
          assert(!isOverlapping(windows[i], windows[j]), `Cửa sổ ${i} đè lên cửa sổ ${j}`);
        }
      }
    });
  }

  // --- 2. Màn hình 1366x768 (HD Laptop) ---
  console.log('\n--- 2. Màn hình 1366x768 (HD Laptop) ---');
  const displayHD = {
    bounds: { x: 0, y: 0, width: 1366, height: 768 },
    workArea: { x: 0, y: 0, width: 1366, height: 728 }
  };

  const countsHD = [1, 3, 4, 6];
  for (const count of countsHD) {
    test(`1366x768 với ${count} profiles (Production Grid): Không overflow & Không đè nhau`, () => {
      const windows = [];
      for (let i = 0; i < count; i++) {
        const dummyProfile = {
          id: `p_hd_${i}`,
          orientationLock: 'portrait',
          device: { viewport: { width: 390, height: 844 } }
        };
        const pos = calculateGridPosition(i, count, null, { mode: 'autoFit' }, dummyProfile, displayHD);
        windows.push(pos);

        assert(pos.posX >= displayHD.workArea.x, `posX âm`);
        assert(pos.posY >= displayHD.workArea.y, `posY âm`);
        assert(pos.posX + pos.winW <= displayHD.workArea.x + displayHD.workArea.width, `Tràn ngang`);
        assert(pos.posY + pos.winH <= displayHD.workArea.y + displayHD.workArea.height, `Tràn dọc`);
        assert(pos.winW >= MIN_WIN_WIDTH, `Dưới ngưỡng min width Windows`);
      }

      for (let i = 0; i < windows.length; i++) {
        for (let j = i + 1; j < windows.length; j++) {
          assert(!isOverlapping(windows[i], windows[j]), `Cửa sổ HD ${i} đè lên cửa sổ ${j}`);
        }
      }
    });
  }

  // --- 3. Hỗ trợ Multi-Display ---
  console.log('\n--- 3. Hỗ trợ Multi-Display ---');
  const display2 = {
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    workArea: { x: 1920, y: 0, width: 1920, height: 1040 }
  };

  test('Multi-Display Màn 1: Tọa độ chính xác trong bounds màn 1 (x=0)', () => {
    const dummy = { id: 'm1', orientationLock: 'portrait', device: { viewport: { width: 412, height: 915 } } };
    const pos = calculateGridPosition(0, 2, null, { mode: 'autoFit' }, dummy, displayFHD);
    assert(pos.posX >= 0 && pos.posX < 1920, 'Tọa độ ngoài màn 1');
    assert(pos.winW >= MIN_WIN_WIDTH);
  });

  test('Multi-Display Màn 2: Tọa độ bắt đầu từ offset x=1920 và nằm trọn trong màn 2', () => {
    const dummy = { id: 'm2', orientationLock: 'portrait', device: { viewport: { width: 412, height: 915 } } };
    const pos = calculateGridPosition(0, 2, null, { mode: 'autoFit' }, dummy, display2);
    assert(pos.posX >= 1920, `posX (${pos.posX}) phải >= 1920`);
    assert(pos.posX + pos.winW <= 3840, `Cửa sổ tràn ra ngoài màn 2: ${pos.posX + pos.winW}`);
  });

  // --- 4. Hỗn hợp Dọc / Ngang trên cùng 1 Grid ---
  console.log('\n--- 4. Hỗn hợp Dọc / Ngang trên cùng 1 Grid ---');
  test('Lưới 4 cửa sổ hỗn hợp (2 Portrait + 2 Landscape): Không đè nhau, không tràn', () => {
    const mixedProfiles = [
      { id: 'mix_0', orientationLock: 'portrait', device: { viewport: { width: 412, height: 915 } } },
      { id: 'mix_1', orientationLock: 'landscape', device: { viewport: { width: 915, height: 412 } } },
      { id: 'mix_2', orientationLock: 'portrait', device: { viewport: { width: 390, height: 844 } } },
      { id: 'mix_3', orientationLock: 'landscape', device: { viewport: { width: 844, height: 390 } } },
    ];

    const windows = [];
    for (let i = 0; i < mixedProfiles.length; i++) {
      const pos = calculateGridPosition(i, 4, null, { mode: 'autoFit' }, mixedProfiles[i], displayFHD);
      windows.push(pos);
      assert(pos.posX + pos.winW <= 1920, 'Tràn mép phải');
      assert(pos.posY + pos.winH <= 1040, 'Tràn mép dưới');
    }

    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        assert(!isOverlapping(windows[i], windows[j]), `Cửa sổ mixed ${i} đè lên cửa sổ ${j}`);
      }
    }
  });

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT GRID MATH: ${passed}/${total} TESTS PASS`);
  console.log('====================================================\n');

  return { passedTests: passed, totalTests: total, success: passed === total };
}

if (require.main === module) {
  runGridMathTests();
}

module.exports = { runGridMathTests, isOverlapping };
