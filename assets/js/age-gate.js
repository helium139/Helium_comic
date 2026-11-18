(() => {
    const key = 'helium:age-confirmation:v1';
    const duration = 24 * 60 * 60 * 1000;
    let confirmed = false;
    try {
        const until = Number(localStorage.getItem(key));
        confirmed = until > Date.now() && until <= Date.now() + duration;
    } catch { /* Storage may be unavailable; still allow a deliberate confirmation. */ }
    if (confirmed) {
        globalThis.heliumAgeGateReady = Promise.resolve();
        return;
    }
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
                try { localStorage.setItem(key, String(Date.now() + duration)); } catch { /* Current page still works. */ }
                dialog.close();
                dialog.remove();
                document.documentElement.classList.remove('age-gate-open');
                resolve();
            });
            dialog.querySelector('[data-age-decline]').addEventListener('click', event => {
                event.stopPropagation();
                location.replace('about:blank');
            });
            document.body.appendChild(dialog);
            document.documentElement.classList.add('age-gate-open');
            dialog.showModal();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, {once: true});
        else show();
    });
})();
