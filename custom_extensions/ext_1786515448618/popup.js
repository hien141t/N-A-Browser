// ==========================================
// Hi88 Auto Register - Popup Controller
// ==========================================

const OCR_SERVER = "http://180.93.106.208:5588";

const WEBSITES = [
    "https://m.hi2033.com/Account/Register",
    "https://m.hi1955.com/Account/Register",
    "https://m.hi2777.com/Account/Register",
    "https://m.hi889999.com/Account/Register"
];

// Telegram config (sửa lại cho đúng của bạn)
const TELEGRAM_TOKEN = ""; // Removed: configure securely at runtime
const TELEGRAM_CHAT_ID = "7651644672";

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function generateRandomString(length) {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = letters.charAt(Math.floor(Math.random() * letters.length)); // Ký tự đầu phải là chữ
    for (let i = 1; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function generateRandomPassword(length) {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const all = 'abcdefghijklmnopqrstuvwxyz0123456789';
    
    // Đảm bảo ký tự đầu là chữ
    let result = letters.charAt(Math.floor(Math.random() * letters.length));
    
    // Đảm bảo có ít nhất 1 chữ số ở vị trí ngẫu nhiên phía sau
    const numberPos = Math.floor(Math.random() * (length - 2)) + 1;
    
    for (let i = 1; i < length; i++) {
        if (i === numberPos) {
            result += numbers.charAt(Math.floor(Math.random() * numbers.length));
        } else {
            result += all.charAt(Math.floor(Math.random() * all.length));
        }
    }
    return result;
}

function generateRandomName() {
    const firstNames = ['NGUYEN', 'TRAN', 'LE', 'PHAM', 'HOANG', 'HUYNH', 'PHAN', 'VU', 'VO', 'DANG', 'BUI', 'DO', 'NGO', 'DUONG'];
    const middleNames = ['VAN', 'THI', 'MINH', 'DUC', 'HOANG', 'GIA', 'BAO', 'TUAN', 'ANH', 'QUOC', 'HUU', 'THANH'];
    const lastNames = ['AN', 'BINH', 'CUONG', 'DUNG', 'DAT', 'HA', 'HUNG', 'KHANG', 'LINH', 'PHUONG', 'LONG', 'NAM', 'PHUC', 'TAI', 'TIEN'];

    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const middle = middleNames[Math.floor(Math.random() * middleNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];

    return `${first} ${middle} ${last}`;
}

function generateRandomPhone() {
    const prefixes = ['03', '05', '07', '08', '09'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
    return prefix + suffix;
}

function generateRandomWithdrawPass() {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6 chữ số ngẫu nhiên
}

function generateRandomBranch() {
    const branches = ['HA NOI', 'HO CHI MINH', 'DA NANG', 'HAI PHONG', 'CAN THO', 'DONG NAI', 'BINH DUONG', 'QUANG NINH', 'KHANH HOA'];
    return branches[Math.floor(Math.random() * branches.length)];
}

function generateRandomAccount() {
    const len = Math.floor(Math.random() * 4) + 10; // 10 đến 13 số
    let res = '';
    for(let i=0; i<len; i++) {
        res += Math.floor(Math.random() * 10);
    }
    return res;
}

function getSelectedSite() {
    const select = document.getElementById('siteSelect');
    return select.value || 'https://m.hi2033.com';
}

async function loadWebsites() {
    return new Promise(resolve => {
        chrome.storage.local.get(['customWebsites'], result => {
            let list = result.customWebsites || [];
            if (list.length === 0) {
                list = [...WEBSITES];
            }
            resolve(list);
        });
    });
}

async function initSiteSelectUI() {
    const list = await loadWebsites();
    const select = document.getElementById('siteSelect');
    select.innerHTML = '';
    list.forEach(site => {
        const opt = document.createElement('option');
        opt.value = site;
        opt.textContent = site.replace("https://", "").replace("http://", "");
        select.appendChild(opt);
    });
}

// ==========================================
// LOGGING
// ==========================================

function addLog(message, type = 'info') {
    console.log(`[${type}] ${message}`);
}

// ==========================================
// STATE MANAGEMENT
// ==========================================

function saveState() {
    const state = {
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        fullname: document.getElementById('fullname').value,
        phone: document.getElementById('phone').value,
        withdrawPass: document.getElementById('withdrawPass').value,
        bankName: document.getElementById('bankName').value,
        bankBranch: document.getElementById('bankBranch').value,
        bankAccount: document.getElementById('bankAccount').value,
        siteSelect: document.getElementById('siteSelect').value
    };
    chrome.storage.local.set({ hi88State: state });
}

function loadState(callback) {
    chrome.storage.local.get(['hi88State'], async function (result) {
        if (result.hi88State) {
            const state = result.hi88State;
            document.getElementById('username').value = state.username || '';
            document.getElementById('password').value = state.password || '';
            document.getElementById('fullname').value = state.fullname || '';
            document.getElementById('phone').value = state.phone || '';
            document.getElementById('withdrawPass').value = state.withdrawPass || '';
            if (state.bankName) document.getElementById('bankName').value = state.bankName;
            document.getElementById('bankBranch').value = state.bankBranch || '';
            document.getElementById('bankAccount').value = state.bankAccount || '';
            
            // Chờ UI dropdown website sẵn sàng
            await initSiteSelectUI();
            if (state.siteSelect) document.getElementById('siteSelect').value = state.siteSelect;
            
            if (callback) callback(true);
        } else {
            // Vẫn cần init dropdown kể cả không có state
            await initSiteSelectUI();
            if (callback) callback(false);
        }
    });
}

// ==========================================
// API KEY MANAGEMENT
// ==========================================

async function loadApiKey() {
    return new Promise(resolve => {
        chrome.storage.local.get(['anticaptchaApiKey'], result => {
            resolve(result.anticaptchaApiKey || '');
        });
    });
}

async function initApiKeyUI() {
    const key = await loadApiKey();
    const input = document.getElementById('apiKeyInput');
    const status = document.getElementById('apiKeyStatus');
    if (key) {
        input.value = key;
        status.textContent = '✅ Có key';
        status.className = 'api-key-status ok';
    } else {
        status.textContent = '❌ Chưa có key';
        status.className = 'api-key-status err';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // nối tiếp sau
}, { once: true });

// ==========================================
// RANDOM ALL
// ==========================================

const setRandomAll = () => {
    const username = generateRandomString(8);
    document.getElementById('username').value = username;
    document.getElementById('password').value = generateRandomPassword(8); // MK random riêng (gồm cả chữ và số)
    document.getElementById('fullname').value = generateRandomName();
    document.getElementById('phone').value = generateRandomPhone();
    document.getElementById('withdrawPass').value = generateRandomWithdrawPass(); // Random 6 số
    
    // Tự động random thêm bank từ datalist
    const bankListOptions = document.getElementById('bankList').options;
    if (bankListOptions && bankListOptions.length > 0) {
        const randomOption = bankListOptions[Math.floor(Math.random() * bankListOptions.length)];
        document.getElementById('bankName').value = randomOption.value;
    }
    document.getElementById('bankBranch').value = generateRandomBranch();
    document.getElementById('bankAccount').value = generateRandomAccount();
    
    saveState();
    addLog('Đã tạo thông tin ngẫu nhiên', 'success');
};

// ==========================================
// MAIN REGISTRATION FLOW
// ==========================================

async function runRegistration(onlyRegister = false) {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const withdrawPass = document.getElementById('withdrawPass').value || password;
    const fullname = document.getElementById('fullname').value;
    const phone = document.getElementById('phone').value;
    const bankName = document.getElementById('bankName').value;
    const bankBranch = document.getElementById('bankBranch').value;
    const bankAccount = document.getElementById('bankAccount').value;

    if (!username || !password || !fullname || !phone) {
        addLog('Vui lòng điền đầy đủ thông tin!', 'error');
        return;
    }

    const site = getSelectedSite();

    // Lấy tab đang active từ cửa sổ trình duyệt (không phải popup)
    const tabs = await chrome.tabs.query({ active: true });
    const tab = tabs.find(t => !t.url.startsWith('chrome-extension://')) || tabs[0];

    if (!tab) {
        addLog('Lỗi: Không tìm thấy tab trình duyệt!', 'error');
        return;
    }

    const displayUrl = site.includes("/Account/Register") ? site : `${site.replace(/\/$/, "")}/Account/Register`;
    addLog(`Đang mở ${displayUrl}...`, 'info');
    chrome.runtime.sendMessage({
        action: onlyRegister ? "runRegisterOnly" : "runFullSequence",
        tabId: tab.id,
        data: { username, password, withdrawPass, fullname, phone, bankName, bankBranch, bankAccount, site }
    });
    addLog('Đã gửi lệnh xuống Background. Tool sẽ tự chạy!', 'success');
}

// ==========================================
// RUN ALL (Random + Register + Captcha)
// ==========================================

async function runAll() {
    addLog('=== BẮT ĐẦU ĐĂNG KÝ + LK NGÂN HÀNG ===', 'info');
    await runRegistration(false);
}

// ==========================================
// TELEGRAM NOTIFICATION
// ==========================================

function sendTelegram(username, password, fullname, phone, site) {
    const text = `🟢 HI88 ĐĂNG KÝ MỚI\n👤 TK: ${username}\n🔑 MK: ${password}\n📝 Tên: ${fullname}\n📱 SĐT: ${phone}\n🌐 Site: ${site}`;
    fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
    }).then(() => {
        addLog('Đã gửi thông tin về Telegram', 'success');
    }).catch(err => {
        addLog('Lỗi gửi Telegram: ' + err.message, 'error');
    });
}

// ==========================================
// CONTENT SCRIPT: FILL FORM + SOLVE CAPTCHA
// (Được inject vào trang web mục tiêu)
// ==========================================

async function fillFormAndSolveCaptcha(username, password, fullname, phone, ocrServer) {
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
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function fillInput(element, value) {
        if (!element) return false;
        element.focus();
        element.value = value;
        triggerEvents(element);
        return true;
    }

    // Đợi phần tử xuất hiện
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

    // Chuyển ảnh captcha sang base64
    function imageToBase64(imgElement) {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () {
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = function () {
                // Fallback: vẽ trực tiếp từ element
                try {
                    canvas.width = imgElement.naturalWidth || imgElement.width;
                    canvas.height = imgElement.naturalHeight || imgElement.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(imgElement, 0, 0);
                    resolve(canvas.toDataURL('image/png'));
                } catch (e) {
                    reject(e);
                }
            };
            img.src = imgElement.src;
        });
    }

    try {
        // XPath cho các trường
        const xpaths = {
            username: "(//input[@placeholder='Vui lòng nhập tên tài khoản'])[1]",
            password: "(//input[@placeholder='Vui lòng nhập mật khẩu'])[1]",
            fullname: "(//input[@placeholder='Họ và tên'])[1]",
            phone: "(//input[@placeholder='Số điện thoại'])[1]",
            captchaImg: "(/html/body/app-root/app-switch/div/section[2]/div/app-register/div/form/fieldset[3]/div[1]/div/img)[1] | (//img[@class='absolute right-7 top-1 h-4/5'])[1] | //img[contains(@src, 'captcha')]",
            submit: "(//span[@translate='Login_RegisterBtn'])[1] | (//button[@type='submit'])[1] | //span[contains(translate(., 'đăngkýngay', 'ĐĂNGKÝNGAY'), 'ĐĂNG KÝ NGAY')]"
        };

        // Đợi 2s cho trang render xong
        await new Promise(r => setTimeout(r, 2000));

        // Tìm input captcha — thử nhiều cách
        // Captcha input thường là input cuối cùng hoặc input gần ảnh captcha
        const findCaptchaInput = () => {
            // Cách 1: Theo yêu cầu của user, tìm đúng thẻ input có placeholder là "Vui lòng nhập mã xác minh"
            let el = getElementByXpath("(//input[@placeholder='Vui lòng nhập mã xác minh'])[1]");
            if (el) return el;

            // Cách 2: Tìm input có placeholder chứa "captcha" hoặc "mã xác nhận" hoặc "xác minh"
            el = getElementByXpath("(//input[contains(@placeholder,'captcha') or contains(@placeholder,'Captcha') or contains(@placeholder,'mã') or contains(@placeholder,'xác')])[1]");
            if (el) return el;

            // Cách 2: Input gần ảnh captcha nhất
            const captchaImg = getElementByXpath(xpaths.captchaImg);
            if (captchaImg) {
                const parent = captchaImg.closest('div');
                if (parent) {
                    el = parent.querySelector('input');
                    if (el) return el;
                    // Tìm ở thẻ cha cao hơn
                    const grandParent = parent.parentElement;
                    if (grandParent) {
                        el = grandParent.querySelector('input');
                        if (el) return el;
                    }
                }
            }

            // Cách 3: Input cuối cùng trên form (thường là captcha)
            const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
            if (allInputs.length > 0) {
                return allInputs[allInputs.length - 1];
            }

            return null;
        };

        // BƯỚC 1: Điền thông tin
        const inputTk = await waitForElement(xpaths.username);
        fillInput(inputTk, username);
        await new Promise(r => setTimeout(r, 300));

        const inputMk = await waitForElement(xpaths.password);
        fillInput(inputMk, password);
        await new Promise(r => setTimeout(r, 300));

        const inputName = await waitForElement(xpaths.fullname);
        fillInput(inputName, fullname);
        await new Promise(r => setTimeout(r, 300));

        const inputPhone = await waitForElement(xpaths.phone);
        fillInput(inputPhone, phone);
        await new Promise(r => setTimeout(r, 300));

        // BƯỚC 2: Verify lại data (phòng framework React/Vue reset)
        await new Promise(r => setTimeout(r, 1000));
        if (inputTk && inputTk.value !== username) fillInput(inputTk, username);
        if (inputMk && inputMk.value !== password) fillInput(inputMk, password);
        if (inputName && inputName.value !== fullname) fillInput(inputName, fullname);
        if (inputPhone && inputPhone.value !== phone) fillInput(inputPhone, phone);

        // BƯỚC 3: Quét captcha OCR
        const imgCaptcha = await waitForElement(xpaths.captchaImg, 8000);
        const inputCaptcha = findCaptchaInput();

        let captchaText = '';
        let debugLog = `Tiền kiểm tra: imgCaptcha? ${!!imgCaptcha}, inputCaptcha? ${!!inputCaptcha}. `;

        if (inputCaptcha) {
            // Thử quét tối đa 3 lần
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    debugLog += `| Lần ${attempt}: `;
                    
                    // 1. Click vào input để load captcha mới
                    inputCaptcha.click();
                    inputCaptcha.focus();
                    
                    // 2. Đợi một chút cho ảnh captcha mới load xong
                    await new Promise(r => setTimeout(r, 1200));
                    
                    // 3. Lấy lại element ảnh captcha mới sau khi click
                    const currentImgCaptcha = await waitForElement(xpaths.captchaImg, 3000);
                    if (!currentImgCaptcha) {
                        debugLog += `Không tìm thấy thẻ img. `;
                        continue;
                    }

                    // 4. Chuyển ảnh sang base64
                    const base64 = await imageToBase64(currentImgCaptcha);
                    
                    // Gửi đến OCR server (qua background để tránh lỗi Mixed Content/CORS trên https)
                    const result = await new Promise(resolve => {
                        chrome.runtime.sendMessage({ action: "solveCaptcha", image: base64 }, response => {
                            if (chrome.runtime.lastError) {
                                resolve({ success: false, error: chrome.runtime.lastError.message });
                            } else {
                                resolve(response || { success: false, error: "No response" });
                            }
                        });
                    });

                    if (result.success && result.text) {
                        captchaText = result.text.trim().replace(/\s/g, '');
                        debugLog += `Giải ra: ${captchaText}. `;

                        if (captchaText.length >= 2) {
                            fillInput(inputCaptcha, captchaText);
                            
                            // Đợi tầm 1s lấy lại ảnh base64 trên web gửi lên kiểm tra lại
                            await new Promise(r => setTimeout(r, 1000));
                            const verifyImg = await waitForElement(xpaths.captchaImg, 3000);
                            if (verifyImg) {
                                const verifyBase64 = await imageToBase64(verifyImg);
                                const verifyResult = await new Promise(resolve => {
                                    chrome.runtime.sendMessage({ action: "solveCaptcha", image: verifyBase64 }, response => {
                                        if (chrome.runtime.lastError) {
                                            resolve({ success: false });
                                        } else {
                                            resolve(response || { success: false });
                                        }
                                    });
                                });
                                if (verifyResult.success && verifyResult.text) {
                                    const verifyText = verifyResult.text.trim().replace(/\s/g, '');
                                    if (verifyText !== captchaText && verifyText.length >= 2) {
                                        debugLog += `Phát hiện captcha tự thay đổi! Điền mã mới: ${verifyText}. `;
                                        captchaText = verifyText;
                                        fillInput(inputCaptcha, captchaText);
                                    } else {
                                        debugLog += `Mã khớp hoặc không đổi. `;
                                    }
                                }
                            }
                            break; // Thành công, thoát vòng lặp
                        }
                    } else {
                        debugLog += `OCR lỗi: ${result.error || 'unknown'}. `;
                    }

                    // Nếu kết quả quá ngắn, click ảnh để refresh captcha
                    if (attempt < 3) {
                        currentImgCaptcha.click();
                        await new Promise(r => setTimeout(r, 1500));
                    }
                } catch (err) {
                    debugLog += `LỖI EXCEPTION: ${err.message}. `;
                    if (attempt < 3) {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }
        } else {
            debugLog += `KHÔNG TÌM THẤY Ô NHẬP. `;
        }

        if (!captchaText || captchaText.length < 2) {
            return { success: false, error: debugLog };
        }

        // BƯỚC 4: Click nút đăng ký
        await new Promise(r => setTimeout(r, 1000));
        
        console.log("[Hi88 Debug] Bắt đầu click nút Đăng Ký...");

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

        // 1. Quét mọi thẻ có tiềm năng là nút Đăng Ký và click hết
        let clickCount = 0;
        const allElements = document.querySelectorAll('button, div, span, a, input[type="submit"]');
        for (let el of allElements) {
            const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
            if (text === 'ĐĂNG KÝ NGAY' || text === 'ĐĂNG KÝ' || el.type === 'submit') {
                console.log("[Hi88 Debug] Đang ép click vào:", el);
                triggerClick(el);
                clickCount++;
                
                const parentBtn = el.closest('button');
                if (parentBtn && parentBtn !== el) {
                    triggerClick(parentBtn);
                }
            }
        }

        // 2. Click theo XPath user đưa
        const btnSubmitXpath = getElementByXpath(xpaths.submit);
        if (btnSubmitXpath) {
            triggerClick(btnSubmitXpath);
            clickCount++;
        }

        // 3. Giả lập Enter trên form
        const inputCaptchaEl = findCaptchaInput();
        if (inputCaptchaEl) {
            inputCaptchaEl.focus();
            inputCaptchaEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            inputCaptchaEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }

        // 4. Force Submit Form
        const forms = document.querySelectorAll('form');
        forms.forEach(f => {
            try { f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } catch(e){}
            try { f.submit(); } catch(e){}
        });

        if (clickCount === 0 && forms.length === 0) {
            console.error("[Hi88 Debug] Lỗi: Không tìm thấy bất kỳ nút hoặc form nào để click!");
        }

        return {
            success: true,
            captchaText: captchaText,
            fieldsFound: {
                username: !!inputTk,
                password: !!inputMk,
                fullname: !!inputName,
                phone: !!inputPhone,
                captchaImg: !!imgCaptcha,
                captchaInput: !!inputCaptcha,
                submitBtn: !!btnSubmit
            }
        };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ==========================================
// EVENT LISTENERS
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // Load API key và hiển thị trạng thái
    initApiKeyUI();

    // Nút ẩn/hiện key
    const toggleBtn = document.getElementById('toggleApiKeyBtn');
    const apiKeyInput = document.getElementById('apiKeyInput');
    toggleBtn.addEventListener('click', () => {
        if (apiKeyInput.type === 'password') {
            apiKeyInput.type = 'text';
            toggleBtn.textContent = '🙈';
        } else {
            apiKeyInput.type = 'password';
            toggleBtn.textContent = '👁️';
        }
    });

    // Nút Lưu key
    document.getElementById('saveApiKeyBtn').addEventListener('click', () => {
        const key = document.getElementById('apiKeyInput').value.trim();
        const status = document.getElementById('apiKeyStatus');
        if (!key) {
            status.textContent = '❌ Trống!';
            status.className = 'api-key-status err';
            return;
        }
        chrome.storage.local.set({ anticaptchaApiKey: key }, () => {
            status.textContent = '✅ Đã lưu!';
            status.className = 'api-key-status ok';
        });
    });



    // Thêm link website mới
    document.getElementById('addSiteBtn').addEventListener('click', async () => {
        let val = document.getElementById('newSiteInput').value.trim();
        if (!val) return;

        // Chuẩn hóa giao thức https:// nếu thiếu
        if (!val.startsWith('http://') && !val.startsWith('https://')) {
            val = 'https://' + val;
        }

        // Tự động bỏ các ký tự gạch chéo cuối url nếu có trước khi check
        if (val.endsWith('/')) {
            val = val.slice(0, -1);
        }

        // Nếu link chưa có phần đuôi đăng ký thì tự động thêm vào
        if (!val.includes('/Account/Register')) {
            val = val + '/Account/Register';
        }

        const list = await loadWebsites();
        if (!list.includes(val)) {
            list.push(val);
            chrome.storage.local.set({ customWebsites: list }, async () => {
                await initSiteSelectUI();
                document.getElementById('siteSelect').value = val;
                document.getElementById('newSiteInput').value = '';
                saveState();
                addLog('Đã thêm link mới: ' + val, 'success');
            });
        } else {
            addLog('Link này đã tồn tại trong danh sách!', 'error');
        }
    });

    // Xóa link website đang chọn
    document.getElementById('deleteSiteBtn').addEventListener('click', async () => {
        const select = document.getElementById('siteSelect');
        const val = select.value;
        if (!val) return;

        let list = await loadWebsites();
        list = list.filter(item => item !== val);
        chrome.storage.local.set({ customWebsites: list }, async () => {
            await initSiteSelectUI();
            saveState();
            addLog('Đã xóa link: ' + val, 'info');
        });
    });

    // Load saved state
    loadState(async (hasState) => {
        if (!hasState) {
            setRandomAll();
        }
    });

    // Auto save khi thay đổi
    const inputs = ['username', 'password', 'fullname', 'phone', 'withdrawPass', 'bankName', 'bankBranch', 'bankAccount', 'siteSelect'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', saveState);
            el.addEventListener('change', saveState);
        }
    });
});

// Random All
document.getElementById('randomAllBtn').addEventListener('click', setRandomAll);

// Random từng field
document.getElementById('randomUserBtn').addEventListener('click', () => {
    document.getElementById('username').value = generateRandomString(8);
    saveState();
});

document.getElementById('randomPassBtn').addEventListener('click', () => {
    document.getElementById('password').value = document.getElementById('username').value + '1';
    saveState();
});

document.getElementById('randomNameBtn').addEventListener('click', () => {
    document.getElementById('fullname').value = generateRandomName();
    saveState();
});

document.getElementById('randomPhoneBtn').addEventListener('click', () => {
    document.getElementById('phone').value = generateRandomPhone();
    saveState();
});

document.getElementById('randomWithdrawBtn').addEventListener('click', () => {
    document.getElementById('withdrawPass').value = generateRandomWithdrawPass();
    saveState();
});

document.getElementById('randomBranchBtn').addEventListener('click', () => {
    document.getElementById('bankBranch').value = generateRandomBranch();
    saveState();
});

document.getElementById('randomAccountBtn').addEventListener('click', () => {
    document.getElementById('bankAccount').value = generateRandomAccount();
    saveState();
});

// Nút đăng ký
document.getElementById('fillBtn').addEventListener('click', async () => {
    const btn = document.getElementById('fillBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Đang xử lý...';
    btn.disabled = true;
    try {
        await runRegistration(true);
    } catch (e) {
        addLog('Lỗi: ' + e.message, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

// Nút Kịch bản 2 - Liên kết rút tiền (Chạy độc lập)
document.getElementById('moneyPassBtn').addEventListener('click', async () => {
    const btn = document.getElementById('moneyPassBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Đang chạy...';
    btn.disabled = true;
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const fullname = document.getElementById('fullname').value;
    const phone = document.getElementById('phone').value;
    const withdrawPass = document.getElementById('withdrawPass').value || password;
    const bankName = document.getElementById('bankName').value;
    const bankBranch = document.getElementById('bankBranch').value;
    const bankAccount = document.getElementById('bankAccount').value;
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
        if (!withdrawPass) {
            addLog('Lỗi: Cần mật khẩu để cài rút tiền!', 'error');
        } else {
            // Gửi lệnh lên background để nó executeScript
            chrome.runtime.sendMessage({ 
                action: 'runMoneyPass', 
                tabId: tab.id, 
                url: tab.url, 
                username: username,
                password: password, // MK Đăng nhập
                withdrawPass: withdrawPass, // MK Rút tiền
                bankName: bankName,
                bankBranch: bankBranch,
                bankAccount: bankAccount
            });
            addLog('Đang chạy Liên kết NH...', 'info');
        }
    } else {
        addLog('Hãy mở trang Hi88 trước!', 'error');
    }
    
    btn.innerHTML = originalText;
    btn.disabled = false;
});

// Nút chạy all
document.getElementById('runAllBtn').addEventListener('click', async () => {
    const btn = document.getElementById('runAllBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Đang chạy...';
    btn.disabled = true;
    try {
        await runAll();
    } catch (e) {
        addLog('Lỗi runAll: ' + e.message, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});
