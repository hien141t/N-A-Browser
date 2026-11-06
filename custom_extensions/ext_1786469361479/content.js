// ==========================================
// i9 AUTO - CONTENT SCRIPT
// Inject trực tiếp vào các trang m.9922999.com, m.9922044.com
// ==========================================

console.log('[i9 Content Script] Đã inject vào trang:', window.location.href);

// ---- Helper Functions ----
function getXPath(path) {
    try {
        return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch (e) {
        return null;
    }
}

function showToast(msg, color = '#10b981') {
    const old = document.getElementById('i9-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'i9-toast';
    t.textContent = msg;
    t.style.cssText = `position:fixed;top:10px;left:50%;transform:translateX(-50%);background:${color};color:#ffffff;padding:10px 18px;border-radius:8px;z-index:999999;font-size:13px;font-weight:bold;text-align:center;box-shadow:0 4px 15px rgba(0,0,0,0.5);font-family:sans-serif;`;
    document.body.appendChild(t);
    setTimeout(() => t && t.remove(), 3500);
}

function forceClick(el) {
    if (!el) return;
    el.focus();
    try { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true })); } catch (e) {}
    try { el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true })); } catch (e) {}
    try { el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true })); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    el.click();
}

function triggerInputEvents(element, value) {
    if (!element) return false;
    element.focus();
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
    showToast('🔵 Bắt đầu cài Mật Khẩu Rút Tiền...', '#3b82f6');

    // Bước 1: Ấn tab TÀI KHOẢN
    let btn1 = getXPath("(//span[contains(text(),'TÀI KHỎAN')])[1]");
    if (!btn1) btn1 = getXPath("(//span[contains(text(),'TÀI KHOẢN')])[1]");
    if (!btn1) btn1 = getXPath("(//i[contains(@class,'fa-user')])[1]");
    
    if (btn1) {
        showToast('✅ B1: Click TÀI KHOẢN...', '#10b981');
        forceClick(btn1);
        if (btn1.parentElement) forceClick(btn1.parentElement);
        await wait(1000);
    } else {
        showToast('❌ B1: KHÔNG tìm thấy tab TÀI KHOẢN!', '#ef4444');
        return;
    }

    // Bước 2: Ấn Rút tiền
    let btn2 = getXPath("(//span[@translate='MemberCenter_OnlineWithdraw'])[1]");
    if (!btn2) btn2 = getXPath("(//*[contains(text(),'Rút tiền')])[1]");
    if (btn2) {
        showToast('✅ B2: Click Rút Tiền...', '#10b981');
        forceClick(btn2);
        if (btn2.parentElement) forceClick(btn2.parentElement);
        await wait(1000);
    } else {
        showToast('❌ B2: KHÔNG tìm thấy nút Rút Tiền!', '#ef4444');
        return;
    }

    // Bước 3: Pop-up thông báo cài đặt
    await wait(800);
    let btn3 = getXPath("(//*[contains(text(),'Mật khẩu rút tiền chưa cài đặt')])[1]");
    if (btn3) {
        showToast('✅ B3: Xác nhận Popup Cài Mật Khẩu...', '#10b981');
        forceClick(btn3);
        if (btn3.parentElement) forceClick(btn3.parentElement);
        await wait(800);
    }

    // Bước 4: Điền 2 ô Mật khẩu rút tiền
    let passInputs = Array.from(document.querySelectorAll('input[type="password"], input[placeholder*="mật khẩu rút tiền"], input[placeholder*="Mật khẩu rút tiền"]'));
    if (passInputs.length >= 2) {
        showToast('✅ B4: Đang điền Mật khẩu rút tiền...', '#10b981');
        triggerInputEvents(passInputs[0], password);
        triggerInputEvents(passInputs[1], password);
        await wait(500);
    } else {
        showToast('❌ B4: Không tìm thấy 2 ô nhập mật khẩu!', '#ef4444');
        return;
    }

    // Bước 5: Click Gửi đi / Xác nhận
    let btnSubmit = getXPath("(//button[contains(., 'Gửi đi')])[1]") || getXPath("(//span[contains(text(),'Gửi đi')])[1]") || getXPath("(//*[contains(text(),'Xác nhận')])[1]");
    if (btnSubmit) {
        showToast('✅ B5: Click Gửi Đi!', '#10b981');
        btnSubmit.removeAttribute('disabled');
        forceClick(btnSubmit);
        await wait(500);
        showToast('🎉 Cài mật khẩu rút tiền thành công!', '#8b5cf6');
    } else {
        showToast('❌ B5: Không tìm thấy nút Gửi đi!', '#ef4444');
    }
}

// Lắng nghe message từ Popup/Background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'runMoneyPasswordContent') {
        runMoneyPassword(request.password).then(() => {
            sendResponse({ success: true });
        }).catch(err => {
            showToast('❌ Lỗi: ' + err.message, '#ef4444');
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }
});
