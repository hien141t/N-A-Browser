// ======= Captcha Solver Module ======= //

// Helper delay function specific to captcha module to avoid global collision
const captchaDelay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function handleSliderCaptcha() {
    // Selectors targeting elements precisely using class names
    const bgSelector = '.botion_bg, .geetest_bg, [class*="botion_bg"], [class*="geetest_canvas_bg"]';
    // Prioritize button classes and avoid general container classes like 'botion_slider' which represents the track container
    const sliderSelector = '.botion_btn, .botion_slider_btn, .geetest_slider_button, [class*="slider_btn"], [class*="slider_button"], [class*="botion_btn"]';
    const sliceSelector = '.botion_slice_bg, .geetest_slice_bg, [class*="botion_slice"], [class*="geetest_slice_char"]';

    // Fallback XPaths in case class names differ
    const xpathBg1 = "/html/body/div[3]/div[1]/div[1]/div[2]/div/div/div[1]/div[2]";
    const xpathSlider1 = "/html/body/div[3]/div[1]/div[1]/div[2]/div/div/div[2]/div/div[3]/div";
    const xpathBg2 = "/html/body/div[2]/div[1]/div[1]/div[2]/div/div/div[1]/div[2]";
    const xpathSlider2 = "/html/body/div[2]/div[1]/div[1]/div[2]/div/div/div[2]/div/div[3]/div";
    const xpathSlice1 = "/html/body/div[3]/div[1]/div[1]/div[2]/div/div/div[1]/div[1]/div[1]";
    const xpathSlice2 = "/html/body/div[2]/div[1]/div[1]/div[2]/div/div/div[1]/div[1]/div[1]";
    
    const OFFSET_ADJUST = 0; 

    function findElement(selector, xpath) {
        // 1. Try class-based selector first
        let el = document.querySelector(selector);
        if (el) return { element: el, doc: document };
        
        // 2. Try xpath next
        if (xpath) {
            el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (el) return { element: el, doc: document };
        }
        
        // 3. Scan inside iframes
        const frames = document.querySelectorAll('iframe');
        for (let i = 0; i < frames.length; i++) {
            try {
                const doc = frames[i].contentDocument || frames[i].contentWindow.document;
                let found = doc.querySelector(selector);
                if (!found && xpath) {
                    found = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                }
                if (found) return { element: found, doc: doc };
            } catch(e) {}
        }
        return null;
    }

    let attempts = 0;
    const maxAttempts = 15; // Thử giải tối đa 15 lần kéo nếu sai

    while (attempts < maxAttempts) {
        console.log(`🔍 Kiểm tra captcha (lần thử thứ ${attempts + 1})...`);
        
        let bgInfo = null;
        let sliderInfo = null;
        let sliceInfo = null;
        
        // Đợi tối đa 15 giây (30 checks * 500ms) để captcha kịp render hoàn chỉnh
        let checks = 0;
        while (checks < 30) {
            bgInfo = findElement(bgSelector, xpathBg1) || findElement(bgSelector, xpathBg2);
            sliderInfo = findElement(sliderSelector, xpathSlider1) || findElement(sliderSelector, xpathSlider2);
            sliceInfo = findElement(sliceSelector, xpathSlice1) || findElement(sliceSelector, xpathSlice2);
            
            // Đảm bảo phần tử hiển thị và có kích thước thực tế
            if (bgInfo && sliderInfo && bgInfo.element.offsetWidth > 0 && sliderInfo.element.offsetWidth > 0) {
                break;
            }
            bgInfo = null;
            sliderInfo = null;
            sliceInfo = null;
            await captchaDelay(500);
            checks++;
        }

        if (!bgInfo || !sliderInfo) {
            console.log("✅ Không phát hiện captcha hoặc captcha đã biến mất (Giải thành công / Đã chuyển hướng).");
            return;
        }

        console.log("🎯 Phát hiện captcha hiển thị! Tiến hành giải...");
        const bgEl = bgInfo.element;
        const sliderEl = sliderInfo.element;
        const targetDoc = bgInfo.doc;
        const targetWin = targetDoc.defaultView || window;

        // Trích xuất hình ảnh từ thẻ canvas hoặc div background-image
        async function getCanvasFromElement(el) {
            let imgSource = null;
            if (el.tagName === 'CANVAS') {
                return el;
            }
            const canvasChild = el.querySelector('canvas');
            if (canvasChild) return canvasChild;

            const imgChild = el.querySelector('img');
            if (imgChild) imgSource = imgChild.src;

            if (!imgSource) {
                const style = window.getComputedStyle(el);
                const bgImg = style.backgroundImage;
                if (bgImg && bgImg !== 'none') {
                    // Extract URL using regex to safely handle single/double quotes
                    const match = bgImg.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match && match[1]) {
                        imgSource = match[1];
                    }
                }
            }

            if (!imgSource) return null;

            return new Promise((resolve) => {
                const img = new Image();
                // Thiết lập timeout 4 giây đề phòng lỗi mạng/CORS treo tải ảnh
                const timer = setTimeout(() => {
                    console.warn("⚠️ Quá thời gian tải ảnh captcha.");
                    resolve(null);
                }, 4000);
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    clearTimeout(timer);
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    resolve(canvas);
                };
                img.onerror = () => {
                    clearTimeout(timer);
                    resolve(null);
                };
                img.src = imgSource;
            });
        }

        const canvasObj = await getCanvasFromElement(bgEl);
        if (!canvasObj) {
            console.error("❌ Không thể đọc dữ liệu ảnh nền captcha. Thử lại lượt sau...");
            await captchaDelay(2000);
            attempts++;
            continue;
        }

        let sliceCanvasObj = null;
        if (sliceInfo) {
            sliceCanvasObj = await getCanvasFromElement(sliceInfo.element);
        }

        let bestX = null;
        let lastImageHash = null;
        const width = canvasObj.width;
        const height = canvasObj.height;

        // Thử giải bằng Python server thông qua background script proxy để tránh lỗi Mixed Content
        try {
            const bgDataUrl = canvasObj.toDataURL('image/png');
            const sliceDataUrl = sliceCanvasObj ? sliceCanvasObj.toDataURL('image/png') : null;
            
            console.log("📤 Đang gửi ảnh captcha lên Python Server thông qua Background Service Worker...");
            const result = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: "solveCaptcha",
                    bg_image: bgDataUrl,
                    slice_image: sliceDataUrl
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });

            if (result && result.success) {
                bestX = result.offset_x;
                lastImageHash = result.image_hash;
                console.log(`🐍 Python server giải thành công! Offset X = ${bestX}`);
            } else {
                console.warn("⚠️ Python server trả về lỗi:", result ? result.error : "Không phản hồi");
            }
        } catch (err) {
            console.warn("⚠️ Không thể giải bằng Python server. Chuyển sang thuật toán JS dự phòng...", err);
        }

        // Thuật toán JS dự phòng nếu Python không chạy/lỗi
        if (bestX === null) {
            const ctx = canvasObj.getContext('2d');
            const imgData = ctx.getImageData(0, 0, width, height);
            const data = imgData.data;

            const startX = Math.floor(width * 0.2); 
            const endX = Math.floor(width * 0.9);
            bestX = startX;
            let maxEdgeVal = 0;

            for (let x = startX; x < endX; x++) {
                let edgeSum = 0;
                for (let y = 10; y < height - 10; y++) {
                    const idx = (y * width + x) * 4;
                    const v1 = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
                    
                    const idxRight = (y * width + x + 1) * 4;
                    const v2 = 0.299 * data[idxRight] + 0.587 * data[idxRight+1] + 0.114 * data[idxRight+2];
                    
                    edgeSum += Math.abs(v1 - v2);
                }
                if (edgeSum > maxEdgeVal) {
                    maxEdgeVal = edgeSum;
                    bestX = x;
                }
            }
            console.log(`🌐 JS Fallback giải thành công! Offset X = ${bestX}`);
        }

        // Tính toán khoảng cách kéo thực tế trên giao diện
        const bgRect = bgEl.getBoundingClientRect();
        const scale = bgRect.width / width; 
        const dragDistance = (bestX * scale) + OFFSET_ADJUST;

        console.log(`🎯 Phân tích thành công!`);
        console.log(`   - Kích thước ảnh gốc: ${width}x${height}`);
        console.log(`   - Điểm khuyết trên ảnh gốc X = ${bestX}`);
        console.log(`   - Chiều rộng hiển thị web: ${bgRect.width}px (Tỷ lệ: ${scale.toFixed(4)})`);
        console.log(`   - Khoảng cách kéo cần thiết: ${dragDistance.toFixed(2)}px`);

        // Hàm thực hiện kéo thả mô phỏng người thật
        async function drag(el, distance) {
            const rect = el.getBoundingClientRect();
            const startX = rect.left + rect.width / 2;
            const startY = rect.top + rect.height / 2;
            
            const createTouch = (x, y, target) => {
                try {
                    return new Touch({
                        identifier: Date.now(), target: target,
                        clientX: x, clientY: y, screenX: x, screenY: y, pageX: x, pageY: y
                    });
                } catch (e) {
                    // Safe fallback if Touch constructor is not supported (e.g. on Desktop Chrome)
                    return null;
                }
            };

            // Down
            const tDown = createTouch(startX, startY, el);
            if (tDown) {
                try {
                    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [tDown], targetTouches: [tDown], changedTouches: [tDown] }));
                } catch (e) {}
            }
            const downOpts = { clientX: startX, clientY: startY, bubbles: true, cancelable: true, view: targetWin, isPrimary: true };
            el.dispatchEvent(new PointerEvent('pointerdown', downOpts));
            el.dispatchEvent(new MouseEvent('mousedown', downOpts));
            await captchaDelay(100);

            // Tạo danh sách điểm di chuyển (có gia tốc + kéo lố overshoot rồi lùi lại)
            const steps = 30;
            const points = [];
            const overshoot = distance * 0.05 + (Math.random() * 3);
            const totalDistance = distance + overshoot;

            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const progress = t * (2 - t);
                let targetX = startX + totalDistance * progress;
                let targetY = startY + (Math.sin(t * Math.PI) * (Math.random() * 2 - 1));
                points.push({ x: targetX, y: targetY });
            }

            const returnSteps = 6;
            const overshotX = startX + totalDistance;
            for (let i = 1; i <= returnSteps; i++) {
                const t = i / returnSteps;
                points.push({ x: overshotX - overshoot * t, y: startY });
            }

            // Move (Dispatch to element, document and window to ensure libraries like Geetest capture it)
            for (const pt of points) {
                const tMove = createTouch(pt.x, pt.y, el);
                const moveOpts = { clientX: pt.x, clientY: pt.y, bubbles: true, cancelable: true, view: targetWin, isPrimary: true };
                
                if (tMove) {
                    try {
                        el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [tMove], targetTouches: [tMove], changedTouches: [tMove] }));
                    } catch(e) {}
                }
                
                el.dispatchEvent(new PointerEvent('pointermove', moveOpts));
                targetDoc.dispatchEvent(new PointerEvent('pointermove', moveOpts));
                targetWin.dispatchEvent(new PointerEvent('pointermove', moveOpts));
                
                el.dispatchEvent(new MouseEvent('mousemove', moveOpts));
                targetDoc.dispatchEvent(new MouseEvent('mousemove', moveOpts));
                targetWin.dispatchEvent(new MouseEvent('mousemove', moveOpts));
                
                await captchaDelay(8 + Math.random() * 5);
            }

            await captchaDelay(100);

            // Up
            const finalPt = points[points.length - 1];
            const tEnd = createTouch(finalPt.x, finalPt.y, el);
            if (tEnd) {
                try {
                    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [tEnd] }));
                } catch(e) {}
            }
            const upOpts = { clientX: finalPt.x, clientY: finalPt.y, bubbles: true, cancelable: true, view: targetWin, isPrimary: true };
            
            el.dispatchEvent(new PointerEvent('pointerup', upOpts));
            targetDoc.dispatchEvent(new PointerEvent('pointerup', upOpts));
            targetWin.dispatchEvent(new PointerEvent('pointerup', upOpts));
            
            el.dispatchEvent(new MouseEvent('mouseup', upOpts));
            targetDoc.dispatchEvent(new MouseEvent('mouseup', upOpts));
            targetWin.dispatchEvent(new MouseEvent('mouseup', upOpts));

            console.log("✅ Đã tự động kéo captcha thành công!");
        }

        // Tiến hành kéo
        await drag(sliderEl, dragDistance);
        
        // Đợi 2.5 giây để hệ thống nhận diện kéo thành công hoặc bắt đầu vẽ ảnh mới
        await captchaDelay(2500);

        // Kiểm tra xem bảng captcha có còn xuất hiện và hiển thị thực tế không
        let stillExists = false;
        try {
            const checkBg = findElement(bgSelector, xpathBg1) || findElement(bgSelector, xpathBg2);
            if (checkBg && checkBg.element && checkBg.element.offsetWidth > 0) {
                stillExists = true;
            }
        } catch(e) {}

        if (!stillExists) {
            console.log("🎉 Giải captcha thành công (Bảng captcha biến mất)!");
            if (lastImageHash) {
                console.log(`🧠 Đang báo cáo mã ảnh thành công lên bộ não: ${lastImageHash}`);
                // Báo cáo thành công qua Background Proxy
                chrome.runtime.sendMessage({
                    action: "reportSuccess",
                    image_hash: lastImageHash
                });
            }
            return; // Thoát vòng lặp giải vì đã thành công
        } else {
            console.log("❌ Kéo chưa chuẩn hoặc captcha bắt thử lại. Tiến hành thử lại lượt kế...");
            if (lastImageHash) {
                console.log(`⚠️ Đang báo cáo giải thất bại lên server: ${lastImageHash}`);
                chrome.runtime.sendMessage({
                    action: "reportFailure",
                    image_hash: lastImageHash
                });
            }
        }
        
        attempts++;
    }
}
