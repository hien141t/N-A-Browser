// ======= 58WWIN Automation Content Script ======= //

function generateRandomString(length) {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) result += characters.charAt(Math.floor(Math.random() * characters.length));
    return result;
}

function getNextUserNumber() {
    let count = localStorage.getItem('auto_reg_user_count_58wwin') || 0;
    count = parseInt(count) + 1;
    localStorage.setItem('auto_reg_user_count_58wwin', count);
    return count;
}

function delay(ms) { 
    return new Promise(resolve => setTimeout(resolve, ms)); 
}

// Hàm gán giá trị tương thích sâu với React & Vue 3 v-model
function setNativeValue(element, value) {
    if (!element) return;
    try {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        
        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else if (valueSetter) {
            valueSetter.call(element, value);
        } else {
            element.value = value;
        }
    } catch(e) {
        element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

function simulateInput(element, value) {
    if (!element) return;
    setNativeValue(element, value);
}

async function typeHumanLike(element, value) {
    if (!element) return;
    try {
        element.focus();
        element.style.outline = '2px solid #10b981';
    } catch(e) {}
    
    setNativeValue(element, '');
    await delay(40);
    
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        setNativeValue(element, value.substring(0, i + 1));
        element.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
        await delay(Math.floor(Math.random() * 35) + 20);
    }
    
    setNativeValue(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    
    try {
        element.blur();
    } catch(e) {}
}

function getElementByXpath(path) {
    try { 
        return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; 
    } catch(e) { 
        return null; 
    }
}

function getVirtualKey(digit, keyboardIndex = 1) {
    const byXpath = getElementByXpath(`(//div[@role='button'][normalize-space()='${digit}'])[${keyboardIndex}]`);
    if (byXpath) return byXpath;

    const visibleKeys = Array.from(document.querySelectorAll('div[role="button"]'))
        .filter(el => el.textContent.trim() === digit && el.offsetParent !== null);
    if (visibleKeys.length >= keyboardIndex) return visibleKeys[keyboardIndex - 1];
    if (visibleKeys.length > 0) return visibleKeys[0];

    return getElementByXpath(`(//div[normalize-space()='${digit}'])[${keyboardIndex}]`);
}

const simulateKeyboardClick = (element) => {
    if (!element) return false;
    try { element.click(); } catch(e) {}
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    let topmostEl = document.elementFromPoint(x, y);
    if (!topmostEl) topmostEl = element;
    ['touchstart', 'touchend'].forEach(type => {
        const touch = new Touch({ identifier: Date.now(), target: topmostEl, clientX: x, clientY: y, radiusX: 2.5, radiusY: 2.5, rotationAngle: 10, force: 0.5 });
        topmostEl.dispatchEvent(new TouchEvent(type, { cancelable: true, bubbles: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
    });
    ['mousedown', 'mouseup', 'click'].forEach(type => topmostEl.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })));
    try {
        ['pointerdown', 'pointerup'].forEach(type => topmostEl.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse" })));
    } catch(e) {}
    if (topmostEl !== element) {
        ['mousedown', 'mouseup', 'click'].forEach(type => element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })));
    }
    return true;
};

function showCredentialsFloatingCard(username, password) {
    if (document.getElementById('wwin58-cred-card')) return;

    const card = document.createElement('div');
    card.id = 'wwin58-cred-card';
    card.style.position = 'fixed';
    card.style.top = '20px';
    card.style.right = '20px';
    card.style.zIndex = '999999';
    card.style.backgroundColor = 'rgba(30, 30, 40, 0.95)';
    card.style.backdropFilter = 'blur(10px)';
    card.style.color = '#fff';
    card.style.padding = '15px';
    card.style.borderRadius = '12px';
    card.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
    card.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    card.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    card.style.minWidth = '240px';
    card.style.transition = 'all 0.3s ease';

    card.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 12px; font-size: 14px; color: #4CAF50; display: flex; justify-content: space-between; align-items: center;">
            <span>THÔNG TIN ĐĂNG KÝ 58WWIN</span>
            <span id="close-cred-card" style="cursor: pointer; color: #aaa; font-size: 18px; line-height: 1;">&times;</span>
        </div>
        <div style="margin-bottom: 10px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <span style="color: #bbb;">Tài khoản:</span>
                <strong id="cred-username" style="color: #fff; font-family: monospace; font-size: 14px; margin-left: 5px;">${username}</strong>
            </div>
            <button id="copy-username-btn" style="background-color: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 11px; padding: 3px 8px; font-weight: bold;">Copy</button>
        </div>
        <div style="margin-bottom: 10px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <span style="color: #bbb;">Mật khẩu:</span>
                <strong id="cred-password" style="color: #fff; font-family: monospace; font-size: 14px; margin-left: 5px;">${password}</strong>
            </div>
            <button id="copy-password-btn" style="background-color: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 11px; padding: 3px 8px; font-weight: bold;">Copy</button>
        </div>
        <div id="copy-status" style="font-size: 11px; color: #888; text-align: center; margin-top: 5px; height: 15px;"></div>
    `;

    document.body.appendChild(card);

    document.getElementById('close-cred-card').addEventListener('click', () => card.remove());

    const copyText = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            const status = document.getElementById('copy-status');
            status.textContent = 'Đã sao chép thành công!';
            status.style.color = '#4CAF50';
            setTimeout(() => { status.textContent = ''; }, 2000);
        }).catch(err => {
            console.error('Could not copy text: ', err);
        });
    };

    document.getElementById('copy-username-btn').addEventListener('click', () => copyText(username));
    document.getElementById('copy-password-btn').addEventListener('click', () => copyText(password));
}

// Bấm nút Đăng ký ban đầu ở trang chủ/lobby nếu form chưa mở
async function clickInitialLobbyRegisterButton() {
    const regBtn = getElementByXpath("(//div[@class='lobby-image lobby-image lobby-image--use-bg lobby-image--skeleton _btn_oo248_105 _register-btn_oo248_143 _register_oo248_143 _hasBtnAnimte_oo248_183'])[1]") ||
                   getElementByXpath("(//div[contains(@class, '_register-btn_oo248_143') or contains(@class, '_register_oo248_143')])[1]") ||
                   getElementByXpath("(//div[contains(@class, '_register-btn')])[1]") ||
                   document.querySelector("[class*='_register-btn_oo248_143'], [class*='_register_oo248_143']");
    if (regBtn && regBtn.offsetParent !== null) {
        console.log("🎯 Bấm nút Đăng ký trang chủ...");
        simulateKeyboardClick(regBtn);
        try { regBtn.click(); } catch(e) {}
        await delay(800);
        return true;
    }
    return false;
}

// Bấm nút svg 25 (hoặc svg 29) để bỏ qua nhập mật khẩu lần 2
async function clickSkipConfirmPassword() {
    let svg = getElementByXpath("(//*[name()='svg'])[25]") ||
              getElementByXpath("(//*[local-name()='svg'])[25]");
    
    if (!svg) {
        const allSvgs = document.querySelectorAll('svg');
        if (allSvgs.length >= 25) {
            svg = allSvgs[24]; // 25th (0-indexed)
        }
    }

    if (!svg) {
        svg = getElementByXpath("(//*[name()='svg'])[29]") ||
              getElementByXpath("(//*[local-name()='svg'])[29]");
    }

    if (svg) {
        console.log("✅ Đã bấm vào SVG 25 (không cần nhập mk lần 2)");
        simulateKeyboardClick(svg);
        try { svg.parentElement?.click(); } catch(e) {}
        try { svg.click(); } catch(e) {}
        await delay(200);
        return true;
    }
    return false;
}
// 1. Tìm ô Tên tài khoản
function findUsernameInput() {
    return document.querySelector('input[data-input-name="account"]') ||
           document.querySelector("input[placeholder*='Số điện thoại/Email/Tên tài khoản']") ||
           document.querySelector("input[placeholder*='Tên tài khoản']") ||
           getElementByXpath("(//input[contains(@placeholder, 'Số điện thoại/Email/Tên tài khoản')])[1]") ||
           getElementByXpath("(//input[@data-input-name='account'])[1]");
}

// 2. Tìm ô Mật khẩu
function findPasswordInput1() {
    return document.querySelector('input[data-input-name="password"]') ||
           document.querySelector("input[placeholder*='Nhập mật khẩu']:not([placeholder*='lại'])") ||
           getElementByXpath("(//input[contains(@placeholder, 'Nhập mật khẩu') and not(contains(@placeholder, 'lại'))])[1]") ||
           getElementByXpath("(//input[@data-input-name='password'])[1]");
}

// 3. Tìm ô Nhập lại mật khẩu (dự phòng nếu SVG 25 chưa ấn được)
function findPasswordInput2() {
    return document.querySelector('input[data-input-name="confirmPassword"], input[data-input-name="rePassword"]') ||
           document.querySelector("input[placeholder*='Nhập lại mật khẩu']") ||
           getElementByXpath("(//input[contains(@placeholder, 'Nhập lại mật khẩu')])[1]");
}

// 4. Tìm ô Số điện thoại
function findPhoneInput() {
    return document.querySelector('input[data-input-name="phone"], input[data-input-name="mobile"]') ||
           document.querySelector("input[placeholder*='Nhập SĐT'], input[placeholder*='SĐT']") ||
           getElementByXpath("(//input[contains(@placeholder, 'SĐT') or contains(@placeholder, 'sđt')])[1]");
}

// 5. Tìm ô Họ và Tên thật
function findFullNameInput() {
    return document.querySelector('input[data-input-name="name"], input[data-input-name="realName"]') ||
           document.querySelector("input[placeholder*='Họ và Tên'], input[placeholder*='tên thật']") ||
           getElementByXpath("(//input[contains(@placeholder, 'Họ và Tên') or contains(@placeholder, 'tên thật')])[1]");
}

// 6. Tìm nút Đăng ký
function findSubmitButton() {
    return document.getElementById('insideRegisterSubmitClick') ||
           document.querySelector("button#insideRegisterSubmitClick") ||
           getElementByXpath("(//button[@id='insideRegisterSubmitClick'])[1]") ||
           Array.from(document.querySelectorAll('button, div, span')).find(el => {
               const txt = (el.textContent || '').trim();
               const rect = el.getBoundingClientRect();
               return (txt === 'Đăng Ký' || txt === 'Đăng ký') && rect.width > 80 && rect.height > 30;
           });
}

async function tryFillForm(data, attemptCount = 0) {
    let u = findUsernameInput();
    let p1 = findPasswordInput1();

    // Nếu form chưa mở, bấm nút Đăng ký ở ngoài lobby
    if (!u || !p1) {
        if (attemptCount === 0) await clickInitialLobbyRegisterButton();
        if (attemptCount < 25) {
            setTimeout(() => tryFillForm(data, attemptCount + 1), 300);
        } else {
            console.warn("⚠️ Không tìm thấy form đăng ký sau 25 lần thử.");
        }
        return;
    }

    console.log("✅ Đã tìm thấy form đăng ký 58WWIN!");

    // Sinh tên tài khoản ngẫu nhiên
    const base = generateRandomString(4).toLowerCase(); 
    const num = getNextUserNumber();
    const gU = `w${base}${num}`;
    
    // Sinh mật khẩu ngẫu nhiên 6 ký tự
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const nums = '0123456789';
    let gP = '';
    for (let i = 0; i < 2; i++) gP += chars.charAt(Math.floor(Math.random() * chars.length));
    for (let i = 0; i < 4; i++) gP += nums.charAt(Math.floor(Math.random() * nums.length));
    gP = gP.split('').sort(() => 0.5 - Math.random()).join(''); 

    // Chuẩn hoá số điện thoại
    let phoneVal = data.phoneNumber || '';
    if (phoneVal.startsWith('0')) {
        phoneVal = phoneVal.substring(1);
    }

    // 1. Điền Tên đăng nhập
    console.log("📝 1. Điền tên đăng nhập:", gU);
    simulateKeyboardClick(u);
    await delay(80);
    await typeHumanLike(u, gU);
    await delay(120);

    // 2. Điền Mật khẩu 1
    console.log("📝 2. Điền mật khẩu:", gP);
    simulateKeyboardClick(p1);
    await delay(80);
    await typeHumanLike(p1, gP);
    await delay(120);

    // 3. Bấm SVG 25 để không cần nhập mật khẩu lần 2
    await clickSkipConfirmPassword();
    await delay(100);

    // Nếu ô nhập lại mật khẩu vẫn còn hiển thị thì điền luôn
    const p2 = findPasswordInput2();
    if (p2 && p2.offsetParent !== null) {
        console.log("📝 2b. Điền xác nhận mật khẩu lần 2:", gP);
        simulateKeyboardClick(p2);
        await delay(80);
        await typeHumanLike(p2, gP);
        await delay(120);
    }

    // 4. Điền Số điện thoại (nếu có trên form)
    const ph = findPhoneInput();
    if (ph && ph.offsetParent !== null) {
        console.log("📝 3. Điền số điện thoại:", phoneVal);
        simulateKeyboardClick(ph);
        await delay(80);
        await typeHumanLike(ph, phoneVal);
        await delay(120);
    }

    // 5. Điền Họ và Tên thật (nếu có trên form)
    const fn = findFullNameInput();
    if (fn && fn.offsetParent !== null) {
        console.log("📝 4. Điền họ tên thật:", data.fullName);
        simulateKeyboardClick(fn);
        await delay(80);
        await typeHumanLike(fn, data.fullName);
        await delay(120);
    }

    // 6. Kiểm tra checkbox 18 tuổi
    const cb = document.querySelector("input[type='checkbox']");
    if (cb && !cb.checked) {
        simulateKeyboardClick(cb);
        try { cb.click(); } catch(e) {}
    }

    // Lưu thông tin đăng ký
    chrome.storage.local.set({ lastRegistered: { username: gU, password: gP, phone: phoneVal } });
    showCredentialsFloatingCard(gU, gP);

    // Gửi thông báo Telegram (chạy song song)
    chrome.runtime.sendMessage({
        action: "sendTelegram",
        data: {
            username: gU,
            password: gP,
            phone: phoneVal,
            fullName: data.fullName,
            bankAcc: data.bankAcc,
            bankName: data.bankName
        }
    }).catch(err => console.warn("Lỗi gửi Telegram:", err));

    // 7. Bấm nút Đăng ký
    await delay(500);
    const submitBtn = findSubmitButton();
    if (submitBtn) {
        console.log("🎯 Bấm nút xác nhận Đăng Ký...");
        submitBtn.style.outline = '3px solid #10b981';
        simulateKeyboardClick(submitBtn);
        try { submitBtn.click(); } catch(e) {}
    }

    // 8. Tự động xử lý popup xuất hiện sau khi ấn Đăng ký
    await handlePostRegisterPopup();

    chrome.storage.local.remove(['autoFillData']);
}

// Xử lý popup xuất hiện sau khi ấn Đăng ký
async function handlePostRegisterPopup() {
    console.log("🔍 Đang chờ và xử lý popup xuất hiện sau khi ấn Đăng Ký...");
    await delay(1200);

    // 1. Kiểm tra và giải Slider Captcha nếu xuất hiện
    try {
        if (typeof handleSliderCaptcha === 'function') {
            await handleSliderCaptcha();
        }
    } catch (e) {
        console.warn("Lỗi kiểm tra slider captcha:", e);
    }

    // 2. Chờ và tìm popup thông báo / xác nhận / khuyến mãi / đóng popup
    let checks = 0;
    while (checks < 20) {
        await delay(500);

        // Tìm nút xác nhận / đồng ý / đóng bằng text
        const confirmBtn = Array.from(document.querySelectorAll('button, div, span, a')).find(el => {
            const txt = (el.textContent || '').trim().toLowerCase();
            return (txt === 'xác nhận' || txt === 'đồng ý' || txt === 'đóng' || txt === 'tôi đã hiểu' || txt === 'ok' || txt === 'tiếp tục') && 
                   el.offsetParent !== null && el.offsetHeight >= 24;
        });

        // Tìm nút đóng popup dạng icon X hoặc class close
        const closeBtn = document.querySelector('[class*="close" i], [class*="modal__close" i], [aria-label="Close" i], [class*="btn-close" i]') ||
                         document.querySelector('[role="dialog"] [class*="close" i], .van-popup [class*="close" i], [class*="dialog"] [class*="close" i]');

        // Tìm icon SVG đóng trong dialog/modal/popup
        const dialogSvg = document.querySelector('[role="dialog"] svg, .van-popup svg, [class*="popup"] svg, [class*="modal"] svg');

        if (confirmBtn && confirmBtn.offsetParent !== null) {
            console.log("🎯 Phát hiện nút xác nhận trên popup:", confirmBtn.textContent.trim());
            simulateKeyboardClick(confirmBtn);
            try { confirmBtn.click(); } catch(e) {}
            await delay(500);
            break;
        } else if (closeBtn && closeBtn.offsetParent !== null) {
            console.log("🎯 Phát hiện nút đóng popup:", closeBtn);
            simulateKeyboardClick(closeBtn);
            try { closeBtn.click(); } catch(e) {}
            await delay(500);
            break;
        } else if (dialogSvg && dialogSvg.offsetParent !== null) {
            console.log("🎯 Phát hiện icon SVG trên popup, click đóng:", dialogSvg);
            simulateKeyboardClick(dialogSvg);
            try { dialogSvg.parentElement?.click(); } catch(e) {}
            try { dialogSvg.click(); } catch(e) {}
            await delay(500);
            break;
        }

        checks++;
    }
}

async function runWithdrawScenario(data) {
    console.log("🚀 Bắt đầu kịch bản rút tiền & liên kết ngân hàng 58WWIN...");

    // Hàm tìm nút "Thêm Tài Khoản" viền cam ở màn hình Yêu cầu rút tiền
    function getAddAccountBtn() {
        return getElementByXpath("(//div[@class='_left_f3wu4_104'])[1]") ||
               getElementByXpath("(//div[contains(@class, '_left_f3wu4_104')])[1]") ||
               document.querySelector("div._left_f3wu4_104, div[class*='_left_f3wu4_104']") ||
               getElementByXpath("(//div[@class='_addAccountInputBtn_f3wu4_91'])[1]") ||
               getElementByXpath("(//div[contains(@class, '_addAccountInputBtn_')])[1]") ||
               document.querySelector("div._addAccountInputBtn_f3wu4_91, div[class*='_addAccountInputBtn_']") ||
               Array.from(document.querySelectorAll('div, section')).find(el => {
                   const txt = (el.textContent || '').trim();
                   return txt.includes('Thêm Tài Khoản') && el.offsetParent;
               });
    }

    function triggerAddAccountClick(btn) {
        if (!btn) return;
        simulateKeyboardClick(btn);
        try { btn.click(); } catch(e) {}
        const parent = btn.closest("div[class*='_addAccountInputBtn_'], div[class*='_addAccountInputBtnWrap_']");
        if (parent && parent !== btn) {
            simulateKeyboardClick(parent);
            try { parent.click(); } catch(e) {}
        }
        const leftChild = btn.querySelector("div[class*='_left_']");
        if (leftChild && leftChild !== btn) {
            simulateKeyboardClick(leftChild);
            try { leftChild.click(); } catch(e) {}
        }
    }

    // 1. Kiểm tra nếu ĐÃ Ở SẴN màn hình Rút tiền có nút "Thêm Tài Khoản" thì bấm ngay!
    let immediateAddBtn = getAddAccountBtn();
    if (immediateAddBtn) {
        console.log("⚡ Phát hiện ngay nút 'Thêm Tài Khoản' (_left_f3wu4_104), bấm ngay!");
        triggerAddAccountClick(immediateAddBtn);
        await delay(1500);
    } else {
        // Chưa ở màn hình Rút tiền: Bấm tab "Tôi"
        let meBtn = getElementByXpath("(//div[@class='_item_1lmvk_112'])[5]") ||
                    getElementByXpath("(//div[contains(@class, '_item_')])[5]") ||
                    Array.from(document.querySelectorAll("div[class*='_item_']")).find(el => (el.textContent || '').trim().includes('Tôi') && el.offsetParent);

        if (meBtn) {
            console.log("🎯 1. Bấm vào tab 'Tôi'...");
            simulateKeyboardClick(meBtn);
            try { meBtn.click(); } catch(e) {}
            await delay(1200);
        }

        // Bấm "Rút tiền"
        let withdrawBtn = null;
        let wAttempts = 0;
        while (!withdrawBtn && wAttempts < 15) {
            const pathEl = getElementByXpath("(//*[name()='path'][@id='b171df8fdaf78eb5cc700eae15432256-路径_16908'])[1]") ||
                           getElementByXpath("//*[contains(@id, '路径_16908')]");
            if (pathEl) {
                withdrawBtn = pathEl.closest('div, a, button, section, li') || pathEl.parentElement || pathEl;
            } else {
                withdrawBtn = Array.from(document.querySelectorAll('div, button, span, a')).find(el => {
                    const txt = (el.textContent || '').trim();
                    return (txt === 'Rút tiền' || txt === 'Rút Tiền') && el.offsetParent;
                });
            }
            if (!withdrawBtn) { await delay(400); wAttempts++; }
        }

        if (withdrawBtn) {
            console.log("🎯 2. Bấm vào 'Rút tiền'...");
            simulateKeyboardClick(withdrawBtn);
            try { withdrawBtn.click(); } catch(e) {}
            await delay(1500);
        }

        // Kiểm tra xem có yêu cầu cài đặt mật khẩu rút tiền ban đầu không (ô nhập mật khẩu ảo)
        let passInputItem = getElementByXpath("(//li[@class='hairline--left ui-password-input__item'])[1]") ||
                            getElementByXpath("(//li[contains(@class, 'ui-password-input__item')])[1]") ||
                            document.querySelector("li.ui-password-input__item, li[class*='ui-password-input__item']");

        if (passInputItem && passInputItem.offsetParent) {
            console.log("🎯 3. Bấm vào ô mật khẩu rút tiền để hiện bàn phím...");
            simulateKeyboardClick(passInputItem);
            try { passInputItem.click(); } catch(e) {}
            await delay(800);

            // Bàn phím 1: số 1 (5 lần), số 2 (1 lần)
            console.log("⌨️ Nhập bàn phím 1 (111112)...");
            let b1 = getElementByXpath("(//div[@role='button'][normalize-space()='1'])[1]") || getVirtualKey('1', 1);
            for (let i = 0; i < 5; i++) {
                if (b1) { simulateKeyboardClick(b1); await delay(250); }
            }
            let b2 = getElementByXpath("(//div[@role='button'][normalize-space()='2'])[1]") || getVirtualKey('2', 1);
            if (b2) { simulateKeyboardClick(b2); await delay(300); }
            await delay(1200);

            // Bàn phím 2: số 1 (5 lần), số 2 (1 lần)
            console.log("⌨️ Nhập bàn phím 2 (xác nhận 111112)...");
            let kb2_b1 = getElementByXpath("(//div[@role='button'][normalize-space()='1'])[2]") ||
                         getElementByXpath("(//div[@role='button'][normalize-space()='1'])[1]") ||
                         getVirtualKey('1', 2);
            for (let i = 0; i < 5; i++) {
                if (kb2_b1) { simulateKeyboardClick(kb2_b1); await delay(250); }
            }
            let kb2_b2 = getElementByXpath("(//div[@role='button'][normalize-space()='2'])[2]") ||
                         getElementByXpath("(//div[@role='button'][normalize-space()='2'])[1]") ||
                         getVirtualKey('2', 2);
            if (kb2_b2) { simulateKeyboardClick(kb2_b2); await delay(300); }
            await delay(1200);

            // Nút xác nhận tiếp theo (nếu có)
            const cb = Array.from(document.querySelectorAll('button, div, span')).find(el => {
                const txt = (el.textContent || '').trim();
                return (txt === 'Xác nhận' || txt === 'Xác Nhận' || txt === 'Tiếp theo') && el.offsetParent;
            });
            if (cb) {
                simulateKeyboardClick(cb);
                try { cb.click(); } catch(e) {}
                await delay(1500);
            }
        }
    }

    // 2. Sau khi cài mật khẩu hoặc đã ở màn hình Rút tiền, tìm và bấm nút "Thêm Tài Khoản" (_addAccountInputBtn_f3wu4_91)
    let addAccBtn = getAddAccountBtn();
    let addAttempts = 0;
    while (!addAccBtn && addAttempts < 20) {
        addAccBtn = getAddAccountBtn();
        if (!addAccBtn) { await delay(400); addAttempts++; }
    }

    if (addAccBtn) {
        console.log("🎯 Bấm vào nút 'Thêm Tài Khoản' (_left_f3wu4_104)...");
        triggerAddAccountClick(addAccBtn);
        await delay(1500);
    }

    // 3. Ấn vào span right-text (Thêm vào / mũi tên liên kết ngân hàng nếu có)
    let rightTextBtn = null;
    let rtAttempts = 0;
    while (!rightTextBtn && rtAttempts < 15) {
        rightTextBtn = getElementByXpath("(//span[@class='_right-text_11g0t_174'])[1]") ||
                       getElementByXpath("(//span[contains(@class, '_right-text_')])[1]") ||
                       Array.from(document.querySelectorAll("span[class*='_right-text_']")).find(el => el.offsetParent);
        if (!rightTextBtn) { await delay(300); rtAttempts++; }
    }

    if (rightTextBtn) {
        console.log("🎯 Bấm vào nút right-text liên kết ngân hàng...");
        simulateKeyboardClick(rightTextBtn);
        try { rightTextBtn.click(); } catch(e) {}
        await delay(1000);
    }

    // 4. Xác nhận lại mật khẩu rút tiền (Bàn phím tự hiện, không cần ấn vào ô)
    console.log("⌨️ Nhập mật khẩu bảo mật (bàn phím tự hiện: 111112)...");
    let k1 = null;
    let k1Attempts = 0;
    while (!k1 && k1Attempts < 20) {
        k1 = getElementByXpath("(//div[contains(text(),'1')])[1]") || getElementByXpath("(//div[@role='button'][normalize-space()='1'])[1]");
        if (!k1) { await delay(300); k1Attempts++; }
    }

    for (let i = 0; i < 5; i++) {
        if (k1) {
            simulateKeyboardClick(k1);
            await delay(250);
        }
    }

    let k2 = getElementByXpath("(//div[contains(text(),'2')])[1]") || getElementByXpath("(//div[@role='button'][normalize-space()='2'])[1]");
    if (k2) {
        simulateKeyboardClick(k2);
        await delay(300);
    }

    await delay(1000);

    // 5. Bấm nút Tiếp theo (//button[@type='submit'])[1]
    let submitNextBtn = null;
    let subAttempts = 0;
    while (!submitNextBtn && subAttempts < 20) {
        submitNextBtn = getElementByXpath("(//button[@type='submit'])[1]") ||
                        Array.from(document.querySelectorAll('button')).find(el => {
                            const txt = (el.textContent || '').trim();
                            return (txt === 'Tiếp theo' || txt === 'Tiếp Tục' || el.type === 'submit') && el.offsetParent;
                        });
        if (!submitNextBtn) { await delay(300); subAttempts++; }
    }

    if (submitNextBtn) {
        console.log("🎯 Bấm nút Tiếp theo...");
        simulateKeyboardClick(submitNextBtn);
        try { submitNextBtn.click(); } catch(e) {}
        await delay(1500);
    }

    // 6. Điền form "Thêm tài khoản ngân hàng"
    if (data.bankAcc && data.bankName) {
        console.log("📝 Đang điền form popup Thêm tài khoản ngân hàng...");

        // Nhập số tài khoản ngân hàng
        let stkInput = null;
        let stkAttempts = 0;
        while (!stkInput && stkAttempts < 30) {
            stkInput = getElementByXpath("(//input[@placeholder='Vui lòng nhập số tài khoản ngân hàng'])[1]") ||
                       document.querySelector("input[placeholder*='số tài khoản ngân hàng' i]") ||
                       document.querySelector("input[placeholder*='số tài khoản' i]");
            if (!stkInput) { await delay(400); stkAttempts++; }
        }

        if (stkInput) {
            console.log("📝 Điền số tài khoản ngân hàng:", data.bankAcc);
            simulateKeyboardClick(stkInput);
            await delay(150);
            await typeHumanLike(stkInput, data.bankAcc);
            await delay(300);
        }

        // Chọn ngân hàng
        console.log("🏦 Chọn ngân hàng:", data.bankName);
        let bankInput = null;
        let bAttempts = 0;
        while (!bankInput && bAttempts < 25) {
            bankInput = getElementByXpath("(//input[@placeholder='Chọn ngân hàng phát hành'])[1]") ||
                        getElementByXpath("(//input[contains(@placeholder, 'ngân hàng phát hành')])[1]") ||
                        document.querySelector("input[placeholder*='ngân hàng phát hành' i]") ||
                        document.querySelector("input[placeholder*='chọn ngân hàng' i]") ||
                        document.querySelector("input[placeholder*='ngân hàng' i]");
            if (!bankInput) { await delay(300); bAttempts++; }
        }

        if (bankInput) {
            console.log("🎯 Bấm vào ô 'Chọn ngân hàng phát hành'...");
            simulateKeyboardClick(bankInput);
            try { bankInput.focus(); } catch(e) {}
            try { bankInput.click(); } catch(e) {}
            await delay(400);

            // Kiểm tra xem ô input nào đang focus hoặc ô input tìm kiếm ngân hàng
            let activeInput = document.activeElement;
            if (!activeInput || activeInput.tagName !== 'INPUT') {
                activeInput = document.querySelector("input[type='search'], input[placeholder*='tìm' i]") || bankInput;
            }

            // Gõ từ khóa tìm kiếm ngân hàng (ví dụ: 'lio' hoặc tên ngân hàng)
            let searchKeyword = data.bankName || '';
            if (searchKeyword.toLowerCase().includes('lio')) {
                searchKeyword = 'lio';
            }
            await typeHumanLike(activeInput, searchKeyword);
            await delay(800);

            // Click vào item ngân hàng trong danh sách gợi ý
            const bankItem = Array.from(document.querySelectorAll('div, span, li, p')).find(el => {
                const txt = (el.textContent || '').trim().toUpperCase();
                const targetName = (data.bankName || '').toUpperCase();
                const isMatch = (targetName.includes('LIO') && txt.includes('LIO')) ||
                                txt === targetName ||
                                (targetName.length >= 3 && txt.includes(targetName));
                return isMatch &&
                       el.offsetParent !== null &&
                       el !== bankInput &&
                       el !== activeInput &&
                       el.childElementCount <= 2;
            });

            if (bankItem) {
                console.log("🎯 Đã tìm thấy ngân hàng gợi ý, đang chọn:", bankItem.textContent.trim());
                simulateKeyboardClick(bankItem);
                try { bankItem.click(); } catch(e) {}
                await delay(500);
            }
        }

        await delay(1000);

        // Bấm nút Xác Nhận
        const confirmBtn = Array.from(document.querySelectorAll('button, div')).find(el => {
            const txt = (el.textContent || '').trim();
            return (txt === 'Xác Nhận' || txt === 'Xác nhận') && el.offsetParent !== null && el.offsetHeight >= 30;
        });

        if (confirmBtn) {
            console.log("🎯 Bấm nút Xác Nhận thêm ngân hàng...");
            confirmBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            confirmBtn.style.outline = '3px solid #10b981';
            confirmBtn.style.boxShadow = '0 0 15px #10b981';
            simulateKeyboardClick(confirmBtn);
            try { confirmBtn.click(); } catch(e) {}
        }
    }

    chrome.storage.local.remove(['withdrawData']);
}

function checkSequentialAndState() {
    chrome.storage.local.get(['autoFillData', 'withdrawData', 'isSequentialMode', 'withdrawLinkVal'], function(result) {
        const url = window.location.href;
        
        // 1. Điền form đăng ký
        if (result.autoFillData) {
            tryFillForm(result.autoFillData);
            return;
        }
        
        // 2. Chế độ liên tiếp 2 kịch bản
        if (result.isSequentialMode && !url.toLowerCase().includes('register')) {
            chrome.storage.local.remove(['isSequentialMode'], () => {
                const targetUrl = result.withdrawLinkVal || 'https://d2g23rqtpr16tr.cloudfront.net/?fixed.iswebclip=2';
                window.location.href = targetUrl;
            });
            return;
        }
        
        // 3. Kịch bản cài mật khẩu rút tiền & liên kết ngân hàng
        if (result.withdrawData) {
            runWithdrawScenario(result.withdrawData);
            return;
        }
    });
}

// Chạy ngay khi load trang
checkSequentialAndState();

// Kiểm tra định kỳ để bắt sự kiện thay đổi trang của SPA
let lastCheckedUrl = window.location.href;
setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastCheckedUrl) {
        lastCheckedUrl = currentUrl;
        checkSequentialAndState();
    }
}, 1000);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fillForm") {
        tryFillForm(request.data);
        sendResponse({ success: true });
    } else if (request.action === "runWithdraw") {
        runWithdrawScenario(request.data);
        sendResponse({ success: true });
    }
});

// Lắng nghe thay đổi storage từ popup để kích hoạt ngay cả khi frame không nhận được sendMessage
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
        if (changes.autoFillData?.newValue) {
            console.log("⚡ Nhận lệnh điền form từ storage onChanged!");
            tryFillForm(changes.autoFillData.newValue);
        }
        if (changes.withdrawData?.newValue) {
            console.log("⚡ Nhận lệnh rút tiền từ storage onChanged!");
            runWithdrawScenario(changes.withdrawData.newValue);
        }
    }
});

