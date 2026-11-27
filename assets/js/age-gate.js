(() => {
    const key = 'helium:age-session:v2';
    const inactivityMs = 30 * 60 * 1000;
    let lastActive = 0, gateOpen = false;
    const eligiblePage = ['/', '/index.html', '/manga.html', '/chapter.html'].includes(location.pathname) ||
        /^\/manga\/[^/]+(?:\/chapter\/[^/]+)?\/?$/.test(location.pathname);
    if (!eligiblePage) {
        globalThis.heliumAgeGateReady = Promise.resolve();
        return;
    }
    try { lastActive = Number(sessionStorage.getItem(key)) || 0; } catch { /* Memory fallback. */ }
    const recent = () => lastActive > 0 && Date.now() >= lastActive && Date.now() - lastActive < inactivityMs;
    const remember = () => {
        lastActive = Date.now();
        try { sessionStorage.setItem(key, String(lastActive)); } catch { /* Current page still works. */ }
    };
    function requestConfirmation() {
        if (gateOpen) return;
        gateOpen = true;
        globalThis.heliumAgeGateReady = new Promise(resolve => {
        const show = () => {
            const dialog = document.createElement('dialog');
            dialog.className = 'age-gate';
            dialog.setAttribute('aria-labelledby', 'age-gate-title');
            dialog.setAttribute('aria-describedby', 'age-gate-description');
            dialog.innerHTML = `
                <div class="age-gate__badge" aria-hidden="true">18+</div>
                <p class="age-gate__brand">HELIUM TEAM</p>
                <h2 id="age-gate-title">Xác nhận độ tuổi</h2>
                <p id="age-gate-description">Website có nội dung dành cho người từ 18 tuổi trở lên.
                    Vui lòng xác nhận bạn đã đủ tuổi trước khi tiếp tục đọc truyện.</p>
                <div class="age-gate__actions">
                    <button type="button" data-age-accept>Tôi đã đủ 18 tuổi</button>
                    <button type="button" data-age-decline>Tôi chưa đủ 18 tuổi</button>
                </div>
                <aside class="age-gate__notice" aria-label="Lưu ý quảng cáo">
                    <strong>LƯU Ý TRƯỚC KHI ĐỌC</strong>
                    <p><b>CLICK vào vị trí bất kỳ 3 lần</b> để <b>LOAD hết quảng cáo</b>,
                        rồi đọc truyện bình thường.</p>
                </aside>`;
            dialog.addEventListener('cancel', event => event.preventDefault());
            dialog.querySelector('[data-age-accept]').addEventListener('click', event => {
                event.stopPropagation();
                remember();
                dialog.close();
                dialog.remove();
                document.documentElement.classList.remove('age-gate-open');
                gateOpen = false;
                document.dispatchEvent(new Event('helium-age-gate-change'));
                resolve();
            });
            dialog.querySelector('[data-age-decline]').addEventListener('click', event => {
                event.stopPropagation();
                location.replace('about:blank');
            });
            document.body.appendChild(dialog);
            document.documentElement.classList.add('age-gate-open');
            document.dispatchEvent(new Event('helium-age-gate-change'));
            dialog.showModal();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, {once: true});
        else show();
        });
    }
    function activity() {
        if (gateOpen || document.visibilityState === 'hidden') return;
        if (!recent()) requestConfirmation();
        else if (Date.now() - lastActive >= 15000) remember();
    }
    for (const event of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
        document.addEventListener(event, activity, {passive: true});
    }
    document.addEventListener('visibilitychange', activity);
    globalThis.addEventListener('pageshow', activity);
    globalThis.addEventListener('focus', activity);
    globalThis.addEventListener('pagehide', () => {
        if (!gateOpen && recent() && document.visibilityState !== 'hidden') remember();
    });
    if (recent()) globalThis.heliumAgeGateReady = Promise.resolve();
    else requestConfirmation();
})();
