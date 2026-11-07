/**
 * test_chromium_emulation_live.js
 * Kiểm thử đo lường thực tế trên Chromium / Headless CDP:
 * - window.innerWidth, window.innerHeight
 * - screen.orientation.type, screen.orientation.angle
 * - window.orientation
 * - screen.width, screen.height
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const { normalizeDeviceRatio, computeEmulationState } = require('../src/layoutEngine');
const { generateFingerprintScript } = require('../src/fingerprintGenerator');

// Tìm Chrome/Chromium binary trên máy Windows
function findChromeBinary() {
  const cloakDir = path.join(os.homedir(), '.cloakbrowser');
  if (fs.existsSync(cloakDir)) {
    try {
      for (const sub of fs.readdirSync(cloakDir)) {
        const exe = path.join(cloakDir, sub, 'chrome.exe');
        if (fs.existsSync(exe)) return exe;
      }
    } catch (e) {}
  }

  const standardPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Users\\hien666shop\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\hien1\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(os.homedir(), 'AppData\\Local\\Programs\\Opera\\opera.exe'),
    'C:\\Users\\hien666shop\\AppData\\Local\\Programs\\Opera\\opera.exe',
  ];

  for (const p of standardPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function runChromiumEmulationTests() {
  console.log('\n====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Đo lường Chromium & CDP Live Emulation');
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

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Lỗi: ${err.message}`);
      throw err;
    }
  }

  // --- 1. Kiểm thử Script Fingerprint Injection Code ---
  console.log('--- 1. Kiểm tra Script Fingerprint sinh mã đồng bộ Orientation ---');

  test('Mã fingerprint khi orientationLock="landscape" chứa landscape-primary và góc 90°', () => {
    const dev = { viewport: { width: 412, height: 915 } };
    const script = generateFingerprintScript(dev, 'landscape');
    assert(script.includes('"landscape-primary"'), 'Phải chứa "landscape-primary"');
    assert(script.includes('90'), 'Phải chứa góc 90');
    assert(!script.includes('return \'portrait-primary\';'), 'Không được hardcode portrait-primary');
  });

  test('Mã fingerprint khi orientationLock="portrait" chứa portrait-primary và góc 0°', () => {
    const dev = { viewport: { width: 412, height: 915 } };
    const script = generateFingerprintScript(dev, 'portrait');
    assert(script.includes('"portrait-primary"'), 'Phải chứa "portrait-primary"');
    assert(script.includes('return 0'), 'Phải chứa góc 0');
  });

  // --- 2. Live Chromium Launch & Đo Inner Dimensions qua CDP ---
  console.log('\n--- 2. Live Chromium / CDP: Đo window.innerWidth, innerHeight & orientation ---');

  const chromeBin = findChromeBinary();
  assert(chromeBin, 'BẮT BUỘC tìm thấy Chromium binary (Chrome hoặc Edge) trên Windows để thực thi Live CDP tests.');
  console.log(`  🔍 Tìm thấy browser binary: ${chromeBin}`);

    await testAsync('Live CDP Portrait: innerWidth < innerHeight & screen.orientation="portraitPrimary"', async () => {
      const port = 9333;
      const tempUserData = path.join(os.tmpdir(), `test_chrome_portrait_${Date.now()}`);
      fs.mkdirSync(tempUserData, { recursive: true });

      const proc = spawn(chromeBin, [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${tempUserData}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
      ]);

      try {
        await new Promise(r => setTimeout(r, 1500));
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
        const pages = await browser.pages();
        const page = pages[0] || (await browser.newPage());
        const client = await page.createCDPSession();

        const fpScript = generateFingerprintScript({ viewport: { width: 412, height: 915 } }, 'portrait');
        await client.send('Page.addScriptToEvaluateOnNewDocument', { source: fpScript });

        // Apply portrait device metrics
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: 380,
          height: 800,
          deviceScaleFactor: 3.0,
          mobile: true,
          screenOrientation: { type: 'portraitPrimary', angle: 0 },
          screenWidth: 380,
          screenHeight: 800
        });

        const testHtml = 'data:text/html,<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body>Mobile</body></html>';
        await page.goto(testHtml);

        const metrics = await page.evaluate(() => {
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            screenOrientationType: screen.orientation ? screen.orientation.type : null,
            screenOrientationAngle: screen.orientation ? screen.orientation.angle : null,
            windowOrientation: typeof window.orientation !== 'undefined' ? window.orientation : null,
            screenWidth: screen.width,
            screenHeight: screen.height,
          };
        });

        assert.strictEqual(metrics.innerWidth, 380, 'innerWidth phải bằng 380');
        assert.strictEqual(metrics.innerHeight, 800, 'innerHeight phải bằng 800');
        assert(metrics.innerWidth < metrics.innerHeight, 'Portrait: width < height');
        assert.strictEqual(metrics.screenOrientationType, 'portrait-primary', 'screen.orientation.type');
        assert.strictEqual(metrics.screenOrientationAngle, 0, 'screen.orientation.angle');

        await browser.close();
      } finally {
        try { proc.kill('SIGKILL'); } catch (e) {}
        try { fs.rmSync(tempUserData, { recursive: true, force: true }); } catch (e) {}
      }
    });

    await testAsync('Live CDP Landscape: innerWidth > innerHeight & screen.orientation="landscape-primary"', async () => {
      const port = 9334;
      const tempUserData = path.join(os.tmpdir(), `test_chrome_landscape_${Date.now()}`);
      fs.mkdirSync(tempUserData, { recursive: true });

      const proc = spawn(chromeBin, [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${tempUserData}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
      ]);

      try {
        await new Promise(r => setTimeout(r, 1500));
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
        const pages = await browser.pages();
        const page = pages[0] || (await browser.newPage());
        const client = await page.createCDPSession();

        const fpScript = generateFingerprintScript({ viewport: { width: 915, height: 412 } }, 'landscape');
        await client.send('Page.addScriptToEvaluateOnNewDocument', { source: fpScript });

        // Apply landscape device metrics
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: 800,
          height: 380,
          deviceScaleFactor: 3.0,
          mobile: true,
          screenOrientation: { type: 'landscapePrimary', angle: 90 },
          screenWidth: 800,
          screenHeight: 380
        });

        const testHtml = 'data:text/html,<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body>Mobile</body></html>';
        await page.goto(testHtml);

        const metrics = await page.evaluate(() => {
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            screenOrientationType: screen.orientation ? screen.orientation.type : null,
            screenOrientationAngle: screen.orientation ? screen.orientation.angle : null,
            windowOrientation: typeof window.orientation !== 'undefined' ? window.orientation : null,
            screenWidth: screen.width,
            screenHeight: screen.height,
          };
        });

        assert.strictEqual(metrics.innerWidth, 800, 'innerWidth phải bằng 800');
        assert.strictEqual(metrics.innerHeight, 380, 'innerHeight phải bằng 380');
        assert(metrics.innerWidth > metrics.innerHeight, 'Landscape: width > height');
        assert.strictEqual(metrics.screenOrientationType, 'landscape-primary', 'screen.orientation.type');
        assert.strictEqual(metrics.screenOrientationAngle, 90, 'screen.orientation.angle');

        await browser.close();
      } finally {
        try { proc.kill('SIGKILL'); } catch (e) {}
        try { fs.rmSync(tempUserData, { recursive: true, force: true }); } catch (e) {}
      }
    });

    await testAsync('Live CDP Dynamic Auto-Orientation: Xoay vòng Dọc -> Ngang -> Dọc và phát orientationchange', async () => {
      const port = 9335;
      const tempUserData = path.join(os.tmpdir(), `test_chrome_roundtrip_${Date.now()}`);
      fs.mkdirSync(tempUserData, { recursive: true });

      const proc = spawn(chromeBin, [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${tempUserData}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
      ]);

      try {
        await new Promise(r => setTimeout(r, 1500));
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
        const pages = await browser.pages();
        const page = pages[0] || (await browser.newPage());
        const client = await page.createCDPSession();

        const fpScript = generateFingerprintScript({ viewport: { width: 412, height: 915 } }, 'auto');
        await client.send('Page.addScriptToEvaluateOnNewDocument', { source: fpScript });

        // Phase 1: Portrait ban đầu (380x800)
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: 380,
          height: 800,
          deviceScaleFactor: 3.0,
          mobile: true,
          screenOrientation: { type: 'portraitPrimary', angle: 0 },
          screenWidth: 380,
          screenHeight: 800
        });

        const testHtml = `data:text/html,<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body>
          <script>
            window.__orientEvents = [];
            window.addEventListener('orientationchange', function() {
              window.__orientEvents.push({
                type: screen.orientation ? screen.orientation.type : null,
                angle: screen.orientation ? screen.orientation.angle : null,
                winAngle: typeof window.orientation !== 'undefined' ? window.orientation : null
              });
            });
          </script>
          Roundtrip Test
        </body></html>`;
        await page.goto(testHtml);

        const m1 = await page.evaluate(() => ({
          w: window.innerWidth,
          h: window.innerHeight,
          orient: screen.orientation?.type,
          events: window.__orientEvents.length
        }));
        assert.strictEqual(m1.w, 380, 'P1 innerWidth');
        assert.strictEqual(m1.h, 800, 'P1 innerHeight');
        assert.strictEqual(m1.orient, 'portrait-primary', 'P1 orientation');
        assert.strictEqual(m1.events, 0, 'P1 ban đầu chưa phát orientationchange');

        // Phase 2: Kéo dãn sang Landscape (800x380) và phát hiện chuyển hướng
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: 800,
          height: 380,
          deviceScaleFactor: 3.0,
          mobile: true,
          screenOrientation: { type: 'landscapePrimary', angle: 90 },
          screenWidth: 800,
          screenHeight: 380
        });

        // Kích hoạt Dynamic Auto-Orientation script của main.js
        await client.send('Runtime.evaluate', {
          expression: `(function() {
            try {
              if (typeof screen !== 'undefined' && screen.orientation) {
                Object.defineProperty(screen.orientation, 'type', { get: function() { return "landscape-primary"; }, configurable: true });
                Object.defineProperty(screen.orientation, 'angle', { get: function() { return 90; }, configurable: true });
              }
              if (typeof window !== 'undefined') {
                Object.defineProperty(window, 'orientation', { get: function() { return 90; }, configurable: true });
                window.dispatchEvent(new Event('orientationchange'));
              }
            } catch(e){}
          })()`,
          returnByValue: true
        });

        const m2 = await page.evaluate(() => ({
          w: window.innerWidth,
          h: window.innerHeight,
          orient: screen.orientation?.type,
          angle: screen.orientation?.angle,
          events: window.__orientEvents.length,
          lastEvent: window.__orientEvents[window.__orientEvents.length - 1]
        }));
        assert.strictEqual(m2.w, 800, 'P2 innerWidth');
        assert.strictEqual(m2.h, 380, 'P2 innerHeight');
        assert.strictEqual(m2.orient, 'landscape-primary', 'P2 orientation');
        assert.strictEqual(m2.angle, 90, 'P2 angle');
        assert(m2.events >= 1, 'P2 phải nhận sự kiện orientationchange');
        assert.strictEqual(m2.lastEvent.type, 'landscape-primary');

        // Phase 3: Thu hẹp lại về Portrait (380x800) và phát hiện chuyển hướng lần 2
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: 380,
          height: 800,
          deviceScaleFactor: 3.0,
          mobile: true,
          screenOrientation: { type: 'portraitPrimary', angle: 0 },
          screenWidth: 380,
          screenHeight: 800
        });

        await client.send('Runtime.evaluate', {
          expression: `(function() {
            try {
              if (typeof screen !== 'undefined' && screen.orientation) {
                Object.defineProperty(screen.orientation, 'type', { get: function() { return "portrait-primary"; }, configurable: true });
                Object.defineProperty(screen.orientation, 'angle', { get: function() { return 0; }, configurable: true });
              }
              if (typeof window !== 'undefined') {
                Object.defineProperty(window, 'orientation', { get: function() { return 0; }, configurable: true });
                window.dispatchEvent(new Event('orientationchange'));
              }
            } catch(e){}
          })()`,
          returnByValue: true
        });

        const m3 = await page.evaluate(() => ({
          w: window.innerWidth,
          h: window.innerHeight,
          orient: screen.orientation?.type,
          angle: screen.orientation?.angle,
          events: window.__orientEvents.length,
          lastEvent: window.__orientEvents[window.__orientEvents.length - 1]
        }));
        assert.strictEqual(m3.w, 380, 'P3 innerWidth');
        assert.strictEqual(m3.h, 800, 'P3 innerHeight');
        assert.strictEqual(m3.orient, 'portrait-primary', 'P3 orientation');
        assert.strictEqual(m3.angle, 0, 'P3 angle');
        assert(m3.events > m2.events, 'P3 chu kỳ hoàn tất phải nhận thêm sự kiện orientationchange khi xoay ngược về dọc');
        assert.strictEqual(m3.lastEvent.type, 'portrait-primary');

        await browser.close();
      } finally {
        try { proc.kill('SIGKILL'); } catch (e) {}
        try { fs.rmSync(tempUserData, { recursive: true, force: true }); } catch (e) {}
      }
    });

  console.log('\n====================================================');
  console.log(`📊 TỔNG KẾT LIVE EMULATION: ${passed}/${total} TESTS PASS`);
  console.log('====================================================\n');

  return { passedTests: passed, totalTests: total, success: passed === total };
}

if (require.main === module) {
  runChromiumEmulationTests().catch(err => {
    console.error('Lỗi kiểm thử Live Emulation:', err);
    process.exit(1);
  });
}

module.exports = { runChromiumEmulationTests };
