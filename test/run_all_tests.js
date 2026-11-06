/**
 * run_all_tests.js
 * Test Runner tổng hợp tất cả các bài kiểm thử tự động của Agent 3.
 */

const { runGridMathTests } = require('./test_grid_math');
const { runAspectRatioTests } = require('./test_aspect_ratio');
const { runDebounceResizeTests } = require('./test_debounce_resize');
const { runDiagnosticModeTests } = require('./test_diagnostic_mode');
const { runApiCompatibilityTests } = require('./test_api_compatibility');

async function main() {
  console.log('############################################################');
  console.log('#           CLOAKDROID SUITE AUTOMATED REGRESSION TESTS    #');
  console.log('############################################################\n');

  const results = [];

  // 1. Grid Math
  const gridRes = runGridMathTests();
  results.push({ name: 'Auto Fit Grid Algorithm', ...gridRes });

  // 2. Aspect Ratio
  const aspectRes = runAspectRatioTests();
  results.push({ name: 'Aspect Ratio & Orientation Lock', ...aspectRes });

  // 3. Debounce & Anti-Loop
  const debounceRes = await runDebounceResizeTests();
  results.push({ name: 'Debounce & Anti-Loop Resize', ...debounceRes });

  // 4. Diagnostic Mode
  const diagRes = await runDiagnosticModeTests();
  results.push({ name: 'Clean Diagnostic Mode', ...diagRes });

  // 5. API Compatibility
  const apiRes = runApiCompatibilityTests();
  results.push({ name: 'API & IPC Compatibility', ...apiRes });

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
    console.log('🎉 TẤT CẢ 5 BỘ KIỂM THỬ ĐÃ PASS 100%!');
  } else {
    console.log(`⚠️ CÓ ${totalAll - passedAll} TEST FAILED! Cần kiểm tra lại.`);
  }

  process.exit(passedAll === totalAll ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
