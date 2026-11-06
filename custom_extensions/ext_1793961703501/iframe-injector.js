// iframe-injector.js - Chạy trong tất cả các iframe để tương tác DOM và lắng nghe sự kiện
(function() {
  'use strict';
  console.log('[WM Injector] Script đã nạp vào iframe:', window.location.href);

  const cachedTablesMap = new Map();
  let lastAutoScrollTime = 0;
  const iframeBetCooldown = new Map(); // tableId -> timestamp chống click đúp (Debounce Mutex)

  function getAllTargetDocs() {
    const docs = [document];
    const iframe109 = document.getElementById('iframe_109');
    if (iframe109) {
      try {
        const d = iframe109.contentDocument || iframe109.contentWindow?.document;
        if (d && !docs.includes(d)) docs.push(d);
      } catch (e) {}
    }
    try {
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(ifr => {
        try {
          const d = ifr.contentDocument || ifr.contentWindow?.document;
          if (d && !docs.includes(d)) docs.push(d);
        } catch (e) {}
      });
    } catch (e) {}
    return docs;
  }

  function getTargetDoc() {
    const docs = getAllTargetDocs();
    return docs.length > 1 ? docs[1] : docs[0];
  }

  // Gửi phản hồi an toàn tới cả window.parent và window.top (hỗ trợ nested iframe đa tầng)
  function sendToParent(payload, targetOrigin = '*') {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, targetOrigin);
      }
    } catch (e) {}
    if (window.top && window.top !== window && window.top !== window.parent) {
      try {
        window.top.postMessage(payload, targetOrigin);
      } catch (e) {}
    }
  }

  // Lắng nghe lệnh từ trang cha
  window.addEventListener('message', function(event) {
    const data = event.data;
    if (!data || !data.action) return;

    // Xác thực nguồn: Chỉ chấp nhận message từ window.parent hoặc window.top
    if (event.source !== window.parent && event.source !== window.top) return;

    // Chuyển tiếp message tới các sub-iframe con bên dưới nếu có (hỗ trợ nested frame đa tầng)
    try {
      const childIframes = document.querySelectorAll('iframe');
      childIframes.forEach(subIfr => {
        try {
          subIfr.contentWindow?.postMessage(data, '*');
        } catch (e) {}
      });
    } catch (e) {}

    // Xác thực action chỉ cho phép các lệnh đã biết
    const ALLOWED_ACTIONS = ['FIND_ELEMENT', 'CLICK_ELEMENT', 'GET_INFO', 'GET_ALL_IDS',
      'FIND_IN_NESTED_IFRAME', 'CLICK_IN_NESTED_IFRAME', 'GET_TABLES',
      'CLICK_BET_ZONE', 'CLICK_CONFIRM', 'FORCE_SCROLL_TABLES', 'SELECT_CHIP'];
    if (!ALLOWED_ACTIONS.includes(data.action)) return;

    // Xác thực messageId phải là number (nếu có)
    if (data.messageId !== undefined && typeof data.messageId !== 'number') return;

    const isValidSelector = (sel, t) =>
      typeof sel === 'string' && sel.length > 0 && sel.length <= 512 && ['id', 'css', 'xpath'].includes(t);
    const isValidIframeId = (id) =>
      typeof id === 'string' && id.length > 0 && id.length <= 128;

    switch (data.action) {
      case 'FIND_ELEMENT':
        if (!isValidSelector(data.selector, data.type)) return;
        findElement(data.selector, data.type, data.messageId);
        break;
      case 'CLICK_ELEMENT':
        if (!isValidSelector(data.selector, data.type)) return;
        clickElement(data.selector, data.type, data.messageId);
        break;
      case 'GET_INFO':
        getInfo(data.messageId);
        break;
      case 'GET_ALL_IDS':
        getAllIds(data.messageId);
        break;
      case 'FIND_IN_NESTED_IFRAME':
        if (!isValidIframeId(data.iframeId) || !isValidSelector(data.selector, data.type)) return;
        findInNestedIframe(data.iframeId, data.selector, data.type, data.messageId);
        break;
      case 'CLICK_IN_NESTED_IFRAME':
        if (!isValidIframeId(data.iframeId) || !isValidSelector(data.selector, data.type)) return;
        clickInNestedIframe(data.iframeId, data.selector, data.type, data.messageId);
        break;
      case 'GET_TABLES':
        getTables(data.messageId);
        break;
      case 'CLICK_BET_ZONE':
        if (typeof data.tableId !== 'string' || data.tableId.length === 0 || (data.bet !== 'B' && data.bet !== 'P')) return;
        // Luôn luôn thực thi lệnh đặt chip cược thật 100% cho khách hàng
        clickBetZone(data.tableId, data.bet, data.messageId, data.candidateIds);
        break;
      case 'CLICK_CONFIRM':
        if (typeof data.tableId !== 'string' || data.tableId.length === 0) return;
        // Luôn luôn thực thi lệnh bấm xác nhận cược cho khách hàng
        clickConfirm(data.tableId, data.messageId);
        break;
      case 'FORCE_SCROLL_TABLES':
        forceScrollAllTables(data.messageId);
        break;
      case 'SELECT_CHIP':
        if (data.chip === undefined || data.chip === null || !/^[0-9kK]{1,8}$/.test(String(data.chip))) return;
        selectChip(data.chip, data.messageId);
        break;
    }
  });

  function findElement(selector, type, messageId) {
    let el = null;
    try {
      const doc = getTargetDoc();
      if (type === 'id') {
        el = doc.getElementById(selector);
      } else if (type === 'css') {
        el = doc.querySelector(selector);
      } else if (type === 'xpath') {
        const res = doc.evaluate(selector, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        el = res.singleNodeValue;
      }
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        found: !!el,
        selector: selector
      }, '*');
    } catch (err) {
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        found: false,
        error: err.message
      }, '*');
    }
  }

  function clickElement(selector, type, messageId) {
    let el = null;
    try {
      const doc = getTargetDoc();
      if (type === 'id') {
        el = doc.getElementById(selector);
      } else if (type === 'css') {
        el = doc.querySelector(selector);
      } else if (type === 'xpath') {
        const res = doc.evaluate(selector, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        el = res.singleNodeValue;
      }

      if (el) {
        el.click();
        sendToParent({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: true,
          action: 'clicked'
        }, '*');
      } else {
        sendToParent({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: false,
          error: 'Element not found'
        }, '*');
      }
    } catch (err) {
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        success: false,
        error: err.message
      }, '*');
    }
  }

  function getInfo(messageId) {
    const info = {
      type: 'WM_IFRAME_RESPONSE',
      messageId: messageId,
      url: window.location.href,
      title: document.title,
      bodyExists: !!document.body,
      elementCount: document.querySelectorAll('*').length
    };
    sendToParent(info, '*');
  }

  function getAllIds(messageId) {
    try {
      const ids = Array.from(document.querySelectorAll('[id]')).map(el => el.id).filter(Boolean);
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        ids: ids,
        count: ids.length
      }, '*');
    } catch (err) {
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        ids: [],
        error: err.message
      }, '*');
    }
  }

  function findInNestedIframe(iframeId, selector, type, messageId) {
    try {
      const iframe = document.getElementById(iframeId);
      const doc = iframe ? (iframe.contentDocument || iframe.contentWindow?.document) : document;

      let el = null;
      if (type === 'id') {
        el = doc.getElementById(selector);
      } else if (type === 'css') {
        el = doc.querySelector(selector);
      } else if (type === 'xpath') {
        const res = doc.evaluate(selector, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        el = res.singleNodeValue;
      }

      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        found: !!el,
        selector: selector
      }, '*');
    } catch (err) {
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        found: false,
        error: err.message
      }, '*');
    }
  }

  function clickInNestedIframe(iframeId, selector, type, messageId) {
    try {
      const iframe = document.getElementById(iframeId);
      const doc = iframe ? (iframe.contentDocument || iframe.contentWindow?.document) : document;

      let el = null;
      if (type === 'id') {
        el = doc.getElementById(selector);
      } else if (type === 'css') {
        el = doc.querySelector(selector);
      } else if (type === 'xpath') {
        const res = doc.evaluate(selector, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        el = res.singleNodeValue;
      }

      if (el) {
        el.click();
        sendToParent({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: true,
          action: 'clicked'
        }, '*');
      } else {
        sendToParent({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: false,
          error: 'Element not found'
        }, '*');
      }
    } catch (err) {
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        success: false,
        error: err.message
      }, '*');
    }
  }

  function forceScrollAllTables(messageId) {
    try {
      cachedTablesMap.clear();
      const doc = getTargetDoc();
      const scrollers = Array.from(doc.querySelectorAll('.gameroom-list, [class*="tablebox"], [class*="room-list"], [class*="gameroom"], [class*="scroll"], #pc_multi_bet_tablebox, .content, main')).filter(el => {
        try {
          return el.scrollHeight > el.clientHeight + 50;
        } catch (e) {
          return false;
        }
      });

      if (scrollers.length > 0) {
        scrollers.forEach(s => {
          const oldTop = s.scrollTop;
          s.scrollTo({ top: s.scrollHeight, behavior: 'auto' });
          setTimeout(() => s.scrollTo({ top: oldTop, behavior: 'auto' }), 500);
        });
      } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'auto' }), 500);
      }

      setTimeout(() => getTables(messageId), 1000);
    } catch (e) {
      getTables(messageId);
    }
  }

  // Trích xuất tên bàn thân thiện (dịch từ ID hoặc đọc DOM cực nhanh bằng textContent)
  function extractTableName(box, id) {
    if (box) {
      const titleSelectors = [
        '.gameroom-header-title', '.gameroom_title', '.gameroom-title', '.gameroom_name',
        '.table-name', '.title', '.table_title', '.room_title', '.name',
        '[class*="gameroom-title"]', '[class*="table-name"]', '[class*="tableName"]',
        '[class*="title"]', '.gameroom_header', '.header'
      ];
      for (const sel of titleSelectors) {
        try {
          const el = box.querySelector(sel);
          if (el) {
            const txt = (el.textContent || '').trim();
            const m = txt.match(/(?:\(([^)]+)\)|(Classic|Sexy|Speed|Mi|Special))?\s*(?:Bac(?:carat)?|Bàn|百家乐)\s*0*(\d{1,4})/i);
            if (m) {
              const grp = m[1] || m[2] || '';
              const prefix = grp ? `(${grp.charAt(0).toUpperCase() + grp.slice(1).toLowerCase()})` : '';
              let num = parseInt(m[3], 10);
              if (num > 25 && num < 100 && num % 10 !== 0) num = Math.floor(num / 10);
              if (num >= 1 && num <= 2000) return `${prefix}Bac ${num}`;
            }
          }
        } catch (e) {}
      }

      // Quét lá con leaf nodes
      try {
        const allSub = box.querySelectorAll('*');
        for (let i = 0; i < allSub.length; i++) {
          const el = allSub[i];
          if (!el.children || el.children.length === 0) {
            const txt = (el.textContent || '').trim();
            const m = txt.match(/^(?:\(([^)]+)\)|(Classic|Sexy|Speed|Mi|Special))?\s*(?:Bac(?:carat)?|Bàn|百家乐)\s*0*([1-9]\d{0,3})$/i);
            if (m) {
              const grp = m[1] || m[2] || '';
              const prefix = grp ? `(${grp.charAt(0).toUpperCase() + grp.slice(1).toLowerCase()})` : '';
              let num = parseInt(m[3], 10);
              if (num > 25 && num < 100 && num % 10 !== 0) num = Math.floor(num / 10);
              if (num >= 1 && num <= 2000) return `${prefix}Bac ${num}`;
            }
          }
        }
      } catch (e) {}

      try {
        const fullTxt = (box.textContent || '');
        const m = fullTxt.match(/(?:\(([^)]+)\)|(Classic|Sexy|Speed|Mi|Special))\s*Bac\s*0*([1-9]\d{0,3})/i) ||
                  fullTxt.match(/\bBac\s*0*([1-9]\d{0,3})\b/i);
        if (m) {
          const grp = m[1] || m[2] || '';
          let num = parseInt(m[3] || m[1], 10);
          if (num > 25 && num < 100 && num % 10 !== 0) num = Math.floor(num / 10);
          if (num >= 1 && num <= 2000) {
            const prefix = grp ? `(${grp.charAt(0).toUpperCase() + grp.slice(1).toLowerCase()})` : '';
            return `${prefix}Bac ${num}`;
          }
        }
      } catch (e) {}
    }

    if (id) {
      if (id.includes('1415') || id.includes('invalid')) return null;

      const sexyMatch = id.match(/_sexy_bac_(\d+)/i);
      if (sexyMatch) {
        let num = parseInt(sexyMatch[1], 10);
        if (num > 25 && num < 100 && num % 10 !== 0) num = Math.floor(num / 10);
        return `(Sexy)Bac ${num}`;
      }
      const classicMatch = id.match(/_classic_bac_(\d+)/i);
      if (classicMatch) return `(Classic)Bac ${classicMatch[1]}`;
      const speedMatch = id.match(/_speed_bac_(\d+)/i);
      if (speedMatch) return `(Speed)Bac ${speedMatch[1]}`;
      const miMatch = id.match(/_mi_bac_(\d+)/i);
      if (miMatch) return `(Mi)Bac ${miMatch[1]}`;
      const specialMatch = id.match(/_special_bac_(\d+)/i);
      if (specialMatch) return `(Special)Bac ${specialMatch[1]}`;

      const idMatch = id.match(/groupMultiple_(\d+)_(\d+)/i) || id.match(/box_pc_(\d+)/i) || id.match(/_(\d{1,4})$/);
      if (idMatch) {
        const tableNum = parseInt(idMatch[2] || idMatch[1], 10);
        if (tableNum >= 501 && tableNum <= 599) return `(Sexy)Bac ${tableNum - 500}`;
        if (tableNum >= 101 && tableNum <= 199) return `(Classic)Bac ${tableNum - 100}`;
        if (tableNum >= 201 && tableNum <= 299) return `(Speed)Bac ${tableNum - 200}`;
        if (tableNum >= 301 && tableNum <= 399) return `(Mi)Bac ${tableNum - 300}`;
        if (tableNum >= 601 && tableNum <= 699) return `(Special)Bac ${tableNum - 600}`;
        if (tableNum >= 1 && tableNum <= 99) return `Bac ${tableNum}`;

        if (box) {
          const rawMatch = (box.textContent || '').match(/\b(?:Bac|Bàn)\s*0*([1-9]\d{0,3})\b/i);
          if (rawMatch) {
            const num = parseInt(rawMatch[1], 10);
            return `(Classic)Bac ${num}`;
          }
        }
        return `Bac ${tableNum}`;
      }
      return id;
    }

    return null;
  }

  // Trích xuất lịch sử cầu siêu nhẹ (Châu Bàn, Đại Lộ, SVG, Text - 0% CPU)
  function extractRoadHistory(box) {
    if (!box) return [];

    // LAYER 1: ZhuPan Road (Châu Bàn / Bead Road) - type61..type72
    try {
      const zhuPanNodes = box.querySelectorAll(
        '.zhuPanRoad [class*="type"], [class*="zhuPan"] [class*="type"], [class*="cardroad_item"] [class*="type"], [class*="type6"], [class*="type7"]'
      );
      if (zhuPanNodes && zhuPanNodes.length > 0) {
        const zhuPanReg = /\btype[_-]?(6[1-9]|7[0-2])\b/i;
        const validZhuPan = [];
        for (let i = 0; i < zhuPanNodes.length; i++) {
          const el = zhuPanNodes[i];
          const classStr = (typeof el.className === 'string') ? el.className : (el.classList ? Array.from(el.classList).join(' ') : '');
          const m = classStr.match(zhuPanReg);
          if (m) {
            const code = parseInt(m[1]);
            if (code >= 61 && code <= 64) validZhuPan.push('B');
            else if (code >= 65 && code <= 68) validZhuPan.push('P');
            else if (code >= 69 && code <= 72) validZhuPan.push('T');
          }
        }
        if (validZhuPan.length > 0) {
          return validZhuPan.slice(-24);
        }
      }
    } catch (e) {}

    // LAYER 2: DaLu Road (Đại Lộ / Big Road) - type1..type12
    try {
      const daLuNodes = box.querySelectorAll(
        '.daLuRoad [class*="type"], [class*="daLu"] [class*="type"], [class*="type1"], [class*="type2"], [class*="type3"], [class*="type4"], [class*="type5"]'
      );
      if (daLuNodes && daLuNodes.length > 0) {
        const daLuReg = /\btype[_-]?([1-9]|1[0-2])\b/i;
        const validDaLu = [];
        for (let i = 0; i < daLuNodes.length; i++) {
          const el = daLuNodes[i];
          const classStr = (typeof el.className === 'string') ? el.className : (el.classList ? Array.from(el.classList).join(' ') : '');
          const m = classStr.match(daLuReg);
          if (m) {
            const code = parseInt(m[1]);
            if (code >= 1 && code <= 4) validDaLu.push('B');
            else if (code >= 5 && code <= 8) validDaLu.push('P');
            else if (code >= 9 && code <= 12) validDaLu.push('T');
          }
        }
        if (validDaLu.length > 0) {
          return validDaLu.slice(-24);
        }
      }
    } catch (e) {}

    // LAYER 3: Semantic classes (banker, player, zhuang, xian, tie)
    try {
      const roadItems = box.querySelectorAll('[class*="road"] [class*="dot"], [class*="road"] [class*="item"], [class*="cardroad"] > *');
      if (roadItems && roadItems.length > 0) {
        const validSemantic = [];
        for (let i = 0; i < roadItems.length; i++) {
          const el = roadItems[i];
          const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
          if (cls.includes('banker') || cls.includes('zhuang') || cls.includes('red')) {
            validSemantic.push('B');
          } else if (cls.includes('player') || cls.includes('xian') || cls.includes('blue')) {
            validSemantic.push('P');
          } else if (cls.includes('tie') || cls.includes('he') || cls.includes('green')) {
            validSemantic.push('T');
          }
        }
        if (validSemantic.length > 0) return validSemantic.slice(-24);
      }
    } catch (e) {}

    // LAYER 4: SVG circles / rects / paths
    try {
      const svgDots = box.querySelectorAll('svg circle, svg rect, svg path');
      if (svgDots && svgDots.length > 0) {
        const validSvg = [];
        for (let i = 0; i < svgDots.length; i++) {
          const dot = svgDots[i];
          const fill = (dot.getAttribute ? dot.getAttribute('fill') : '') || '';
          const stroke = (dot.getAttribute ? dot.getAttribute('stroke') : '') || '';
          const cls = (dot.getAttribute ? dot.getAttribute('class') : '') || '';
          const f = (fill + ' ' + stroke + ' ' + cls).toLowerCase();

          if (f.includes('red') || f.includes('#ef') || f.includes('#b9') || f.includes('#dc') || f.includes('banker')) {
            validSvg.push('B');
          } else if (f.includes('blue') || f.includes('#3b') || f.includes('#1d') || f.includes('#25') || f.includes('player')) {
            validSvg.push('P');
          } else if (f.includes('green') || f.includes('#10') || f.includes('#16') || f.includes('tie')) {
            validSvg.push('T');
          }
        }
        if (validSvg.length > 0) return validSvg.slice(-24);
      }
    } catch (e) {}

    // LAYER 5: Text leaf nodes (dùng textContent, KHÔNG innerText)
    try {
      const textNodes = box.querySelectorAll('.zhuPanRoad span, .daLuRoad span, [class*="road"] span');
      if (textNodes && textNodes.length > 0) {
        const validText = [];
        for (let i = 0; i < textNodes.length; i++) {
          const node = textNodes[i];
          if (!node.children || node.children.length === 0) {
            const txt = (node.textContent || '').trim();
            if (txt === 'B' || txt === '庄') validText.push('B');
            else if (txt === 'P' || txt === '闲') validText.push('P');
            else if (txt === 'T' || txt === '和') validText.push('T');
          }
        }
        if (validText.length > 0) return validText.slice(-24);
      }
    } catch (e) {}

    return [];
  }

  // 1. Kiểm tra ID bàn chuẩn tuyệt đối (loại bỏ 100% thẻ con và hậu tố _BankerRate, _confirm, _cancel...)
  function isStrictTableId(id) {
    if (!id || typeof id !== 'string') return false;
    const clean = id.trim();
    if (/(?:_BankerRate|_PlayerRate|_TieRate|_confirm|_cancel|_alert|_prompt|_betArea|_header|_title|_time|_chip|_road|_status|_video|_dealer|_box|_mask|_canvas|_bet|_rate|_count|_close|_open)/i.test(clean)) {
      return false;
    }
    // Loại bỏ hoàn toàn mã bàn ảo 1415 hoặc bàn không hợp lệ
    if (clean.includes('1415') || clean.includes('invalid')) return false;

    // groupMultiple_<gameType>_<code>: Hỗ trợ 100% tất cả các bàn thực của WM Casino
    if (/^groupMultiple_\d+_\d+$/i.test(clean)) {
      const m = clean.match(/^groupMultiple_(\d+)_(\d+)$/i);
      if (m) {
        const code = parseInt(m[2], 10);
        return !isNaN(code) && code > 0;
      }
    }

    // box_pc_<num>
    if (/^box_pc_\d+$/i.test(clean)) {
      const m = clean.match(/^box_pc_(\d+)$/i);
      if (m) {
        const code = parseInt(m[1], 10);
        return !isNaN(code) && code > 0;
      }
    }

    // Bàn chuẩn có tiền tố baccarat (wm_sexy_bac_1..60, classic_bac_1..60, wm_bac_931..1363, ...)
    if (/^(?:wm_)?_?(?:sexy_|classic_|speed_|mi_|special_)?bac_?\d+$/i.test(clean)) {
      const m = clean.match(/\d+$/);
      if (m) {
        const num = parseInt(m[0], 10);
        return !isNaN(num) && num > 0 && num <= 2000;
      }
    }
    return false;
  }

  // 2. Kiểm tra bàn đóng / bảo trì (chỉ chọn lọc bàn đã mở ở sảnh này)
  function isTableClosedOrMaintenance(el) {
    if (!el) return true;
    const text = (el.textContent || '').toLowerCase();
    if (/(bảo trì|maintenance|tạm dừng|tạm đóng|ngưng phục vụ|closed)/i.test(text)) {
      return true;
    }
    if (/(chờ mở|sắp mở)/i.test(text)) {
      return true;
    }
    try {
      const statusEl = el.querySelector('.state, .status, [class*="state"], [class*="status"]');
      if (statusEl) {
        const stText = (statusEl.textContent || '').trim().toLowerCase();
        if (stText === 'đóng' || stText === 'close' || stText === 'closed' || stText === 'bảo trì') {
          return true;
        }
      }
    } catch (e) {}
    if (el.querySelector && el.querySelector('.maintain, .table-close, .is-close, [class*="mask-close"], .table-disabled, .room-disabled')) {
      return true;
    }
    return false;
  }

  // 3. Trích xuất thời gian đếm ngược chính xác tuyệt đối từ thẻ bàn
  function extractTableBetTime(box, tableNum) {
    if (!box) return 0;

    const fullText = box.textContent || '';
    if (/(ngừng cược|no more bet|đang chia|chờ ván mới|dealing|settle|kết toán)/i.test(fullText)) {
      return 0;
    }

    const rawDataTime = box.getAttribute('data-bettime') || box.getAttribute('data-time') || box.getAttribute('data-countdown') || box.getAttribute('data-cd');
    if (rawDataTime !== null && rawDataTime !== undefined && rawDataTime !== '') {
      const v = parseInt(rawDataTime);
      if (!isNaN(v) && v >= 0 && v <= 60) return v;
    }

    const timeSelectors = [
      '.time', '.timer', '.bet-time', '.count-down', '.countdown',
      '[class*="countdown"]', '[class*="count-down"]', '[class*="gameroom-time"]',
      '[class*="gameroom_time"]', '[id$="_time"]', '[id$="_timer"]', '[id$="_countdown"]',
      '.downtime', '[class*="downtime"]', '.second', '[class*="second"]', '.cd', '[class*="_cd"]'
    ];

    for (const sel of timeSelectors) {
      try {
        const el = box.querySelector(sel);
        if (el) {
          const txt = (el.textContent || '').trim();
          const m = txt.match(/^(\d{1,2})\s*s?$/i) || txt.match(/\b(\d{1,2})\s*s\b/i);
          if (m) {
            const val = parseInt(m[1]);
            if (!isNaN(val) && val >= 0 && val <= 60) return val;
          }
        }
      } catch (e) {}
    }

    try {
      const headerEl = box.querySelector('.gameroom-header, .gameroom_header, .header, [class*="header"], [class*="title"]') || box.firstElementChild;
      if (headerEl) {
        const allLeaves = headerEl.querySelectorAll('*');
        for (let i = allLeaves.length - 1; i >= 0; i--) {
          const el = allLeaves[i];
          if (el.children && el.children.length > 0) continue;
          const txt = (el.textContent || '').trim();
          const m = txt.match(/^(\d{1,2})\s*s?$/i);
          if (m) {
            const val = parseInt(m[1]);
            if (tableNum && val === tableNum && /(bac|bàn)/i.test(el.parentElement?.textContent || '')) {
              continue;
            }
            if (!isNaN(val) && val >= 0 && val <= 60) {
              return val;
            }
          }
        }
      }
    } catch (e) {}

    return 0;
  }

  // Trích xuất thông tin Shoe (Hộp bài) và Round (Số ván) từ thẻ bàn
  function extractTableRoundInfo(box) {
    if (!box) return { shoe: '0', round: 0 };
    const txt = (box.textContent || '').replace(/\s+/g, ' ');

    let shoe = '0';
    let round = 0;

    const serialMatch = txt.match(/(\d{6,14})\s*[\/\-]\s*(\d{1,3})/);
    if (serialMatch) {
      shoe = serialMatch[1];
      round = parseInt(serialMatch[2], 10);
    }

    const bMatch = txt.match(/Banker\s*(\d+)/i);
    const pMatch = txt.match(/Player\s*(\d+)/i);
    const tMatch = txt.match(/(?:Hòa|Hoa|Tie)\s*(\d+)/i);
    if (bMatch && pMatch) {
      const b = parseInt(bMatch[1], 10) || 0;
      const p = parseInt(pMatch[1], 10) || 0;
      const t = tMatch ? (parseInt(tMatch[1], 10) || 0) : 0;
      const completed = b + p + t;
      if (completed > 0 && (!round || round <= completed)) {
        round = completed + 1;
      }
    }

    return { shoe, round };
  }

  function getTables(messageId) {
    try {
      const allDocs = getAllTargetDocs();
      const currentScanFoundIds = new Set();
      const isBotElement = (el) => {
        if (!el || !el.closest) return false;
        return !!(el.closest('#wm-auto-helper-overlay') || el.closest('#wm-auto-mini-pill') || el.closest('.wm-table-card'));
      };

      for (const doc of allDocs) {
        if (!doc || !doc.body) continue;

      // PHƯƠNG ÁN 1 (CONTAINER-FIRST): Quét trực tiếp các container bàn chuẩn WM Casino
      // CHỈ lấy container bàn thực thụ, TUYỆT ĐỐI BỎ QUA mọi thẻ con bên trong
      // Loại bỏ hoàn toàn selector [id^="groupMultiple_"] tổng quát để tránh dính 500+ thẻ con (_BankerRate, _confirm...)
      const rawCandidates = doc.querySelectorAll(
        '.gameroom-box.multiSelectContentItem, .gameroom-box, [class*="gameroom-box"], [class*="gameroom_box"], [class*="gameroom-item"], [id^="groupMultiple_"], [id^="box_pc_"], #pc_multi_bet_tablebox > div, [class*="table-box"]'
      );
      const candidateElements = Array.from(rawCandidates).filter(box => {
        if (!box) return false;
        const id = (box.id || '').trim();
        if (id && !isStrictTableId(id)) return false;
        return true;
      });

      if (candidateElements && candidateElements.length > 0) {
        for (let i = 0; i < candidateElements.length; i++) {
          const box = candidateElements[i];
          if (isBotElement(box)) continue;

          // BỎ QUA NẾU NẰM BÊN TRONG MỘT CONTAINER BÀN KHÁC (loại bỏ hoàn toàn thẻ con)
          const parentTable = box.parentElement ? box.parentElement.closest('.gameroom-box.multiSelectContentItem, .gameroom-box, [class*="gameroom-box"], [id^="groupMultiple_"], [id^="box_pc_"]') : null;
          if (parentTable && parentTable !== box) continue;

          const rawId = (box.id || '').trim();

          // Nếu có ID, phải khớp chuẩn bàn (loại bỏ hoàn toàn _BankerRate, _confirm, _cancel...)
          if (rawId && !isStrictTableId(rawId)) continue;

          // Lọc bàn: Chỉ lấy các bàn ở sảnh này đã mở (bỏ qua bàn đóng / bảo trì)
          if (isTableClosedOrMaintenance(box)) continue;

          // Trích xuất tên bàn thân thiện
          const friendlyName = extractTableName(box, rawId);
          if (!friendlyName) continue;

          // Xác định ID chuẩn duy nhất
          let tableId = rawId;
          if (!tableId || !isStrictTableId(tableId)) {
            tableId = friendlyName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          }
          if (!isStrictTableId(tableId)) continue;

          const history = extractRoadHistory(box);
          const betTime = extractTableBetTime(box);
          const roundInfo = extractTableRoundInfo(box);

          currentScanFoundIds.add(tableId);
          cachedTablesMap.set(tableId, {
            id: tableId,
            name: friendlyName,
            betTime: betTime,
            history: history,
            shoe: roundInfo.shoe,
            round: roundInfo.round
          });
        }
      }

      // PHƯƠNG ÁN 2 (BỔ SUNG CHO MỌI BÀN CÒN LẠI DỰA THEO TIÊU ĐỀ BÀN):
      const titleRegex = /(?:(?:\(([^)]+)\)|(Classic|Sexy|Speed|Mi|Special))\s*)?(?:Bac(?:carat)?|Bàn|百家乐|Table|Room)\s*0*([1-9]\d{0,3})\b/i;
      const targetedNodes = doc.querySelectorAll('.gameroom-header-title, .gameroom-title, .table-name, [class*="gameroom-title"], [class*="table-name"], [class*="tableName"], .room_title, span, div, b, p, h1, h2, h3, h4, [class*="title"], [class*="name"], [class*="room"]');

      for (let i = 0; i < targetedNodes.length; i++) {
        const el = targetedNodes[i];
        if (isBotElement(el)) continue;
        if (el.children && el.children.length > 0) continue; // Chỉ xét leaf node
        const txt = (el.textContent || '').trim();
        const m = txt.match(titleRegex);
        if (m) {
          let grp = m[1] || m[2] || '';
          let tableNum = parseInt(m[3], 10);
          if (tableNum >= 501 && tableNum <= 599) {
            if (!grp) grp = 'Sexy';
            tableNum = tableNum - 500;
          } else if (tableNum >= 101 && tableNum <= 199) {
            if (!grp) grp = 'Classic';
            tableNum = tableNum - 100;
          } else if (tableNum >= 201 && tableNum <= 299) {
            if (!grp) grp = 'Speed';
            tableNum = tableNum - 200;
          } else if (tableNum >= 301 && tableNum <= 399) {
            if (!grp) grp = 'Mi';
            tableNum = tableNum - 300;
          } else if (tableNum >= 601 && tableNum <= 699) {
            if (!grp) grp = 'Special';
            tableNum = tableNum - 600;
          } else if (tableNum > 25 && tableNum < 100 && tableNum % 10 !== 0) {
            const candidate = Math.floor(tableNum / 10);
            if (candidate >= 1 && candidate <= 25) tableNum = candidate;
          }
          if (tableNum < 1 || tableNum > 2000) continue;

          const groupName = grp ? `(${grp.charAt(0).toUpperCase() + grp.slice(1).toLowerCase()})` : '';
          const cleanTitle = groupName ? `${groupName}Bac ${tableNum}` : `Bac ${tableNum}`;
          const foundCard = el.closest ? el.closest('[id^="groupMultiple_"], [id^="box_pc_"], .gameroom-box, [class*="gameroom-box"], [class*="gameroom_box"], [class*="gameroom-item"], [class*="table-box"], [class*="room"]') : null;

          if (foundCard && !isBotElement(foundCard)) {
            if (isTableClosedOrMaintenance(foundCard)) continue;
            const rawId = (foundCard.id || '').trim();
            let cleanId = rawId && isStrictTableId(rawId) ? rawId : cleanTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            if (!isStrictTableId(cleanId)) continue;

            const history = extractRoadHistory(foundCard);
            const betTime = extractTableBetTime(foundCard);
            const roundInfo = extractTableRoundInfo(foundCard);
            currentScanFoundIds.add(cleanId);
            cachedTablesMap.set(cleanId, {
              id: cleanId,
              name: cleanTitle,
              betTime: betTime,
              history: history,
              shoe: roundInfo.shoe,
              round: roundInfo.round
            });
          }
        }
      }

      } // End for (const doc of allDocs)

      // XÓA BỎ BÀN KHÔNG HỢP LỆ HOẶC 1415 (GIỮ NGUYÊN TOÀN BỘ BÀN TRONG SẢNH DÙ CUỘN MÀN HÌNH)
      for (const [key, t] of cachedTablesMap.entries()) {
        const name = t?.name || '';
        const combined = `${key} ${name}`;
        if (!isStrictTableId(key) || combined.includes('1415') || combined.includes('invalid')) {
          cachedTablesMap.delete(key);
        }
      }

      const isValidIframeTable = (t) => {
        if (!t || !t.id) return false;
        const comb = `${t.id} ${t.name || ''}`;
        return isStrictTableId(t.id) && !comb.includes('1415') && !comb.includes('invalid');
      };

      const tables = Array.from(cachedTablesMap.values()).filter(isValidIframeTable);
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        tables: tables,
        totalDetected: tables.length
      }, '*');
    } catch (err) {
      const isValidIframeTable = (t) => {
        if (!t || !t.id) return false;
        const comb = `${t.id} ${t.name || ''}`;
        return isStrictTableId(t.id) && !comb.includes('1415') && !comb.includes('invalid');
      };
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        tables: Array.from(cachedTablesMap.values()).filter(isValidIframeTable),
        error: err.message
      }, '*');
    }
  }

  function dispatchFullClickSequence(element) {
    if (!element) return;
    try { element.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' }); } catch (e) {}

    const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 0, top: 0, width: 10, height: 10 };
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);
    const win = element.ownerDocument?.defaultView || window;
    const eventInit = { bubbles: true, cancelable: true, view: win, clientX, clientY };

    try { element.dispatchEvent(new PointerEvent('pointerover', eventInit)); } catch (e) {}
    try { element.dispatchEvent(new PointerEvent('pointerenter', eventInit)); } catch (e) {}
    try { element.dispatchEvent(new PointerEvent('pointerdown', eventInit)); } catch (e) {}
    try { element.dispatchEvent(new MouseEvent('mousedown', eventInit)); } catch (e) {}
    try { element.dispatchEvent(new PointerEvent('pointerup', eventInit)); } catch (e) {}
    try { element.dispatchEvent(new MouseEvent('mouseup', eventInit)); } catch (e) {}
    try {
      if (typeof Touch !== 'undefined' && typeof TouchEvent !== 'undefined') {
        const touch = new Touch({ identifier: Date.now(), target: element, clientX, clientY });
        element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
        element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
      }
    } catch (e) {}
    try { element.click(); } catch (e) {}
  }

  function clickBetZone(tableId, bet, messageId, candidateIds = []) {
    try {
      const now = Date.now();
      const lastClick = iframeBetCooldown.get(tableId) || 0;
      if (now - lastClick < 2000) {
        sendToParent({
          type: 'WM_IFRAME_RESPONSE',
          action: 'CLICK_BET_ZONE',
          messageId: messageId,
          success: false,
          tableId: tableId,
          bet: bet,
          skipped: true,
          reason: 'DEBOUNCE_COOLDOWN'
        }, '*');
        return;
      }

      const targetDocs = [getTargetDoc()];
      if (!targetDocs.includes(document)) targetDocs.push(document);
      const childIframes = Array.from(document.querySelectorAll('iframe'));
      for (const ifr of childIframes) {
        try {
          const d = ifr.contentDocument || ifr.contentWindow?.document;
          if (d && !targetDocs.includes(d)) targetDocs.push(d);
        } catch (e) {}
      }

      const betSuffix = bet === 'B' ? 'Banker' : 'Player';
      const allCandidates = Array.isArray(candidateIds) ? [...candidateIds] : [];
      if (tableId && !allCandidates.includes(tableId)) allCandidates.unshift(tableId);

      const numMatch = (tableId || '').match(/\b(\d+)\b/);
      if (numMatch) {
        const n = parseInt(numMatch[1], 10);
        if (!isNaN(n) && n > 0) {
          const baseNum = (n >= 501 && n <= 599) ? (n - 500) : ((n >= 101 && n <= 199) ? (n - 100) : ((n >= 201 && n <= 299) ? (n - 200) : ((n >= 301 && n <= 399) ? (n - 300) : ((n >= 601 && n <= 699) ? (n - 600) : n))));
          [baseNum, String(baseNum).padStart(2, '0'), 100 + baseNum, 200 + baseNum, 300 + baseNum, 500 + baseNum, 600 + baseNum].forEach(num => {
            [0, 1, 101].forEach(gt => {
              allCandidates.push(`groupMultiple_${gt}_${num}`);
            });
            allCandidates.push(`box_pc_${num}`);
          });
        }
      }

      // 1. Tìm thẻ bàn (Card) đích xác theo ID, canonicalId, hoặc tableNum (H5 / c168)
      let targetCard = null;
      for (const doc of targetDocs) {
        if (!doc) continue;
        for (const cid of allCandidates) {
          if (!cid) continue;
          targetCard = doc.querySelector(`[data-wm-table-id="${cid}"], [data-wm-canonical-id="${cid}"], #${cid}`);
          if (targetCard) break;
        }
        if (!targetCard) {
          const numMatch = (tableId || '').match(/\b(\d+)\b/);
          if (numMatch) {
            targetCard = doc.querySelector(`[data-wm-table-num="${numMatch[1]}"]`);
          }
        }
        if (targetCard) break;
      }

      // 1.1 Tìm thẻ bàn bổ sung qua tiêu đề bàn nếu querySelector theo ID chưa thấy
      if (!targetCard) {
        const numMatch = (tableId || '').match(/\b(\d+)\b/);
        const targetNum = numMatch ? parseInt(numMatch[1], 10) : null;
        if (targetNum) {
          const baseNum = (targetNum >= 501 && targetNum <= 599) ? (targetNum - 500) : ((targetNum >= 101 && targetNum <= 199) ? (targetNum - 100) : ((targetNum >= 201 && targetNum <= 299) ? (targetNum - 200) : ((targetNum >= 301 && targetNum <= 399) ? (targetNum - 300) : ((targetNum >= 601 && targetNum <= 699) ? (targetNum - 600) : targetNum))));
          for (const doc of targetDocs) {
            if (!doc) continue;
            const titleNodes = doc.querySelectorAll('.gameroom-header-title, .gameroom-title, .gameroom_title, .gameroom_name, .table-name, .table_name, .tableName, .title, .room_title, .room-title, [class*="gameroom-title"], [class*="table-name"], [class*="tableName"], [class*="room_title"]');
            for (let i = 0; i < titleNodes.length; i++) {
              const el = titleNodes[i];
              const txt = (el.textContent || '').trim();
              const tm = txt.match(/(?:Bac(?:carat)?|Bàn|百家乐|Table|Room)?\s*0*(\d{1,3})\b/i);
              if (tm) {
                let parsedNum = parseInt(tm[1], 10);
                if (parsedNum >= 501 && parsedNum <= 599) parsedNum -= 500; else if (parsedNum >= 101 && parsedNum <= 199) parsedNum -= 100; else if (parsedNum >= 201 && parsedNum <= 299) parsedNum -= 200; else if (parsedNum >= 301 && parsedNum <= 399) parsedNum -= 300; else if (parsedNum >= 601 && parsedNum <= 699) parsedNum -= 600;
                if (parsedNum === baseNum || parsedNum === targetNum) {
                  targetCard = el.closest('.gameroom-box, [class*="gameroom-box"], [class*="gameroom_box"], [id^="groupMultiple_"], [id^="box_pc_"], [class*="table-box"], [class*="gameroom-item"], [class*="room"], #pc_multi_bet_tablebox > div');
                  if (targetCard) break;
                }
              }
            }
            if (targetCard) break;
          }
        }
      }

      // 1.2 Tìm trực tiếp nút cược qua candidate IDs nếu chưa thấy targetCard
      let directBetArea = null;
      if (!targetCard) {
        for (const doc of targetDocs) {
          if (!doc) continue;
          for (const cid of allCandidates) {
            if (!cid) continue;
            const directBtn = (doc.getElementById ? doc.getElementById(`${cid}_betArea${betSuffix}`) : null) ||
                              (doc.getElementById ? doc.getElementById(`${cid}_betArea_${betSuffix}`) : null) ||
                              (doc.querySelector ? doc.querySelector(`#${cid}_betArea${betSuffix}, #${cid}_betArea_${betSuffix}, #${cid} [id*="betArea${betSuffix}"], #${cid} [class*="betArea${betSuffix}"], #${cid} [data-bet="${betSuffix}"]`) : null);
            if (directBtn) {
              targetCard = directBtn.closest('.gameroom-box, [class*="gameroom-box"], [id^="groupMultiple_"], [id^="box_pc_"], [class*="room"]') || directBtn.parentElement;
              directBetArea = directBtn;
              break;
            }
          }
          if (targetCard) break;
        }
      }

      // TUYỆT ĐỐI KHÔNG CLICK NẾU KHÔNG XÁC ĐỊNH ĐƯỢC ĐÚNG THẺ BÀN CỤ THỂ
      // (Ngăn chặn 100% việc rơi về click nhầm bàn khác hoặc cược 2 đầu Player/Banker cùng bàn)
      if (!targetCard) {
        sendToParent({
          type: 'WM_IFRAME_RESPONSE',
          action: 'CLICK_BET_ZONE',
          messageId: messageId,
          success: false,
          tableId: tableId,
          bet: bet,
          error: 'TARGET_TABLE_NOT_FOUND'
        }, '*');
        return;
      }

      // CHỐNG CƯỢC 2 ĐẦU / ĐỐI NGHỊCH: Kiểm tra cửa đối diện trên bàn
      const oppositeSuffix = bet === 'B' ? 'Player' : 'Banker';
      let oppArea = null;
      for (const cid of allCandidates) {
        if (!cid) continue;
        oppArea = targetCard.querySelector(`#${cid}_betArea${oppositeSuffix}`);
        if (oppArea) break;
      }
      if (!oppArea) {
        oppArea = targetCard.querySelector(
          `[id$="_betArea${oppositeSuffix}"], [id*="_betArea${oppositeSuffix}"], .betArea${oppositeSuffix}, ` +
          `[class*="betArea${oppositeSuffix}"], [class*="betArea_${oppositeSuffix}"], [data-bet="${oppositeSuffix}"]`
        );
      }
      if (oppArea) {
        const oppChip = oppArea.querySelector('[class*="chip"], [class*="badge"], [class*="bet-num"], [class*="coin"], [class*="amount"], img[src*="chip"], svg circle');
        let hasOppBet = !!oppChip;
        if (!hasOppBet) {
          const oppSpans = oppArea.querySelectorAll('span, div, b');
          for (let i = 0; i < oppSpans.length; i++) {
            const sp = oppSpans[i];
            if (sp.children && sp.children.length > 0) continue;
            const txt = (sp.textContent || '').trim();
            if (/^(?:1:0\.95|1:1|0\.95|banker|player|cái|con)$/i.test(txt)) continue;
            if (/^[1-9]\d{0,6}[kK]?$/.test(txt)) {
              hasOppBet = true;
              break;
            }
          }
        }
        if (hasOppBet) {
          sendToParent({
            type: 'WM_IFRAME_RESPONSE',
            action: 'CLICK_BET_ZONE',
            messageId: messageId,
            success: false,
            tableId: tableId,
            bet: bet,
            skipped: true,
            reason: 'ANTI_HEDGE_TRIGGERED'
          }, '*');
          return;
        }
      }

      // CHỐNG CƯỢC ĐÈ / CƯỢC LẶP: Kiểm tra xem chính cửa này đã có chip trên bàn chưa
      let sameArea = null;
      for (const cid of allCandidates) {
        if (!cid) continue;
        sameArea = targetCard.querySelector(`#${cid}_betArea${betSuffix}`);
        if (sameArea) break;
      }
      if (!sameArea) {
        sameArea = targetCard.querySelector(
          `[id$="_betArea${betSuffix}"], [id*="_betArea${betSuffix}"], .betArea${betSuffix}, ` +
          `[class*="betArea${betSuffix}"], [class*="betArea_${betSuffix}"], [data-bet="${betSuffix}"]`
        );
      }
      if (sameArea) {
        const sameChip = sameArea.querySelector('[class*="chip"], [class*="badge"], [class*="bet-num"], [class*="coin"], [class*="amount"], img[src*="chip"], svg circle');
        let hasSameBet = !!sameChip;
        if (!hasSameBet) {
          const sameSpans = sameArea.querySelectorAll('span, div, b');
          for (let i = 0; i < sameSpans.length; i++) {
            const sp = sameSpans[i];
            if (sp.children && sp.children.length > 0) continue;
            const txt = (sp.textContent || '').trim();
            if (/^(?:1:0\.95|1:1|0\.95|banker|player|cái|con)$/i.test(txt)) continue;
            if (/^[1-9]\d{0,6}[kK]?$/.test(txt)) {
              hasSameBet = true;
              break;
            }
          }
        }
        if (hasSameBet) {
          sendToParent({
            type: 'WM_IFRAME_RESPONSE',
            action: 'CLICK_BET_ZONE',
            messageId: messageId,
            success: true,
            tableId: tableId,
            bet: bet,
            skipped: true,
            reason: 'ALREADY_PLACED'
          }, '*');
          return;
        }
      }

      // CHỈ TÌM NÚT CƯỢC BÊN TRONG BÀN NÀY (TUYỆT ĐỐI KHÔNG TÌM NGOÀI TOÀN TRANG)
      const searchRoots = [targetCard];
      let betArea = directBetArea;

      if (!betArea) {
        for (const root of searchRoots) {
          if (!root) continue;

          // A. Thử theo danh sách Candidate IDs: root.getElementById / root.querySelector
          for (const cid of allCandidates) {
            if (!cid) continue;
            try {
              betArea = (root.getElementById ? root.getElementById(`${cid}_betArea${betSuffix}`) : null) ||
                        (root.querySelector ? root.querySelector(`#${cid}_betArea${betSuffix}`) : null);
              if (betArea) break;
            } catch (e) {}
          }
          if (betArea) break;

          // B. Thử theo XPath người dùng cung cấp
          if (root.evaluate) {
            for (const cid of allCandidates) {
              if (!cid) continue;
              try {
                const res = root.evaluate(`(//*[@id='${cid}_betArea${betSuffix}'])[1]`, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                if (res && res.singleNodeValue) {
                  betArea = res.singleNodeValue;
                  break;
                }
              } catch (e) {}
            }
            if (betArea) break;
          }

          // C. Thử theo selector class & attribute chuẩn WM Casino / H5
          try {
            betArea = root.querySelector(
              `[id$="_betArea${betSuffix}"], [id*="_betArea${betSuffix}"], .betArea${betSuffix}, ` +
              `[class*="betArea${betSuffix}"], [class*="betArea_${betSuffix}"], ` +
              `[class*="area-${betSuffix.toLowerCase()}"], [class*="area_${betSuffix.toLowerCase()}"], ` +
              `[class*="bet-${betSuffix.toLowerCase()}"], [class*="bet_${betSuffix.toLowerCase()}"], ` +
              `[data-bet="${betSuffix}"], [data-bet="${bet}"], [data-type="${betSuffix.toLowerCase()}"], [data-area="${betSuffix.toLowerCase()}"]`
            );
            if (betArea) break;
          } catch (e) {}

          // D. Tìm theo văn bản và tỷ lệ cược đa ngôn ngữ (H5 / c168: Banker/Player, Cái/Con, 庄/闲, 1:0.95/1:1)
          try {
            const candidateNodes = root.querySelectorAll('span, div, b, p, button, a, [class*="btn"], [class*="item"]');
            for (const el of candidateNodes) {
              if (el.children && el.children.length > 0) continue;
              const txt = (el.innerText || el.textContent || '').trim();
              if (!txt) continue;
              if (/pair|đôi|对子|tie|hòa|和/i.test(txt) || /pair|đôi|tie|hoa/i.test(el.className || '') || /pair|đôi|tie|hoa/i.test(el.id || '')) continue;

              let isMatch = false;
              if (bet === 'B') {
                if (/^(?:Banker|Nhà\s*Cái|Cái|庄|莊)(?:\s*1:0\.95)?$/i.test(txt) || txt === '1:0.95' || txt === '0.95') {
                  isMatch = true;
                }
              } else {
                if (/^(?:Player|Nhà\s*Con|Con|闲|閒)(?:\s*1:1)?$/i.test(txt) || txt === '1:1') {
                  isMatch = true;
                }
              }

              if (isMatch) {
                betArea = (el.closest ? el.closest('[id*="betArea"], [class*="bet"], [class*="area"], button, [role="button"]') : null) || el.parentElement || el;
                break;
              }
            }
            if (betArea) break;
          } catch (e) {}
        }
      }

      if (betArea) {
        iframeBetCooldown.set(tableId, Date.now());
        dispatchFullClickSequence(betArea);

        // Bấm nút confirm nếu có
        try {
          const docOwner = betArea.ownerDocument || document;
          const searchContainer = targetCard || docOwner;
          const confirmBtn = (searchContainer.querySelector ? searchContainer.querySelector('[id*="confirm"], .confirm, .btn-confirm, [class*="confirm"], [class*="btn_ok"], [class*="btn-bet"]') : null) ||
            (docOwner.querySelector ? docOwner.querySelector('[id*="confirm"], .confirm, .btn-confirm, [class*="confirm"], [class*="btn_ok"], [class*="btn-bet"]') : null);
          if (confirmBtn) {
            setTimeout(() => {
              dispatchFullClickSequence(confirmBtn);
            }, 100);
          }
        } catch (e) {}

        sendToParent({
          type: 'WM_IFRAME_RESPONSE',
          action: 'CLICK_BET_ZONE',
          messageId: messageId,
          success: true,
          tableId: tableId,
          bet: bet
        }, '*');
      } else {
        sendToParent({
          type: 'WM_IFRAME_RESPONSE',
          action: 'CLICK_BET_ZONE',
          messageId: messageId,
          success: false,
          error: 'Bet area not found'
        }, '*');
      }
    } catch (err) {
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        action: 'CLICK_BET_ZONE',
        messageId: messageId,
        success: false,
        error: err.message
      }, '*');
    }
  }

  function clickConfirm(tableId, messageId) {
    try {
      const doc = getTargetDoc();
      const confirmBtnId = tableId + '_confirm';
      let confirmBtn = doc.getElementById(confirmBtnId);

      if (!confirmBtn) {
        confirmBtn = doc.querySelector('[id*="confirm"], .confirm, .btn-confirm, [class*="confirm"], [class*="ok"]');
      }

      if (confirmBtn) {
        confirmBtn.click();
        sendToParent({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: true,
          tableId: tableId
        }, '*');
      } else {
        sendToParent({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: true,
          tableId: tableId
        }, '*');
      }
    } catch (err) {
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        success: false,
        error: err.message
      }, '*');
    }
  }

  // ==========================================================================
  // HỆ THỐNG CHỌN & XÁC MINH CHIP ĐA TẦNG (MULTI-LAYER VERIFIED CHIP SELECTOR)
  // Thực hiện đúng 5 nguyên tắc:
  // 1. Chỉ phát 1 lần click thật (không dispatch mousedown, mouseup kép)
  // 2. Không quét đệ quy các iframe con
  // 3. Bỏ qua nếu iframe hiện tại đang ẩn (display: none, width=0)
  // 4. Sau khi click, kiểm tra class 'on' trên phần tử chip
  // 5. Nếu chưa active thì báo lỗi, tuyệt đối không click lặp lại
  // ==========================================================================
  function isVisibleAndInteractable(el) {
    if (!el || !el.getBoundingClientRect) return false;
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const win = el.ownerDocument?.defaultView || window;
      const style = win.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function getChipVariants(chipStr) {
    const variants = [chipStr];
    if (chipStr === '1') variants.push('01');
    if (chipStr === '5') variants.push('05');
    if (chipStr === '1000') variants.push('1k', '1K');
    if (chipStr === '5000') variants.push('5k', '5K');
    if (chipStr === '10000') variants.push('10k', '10K');
    if (chipStr === '20000') variants.push('20k', '20K');
    if (chipStr === '50000') variants.push('50k', '50K');
    return variants;
  }

  function findValidVisibleChip(doc, chipStr) {
    if (!doc) return null;
    const variants = getChipVariants(chipStr);

    // 1. ƯU TIÊN SỐ 1: Khung chuẩn WM: #mult_chips_box (lobby đa bàn) hoặc #chip_box (bàn đơn)
    try {
      const box = doc.getElementById('mult_chips_box') || doc.getElementById('chip_box') || doc.querySelector('.chip_box');
      if (box) {
        for (const val of variants) {
          const chip = box.querySelector(`[name="${val}"], .chip_b_${val}`);
          if (chip && isVisibleAndInteractable(chip)) return chip;
        }
        for (const val of variants) {
          const chip = box.querySelector(`[name="${val}"], .chip_b_${val}`);
          if (chip) return chip;
        }
      }
    } catch (e) {}

    // 2. XPath chuẩn: (//div[@name='${val}'])[1]
    for (const val of variants) {
      try {
        const xpath = `(//div[@name='${val}'])[1]`;
        const res = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res && res.singleNodeValue && isVisibleAndInteractable(res.singleNodeValue)) return res.singleNodeValue;
      } catch (e) {}

      try {
        const xpath = `(//*[@name='${val}'])[1]`;
        const res = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res && res.singleNodeValue && isVisibleAndInteractable(res.singleNodeValue)) return res.singleNodeValue;
      } catch (e) {}
    }

    // 3. CSS querySelector
    for (const val of variants) {
      try {
        const el = doc.querySelector(`.chip_item[name="${val}"], div[name="${val}"], [name="${val}"], .chip_b_${val}`);
        if (el && isVisibleAndInteractable(el)) return el;
      } catch (e) {}
    }

    return null;
  }

  function checkChipActive(doc, chipStr) {
    if (!doc) return false;
    const box = doc.getElementById('mult_chips_box') || doc.getElementById('chip_box') || doc.querySelector('.chip_box');
    if (!box) return false;

    const activeChip = box.querySelector('.chip_item.on, .on');
    if (!activeChip) return false;

    // 1. Kiểm tra qua attribute name (chế độ lobby #mult_chips_box)
    const nameVal = activeChip.getAttribute('name');
    if (nameVal && String(nameVal) === chipStr) return true;

    // 2. Kiểm tra qua class chip_b_ (chế độ bàn chơi #chip_box)
    const variants = getChipVariants(chipStr);
    for (const v of variants) {
      if (activeChip.classList.contains(`chip_b_${v}`)) return true;
    }

    // 3. Kiểm tra qua dataset
    if (activeChip.dataset && (activeChip.dataset.value === chipStr || activeChip.dataset.chip === chipStr)) {
      return true;
    }

    return false;
  }

  function simulateRealClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
    } catch (e) {}

    // Chỉ phát đúng 1 lần click thật, không gọi cả mousedown, mouseup liên tiếp
    try {
      el.click();
    } catch (e) {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } catch (err) {}
    }
  }

  function selectChip(chipValue, messageId) {
    try {
      // 1. Nếu iframe hiện tại đang ẩn (display: none, width=0), bỏ qua không xử lý
      if (window.frameElement) {
        try {
          const style = window.parent.getComputedStyle(window.frameElement);
          if (style.display === 'none' || style.visibility === 'hidden' || window.frameElement.offsetWidth === 0) {
            return false;
          }
        } catch (e) {}
      }

      const chipStr = String(chipValue);
      const doc = document;
      const chipEl = findValidVisibleChip(doc, chipStr);

      if (!chipEl) {
        // Chỉ thông báo lỗi nếu iframe này có chứa thanh chip
        const hasBox = doc.getElementById('mult_chips_box') || doc.getElementById('chip_box') || doc.querySelector('.chip_box');
        if (hasBox) {
          sendToParent({
            type: 'WM_IFRAME_RESPONSE',
            messageId: messageId,
            action: 'SELECT_CHIP',
            success: false,
            chip: chipStr,
            error: `Không tìm thấy chip ${chipStr} trên thanh chọn`
          }, '*');
        }
        return false;
      }

      // 2. Phát đúng một lần click thật lên phần tử chip
      dispatchFullClickSequence(chipEl);

      // 3. Chờ game xử lý click rồi kiểm tra trạng thái active (class on)
      setTimeout(() => {
        const isActive = checkChipActive(doc, chipStr);
        if (isActive) {
          sendToParent({
            type: 'WM_IFRAME_RESPONSE',
            messageId: messageId,
            action: 'SELECT_CHIP',
            success: true,
            chip: chipStr
          }, '*');
        } else {
          // Báo lỗi chip chưa active, tuyệt đối KHÔNG tự click lặp vô hạn
          sendToParent({
            type: 'WM_IFRAME_RESPONSE',
            messageId: messageId,
            action: 'SELECT_CHIP',
            success: false,
            chip: chipStr,
            error: `Chip ${chipStr} chưa nhận trạng thái active (chưa có class 'on')`
          }, '*');
        }
      }, 180);

      return true;
    } catch (err) {
      sendToParent({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        action: 'SELECT_CHIP',
        success: false,
        chip: chipValue,
        error: err.message
      }, '*');
      return false;
    }
  }

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const sidVal = urlParams.get('sid') || (window.location.href.match(/[?&]sid=([^&#]+)/) || [])[1];
    if (sidVal) {
      sendToParent({
        type: 'WM_GATEWAY_CREDENTIALS',
        sid: decodeURIComponent(sidVal),
        gatewayUrl: window.location.origin + '/api/web/Gateway.php'
      }, '*');
    }
  } catch (e) {}

  sendToParent({
    type: 'WM_IFRAME_READY',
    url: window.location.href
  }, '*');

  // Tự động quét bàn ngay khi tải và định kỳ để luôn giữ kết nối với trang cha
  setTimeout(() => { try { getTables(0); } catch (e) {} }, 300);
  setTimeout(() => { try { getTables(0); } catch (e) {} }, 1200);
  setTimeout(() => { try { getTables(0); } catch (e) {} }, 2500);

  setInterval(() => {
    try {
      if (cachedTablesMap.size > 0 || document.querySelector('.gameroom-box, [id^="groupMultiple_"], [id^="box_pc_"], [class*="gameroom"]')) {
        getTables(0);
      }
    } catch (e) {}
  }, 3000);

})();
