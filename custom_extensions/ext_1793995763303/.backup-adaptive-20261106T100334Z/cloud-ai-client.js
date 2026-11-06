/**
 * N/A DEV - Cloud AI Client (Thin Client v2.1 - Phase 2)
 * Toàn bộ thuật toán nhận diện cầu, Markov, Streak và Master Brain
 * được bảo mật và thực thi 100% trên VPS Cloud Server.
 */
(function(window) {
  'use strict';

  const BRIDGE_BASE_URL = 'http://127.0.0.1:48903';
  const BRIDGE_HANDSHAKE_URL = `${BRIDGE_BASE_URL}/handshake`;
  const BRIDGE_URL = `${BRIDGE_BASE_URL}/bridge`;
  const DEFAULT_EXTENSION_ID = 'ckbbfkpiagcdimpojifnelmegkohfpjb';
  const OBSERVED_ROUNDS_STORAGE_KEY = 'wm_cloud_observed_rounds_v3';
  const OBSERVED_ROUND_MAX_ITEMS = 2000; // Lưu bền vững LRU 2.000 ván gần nhất, KHÔNG giới hạn TTL 10 phút

  const AUTH_ERROR_CODES = [
    'LICENSE_REVOKED',
    'LICENSE_EXPIRED',
    'LICENSE_DISABLED',
    'KEY_SUSPENDED',
    'DEVICE_NOT_REGISTERED',
    'MACHINE_MISMATCH',
    'MISSING_IDENTITY',
    'SIGNATURE_MISMATCH',
    'INVALID_SIGNATURE',
    'RUN_ACTIVATE_BAT_FIRST',
    'MACHINE_CHANGED_CONTACT_ADMIN',
    'UNAUTHORIZED'
  ];

  let directSessionToken = null;
  let directSessionExpiresAt = 0;

  function isAuthErrorCode(code) {
    if (!code) return false;
    const upper = String(code).toUpperCase();
    return AUTH_ERROR_CODES.some((k) => upper.includes(k));
  }

  function normalizeBridgeResponse(raw, fallbackStatus = 200) {
    if (!raw || typeof raw !== 'object') {
      return {
        ok: false,
        status: 503,
        data: null,
        error: 'EMPTY_BRIDGE_RESPONSE',
        msg: 'Không nhận được phản hồi hợp lệ từ Local Bridge'
      };
    }

    const status = (typeof raw.status === 'number') ? raw.status : fallbackStatus;
    const innerData = (raw.data !== undefined) ? raw.data : raw;
    const explicitlyInactive = Boolean(innerData && typeof innerData === 'object' && innerData.active === false);
    const isConflict = Boolean(
      (innerData && typeof innerData === 'object' && (innerData.status === 'CONFLICT' || innerData.conflict)) ||
      (raw && (raw.status === 'CONFLICT' || raw.conflict))
    );
    const isAck = Boolean(
      (innerData && typeof innerData === 'object' && (innerData.ack || innerData.status === 'COMMITTED' || innerData.status === 'ALREADY_COMMITTED' || innerData.status === 'AI_PROCESSED')) ||
      (raw && (raw.ack || raw.status === 'COMMITTED' || raw.status === 'ALREADY_COMMITTED' || raw.status === 'AI_PROCESSED'))
    );
    const ok = Boolean((raw.ok !== false || isConflict || isAck) && status >= 200 && status < 400 && !explicitlyInactive);

    const errorCode = !ok
      ? String(
          raw.error ||
          (innerData && innerData.error) ||
          (status === 401 ? 'BRIDGE_AUTH_REQUIRED' : (status === 403 || explicitlyInactive ? 'LICENSE_REVOKED' : `HTTP_${status}`))
        )
      : '';

    const userMsg = String(
      raw.msg ||
      (innerData && innerData.msg) ||
      errorCode ||
      ''
    );

    return {
      ok,
      status: (!ok && (explicitlyInactive || isAuthErrorCode(errorCode))) ? 403 : status,
      data: innerData,
      error: errorCode,
      msg: userMsg
    };
  }

  async function ensureDirectBridgeSessionToken(forceRefresh = false, timeoutMs = 3500) {
    const now = Date.now();
    if (!forceRefresh && directSessionToken && now < directSessionExpiresAt) {
      return directSessionToken;
    }
    if (forceRefresh) {
      directSessionToken = null;
      directSessionExpiresAt = 0;
    }

    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timerId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const extId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)
        ? chrome.runtime.id
        : DEFAULT_EXTENSION_ID;
      const nonce = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      const resp = await fetch(BRIDGE_HANDSHAKE_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_nonce: nonce, extension_id: extId }),
        signal: controller ? controller.signal : undefined
      });
      if (timerId) clearTimeout(timerId);
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data && data.ok && typeof data.session_token === 'string') {
        const ttlSec = (typeof data.expires_in === 'number' && data.expires_in > 120) ? data.expires_in : 3600;
        directSessionToken = data.session_token;
        directSessionExpiresAt = Date.now() + Math.max(60, ttlSec - 60) * 1000;
        return directSessionToken;
      }
      return null;
    } catch (e) {
      if (timerId) clearTimeout(timerId);
      return null;
    }
  }

  /**
   * Giao tiếp an toàn tới Native Cloud Bridge qua Background Service Worker (`WM_BRIDGE_REQUEST`).
   * Fallback sang direct fetch kèm `/handshake` (`X-Bridge-Auth`) khi chạy trong trang nội bộ của extension.
   */
  async function callBridge(bridgeAction, payloadObj, timeoutMs = 5000) {
    const serializedPayload = (payloadObj === undefined || payloadObj === null)
      ? undefined
      : (typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj));

    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      try {
        const bgRes = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              action: 'WM_BRIDGE_REQUEST',
              bridgeAction,
              payload: serializedPayload,
              timeoutMs
            },
            (resp) => {
              if (chrome.runtime.lastError || !resp) {
                resolve(null);
              } else {
                resolve(resp);
              }
            }
          );
        });
        if (bgRes) {
          return normalizeBridgeResponse(bgRes, bgRes.status || 200);
        }
      } catch (e) {}
    }

    const doDirectCall = async (token) => {
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timerId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const bodyObj = { action: bridgeAction };
        if (serializedPayload !== undefined) {
          bodyObj.payload = serializedPayload;
        }
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
          headers['X-Bridge-Auth'] = token;
        }
        const resp = await fetch(BRIDGE_URL, {
          method: 'POST',
          cache: 'no-store',
          headers,
          body: JSON.stringify(bodyObj),
          signal: controller ? controller.signal : undefined
        });
        if (timerId) clearTimeout(timerId);
        let data = null;
        try {
          data = await resp.json();
        } catch (e) {
          data = null;
        }
        return normalizeBridgeResponse(data, resp.status || 200);
      } catch (err) {
        if (timerId) clearTimeout(timerId);
        const isAbort = Boolean(err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('abort')));
        return {
          ok: false,
          status: isAbort ? 504 : 503,
          data: null,
          error: isAbort ? 'BRIDGE_TIMEOUT' : 'BRIDGE_UNREACHABLE',
          msg: isAbort
            ? `Quá thời gian kết nối Local Bridge (${timeoutMs}ms)`
            : (err && err.message ? err.message : 'Không thể kết nối Local Bridge')
        };
      }
    };

    let token = await ensureDirectBridgeSessionToken(false, Math.min(3500, timeoutMs));
    let res = await doDirectCall(token);
    if (!res.ok && (res.status === 401 || res.error === 'BRIDGE_AUTH_REQUIRED')) {
      token = await ensureDirectBridgeSessionToken(true, Math.min(3500, timeoutMs));
      if (token) {
        res = await doDirectCall(token);
      }
    }
    return res;
  }

  async function callBridgeProxy(reqPayload, timeoutMs = 5000) {
    if (!reqPayload || typeof reqPayload !== 'object') {
      return { ok: false, status: 400, error: 'INVALID_REQUEST', msg: 'Yêu cầu Bridge rỗng' };
    }
    return callBridge(reqPayload.action, reqPayload.payload, timeoutMs);
  }

  window.callBridge = callBridge;
  window.callBridgeProxy = callBridgeProxy;

  class WMBaccaratAIEngine {
    /**
     * Hàm băm 64-bit hex tất định (FNV-1a dual-lane) dùng chung cho prefixHash & windowSignature
     */
    static hashString(str) {
      const s = String(str || '');
      let h1 = 0x811c9dc5;
      let h2 = 0x01000193;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 ^= c;
        h1 = Math.imul(h1, 0x01000193) >>> 0;
        h2 ^= (c + ((i & 0xff) << 8));
        h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
      }
      return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
    }

    /**
     * Chuẩn hóa mọi biến thể ID bàn giữa giao diện H5 và PC về định danh duy nhất (canonicalTableId)
     * Ví dụ:
     *   groupMultiple_101_508 / _sexy_bac_8 / (Sexy)Bac 8 -> wm_sexy_bac_8
     *   groupMultiple_101_105 / _classic_bac_5 / (Classic)Bac 5 / Bac 5 -> wm_classic_bac_5
     *   groupMultiple_101_203 / _speed_bac_3 / (Speed)Bac 3 -> wm_speed_bac_3
     *   groupMultiple_101_302 / _mi_bac_2 / (Mi)Bac 2 -> wm_mi_bac_2
     *   groupMultiple_101_601 / _special_bac_1 / (Special)Bac 1 -> wm_special_bac_1
     */
    static canonicalizeTableId(rawId, rawName) {
      const idStr = String(rawId || '').trim().split(':')[0];
      const nameStr = String(rawName || '').trim();
      const combined = (idStr + ' ' + nameStr).toLowerCase();

      // Loại bỏ hoàn toàn mã bàn ảo 1415 hoặc bàn không hợp lệ
      if (combined.includes('1415') || combined.includes('invalid')) {
        return 'wm_invalid_table';
      }

      // 1. Kiểm tra theo mã số chuẩn groupMultiple_<gameType>_<code> của WM Casino (quét đủ 36+ bàn)
      const gmMatch = idStr.match(/groupMultiple_(\d+)_(\d+)/i);
      if (gmMatch) {
        const gameType = parseInt(gmMatch[1], 10);
        if (gameType !== 101) return 'wm_invalid_table'; // Chỉ nhận Baccarat 101, bỏ qua Rồng Hổ 102, Roulette 103, Sicbo 104
        const code = parseInt(gmMatch[2], 10);
        const sub = (code >= 501 && code <= 599) ? (code - 500) :
                    (code >= 101 && code <= 199) ? (code - 100) :
                    (code >= 201 && code <= 299) ? (code - 200) :
                    (code >= 301 && code <= 399) ? (code - 300) :
                    (code >= 601 && code <= 699) ? (code - 600) : code;
        if (code >= 101 && code <= 199) return 'wm_classic_bac_' + sub;
        if (code >= 201 && code <= 299) return 'wm_speed_bac_' + sub;
        if (code >= 301 && code <= 399) return 'wm_mi_bac_' + sub;
        if (code >= 501 && code <= 599) return 'wm_sexy_bac_' + sub;
        if (code >= 601 && code <= 699) return 'wm_special_bac_' + sub;
        if (code > 0) return 'wm_bac_' + code;
        return 'wm_invalid_table';
      }

      // 1b. Kiểm tra box_pc_<num>
      const boxPcMatch = idStr.match(/^box_pc_(\d+)$/i);
      if (boxPcMatch) {
        const code = parseInt(boxPcMatch[1], 10);
        if (code >= 101 && code <= 199) return 'wm_classic_bac_' + (code - 100);
        if (code >= 201 && code <= 299) return 'wm_speed_bac_' + (code - 200);
        if (code >= 301 && code <= 399) return 'wm_mi_bac_' + (code - 300);
        if (code >= 501 && code <= 599) return 'wm_sexy_bac_' + (code - 500);
        if (code >= 601 && code <= 699) return 'wm_special_bac_' + (code - 600);
        if (code >= 1 && code <= 99) return 'wm_classic_bac_' + code;
        return 'wm_bac_' + code;
      }

      // 2. Kiểm tra theo mẫu đã chuẩn hóa sẵn hoặc tên bàn (_sexy_bac_8, (Sexy)Bac 8, ...)
      const slugMatch = idStr.toLowerCase().match(/^(?:wm)?_?(classic|speed|mi|sexy|special)?_?bac_?(\d+)$/);
      if (slugMatch) {
        const type = slugMatch[1] || '';
        const num = parseInt(slugMatch[2], 10);
        if (num >= 1 && num <= 2000) {
          if (!type) {
            if (num >= 501 && num <= 599) return 'wm_sexy_bac_' + (num - 500);
            if (num >= 101 && num <= 199) return 'wm_classic_bac_' + (num - 100);
            if (num >= 201 && num <= 299) return 'wm_speed_bac_' + (num - 200);
            if (num >= 301 && num <= 399) return 'wm_mi_bac_' + (num - 300);
            if (num >= 601 && num <= 699) return 'wm_special_bac_' + (num - 600);
            if (num > 60) return 'wm_bac_' + num;
            return 'wm_classic_bac_' + num;
          }
          return 'wm_' + type + '_bac_' + num;
        }
      }

      const numMatch = (nameStr || idStr).match(/(?:bac(?:carat)?|bàn|table|[\s_-])[\s_-]*0*(\d+)\b/i) ||
        combined.match(/\b0*(\d+)\s*$/);

      if (numMatch) {
        const tableNo = parseInt(numMatch[1], 10);
        if (!Number.isNaN(tableNo) && tableNo >= 1 && tableNo <= 2000) {
          if (combined.includes('sexy')) return 'wm_sexy_bac_' + tableNo;
          if (combined.includes('speed') || combined.includes('nhanh')) return 'wm_speed_bac_' + tableNo;
          if (combined.includes('mi') || combined.includes('bid') || combined.includes('nặn')) return 'wm_mi_bac_' + tableNo;
          if (combined.includes('special') || combined.includes('đặc biệt')) return 'wm_special_bac_' + tableNo;
          if (combined.includes('classic') || combined.includes('cổ điển')) return 'wm_classic_bac_' + tableNo;
          if (tableNo >= 501 && tableNo <= 599) return 'wm_sexy_bac_' + (tableNo - 500);
          if (tableNo >= 101 && tableNo <= 199) return 'wm_classic_bac_' + (tableNo - 100);
          if (tableNo >= 201 && tableNo <= 299) return 'wm_speed_bac_' + (tableNo - 200);
          if (tableNo >= 301 && tableNo <= 399) return 'wm_mi_bac_' + (tableNo - 300);
          if (tableNo >= 601 && tableNo <= 699) return 'wm_special_bac_' + (tableNo - 600);
          if (tableNo > 60) return 'wm_bac_' + tableNo;
          return 'wm_classic_bac_' + tableNo;
        }
      }

      if (idStr) {
        return idStr.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      }

      return 'wm_invalid_table';
    }

    /**
     * Xây dựng bộ định danh chuẩn xác cho từng ván bài (chống học trùng giữa H5/PC, đa tab, đa máy)
     */
    static buildRoundIdentity(tableId, tableName, previousHistory, newOutcome, shoeId = '0', meta = null) {
      const canonicalTableId = WMBaccaratAIEngine.canonicalizeTableId(tableId, tableName);
      const histArr = Array.isArray(previousHistory) ? previousHistory : [];
      const bpHistory = histArr.filter((x) => x === 'B' || x === 'P');

      const fullLen = (meta && typeof meta.fullShoeLength === 'number' && meta.fullShoeLength >= histArr.length)
        ? meta.fullShoeLength
        : (histArr.length + 1);

      const roundIndex = (meta && typeof meta.roundIndex === 'number' && meta.roundIndex > 0)
        ? meta.roundIndex
        : fullLen;

      const genesisSeq = (meta && meta.shoeGenesis)
        ? String(meta.shoeGenesis)
        : (histArr.length >= 6 ? histArr.slice(0, 6).join('') : histArr.join(''));

      const rawShoe = String(shoeId || '').trim();
      let resolvedShoeId = '';
      if (meta && meta.authoritativeShoeId) {
        resolvedShoeId = String(meta.authoritativeShoeId).trim();
      } else if (rawShoe && rawShoe !== '0' && !rawShoe.startsWith('inferred_')) {
        resolvedShoeId = rawShoe;
      } else if (histArr.length >= 6) {
        // 6 ván đầu tiên trên bảng Châu Bàn cố định suốt cả Shoe -> mọi tab mở ở ván 10 hay 50 đều ra cùng 1 shoeId
        resolvedShoeId = `shoe_${canonicalTableId}_g_${genesisSeq}`;
      } else {
        resolvedShoeId = `shoe_${canonicalTableId}_early`;
      }

      const prefixHash = WMBaccaratAIEngine.hashString(histArr.join(''));
      const tailWindow = histArr.slice(-12).join('');
      const windowSignature = WMBaccaratAIEngine.hashString(`${tailWindow}->${newOutcome || ''}`);
      const idSource = (meta && meta.idSource)
        ? String(meta.idSource)
        : (histArr.length >= 6 ? 'DOM_FULL_SHOE' : 'DOM_PARTIAL');

      const roundUid = `${canonicalTableId}|${resolvedShoeId}|R${roundIndex}|P_${prefixHash}|W_${windowSignature}|${newOutcome || ''}`;
      const windowKey = `${canonicalTableId}|${resolvedShoeId}|W_${windowSignature}|${newOutcome || ''}`;

      return {
        canonicalTableId,
        shoeId: resolvedShoeId,
        roundIndex,
        prefixHash,
        tailWindow,
        windowSignature,
        genesisSeq,
        idSource,
        roundUid,
        windowKey,
        bpLength: bpHistory.length
      };
    }

    constructor() {
      // Mặc định luôn là REAL (Cược thật tự động) cho khách hàng
      this.tradingMode = 'REAL';
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('wm_ai_trading_mode', 'REAL');
        }
      } catch (e) {}
      let initMode = 'LOW'; // Mặc định chế độ TIÊU CHUẨN (LOW - ≥6 ván) an toàn hơn FLASH
      try {
        if (typeof localStorage !== 'undefined') {
          const s = localStorage.getItem('wm_ai_filter_mode');
          if (s === 'FLASH' || s === 'LOW' || s === 'HIGH') initMode = s;
        }
      } catch (e) {}
      this.currentFilterMode = initMode;
      this.modelVersion = 'cloud-v2.1';

      this.bridgeConnected = false;
      this.licenseActive = true;
      this.lastError = null;
      this.lastStatusCode = 200;

      this.stats = {
        totalRoundsObserved: 0,
        patternsLearnedCount: 14,
        predictionsScored: 0,
        correctPredictions: 0,
        accuracy: 0,
        collectedToday: 0,
        collectedWeek: 0,
        collectedMonth: 0,
        collectedTotal: 0,
        collectedHistory: []
      };

      this.cachedPredictions = new Map();
      this.observedRoundsCache = new Map();
      this.lastEvaluationTime = 0;

      this.pendingPredictions = new Map();
      this.db = null;
      this.ensemble = null;
      this.isReadyPromise = Promise.resolve();

      this._loadObservedRoundsFromStorage();
      this.initEvents();
      this.startHeartbeatLoop(25000);
    }

    startHeartbeatLoop(intervalMs = 25000) {
      if (this._heartbeatInterval) return;
      // Only top frame sends heartbeat to prevent duplicate tab counting from iframes
      const isTopFrame = (typeof window !== 'undefined' && window.top === window.self);
      if (!isTopFrame) return;

      const sendBeat = async () => {
        try {
          let tabSessionId = (typeof sessionStorage !== 'undefined') ? sessionStorage.getItem('wm_tab_session_id') : null;
          if (!tabSessionId) {
            tabSessionId = 'tab_' + Math.random().toString(36).slice(2, 10);
            try { sessionStorage.setItem('wm_tab_session_id', tabSessionId); } catch(e) {}
          }
          let profileSessionId = 'profile_default';
          try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              const p = await chrome.storage.local.get(['wm_profile_session_id']);
              if (p && p.wm_profile_session_id) {
                profileSessionId = p.wm_profile_session_id;
              } else {
                profileSessionId = 'prof_' + Math.random().toString(36).slice(2, 10);
                await chrome.storage.local.set({ wm_profile_session_id: profileSessionId });
              }
            }
          } catch(e) {}

          await callBridge('heartbeat', {
            profile_session_id: profileSessionId,
            tab_session_id: tabSessionId,
            table_id: this._activeTableId || '',
            status: 'ACTIVE'
          }, 3500);
        } catch(e) {}
      };

      sendBeat();
      this._heartbeatInterval = setInterval(sendBeat, intervalMs);
    }

    initEvents() {
      window.addEventListener('WM_LICENSE_REVOKED', (e) => {
        this.licenseActive = false;
        this.bridgeConnected = false;
        this.clearPredictionCache('WM_LICENSE_REVOKED_EVENT');
        console.error('[Cloud AI] Bản quyền đã bị khóa hoặc hết hạn:', e.detail);
      });
    }

    isCloudHealthy() {
      return Boolean(this.bridgeConnected && this.licenseActive);
    }

    clearPredictionCache(reason = 'MANUAL') {
      if (this.cachedPredictions && this.cachedPredictions.size > 0) {
        this.cachedPredictions.clear();
      }
      if (this.pendingPredictions && this.pendingPredictions.size > 0) {
        this.pendingPredictions.clear();
      }
    }

    setTradingMode(mode) {
      this.tradingMode = 'REAL';
      for (const [tableId, item] of this.cachedPredictions.entries()) {
        const rawBet = Boolean(item.rawShouldBet !== undefined ? item.rawShouldBet : item.shouldBet);
        const validSide = (item.predicted === 'B' || item.predicted === 'P');
        item.tradingMode = 'REAL';
        item.isPaperTrading = false;
        item.shouldBet = rawBet && validSide;
        this.cachedPredictions.set(tableId, item);
      }
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('wm_ai_trading_mode', 'REAL');
        }
      } catch (e) {}
    }

    get filterMode() {
      return this.currentFilterMode;
    }

    setFilterMode(mode) {
      const allowed = ['FLASH', 'LOW', 'HIGH'];
      const normalized = allowed.includes(mode) ? mode : 'LOW';
      if (this.currentFilterMode !== normalized) {
        this.currentFilterMode = normalized;
        this.clearPredictionCache('FILTER_MODE_CHANGED');
      }
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('wm_ai_filter_mode', normalized);
        }
      } catch (e) {}
      console.log(`[Cloud AI] Độ nhạy lọc tín hiệu: ${this.currentFilterMode}`);
    }

    computeRoundId(tableId, shoeId, history, tableName = '') {
      const canonicalId = WMBaccaratAIEngine.canonicalizeTableId(tableId, tableName);
      const histArr = Array.isArray(history) ? history : [];
      return `${canonicalId}|${String(shoeId || '0')}|${histArr.length}|${histArr.join('')}`;
    }

    _loadObservedRoundsFromStorage() {
      try {
        const raw = window.localStorage ? window.localStorage.getItem(OBSERVED_ROUNDS_STORAGE_KEY) : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            for (const [k, ts] of Object.entries(parsed)) {
              if (typeof ts === 'number') {
                this.observedRoundsCache.set(k, ts);
              }
            }
          }
        }
      } catch (e) {}

      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([OBSERVED_ROUNDS_STORAGE_KEY], (res) => {
            if (res && res[OBSERVED_ROUNDS_STORAGE_KEY] && typeof res[OBSERVED_ROUNDS_STORAGE_KEY] === 'object') {
              for (const [k, ts] of Object.entries(res[OBSERVED_ROUNDS_STORAGE_KEY])) {
                if (typeof ts === 'number' && !this.observedRoundsCache.has(k)) {
                  this.observedRoundsCache.set(k, ts);
                }
              }
            }
          });
        }
      } catch (e) {}
    }

    /**
     * Kiểm tra bền vững (KHÔNG giới hạn TTL 10 phút) trên cả bộ nhớ RAM và localStorage
     */
    _isRoundAlreadyObserved(keysToCheck) {
      const keyList = Array.isArray(keysToCheck) ? keysToCheck : [keysToCheck];
      for (const k of keyList) {
        if (k && this.observedRoundsCache.has(k)) {
          return true;
        }
      }

      try {
        if (window.localStorage) {
          const raw = window.localStorage.getItem(OBSERVED_ROUNDS_STORAGE_KEY);
          if (raw) {
            const storeObj = JSON.parse(raw);
            if (storeObj && typeof storeObj === 'object') {
              for (const k of keyList) {
                if (k && typeof storeObj[k] === 'number') {
                  this.observedRoundsCache.set(k, storeObj[k]);
                  return true;
                }
              }
            }
          }
        }
      } catch (e) {}

      return false;
    }

    /**
     * Lưu bền vững theo cơ chế LRU 2.000 mục gần nhất (KHÔNG xóa theo thời gian 10 phút)
     */
    _markRoundObserved(keysToMark) {
      const now = Date.now();
      const keyList = Array.isArray(keysToMark) ? keysToMark : [keysToMark];
      for (const k of keyList) {
        if (k) {
          this.observedRoundsCache.set(k, now);
        }
      }

      if (this.observedRoundsCache.size > OBSERVED_ROUND_MAX_ITEMS) {
        const entries = Array.from(this.observedRoundsCache.entries())
          .sort((a, b) => a[1] - b[1])
          .slice(-OBSERVED_ROUND_MAX_ITEMS);
        this.observedRoundsCache = new Map(entries);
      }

      try {
        if (window.localStorage) {
          let storeObj = {};
          const raw = window.localStorage.getItem(OBSERVED_ROUNDS_STORAGE_KEY);
          if (raw) {
            try {
              storeObj = JSON.parse(raw) || {};
            } catch (e) {
              storeObj = {};
            }
          }
          for (const k of keyList) {
            if (k) storeObj[k] = now;
          }
          const trimmedEntries = Object.entries(storeObj)
            .filter(([, ts]) => typeof ts === 'number')
            .sort((a, b) => a[1] - b[1])
            .slice(-OBSERVED_ROUND_MAX_ITEMS);

          const cleanObj = {};
          for (const [k, ts] of trimmedEntries) {
            cleanObj[k] = ts;
          }
          window.localStorage.setItem(OBSERVED_ROUNDS_STORAGE_KEY, JSON.stringify(cleanObj));

          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ [OBSERVED_ROUNDS_STORAGE_KEY]: cleanObj });
          }
        }
      } catch (e) {}
    }

    async callBridge(bridgeAction, payloadObj, timeoutMs = 5000) {
      return callBridge(bridgeAction, payloadObj, timeoutMs);
    }

    async evaluateTablesBatch(tablesList) {
      if (!Array.isArray(tablesList) || tablesList.length === 0) {
        return {};
      }

      const now = Date.now();
      const currentSignature = tablesList.map(t => `${t.id}:${(t.history || []).join('')}`).sort().join('|');

      // Khóa chống bắn đè dồn ứ request khi cuộc gọi trước đang xử lý (In-flight concurrency guard)
      if (this._isEvaluatingBatch) {
        const cachedResult = {};
        for (const t of tablesList) {
          const pred = this.cachedPredictions.get(t.id) || (t.canonicalId ? this.cachedPredictions.get(t.canonicalId) : null);
          if (pred) cachedResult[t.id] = pred;
        }
        return cachedResult;
      }

      // Smart Throttle: Nếu chưa quá 2500ms và chữ ký lịch sử các bàn không đổi -> dùng ngay cache hiện tại, giảm tải tuyệt đối cho Cloud VPS
      if (this.lastEvaluationTime && (now - this.lastEvaluationTime < 2500) && this._lastEvalSignature === currentSignature && this.cachedPredictions.size > 0) {
        const cachedResult = {};
        for (const t of tablesList) {
          const pred = this.cachedPredictions.get(t.id) || (t.canonicalId ? this.cachedPredictions.get(t.canonicalId) : null);
          if (pred) cachedResult[t.id] = pred;
        }
        if (Object.keys(cachedResult).length > 0) {
          return cachedResult;
        }
      }

      this._isEvaluatingBatch = true;

      const payload = {
        mode: this.currentFilterMode,
        tradingMode: 'REAL',
        tables: tablesList.map((t) => {
          const canonicalId = WMBaccaratAIEngine.canonicalizeTableId(t.id, t.name);
          const histArr = Array.isArray(t.history) ? t.history : [];
          const identity = WMBaccaratAIEngine.buildRoundIdentity(t.id, t.name, histArr, '', t.shoe || '0');
          return {
            id: t.id,
            canonicalTableId: canonicalId,
            name: t.name || t.id,
            history: histArr,
            shoe: identity.shoeId,
            rawShoe: String(t.shoe || '0')
          };
        })
      };

      try {
        const res = await this.callBridge('evaluate', payload, 5000);
        const status = res ? (res.status || 200) : 503;
        const errCode = res ? (res.error || (res.data && res.data.error) || '') : 'BRIDGE_UNREACHABLE';
        const msg = res ? (res.msg || (res.data && res.data.msg) || errCode) : 'Mất kết nối Local Bridge';
        const d = res ? res.data : null;

        const isNetworkErr = status === 503 || status === 504 || (d && d.network_error) || errCode === 'CLOUD_UNREACHABLE' || errCode === 'CLOUD_TIMEOUT' || errCode === 'BRIDGE_UNREACHABLE';
        const isActuallyRevoked = !isNetworkErr && (
          status === 401 ||
          status === 403 ||
          isAuthErrorCode(errCode) ||
          (d && d.active === false)
        );

        if (isActuallyRevoked) {
          this.clearPredictionCache('AUTH_OR_LICENSE_ERROR');
          this.licenseActive = false;
          this.bridgeConnected = false;
          this.lastStatusCode = status >= 400 ? status : 403;
          this.lastError = msg || errCode || 'LICENSE_REVOKED';

          if (typeof this.onStatsChange === 'function') {
            this.onStatsChange(this.stats, this.currentFilterMode, false);
          }

          window.dispatchEvent(
            new CustomEvent('WM_LICENSE_REVOKED', {
              detail: msg || errCode || 'Bản quyền đã hết hạn hoặc bị thu hồi'
            })
          );
          return null;
        }

        // Xử lý Rate Limit 429: Giữ nguyên cache hiện tại, duy trì trạng thái kết nối để bot tiếp tục cược
        if (status === 429) {
          this.lastStatusCode = 200;
          this.lastError = null;
          this.bridgeConnected = true;
          this.licenseActive = true;
          this._lastEvalSignature = currentSignature;
          this.lastEvaluationTime = now + 2500;
          const fallbackResult = {};
          for (const t of tablesList) {
            const pred = this.cachedPredictions.get(t.id);
            if (pred) fallbackResult[t.id] = pred;
          }
          return fallbackResult;
        }

        if (isNetworkErr || !res || !res.ok || !d || typeof d !== 'object') {
          // Lỗi mạng tạm thời: KHÔNG coi là thu hồi bản quyền, bot giữ nguyên trạng thái chờ nhịp sau
          this.clearPredictionCache('NETWORK_OR_SERVER_ERROR');
          this.lastStatusCode = status >= 400 ? status : 503;
          this.lastError = msg || errCode || 'CLOUD_DISCONNECTED';
          return null;
        }

        this.bridgeConnected = true;
        this.licenseActive = true;
        this.lastStatusCode = 200;
        this.lastError = null;

        if (d.modelVersion) {
          this.modelVersion = String(d.modelVersion);
        }

        if (d.stats && typeof d.stats === 'object') {
          this.stats = Object.assign({}, this.stats, d.stats);
          if (typeof this.onStatsChange === 'function') {
            this.onStatsChange(this.stats, this.currentFilterMode, true);
          }
        }

        if (d.predictions && typeof d.predictions === 'object') {
          const now = Date.now();
          const ttlMs = 30000; // 30s TTL de giu tin hieu on dinh suot phien cuoc
          const activeTableIds = new Set();

          for (const t of tablesList) {
            if (!t || !t.id) continue;
            const canonicalId = WMBaccaratAIEngine.canonicalizeTableId(t.id, t.name);
            const pred = d.predictions[t.id] || d.predictions[canonicalId];
            if (!pred || typeof pred !== 'object') {
              this.cachedPredictions.delete(t.id);
              this.cachedPredictions.delete(canonicalId);
              continue;
            }

            activeTableIds.add(t.id);
            activeTableIds.add(canonicalId);

            const histArr = Array.isArray(t.history) ? t.history : [];
            const shoeId = String(t.shoe || '0');
            const roundId = this.computeRoundId(t.id, shoeId, histArr, t.name);
            const rawShouldBet = Boolean(pred.shouldBet) && (pred.predicted === 'B' || pred.predicted === 'P');

            const enrichedPrediction = Object.assign({}, pred, {
              tableId: t.id,
              canonicalTableId: canonicalId,
              tableName: t.name || t.id,
              shoeId,
              roundId,
              historyLength: histArr.length,
              historySig: histArr.join(''),
              modelVersion: d.modelVersion || this.modelVersion,
              filterMode: this.currentFilterMode,
              tradingMode: 'REAL',
              isPaperTrading: false,
              cachedAt: now,
              expiresAt: now + ttlMs,
              stale: false,
              rawShouldBet,
              shouldBet: rawShouldBet
            });

            this.cachedPredictions.set(t.id, enrichedPrediction);
            this.cachedPredictions.set(canonicalId, enrichedPrediction);
          }

          for (const existingKey of Array.from(this.cachedPredictions.keys())) {
            if (!activeTableIds.has(existingKey)) {
              this.cachedPredictions.delete(existingKey);
            }
          }

          this._lastEvalSignature = currentSignature;
          this.lastEvaluationTime = now;

          // Cap nhat thong ke AI len UI Card chinh ngay khi co du doan
          let bestPred = null;
          for (const p of this.cachedPredictions.values()) {
            if (p && p.shouldBet && (!bestPred || (p.confidence || 0) > (bestPred.confidence || 0))) {
              bestPred = p;
            }
          }
          if (!bestPred) {
            for (const p of this.cachedPredictions.values()) {
              if (p && (!bestPred || (p.confidence || 0) > (bestPred.confidence || 0))) {
                bestPred = p;
              }
            }
          }
          if (bestPred) {
            this.stats = Object.assign({}, this.stats, {
              activePatternName: bestPred.pattern || 'Cầu AI',
              accuracy: bestPred.confidence || 0.85,
              totalRoundsObserved: bestPred.historyLength || 10
            });
            if (typeof this.onStatsChange === 'function') {
              this.onStatsChange(this.stats, this.currentFilterMode, true);
            }
          }

          return d.predictions;
        }
      } catch (err) {
        this.clearPredictionCache('EVALUATE_EXCEPTION');
        this.bridgeConnected = false;
        this.lastStatusCode = 503;
        this.lastError = (err && err.message) ? err.message : 'EVALUATE_EXCEPTION';
        if (typeof this.onStatsChange === 'function') {
          this.onStatsChange(this.stats, this.currentFilterMode, false);
        }
        return null;
      } finally {
        this._isEvaluatingBatch = false;
      }
    }

    generatePrediction(tableId, tableName, history, shoeId = '0') {
      const makePass = (rationale, stale = false) => ({
        tableId,
        tableName: tableName || tableId,
        predicted: 'PASS',
        shouldBet: false,
        confidence: 0,
        stale,
        rationale
      });

      if (!this.bridgeConnected || !this.licenseActive) {
        return makePass('Mất kết nối Cloud hoặc bản quyền không hợp lệ', true);
      }

      const canonicalId = WMBaccaratAIEngine.canonicalizeTableId(tableId, tableName);
      const cached = this.cachedPredictions.get(tableId) || this.cachedPredictions.get(canonicalId);
      if (!cached) {
        return makePass('Đang đợi tín hiệu phân tích từ VPS Cloud', false);
      }

      const evictBoth = () => {
        this.cachedPredictions.delete(tableId);
        this.cachedPredictions.delete(canonicalId);
      };

      const now = Date.now();
      if (typeof cached.cachedAt === 'number' && (now - cached.cachedAt > 15000)) {
        evictBoth();
        return makePass('Tín hiệu AI đã quá hạn TTL (>15s)', true);
      }
      if (typeof cached.expiresAt === 'number' && now > cached.expiresAt) {
        evictBoth();
        return makePass('Tín hiệu AI đã hết hạn (Stale Signal)', true);
      }

      const normalizedShoe = String(shoeId || '0');
      const isSyntheticShoe = typeof cached.shoeId === 'string' && cached.shoeId.startsWith('shoe_');
      const isDomShoeZero = normalizedShoe === '0' || normalizedShoe === '';
      if (cached.shoeId !== undefined && String(cached.shoeId) !== normalizedShoe) {
        if (!(isSyntheticShoe && isDomShoeZero)) {
          evictBoth();
          return makePass('Lệch Shoe ID (Đã sang Shoe mới)', true);
        }
      }

      if (Array.isArray(history)) {
        const currentRoundId = this.computeRoundId(tableId, normalizedShoe, history, tableName);
        if (cached.roundId && cached.roundId !== currentRoundId) {
          const historySig = history.join('');
          const cachedSig = (cached.historySig || (cached.history ? cached.history.join('') : ''));
          if (cachedSig && cachedSig !== historySig) {
            evictBoth();
            return makePass('Lệch Round ID (Đã chuyển sang ván mới)', true);
          }
        }
      }

      if (
        (cached.modelVersion && String(cached.modelVersion) !== String(this.modelVersion)) ||
        (cached.filterMode && cached.filterMode !== this.currentFilterMode)
      ) {
        evictBoth();
        return makePass('Đã đổi chế độ lọc hoặc phiên bản Model', true);
      }

      const validSide = (cached.predicted === 'B' || cached.predicted === 'P');
      const rawBet = Boolean(cached.rawShouldBet !== undefined ? cached.rawShouldBet : cached.shouldBet);

      return Object.assign({}, cached, {
        tableId,
        stale: false,
        tradingMode: 'REAL',
        isPaperTrading: false,
        shouldBet: rawBet && validSide
      });
    }

    onRoundCompleted(tableId, tableName, previousHistory, newOutcome, shoeId = '0', meta = null) {
      if (tableId) {
        this.cachedPredictions.delete(tableId);
        this.cachedPredictions.delete(WMBaccaratAIEngine.canonicalizeTableId(tableId, tableName));
      }
      return this.observeRound(tableId, tableName, previousHistory, newOutcome, shoeId, meta);
    }

    observeRound(tableId, tableName, previousHistory, newOutcome, shoeId = '0', meta = null) {
      if (tableId) {
        this.cachedPredictions.delete(tableId);
        this.cachedPredictions.delete(WMBaccaratAIEngine.canonicalizeTableId(tableId, tableName));
      }

      if (!newOutcome || (newOutcome !== 'B' && newOutcome !== 'P')) {
        return Promise.resolve({ skipped: true, reason: 'NON_BP_OUTCOME' });
      }

      const histArr = Array.isArray(previousHistory) ? previousHistory : [];
      const identity = WMBaccaratAIEngine.buildRoundIdentity(tableId, tableName, histArr, newOutcome, shoeId, meta);
      const dedupKeys = [identity.roundUid, identity.windowKey];

      if (this._isRoundAlreadyObserved(dedupKeys)) {
        return Promise.resolve({
          skipped: true,
          reason: 'DUPLICATE_ROUND',
          roundUid: identity.roundUid,
          canonicalTableId: identity.canonicalTableId
        });
      }

      // CHÚ Ý BẢO MẬT: KHÔNG đánh dấu ván là ACKNOWLEDGED trước khi server xác nhận!
      // _markRoundObserved chỉ được gọi khi server/VPS trả về ACK thực sự.

      const payload = {
        table_id: identity.canonicalTableId,
        shoe_id: identity.shoeId,
        round_id: String(identity.roundIndex || identity.roundUid || '0'),
        tableId: identity.canonicalTableId,
        rawTableId: tableId,
        canonicalTableId: identity.canonicalTableId,
        tableName: tableName || identity.canonicalTableId,
        shoe: identity.shoeId,
        rawShoe: String(shoeId || '0'),
        roundIndex: identity.roundIndex,
        prefixHash: identity.prefixHash,
        windowSignature: identity.windowSignature,
        idSource: identity.idSource,
        roundUid: identity.roundUid,
        roundKey: identity.roundUid,
        windowKey: identity.windowKey,
        history: histArr,
        outcome: newOutcome
      };

      return this.callBridge('observe', payload, 5000)
        .then((res) => {
          if (!res) return { ok: false };

          const isNetworkErr = res.status === 503 || res.status === 504 || (res.data && res.data.network_error) || res.error === 'CLOUD_UNREACHABLE' || res.error === 'CLOUD_TIMEOUT';
          const isActuallyRevoked = !isNetworkErr && (
            res.status === 401 ||
            res.status === 403 ||
            isAuthErrorCode(res.error) ||
            (res.data && res.data.active === false)
          );

          if (isActuallyRevoked) {
            this.clearPredictionCache('OBSERVE_AUTH_ERROR');
            this.licenseActive = false;
            this.bridgeConnected = false;
            window.dispatchEvent(
              new CustomEvent('WM_LICENSE_REVOKED', {
                detail: res.msg || res.error || 'Bản quyền đã hết hạn hoặc bị thu hồi'
              })
            );
            return res;
          }

          if (res.ok && res.data) {
            const isConfirmedAck = Boolean(
              res.data.ack ||
              res.data.status === 'COMMITTED' ||
              res.data.status === 'ALREADY_COMMITTED' ||
              res.data.status === 'AI_PROCESSED' ||
              res.data.status === 'CONFLICT' ||
              res.data.conflict ||
              res.data.deduplicated
            );

            if (isConfirmedAck) {
              // Chỉ đánh dấu ván bài là đã quan sát thành công KHI VPS Cloud đã xác nhận ACK!
              this._markRoundObserved(dedupKeys);
            }

            if (res.data.status === 'CONFLICT' || res.data.conflict) {
              console.warn('[Cloud AI] Ván đấu bị xung đột kết quả (CONFLICT), máy chủ đã cách ly vào hàng đợi kiểm tra:', res.data.msg || res.msg);
            } else if (res.data.status === 'ALREADY_COMMITTED' || res.data.deduplicated) {
              console.log('[Cloud AI] Ván đấu đã được ghi nhận trước đó (ALREADY_COMMITTED/DEDUP).');
            } else if (res.data.status === 'COMMITTED' || res.data.ack) {
              console.log('[Cloud AI] Ván đấu đã được ghi nhận thành công (COMMITTED/ACK).');
            }

            if (res.data.totalRounds) {
              this.stats.totalRoundsObserved = res.data.totalRounds;
            }
            if (res.data.collected) {
              this.stats.collectedToday = res.data.collected.today || 0;
              this.stats.collectedWeek = res.data.collected.week || 0;
              this.stats.collectedMonth = res.data.collected.month || 0;
              this.stats.collectedTotal = res.data.collected.total || res.data.totalRounds || 0;
              if (res.data.collected.history) this.stats.collectedHistory = res.data.collected.history;
            }
            if (typeof this.onStatsChange === 'function') {
              this.onStatsChange(this.stats, this.currentFilterMode, true);
            }
          }
          return res;
        })
        .catch(() => ({ ok: false }));
    }

    exportKnowledge() {
      return JSON.stringify({
        cloudManaged: true,
        modelVersion: this.modelVersion,
        notice: 'Master Brain được bảo mật và quản lý 100% trên VPS Cloud.'
      });
    }

    async importKnowledge() {
      return {
        ok: false,
        cloudManaged: true,
        message: 'Master Brain được đồng bộ trực tiếp từ VPS Cloud, không nạp file cục bộ.'
      };
    }

    async resetMemory() {
      this.clearPredictionCache('USER_RESET');
      return {
        ok: true,
        cloudManaged: true,
        message: 'Đã làm mới bộ nhớ đệm cục bộ. Master Brain trên Cloud VPS được giữ nguyên.'
      };
    }
  }

  window.WMBaccaratAIEngine = WMBaccaratAIEngine;
})(window);
