import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const stripImports = source => source.replace(/^import[\s\S]*?from\s*"[^"]+";\s*/gm, '').replace(/export /g, '');
const notificationSource = stripImports(await read('assets/js/notifications.js'));
const registrationSource = stripImports(await read('assets/js/push-registration.js'));
const workerSource = await read('firebase-messaging-sw.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
const origin = 'https://heliumtg.com';
const target = `${origin}/manga/example/chapter/10.5/`;

async function page({ permission = 'default', account = { uid: 'u' }, key = 'test-public-key', subscribed = false, supported = true, failRegistration = false, registrationWait } = {}) {
    const handlers = {};
    const counts = { prompts: 0, tokens: 0, registrations: 0, receivers: 0, revokes: 0, toasts: 0 };
    const button = { addEventListener(type, callback) { handlers[type] = callback; } };
    const status = {};
    let authChanged;
    let received;
    let restore;
    const auth = { currentUser: account };
    const Notification = { permission, async requestPermission() {
        counts.prompts++;
        this.permission = 'granted';
        return this.permission;
    } };
    const context = {
        app: {}, auth, PUBLIC_VAPID_KEY: key, Notification, isSecureContext: true,
        navigator: { serviceWorker: {} }, PushManager: {}, URL, location: { origin },
        setTimeout() {},
        onAuthStateChanged(auth, callback) { authChanged = callback; },
        loadMessaging: async () => ({
            isSupported: async () => supported, getMessaging: () => ({}),
            onMessage(messaging, callback) { counts.receivers++; received = callback; },
            async getToken(messaging, options) {
                assert.equal(options.vapidKey, key);
                assert.ok(options.serviceWorkerRegistration);
                counts.tokens++;
                return 'test-token';
            }
        }),
        registrationReceipt: () => account && subscribed ? { uid: account.uid, id: "a".repeat(64) } : null,
        existingPushWorker: async () => subscribed ? { pushManager: { getSubscription: async () => ({}) } } : null,
        ensurePushWorker: async () => ({}),
        registerDeviceToken: async () => {
            counts.registrations++;
            if (registrationWait) await registrationWait;
            if (failRegistration) throw new Error('permission-denied');
        },
        revokeBrowserPush: async () => { counts.revokes++; },
        window: { addEventListener(type, callback) { restore = callback; } },
        document: {
            getElementById: id => id === 'notification-button' ? button : status,
            querySelector: () => null,
            createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, remove() {} }),
            body: { appendChild() { counts.toasts++; } }
        }
    };
    vm.createContext(context);
    vm.runInContext(notificationSource, context);
    await flush();
    if (authChanged) await authChanged(account);
    return { button, status, counts, context,
        click: () => handlers.click(), receive: payload => received(payload),
        restore: () => restore({ persisted: true }),
        async changeAccount(next) { auth.currentUser = next; await authChanged(next); }
    };
}

test('default permission requests only on explicit click; repeat click avoids permission prompt', async () => {
    const p = await page();
    assert.equal(p.counts.prompts, 0);
    assert.equal(p.counts.tokens, 0);
    await p.click();
    assert.equal(p.counts.prompts, 1);
    assert.equal(p.counts.registrations, 1);
    assert.match(p.button.textContent, /Đã bật/);
    await p.click();
    assert.equal(p.counts.prompts, 1);
    assert.equal(p.counts.receivers, 1);
});

test('guest, denied, unsupported, and missing configuration never request permission or create tokens', async () => {
    for (const options of [{ account: null }, { permission: 'denied' }, { supported: false }, { key: '' }]) {
        const p = await page(options);
        await p.click();
        assert.equal(p.counts.prompts, 0);
        assert.equal(p.counts.tokens, 0);
        assert.doesNotMatch(p.button.textContent, /Đã bật/);
    }
    const denied = await page({ permission: 'denied' });
    await denied.click();
    assert.match(denied.status.textContent, /cài đặt/);
});

test('granted permission alone is not enabled; existing device checks registration on reload and Back', async () => {
    const unregistered = await page({ permission: 'granted' });
    assert.equal(unregistered.counts.registrations, 0);
    assert.doesNotMatch(unregistered.button.textContent, /Đã bật/);
    assert.equal(unregistered.status.textContent, '');
    const existing = await page({ permission: 'granted', subscribed: true });
    assert.equal(existing.counts.prompts, 0);
    assert.equal(existing.counts.registrations, 1);
    assert.match(existing.button.textContent, /Đã bật/);
    existing.restore();
    await flush();
    assert.equal(existing.counts.registrations, 2);
});

test('registration failure leaves retry available and never claims enabled', async () => {
    const p = await page({ permission: 'granted', failRegistration: true });
    await p.click();
    assert.doesNotMatch(p.button.textContent, /Đã bật/);
    assert.equal(p.button.disabled, false);
    assert.match(p.status.textContent, /thử lại/);
});

test('logout waits for in-flight setup then revokes without claiming enabled', async () => {
    let finish;
    const registrationWait = new Promise(resolve => { finish = resolve; });
    const p = await page({ registrationWait });
    const setup = p.click();
    await flush();
    assert.equal(p.counts.registrations, 1);
    const logout = p.context.stopBrowserNotifications();
    assert.equal(p.button.disabled, true);
    finish();
    await Promise.all([setup, logout]);
    assert.ok(p.counts.revokes > 0);
    assert.doesNotMatch(p.button.textContent, /Đã bật/);
});

test('foreground messages are deduplicated, restrict URLs, and stop displaying after logout', async () => {
    const p = await page({ permission: 'granted' });
    const payload = { messageId: 'event-1', data: { url: target, title: '<img src=x>', body: 'new' } };
    p.receive(payload);
    p.receive(payload);
    p.receive({ messageId: 'external', data: { url: 'https://evil.example/manga/x/chapter/1/' } });
    assert.equal(p.counts.toasts, 1);
    await p.changeAccount(null);
    p.receive({ ...payload, messageId: 'after-logout' });
    assert.equal(p.counts.toasts, 1);
    assert.ok(p.counts.revokes > 0);
});

function registrationContext(overrides = {}) {
    const storage = new Map();
    const context = {
        app: {}, db: {}, auth: { currentUser: { uid: 'u' } }, URL,
        crypto: webcrypto, TextEncoder, Uint8Array, location: { origin },
        PUSH_WORKER_URL: '/firebase-messaging-sw.js', PUSH_WORKER_SCOPE: '/firebase-cloud-messaging-push-scope/',
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        doc: (db, ...parts) => parts.join('/'), serverTimestamp: () => ({ toMillis: () => Date.now() }),
        navigator: { serviceWorker: { getRegistrations: async () => [] } },
        ...overrides
    };
    vm.createContext(context);
    vm.runInContext(registrationSource, context);
    return context;
}

test('token hashing deduplicates writes, preserves per-user isolation, and rejects wrong auth', async () => {
    const records = new Map();
    let writes = 0;
    const h = registrationContext({ runTransaction: async (db, callback) => callback({
        get: async reference => ({ exists: () => records.has(reference), data: () => records.get(reference) }),
        set(reference, data) { writes++; records.set(reference, data); }
    }) });
    const id = await h.registerDeviceToken({ uid: 'u' }, 'token');
    assert.match(id, /^[a-f0-9]{64}$/);
    await h.registerDeviceToken({ uid: 'u' }, 'token');
    assert.equal(writes, 1);
    await assert.rejects(h.registerDeviceToken({ uid: 'other' }, 'token'), /auth-changed/);
    assert.ok(records.has(`users/u/pushTokens/${id}`));
    assert.equal(JSON.stringify(h.registrationReceipt()).includes('"token"'), false);
    h.auth.currentUser = { uid: 'other' };
    await h.registerDeviceToken({ uid: 'other' }, 'different-token');
    assert.equal(records.size, 2);
});

test('worker registration leaves unrelated root worker untouched and rejects exact-scope conflicts', async () => {
    let registrations = 0;
    const ad = { scope: `${origin}/`, active: { scriptURL: `${origin}/sw.js` } };
    const fcm = { scope: `${origin}/firebase-cloud-messaging-push-scope/`, active: { scriptURL: `${origin}/firebase-messaging-sw.js` } };
    let existing = [ad];
    const h = registrationContext({ navigator: { serviceWorker: {
        getRegistrations: async () => existing,
        register: async (url, options) => {
            assert.equal(url, '/firebase-messaging-sw.js');
            assert.equal(options.scope, '/firebase-cloud-messaging-push-scope/');
            registrations++;
            return fcm;
        }
    } } });
    assert.equal(await h.ensurePushWorker(), fcm);
    assert.equal(registrations, 1);
    existing = [ad, { ...fcm, active: { scriptURL: `${origin}/other.js` } }];
    await assert.rejects(h.ensurePushWorker(), /scope-conflict/);
    assert.equal(registrations, 1);
});

test('logout unsubscribes only the FCM device and removes its own document', async () => {
    let unsubscribed = 0;
    let removed;
    const registration = {
        scope: `${origin}/firebase-cloud-messaging-push-scope/`,
        active: { scriptURL: `${origin}/firebase-messaging-sw.js` },
        pushManager: { getSubscription: async () => ({ unsubscribe: async () => { unsubscribed++; return true; } }) }
    };
    const h = registrationContext({
        navigator: { serviceWorker: { getRegistrations: async () => [registration] } },
        deleteDoc: async reference => { removed = reference; }
    });
    h.localStorage.setItem('heliumtg_push_registration', JSON.stringify({ uid: 'u', id: 'a'.repeat(64) }));
    await h.revokeBrowserPush();
    assert.equal(unsubscribed, 1);
    assert.equal(removed, `users/u/pushTokens/${'a'.repeat(64)}`);
    assert.equal(h.registrationReceipt(), null);
});

function worker({ windows = [] } = {}) {
    let background;
    let click;
    const shown = [];
    const opened = [];
    const context = {
        URL, importScripts() {},
        firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage(callback) { background = callback; } }) },
        self: {
            location: { origin },
            addEventListener(type, callback) { click = callback; },
            registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
            clients: { matchAll: async () => windows, openWindow: async url => opened.push(url) }
        }
    };
    vm.runInNewContext(workerSource, context);
    return { shown, opened, background,
        async click(data) {
            let pending;
            click({ notification: { data, close() {} }, stopImmediatePropagation() {}, waitUntil(promise) { pending = promise; } });
            await pending;
        }
    };
}

test('background data messages display once; notification payloads rely on FCM auto-display', async () => {
    const w = worker();
    await w.background({ data: { title: 'Manga', body: 'Chapter 10.5', url: target, eventId: 'm:10.5', cover: 'https://evil.example/image.png' } });
    assert.equal(w.shown.length, 1);
    assert.equal(w.shown[0].options.data.url, target);
    assert.equal(w.shown[0].options.image, undefined);
    await w.background({ notification: { title: 'Automatic' }, data: { url: target } });
    await w.background({ data: { url: 'javascript:alert(1)' } });
    assert.equal(w.shown.length, 1);
});

test('notification click navigates and focuses a same-origin tab or opens a new one', async () => {
    let navigated;
    let focused = 0;
    const w = worker({ windows: [{ url: `${origin}/follow/`, async navigate(url) {
        navigated = url;
        return { focus: async () => { focused++; } };
    } }] });
    await w.click({ url: target });
    assert.equal(navigated, target);
    assert.equal(focused, 1);
    assert.equal(w.opened.length, 0);
    const empty = worker();
    await empty.click({ url: target });
    assert.deepEqual(empty.opened, [target]);
    await empty.click({ url: 'https://evil.example/manga/x/chapter/1/' });
    assert.equal(empty.opened.length, 1);
});
