const { normalizeDeviceRatio } = require('./layoutEngine');

function generateFingerprintScript(device, orientationLock = 'auto') {
  device = device || {};
  const norm = normalizeDeviceRatio(device, orientationLock);
  const screenOrientationType = norm.screenOrientation.jsType;
  const screenAngle = norm.screenOrientation.angle;
  const windowOrientation = norm.windowOrientation;
  const screenWidth = norm.screenWidth;
  const screenHeight = norm.screenHeight;
  const tz = device.timezone || 'Asia/Ho_Chi_Minh';
  const touchPoints = device.max_touch_points || 10;
  const renderer = device.webgl_renderer || 'Adreno (TM) 650';
  const vendor = device.webgl_vendor || 'Qualcomm';
  const lang = device.language || 'vi-VN';
  const dsf = device.device_scale_factor || 3.0;
  const isMobile = device.is_mobile !== false;
  const isApple = (device.brand && device.brand.toLowerCase() === 'apple') || device.platform === 'iPhone' || device.platform === 'iPad';
  const targetPlatform = device.platform || (isApple ? (device.model && device.model.includes('iPad') ? 'iPad' : 'iPhone') : (isMobile ? 'Linux armv8l' : 'Win32'));

  // Compute a stable integer seed unique to this device/profile
  const seedStr = (device.id || device.name || 'cloakdroid_profile') + '_' + renderer;
  let deviceSeed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    deviceSeed = ((deviceSeed << 5) - deviceSeed + seedStr.charCodeAt(i)) | 0;
  }
  deviceSeed = Math.abs(deviceSeed) || 987654321;

  return `(function() {
  'use strict';

  // ── IDEMPOTENCY GUARD: Chống tiêm/chạy trùng lặp nhiều lần ──
  if (typeof window !== 'undefined' && window.__NA_STEALTH_APPLIED__) return;
  try {
    Object.defineProperty(window, '__NA_STEALTH_APPLIED__', {
      value: true,
      writable: false,
      enumerable: false,
      configurable: false
    });
  } catch(e) {
    if (typeof window !== 'undefined') window.__NA_STEALTH_APPLIED__ = true;
  }

  // ── STEALTH NATIVE FUNCTION MASKING ──
  // Che giấu dấu vết Function override để vượt qua kiểm tra toString() & Proxy detection của Anti-bot
  const nativeToStrings = new WeakMap();
  const _origToString = Function.prototype.toString;

  function makeNative(fn, name) {
    const fnName = name || fn.name || '';
    const str = 'function ' + fnName + '() { [native code] }';
    nativeToStrings.set(fn, str);
    try {
      Object.defineProperty(fn, 'name', { value: fnName, configurable: true });
    } catch(e){}
    return fn;
  }

  Function.prototype.toString = function() {
    if (nativeToStrings.has(this)) {
      return nativeToStrings.get(this);
    }
    return _origToString.call(this);
  };
  nativeToStrings.set(Function.prototype.toString, 'function toString() { [native code] }');

  const navProto = (typeof Navigator !== 'undefined' && Navigator.prototype) || (typeof navigator !== 'undefined' ? Object.getPrototypeOf(navigator) : {});
  const screenProto = (typeof Screen !== 'undefined' && Screen.prototype) || (typeof screen !== 'undefined' ? Object.getPrototypeOf(screen) : {});
  const deviceSeed = ${deviceSeed};

  // ── ANTI-ANTI-DEBUGGING & F12 DEVTOOLS PROTECTION ──
  // Ngăn chặn các trang game (như winv79, PG Soft...) kích hoạt vòng lặp debugger; đóng băng trang khi bật F12
  try {
    const _origFunction = window.Function;
    const functionHandler = {
      apply(target, thisArg, args) {
        if (args.length > 0 && typeof args[args.length - 1] === 'string') {
          const body = args[args.length - 1];
          if (body.includes('debugger')) {
            args[args.length - 1] = body.replace(/\\bdebugger\\b/g, '/* noop */');
          }
        }
        return Reflect.apply(target, thisArg, args);
      },
      construct(target, args) {
        if (args.length > 0 && typeof args[args.length - 1] === 'string') {
          const body = args[args.length - 1];
          if (body.includes('debugger')) {
            args[args.length - 1] = body.replace(/\\bdebugger\\b/g, '/* noop */');
          }
        }
        return Reflect.construct(target, args);
      }
    };
    const functionProxy = new Proxy(_origFunction, functionHandler);
    makeNative(functionProxy, 'Function');
    try {
      Object.defineProperty(Function.prototype, 'constructor', {
        value: functionProxy,
        writable: true,
        configurable: true
      });
      window.Function = functionProxy;
    } catch(e){}

    const _origEval = window.eval;
    window.eval = makeNative(function eval(code) {
      if (typeof code === 'string' && code.includes('debugger')) {
        code = code.replace(/\\bdebugger\\b/g, '/* noop */');
      }
      return _origEval.call(this, code);
    }, 'eval');

    // Chống website chặn phím F12 và phím tắt DevTools (Ctrl+Shift+I / J / C)
    if (typeof EventTarget !== 'undefined' && EventTarget.prototype.addEventListener) {
      const _origAddEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = makeNative(function addEventListener(type, listener, options) {
        if (type === 'keydown' || type === 'keyup' || type === 'keypress') {
          const wrapped = function(event) {
            if (event && (
              event.key === 'F12' || event.keyCode === 123 ||
              (event.ctrlKey && event.shiftKey && (event.key === 'I' || event.key === 'i' || event.key === 'J' || event.key === 'j' || event.key === 'C' || event.key === 'c' || event.keyCode === 73 || event.keyCode === 74 || event.keyCode === 67))
            )) {
              // Cho phép phím F12/DevTools đi qua bình thường
              return;
            }
            if (typeof listener === 'function') {
              return listener.apply(this, arguments);
            } else if (listener && typeof listener.handleEvent === 'function') {
              return listener.handleEvent.apply(listener, arguments);
            }
          };
          return _origAddEventListener.call(this, type, wrapped, options);
        }
        return _origAddEventListener.call(this, type, listener, options);
      }, 'addEventListener');
    }
  } catch(e){}

  // 1. HIDDEN WEBDRIVER ➔ Xóa sạch cờ navigator.webdriver (Native Getter)
  try {
    if (typeof navigator !== 'undefined') {
      delete navProto.webdriver;
      delete navigator.webdriver;
      const getWebdriver = makeNative(function webdriver() { return false; }, 'get webdriver');
      Object.defineProperty(navProto, 'webdriver', {
        get: getWebdriver,
        configurable: true,
        enumerable: true
      });
      Object.defineProperty(navigator, 'webdriver', {
        get: getWebdriver,
        configurable: true,
        enumerable: true
      });
    }
  } catch(e){}

  // 2. NAVIGATOR PLATFORM ➔ Linux armv8l / iPhone / iPad / Win32 (Native Getter)
  try {
    if (typeof navigator !== 'undefined') {
      delete navProto.platform;
      delete navigator.platform;
      const getPlatform = makeNative(function platform() { return '${targetPlatform}'; }, 'get platform');
      Object.defineProperty(navProto, 'platform', { get: getPlatform, configurable: true, enumerable: true });
      Object.defineProperty(navigator, 'platform', { get: getPlatform, configurable: true, enumerable: true });
    }
  } catch(e){}

  // 3. MAX TOUCH POINTS ➔ 10 / 5 (Native Getter)
  try {
    if (typeof navigator !== 'undefined') {
      delete navProto.maxTouchPoints;
      delete navigator.maxTouchPoints;
      const getTouch = makeNative(function maxTouchPoints() { return ${touchPoints}; }, 'get maxTouchPoints');
      Object.defineProperty(navProto, 'maxTouchPoints', { get: getTouch, configurable: true, enumerable: true });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: getTouch, configurable: true, enumerable: true });
    }
  } catch(e){}

  // 4. WEBGL VENDOR & RENDERER (Patch cả getParameter lẫn getExtension WEBGL_debug_renderer_info)
  try {
    const patchGL = (glProto) => {
      if (!glProto || !glProto.prototype) return;
      const _origGetParam = glProto.prototype.getParameter;
      const _origGetExt = glProto.prototype.getExtension;

      const patchedGetParam = makeNative(function getParameter(param) {
        if (param === 37445 || param === 0x9245) return ${JSON.stringify(renderer)}; // UNMASKED_RENDERER_WEBGL
        if (param === 37444 || param === 0x9244) return ${JSON.stringify(vendor)};   // UNMASKED_VENDOR_WEBGL
        if (param === 7936  || param === 0x1F00) return 'WebKit';
        if (param === 7937  || param === 0x1F01) return 'WebKit WebGL';
        return _origGetParam.call(this, param);
      }, 'getParameter');

      glProto.prototype.getParameter = patchedGetParam;

      const patchedGetExt = makeNative(function getExtension(name) {
        const ext = _origGetExt.call(this, name);
        if (name === 'WEBGL_debug_renderer_info' && ext) {
          return new Proxy(ext, {
            get(target, prop) {
              if (prop === 'UNMASKED_RENDERER_WEBGL') return 37445;
              if (prop === 'UNMASKED_VENDOR_WEBGL') return 37444;
              return Reflect.get(target, prop);
            }
          });
        }
        return ext;
      }, 'getExtension');

      glProto.prototype.getExtension = patchedGetExt;
    };

    if (typeof WebGLRenderingContext !== 'undefined') patchGL(WebGLRenderingContext);
    if (typeof WebGL2RenderingContext !== 'undefined') patchGL(WebGL2RenderingContext);
  } catch(e){}

  // 5. PLUGINS & MIMETYPES ➔ Length = 0 (Native Getter)
  try {
    if (typeof PluginArray !== 'undefined' && typeof navigator !== 'undefined') {
      const emptyPlugins = Object.create(PluginArray.prototype);
      Object.defineProperty(emptyPlugins, 'length', {
        get: makeNative(function length() { return 0; }, 'get length'),
        configurable: true, enumerable: true
      });

      const getPlugins = makeNative(function plugins() { return emptyPlugins; }, 'get plugins');
      Object.defineProperty(navProto, 'plugins', { get: getPlugins, configurable: true, enumerable: true });
      Object.defineProperty(navigator, 'plugins', { get: getPlugins, configurable: true, enumerable: true });
    }

    if (typeof MimeTypeArray !== 'undefined' && typeof navigator !== 'undefined') {
      const emptyMimeTypes = Object.create(MimeTypeArray.prototype);
      Object.defineProperty(emptyMimeTypes, 'length', {
        get: makeNative(function length() { return 0; }, 'get length'),
        configurable: true, enumerable: true
      });

      const getMimeTypes = makeNative(function mimeTypes() { return emptyMimeTypes; }, 'get mimeTypes');
      Object.defineProperty(navProto, 'mimeTypes', { get: getMimeTypes, configurable: true, enumerable: true });
      Object.defineProperty(navigator, 'mimeTypes', { get: getMimeTypes, configurable: true, enumerable: true });
    }
  } catch(e){}

  // 6. SCREEN & WINDOW METRICS (Native Getter Override)
  // Chú ý: KHÔNG override window.innerWidth/outerWidth — CDP setDeviceMetricsOverride
  // đã báo giá trị đúng bằng vùng hiển thị thật của cửa sổ rồi (responsive).
  // Override cứng ở đây sẽ phá vỡ layout khi người dùng resize cửa sổ.
  try {
    if (typeof window !== 'undefined') {
      delete window.devicePixelRatio;
      const getDPR = makeNative(function devicePixelRatio() { return ${dsf}; }, 'get devicePixelRatio');
      Object.defineProperty(window, 'devicePixelRatio', { get: getDPR, configurable: true, enumerable: true });
    }
  } catch(e){}

  // 7. BATTERY & HARDWARE METRICS
  try {
    if (typeof navigator !== 'undefined') {
      const patchMetric = (target, prop, val, name) => {
        try {
          delete target[prop];
          const getter = makeNative(function() { return val; }, name || ('get ' + prop));
          Object.defineProperty(target, prop, { get: getter, configurable: true, enumerable: true });
        } catch(err){}
      };

      patchMetric(navProto, 'deviceMemory', 8, 'get deviceMemory');
      patchMetric(navigator, 'deviceMemory', 8, 'get deviceMemory');
      patchMetric(navProto, 'hardwareConcurrency', 8, 'get hardwareConcurrency');
      patchMetric(navigator, 'hardwareConcurrency', 8, 'get hardwareConcurrency');

      if (navigator.getBattery) {
        navigator.getBattery = makeNative(function getBattery() {
          return Promise.resolve({
            charging: false, chargingTime: Infinity, dischargingTime: 14400, level: 0.75,
            addEventListener: () => {}, removeEventListener: () => {}
          });
        }, 'getBattery');
      }
    }
  } catch(e){}

  // 8. TIMEZONE OVERRIDE
  try {
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      const _resOpt = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = makeNative(function resolvedOptions() {
        const o = _resOpt.call(this);
        o.timeZone = ${JSON.stringify(tz)};
        return o;
      }, 'resolvedOptions');
    }
  } catch(e){}

  // 9. GEOLOCATION OVERRIDE
  ${device.geo ? `
  try {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = makeNative(function getCurrentPosition(cb) {
        if (typeof cb === 'function') {
          cb({
            coords: {
              latitude: ${device.geo.lat},
              longitude: ${device.geo.lng},
              accuracy: 18,
              altitude: null, altitudeAccuracy: null, heading: null, speed: null
            },
            timestamp: Date.now()
          });
        }
      }, 'getCurrentPosition');
    }
  } catch(e){}
  ` : ''}

  // 10. CANVAS FINGERPRINT NOISE (Vi nhiễu ngẫu nhiên nhưng nhất quán theo device/profile)
  try {
    if (typeof HTMLCanvasElement !== 'undefined' && typeof CanvasRenderingContext2D !== 'undefined') {
      const _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      const _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const _origToBlob = HTMLCanvasElement.prototype.toBlob;

      function applyCanvasNoise(imgData, offX, offY) {
        if (!imgData || !imgData.data) return;
        const data = imgData.data;
        const w = imgData.width;
        const h = imgData.height;
        const ox = offX || 0;
        const oy = offY || 0;

        for (let y = 0; y < h; y++) {
          const absY = y + oy;
          for (let x = 0; x < w; x++) {
            const absX = x + ox;
            const idx = (y * w + x) * 4;
            // Không can thiệp pixel trong suốt (tránh làm bẩn canvas trắng hoặc rỗng)
            if (data[idx + 3] === 0) continue;

            // Tạo vi nhiễu xác định theo tọa độ và deviceSeed (~6.25% pixel bị lệch nhẹ 1 đơn vị)
            if (((absX * 31 + absY * 17 + deviceSeed) & 0x0F) === 7) {
              const delta = ((absX + absY + deviceSeed) & 1) === 0 ? 1 : -1;
              const c = idx + ((absX ^ absY) & 1 ? 0 : 2); // Luân phiên kênh Red (0) và Blue (2)
              const val = data[c] + delta;
              data[c] = val < 0 ? 0 : (val > 255 ? 255 : val);
            }
          }
        }
      }

      function createNoisyCanvasClone(canvas) {
        const w = canvas.width;
        const h = canvas.height;
        if (!w || !h || w <= 0 || h <= 0) return canvas;
        try {
          const clone = document.createElement('canvas');
          clone.width = w;
          clone.height = h;
          const ctx = clone.getContext('2d');
          if (!ctx) return canvas;
          ctx.drawImage(canvas, 0, 0);
          const imgData = _origGetImageData.call(ctx, 0, 0, w, h);
          applyCanvasNoise(imgData, 0, 0);
          ctx.putImageData(imgData, 0, 0);
          return clone;
        } catch(e) {
          return canvas;
        }
      }

      CanvasRenderingContext2D.prototype.getImageData = makeNative(function getImageData(sx, sy, sw, sh, settings) {
        const imgData = _origGetImageData.apply(this, arguments);
        try {
          applyCanvasNoise(imgData, sx, sy);
        } catch(e) {}
        return imgData;
      }, 'getImageData');

      HTMLCanvasElement.prototype.toDataURL = makeNative(function toDataURL(type, quality) {
        try {
          const noisy = createNoisyCanvasClone(this);
          return _origToDataURL.call(noisy, type, quality);
        } catch(e) {
          return _origToDataURL.apply(this, arguments);
        }
      }, 'toDataURL');

      HTMLCanvasElement.prototype.toBlob = makeNative(function toBlob(callback, type, quality) {
        try {
          const noisy = createNoisyCanvasClone(this);
          return _origToBlob.call(noisy, callback, type, quality);
        } catch(e) {
          return _origToBlob.apply(this, arguments);
        }
      }, 'toBlob');

      if (typeof OffscreenCanvasRenderingContext2D !== 'undefined' && OffscreenCanvasRenderingContext2D.prototype) {
        const _origOffscreenGetImageData = OffscreenCanvasRenderingContext2D.prototype.getImageData;
        if (_origOffscreenGetImageData) {
          OffscreenCanvasRenderingContext2D.prototype.getImageData = makeNative(function getImageData(sx, sy, sw, sh, settings) {
            const imgData = _origOffscreenGetImageData.apply(this, arguments);
            try { applyCanvasNoise(imgData, sx, sy); } catch(e) {}
            return imgData;
          }, 'getImageData');
        }
      }
    }
  } catch(e){}

  // 11. AUDIOCONTEXT FINGERPRINT NOISE (Micro-noise toán học ngăn chặn audio hash Windows)
  try {
    if (typeof AudioBuffer !== 'undefined' && AudioBuffer.prototype.getChannelData) {
      const _origGetChannelData = AudioBuffer.prototype.getChannelData;
      const noisedAudioBuffers = new WeakMap();

      AudioBuffer.prototype.getChannelData = makeNative(function getChannelData(channel) {
        const data = _origGetChannelData.apply(this, arguments);
        try {
          let chSet = noisedAudioBuffers.get(this);
          if (!chSet) {
            chSet = new Set();
            noisedAudioBuffers.set(this, chSet);
          }
          const chIdx = channel || 0;
          if (!chSet.has(chIdx) && data && data.length) {
            chSet.add(chIdx);
            for (let i = 0; i < data.length; i += 4) {
              const noise = (((i * 31 + deviceSeed) % 7) - 3) * 1e-7;
              data[i] += noise;
            }
          }
        } catch(e) {}
        return data;
      }, 'getChannelData');

      if (AudioBuffer.prototype.copyFromChannel) {
        const _origCopyFromChannel = AudioBuffer.prototype.copyFromChannel;
        AudioBuffer.prototype.copyFromChannel = makeNative(function copyFromChannel(destination, channelNumber, bufferOffset) {
          try {
            const chData = this.getChannelData(channelNumber || 0);
            const offset = bufferOffset || 0;
            if (destination && chData) {
              destination.set(chData.subarray(offset, offset + destination.length));
              return;
            }
          } catch(err) {}
          return _origCopyFromChannel.apply(this, arguments);
        }, 'copyFromChannel');
      }
    }

    if (typeof AnalyserNode !== 'undefined' && AnalyserNode.prototype.getFloatFrequencyData) {
      const _origGetFloatFreq = AnalyserNode.prototype.getFloatFrequencyData;

      AnalyserNode.prototype.getFloatFrequencyData = makeNative(function getFloatFrequencyData(array) {
        _origGetFloatFreq.apply(this, arguments);
        try {
          if (array && array.length) {
            for (let i = 0; i < array.length; i += 4) {
              if (array[i] !== -Infinity && !isNaN(array[i])) {
                const noise = (((i * 23 + deviceSeed) % 7) - 3) * 0.01;
                array[i] += noise;
              }
            }
          }
        } catch(e) {}
      }, 'getFloatFrequencyData');
    }
  } catch(e){}

  // 12. MEDIA DEVICES SPOOFING (navigator.mediaDevices.enumerateDevices)
  try {
    function makeDeviceId(prefix) {
      let h1 = 0xdeadbeef ^ deviceSeed;
      let h2 = 0x41c64e6d ^ deviceSeed;
      const str = prefix + '_' + deviceSeed;
      for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
      const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
      return (p1 + p2 + p2 + p1 + p1 + p2 + p1 + p2).slice(0, 64);
    }

    function createMediaDevice(id, kind, label, grpId) {
      const proto = typeof MediaDeviceInfo !== 'undefined' ? MediaDeviceInfo.prototype : Object.prototype;
      const dev = Object.create(proto);
      Object.defineProperties(dev, {
        deviceId: { value: id, enumerable: true },
        kind: { value: kind, enumerable: true },
        label: { value: label, enumerable: true },
        groupId: { value: grpId, enumerable: true },
        toJSON: {
          value: makeNative(function toJSON() {
            return { deviceId: id, kind: kind, label: label, groupId: grpId };
          }, 'toJSON'),
          enumerable: true,
          configurable: true
        }
      });
      return dev;
    }

    if (typeof navigator !== 'undefined') {
      if (!navigator.mediaDevices) {
        const md = Object.create(typeof MediaDevices !== 'undefined' ? MediaDevices.prototype : (typeof EventTarget !== 'undefined' ? EventTarget.prototype : Object.prototype));
        Object.defineProperty(navProto, 'mediaDevices', {
          get: makeNative(function mediaDevices() { return md; }, 'get mediaDevices'),
          configurable: true,
          enumerable: true
        });
        Object.defineProperty(navigator, 'mediaDevices', {
          get: makeNative(function mediaDevices() { return md; }, 'get mediaDevices'),
          configurable: true,
          enumerable: true
        });
      }

      const fakeDevices = [
        createMediaDevice(makeDeviceId('mic'), 'audioinput', 'Microphone tích hợp Android', makeDeviceId('grp_audio')),
        createMediaDevice(makeDeviceId('cam_front'), 'videoinput', 'Camera trước (Front Camera)', makeDeviceId('grp_video_front')),
        createMediaDevice(makeDeviceId('cam_back'), 'videoinput', 'Camera sau (Back Camera)', makeDeviceId('grp_video_back'))
      ];

      const enumDevFn = makeNative(function enumerateDevices() {
        return Promise.resolve(fakeDevices);
      }, 'enumerateDevices');

      if (navigator.mediaDevices) {
        navigator.mediaDevices.enumerateDevices = enumDevFn;
      }
      if (typeof MediaDevices !== 'undefined' && MediaDevices.prototype) {
        MediaDevices.prototype.enumerateDevices = enumDevFn;
      }
    }
  } catch(e){}

  // 13. TOUCH & POINTER MEDIA QUERIES (window.matchMedia)
  try {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const _origMatchMedia = window.matchMedia;

      function evalTouchMedia(query) {
        if (!query || typeof query !== 'string') return null;
        const norm = query.toLowerCase().replace(/\\s+/g, '');
        if (norm.includes('pointer:coarse') || norm.includes('any-pointer:coarse')) return true;
        if (norm.includes('pointer:fine') || norm.includes('any-pointer:fine')) return false;
        if (norm.includes('hover:none') || norm.includes('any-hover:none')) return true;
        if (norm.includes('hover:hover') || norm.includes('any-hover:hover')) return false;
        return null;
      }

      const patchedMatchMedia = makeNative(function matchMedia(query) {
        const mql = _origMatchMedia.apply(this, arguments);
        const forced = evalTouchMedia(query);
        if (forced !== null && mql) {
          try {
            Object.defineProperty(mql, 'matches', {
              get: makeNative(function matches() { return forced; }, 'get matches'),
              configurable: true,
              enumerable: true
            });
          } catch(e) {}
        }
        return mql;
      }, 'matchMedia');

      window.matchMedia = patchedMatchMedia;
      if (typeof Window !== 'undefined' && Window.prototype && Window.prototype.matchMedia) {
        Window.prototype.matchMedia = patchedMatchMedia;
      }
    }
  } catch(e){}

  // 14. SCREEN ORIENTATION & METRICS
  try {
    if (typeof screen !== 'undefined') {
      if (typeof ScreenOrientation !== 'undefined' && ScreenOrientation.prototype) {
        try {
          Object.defineProperty(ScreenOrientation.prototype, 'type', {
            get: makeNative(function type() { return ${JSON.stringify(screenOrientationType)}; }, 'get type'),
            configurable: true,
            enumerable: true
          });
          Object.defineProperty(ScreenOrientation.prototype, 'angle', {
            get: makeNative(function angle() { return ${screenAngle}; }, 'get angle'),
            configurable: true,
            enumerable: true
          });
          ScreenOrientation.prototype.lock = makeNative(function lock() { return Promise.resolve(); }, 'lock');
          ScreenOrientation.prototype.unlock = makeNative(function unlock() {}, 'unlock');
        } catch(e) {}
      }

      if (screen.orientation) {
        try {
          Object.defineProperty(screen.orientation, 'type', {
            get: makeNative(function type() { return ${JSON.stringify(screenOrientationType)}; }, 'get type'),
            configurable: true,
            enumerable: true
          });
          Object.defineProperty(screen.orientation, 'angle', {
            get: makeNative(function angle() { return ${screenAngle}; }, 'get angle'),
            configurable: true,
            enumerable: true
          });
          if (!screen.orientation.lock) {
            screen.orientation.lock = makeNative(function lock() { return Promise.resolve(); }, 'lock');
          }
          if (!screen.orientation.unlock) {
            screen.orientation.unlock = makeNative(function unlock() {}, 'unlock');
          }
        } catch(e) {}
      }

      try {
        if (typeof window !== 'undefined') {
          Object.defineProperty(window, 'orientation', {
            get: makeNative(function orientation() { return ${windowOrientation}; }, 'get orientation'),
            configurable: true,
            enumerable: true
          });
        }
      } catch(e){}

      const patchScreen = (prop, getterFn, name) => {
        try {
          delete screen[prop];
          delete screenProto[prop];
          const g = makeNative(getterFn, name || ('get ' + prop));
          Object.defineProperty(screen, prop, { get: g, configurable: true, enumerable: true });
          Object.defineProperty(screenProto, prop, { get: g, configurable: true, enumerable: true });
        } catch(err) {}
      };

      patchScreen('colorDepth', function colorDepth() { return 24; }, 'get colorDepth');
      patchScreen('pixelDepth', function pixelDepth() { return 24; }, 'get pixelDepth');
      patchScreen('width', function width() { return ${screenWidth}; }, 'get width');
      patchScreen('height', function height() { return ${screenHeight}; }, 'get height');
      patchScreen('availHeight', function availHeight() { return Math.max(0, ${screenHeight} - 36); }, 'get availHeight');
      patchScreen('availWidth', function availWidth() { return ${screenWidth}; }, 'get availWidth');
      patchScreen('availTop', function availTop() { return 0; }, 'get availTop');
      patchScreen('availLeft', function availLeft() { return 0; }, 'get availLeft');
    }
  } catch(e){}

  // 15. NETWORK INFORMATION (navigator.connection)
  try {
    if (typeof navigator !== 'undefined') {
      let conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!conn) {
        conn = Object.create(typeof NetworkInformation !== 'undefined' ? NetworkInformation.prototype : (typeof EventTarget !== 'undefined' ? EventTarget.prototype : Object.prototype));
        const getConn = makeNative(function connection() { return conn; }, 'get connection');
        Object.defineProperty(navProto, 'connection', { get: getConn, configurable: true, enumerable: true });
        Object.defineProperty(navigator, 'connection', { get: getConn, configurable: true, enumerable: true });
      }

      const patchConnProp = (target, prop, val, name) => {
        try {
          delete target[prop];
          const getter = makeNative(function() { return val; }, name || ('get ' + prop));
          Object.defineProperty(target, prop, { get: getter, configurable: true, enumerable: true });
        } catch(err){}
      };

      const netProto = typeof NetworkInformation !== 'undefined' ? NetworkInformation.prototype : Object.getPrototypeOf(conn);

      patchConnProp(conn, 'effectiveType', '4g', 'get effectiveType');
      patchConnProp(conn, 'rtt', 50, 'get rtt');
      patchConnProp(conn, 'downlink', 10, 'get downlink');
      patchConnProp(conn, 'saveData', false, 'get saveData');
      patchConnProp(conn, 'type', 'cellular', 'get type');

      if (netProto) {
        patchConnProp(netProto, 'effectiveType', '4g', 'get effectiveType');
        patchConnProp(netProto, 'rtt', 50, 'get rtt');
        patchConnProp(netProto, 'downlink', 10, 'get downlink');
        patchConnProp(netProto, 'saveData', false, 'get saveData');
        patchConnProp(netProto, 'type', 'cellular', 'get type');
      }
    }
  } catch(e){}

  // 16. SPEECHSYNTHESIS VOICES (Google Android voices thay vì Microsoft Windows Desktop)
  try {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      function createVoice(name, vLang, isDefault) {
        const proto = typeof SpeechSynthesisVoice !== 'undefined' ? SpeechSynthesisVoice.prototype : Object.prototype;
        const v = Object.create(proto);
        Object.defineProperties(v, {
          name: { value: name, enumerable: true },
          lang: { value: vLang, enumerable: true },
          localService: { value: false, enumerable: true },
          voiceURI: { value: name, enumerable: true },
          default: { value: !!isDefault, enumerable: true }
        });
        return v;
      }

      const isVi = ${JSON.stringify(lang)}.toLowerCase().startsWith('vi');
      const androidVoices = [
        createVoice('Google Tiếng Việt', 'vi-VN', isVi),
        createVoice('Google US English', 'en-US', !isVi),
        createVoice('Google UK English Female', 'en-GB', false),
        createVoice('Google UK English Male', 'en-GB', false),
        createVoice('Google français', 'fr-FR', false),
        createVoice('Google Deutsch', 'de-DE', false),
        createVoice('Google español', 'es-ES', false),
        createVoice('Google 日本語', 'ja-JP', false),
        createVoice('Google 한국 của', 'ko-KR', false),
        createVoice('Google 普通话 (中国)', 'zh-CN', false)
      ];

      const getVoices = makeNative(function getVoices() {
        return androidVoices;
      }, 'getVoices');

      window.speechSynthesis.getVoices = getVoices;
      if (typeof SpeechSynthesis !== 'undefined' && SpeechSynthesis.prototype) {
        SpeechSynthesis.prototype.getVoices = getVoices;
      }

      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        setTimeout(() => {
          try {
            if (typeof window.speechSynthesis.onvoiceschanged === 'function') {
              window.speechSynthesis.onvoiceschanged();
            }
            window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
          } catch(e) {}
        }, 50);
      }
    }
  } catch(e){}

  // ── TOUCH CON TRỎ CHUỘT HÌNH TRÒN (MÔ PHỎNG ĐẦU NGÓN TAY CẢM ỨNG DEVTOOLS) ──
  ${isMobile ? `
  try {
    if (typeof document !== 'undefined') {
      const injectTouchCursor = () => {
        if (document.getElementById('na-touch-cursor-style')) return;
        const style = document.createElement('style');
        style.id = 'na-touch-cursor-style';
        style.textContent = \`
          /* Con trỏ chuột hình tròn mờ mô phỏng ngón tay chạm cảm ứng như Chrome DevTools */
          html, body, *:not(input):not(textarea):not([contenteditable="true"]) {
            cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><circle cx='16' cy='16' r='10' fill='rgba(100,116,139,0.38)' stroke='rgba(255,255,255,0.85)' stroke-width='1.5'/><circle cx='16' cy='16' r='3' fill='rgba(255,255,255,0.7)'/></svg>") 16 16, auto !important;
          }
          /* Khi nhấn chuột xuống (chạm ngón tay) con trỏ thu nhỏ và sáng màu xanh */
          html:active, body:active, *:active:not(input):not(textarea) {
            cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><circle cx='16' cy='16' r='8' fill='rgba(99,102,241,0.65)' stroke='rgba(255,255,255,0.95)' stroke-width='1.8'/><circle cx='16' cy='16' r='2.5' fill='rgba(255,255,255,0.9)'/></svg>") 16 16, auto !important;
          }
        \`;
        (document.head || document.documentElement).appendChild(style);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectTouchCursor);
      } else {
        injectTouchCursor();
      }
    }
  } catch(e){}
  ` : ''}

  console.log('[N/A Browser] 🥷 Stealth Native-Masked Mobile Fingerprint Applied: ' + ${JSON.stringify(device.name || "Mobile Device")});
})();`;
}


module.exports = { generateFingerprintScript };
