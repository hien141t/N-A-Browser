/**
 * test_multi_profiles_sim.js
 * Kiểm thử mô phỏng 5–10 profiles chạy đồng thời trên Windows OS:
 * 1. Chạy đồng thời 5, 8, 10 profiles với hỗn hợp thiết bị (Samsung S24, iPhone 15 Pro, iPad Pro, Xiaomi).
 * 2. Hỗn hợp chế độ khóa hướng (Portrait, Landscape, Auto).
 * 3. Hỗn hợp chế độ Clean Diagnostic và Stealth Fingerprint.
 * 4. Xác nhận không chồng đè, không tràn viền, đạt giới hạn tối thiểu của Windows.
 * 5. Xác nhận thư mục profiles/clean_<id> cách ly chính xác.
 * 6. Kiểm tra tái sắp xếp (re-arrange) khi đóng bớt profile.
 */

const assert = require('assert');
const {
  calculateGridPosition,
  normalizeDeviceRatio,
  computeEmulationState,
  getProfileDirectoryName,
  MIN_WIN_WIDTH,
  MIN_WIN_HEIGHT
} = require('../src/layoutEngine');
const { generateFingerprintScript } = require('../src/fingerprintGenerator');
const { isOverlapping } = require('./test_grid_math');

function runMultiProfilesSimulation() {
  console.log('\n====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Mô phỏng 5–10 Profiles Đồng Thời Trên Windows');
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

  const sampleDevices = [
    { name: 'Samsung Galaxy S24 Ultra', viewport: { width: 412, height: 915 }, is_mobile: true },
    { name: 'iPhone 15 Pro Max', viewport: { width: 430, height: 932 }, is_mobile: true },
    { name: 'iPad Pro 11"', viewport: { width: 1024, height: 768 }, is_mobile: true },
    { name: 'Google Pixel 8 Pro', viewport: { width: 412, height: 892 }, is_mobile: true },
    { name: 'Xiaomi 14 Pro', viewport: { width: 393, height: 873 }, is_mobile: true },
    { name: 'iPad Mini', viewport: { width: 768, height: 1024 }, is_mobile: true },
    { name: 'Samsung Galaxy Z Fold 5', viewport: { width: 904, height: 2316 }, is_mobile: true },
    { name: 'iPhone SE 3', viewport: { width: 375, height: 667 }, is_mobile: true },
    { name: 'ASUS ROG Phone 7', viewport: { width: 412, height: 915 }, is_mobile: true },
    { name: 'Sony Xperia 1 V', viewport: { width: 384, height: 854 }, is_mobile: true },
  ];

  const orientations = ['portrait', 'landscape', 'auto', 'portrait', 'landscape', 'auto', 'portrait', 'landscape', 'portrait', 'auto'];

  const displayFHD = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 }
  };

  // --- 1. Mô phỏng 5 Profiles Đồng Thời ---
  console.log('--- 1. Mô phỏng 5 Profiles Đồng Thời ---');
  test('5 Profiles đồng thời: Layout lưới Auto Fit không đè nhau & không tràn', () => {
    const profiles = [];
    for (let i = 0; i < 5; i++) {
      profiles.push({
        id: `prof_5_${i}`,
        name: `Profile 5 - ${i}`,
        device: sampleDevices[i],
        orientationLock: orientations[i],
        diagnosticMode: (i % 2 === 0)
      });
    }

    const windows = [];
    for (let i = 0; i < profiles.length; i++) {
      const pos = calculateGridPosition(i, 5, null, { mode: 'autoFit' }, profiles[i], displayFHD);
      windows.push(pos);

      // Thư mục lưu trữ
      const dirName = getProfileDirectoryName(profiles[i].id, profiles[i].diagnosticMode);
      if (profiles[i].diagnosticMode) {
        assert(dirName.startsWith('clean_'), 'Diagnostic profile phải có prefix clean_');
      } else {
        assert(!dirName.startsWith('clean_'), 'Normal profile không được có prefix clean_');
      }

      // Kích thước tối thiểu Windows OS
      assert(pos.winW >= MIN_WIN_WIDTH, `winW (${pos.winW}) < MIN_WIN_WIDTH`);
      assert(pos.winH >= MIN_WIN_HEIGHT, `winH (${pos.winH}) < MIN_WIN_HEIGHT`);

      // Không tràn màn hình
      assert(pos.posX + pos.winW <= displayFHD.workArea.width, 'Tràn mép phải');
      assert(pos.posY + pos.winH <= displayFHD.workArea.height, 'Tràn mép dưới');

      // Fingerprint script
      const fp = generateFingerprintScript(profiles[i].device, profiles[i].orientationLock);
      if (profiles[i].orientationLock === 'landscape') {
        assert(fp.includes('"landscape-primary"'), 'Landscape fingerprint');
      } else if (profiles[i].orientationLock === 'portrait') {
        assert(fp.includes('"portrait-primary"'), 'Portrait fingerprint');
      }
    }

    // Không chồng đè
    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        assert(!isOverlapping(windows[i], windows[j]), `Cửa sổ 5-profile ${i} đè lên ${j}`);
      }
    }
  });

  // --- 2. Mô phỏng 8 Profiles Đồng Thời ---
  console.log('\n--- 2. Mô phỏng 8 Profiles Đồng Thời ---');
  test('8 Profiles đồng thời: 4 cột x 2 hàng không đè nhau & không tràn', () => {
    const profiles = [];
    for (let i = 0; i < 8; i++) {
      profiles.push({
        id: `prof_8_${i}`,
        name: `Profile 8 - ${i}`,
        device: sampleDevices[i],
        orientationLock: orientations[i],
        diagnosticMode: (i === 1 || i === 5)
      });
    }

    const windows = [];
    for (let i = 0; i < profiles.length; i++) {
      const pos = calculateGridPosition(i, 8, null, { mode: 'autoFit' }, profiles[i], displayFHD);
      windows.push(pos);
      assert(pos.winW >= MIN_WIN_WIDTH);
      assert(pos.winH >= MIN_WIN_HEIGHT);
      assert(pos.posX + pos.winW <= displayFHD.workArea.width);
      assert(pos.posY + pos.winH <= displayFHD.workArea.height);
    }

    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        assert(!isOverlapping(windows[i], windows[j]), `Cửa sổ 8-profile ${i} đè lên ${j}`);
      }
    }
  });

  // --- 3. Mô phỏng 10 Profiles Đồng Thời ---
  console.log('\n--- 3. Mô phỏng 10 Profiles Đồng Thời ---');
  test('10 Profiles đồng thời: 5 cột x 2 hàng không đè nhau & không tràn', () => {
    const profiles = [];
    for (let i = 0; i < 10; i++) {
      profiles.push({
        id: `prof_10_${i}`,
        name: `Profile 10 - ${i}`,
        device: sampleDevices[i],
        orientationLock: orientations[i],
        diagnosticMode: (i % 3 === 0)
      });
    }

    const windows = [];
    for (let i = 0; i < profiles.length; i++) {
      const pos = calculateGridPosition(i, 10, null, { mode: 'autoFit' }, profiles[i], displayFHD);
      windows.push(pos);
      assert(pos.winW >= MIN_WIN_WIDTH);
      assert(pos.winH >= MIN_WIN_HEIGHT);
      assert(pos.posX + pos.winW <= displayFHD.workArea.width);
      assert(pos.posY + pos.winH <= displayFHD.workArea.height);
    }

    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        assert(!isOverlapping(windows[i], windows[j]), `Cửa sổ 10-profile ${i} đè lên ${j}`);
      }
    }
  });

  // --- 4. Mô phỏng Tái Sắp Xếp Khi Đóng Profile (10 -> 6 Profiles) ---
  console.log('\n--- 4. Mô phỏng Tái Sắp Xếp (Re-arrange) Khi Đóng Profile ---');
  test('Khi đóng 4 profile (10 -> 6): Lưới tự động co cụm về 3x2 tối ưu không để lại khoảng trống', () => {
    // 6 profile còn lại
    const remaining = [];
    for (let i = 0; i < 6; i++) {
      remaining.push({
        id: `prof_remain_${i}`,
        device: sampleDevices[i],
        orientationLock: orientations[i]
      });
    }

    const windows = [];
    for (let i = 0; i < remaining.length; i++) {
      const pos = calculateGridPosition(i, 6, null, { mode: 'autoFit' }, remaining[i], displayFHD);
      windows.push(pos);
      assert(pos.colsPerRow === 3, 'Phải chuyển sang 3 cột');
      assert(pos.rows === 2, 'Phải chuyển sang 2 hàng');
    }

    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        assert(!isOverlapping(windows[i], windows[j]), `Cửa sổ re-arrange ${i} đè lên ${j}`);
      }
    }
  });

  // --- 5. Mô phỏng 15, 20, 25 Profiles Trên Màn Hình Nhỏ 1366x768 (Chống Tràn & Phân Tầng Offset) ---
  console.log('\n--- 5. Mô phỏng 15, 20, 25 Profiles Trên Màn Hình Nhỏ 1366x768 (Laptop HD) ---');
  const displayHD = {
    bounds: { x: 0, y: 0, width: 1366, height: 768 },
    workArea: { x: 0, y: 0, width: 1366, height: 728 }
  };

  const highCounts = [15, 20, 25];
  for (const count of highCounts) {
    test(`Màn hình 1366x768 với ${count} profiles: Đạt min size, không tràn viền, KHÔNG đè khít tọa độ`, () => {
      const profiles = [];
      for (let i = 0; i < count; i++) {
        profiles.push({
          id: `prof_hd_${count}_${i}`,
          name: `Profile HD ${i}`,
          device: sampleDevices[i % sampleDevices.length],
          orientationLock: orientations[i % orientations.length],
          diagnosticMode: (i % 4 === 0)
        });
      }

      const windows = [];
      for (let i = 0; i < count; i++) {
        const pos = calculateGridPosition(i, count, null, { mode: 'autoFit' }, profiles[i], displayHD);
        windows.push(pos);

        // Kích thước tối thiểu chuẩn Windows OS
        assert(pos.winW >= MIN_WIN_WIDTH, `Profile ${i}: winW (${pos.winW}) < MIN_WIN_WIDTH (${MIN_WIN_WIDTH})`);
        assert(pos.winH >= MIN_WIN_HEIGHT, `Profile ${i}: winH (${pos.winH}) < MIN_WIN_HEIGHT (${MIN_WIN_HEIGHT})`);

        // Không tràn mép màn hình
        assert(pos.posX >= displayHD.workArea.x, `Profile ${i}: posX (${pos.posX}) âm`);
        assert(pos.posY >= displayHD.workArea.y, `Profile ${i}: posY (${pos.posY}) âm`);
        assert(pos.posX + pos.winW <= displayHD.workArea.x + displayHD.workArea.width, `Profile ${i}: Tràn mép phải (${pos.posX + pos.winW} > 1366)`);
        assert(pos.posY + pos.winH <= displayHD.workArea.y + displayHD.workArea.height, `Profile ${i}: Tràn mép dưới (${pos.posY + pos.winH} > 728)`);
      }

      // Kiểm tra TUYỆT ĐỐI không có 2 cửa sổ nào bị đè khít cùng tọa độ (X, Y)
      for (let i = 0; i < windows.length; i++) {
        for (let j = i + 1; j < windows.length; j++) {
          const exactSameCoords = (windows[i].posX === windows[j].posX && windows[i].posY === windows[j].posY);
          assert(!exactSameCoords, `LỖI ĐÈ KHÍT TỌA ĐỘ: Cửa sổ ${i} và ${j} có cùng tọa độ (${windows[i].posX}, ${windows[i].posY})`);

          // Nếu cùng trang/lớp (pageLayer), tuyệt đối không được chồng lấn
          if (windows[i].pageLayer === windows[j].pageLayer) {
            assert(!isOverlapping(windows[i], windows[j]), `Cửa sổ ${i} đè lên cửa sổ ${j} trên cùng pageLayer ${windows[i].pageLayer}`);
          }
        }
      }
    });
  }

  // --- 6. Mô phỏng Quy Mô Lớn 50–100 Profiles (True Paging, Chống Tràn & Chống Đè Lấn Tọa Độ) ---
  console.log('\n--- 6. Mô phỏng Quy Mô Lớn 50–100 Profiles (True Paging) ---');
  const massiveCounts = [50, 100];
  for (const count of massiveCounts) {
    test(`Quy mô lớn ${count} profiles đồng thời: Phân trang thực sự (totalPages > 1), đạt min bounds, KHÔNG đè khít tọa độ`, () => {
      const profiles = [];
      for (let i = 0; i < count; i++) {
        profiles.push({
          id: `prof_massive_${count}_${i}`,
          name: `Massive Profile ${i}`,
          device: sampleDevices[i % sampleDevices.length],
          orientationLock: orientations[i % orientations.length],
          diagnosticMode: (i % 5 === 0)
        });
      }

      const windows = [];
      for (let i = 0; i < count; i++) {
        const pos = calculateGridPosition(i, count, null, { mode: 'autoFit' }, profiles[i], displayFHD);
        windows.push(pos);

        // Kích thước chuẩn
        assert(pos.winW >= MIN_WIN_WIDTH, `Profile ${i}: winW (${pos.winW}) < MIN_WIN_WIDTH`);
        assert(pos.winH >= MIN_WIN_HEIGHT, `Profile ${i}: winH (${pos.winH}) < MIN_WIN_HEIGHT`);

        // Nằm trọn trong workArea
        assert(pos.posX >= displayFHD.workArea.x, `Profile ${i}: posX âm`);
        assert(pos.posY >= displayFHD.workArea.y, `Profile ${i}: posY âm`);
        assert(pos.posX + pos.winW <= displayFHD.workArea.width, `Profile ${i}: Tràn phải`);
        assert(pos.posY + pos.winH <= displayFHD.workArea.height, `Profile ${i}: Tràn đáy`);

        // Siêu dữ liệu phân trang thực sự (True Paging)
        assert(pos.totalPages >= 2, `Cần ít nhất 2 trang cho ${count} profiles (hiện tại: ${pos.totalPages})`);
        assert(pos.page >= 0, 'Số trang hợp lệ');
        assert(pos.pageIndex < pos.capacity, 'Chỉ mục trong trang phải < sức chứa trang');
      }

      // Xác minh tuyệt đối KHÔNG có 2 cửa sổ nào có cùng tọa độ (X, Y)
      const coordSet = new Set();
      for (let i = 0; i < windows.length; i++) {
        const key = `${windows[i].posX},${windows[i].posY}`;
        assert(!coordSet.has(key), `LỖI ĐÈ KHÍT TỌA ĐỘ Ở QUY MÔ ${count} CỬA SỔ: Cửa sổ ${i} trùng tọa độ (${key})`);
        coordSet.add(key);
      }

      // Các cửa sổ cùng một trang (page) tuyệt đối không được chồng lấn
      for (let i = 0; i < windows.length; i++) {
        for (let j = i + 1; j < windows.length; j++) {
          if (windows[i].page === windows[j].page) {
            assert(!isOverlapping(windows[i], windows[j]), `Trùng lấn giữa cửa sổ ${i} và ${j} trên cùng trang ${windows[i].page}`);
          }
        }
      }
    });
  }

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT MULTI-PROFILES SIMULATION: ${passed}/${total} TESTS PASS`);
  console.log('====================================================\n');

  return { passedTests: passed, totalTests: total, success: passed === total };
}

if (require.main === module) {
  runMultiProfilesSimulation();
}

module.exports = { runMultiProfilesSimulation };
