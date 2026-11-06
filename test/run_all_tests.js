/**
 * run_all_tests.js
 * Test Runner tổng hợp tất cả các bài kiểm thử tự động của N/A Browser:
 * 1. Production Auto Fit Grid Math (1920x1080, 1366x768, Multi-Display, Mixed, Windows Min Limits)
 * 2. Aspect Ratio & Orientation Lock (Phone, Tablet preset, Auto, Normalized Ratio)
 * 3. Debounce & Anti-Loop Window Resize
 * 4. Clean Diagnostic Mode & Directory Isolation (clean_<id>)
 * 5. API & IPC Compatibility Audit
 * 6. Live Chromium / CDP Emulation (innerWidth, innerHeight, screen.orientation)
 * 7. Multi-Window 5-25 Profiles Simulation (Capacity, Layered Offset, Windows OS limits)
 * 8. Hot-Patch OTA Upgrade & Module Distribution (Patch #18, Manifest, Client Simulation)
 */

const { runGridMathTests } = require('./test_grid_math');
const { runAspectRatioTests } = require('./test_aspect_ratio');
const { runDebounceResizeTests } = require('./test_debounce_resize');
const { runDiagnosticModeTests } = require('./test_diagnostic_mode');
const { runApiCompatibilityTests } = require('./test_api_compatibility');
const { runChromiumEmulationTests } = require('./test_chromium_emulation_live');
const { runMultiProfilesSimulation } = require('./test_multi_profiles_sim');
const { runOtaUpgradeTests } = require('./test_ota_upgrade');

async function main() {
  console.log('############################################################');
  console.log('#           CLOAKDROID SUITE AUTOMATED REGRESSION TESTS    #');
  console.log('############################################################\n');

  const results = [];

  // 1. Grid Math (Production layoutEngine)
  const gridRes = runGridMathTests();
  results.push({ name: 'Auto Fit Grid (Production Math)', ...gridRes });

  // 2. Aspect Ratio (Production normalizeDeviceRatio & computeEmulationState)
  const aspectRes = runAspectRatioTests();
  results.push({ name: 'Aspect Ratio & Orientation Lock', ...aspectRes });

  // 3. Debounce & Anti-Loop
  const debounceRes = await runDebounceResizeTests();
  results.push({ name: 'Debounce & Anti-Loop Resize', ...debounceRes });

  // 4. Diagnostic Mode & clean_<id> Isolation
  const diagRes = await runDiagnosticModeTests();
  results.push({ name: 'Clean Diagnostic Mode Isolation', ...diagRes });

  // 5. API Compatibility
  const apiRes = runApiCompatibilityTests();
  results.push({ name: 'API & IPC Compatibility', ...apiRes });

  // 6. Live Chromium & CDP Emulation
  const liveRes = await runChromiumEmulationTests();
  results.push({ name: 'Live Chromium CDP Emulation', ...liveRes });

  // 7. Multi-Profiles Simultaneous Simulation (5-25 profiles)
  const simRes = runMultiProfilesSimulation();
  results.push({ name: 'Multi-Window 5-25 Profiles Sim', ...simRes });

  // 8. Hot-Patch OTA Upgrade & Module Distribution
  const otaRes = runOtaUpgradeTests();
  results.push({ name: 'OTA Patch #18 Distribution', ...otaRes });

  console.log('============================================================');
  console.log('                 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ             ');
  console.log('============================================================');
  console.log('| Chuyên mục kiểm thử                | Kết quả | Tỷ lệ PASS |');
  console.log('|------------------------------------|---------|------------|');

  let totalAll = 0;
  let passedAll = 0;

  for (const r of results) {
    totalAll += r.totalTests;
    passedAll += r.passedTests;
    const status = r.success ? '✅ PASS' : '❌ FAIL';
    const rate = `${r.passedTests}/${r.totalTests}`.padEnd(10);
    const paddedName = r.name.padEnd(34);
    console.log(`| ${paddedName} | ${status}  | ${rate} |`);
  }

  console.log('|------------------------------------|---------|------------|');
  console.log(`| TỔNG CỘNG TOÀN BỘ SUITE            | ${passedAll === totalAll ? '✅ PASS' : '❌ FAIL'}  | ${passedAll}/${totalAll}        |`);
  console.log('============================================================\n');

  if (passedAll === totalAll) {
    console.log('🎉 TẤT CẢ 8 BỘ KIỂM THỬ ĐÃ PASS 100%!');
  } else {
    console.log(`⚠️ CÓ ${totalAll - passedAll} TEST FAILED! Cần kiểm tra lại.`);
  }

  process.exit(passedAll === totalAll ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
