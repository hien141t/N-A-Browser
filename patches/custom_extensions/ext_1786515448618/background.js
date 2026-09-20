// ==========================================
// Hi88 Auto Register - Background Service Worker
// Xử lý chạy tuần tự trong nền (không cần popup mở)
// ==========================================

const WEBSITES = [
    "https://m.hi2033.com",
    "https://m.hi1955.com",
    "https://m.hi2777.com",
    "https://m.hi889999.com"
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
    if (request.action === "runMoneyPass") {
        const site = new URL(request.url || 'https://m.hi2033.com').origin;
        (async () => {
            try {
                // 1. Cài mật khẩu rút tiền
                const moneyPassResult = await runMoneyPasswordFlow(request.tabId, site, request.withdrawPass);
                if (!moneyPassResult || !moneyPassResult.success) {
                    console.log("[Hi88 BG] Cài đặt mật khẩu rút tiền thất bại (chạy riêng). Không gửi Telegram.");
                    return;
                }

                // 2. Gửi Telegram ngay lập tức
                console.log("[Hi88 BG] Cài mật khẩu rút tiền thành công (chạy riêng)! Tiến hành gửi Telegram...");
                const text = `🟢 HI88 ĐĂNG KÝ MỚI (CHẠY RIÊNG)\n👤 TK: ${request.username}\n🔑 MK: ${request.password}\n💳 MK Rút Tiền: ${request.withdrawPass}\n📝 Tên: ${request.fullname}\n📱 SĐT: ${request.phone}\n🌐 Site: ${site}`;
                
                fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
                }).catch(err => console.log("[Hi88 BG] Telegram error:", err));

                // Đợi 6 giây để hệ thống ổn định trước khi liên kết ngân hàng
                console.log("[Hi88 BG] Đợi 6s để hoàn thành cài mật khẩu...");
                await new Promise(r => setTimeout(r, 6000));

                // 3. Liên kết thẻ ngân hàng
                console.log("[Hi88 BG] Bắt đầu thêm thẻ ngân hàng...");
                const bankCardResult = await runBankCardFlow(request.tabId, site, {
                    withdrawPass: request.withdrawPass,
                    bankName: request.bankName,
                    bankBranch: request.bankBranch,
                    bankAccount: request.bankAccount
                });

                if (!bankCardResult || !bankCardResult.success) {
                    console.log("[Hi88 BG] Thêm thẻ ngân hàng thất bại nhưng thông tin đã được gửi Telegram.");
                } else {
                    console.log("[Hi88 BG] Chạy riêng sequence completed!");
                }
            } catch (err) {
                console.error("[Hi88 BG] Lỗi trong runMoneyPass action:", err);
            }
        })();
    }
    if (request.action === "checkOcr") {
        checkOcrServer().then(result => sendResponse(result));
        return true;
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
        chrome.storage.local.get(['anticaptchaApiKey'], function(result) {
            const key = result.anticaptchaApiKey || '';
            fetch(`${OCR_SERVER}/ocr`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: key, image: request.image })
            })
            .then(res => res.json())
            .then(data => sendResponse(data))
            .catch(err => sendResponse({ success: false, error: err.message }));
        });
        return true;
    }
});

async function checkOcrServer() {
    try {
        const response = await fetch(`${OCR_SERVER}/health`, { signal: AbortSignal.timeout(3000) });
        const data = await response.json();
        return data.status === 'ok';
    } catch (e) {
        return false;
    }
}

async function runRegisterOnly(tabId, data) {
    try {
        console.log("[Hi88 BG] Bắt đầu đăng ký chỉ điền form...");
        let site = data.site || WEBSITES[0];
        try {
            site = new URL(site).origin;
        } catch (e) {
            console.error("[Hi88 BG] Error parsing site URL in runRegisterOnly:", e);
        }
        
        // Đảm bảo targetUrl có đuôi /Account/Register
        let targetUrl = site + "/Account/Register";

        const tab = await chrome.tabs.get(tabId);

        // Chỉ navigate khi chưa ở đúng trang đăng ký của site được chọn
        if (!tab.url || !(tab.url.includes("Account/Register") && tab.url.includes(site.replace("https://", "").replace("http://", "").split('/')[0]))) {
            await chrome.tabs.update(tabId, { url: targetUrl });

            await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }, 15000);

                function listener(updatedTabId, info) {
                    if (updatedTabId === tabId && info.status === 'complete') {
                        clearTimeout(timeout);
                        chrome.tabs.onUpdated.removeListener(listener);
                        setTimeout(resolve, 2000);
                    }
                }
                chrome.tabs.onUpdated.addListener(listener);
            });
        }

        // Thực thi script điền form & captcha
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: fillFormAndSolveCaptchaBackground,
            args: [data.username, data.password, data.fullname, data.phone, OCR_SERVER]
        });

        console.log("[Hi88 BG] Đăng ký chỉ điền form hoàn tất!");
    } catch (err) {
        console.error("[Hi88 BG] Lỗi trong runRegisterOnly:", err);
    }
}

async function runFullSequence(tabId, data) {
    try {
        console.log("[Hi88 BG] Starting full sequence...");

        let site = data.site || WEBSITES[0];
        try {
            site = new URL(site).origin;
        } catch (e) {
            console.error("[Hi88 BG] Error parsing site URL in runFullSequence:", e);
        }
        
        // Đảm bảo targetUrl có đuôi /Account/Register
        let targetUrl = site + "/Account/Register";

        const tab = await chrome.tabs.get(tabId);

        // Chỉ navigate khi chưa ở đúng trang đăng ký của site được chọn
        if (!tab.url || !(tab.url.includes("Account/Register") && tab.url.includes(site.replace("https://", "").replace("http://", "").split('/')[0]))) {
            await chrome.tabs.update(tabId, { url: targetUrl });

            await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }, 15000);

                function listener(updatedTabId, info) {
                    if (updatedTabId === tabId && info.status === 'complete') {
                        clearTimeout(timeout);
                        chrome.tabs.onUpdated.removeListener(listener);
                        setTimeout(resolve, 2000);
                    }
                }
                chrome.tabs.onUpdated.addListener(listener);
            });
        }

        // Execute fill + captcha script
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: fillFormAndSolveCaptchaBackground,
            args: [data.username, data.password, data.fullname, data.phone, OCR_SERVER]
        });

        const scriptResult = results?.[0]?.result;
        if (!scriptResult || !scriptResult.success) {
            console.log("[Hi88 BG] Điền form hoặc giải Captcha thất bại. Dừng luồng tự động.");
            return;
        }

        console.log("[Hi88 BG] Đăng ký xong. Chờ trang chuyển hướng để chạy Liên kết ngân hàng...");

        // Chờ trang redirect ra khỏi trang đăng ký (tối đa 10s)
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
            await new Promise(r => setTimeout(r, 2500)); // Đợi trang render
        } else {
            console.log("[Hi88 BG] Đăng ký thất bại (Vẫn ở trang Register). Dừng luồng tự động.");
            return;
        }

        // 1. Cài mật khẩu rút tiền
        const moneyPassResult = await runMoneyPasswordFlow(tabId, site, data.withdrawPass || data.password);
        if (!moneyPassResult || !moneyPassResult.success) {
            console.log("[Hi88 BG] Cài đặt mật khẩu rút tiền thất bại. Không gửi Telegram.");
            return;
        }

        // 2. Gửi Telegram ngay lập tức khi hoàn tất bước Mật khẩu rút tiền!
        console.log("[Hi88 BG] Cài mật khẩu rút tiền thành công! Tiến hành gửi Telegram...");
        const withdrawPassVal = data.withdrawPass || data.password;
        const text = `🟢 HI88 ĐĂNG KÝ MỚI\n👤 TK: ${data.username}\n🔑 MK: ${data.password}\n💳 MK Rút Tiền: ${withdrawPassVal}\n📝 Tên: ${data.fullname}\n📱 SĐT: ${data.phone}\n🌐 Site: ${site}`;
        
        fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
        }).catch(err => console.log("[Hi88 BG] Telegram error:", err));

        // Đợi 3 giây để hệ thống ổn định trước khi liên kết ngân hàng
        console.log("[Hi88 BG] Đợi 3s để hoàn thành cài mật khẩu...");
        await new Promise(r => setTimeout(r, 3000));

        // 3. Liên kết thẻ ngân hàng
        console.log("[Hi88 BG] Bắt đầu thêm thẻ ngân hàng...");
        const bankCardResult = await runBankCardFlow(tabId, site, {
            withdrawPass: withdrawPassVal,
            bankName: data.bankName,
            bankBranch: data.bankBranch,
            bankAccount: data.bankAccount
        });

        if (!bankCardResult || !bankCardResult.success) {
            console.log("[Hi88 BG] Thêm thẻ ngân hàng thất bại nhưng tài khoản đã được lưu trước đó.");
        } else {
            console.log("[Hi88 BG] Full sequence completed!");
        }
    } catch (err) {
        console.error("[Hi88 BG] Error in full sequence:", err);
    }
}

// Hàm được inject vào trang web
function fillFormAndSolveCaptchaBackground(username, password, fullname, phone, ocrServer) {
    function getElementByXpath(path) {
        return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    }

    function triggerEvents(element) {
        if (!element) return;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(element, element.value);
        }
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function fillInput(element, value) {
        if (!element) return false;
        element.focus();
        element.value = value;
        triggerEvents(element);
        return true;
    }

    function waitForElement(xpathOrFn, timeout = 10000) {
        return new Promise((resolve) => {
            const getEl = typeof xpathOrFn === 'function' ? xpathOrFn : () => getElementByXpath(xpathOrFn);
            let el = getEl();
            if (el) return resolve(el);

            const start = Date.now();
            const interval = setInterval(() => {
                el = getEl();
                if (el) {
                    clearInterval(interval);
                    resolve(el);
                } else if (Date.now() - start > timeout) {
                    clearInterval(interval);
                    resolve(null);
                }
            }, 500);
        });
    }

    function imageToBase64(imgSrc) {
        // Nếu ảnh đã là data URI thì tách base64 luôn
        if (imgSrc && imgSrc.startsWith('data:image')) {
            return Promise.resolve(imgSrc.split(',')[1]);
        }
        // Nhờ background fetch ảnh để tránh CORS (content script bị chặn)
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: "getImageBase64", url: imgSrc }, response => {
                if (chrome.runtime.lastError || !response || !response.success) {
                    resolve(null);
                } else {
                    resolve(response.base64);
                }
            });
        });
    }

    const run = async () => {
        const xpaths = {
            username: "(//input[@placeholder='Vui lòng nhập tên tài khoản'])[1]",
            password: "(//input[@placeholder='Vui lòng nhập mật khẩu'])[1]",
            fullname: "(//input[@placeholder='Họ và tên'])[1]",
            phone: "(//input[@placeholder='Số điện thoại'])[1]",
            captchaImg: "(/html/body/app-root/app-switch/div/section[2]/div/app-register/div/form/fieldset[3]/div[1]/div/img)[1] | (//img[@class='absolute right-7 top-1 h-4/5'])[1] | //img[contains(@src, 'captcha')]",
            submit: "(//span[@translate='Login_RegisterBtn'])[1] | (//button[@type='submit'])[1] | //span[contains(translate(., 'đăngkýngay', 'ĐĂNGKÝNGAY'), 'ĐĂNG KÝ NGAY')]"
        };

        await new Promise(r => setTimeout(r, 2000));

        const findCaptchaInput = () => {
            // Ưu tiên formcontrolname chuẩn - chính xác nhất
            let el = document.querySelector('input[formcontrolname="checkCode"], input[formcontrolname="Verify"], input[formcontrolname="verifyCode"]');
            if (el) return el;

            // Theo placeholder cụ thể
            el = document.querySelector('input[placeholder*="xác minh"], input[placeholder*="captcha"], input[placeholder*="Captcha"]');
            if (el) return el;

            // Theo XPath placeholder tiếng Việt
            el = getElementByXpath("(//input[@placeholder='Vui lòng nhập mã xác minh'])[1]");
            if (el) return el;

            // Tìm input nằm cùng div với ảnh captcha
            const captchaImg = getElementByXpath(xpaths.captchaImg);
            if (captchaImg) {
                const container = captchaImg.closest('div');
                if (container) {
                    el = container.querySelector('input');
                    if (el) return el;
                    if (container.parentElement) {
                        el = container.parentElement.querySelector('input');
                        if (el) return el;
                    }
                }
            }

            return null; // Không fallback input cuối - tránh điền nhầm
        };

        // Tối ưu: Autofill siêu tốc sử dụng MutationObserver thay vì đợi tuần tự
        const formFields = [
            { name: "username", xpath: xpaths.username, value: username, filled: false },
            { name: "password", xpath: xpaths.password, value: password, filled: false },
            { name: "fullname", xpath: xpaths.fullname, value: fullname, filled: false },
            { name: "phone", xpath: xpaths.phone, value: phone, filled: false }
        ];

        const checkAndFill = () => {
            let allFilled = true;
            for (let field of formFields) {
                if (!field.filled) {
                    const el = getElementByXpath(field.xpath);
                    if (el) {
                        if (el.value !== field.value) {
                            fillInput(el, field.value);
                        }
                        field.filled = true;
                    } else {
                        allFilled = false;
                    }
                }
            }
            return allFilled;
        };

        console.log("[Hi88 BG Debug] Bắt đầu tự động điền form (Tối ưu)...");
        await new Promise((resolve) => {
            const observer = new MutationObserver(() => {
                if (checkAndFill()) {
                    observer.disconnect();
                    resolve();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true });
            
            // Chạy thử ngay lập tức (nếu web load cực nhanh)
            if (checkAndFill()) {
                observer.disconnect();
                resolve();
            }
            
            // Timeout an toàn
            setTimeout(() => {
                observer.disconnect();
                resolve();
            }, 15000);
        });

        // Verify lại lần cuối
        await new Promise(r => setTimeout(r, 500));
        for (let field of formFields) {
            const el = getElementByXpath(field.xpath);
            if (el && el.value !== field.value) {
                fillInput(el, field.value);
            }
        }

        const ensureAllFieldsFilled = () => {
            console.log("[Hi88 BG] Đảm bảo điền lại các trường form trước khi đăng ký...");
            // Điền lại các trường form thông thường
            for (let field of formFields) {
                const el = getElementByXpath(field.xpath);
                if (el) {
                    fillInput(el, field.value);
                }
            }
            // ⚠️ Captcha: dùng native setter KHÔNG dispatch events
            // (fillInput thông thường sẽ trigger Angular reset captcha ảnh mới)
            if (captchaText) {
                const inputCaptcha = findCaptchaInput();
                if (inputCaptcha) {
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                    if (nativeSetter) nativeSetter.call(inputCaptcha, captchaText);
                    else inputCaptcha.value = captchaText;
                }
            }
        };

        // Tối ưu: Giải Captcha bằng vòng lặp tuần tự
        // ⚠️ QUAN TRỌNG: KHÔNG điền giá trị giả vào input captcha để "trigger refresh"
        // vì trang Angular/React lắng nghe sự kiện input và sẽ tự động đổi ảnh captcha mới.
        // → Luồng đúng: Chụp ảnh hiện tại → OCR giải → Điền kết quả đúng 1 lần.
        // → Nếu sai 4 số: click vào ẢNH captcha (không phải input) để đổi mã mới.
        console.log(`[Hi88 BG Debug] Bắt đầu giải Captcha...`);
        let captchaText = '';
        
        await new Promise(async (resolve) => {
            let attemptCount = 0;
            const maxAttempts = 7;
            let emptyCheckCount = 0;

            while (attemptCount < maxAttempts && emptyCheckCount < 15) {
                const imgCaptcha = findCaptchaInput() ? getElementByXpath(xpaths.captchaImg) : null;
                const inputCaptcha = findCaptchaInput();

                if (imgCaptcha && inputCaptcha && imgCaptcha.src) {
                    attemptCount++;
                    console.log(`[Hi88 BG] Phát hiện Captcha! Lần thử ${attemptCount}...`);
                    let solvedThisRound = false;

                    try {
                        // 1. Click vào ô input để focus (click input KHÔNG đổi captcha, chỉ fill value mới đổi)
                        inputCaptcha.click();
                        inputCaptcha.focus();
                        await new Promise(r => setTimeout(r, 600)); // Đợi ổn định sau click

                        // 2. Chụp ảnh captcha HIỆN TẠI (KHÔNG fill gì vào input → captcha sẽ không đổi)
                        const currentImg = getElementByXpath(xpaths.captchaImg);
                        if (currentImg && currentImg.src) {
                            const captchaBase64 = await imageToBase64(currentImg.src);
                            if (captchaBase64) {
                                // 3. Gửi lên OCR giải
                                const ocrResult = await new Promise(res => {
                                    chrome.runtime.sendMessage({ action: "solveCaptcha", image: captchaBase64 }, response => {
                                        if (chrome.runtime.lastError) res({ success: false });
                                        else res(response || { success: false });
                                    });
                                });

                                if (ocrResult.success && ocrResult.text) {
                                    const solvedText = ocrResult.text.trim().replace(/\s/g, '');
                                    if (/^\d{4}$/.test(solvedText)) {
                                        // 4. Điền kết quả captcha 1 lần duy nhất
                                        // ⚠️ Chỉ dispatch 'input' event (tối thiểu để Angular nhận giá trị)
                                        // KHÔNG gọi ensureAllFieldsFilled() ở đây vì nó sẽ gây captcha đổi
                                        console.log(`[Hi88 BG] Giải Captcha thành công! Điền mã: ${solvedText}`);
                                        captchaText = solvedText;

                                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                                        if (nativeSetter) nativeSetter.call(inputCaptcha, captchaText);
                                        else inputCaptcha.value = captchaText;
                                        inputCaptcha.dispatchEvent(new Event('input', { bubbles: true }));

                                        solvedThisRound = true;
                                        resolve();
                                        return;
                                    } else {
                                        console.log(`[Hi88 BG] Mã OCR lần ${attemptCount} không đúng 4 số: "${solvedText}" → Đổi ảnh captcha mới`);
                                    }
                                } else {
                                    console.log(`[Hi88 BG] OCR thất bại lần ${attemptCount}: ${ocrResult.error || 'No text'}`);
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`[Hi88 BG] Lỗi trong lần thử ${attemptCount}:`, err);
                    }

                    // Nếu lần này CHƯA giải thành công: click ẢNH captcha (không phải input) để đổi mã mới
                    if (!solvedThisRound && attemptCount < maxAttempts) {
                        console.log("[Hi88 BG] Đổi ảnh captcha mới (click vào ảnh, không phải input)...");
                        imgCaptcha.click(); // click ảnh để web tạo captcha mới
                        await new Promise(r => setTimeout(r, 2000)); // Đợi ảnh mới load
                    }
                } else {
                    // Nếu chưa tìm thấy element captcha, đợi 1 giây rồi check lại
                    emptyCheckCount++;
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            resolve();
        });

        if (!captchaText || !/^\d{4}$/.test(captchaText)) {
            console.error("[Hi88] Lỗi Captcha: Không phải là 4 chữ số.");
            return { success: false, error: "Lỗi Captcha: Không phải là 4 chữ số." };
        }

        // Đảm bảo thông tin form đầy đủ một lần nữa trước khi nhấn đăng ký
        ensureAllFieldsFilled();

        // Click nút đăng ký
        await new Promise(r => setTimeout(r, 1000));
        console.log("[Hi88 BG Debug] Bắt đầu click nút Đăng Ký...");

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

        // Tìm nút đăng ký: Ưu tiên click vào phần tử button (nếu có span bên trong thì click button cha để an toàn và chỉ click 1 lần)
        const btnSubmitXpath = getElementByXpath("(//span[@translate='Login_RegisterBtn'])[1]");
        if (btnSubmitXpath) {
            console.log("[Hi88 BG] Tìm thấy nút Login_RegisterBtn - đang click...");
            const parentBtn = btnSubmitXpath.closest('button');
            if (parentBtn) {
                triggerClick(parentBtn);
            } else {
                triggerClick(btnSubmitXpath);
            }
        } else {
            // Fallback: Quét tìm nút bấm Đăng Ký chính xác nhất và chỉ click duy nhất 1 lần
            let clicked = false;
            
            // Tìm nút button hoặc input submit trước
            const buttons = document.querySelectorAll('button, input[type="submit"]');
            for (let el of buttons) {
                const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
                if (text === 'ĐĂNG KÝ NGAY' || text === 'ĐĂNG KÝ' || el.type === 'submit') {
                    console.log("[Hi88 BG] Tìm thấy nút đăng ký (button) - đang click...", text);
                    triggerClick(el);
                    clicked = true;
                    break;
                }
            }

            // Nếu không tìm thấy, quét tiếp các thẻ div, span, a khác chứa text
            if (!clicked) {
                const clickables = document.querySelectorAll('div, span, a');
                for (let el of clickables) {
                    const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
                    if (text === 'ĐĂNG KÝ NGAY' || text === 'ĐĂNG KÝ') {
                        console.log("[Hi88 BG] Tìm thấy nút đăng ký (clickable) - đang click...", text);
                        const parentBtn = el.closest('button');
                        if (parentBtn) {
                            triggerClick(parentBtn);
                        } else {
                            triggerClick(el);
                        }
                        clicked = true;
                        break;
                    }
                }
            }

            // Fallback cuối cùng: Chỉ submit form nếu không click được nút nào
            if (!clicked) {
                const forms = document.querySelectorAll('form');
                if (forms.length > 0) {
                    console.log("[Hi88 BG] Không click được nút, thực hiện submit form...");
                    try { forms[0].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } catch(e){}
                    try { forms[0].submit(); } catch(e){}
                    clicked = true;
                }
            }

            if (!clicked) {
                console.error("[Hi88 BG] Lỗi: Không tìm thấy bất kỳ nút Đăng ký hoặc Form nào!");
            }
        }

        return { success: true };
    };

    return run();
}

// ==========================================
// KỊCH BẢN 2 - CÀI MẬT KHẨU RÚT TIỀN
// ==========================================
async function moneyPasswordDOMSequence(password) {
    function getElementByXpath(path) {
        return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    }

    // CẢI TIẾN: Mô phỏng đầy đủ chuỗi sự kiện gõ phím để React/Vue cập nhật state chính xác
    function fillInput(element, value) {
        if (!element) return false;
        
        element.focus();
        
        // Phát các sự kiện nhấn phím trước khi thay đổi giá trị
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
        
        // Gán giá trị trực tiếp
        element.value = value;
        
        // Phát các sự kiện cập nhật giá trị đầu vào
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Phát sự kiện nhả phím và mất focus
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        element.blur();
        
        return true;
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

    function showToast(msg, color = '#22c55e') {
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = `position:fixed;top:10px;left:50%;transform:translateX(-50%);background:${color};color:#fff;padding:8px 16px;border-radius:8px;z-index:999999;font-size:13px;font-weight:bold;max-width:90vw;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.4)`;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    function waitForAndFill(password) {
        return new Promise((resolve) => {
            let attempt = 0;
            const interval = setInterval(() => {
                attempt++;
                if (attempt > 20) {
                    clearInterval(interval);
                    showToast('❌ Quá thời gian chờ form!', '#ef4444');
                    resolve(false);
                    return;
                }

                // Tự động mở form nếu thấy thông báo chưa cài đặt
                let btn3 = getElementByXpath("(//*[contains(text(),'Mật khẩu rút tiền chưa cài đặt')])[1]");
                if (btn3 && btn3.offsetParent !== null) { 
                    forceClick(btn3);
                    if (btn3.parentElement) forceClick(btn3.parentElement);
                    if (btn3.closest('a, button, [role="button"], div')) forceClick(btn3.closest('a, button, [role="button"], div'));
                }

                // Tìm 2 ô nhập mật khẩu dựa trên placeholder
                let p1 = getElementByXpath("(//input[contains(@placeholder, 'vui lòng nhập mật khẩu rút tiền')])[1]");
                let p2 = getElementByXpath("(//input[contains(@placeholder, 'xác nhận lại mật khẩu rút tiền')])[1]");
                
                let passInputs = [];
                if (p1 && p2) {
                    passInputs = [p1, p2];
                } else {
                    // Cải tiến: Fallback linh hoạt hơn bằng cách quét toàn bộ input có type là password hoặc text liên quan
                    passInputs = Array.from(document.querySelectorAll('input[type="password"], input[placeholder*="mật khẩu"], input[placeholder*="Mật khẩu"]'));
                }

                // Nếu tìm thấy tối thiểu 2 ô và ô đầu tiên đang hiển thị
                if (passInputs.length >= 2 && passInputs[0].offsetParent !== null) {
                    clearInterval(interval);
                    showToast('✅ Đã thấy form, đang điền...', '#22c55e');
                    console.log("[KB2] Đã tìm thấy các ô nhập:", passInputs);
                    
                    // Điền dữ liệu cải tiến bằng hàm fillInput mới
                    fillInput(passInputs[0], password);
                    fillInput(passInputs[1], password);

                    // Chờ 1 giây để hệ thống xử lý dữ liệu trước khi bấm nút gửi
                    setTimeout(() => {
                        let btnSubmit = document.querySelector('button[type="submit"]') || 
                                        getElementByXpath("(//button[contains(., 'Gửi đi')])[1]") ||
                                        getElementByXpath("(//span[contains(text(),'Gửi đi')])[1]") ||
                                        getElementByXpath("(//*[contains(text(),'Xác nhận')])[1]"); // Thêm fallback nút Xác nhận
                        
                        if (btnSubmit) {
                            showToast('✅ Đang ấn Gửi đi...');
                            btnSubmit.removeAttribute('disabled');
                            forceClick(btnSubmit);
                            const parent = btnSubmit.closest('button, div');
                            if (parent && parent !== btnSubmit) forceClick(parent);
                        }
                        resolve(true);
                    }, 1000);
                }
            }, 1000);
        });
    }

    try {
        showToast('✅ KB2 Bắt đầu...', '#3b82f6');

        // Kiểm tra đường dẫn trang web
        if (!window.location.href.includes('ChangeMoneyPassword')) {
            showToast('🔄 Đang chuyển hướng sang trang Cài mật khẩu...', '#f59e0b');
            const targetUrl = window.location.origin + '/Account/ChangeMoneyPassword';
            window.location.href = targetUrl;
            return { success: false, error: 'Sai đường dẫn trang ChangeMoneyPassword' };
        }

        const filled = await waitForAndFill(password);
        if (!filled) {
            return { success: false, error: 'Không tìm thấy/điền được mật khẩu rút tiền' };
        }
        console.log("[Hi88 Kịch bản 2] Hoàn thành!");
        return { success: true };
    } catch (e) {
        console.error("[Hi88 Kịch bản 2] Lỗi nội bộ:", e);
        return { success: false, error: e.message };
    }
}

async function runMoneyPasswordFlow(tabId, site, withdrawPass) {
    console.log("[Hi88 BG] Đang chuyển hướng cài mật khẩu rút tiền...");
    const moneyPassUrl = site + "/Account/ChangeMoneyPassword";
    await chrome.tabs.update(tabId, { url: moneyPassUrl });

    // Đợi load trang
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        const currentTab = await chrome.tabs.get(tabId);
        if (currentTab.url && currentTab.url.includes('ChangeMoneyPassword')) {
            break;
        }
    }
    await new Promise(r => setTimeout(r, 2500)); // Đợi render

    // Thực thi script cài mật khẩu rút tiền
    let moneyPassResult;
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: moneyPasswordDOMSequence,
            args: [withdrawPass]
        });
        moneyPassResult = results?.[0]?.result;
    } catch (e) {
        console.log("[Hi88 BG] moneyPasswordDOMSequence error:", e.message);
        return { success: false, error: e.message };
    }

    if (!moneyPassResult || !moneyPassResult.success) {
        console.log("[Hi88 BG] Cài đặt mật khẩu rút tiền thất bại:", moneyPassResult?.error);
        return { success: false, error: moneyPassResult?.error || "Cài mật khẩu rút tiền thất bại" };
    }

    return { success: true };
}

async function runBankCardFlow(tabId, site, bankData) {
    console.log("[Hi88 BG] Đang chuyển hướng thêm thẻ ngân hàng...");
    const bankCardUrl = site + "/Financial?type=withdraw";
    await chrome.tabs.update(tabId, { url: bankCardUrl });

    // Đợi load trang
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        const currentTab = await chrome.tabs.get(tabId);
        if (currentTab.url && currentTab.url.includes('Financial')) {
            break;
        }
    }
    await new Promise(r => setTimeout(r, 2500)); // Đợi render

    // Thực thi script liên kết thẻ ngân hàng
    let bankCardResult;
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: bankCardDOMSequence,
            args: [bankData.bankName, bankData.bankBranch, bankData.bankAccount, bankData.withdrawPass]
        });
        bankCardResult = results?.[0]?.result;
    } catch (e) {
        console.log("[Hi88 BG] bankCardDOMSequence error:", e.message);
        return { success: false, error: e.message };
    }

    if (!bankCardResult || !bankCardResult.success) {
        console.log("[Hi88 BG] Liên kết ngân hàng thất bại:", bankCardResult?.error);
        return { success: false, error: bankCardResult?.error || "Liên kết ngân hàng thất bại" };
    }

    return { success: true };
}

async function runBankLinkingFlow(tabId, site, bankData) {
    const moneyPassRes = await runMoneyPasswordFlow(tabId, site, bankData.withdrawPass);
    if (!moneyPassRes || !moneyPassRes.success) {
        return moneyPassRes;
    }

    console.log("[Hi88 BG] Đợi 3s để hoàn thành cài mật khẩu...");
    await new Promise(r => setTimeout(r, 3000));

    return await runBankCardFlow(tabId, site, bankData);
}

async function bankCardDOMSequence(bankName, bankBranch, bankAccount, password) {
    function getElementByXpath(path) {
        return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    }

    function removeAccents(str) {
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    }

    function fillInput(element, value) {
        if (!element) return false;
        element.focus();
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
    }

    function forceClick(element) {
        if (!element) return;
        ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'].forEach(evt => {
            try {
                element.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
            } catch (e) {}
        });
        if (typeof element.click === 'function') {
            try { element.click(); } catch(e) {}
        }
    }

    function showToast(message, color = '#22c55e') {
        let toast = document.getElementById('hi88-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'hi88-toast';
            toast.style.position = 'fixed';
            toast.style.bottom = '20px';
            toast.style.right = '20px';
            toast.style.padding = '12px 24px';
            toast.style.color = '#fff';
            toast.style.fontSize = '14px';
            toast.style.fontWeight = 'bold';
            toast.style.borderRadius = '8px';
            toast.style.zIndex = '999999';
            toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            toast.style.transition = 'all 0.3s ease';
            document.body.appendChild(toast);
        }
        toast.style.backgroundColor = color;
        toast.textContent = message;
        console.log(`[Toast] ${message}`);
    }

    function waitForElement(selectorOrXpath, timeout = 10000) {
        return new Promise((resolve) => {
            const getEl = () => {
                if (selectorOrXpath.startsWith('//') || selectorOrXpath.startsWith('(//')) {
                    return getElementByXpath(selectorOrXpath);
                }
                return document.querySelector(selectorOrXpath);
            };
            let el = getEl();
            if (el) return resolve(el);

            const start = Date.now();
            const interval = setInterval(() => {
                el = getEl();
                if (el) {
                    clearInterval(interval);
                    resolve(el);
                } else if (Date.now() - start > timeout) {
                    clearInterval(interval);
                    resolve(null);
                }
            }, 100);
        });
    }

    try {
        showToast('🏦 Bắt đầu liên kết Ngân hàng...', '#3b82f6');

        // 1. Click vào Chọn Ngân hàng
        showToast('🏦 Mở danh sách Chọn Ngân hàng...', '#f59e0b');
        const bankSelectOpener = await waitForElement("(//span[@class='mat-select-placeholder mat-select-min-line ng-tns-c81-3 ng-star-inserted'])[1]") ||
                                 await waitForElement("//span[contains(@class,'mat-select-placeholder')]") ||
                                 await waitForElement(".mat-select-placeholder");

        if (!bankSelectOpener) {
            showToast('❌ Không tìm thấy nút chọn ngân hàng!', '#ef4444');
            return { success: false, error: 'Không tìm thấy nút chọn ngân hàng' };
        }

        forceClick(bankSelectOpener);
        await new Promise(r => setTimeout(r, 300));

        // 2. Điền tên ngân hàng tìm kiếm
        const searchInput = await waitForElement("(//input[@id='mat-input-1'])[1]") ||
                            await waitForElement("//input[contains(@id, 'mat-input')]") ||
                            await waitForElement(".mat-select-search-inner input") ||
                            await waitForElement(".mat-select-panel input");

        if (searchInput) {
            showToast(`🏦 Đang tìm kiếm bank: ${bankName}`, '#f59e0b');
            fillInput(searchInput, bankName);
            await new Promise(r => setTimeout(r, 400)); // Đợi filter danh sách
        }

        // 3. Chọn kết quả từ danh sách (ở đây mặc định lấy option [2] như hướng dẫn)
        const bankOption = await waitForElement("(//span[@class='mat-option-text'])[2]") ||
                           await waitForElement("//mat-option[2]//span[@class='mat-option-text']") ||
                           await waitForElement(".mat-option:nth-child(2) .mat-option-text") ||
                           await waitForElement(".mat-option-text"); // Fallback đầu tiên

        if (bankOption) {
            showToast('🏦 Chọn ngân hàng trong danh sách...', '#22c55e');
            forceClick(bankOption);
            await new Promise(r => setTimeout(r, 300));
        } else {
            showToast('❌ Không tìm thấy kết quả ngân hàng!', '#ef4444');
            return { success: false, error: 'Không tìm thấy kết quả ngân hàng' };
        }

        // 4. Điền Chi nhánh
        const branchInput = await waitForElement("(//input[@placeholder='Ví dụ : thành phố hồ chí minh'])[1]") ||
                            await waitForElement("//input[contains(@placeholder,'thành phố hồ chí minh')]") ||
                            await waitForElement("input[placeholder*='chi nhánh']") ||
                            await waitForElement("input[placeholder*='Chi nhánh']");
        if (branchInput) {
            showToast(`📝 Điền chi nhánh: ${bankBranch}`, '#3b82f6');
            fillInput(branchInput, bankBranch);
            await new Promise(r => setTimeout(r, 100));
        }

        // 5. Điền STK
        const accInput = await waitForElement("(//input[@placeholder='Ví dụ： 9704361234567890'])[1]") ||
                         await waitForElement("//input[contains(@placeholder,'9704361234567890')]") ||
                         await waitForElement("input[placeholder*='số tài khoản']") ||
                         await waitForElement("input[placeholder*='Số tài khoản']");
        if (accInput) {
            showToast(`📝 Điền số tài khoản: ${bankAccount}`, '#3b82f6');
            fillInput(accInput, bankAccount);
            await new Promise(r => setTimeout(r, 100));
        }

        // 6. Nhấn nút OK / Xác nhận liên kết ngân hàng
        const btnSubmit = document.querySelector('button.nrc-button') || 
                          document.querySelector('button[type="submit"]') ||
                          getElementByXpath("//button[contains(., 'Xác nhận')]") ||
                          getElementByXpath("//button[contains(., 'Gửi đi')]") ||
                          getElementByXpath("//button[contains(., 'Liên kết')]") ||
                          getElementByXpath("//span[contains(text(), 'Xác nhận')]") ||
                          getElementByXpath("//span[contains(text(), 'Gửi đi')]") ||
                          getElementByXpath("//span[contains(text(), 'Liên kết')]");
                          
        if (btnSubmit) {
            showToast('🚀 Đang gửi yêu cầu Liên kết...', '#3b82f6');
            await new Promise(r => setTimeout(r, 300));
            forceClick(btnSubmit);
            showToast('🎉 Hoàn tất liên kết ngân hàng!', '#22c55e');
            return { success: true };
        } else {
            showToast('⚠️ Không tìm thấy nút Xác nhận gửi đi!', '#f59e0b');
            return { success: false, error: 'Không tìm thấy nút Xác nhận gửi đi' };
        }

    } catch (e) {
        console.error("[Hi88 Bank Card] Lỗi nội bộ:", e);
        showToast('❌ Lỗi nội bộ trong quá trình liên kết bank!', '#ef4444');
        return { success: false, error: e.message };
    }
}

