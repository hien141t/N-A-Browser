/**
 * test_debounce_resize.js
 * Kiểm thử cơ chế debounce và chống vòng lặp đệ quy resize (anti-recursion resize loop).
 * 
 * Kiểm tra các trường hợp:
 * 1. Debounce: 50 sự kiện resize liên tiếp trong khoảng thời gian ngắn chỉ kích hoạt 1 lần gọi thực thi.
 * 2. Anti-recursion guard: Lệnh setWindowBounds không kích hoạt vòng lặp vô tận khi sự kiện resize được bắn ngược lại.
 * 3. Bounds comparison guard: Nếu kích thước mục tiêu trùng khớp với kích thước hiện tại, bỏ qua lệnh setWindowBounds.
 */

const assert = require('assert');

/**
 * Lớp quản lý Resize Window Controller với Debounce và Anti-Loop Guard
 */
class WindowResizeController {
  constructor(options = {}) {
    this.debounceMs = options.debounceMs || 150;
    this.debounceTimers = new Map(); // profileId -> timer
    this.isApplyingBounds = new Map(); // profileId -> boolean
    this.currentBounds = new Map(); // profileId -> { left, top, width, height }
    this.callCount = 0; // Đếm số lần thực sự gọi CDP Browser.setWindowBounds
    this.recursionDetected = false;
  }

  /**
   * Giả lập hàm gọi CDP Browser.setWindowBounds
   */
  async mockSetWindowBounds(profileId, bounds) {
    if (this.isApplyingBounds.get(profileId)) {
      this.recursionDetected = true;
      throw new Error(`Đệ quy phát hiện trên profile ${profileId}! Lệnh setWindowBounds được gọi trong khi đang áp dụng.`);
    }

    this.isApplyingBounds.set(profileId, true);
    this.callCount++;

    // Cập nhật bounds hiện tại
    this.currentBounds.set(profileId, { ...bounds });

    // Giả lập Chromium phát sinh sự kiện onResize ngược lại sau 5ms
    await new Promise(resolve => setTimeout(resolve, 5));
    
    // Giả lập Chromium kích hoạt resize event handler
    this.onWindowResizedFromChromium(profileId, bounds);

    this.isApplyingBounds.set(profileId, false);
    return { success: true };
  }

  /**
   * Sự kiện resize nhận được từ Chromium (người dùng kéo chuột hoặc OS thay đổi)
   */
  onWindowResizedFromChromium(profileId, newBounds) {
    // Anti-loop guard 1: Đang trong quá trình setWindowBounds thì bỏ qua
    if (this.isApplyingBounds.get(profileId)) {
      return;
    }

    // Anti-loop guard 2: Kích thước không thay đổi thì bỏ qua
    const current = this.currentBounds.get(profileId);
    if (current &&
        current.left === newBounds.left &&
        current.top === newBounds.top &&
        current.width === newBounds.width &&
        current.height === newBounds.height) {
      return;
    }

    // Kích hoạt debounce resize
    this.requestResize(profileId, newBounds);
  }

  /**
   * Yêu cầu thay đổi kích thước với Debounce
   */
  requestResize(profileId, targetBounds) {
    // Nếu đang áp dụng thì chặn ngay
    if (this.isApplyingBounds.get(profileId)) {
      return;
    }

    // Xóa timer trước đó nếu có
    if (this.debounceTimers.has(profileId)) {
      clearTimeout(this.debounceTimers.get(profileId));
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(profileId);
      try {
        await this.mockSetWindowBounds(profileId, targetBounds);
      } catch (err) {
        console.error(err.message);
      }
    }, this.debounceMs);

    this.debounceTimers.set(profileId, timer);
  }
}

/**
 * Chạy test suite cho Debounce & Anti-Loop Resize
 */
async function runDebounceResizeTests() {
  console.log('====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Debounce & Chống Vòng Lặp Resize');
  console.log('====================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  async function runTest(testName, testFn) {
    totalTests++;
    try {
      await testFn();
      console.log(`  ✅ PASS: ${testName}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${testName}`);
      console.error(`     Nguyên nhân: ${err.message}`);
    }
  }

  // 1. Kiểm thử Debounce
  console.log('--- 1. Kiểm thử Debounce gom cụm sự kiện ---');
  await runTest('50 lệnh resize liên tiếp trong 50ms chỉ kích hoạt đúng 1 lần gọi setWindowBounds', async () => {
    const controller = new WindowResizeController({ debounceMs: 100 });
    const profileId = 'prof_test_debounce';

    // Bắn 50 sự kiện liên tiếp
    for (let i = 0; i < 50; i++) {
      controller.requestResize(profileId, { left: 10, top: 10, width: 380 + i, height: 675 });
      await new Promise(r => setTimeout(r, 1));
    }

    // Đợi hết khoảng thời gian debounce (100ms) + buffer
    await new Promise(r => setTimeout(r, 200));

    assert.strictEqual(
      controller.callCount,
      1,
      `Kỳ vọng đúng 1 lần gọi CDP setWindowBounds nhưng nhận được: ${controller.callCount}`
    );
    const finalBounds = controller.currentBounds.get(profileId);
    assert.strictEqual(finalBounds.width, 380 + 49, 'Kích thước cuối cùng phải là của lệnh cuối');
  });

  // 2. Kiểm thử chống đệ quy (Anti-recursion guard)
  console.log('\n--- 2. Kiểm thử Chống Vòng Lặp Đệ Quy (Anti-recursion) ---');
  await runTest('Chromium phản hồi resize event không gây ra đệ quy setWindowBounds', async () => {
    const controller = new WindowResizeController({ debounceMs: 50 });
    const profileId = 'prof_test_recursion';

    await controller.mockSetWindowBounds(profileId, { left: 50, top: 50, width: 400, height: 800 });

    // Đợi thêm 100ms để xem có timer hay sự kiện đệ quy nào kích hoạt không
    await new Promise(r => setTimeout(r, 120));

    assert.strictEqual(controller.recursionDetected, false, 'Phát hiện có vòng lặp đệ quy!');
    assert.strictEqual(controller.callCount, 1, `Số lần gọi phải là 1, nhưng thực tế: ${controller.callCount}`);
  });

  // 3. Kiểm thử Bounds Comparison Guard
  console.log('\n--- 3. Kiểm thử Bỏ qua khi Kích Thước Không Đổi ---');
  await runTest('Bỏ qua khi newBounds trùng khớp hoàn toàn với currentBounds', async () => {
    const controller = new WindowResizeController({ debounceMs: 50 });
    const profileId = 'prof_test_noop';

    // Set lần 1
    await controller.mockSetWindowBounds(profileId, { left: 10, top: 10, width: 380, height: 675 });
    const countBefore = controller.callCount;

    // Giả lập Chromium gửi lại cùng bounds
    controller.onWindowResizedFromChromium(profileId, { left: 10, top: 10, width: 380, height: 675 });
    await new Promise(r => setTimeout(r, 100));

    assert.strictEqual(
      controller.callCount,
      countBefore,
      'Không được gọi thêm lệnh setWindowBounds khi kích thước không đổi'
    );
  });

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT DEBOUNCE & ANTI-LOOP: ${passedTests}/${totalTests} TESTS PASS`);
  console.log('====================================================\n');

  return { passedTests, totalTests, success: passedTests === totalTests };
}

if (require.main === module) {
  runDebounceResizeTests().then(res => {
    process.exit(res.success ? 0 : 1);
  });
}

module.exports = {
  WindowResizeController,
  runDebounceResizeTests
};
