const DEFAULTS = Object.freeze({
    concurrency: 2,
    prefetchCount: 4,
    requestTimeoutMs: 15_000,
    maxRetries: 2,
    retryBaseDelayMs: 300,
    retryMaxDelayMs: 2_000
});

function responseStatus(url) {
    // Cross-origin timing data may hide the HTTP status when the image host omits Timing-Allow-Origin.
    const entries = globalThis.performance?.getEntriesByName?.(url) || [];
    for (let index = entries.length - 1; index >= 0; index--) {
        const status = entries[index].responseStatus;
        if (Number.isInteger(status) && status > 0) return status;
    }
    return null;
}

function isRetryableStatus(status) {
    return status === null || status === undefined || status === 408 || status === 429 || status >= 500;
}

export function getChapterImageUrls(chapter) {
    const pageCount = Number(chapter?.pages);
    if (!Number.isInteger(pageCount) || pageCount < 1) {
        throw new RangeError("Chapter page count must be a positive integer");
    }
    if (typeof chapter.folder !== "string" || !chapter.folder) {
        throw new TypeError("Chapter image folder is required");
    }
    return Array.from({ length: pageCount }, (_, index) =>
        `${chapter.folder}/${chapter.images?.[index] || `${index + 1}.jpg`}`
    );
}

export function createChapterImageQueue(urls, options = {}) {
    const settings = { ...DEFAULTS, ...options };
    if (!Array.isArray(urls) || !urls.length || urls.some(url => typeof url !== "string" || !url)) {
        throw new TypeError("Chapter image URLs must be a non-empty-string list");
    }
    for (const name of ["concurrency", "prefetchCount", "requestTimeoutMs"]) {
        if (!Number.isInteger(settings[name]) || settings[name] < 1) {
            throw new RangeError(`${name} must be a positive integer`);
        }
    }
    if (!Number.isInteger(settings.maxRetries) || settings.maxRetries < 0 ||
        !Number.isFinite(settings.retryBaseDelayMs) || settings.retryBaseDelayMs < 0 ||
        !Number.isFinite(settings.retryMaxDelayMs) || settings.retryMaxDelayMs < 0) {
        throw new RangeError("Invalid chapter image retry configuration");
    }

    const createImage = settings.createImage || (() => new Image());
    const onState = settings.onState || (() => {});
    const getResponseStatus = settings.getResponseStatus || responseStatus;
    const setTimer = settings.setTimeout || globalThis.setTimeout.bind(globalThis);
    const clearTimer = settings.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    const items = urls.map(url => ({
        url,
        status: "idle",
        attempts: 0,
        image: null,
        requestTimer: null,
        retryTimer: null,
        cleanup: null,
        token: 0
    }));

    let activeCount = 0;
    let anchor = 0;
    let started = false;
    let destroyed = false;
    let pumping = false;

    function publish(index, status, image, attempt) {
        items[index].status = status;
        onState(index, status, image, attempt);
    }

    function pump() {
        if (!started || destroyed || pumping) return;
        pumping = true;
        try {
            const end = Math.min(items.length, anchor + settings.prefetchCount);
            while (activeCount < settings.concurrency) {
                let next = -1;
                for (let index = anchor; index < end; index++) {
                    if (items[index].status === "idle") {
                        next = index;
                        break;
                    }
                }
                if (next === -1) break;
                startAttempt(next);
            }
        } finally {
            pumping = false;
        }
    }

    function startAttempt(index) {
        const item = items[index];
        const image = createImage();
        const attempt = ++item.attempts;
        const token = ++item.token;
        let settled = false;

        item.image = image;
        activeCount++;
        if ("fetchPriority" in image) image.fetchPriority = index === 0 ? "high" : "auto";
        image.decoding = "async";

        const detach = () => {
            image.removeEventListener("load", onLoad);
            image.removeEventListener("error", onError);
            item.cleanup = null;
        };
        const finish = outcome => {
            if (destroyed || settled || token !== item.token) return;
            settled = true;
            detach();
            if (item.requestTimer !== null) clearTimer(item.requestTimer);
            item.requestTimer = null;
            activeCount--;

            if (outcome === "loaded") {
                publish(index, "loaded", image, attempt);
            } else {
                const status = outcome === "timeout" ? null : getResponseStatus(item.url);
                if (attempt <= settings.maxRetries && isRetryableStatus(status)) {
                    publish(index, "retrying", image, attempt);
                    const delay = Math.min(
                        settings.retryBaseDelayMs * (2 ** (attempt - 1)),
                        settings.retryMaxDelayMs
                    );
                    item.status = "retry-wait";
                    item.retryTimer = setTimer(() => {
                        item.retryTimer = null;
                        if (!destroyed && token === item.token) {
                            item.status = "idle";
                            pump();
                        }
                    }, delay);
                } else {
                    publish(index, "failed", image, attempt);
                }
            }
            pump();
        };
        const onLoad = () => finish("loaded");
        const onError = () => finish("error");

        image.addEventListener("load", onLoad);
        image.addEventListener("error", onError);
        item.cleanup = detach;
        publish(index, "loading", image, attempt);
        item.requestTimer = setTimer(() => {
            if (token !== item.token || settled || destroyed) return;
            image.removeAttribute?.("src");
            finish("timeout");
        }, settings.requestTimeoutMs);
        image.src = item.url;
        if (image.complete && image.naturalWidth > 0) finish("loaded");
    }

    return {
        start() {
            if (destroyed) return;
            started = true;
            pump();
        },
        setPriorityIndex(index) {
            if (destroyed || !Number.isInteger(index) || index < 0 || index >= items.length) return;
            anchor = index;
            pump();
        },
        retry(index) {
            const item = items[index];
            if (destroyed || !item || item.status !== "failed") return false;
            item.attempts = 0;
            item.status = "idle";
            anchor = index;
            pump();
            return true;
        },
        getState(index) {
            return items[index]?.status ?? null;
        },
        get activeCount() {
            return activeCount;
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const item of items) {
                if (item.requestTimer !== null) clearTimer(item.requestTimer);
                if (item.retryTimer !== null) clearTimer(item.retryTimer);
                item.requestTimer = null;
                item.retryTimer = null;
                if (item.cleanup) item.cleanup();
                if (item.status === "loading") item.image?.removeAttribute?.("src");
                item.token++;
            }
            activeCount = 0;
        }
    };
}

export function revealReadyPages(states, firstUnrevealed, reveal) {
    let next = firstUnrevealed;
    while (next < states.length && (states[next] === "loaded" || states[next] === "failed")) {
        reveal(next, states[next]);
        next++;
    }
    return next;
}
