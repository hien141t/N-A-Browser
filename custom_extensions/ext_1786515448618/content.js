// ==========================================
// HI88 AUTO - CONTENT SCRIPT
// Inject vĩnh viễn vào trang, nhận lệnh từ popup
// ==========================================

console.log('[Hi88 Content] Đã inject vào trang:', window.location.href);

// ---- Helper functions ----
function getXPath(path) {
    try {
        return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch(e) {
        return null;
    }
}

function showToast(msg, color = '#22c55e') {
    const old = document.getElementById('hi88-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'hi88-toast';
    t.textContent = msg;
    t.style.cssText = `position:fixed;top:0;left:0;right:0;background:${color};color:#fff;padding:10px 16px;z-index:999999;font-size:13px;font-weight:bold;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.4)`;
    document.body.appendChild(t);
    setTimeout(() => t && t.remove(), 3000);
}

function forceClick(el) {
    if (!el) return;
    el.focus();
    try { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); } catch(e){}
    try { el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true })); } catch(e){}
    try { el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true })); } catch(e){}
    try { el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true })); } catch(e){}
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    el.click();
}

function triggerInputEvents(element, value) {
    if (!element) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// ---- Kịch bản 2: Cài mật khẩu rút tiền ----
async function runMoneyPassword(password) {
    showToast('🔵 KB2: Bắt đầu...', '#3b82f6');

    // Bước 1: Ấn tab TÀI KHOẢN
    let btn1 = getXPath("(//span[contains(text(),'TÀI KHỎAN')])[1]");
    if (!btn1) btn1 = getXPath("(//span[contains(text(),'TÀI KHOẢN')])[1]");
    if (!btn1) btn1 = getXPath("(//i[contains(@class,'fa-user')])[1]");
    
    if (btn1) {
        showToast('✅ B1: Tìm thấy TÀI KHOẢN - đang ấn...', '#16a34a');
        forceClick(btn1);
        if (btn1.parentElement) forceClick(btn1.parentElement);
        if (btn1.parentElement?.parentElement) forceClick(btn1.parentElement.parentElement);
        await wait(1000);
    } else {
        showToast('❌ B1: KHÔNG tìm thấy TÀI KHOẢN!', '#ef4444');
        return;
    }

    // Bước 2: Ấn Rút tiền
    let btn2 = getXPath("(//span[@translate='MemberCenter_OnlineWithdraw'])[1]");
    if (btn2) {
        showToast('✅ B2: Tìm thấy Rút tiền - đang ấn...', '#16a34a');
        forceClick(btn2);
        if (btn2.parentElement) forceClick(btn2.parentElement);
        await wait(1000);
    } else {
        showToast('❌ B2: KHÔNG tìm thấy Rút tiền!', '#ef4444');
        return;
    }

    // Bước 3: Ấn popup "Mật khẩu rút tiền chưa cài đặt..."
    await wait(800);
    let btn3 = getXPath("(//span[contains(text(),'Mật khẩu rút tiền chưa cài đặt, vui lòng cài đặt m')])[1]");
    if (!btn3) btn3 = getXPath("(//div[contains(text(),'Mật khẩu rút tiền chưa cài đặt')])[1]");
    if (btn3) {
        showToast('✅ B3: Popup đã hiện - đang ấn xác nhận...', '#16a34a');
        forceClick(btn3);
        if (btn3.parentElement) forceClick(btn3.parentElement);
        await wait(800);
    } else {
        showToast('⚠️ B3: Không thấy popup xác nhận, thử tiếp...', '#f59e0b');
    }

    // Bước 4: Điền mật khẩu
    let pass1 = getXPath("(//input[@placeholder='vui lòng nhập mật khẩu rút tiền của bạn'])[1]");
    let pass2 = getXPath("(//input[@placeholder='Vui lòng xác nhận lại mật khẩu rút tiền của bạn'])[1]");
    
    // Fallback: tìm bằng type=password nếu placeholder không khớp
    if (!pass1) {
        const inputs = Array.from(document.querySelectorAll('input[type="password"]'));
        pass1 = inputs[0] || null;
        pass2 = inputs[1] || null;
    }

    if (pass1) {
        showToast('✅ B4: Tìm thấy ô nhập - đang điền...', '#16a34a');
        pass1.focus();
        triggerInputEvents(pass1, password);
        if (pass2) {
            pass2.focus();
            triggerInputEvents(pass2, password);
        }
        await wait(400);
    } else {
        showToast('❌ B4: KHÔNG tìm thấy ô nhập mật khẩu!', '#ef4444');
        return;
    }

    // Bước 5: Ấn Gửi đi
    let btnSubmit = getXPath("(//span[contains(text(),'Gửi đi')])[1]");
    if (!btnSubmit) btnSubmit = getXPath("(//button[@type='submit'])[1]");
    if (!btnSubmit) btnSubmit = getXPath("//button[contains(., 'Gửi đi')]");
    if (btnSubmit) {
        showToast('✅ B5: Ấn Gửi đi!', '#16a34a');
        btnSubmit.removeAttribute('disabled');
        forceClick(btnSubmit);
        const parent = btnSubmit.closest('button, div');
        if (parent && parent !== btnSubmit) forceClick(parent);
        await wait(500);
        showToast('🎉 KB2: Hoàn thành!', '#7c3aed');
    } else {
        showToast('❌ B5: KHÔNG tìm thấy nút Gửi đi!', '#ef4444');
    }
}

// ---- Lắng nghe lệnh từ popup ----
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'runMoneyPasswordContent') {
        showToast('🔵 Nhận lệnh KB2 từ popup!', '#3b82f6');
        runMoneyPassword(request.password).then(() => {
            sendResponse({ success: true });
        }).catch(err => {
            showToast('❌ Lỗi: ' + err.message, '#ef4444');
            sendResponse({ success: false, error: err.message });
        });
        return true; // Giữ kênh async
    }
});
