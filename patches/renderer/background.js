// ==========================================
// i9 Auto Register - Background Service Worker
// Xử lý tự động hóa đăng ký & OCR Captcha trong nền
// ==========================================

const DEFAULT_WEBSITES = [
    "https://m.9922999.com",
    "https://m.9922044.com"
];

const OCR_SERVER = "http://180.93.106.208:5588";
const TELEGRAM_TOKEN = ""; // Removed: configure securely at runtime
const TELEGRAM_CHAT_ID = "7651644672";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "runFullSequence") {
        runFullSequence(request.tabId, request.data);
    }
    if (request.action === "runRegisterOnly") {
        runRegisterOnly(request.tabId, request.data);
    }
    if (request.action === "runPromo") {
        runPromoFlow(request.tabId, request.username, request.depositAmount, request.promoUrl);
    }
    if (request.action === "runMoneyPass") {
        const site = new URL(request.url || 'https://m.9922999.com').origin;
        (async () => {
            try {
                const moneyPassResult = await runMoneyPasswordFlow(request.tabId, site, request.withdrawPass);
                if (moneyPassResult && moneyPassResult.success) {
                    const text = `🟢 i9 ĐĂNG KÝ MỚI (CHẠY RIÊNG)\n👤 TK: ${request.username}\n🔑 MK: ${request.password}\n💳 MK Rút Tiền: ${request.withdrawPass}\n📝 Tên: ${request.fullname}\n📱 SĐT: ${request.phone}\n🌐 Site: ${site}`;
                    fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
                    }).catch(err => console.log("[i9 BG] Telegram error:", err));

                    await new Promise(r => setTimeout(r, 4000));
                    await runBankCardFlow(request.tabId, site, {
                        withdrawPass: request.withdrawPass,
                        bankName: request.bankName,
                        bankBranch: request.bankBranch,
                        bankAccount: request.bankAccount
                    });
                }
            } catch (err) {
                console.error("[i9 BG] Lỗi trong runMoneyPass action:", err);
            }
        })();
    }
    if (request.action === "getImageBase64") {
        fetch(request.url)
            .then(res => res.ok ? res.blob() : Promise.reject('Network error'))
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => sendResponse({ success: true, base64: reader.result.split(',')[1] });
                reader.onerror = () => sendResponse({ success: false });
                reader.readAsDataURL(blob);
            })
            .catch(() => sendResponse({ success: false }));
        return true;
    }
    if (request.action === "solveCaptcha") {
        chrome.storage.local.get(['anticaptchaApiKey', 'customOcrServer'], function (result) {
            const key = result.anticaptchaApiKey || '';
            const localServer = "http://127.0.0.1:5588";
            const remoteServer = result.customOcrServer || OCR_SERVER;
            const mode = request.mode || "digits";

            // Thử gọi Local OCR Server trước (ddddocr chạy offline)
            fetch(`${localServer}/ocr`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: key, image: request.image, mode: mode }),
                signal: AbortSignal.timeout(3000)
            })
            .then(res => res.json())
            .then(data => sendResponse(data))
            .catch(() => {
                // Thử fallback sang Remote OCR Server
                fetch(`${remoteServer}/ocr`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: key, image: request.image, mode: mode })
                })
                .then(res => res.json())
                .then(data => sendResponse(data))
                .catch(err => sendResponse({ success: false, error: err.message }));
            });
        });
        return true;
    }
});

// ==========================================
// REGISTRATION FLOWS
// ==========================================

function saveAccountToHistory(accData) {
    chrome.storage.local.get(['savedAccounts'], (result) => {
        let list = result.savedAccounts || [];
        const newAcc = {
            username: accData.username,
            password: accData.password,
            withdrawPass: accData.withdrawPass || '0',
            fullname: accData.fullname || '',
            phone: accData.phone || '',
            bankName: accData.bankName || '',
            bankBranch: accData.bankBranch || '',
            bankAccount: accData.bankAccount || '',
            site: accData.site || '',
            time: new Date().toLocaleString('vi-VN')
        };
        list = list.filter(item => item.username !== newAcc.username);
        list.unshift(newAcc);
        chrome.storage.local.set({ savedAccounts: list }, () => {
            console.log("[i9 BG] Đã tự động lưu tài khoản vào lịch sử:", newAcc.username);
        });
    });
}

async function runRegisterOnly(tabId, data) {
    try {
        console.log("[i9 BG] Bắt đầu điền form đăng ký i9...");
        let site = data.site || DEFAULT_WEBSITES[0];
        try {
            site = new URL(site).origin;
        } catch (e) {
            console.error("[i9 BG] Error parsing site URL:", e);
        }

        let targetUrl = site + "/Account/Register";
        const tab = await chrome.tabs.get(tabId);

        if (!tab.url || !tab.url.includes("Account/Register")) {
            await chrome.tabs.update(tabId, { url: targetUrl });
            await waitForTabComplete(tabId);
        }

        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: fillFormAndSolveCaptchaI9,
            args: [data.username, data.password, data.fullname, data.phone]
        });

        saveAccountToHistory(data);
        console.log("[i9 BG] Hoàn thành điền form và gửi đăng ký!");
    } catch (err) {
        console.error("[i9 BG] Lỗi trong runRegisterOnly:", err);
    }
}

async function runFullSequence(tabId, data) {
    try {
        console.log("[i9 BG] Bắt đầu luồng CHẠY ALL i9...");
        let site = data.site || DEFAULT_WEBSITES[0];
        try {
            site = new URL(site).origin;
        } catch (e) {
            console.error("[i9 BG] Error parsing site URL:", e);
        }

        let targetUrl = site + "/Account/Register";
        const tab = await chrome.tabs.get(tabId);

        if (!tab.url || !tab.url.includes("Account/Register")) {
            await chrome.tabs.update(tabId, { url: targetUrl });
            await waitForTabComplete(tabId);
        }

        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: fillFormAndSolveCaptchaI9,
            args: [data.username, data.password, data.fullname, data.phone]
        });

        const scriptResult = results?.[0]?.result;
        if (!scriptResult || !scriptResult.success) {
            console.log("[i9 BG] Đăng ký hoặc OCR Captcha không thành công. Dừng luồng.");
            return;
        }

        const withdrawPassVal = data.withdrawPass || '0';
        data.withdrawPass = withdrawPassVal;

        // Lưu tài khoản ngay sau khi đăng ký xong
        saveAccountToHistory(data);

        // Chờ chuyển hướng trang
        let redirected = false;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            const currentTab = await chrome.tabs.get(tabId);
            if (currentTab.url && !currentTab.url.toLowerCase().includes('/account/register')) {
                redirected = true;
                break;
            }
        }

        if (redirected) {
            await new Promise(r => setTimeout(r, 2000));
        }

        // Bước 1: Cài MK rút tiền (mặc định là '0')
        const moneyPassResult = await runMoneyPasswordFlow(tabId, site, withdrawPassVal);
        if (!moneyPassResult || !moneyPassResult.success) {
            console.log("[i9 BG] Cài đặt MK rút tiền thất bại.");
            return;
        }

        // Gửi Telegram
        const text = `🟢 i9 ĐĂNG KÝ MỚI ThÀNH CÔNG\n👤 TK: ${data.username}\n🔑 MK: ${data.password}\n💳 MK Rút Tiền: ${withdrawPassVal}\n📝 Tên: ${data.fullname}\n📱 SĐT: ${data.phone}\n🌐 Site: ${site}`;
        
        fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
        }).catch(err => console.log("[i9 BG] Telegram error:", err));

        await new Promise(r => setTimeout(r, 3000));

        // Bước 2: Liên kết ngân hàng
        await runBankCardFlow(tabId, site, {
            withdrawPass: withdrawPassVal,
            bankName: data.bankName,
            bankBranch: data.bankBranch,
            bankAccount: data.bankAccount
        });

        console.log("[i9 BG] CHẠY ALL hoàn thành rực rỡ!");
    } catch (err) {
        console.error("[i9 BG] Error in full sequence:", err);
    }
}

function waitForTabComplete(tabId) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, 15000);

        function listener(updatedTabId, info) {
            if (updatedTabId === tabId && info.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(resolve, 1500);
            }
        }
        chrome.tabs.onUpdated.addListener(listener);
    });
}

// ==========================================
// INJECTED SCRIPT: FILL FORM & CAPTCHA FOR i9
// ==========================================

function fillFormAndSolveCaptchaI9(username, password, fullname, phone) {
    function getElementByXpath(path) {
        try {
            return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        } catch (e) {
            return null;
        }
    }

    function triggerEvents(element) {
        if (!element) return;
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', keyCode: 65 }));
        element.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'a', keyCode: 65 }));
        
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(element, element.value);
        } else {
            element.value = element.value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a', keyCode: 65 }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function fillInput(element, value) {
        if (!element) return false;
        element.focus();
        element.value = value;
        triggerEvents(element);
        return true;
    }

    function imageElementToBase64(imgEl) {
        if (!imgEl) return Promise.resolve(null);
        if (imgEl.src && imgEl.src.startsWith('data:image')) {
            return Promise.resolve(imgEl.src.split(',')[1]);
        }
        try {
            const canvas = document.createElement('canvas');
            canvas.width = imgEl.naturalWidth || imgEl.width || 120;
            canvas.height = imgEl.naturalHeight || imgEl.height || 40;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgEl, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            if (dataUrl && dataUrl.includes(',')) {
                return Promise.resolve(dataUrl.split(',')[1]);
            }
        } catch (e) {
            console.log("[i9 DOM] Canvas draw error, fallback to URL fetch:", e);
        }
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: "getImageBase64", url: imgEl.src }, response => {
                if (chrome.runtime.lastError || !response || !response.success) {
                    resolve(null);
                } else {
                    resolve(response.base64);
                }
            });
        });
    }

    const run = async () => {
        // Exact XPaths theo yêu cầu của user cho i9 (9922999, 9922044)
        const xpaths = {
            username: "/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[1]/div[1]/input",
            password: "/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[1]/div[2]/div/input",
            confirmPassword: "/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[1]/div[3]/div/input",
            fullname: "/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[2]/div/input",
            captchaInput: "/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[3]/div[1]/div/input",
            captchaImg: "/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[3]/div[1]/div/img"
        };

        // Fallback XPaths & Selectors
        const getUsernameInput = () => getElementByXpath(xpaths.username) || document.querySelector('input[placeholder*="tên tài khoản"], input[formcontrolname="account"]');
        const getPasswordInput = () => getElementByXpath(xpaths.password) || document.querySelector('input[placeholder*="mật khẩu"]:not([placeholder*="nhập lại"]):not([placeholder*="xác nhận"]), input[type="password"]');
        const getConfirmPasswordInput = () => getElementByXpath(xpaths.confirmPassword) || document.querySelector('input[placeholder*="nhập lại"], input[placeholder*="xác nhận"]');
        const getFullnameInput = () => getElementByXpath(xpaths.fullname) || document.querySelector('input[placeholder*="Họ và tên"], input[placeholder*="chủ khoản"], input[formcontrolname="fullName"]');
        const getCaptchaInput = () => getElementByXpath(xpaths.captchaInput) || document.querySelector('input[placeholder*="xác minh"], input[placeholder*="captcha"], input[formcontrolname="checkCode"]');
        // Captcha Image selector - Ưu tiên exact XPath của user
        const getCaptchaImg = () => {
            let img = getElementByXpath("/html/body/app-root/app-switch/div/section[2]/div[1]/app-register/form/fieldset[3]/div[1]/div/img");
            if (img) return img;
            img = getElementByXpath("/html/body/app-root/app-switch/div/section[2]/div/app-register/form/fieldset[3]/div[1]/div/img");
            if (img) return img;
            img = getElementByXpath("//form/fieldset[3]//img");
            if (img) return img;
            return document.querySelector('img[src*="captcha"], fieldset:nth-of-type(3) img');
        };

        await new Promise(r => setTimeout(r, 1500));

        // 1. Điền thông tin cơ bản
        const inputTk = getUsernameInput();
        const inputMk = getPasswordInput();
        const inputConfirmMk = getConfirmPasswordInput();
        const inputName = getFullnameInput();

        if (inputTk) fillInput(inputTk, username);
        if (inputMk) fillInput(inputMk, password);
        if (inputConfirmMk) fillInput(inputConfirmMk, password);
        if (inputName) fillInput(inputName, fullname);

        await new Promise(r => setTimeout(r, 500));

        // Verify lại form inputs
        if (inputTk && inputTk.value !== username) fillInput(inputTk, username);
        if (inputMk && inputMk.value !== password) fillInput(inputMk, password);
        if (inputConfirmMk && inputConfirmMk.value !== password) fillInput(inputConfirmMk, password);
        if (inputName && inputName.value !== fullname) fillInput(inputName, fullname);

        // 2. OCR Captcha Loop
        let captchaText = '';
        const inputCaptcha = getCaptchaInput();

        if (inputCaptcha) {
            for (let attempt = 1; attempt <= 6; attempt++) {
                const imgCaptcha = getCaptchaImg();
                if (imgCaptcha && imgCaptcha.src) {
                    try {
                        inputCaptcha.click();
                        inputCaptcha.focus();
                        await new Promise(r => setTimeout(r, 500));

                        const base64 = await imageElementToBase64(imgCaptcha);
                        if (base64) {
                            const ocrResult = await new Promise(res => {
                                chrome.runtime.sendMessage({ action: "solveCaptcha", image: base64 }, response => {
                                    if (chrome.runtime.lastError) res({ success: false });
                                    else res(response || { success: false });
                                });
                            });

                            if (ocrResult.success && ocrResult.text) {
                                const cleanedText = ocrResult.text.trim().replace(/\s/g, '');
                                if (/^\d{4}$/.test(cleanedText)) {
                                    captchaText = cleanedText;
                                    console.log(`[i9 BG] Giải Captcha thành công: ${captchaText}`);
                                    
                                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                                    if (nativeSetter) nativeSetter.call(inputCaptcha, captchaText);
                                    else inputCaptcha.value = captchaText;
                                    inputCaptcha.dispatchEvent(new Event('input', { bubbles: true }));
                                    break;
                                }
                            }
                        }
                    } catch (e) {
                        console.error("[i9 BG] Lỗi OCR Captcha lần " + attempt, e);
                    }

                    if (attempt < 6 && imgCaptcha) {
                        imgCaptcha.click();
                        await new Promise(r => setTimeout(r, 1800));
                    }
                } else {
                    await new Promise(r => setTimeout(r, 800));
                }
            }
        }

        if (!captchaText || !/^\d{4}$/.test(captchaText)) {
            console.error("[i9 BG] Lỗi: Không thể giải captcha 4 chữ số.");
            return { success: false, error: "Không thể giải captcha" };
        }

        // 3. Click nút Đăng Ký
        await new Promise(r => setTimeout(r, 800));
        
        const triggerClick = (el) => {
            if (!el) return;
            el.removeAttribute('disabled');
            el.classList.remove('disabled');
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            el.click();
        };

        let submitClicked = false;
        let btnSubmit = getElementByXpath("//*[contains(text(),'Đăng ký người dùng mới') or contains(text(),'ĐĂNG KÝ NGƯỜI DÙNG MỚI')]") ||
                          getElementByXpath("(//button[@type='submit'])[1]") || 
                          getElementByXpath("(//span[contains(text(),'ĐĂNG KÝ') or contains(text(),'Đăng ký')])[1]") ||
                          document.querySelector('button[type="submit"]');

        if (btnSubmit) {
            const parentBtn = btnSubmit.closest('button');
            triggerClick(parentBtn || btnSubmit);
            submitClicked = true;
        }

        if (!submitClicked) {
            const forms = document.querySelectorAll('form');
            if (forms.length > 0) {
                try { forms[0].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } catch(e){}
                try { forms[0].submit(); } catch(e){}
                submitClicked = true;
            }
        }

        return { success: true, captchaText: captchaText };
    };

    return run();
}

// ==========================================
// MONEY PASSWORD & BANK CARD FLOWS
// ==========================================

async function runMoneyPasswordFlow(tabId, site, withdrawPass) {
    console.log("[i9 BG] Chuyển tới trang Cài Mật Khẩu Rút Tiền...");
    const moneyPassUrl = site + "/Account/ChangeMoneyPassword";
    await chrome.tabs.update(tabId, { url: moneyPassUrl });
    await waitForTabComplete(tabId);
    await new Promise(r => setTimeout(r, 2000));

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: moneyPasswordDOMSequenceI9,
            args: [withdrawPass]
        });
        return results?.[0]?.result || { success: true };
    } catch (e) {
        console.error("[i9 BG] moneyPasswordDOMSequenceI9 error:", e);
        return { success: false, error: e.message };
    }
}

function moneyPasswordDOMSequenceI9(password) {
    function fillInput(element, value) {
        if (!element) return false;
        element.focus();
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        element.blur();
        return true;
    }

    function forceClick(el) {
        if (!el) return;
        el.click();
    }

    return new Promise((resolve) => {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (attempts > 15) {
                clearInterval(interval);
                resolve({ success: false, error: "Timeout chờ form MK rút tiền" });
                return;
            }

            const passInputs = Array.from(document.querySelectorAll('input[type="password"], input[placeholder*="mật khẩu rút tiền"], input[placeholder*="Mật khẩu rút tiền"]'));
            if (passInputs.length >= 2 && passInputs[0].offsetParent !== null) {
                clearInterval(interval);
                fillInput(passInputs[0], password);
                fillInput(passInputs[1], password);

                setTimeout(() => {
                    const btnSubmit = document.querySelector('button[type="submit"]') || 
                                    getElementByXpath("(//button[contains(., 'Gửi đi')])[1]") ||
                                    getElementByXpath("(//*[contains(text(),'Xác nhận') or contains(text(),'Gửi đi')])[1]");
                    if (btnSubmit) forceClick(btnSubmit);
                    resolve({ success: true });
                }, 1000);
            }
        }, 1000);
    });
}

async function runBankCardFlow(tabId, site, bankData) {
    console.log("[i9 BG] Bắt đầu thêm thẻ ngân hàng...");
    let origin = site;
    try { origin = new URL(site).origin; } catch(e){}
    const bankUrl = origin + "/Financial?type=withdraw";
    
    await chrome.tabs.update(tabId, { url: bankUrl });
    await waitForTabComplete(tabId);
    await new Promise(r => setTimeout(r, 2500));

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: bankCardDOMSequenceI9,
            args: [bankData]
        });
        return results?.[0]?.result || { success: true };
    } catch (e) {
        console.error("[i9 BG] runBankCardFlow error:", e);
        return { success: false, error: e.message };
    }
}

function bankCardDOMSequenceI9(data) {
    function getElementByXpath(path) {
        try {
            return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        } catch (e) {
            return null;
        }
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

    function fillInput(element, value) {
        if (!element) return false;
        element.focus();
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', keyCode: 65 }));
        element.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'a', keyCode: 65 }));
        
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(element, value);
        } else {
            element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a', keyCode: 65 }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
    }

    const wait = ms => new Promise(r => setTimeout(r, ms));

    return new Promise(async (resolve) => {
        try {
            console.log("[i9 BankCard] Bắt đầu điền thông tin thẻ ngân hàng...", data);
            await wait(2000);

            // 1. Click ô tìm/chọn ngân hàng: //*[@id="mat-input-0"]
            let inputBank = getElementByXpath("//*[@id='mat-input-0']") ||
                            document.querySelector('#mat-input-0') ||
                            getElementByXpath("(//input[contains(@placeholder,'ngân hàng') or contains(@id,'mat-input')])[1]") ||
                            document.querySelector('mat-select');

            if (inputBank) {
                console.log("[i9 BankCard] Click ô chọn ngân hàng (mat-input-0)...");
                forceClick(inputBank);
                await wait(1000);

                if (data.bankName && inputBank.tagName === 'INPUT') {
                    fillInput(inputBank, data.bankName);
                    await wait(800);
                }
            }

            // 2. Chọn ngân hàng từ danh sách dropdown: //*[@id="mat-option-32"]/span
            let optionBank = getElementByXpath("//*[@id='mat-option-32']/span") ||
                             getElementByXpath("//*[@id='mat-option-32']") ||
                             getElementByXpath(`//mat-option//span[contains(text(),'${data.bankName}')]`) ||
                             getElementByXpath("(//mat-option//span)[1]") ||
                             document.querySelector('mat-option');

            if (optionBank) {
                console.log("[i9 BankCard] Click chọn ngân hàng từ dropdown (mat-option-32)...");
                forceClick(optionBank);
                await wait(1000);
            } else {
                console.log("[i9 BankCard] Không thấy mat-option-32, tự động click mat-option đầu tiên...");
                const firstOption = document.querySelector('mat-option');
                if (firstOption) forceClick(firstOption);
                await wait(1000);
            }

            // 3. Điền Chi nhánh: /html/body/app-root/app-sample-layout/div/app-financial-layout/div/div/app-withdraw-layout-new/div/div/section/div[2]/form/section/div[2]/input
            let inputBranch = getElementByXpath("/html/body/app-root/app-sample-layout/div/app-financial-layout/div/div/app-withdraw-layout-new/div/div/section/div[2]/form/section/div[2]/input") ||
                              getElementByXpath("(//input[contains(@placeholder,'chi nhánh') or contains(@placeholder,'Chi nhánh')])[1]");

            if (inputBranch) {
                console.log("[i9 BankCard] Điền Chi nhánh:", data.bankBranch);
                fillInput(inputBranch, data.bankBranch || 'HA NOI');
                await wait(500);
            }

            // 4. Điền STK: /html/body/app-root/app-sample-layout/div/app-financial-layout/div/div/app-withdraw-layout-new/div/div/section/div[2]/form/section/div[3]/input
            let inputAccount = getElementByXpath("/html/body/app-root/app-sample-layout/div/app-financial-layout/div/div/app-withdraw-layout-new/div/div/section/div[2]/form/section/div[3]/input") ||
                               getElementByXpath("(//input[contains(@placeholder,'tài khoản') or contains(@placeholder,'Tài khoản') or contains(@placeholder,'STK')])[1]");

            if (inputAccount) {
                console.log("[i9 BankCard] Điền STK:", data.bankAccount);
                fillInput(inputAccount, data.bankAccount);
                await wait(500);
            }

            // 5. Click nút Gửi đi / Thêm / Xác nhận
            await wait(800);
            let btnSubmit = getElementByXpath("(//button[@type='submit'])[1]") ||
                              getElementByXpath("(//*[contains(text(),'Gửi đi') or contains(text(),'Xác nhận') or contains(text(),'Thêm') or contains(text(),'LIÊN KẾT')])[1]") ||
                              document.querySelector('button[type="submit"]');

            if (btnSubmit) {
                console.log("[i9 BankCard] Click nút gửi đi liên kết ngân hàng...");
                forceClick(btnSubmit);
                const parent = btnSubmit.closest('button, div');
                if (parent && parent !== btnSubmit) forceClick(parent);
            }

            resolve({ success: true });
        } catch (err) {
            console.error("[i9 BankCard] Lỗi trong bankCardDOMSequenceI9:", err);
            resolve({ success: false, error: err.message });
        }
    });
}

// ==========================================
// PROMOTION FLOW (XIN KHUYẾN MÃI i9sanh.cc)
// ==========================================

async function runPromoFlow(tabId, username, depositAmount = '50', promoUrl = 'https://i9sanh.cc/Activity/detail/id/111') {
    console.log(`[i9 BG] Bắt đầu luồng Xin Khuyến Mãi cho TK '${username}' tại '${promoUrl}'...`);
    
    await chrome.tabs.update(tabId, { url: promoUrl });
    await waitForTabComplete(tabId);
    await new Promise(r => setTimeout(r, 2500));

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: promoDOMSequenceI9,
            args: [username, depositAmount]
        });
        return results?.[0]?.result || { success: true };
    } catch (e) {
        console.error("[i9 BG] runPromoFlow error:", e);
        return { success: false, error: e.message };
    }
}

function promoDOMSequenceI9(username, depositAmount) {
    function getElementByXpath(path) {
        try {
            return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        } catch (e) {
            return null;
        }
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

    function fillInput(element, value) {
        if (!element) return false;
        element.focus();
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', keyCode: 65 }));
        element.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'a', keyCode: 65 }));
        
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(element, value);
        } else {
            element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a', keyCode: 65 }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
    }

    function imageElementToBase64(imgEl) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = imgEl.naturalWidth || imgEl.width || 120;
            canvas.height = imgEl.naturalHeight || imgEl.height || 40;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgEl, 0, 0);
            const dataURL = canvas.toDataURL('image/png');
            return dataURL.replace(/^data:image\/(png|jpg|jpeg);base64,/, '');
        } catch (e) {
            console.error('[i9 Promo] Error converting img canvas base64:', e);
            return null;
        }
    }

    const wait = ms => new Promise(r => setTimeout(r, ms));

    return new Promise(async (resolve) => {
        try {
            console.log("[i9 Promo] Bắt đầu điền form xin khuyến mãi...", { username, depositAmount });
            await wait(2000);

            // 1. Nhập tên tài khoản: //*[@id="user_id"]
            const inputUser = getElementByXpath("//*[@id='user_id']") || document.querySelector('#user_id') || document.querySelector('input[name="user_id"]');
            if (inputUser) {
                console.log("[i9 Promo] Điền Tên tài khoản:", username);
                fillInput(inputUser, username);
                await wait(500);
            } else {
                console.error("[i9 Promo] Không tìm thấy ô nhập user_id!");
            }

            // 2. Nhập tổng tiền nạp: //*[@id="submit_event_form"]/p/input
            const inputDeposit = getElementByXpath("//*[@id='submit_event_form']/p/input") || document.querySelector('#submit_event_form p input') || document.querySelector('input[name="money"]');
            if (inputDeposit) {
                console.log("[i9 Promo] Điền Tổng tiền nạp:", depositAmount);
                fillInput(inputDeposit, depositAmount);
                await wait(500);
            }

            // 3. Quét captcha & Giải OCR chế độ Alphanumeric (Chữ + Số 4 ký tự)
            const inputCaptcha = getElementByXpath("//*[@id='submit_event_form']/div[1]/input") || document.querySelector('#submit_event_form div:nth-child(1) input');
            const imgCaptcha = getElementByXpath("//*[@id='submit_event_form']/div[1]/div/img") || document.querySelector('#submit_event_form div:nth-child(1) img');

            let captchaText = '';
            if (inputCaptcha && imgCaptcha) {
                for (let attempt = 1; attempt <= 5; attempt++) {
                    console.log(`[i9 Promo] Giải Captcha Khuyến Mãi (Chữ+Số) lần ${attempt}...`);
                    await wait(500);

                    const base64Data = imageElementToBase64(imgCaptcha);
                    if (base64Data) {
                        try {
                            const ocrResult = await new Promise((res) => {
                                chrome.runtime.sendMessage({ action: "solveCaptcha", image: base64Data, mode: "alphanumeric" }, (response) => {
                                    if (chrome.runtime.lastError) res({ success: false });
                                    else res(response || { success: false });
                                });
                            });

                            if (ocrResult.success && ocrResult.text) {
                                const cleanedText = ocrResult.text.trim().replace(/\s/g, '');
                                if (cleanedText.length >= 3) { // Chữ + số 4 ký tự
                                    captchaText = cleanedText;
                                    console.log(`[i9 Promo] Giải Captcha Khuyến Mãi thành công: ${captchaText}`);
                                    fillInput(inputCaptcha, captchaText);
                                    break;
                                }
                            }
                        } catch (e) {
                            console.error(`[i9 Promo] Lỗi OCR Captcha lần ${attempt}:`, e);
                        }
                    }

                    if (attempt < 5) {
                        forceClick(imgCaptcha);
                        await wait(1800);
                    }
                }
            }

            // 4. Nhấn nút Xác nhận: //*[@id="submit_event_form"]/div[2]/a[1]/p
            await wait(800);
            const btnSubmit = getElementByXpath("//*[@id='submit_event_form']/div[2]/a[1]/p") ||
                              getElementByXpath("//*[@id='submit_event_form']/div[2]/a[1]") ||
                              getElementByXpath("//*[contains(text(),'XÁC NHẬN') or contains(text(),'Xác nhận')]") ||
                              document.querySelector('#submit_event_form a');

            if (btnSubmit) {
                console.log("[i9 Promo] Click nút Xác nhận xin khuyến mãi...");
                forceClick(btnSubmit);
                const parent = btnSubmit.closest('a, button');
                if (parent && parent !== btnSubmit) forceClick(parent);
            }

            resolve({ success: true, captchaText });
        } catch (err) {
            console.error("[i9 Promo] Lỗi trong promoDOMSequenceI9:", err);
            resolve({ success: false, error: err.message });
        }
    });
}
