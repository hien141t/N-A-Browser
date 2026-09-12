/**
 * N/A Browser - One-click Hot-Patch Publisher
 * Packages Renderer UI, Core Main Process Scripts, Profile Icons/Badges, and Custom Extensions
 * Usage: node publish_patch.js "Mô tả nội dung bản vá mới"
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = __dirname;
const patchesDir = path.join(rootDir, 'patches');
const patchesRendererDir = path.join(patchesDir, 'renderer');
const patchesExtDir = path.join(patchesDir, 'custom_extensions');
const patchesIconDir = path.join(patchesDir, 'profile_icons');
const manifestPath = path.join(patchesDir, 'update_manifest.json');

const commitMsg = process.argv[2] || 'Nâng cấp Profile Icons chuẩn 256x256, Huy hiệu Taskbar Overlay Badge và Dọn rác hệ thống';

let manifest = { patchNumber: 6, version: '1.0.6' };
if (fs.existsSync(manifestPath)) {
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch(e){}
}

const nextPatchNum = (manifest.patchNumber || 6) + 1;
const rawBaseRenderer = 'https://raw.githubusercontent.com/hien141t/N-A-Browser/main/patches/renderer/';
const rawBaseExt = 'https://raw.githubusercontent.com/hien141t/N-A-Browser/main/patches/custom_extensions/';
const rawBaseIcons = 'https://raw.githubusercontent.com/hien141t/N-A-Browser/main/patches/profile_icons/';
const rawBasePatches = 'https://raw.githubusercontent.com/hien141t/N-A-Browser/main/patches/';

fs.mkdirSync(patchesRendererDir, { recursive: true });
fs.mkdirSync(patchesExtDir, { recursive: true });
fs.mkdirSync(patchesIconDir, { recursive: true });

// --- 0. Dọn dẹp các tệp rác không sử dụng ---
console.log('🧹 Đang dọn dẹp các tệp rác không sử dụng...');
// Xóa file update_manifest.json thừa ở thư mục gốc nếu có
const rootManifest = path.join(rootDir, 'update_manifest.json');
if (fs.existsSync(rootManifest)) {
  try { fs.unlinkSync(rootManifest); console.log('  - Đã xóa update_manifest.json thừa ở thư mục gốc'); } catch(e){}
}

// Xóa các extension rác cũ không còn trong extensions.json
const validExtIds = ['ext_1786469361479', 'ext_1786515448618'];
const customExtDir = path.join(rootDir, 'custom_extensions');
if (fs.existsSync(customExtDir)) {
  const allExtDirs = fs.readdirSync(customExtDir);
  for (const d of allExtDirs) {
    if (!validExtIds.includes(d)) {
      const junkDir = path.join(customExtDir, d);
      try {
        fs.rmSync(junkDir, { recursive: true, force: true });
        console.log(`  - Đã dọn dẹp thư mục tiện ích cũ: ${d}`);
      } catch(e){}
    }
  }
}

const patchFilesList = [];

// Helper copy đệ quy
function copyDirRecursive(src, dest, relPrefix, baseRawUrl, destPrefix) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relFile = relPrefix ? relPrefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, relFile, baseRawUrl, destPrefix);
    } else {
      fs.copyFileSync(srcPath, destPath);
      patchFilesList.push({
        filename: entry.name,
        dest: destPrefix + '/' + relFile,
        url: baseRawUrl + relFile
      });
    }
  }
}

// 1. Copy Renderer files (app.js, index.html, style.css)
const filesToPatch = ['app.js', 'index.html', 'style.css'];
filesToPatch.forEach(f => {
  const src = path.join(rootDir, 'src', 'renderer', f);
  const dest = path.join(patchesRendererDir, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    patchFilesList.push({
      filename: f,
      url: rawBaseRenderer + f
    });
  }
});
console.log('✅ Đã nạp giao diện Renderer vào bản vá');

// 2. Copy Core Main Process Scripts (main.js, generate_profile_icon.ps1, apply_window_icon.ps1)
const coreScripts = ['main.js', 'generate_profile_icon.ps1', 'apply_window_icon.ps1'];
coreScripts.forEach(f => {
  const src = path.join(rootDir, f);
  const dest = path.join(patchesDir, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    patchFilesList.push({
      filename: f,
      dest: f,
      url: rawBasePatches + f
    });
  }
});
console.log('✅ Đã nạp mã nguồn chính (main.js, ps1 scripts) vào bản vá');

// 3. Copy Profile Icons & Overlay Badges
const iconDir = path.join(rootDir, 'profile_icons');
if (fs.existsSync(iconDir)) {
  const iconFiles = fs.readdirSync(iconDir).filter(f => !f.includes('test_') && !f.includes('valid'));
  for (const f of iconFiles) {
    const src = path.join(iconDir, f);
    const dest = path.join(patchesIconDir, f);
    fs.copyFileSync(src, dest);
    patchFilesList.push({
      filename: f,
      dest: 'profile_icons/' + f,
      url: rawBaseIcons + f
    });
  }
  console.log(`✅ Đã nạp ${iconFiles.length} Profile Icons & Huy hiệu Taskbar Badge vào bản vá`);
}

// 4. Copy Official Custom Extensions (Tool i9 & Tool hi88)
validExtIds.forEach(extId => {
  const srcExt = path.join(rootDir, 'custom_extensions', extId);
  const destExt = path.join(patchesExtDir, extId);
  if (fs.existsSync(srcExt)) {
    copyDirRecursive(srcExt, destExt, '', rawBaseExt + extId + '/', 'custom_extensions/' + extId);
    console.log(`✅ Đã nén tiện ích ${extId} vào bản vá`);
  }
});

// 5. Copy extensions.json
const srcExtJson = path.join(rootDir, 'extensions.json');
const destExtJson = path.join(patchesDir, 'extensions.json');
if (fs.existsSync(srcExtJson)) {
  fs.copyFileSync(srcExtJson, destExtJson);
  patchFilesList.push({
    filename: 'extensions.json',
    dest: 'extensions.json',
    url: rawBasePatches + 'extensions.json'
  });
  console.log('✅ Đã nạp extensions.json vào bản vá');
}

// 6. Ghi manifest mới
const newManifest = {
  version: '1.0.' + nextPatchNum,
  patchNumber: nextPatchNum,
  title: `Bản vá Hot-Patch #${nextPatchNum}: Nâng cấp Profile Icons & Huy hiệu Taskbar`,
  changelog: commitMsg,
  updatedAt: new Date().toISOString(),
  files: patchFilesList
};

fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2), 'utf-8');
console.log(`\n🎉 Đã tạo thành công Bản vá #${nextPatchNum} gồm ${patchFilesList.length} files: "${commitMsg}"`);

// 7. Git commit & push
try {
  console.log('🚀 Đang đẩy bản vá lên GitHub...');
  execSync('git add -A && git commit -m "release: hot-patch #' + nextPatchNum + ' - ' + commitMsg.replace(/"/g, '') + '" && git push origin main', { cwd: rootDir, stdio: 'inherit' });
  console.log(`\n🌟 XUẤT BẢN THÀNH CÔNG! Bản vá #${nextPatchNum} đã lên GitHub.`);
  console.log('Các máy khác chỉ cần mở app N/A Browser và bấm "Kiểm tra bản vá mới" là sẽ tự động đồng bộ ngay lập tức.');
} catch (err) {
  console.error('❌ Lỗi khi đẩy lên GitHub:', err.message);
}
