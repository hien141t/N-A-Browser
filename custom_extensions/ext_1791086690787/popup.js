function generateRandomName() {
    const fullNames = [
        'HOANG TRANG HIEN',
        'NONG THANH TOAN',
        'NGO KA CHI',
        'HOANG VAN KHANH',
        'TRUONG THI LIEN',
        'LE VAN THANG',
        'TRAN VAN LONG',
        'PHAM THI DIEU',
        'NGUYEN VAN HAI',
        'VU DINH TRONG',
        'DANG TIEN DUNG',
        'BUI MINH TUAN',
        'NGUYEN THANH LONG',
        'TRAN ANH DUC',
        'PHAM QUOC TRUONG'
    ];
    return fullNames[Math.floor(Math.random() * fullNames.length)];
}

function generateRandomPhone() {
    const prefixes = ['090', '091', '092', '093', '094', '096', '097', '098', '081', '082', '083', '085', '088', '070', '076', '077', '078', '079', '032', '033', '034', '035', '036', '037', '038', '039', '052', '056', '058'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    let suffix = '';
    for (let i = 0; i < 7; i++) {
        suffix += Math.floor(Math.random() * 10);
    }
    return prefix + suffix;
}

function generateRandomBankAcc() {
    const len = Math.floor(Math.random() * 6) + 7; // 7 to 12 digits
    let acc = '';
    for (let i = 0; i < len; i++) {
        acc += Math.floor(Math.random() * 10);
    }
    return acc;
}

function isMatchingDomain(tabUrl, targetUrl) {
    if (!tabUrl) return false;
    try {
        const tabHost = new URL(tabUrl).hostname.toLowerCase();
        const targetHost = new URL(targetUrl).hostname.toLowerCase();
        if (tabHost === targetHost) return true;
        if (tabHost.includes('cloudfront.net') || tabHost.includes('58w') || tabHost.includes('58win')) return true;
        return false;
    } catch(e) {
        return tabUrl.includes('cloudfront.net') || tabUrl.includes('58w') || tabUrl.includes('58win');
    }
}

function runScenario(dataKey, dataValue, fallbackUrl, actionName) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0) {
            const activeTab = tabs[0];
            const url = activeTab.url || '';
            
            if (isMatchingDomain(url, fallbackUrl)) {
                const dataObj = {};
                dataObj[dataKey] = dataValue;
                chrome.storage.local.set(dataObj, () => {
                    chrome.tabs.sendMessage(activeTab.id, { action: actionName, data: dataValue }, (response) => {
                        if (chrome.runtime.lastError || !response) {
                            // Tab đã mở trước khi cài tiện ích: nạp script trực tiếp
                            chrome.scripting.executeScript({
                                target: { tabId: activeTab.id, allFrames: true },
                                files: ['captcha.js', 'content.js']
                            }).then(() => {
                                setTimeout(() => {
                                    chrome.tabs.sendMessage(activeTab.id, { action: actionName, data: dataValue });
                                }, 300);
                            }).catch(err => {
                                console.error("Inject script error:", err);
                                chrome.tabs.reload(activeTab.id);
                            });
                        }
                    });
                });
                return;
            }
        }
        
        // Mở link mới nếu chưa mở trang web
        const dataObj = {};
        dataObj[dataKey] = dataValue;
        chrome.storage.local.set(dataObj, () => {
            chrome.tabs.create({ url: fallbackUrl });
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Load stored settings
    chrome.storage.local.get(['popupSettings58WWin', 'lastRegistered'], (result) => {
        if (result.popupSettings58WWin) {
            ['regLink', 'withdrawLink', 'fullName', 'phoneNumber', 'bankAcc', 'bankName'].forEach(id => {
                const el = document.getElementById(id);
                if (el && result.popupSettings58WWin[id] !== undefined) {
                    el.value = result.popupSettings58WWin[id];
                }
            });
        }
        if (result.lastRegistered && (result.lastRegistered.phone || result.lastRegistered.username)) {
            document.getElementById('lastRegisteredSection').style.display = 'block';
            document.getElementById('lastPhone').textContent = result.lastRegistered.phone || result.lastRegistered.username;
            document.getElementById('lastPass').textContent = result.lastRegistered.password;
        }
    });

    // Save settings on input change
    ['regLink', 'withdrawLink', 'fullName', 'phoneNumber', 'bankAcc', 'bankName'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', saveSettings);
    });
    document.getElementById('bankName').addEventListener('change', saveSettings);

    // Individual randomize buttons
    document.getElementById('randomNameBtn').addEventListener('click', () => {
        document.getElementById('fullName').value = generateRandomName();
        saveSettings();
    });

    document.getElementById('randomPhoneBtn').addEventListener('click', () => {
        document.getElementById('phoneNumber').value = generateRandomPhone();
        saveSettings();
    });

    document.getElementById('randomBankAccBtn').addEventListener('click', () => {
        document.getElementById('bankAcc').value = generateRandomBankAcc();
        saveSettings();
    });

    document.getElementById('randomBankNameBtn').addEventListener('click', () => {
        const bankSelect = document.getElementById('bankName');
        const bankOptions = bankSelect.options;
        let targetIndex = -1;
        for (let i = 0; i < bankOptions.length; i++) {
            if (bankOptions[i].value === 'Liobank') {
                targetIndex = i;
                break;
            }
        }
        if (Math.random() < 0.7 && targetIndex !== -1) {
            bankSelect.selectedIndex = targetIndex;
        } else {
            const randomBankIndex = Math.floor(Math.random() * bankOptions.length);
            bankSelect.selectedIndex = randomBankIndex;
        }
        saveSettings();
    });

    // Randomize all fields button
    document.getElementById('randomAllBtn').addEventListener('click', () => {
        document.getElementById('fullName').value = generateRandomName();
        document.getElementById('phoneNumber').value = generateRandomPhone();
        document.getElementById('bankAcc').value = generateRandomBankAcc();

        // Select random bank (prioritize Liobank)
        const bankSelect = document.getElementById('bankName');
        const bankOptions = bankSelect.options;
        let targetIndex = -1;
        for (let i = 0; i < bankOptions.length; i++) {
            if (bankOptions[i].value === 'Liobank') {
                targetIndex = i;
                break;
            }
        }
        
        if (Math.random() < 0.7 && targetIndex !== -1) {
            bankSelect.selectedIndex = targetIndex;
        } else {
            const randomBankIndex = Math.floor(Math.random() * bankOptions.length);
            bankSelect.selectedIndex = randomBankIndex;
        }

        saveSettings();
    });

    // Button: run sequential scenarios
    document.getElementById('runSequentialBtn').addEventListener('click', () => {
        saveSettings();
        const regLink = document.getElementById('regLink').value.trim();
        const withdrawLink = document.getElementById('withdrawLink').value.trim();
        const fullName = document.getElementById('fullName').value;
        let phoneNumber = document.getElementById('phoneNumber').value;
        if (phoneNumber.startsWith('0')) phoneNumber = phoneNumber.substring(1);
        const bankAcc = document.getElementById('bankAcc').value;
        const bankName = document.getElementById('bankName').value;

        chrome.storage.local.set({
            withdrawData: { bankAcc, bankName },
            isSequentialMode: true,
            withdrawLinkVal: withdrawLink
        }, () => {
            runScenario('autoFillData', { fullName, phoneNumber, bankAcc, bankName }, regLink, 'fillForm');
        });
    });

    // Button: fill registration form
    document.getElementById('fillFormBtn').addEventListener('click', () => {
        saveSettings();
        const regLink = document.getElementById('regLink').value.trim();
        const fullName = document.getElementById('fullName').value;
        let phoneNumber = document.getElementById('phoneNumber').value;
        if (phoneNumber.startsWith('0')) phoneNumber = phoneNumber.substring(1);
        const bankAcc = document.getElementById('bankAcc').value;
        const bankName = document.getElementById('bankName').value;

        runScenario('autoFillData', { fullName, phoneNumber, bankAcc, bankName }, regLink, 'fillForm');
    });

    // Button: withdraw and bind bank
    document.getElementById('withdrawFormBtn').addEventListener('click', () => {
        saveSettings();
        const withdrawLink = document.getElementById('withdrawLink').value.trim();
        const bankAcc = document.getElementById('bankAcc').value;
        const bankName = document.getElementById('bankName').value;

        runScenario('withdrawData', { bankAcc, bankName }, withdrawLink, 'runWithdraw');
    });

    // Clipboard copy
    document.getElementById('copyLastPhone').addEventListener('click', () => {
        const ph = document.getElementById('lastPhone').textContent;
        navigator.clipboard.writeText(ph);
    });

    document.getElementById('copyLastPass').addEventListener('click', () => {
        const p = document.getElementById('lastPass').textContent;
        navigator.clipboard.writeText(p);
    });
});

function saveSettings() {
    chrome.storage.local.set({
        popupSettings58WWin: {
            regLink: document.getElementById('regLink').value,
            withdrawLink: document.getElementById('withdrawLink').value,
            fullName: document.getElementById('fullName').value,
            phoneNumber: document.getElementById('phoneNumber').value,
            bankAcc: document.getElementById('bankAcc').value,
            bankName: document.getElementById('bankName').value
        }
    });
}
