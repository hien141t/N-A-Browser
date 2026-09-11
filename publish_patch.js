/**
 * N/A Browser - One-click Hot-Patch Publisher
 * Usage: node publish_patch.js "Mô tả nội dung bản vá mới"
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = __dirname;
const patchesDir = path.join(rootDir, 'patches');
const patchesRendererDir = path.join(patchesDir, 'renderer');
const manifestPath = path.join(patchesDir, 'update_manifest.json');

const commitMsg = process.argv[2] || 'Bản vá cập nhật sửa lỗi và tối ưu hóa giao diện';

let manifest = { patchNumber: 0, version: '1.0.0' };
if (fs.existsSync(manifestPath)) {
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch(e){}
}

const nextPatchNum = (manifest.patchNumber || 0) + 1;
const rawBaseUrl = 'https://raw.githubusercontent.com/hien141t/N-A-Browser/main/patches/renderer/';

// Copy current renderer files to patches/renderer
fs.mkdirSync(patchesRendererDir, { recursive: true });
const filesToPatch = ['app.js', 'index.html', 'style.css'];
const patchFilesList = [];

filesToPatch.forEach(f => {
  const src = path.join(rootDir, 'src', 'renderer', f);
  const dest = path.join(patchesRendererDir, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    patchFilesList.push({
      filename: f,
      url: rawBaseUrl + f
    });
  }
});

const newManifest = {
  version: '1.0.' + nextPatchNum,
  patchNumber: nextPatchNum,
  title: `Bản vá Hot-Patch #${nextPatchNum}`,
  changelog: commitMsg,
  updatedAt: new Date().toISOString(),
  files: patchFilesList
};

fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2), 'utf-8');
console.log(`✅ Đã tạo Bản vá #${nextPatchNum}: "${commitMsg}"`);

// Git commit & push
try {
  console.log('🚀 Đang đẩy bản vá lên GitHub...');
  execSync('git add patches/ && git commit -m "release: hot-patch #' + nextPatchNum + ' - ' + commitMsg.replace(/"/g, '') + '" && git push origin main', { cwd: rootDir, stdio: 'inherit' });
  console.log(`🎉 THÀNH CÔNG! Bản vá #${nextPatchNum} đã được xuất bản lên GitHub!`);
  console.log('Mọi khách hàng mở app bấm "Kiểm tra bản vá" sẽ nhận được cập nhật ngay lập tức.');
} catch (err) {
  console.error('❌ Lỗi khi đẩy lên GitHub:', err.message);
}
