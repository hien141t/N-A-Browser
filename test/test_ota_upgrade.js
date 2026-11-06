/**
 * test_ota_upgrade.js
 * Kiểm thử tính toàn vẹn của hệ thống Hot-Patch OTA:
 * 1. Kiểm tra update_manifest.json có chứa đầy đủ các module mới (layoutEngine, fingerprintGenerator).
 * 2. Kiểm tra tính hợp lệ của manifest Patch #18.
 * 3. Mô phỏng quá trình client nâng cấp từ bản cũ:
 *    - Tải và áp dụng file từ manifest.
 *    - Xác nhận không phát sinh lỗi "Cannot find module".
 *    - Xác nhận các hàm exported của layoutEngine & fingerprintGenerator hoạt động chuẩn.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

function runOtaUpgradeTests() {
  console.log('\n====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Nâng Cấp OTA & Phân Phối Module Mới (Patch #18)');
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

  const manifestPath = path.join(__dirname, '..', 'patches', 'update_manifest.json');
  const patchInfoPath = path.join(__dirname, '..', 'patches', 'patch_info.json');

  assert(fs.existsSync(manifestPath), 'Thiếu file update_manifest.json trong patches/');
  assert(fs.existsSync(patchInfoPath), 'Thiếu file patch_info.json trong patches/');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const patchInfo = JSON.parse(fs.readFileSync(patchInfoPath, 'utf8'));

  // --- 1. Kiểm tra cấu hình Manifest Patch #18 ---
  console.log('--- 1. Kiểm tra Cấu Hình Manifest Patch #18 ---');

  test('Manifest và PatchInfo đã được nâng cấp lên Patch #18 (v1.0.18)', () => {
    assert.strictEqual(manifest.patchNumber, 18, 'patchNumber phải là 18');
    assert.strictEqual(manifest.version, '1.0.18', 'version phải là 1.0.18');
    assert.strictEqual(patchInfo.patchNumber, 18, 'patchInfo patchNumber phải là 18');
  });

  test('Manifest chứa đầy đủ src/layoutEngine.js và src/fingerprintGenerator.js', () => {
    const layoutEntry = manifest.files.find(f => f.dest === 'src/layoutEngine.js');
    assert(layoutEntry, 'Thiếu mục src/layoutEngine.js trong manifest.files');
    assert(layoutEntry.url.includes('layoutEngine.js'), 'URL layoutEngine không hợp lệ');

    const fpEntry = manifest.files.find(f => f.dest === 'src/fingerprintGenerator.js');
    assert(fpEntry, 'Thiếu mục src/fingerprintGenerator.js trong manifest.files');
    assert(fpEntry.url.includes('fingerprintGenerator.js'), 'URL fingerprintGenerator không hợp lệ');
  });

  test('Các file được phân phối trong manifest đều có tệp nguồn thực tế tương ứng trên đĩa', () => {
    const rootDir = path.join(__dirname, '..');
    const checked = [];
    for (const file of manifest.files) {
      if (file.dest) {
        const localPath = path.join(rootDir, file.dest);
        const patchesPath = path.join(rootDir, 'patches', file.dest.replace(/^patches\//, ''));
        const exists = fs.existsSync(localPath) || fs.existsSync(patchesPath);
        assert(exists, `File trong manifest không tồn tại trên đĩa: ${file.dest}`);
        checked.push(file.dest);
      }
    }
    assert(checked.length >= 10, 'Phải kiểm tra đủ các file thiết yếu');
  });

  // --- 2. Mô phỏng Nâng Cấp OTA Client Máy Cũ ---
  console.log('\n--- 2. Mô phỏng Client Cũ Nâng Cấp OTA Không Lỗi Module ---');

  test('Mô phỏng máy cũ nhận Patch #18: Khởi chạy module thành công, không gặp Cannot find module', () => {
    const tempClientDir = path.join(os.tmpdir(), `test_ota_client_${Date.now()}`);
    fs.mkdirSync(tempClientDir, { recursive: true });

    try {
      // Giả lập máy cũ: chỉ có file main.js bản cũ (hoặc chưa có src/layoutEngine)
      const rootDir = path.join(__dirname, '..');

      // Mô phỏng trình OTA updater áp dụng các file từ manifest vào tempClientDir
      for (const item of manifest.files) {
        if (!item.dest) continue;
        let sourcePath = path.join(rootDir, item.dest);
        if (!fs.existsSync(sourcePath)) {
          sourcePath = path.join(rootDir, 'patches', item.dest.replace(/^patches\//, ''));
        }
        const targetPath = path.join(tempClientDir, item.dest);
        if (fs.existsSync(sourcePath)) {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.copyFileSync(sourcePath, targetPath);
        }
      }

      // Xác nhận các file module cốt lõi đã có mặt trong client
      const clientLayout = path.join(tempClientDir, 'src', 'layoutEngine.js');
      const clientFp = path.join(tempClientDir, 'src', 'fingerprintGenerator.js');
      assert(fs.existsSync(clientLayout), 'Client thiếu src/layoutEngine.js sau cập nhật OTA');
      assert(fs.existsSync(clientFp), 'Client thiếu src/fingerprintGenerator.js sau cập nhật OTA');

      // Thử nạp module bằng require trong client context
      const importedLayout = require(clientLayout);
      assert.strictEqual(typeof importedLayout.calculateGridPosition, 'function');
      assert.strictEqual(typeof importedLayout.normalizeDeviceRatio, 'function');
      assert.strictEqual(typeof importedLayout.getDisplayCapacity, 'function');

      const importedFp = require(clientFp);
      assert.strictEqual(typeof importedFp.generateFingerprintScript, 'function');

      // Thử tạo script fingerprint trên client vừa update
      const script = importedFp.generateFingerprintScript({ viewport: { width: 412, height: 915 } }, 'landscape');
      assert(script.includes('"landscape-primary"'));
    } finally {
      try { fs.rmSync(tempClientDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT OTA UPGRADE: ${passed}/${total} TESTS PASS`);
  console.log('====================================================\n');

  return { passedTests: passed, totalTests: total, success: passed === total };
}

if (require.main === module) {
  runOtaUpgradeTests();
}

module.exports = { runOtaUpgradeTests };
