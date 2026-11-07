/**
 * test_ota_upgrade.js
 * Kiểm thử tính toàn vẹn của hệ thống Hot-Patch OTA Patch #19:
 * 1. Kiểm tra update_manifest.json có chứa đầy đủ các module mới:
 *    (layoutEngine, fingerprintGenerator, fingerprintManager, operaLauncher).
 * 2. Kiểm tra tính hợp lệ của manifest Patch #19 (v1.0.19).
 * 3. Kiểm tra tính sạch sẽ: Không chứa bất kỳ extension đóng gói sẵn nào (custom_extensions/ext_*).
 * 4. Mô phỏng quá trình client nâng cấp từ Patch #18 lên Patch #19:
 *    - Tải và áp dụng file từ manifest.
 *    - Xác nhận không phát sinh lỗi "Cannot find module".
 *    - Xác nhận các hàm exported của cả 4 modules hoạt động chuẩn.
 *    - Xác nhận extensions.json rỗng [] và không tự nạp extension mẫu.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

function runOtaUpgradeTests() {
  console.log('\n====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Nâng Cấp OTA & Phân Phối Module Mới (Patch #19)');
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

  // --- 1. Kiểm tra cấu hình Manifest Patch #20 ---
  console.log('--- 1. Kiểm tra Cấu Hình Manifest Patch #20 ---');

  test('Manifest và PatchInfo đã được nâng cấp lên Patch #20 (v1.0.20)', () => {
    assert.strictEqual(manifest.patchNumber, 20, 'patchNumber phải là 20');
    assert.strictEqual(manifest.version, '1.0.20', 'version phải là 1.0.20');
    assert.strictEqual(patchInfo.patchNumber, 20, 'patchInfo patchNumber phải là 20');
    assert.strictEqual(patchInfo.version, '1.0.20', 'patchInfo version phải là 1.0.20');
  });

  test('Manifest chứa đầy đủ các module cốt lõi (layoutEngine, fingerprintGenerator, fingerprintManager, operaLauncher, browserLauncher)', () => {
    const requiredModules = [
      'src/layoutEngine.js',
      'src/fingerprintGenerator.js',
      'src/fingerprintManager.js',
      'src/operaLauncher.js',
      'src/browserLauncher.js'
    ];

    for (const mod of requiredModules) {
      const entry = manifest.files.find(f => f.dest === mod);
      assert(entry, `Thiếu mục ${mod} trong manifest.files`);
      assert(entry.url.includes(path.basename(mod)), `URL ${mod} không hợp lệ`);
    }
  });

  test('Manifest và Repo hoàn toàn SẠCH: Không chứa bất kỳ extension đóng gói sẵn nào', () => {
    const extFiles = manifest.files.filter(f => (f.dest || '').includes('custom_extensions/ext_'));
    assert.strictEqual(extFiles.length, 0, 'Manifest không được chứa file extension đóng gói sẵn');

    const extJsonPath = path.join(__dirname, '..', 'extensions.json');
    if (fs.existsSync(extJsonPath)) {
      const content = JSON.parse(fs.readFileSync(extJsonPath, 'utf8'));
      assert.deepStrictEqual(content, [], 'extensions.json trong repo phải là mảng rỗng []');
    }
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
  console.log('\n--- 2. Mô phỏng Client Cũ Nâng Cấp OTA Lên Patch #19 Không Lỗi Module ---');

  test('Mô phỏng máy cũ nhận Patch #19: Cả 4 module nạp thành công, không gặp Cannot find module', () => {
    const tempClientDir = path.join(__dirname, `temp_ota_client_p19_${Date.now()}`);
    fs.mkdirSync(tempClientDir, { recursive: true });

    try {
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
      const clientFpMgr = path.join(tempClientDir, 'src', 'fingerprintManager.js');
      const clientOpera = path.join(tempClientDir, 'src', 'operaLauncher.js');
      const clientBrowser = path.join(tempClientDir, 'src', 'browserLauncher.js');

      assert(fs.existsSync(clientLayout), 'Client thiếu src/layoutEngine.js sau cập nhật OTA');
      assert(fs.existsSync(clientFp), 'Client thiếu src/fingerprintGenerator.js sau cập nhật OTA');
      assert(fs.existsSync(clientFpMgr), 'Client thiếu src/fingerprintManager.js sau cập nhật OTA');
      assert(fs.existsSync(clientOpera), 'Client thiếu src/operaLauncher.js sau cập nhật OTA');
      assert(fs.existsSync(clientBrowser), 'Client thiếu src/browserLauncher.js sau cập nhật OTA');

      // Thử nạp các module bằng require trong client context
      const importedLayout = require(clientLayout);
      assert.strictEqual(typeof importedLayout.calculateGridPosition, 'function');
      assert.strictEqual(typeof importedLayout.normalizeDeviceRatio, 'function');
      assert.strictEqual(typeof importedLayout.getDisplayCapacity, 'function');

      const importedFp = require(clientFp);
      assert.strictEqual(typeof importedFp.generateFingerprintScript, 'function');

      const importedFpMgr = require(clientFpMgr);
      assert.strictEqual(typeof importedFpMgr.getFingerprint, 'function');
      assert.strictEqual(typeof importedFpMgr.validateFingerprint, 'function');
      assert.strictEqual(typeof importedFpMgr.resetFingerprint, 'function');

      const importedOpera = require(clientOpera);
      assert.strictEqual(typeof importedOpera.findOperaBinary, 'function');
      assert.strictEqual(typeof importedOpera.launchOperaProfile, 'function');
      assert.strictEqual(typeof importedOpera.cancelLaunch, 'function');

      const importedBrowser = require(clientBrowser);
      assert.strictEqual(typeof importedBrowser.findBrowserBinary, 'function');
      assert.strictEqual(typeof importedBrowser.launchBrowserProfile, 'function');
    } finally {
      try { fs.rmSync(tempClientDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  test('Nâng cấp tuần tự Patch #19 -> #20: Cài đặt Patch 19 cũ, sau đó nhận bản vá 20 và chuyển đổi version 1.0.19 -> 1.0.20 hoàn hảo', () => {
    const tempOldClient = path.join(__dirname, `temp_ota_p19_to_p20_${Date.now()}`);
    fs.mkdirSync(tempOldClient, { recursive: true });

    try {
      // 1. Tạo bản cài đặt Patch #19 cũ:
      const p19Info = { patchNumber: 19, version: '1.0.19', title: 'Patch #19 Old' };
      fs.writeFileSync(path.join(tempOldClient, 'patch_info.json'), JSON.stringify(p19Info, null, 2));
      fs.mkdirSync(path.join(tempOldClient, 'patches'), { recursive: true });
      fs.writeFileSync(path.join(tempOldClient, 'patches', 'patch_info.json'), JSON.stringify(p19Info, null, 2));

      // 2. Chạy quy trình OTA Updater: Áp dụng manifest Patch #20
      const rootDir = path.join(__dirname, '..');
      for (const item of manifest.files) {
        if (!item.dest) continue;
        let srcPath = path.join(rootDir, item.dest);
        if (!fs.existsSync(srcPath)) {
          srcPath = path.join(rootDir, 'patches', item.dest.replace(/^patches\//, ''));
        }
        const destPath = path.join(tempOldClient, item.dest);
        if (fs.existsSync(srcPath)) {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(srcPath, destPath);
        }
      }

      // Cập nhật patch_info lên bản mới
      fs.writeFileSync(path.join(tempOldClient, 'patch_info.json'), JSON.stringify({
        patchNumber: manifest.patchNumber,
        version: manifest.version,
        updatedAt: new Date().toISOString()
      }, null, 2));

      // 3. Xác minh tính toàn vẹn sau khi nâng cấp
      const upgradedInfo = JSON.parse(fs.readFileSync(path.join(tempOldClient, 'patch_info.json'), 'utf8'));
      assert.strictEqual(upgradedInfo.patchNumber, 20, 'Phải nâng lên patchNumber = 20');
      assert.strictEqual(upgradedInfo.version, '1.0.20', 'Phải nâng lên version = 1.0.20');

      // Cả 5 module mới phải tồn tại và nạp thành công
      const layoutFile = path.join(tempOldClient, 'src', 'layoutEngine.js');
      const fpFile = path.join(tempOldClient, 'src', 'fingerprintGenerator.js');
      const fpMgrFile = path.join(tempOldClient, 'src', 'fingerprintManager.js');
      const operaFile = path.join(tempOldClient, 'src', 'operaLauncher.js');
      const browserFile = path.join(tempOldClient, 'src', 'browserLauncher.js');

      assert(fs.existsSync(layoutFile), 'Thiếu src/layoutEngine.js sau nâng cấp');
      assert(fs.existsSync(fpFile), 'Thiếu src/fingerprintGenerator.js sau nâng cấp');
      assert(fs.existsSync(fpMgrFile), 'Thiếu src/fingerprintManager.js sau nâng cấp');
      assert(fs.existsSync(operaFile), 'Thiếu src/operaLauncher.js sau nâng cấp');
      assert(fs.existsSync(browserFile), 'Thiếu src/browserLauncher.js sau nâng cấp');

      const layoutMod = require(layoutFile);
      const fpMod = require(fpFile);
      const fpMgrMod = require(fpMgrFile);
      const operaMod = require(operaFile);
      const browserMod = require(browserFile);

      assert.strictEqual(typeof layoutMod.calculateGridPosition, 'function');
      assert.strictEqual(typeof fpMod.generateFingerprintScript, 'function');
      assert.strictEqual(typeof fpMgrMod.validateFingerprint, 'function');
      assert.strictEqual(typeof operaMod.launchOperaProfile, 'function');
      assert.strictEqual(typeof browserMod.launchBrowserProfile, 'function');
    } finally {
      try { fs.rmSync(tempOldClient, { recursive: true, force: true }); } catch (e) {}
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
