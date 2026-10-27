// Conversion and upload are interleaved to keep memory bounded to one image.
// Each completed conversion contributes 45/N points; each upload contributes 35/N.
export function createUploadProgress(emit = () => {}) {
    let percent, state, total, converted, uploaded;
    function update(value, status, nextState = 'running') {
        if (state === 'error' || state === 'success') return;
        percent = Math.max(percent, Math.min(99, Math.max(0, value)));
        state = nextState;
        emit({ percent, status, state });
    }
    function reset(count = 0) {
        total = Math.max(0, count);
        converted = new Set(); uploaded = new Set();
        percent = 0; state = 'idle';
        emit({ percent, status: 'Đang chuẩn bị...', state });
    }
    function work(status) {
        update(total ? 10 + converted.size / total * 45 + uploaded.size / total * 35 : 90, status);
    }
    reset();
    return {
        reset,
        prepared() { update(total ? 10 : 90, 'Đang chuẩn bị...'); },
        converting(index) { work(`Đang chuyển đổi ảnh ${index + 1}/${total}...`); },
        converted(index) {
            if (index >= 0 && index < total) converted.add(index);
            work(`Đang tải ảnh lên ${uploaded.size + 1}/${total}...`);
        },
        uploaded(index) {
            if (index >= 0 && index < total) uploaded.add(index);
            work(`Đã tải ảnh lên ${uploaded.size}/${total}`);
        },
        publishing(status = 'Đang xuất bản, cập nhật danh mục và dọn file tạm...') { update(90, status); },
        preparingManifest() { update(94, 'Đang chuẩn bị danh sách chapter...'); },
        sendingUpdate() { update(96, 'Đang gửi cập nhật chapter...'); },
        published() { update(98, 'Đang hoàn tất kết quả xuất bản...'); },
        complete() {
            if (state === 'error') return;
            percent = 100; state = 'success';
            emit({ percent, status: '✔ Hoàn tất', state });
        },
        fail(message) {
            if (state === 'success') return;
            state = 'error'; emit({ percent, status: `Lỗi: ${message}`, state });
        }
    };
}

// Yield to browser rendering, including when conversion simply passes a file through.
export const paintProgress = () => new Promise(resolve => {
    if (typeof requestAnimationFrame !== 'function' || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) { resolve(); return; }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
});

export function bindUploadProgress(root) {
    const fill = root?.querySelector('#progressFill');
    const track = root?.querySelector('#progressTrack');
    const text = root?.querySelector('#progressPercent');
    const status = root?.querySelector('#progressStatus');
    if (!root || !fill || !track || !text || !status) {
        console.error('Chapter upload progress markup is missing: progress, progressFill, progressTrack, progressPercent, progressStatus');
        return createUploadProgress();
    }
    return createUploadProgress(value => {
        if (value.state === 'idle') {
            // Reset immediately instead of animating backwards from the previous upload.
            fill.style.transition = 'none';
            fill.style.width = '0%';
            void fill.offsetWidth;
            fill.style.transition = '';
        }
        fill.style.width = `${value.percent}%`;
        // Do not round 99.x to a premature displayed 100%.
        text.textContent = `${value.percent === 100 ? 100 : Math.floor(value.percent)}%`;
        status.textContent = value.status;
        track.setAttribute('aria-valuenow', String(value.percent));
        root.classList.toggle('is-error', value.state === 'error');
        root.classList.toggle('is-success', value.state === 'success');
        root.setAttribute('aria-busy', String(value.state === 'running'));
    });
}

// Let the real CSS completion transition finish before a blocking success alert.
export async function settleUploadProgress(root) {
    await paintProgress();
    const fill = root?.querySelector('#progressFill');
    if (!fill) return;
    await new Promise(resolve => {
        const done = event => {
            if (event && (event.target !== fill || event.propertyName !== 'width')) return;
            clearTimeout(timeout);
            fill.removeEventListener('transitionend', done);
            resolve();
        };
        const timeout = setTimeout(done, 250);
        fill.addEventListener('transitionend', done);
    });
}
