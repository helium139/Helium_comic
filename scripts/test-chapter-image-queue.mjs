import test from "node:test";
import assert from "node:assert/strict";
import {
    createChapterImageQueue,
    getChapterImageUrls,
    revealReadyPages
} from "../assets/js/chapter-image-queue.mjs";

class FakeClock {
    now = 0;
    nextId = 0;
    timers = new Map();

    setTimeout = (callback, delay) => {
        const id = ++this.nextId;
        this.timers.set(id, { at: this.now + delay, callback });
        return id;
    };

    clearTimeout = id => this.timers.delete(id);

    advance(delay) {
        const end = this.now + delay;
        while (true) {
            const due = [...this.timers.entries()]
                .filter(([, timer]) => timer.at <= end)
                .sort((left, right) => left[1].at - right[1].at)[0];
            if (!due) break;
            this.timers.delete(due[0]);
            this.now = due[1].at;
            due[1].callback();
        }
        this.now = end;
    }
}

class FakeImage {
    listeners = new Map();
    complete = false;
    naturalWidth = 0;
    fetchPriority = "auto";
    decoding = "";
    attributes = {};

    constructor(urls = new Set()) {
        this.cachedUrls = urls;
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    removeEventListener(type) {
        this.listeners.delete(type);
    }

    removeAttribute(name) {
        delete this.attributes[name];
        if (name === "src") this.src = "";
    }

    set src(url) {
        this.attributes.src = url;
        this.complete = this.cachedUrls.has(url);
        this.naturalWidth = this.complete ? 100 : 0;
    }

    get src() {
        return this.attributes.src || "";
    }

    emit(type) {
        if (type === "load") {
            this.complete = true;
            this.naturalWidth = 100;
        }
        this.listeners.get(type)?.();
    }
}

function makeQueue(urls, options = {}) {
    const images = [];
    const states = [];
    const clock = options.clock || new FakeClock();
    let active = 0;
    let maxActive = 0;
    const queue = createChapterImageQueue(urls, {
        concurrency: options.concurrency || 2,
        prefetchCount: 4,
        requestTimeoutMs: 15_000,
        retryBaseDelayMs: 300,
        retryMaxDelayMs: 2_000,
        createImage: () => {
            const image = new FakeImage(options.cachedUrls);
            images.push(image);
            return image;
        },
        getResponseStatus: options.getResponseStatus || (() => null),
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        onState(index, state, image, attempt) {
            states.push({ index, state, image, attempt });
            if (state === "loading") {
                active++;
                maxActive = Math.max(maxActive, active);
            } else if (state === "loaded" || state === "retrying" || state === "failed") {
                active--;
            }
            options.onState?.(index, state);
        }
    });
    return { queue, images, states, clock, maxActive: () => maxActive };
}

const urls = count => Array.from({ length: count }, (_, index) => `https://images.test/${index + 1}.webp`);

test("requests canonical order with a fixed two-request limit and four-page lookahead", () => {
    const h = makeQueue(urls(8));
    h.queue.start();
    assert.deepEqual(h.images.map(image => image.src), urls(2));
    assert.equal(h.maxActive(), 2);

    h.images[1].emit("load");
    h.images[2].emit("load");
    assert.deepEqual(h.images.map(image => image.src), urls(4));
    assert.equal(h.queue.getState(4), "idle");
    assert.equal(h.maxActive(), 2);
});

test("the configured three-request limit is enforced without expanding the prefetch window", () => {
    const h = makeQueue(urls(8), { concurrency: 3 });
    h.queue.start();
    assert.deepEqual(h.images.map(image => image.src), urls(3));
    assert.equal(h.maxActive(), 3);
    h.images[2].emit("load");
    assert.equal(h.images[3].src, urls(4)[3]);
    assert.equal(h.queue.getState(4), "idle");
});

test("chapter URLs preserve metadata order and use legacy sequential JPG names", () => {
    const chapter = { folder: "https://images.test/chapter", pages: 3, images: ["3.webp", "1.webp", "2.webp"] };
    assert.deepEqual(getChapterImageUrls(chapter), [
        "https://images.test/chapter/3.webp",
        "https://images.test/chapter/1.webp",
        "https://images.test/chapter/2.webp"
    ]);
    assert.deepEqual(getChapterImageUrls({ folder: chapter.folder, pages: 2 }), [
        "https://images.test/chapter/1.jpg",
        "https://images.test/chapter/2.jpg"
    ]);
    assert.throws(() => getChapterImageUrls({ folder: chapter.folder, pages: 0 }), /positive integer/);
});

test("buffers later completions until earlier pages load or fail", () => {
    const states = ["loading", "loaded", "loaded"];
    const displayed = [];
    let next = revealReadyPages(states, 0, index => displayed.push(index));
    assert.deepEqual(displayed, []);

    states[0] = "failed";
    next = revealReadyPages(states, next, index => displayed.push(index));
    assert.deepEqual(displayed, [0, 1, 2]);
    assert.equal(next, 3);
});

test("a slow first image buffers faster later completions without changing request order", () => {
    const states = Array(4).fill("idle");
    const displayed = [];
    const completionOrder = [];
    let firstUnrevealed = 0;
    const h = makeQueue(urls(4), {
        concurrency: 2,
        onState(index, state) {
            if (state === "loading") states[index] = "loading";
            if (state === "loaded" || state === "failed") {
                states[index] = state;
                completionOrder.push(index);
                firstUnrevealed = revealReadyPages(states, firstUnrevealed, page => displayed.push(page));
            }
        }
    });
    h.queue.start();
    h.images[1].emit("load");
    h.images[2].emit("load");
    h.images[3].emit("load");

    assert.deepEqual(completionOrder, [1, 2, 3]);
    assert.deepEqual(displayed, []);
    assert.deepEqual(h.images.map(image => image.src), urls(4));

    h.images[0].emit("load");
    assert.deepEqual(completionOrder, [1, 2, 3, 0]);
    assert.deepEqual(displayed, [0, 1, 2, 3]);
    assert.equal(h.maxActive(), 2);
});

test("fast scrolling reprioritizes pending pages without duplicating in-flight requests", () => {
    const h = makeQueue(urls(12));
    h.queue.start();
    h.queue.setPriorityIndex(8);
    h.images[1].emit("load");
    h.images[0].emit("load");
    assert.deepEqual(h.images.map(image => image.src), [...urls(2), ...urls(12).slice(8, 10)]);
    assert.equal(h.queue.getState(2), "idle");
    assert.equal(h.maxActive(), 2);
});

test("cached images complete immediately and do not get requested twice", () => {
    const h = makeQueue(urls(3), { cachedUrls: new Set([urls(1)[0]]) });
    h.queue.start();
    assert.equal(h.queue.getState(0), "loaded");
    assert.equal(h.images[0].fetchPriority, "high");
    h.queue.setPriorityIndex(0);
    assert.equal(h.images.length, 3);
    assert.equal(h.images[1].src, urls(3)[1]);
});

test("network errors retry twice with bounded exponential backoff then become terminal", () => {
    const h = makeQueue(urls(1));
    h.queue.start();
    h.images[0].emit("error");
    assert.equal(h.queue.getState(0), "retry-wait");
    h.clock.advance(299);
    assert.equal(h.images.length, 1);
    h.clock.advance(1);
    assert.equal(h.images.length, 2);
    h.images[1].emit("error");
    h.clock.advance(600);
    assert.equal(h.images.length, 3);
    h.images[2].emit("error");
    assert.equal(h.queue.getState(0), "failed");
    assert.equal(h.images.length, 3);
    assert.equal(h.queue.retry(0), true);
    assert.equal(h.images.length, 4);
});

test("timeouts retry, permanent HTTP errors do not, and terminal failures remain manually retryable", () => {
    const timeout = makeQueue(urls(1));
    timeout.queue.start();
    timeout.clock.advance(15_000);
    assert.equal(timeout.queue.getState(0), "retry-wait");
    timeout.clock.advance(300);
    timeout.images[1].emit("load");
    assert.equal(timeout.queue.getState(0), "loaded");

    const permanent = makeQueue(urls(1), { getResponseStatus: () => 404 });
    permanent.queue.start();
    permanent.images[0].emit("error");
    assert.equal(permanent.queue.getState(0), "failed");
    assert.equal(permanent.images.length, 1);
    assert.equal(permanent.queue.retry(0), true);
    assert.equal(permanent.images.length, 2);
});

test("destroy cancels timers and ignores stale image callbacks", () => {
    const h = makeQueue(urls(3));
    h.queue.start();
    const stateCount = h.states.length;
    h.queue.destroy();
    h.images[0].emit("load");
    h.clock.advance(30_000);
    assert.equal(h.states.length, stateCount);
    assert.equal(h.queue.activeCount, 0);
    assert.equal(h.images[0].src, "");
});
