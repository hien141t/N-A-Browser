// ==========================================
// i9 Auto Register - Popup Controller
// ==========================================

const DEFAULT_WEBSITES = [
    "https://m.i9bet331.com/Account/Register?r=NR6K77"
];

// Telegram Bot Settings (Cấu hình sẵn của bạn)
const TELEGRAM_TOKEN = ""; // Removed: configure securely at runtime
const TELEGRAM_CHAT_ID = "7651644672";

// ==========================================
// UTILITY FUNCTIONS & RANDOM GENERATORS
// ==========================================

function generateRandomString(length = 8) {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = letters.charAt(Math.floor(Math.random() * letters.length)); // Ký tự đầu là chữ
    for (let i = 1; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function generateRandomPassword(length = 10) {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    let res = letters.charAt(Math.floor(Math.random() * letters.length));
    for (let i = 0; i < 4; i++) {
        res += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    for (let i = 0; i < 4; i++) {
        res += numbers.charAt(Math.floor(Math.random() * numbers.length));
    }
    return res; // e.g. "abcde1234" (9 chars: 5 letters + 4 digits)
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
    return '0';
}

function renderSavedAccounts() {
    chrome.storage.local.get(['savedAccounts'], (result) => {
        const list = result.savedAccounts || [];
        const countEl = document.getElementById('savedAccCount');
        const listEl = document.getElementById('savedAccList');
        if (!countEl || !listEl) return;

        countEl.textContent = list.length;
        if (list.length === 0) {
            listEl.innerHTML = '<div style="color: #64748b; text-align: center; padding: 8px;">Chưa có tài khoản nào được lưu.</div>';
            return;
        }

        let html = '';
        list.forEach((acc, i) => {
            html += `<div style="padding: 4px 0; border-bottom: 1px dashed #1f293d; color: #cbd5e1;">
                <span style="color:#38bdf8; font-weight:bold;">#${i + 1} TK:</span> ${acc.username} | 
                <span style="color:#f59e0b;">MK:</span> ${acc.password} | 
                <span style="color:#ec4899;">MK Rút:</span> ${acc.withdrawPass || '0'}
                <div style="font-size: 9.5px; color: #64748b;">Tên: ${acc.fullname || 'N/A'} | SĐT: ${acc.phone || ''} | Site: ${acc.site || ''}</div>
            </div>`;
        });
        listEl.innerHTML = html;
    });
}

function generateRandomBranch() {
    const branches = ['HA NOI', 'HO CHI MINH', 'DA NANG', 'HAI PHONG', 'CAN THO', 'DONG NAI', 'BINH DUONG', 'QUANG NINH', 'KHANH HOA'];
    return branches[Math.floor(Math.random() * branches.length)];
}

function generateRandomAccount() {
    const len = Math.floor(Math.random() * 4) + 10; // 10-13 số
    let res = '';
    for (let i = 0; i < len; i++) {
        res += Math.floor(Math.random() * 10);
    }
    return res;
}

function getSelectedSite() {
    const select = document.getElementById('siteSelect');
    return select.value || 'https://m.i9bet331.com/Account/Register?r=NR6K77';
}

async function loadWebsites() {
    return new Promise(resolve => {
        chrome.storage.local.get(['i9CustomWebsites'], result => {
            let list = result.i9CustomWebsites || [];
            if (list.length === 0) {
                list = [...DEFAULT_WEBSITES];
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
// LOGGING TO POPUP
// ==========================================

function addLog(message, type = 'info') {
    const logBox = document.getElementById('logBox');
    if (!logBox) return;

    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const time = new Date().toLocaleTimeString('vi-VN');
    entry.textContent = `[${time}] ${message}`;

    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;
}

// ==========================================
// STATE MANAGEMENT
// ==========================================

function syncPasswordConfirm() {
    const pass = document.getElementById('password').value;
    document.getElementById('confirmPassword').value = pass;
}

function saveState() {
    syncPasswordConfirm();
    const state = {
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        fullname: document.getElementById('fullname').value,
        phone: document.getElementById('phone').value,
        withdrawPass: document.getElementById('withdrawPass').value,
        bankName: document.getElementById('bankName').value,
        bankBranch: document.getElementById('bankBranch').value,
        bankAccount: document.getElementById('bankAccount').value,
        siteSelect: document.getElementById('siteSelect').value,
        promoUrl: document.getElementById('promoUrl')?.value,
        depositAmount: document.getElementById('depositAmount')?.value
    };
    chrome.storage.local.set({ i9State: state });
}

function loadState(callback) {
    chrome.storage.local.get(['i9State'], async function (result) {
        if (result.i9State) {
            const state = result.i9State;
            document.getElementById('username').value = state.username || '';
            document.getElementById('password').value = state.password || '';
            document.getElementById('confirmPassword').value = state.password || '';
            document.getElementById('fullname').value = state.fullname || '';
            document.getElementById('phone').value = state.phone || '';
            document.getElementById('withdrawPass').value = state.withdrawPass || '';
            if (state.bankName) document.getElementById('bankName').value = state.bankName;
            document.getElementById('bankBranch').value = state.bankBranch || '';
            document.getElementById('bankAccount').value = state.bankAccount || '';
            if (state.promoUrl && document.getElementById('promoUrl')) document.getElementById('promoUrl').value = state.promoUrl;
            if (state.depositAmount && document.getElementById('depositAmount')) document.getElementById('depositAmount').value = state.depositAmount;
            
            await initSiteSelectUI();
            if (state.siteSelect) document.getElementById('siteSelect').value = state.siteSelect;
            
            if (callback) callback(true);
        } else {
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

// ==========================================
// RANDOM ALL
// ==========================================

const setRandomAll = () => {
    const username = generateRandomString(8);
    const pass = generateRandomPassword(9);
    
    document.getElementById('username').value = username;
    document.getElementById('password').value = pass;
    document.getElementById('confirmPassword').value = pass;
    document.getElementById('fullname').value = generateRandomName();
    document.getElementById('phone').value = generateRandomPhone();
    document.getElementById('withdrawPass').value = generateRandomWithdrawPass();
    
    const bankListOptions = document.getElementById('bankList').options;
    if (bankListOptions && bankListOptions.length > 0) {
        const randomOption = bankListOptions[Math.floor(Math.random() * bankListOptions.length)];
        document.getElementById('bankName').value = randomOption.value;
    }
    document.getElementById('bankBranch').value = generateRandomBranch();
    document.getElementById('bankAccount').value = generateRandomAccount();
    
    saveState();
    addLog('Đã tạo thông tin ngẫu nhiên mới!', 'success');
};

// ==========================================
// REGISTRATION RUNNER
// ==========================================

async function runRegistration(onlyRegister = false) {
    saveState();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const withdrawPass = document.getElementById('withdrawPass').value || password;
    const fullname = document.getElementById('fullname').value;
    const phone = document.getElementById('phone').value;
    const bankName = document.getElementById('bankName').value;
    const bankBranch = document.getElementById('bankBranch').value;
    const bankAccount = document.getElementById('bankAccount').value;

    if (!username || !password || !fullname || !phone) {
        addLog('Vui lòng điền đầy đủ Tên TK, Mật khẩu, Họ tên và SĐT!', 'error');
        return;
    }

    const site = getSelectedSite();
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs.find(t => !t.url.startsWith('chrome-extension://')) || tabs[0];

    if (!tab) {
        addLog('Lỗi: Không tìm thấy tab trình duyệt!', 'error');
        return;
    }

    const displayUrl = site.includes("/Account/Register") ? site : `${site.replace(/\/$/, "")}/Account/Register`;
    addLog(`Đang gửi lệnh đến ${displayUrl}...`, 'info');
    
    chrome.runtime.sendMessage({
        action: onlyRegister ? "runRegisterOnly" : "runFullSequence",
        tabId: tab.id,
        data: { username, password, withdrawPass, fullname, phone, bankName, bankBranch, bankAccount, site }
    });
    
    addLog('Đã phát lệnh chạy ngầm thành công!', 'success');
}

// ==========================================
// EVENT LISTENERS & DOM INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    initApiKeyUI();

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
            addLog('Đã lưu API Key mới!', 'success');
        });
    });

    document.getElementById('addSiteBtn').addEventListener('click', async () => {
        let val = document.getElementById('newSiteInput').value.trim();
        if (!val) return;

        if (!val.startsWith('http://') && !val.startsWith('https://')) {
            val = 'https://' + val;
        }
        if (val.endsWith('/')) {
            val = val.slice(0, -1);
        }
        if (!val.includes('/Account/Register')) {
            val = val + '/Account/Register';
        }

        const list = await loadWebsites();
        if (!list.includes(val)) {
            list.push(val);
            chrome.storage.local.set({ i9CustomWebsites: list }, async () => {
                await initSiteSelectUI();
                document.getElementById('siteSelect').value = val;
                document.getElementById('newSiteInput').value = '';
                saveState();
                addLog('Đã thêm URL mới: ' + val, 'success');
            });
        } else {
            addLog('Website này đã có trong danh sách!', 'error');
        }
    });

    document.getElementById('deleteSiteBtn').addEventListener('click', async () => {
        const select = document.getElementById('siteSelect');
        const val = select.value;
        if (!val) return;

        let list = await loadWebsites();
        list = list.filter(item => item !== val);
        chrome.storage.local.set({ i9CustomWebsites: list }, async () => {
            await initSiteSelectUI();
            saveState();
            addLog('Đã xóa website: ' + val, 'info');
        });
    });

    loadState(async (hasState) => {
        if (!hasState) {
            setRandomAll();
        }
    });

    // Render saved accounts list & listen for changes
    renderSavedAccounts();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.savedAccounts) {
            renderSavedAccounts();
        }
    });

    // Copy all accounts button
    document.getElementById('copyAllAccBtn')?.addEventListener('click', () => {
        chrome.storage.local.get(['savedAccounts'], (result) => {
            const list = result.savedAccounts || [];
            if (list.length === 0) {
                addLog('Chưa có tài khoản nào để copy!', 'error');
                return;
            }
            let text = list.map(a => `TK: ${a.username} | MK: ${a.password} | MK Rút: ${a.withdrawPass || '0'} | Tên: ${a.fullname} | SĐT: ${a.phone} | Site: ${a.site}`).join('\n');
            navigator.clipboard.writeText(text).then(() => {
                addLog(`Đã sao chép ${list.length} tài khoản!`, 'success');
            });
        });
    });

    // Export TXT button
    document.getElementById('exportTxtBtn')?.addEventListener('click', () => {
        chrome.storage.local.get(['savedAccounts'], (result) => {
            const list = result.savedAccounts || [];
            if (list.length === 0) {
                addLog('Chưa có tài khoản nào để tải!', 'error');
                return;
            }
            let text = list.map(a => `TK: ${a.username} | MK: ${a.password} | MK Rút: ${a.withdrawPass || '0'} | Tên: ${a.fullname} | SĐT: ${a.phone} | NH: ${a.bankName} | STK: ${a.bankAccount} | Site: ${a.site} | Time: ${a.time}`).join('\n');
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `i9_tai_khoan_${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
            addLog(`Đã tải file TXT (${list.length} TK)!`, 'success');
        });
    });

    // Clear saved accounts history
    document.getElementById('clearAccBtn')?.addEventListener('click', () => {
        if (confirm('Bạn có chắc muốn xóa tất cả lịch sử tài khoản đã lưu không?')) {
            chrome.storage.local.set({ savedAccounts: [] }, () => {
                renderSavedAccounts();
                addLog('Đã xóa toàn bộ lịch sử tài khoản!', 'info');
            });
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

// Single Field Random Buttons
document.getElementById('randomAllBtn').addEventListener('click', setRandomAll);

document.getElementById('randomUserBtn').addEventListener('click', () => {
    document.getElementById('username').value = generateRandomString(8);
    saveState();
});

document.getElementById('randomPassBtn').addEventListener('click', () => {
    const pass = generateRandomPassword(9);
    document.getElementById('password').value = pass;
    document.getElementById('confirmPassword').value = pass;
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

// Action Buttons
document.getElementById('fillBtn').addEventListener('click', async () => {
    const btn = document.getElementById('fillBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Đang gửi...';
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

document.getElementById('runAllBtn').addEventListener('click', async () => {
    addLog('=== BẮT ĐẦU ĐĂNG KÝ + LK NGÂN HÀNG ===', 'info');
    await runRegistration(false);
});

document.getElementById('moneyPassBtn').addEventListener('click', async () => {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const fullname = document.getElementById('fullname').value;
    const phone = document.getElementById('phone').value;
    const withdrawPass = document.getElementById('withdrawPass').value || '0';
    const bankName = document.getElementById('bankName').value;
    const bankBranch = document.getElementById('bankBranch').value;
    const bankAccount = document.getElementById('bankAccount').value;
    const site = getSelectedSite();

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs.find(t => !t.url.startsWith('chrome-extension://')) || tabs[0];
    if (!tab) return;

    addLog('Chạy kịch bản Liên Kết Ngân Hàng...', 'info');
    chrome.runtime.sendMessage({
        action: "runMoneyPass",
        tabId: tab.id,
        url: site,
        username, password, withdrawPass, fullname, phone, bankName, bankBranch, bankAccount
    });
});

document.getElementById('promoBtn')?.addEventListener('click', async () => {
    const username = document.getElementById('username').value;
    const depositAmount = document.getElementById('depositAmount').value || '50';
    const promoUrl = document.getElementById('promoUrl').value || 'https://i9sanh.cc/Activity/detail/id/111';

    if (!username) {
        addLog('Vui lòng nhập tên tài khoản!', 'error');
        return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs.find(t => !t.url.startsWith('chrome-extension://')) || tabs[0];
    if (!tab) return;

    addLog(`Đang chuyển hướng sang Xin KM cho TK '${username}'...`, 'info');
    chrome.runtime.sendMessage({
        action: "runPromo",
        tabId: tab.id,
        username: username,
        depositAmount: depositAmount,
        promoUrl: promoUrl
    });
});

