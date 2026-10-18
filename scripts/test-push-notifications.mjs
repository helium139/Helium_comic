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

async function page({ missingApi, permission = 'default', account = { uid: 'u' }, key = 'test-public-key', subscribed = false, supported = true, failRegistration = false, failDisable = false, registrationWait } = {}) {
    const handlers = {};
    const counts = { prompts: 0, tokens: 0, registrations: 0, receivers: 0, revokes: 0, toasts: 0, covers: 0, disables: 0 };
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
            subscribed = true;
        },
        disableDeviceNotifications: async () => {
            counts.disables++;
            if (failDisable) throw new Error('unavailable');
            subscribed = false;
        },
        revokeBrowserPush: async () => { counts.revokes++; },
        window: { addEventListener(type, callback) { restore = callback; } },
        document: {
            getElementById: id => id === 'notification-button' ? button : status,
            querySelector: () => null,
            createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, prepend() { counts.covers++; }, remove() {} }),
            body: { appendChild() { counts.toasts++; } }
        }
    };
    if (missingApi === "serviceWorker") delete context.navigator.serviceWorker;
    if (missingApi === "PushManager") delete context.PushManager;
    if (missingApi === "Notification") delete context.Notification;
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
    assert.equal(p.counts.disables, 1);
    assert.equal(p.button.textContent, '🔔 Nhận thông báo');
    assert.equal(p.context.Notification.permission, 'granted');
    p.restore();
    await flush();
    assert.equal(p.counts.registrations, 1);
    await p.click();
    assert.equal(p.counts.registrations, 2);
    assert.match(p.button.textContent, /Đã bật/);
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

test('each required browser API is checked before permission or token generation', async () => {
    for (const missingApi of ['serviceWorker', 'PushManager', 'Notification']) {
        const p = await page({ missingApi });
        await p.click();
        assert.equal(p.counts.prompts, 0);
        assert.equal(p.counts.tokens, 0);
        assert.equal(p.button.disabled, true);
        assert.ok(p.status.textContent);
    }
});

test('missing VAPID key explains the exact configuration error instead of preparation text', async () => {
    const p = await page({ key: '' });
    await p.click();
    assert.match(p.status.textContent, /VAPID/);
    assert.doesNotMatch(p.status.textContent, /chuẩn bị/);
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
    const payload = { messageId: 'event-1', data: { url: target, title: '<img src=x>', body: 'new', cover: `${origin}/cover.jpg` } };
    p.receive(payload);
    p.receive(payload);
    p.receive({ messageId: 'external', data: { url: 'https://evil.example/manga/x/chapter/1/' } });
    assert.equal(p.counts.toasts, 1);
    assert.equal(p.counts.covers, 1);
    await p.changeAccount(null);
    p.receive({ ...payload, messageId: 'after-logout' });
    assert.equal(p.counts.toasts, 1);
    assert.ok(p.counts.revokes > 0);
});

function registrationContext(overrides = {}) {
    const storage = new Map();
    const context = {
        app: {}, auth: { currentUser: { uid: 'u' } }, URL,
        PUSH_FUNCTIONS_REGION: 'us-central1',
        getFunctions: app => app,
        httpsCallable: () => async () => ({ data: { success: true } }),
        crypto: webcrypto, TextEncoder, Uint8Array, location: { origin },
        PUSH_WORKER_URL: '/firebase-messaging-sw.js', PUSH_WORKER_SCOPE: '/firebase-cloud-messaging-push-scope/',
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        navigator: { serviceWorker: { getRegistrations: async () => [] } },
        ...overrides
    };
    vm.createContext(context);
    vm.runInContext(registrationSource, context);
    return context;
}

test('backend registration uses the existing app, callable name and token-only payload; concurrent calls share a request', async () => {
    let calls = 0;
    let finish;
    const response = new Promise(resolve => { finish = resolve; });
    const app = {};
    const h = registrationContext({
        app, PUSH_FUNCTIONS_REGION: 'us-central1',
        getFunctions(existingApp, region) {
            assert.equal(existingApp, app);
            assert.equal(region, 'us-central1');
            return 'functions';
        },
        httpsCallable(functions, name) {
            assert.equal(functions, 'functions');
            if (name === 'unregisterPushToken') return async () => { assert.fail('unexpected unregister'); };
            assert.equal(name, 'registerPushToken');
            return async data => {
                assert.deepEqual(Object.keys(data), ['token']);
                assert.equal(data.token, 'token');
                calls++;
                return response;
            };
        }
    });
    const first = h.registerDeviceToken({ uid: 'u' }, 'token');
    const second = h.registerDeviceToken({ uid: 'u' }, 'token');
    // Wait until both independent digest operations have finished.
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    assert.equal(h.registrationReceipt(), null);
    finish({ data: { success: true } });
    const [id, repeatedId] = await Promise.all([first, second]);
    assert.match(id, /^[a-f0-9]{64}$/);
    assert.equal(id, repeatedId);
    assert.equal(JSON.stringify(h.registrationReceipt()).includes('"token"'), false);
    await assert.rejects(h.registerDeviceToken({ uid: 'other' }, 'token'), /auth-changed/);
    assert.equal(calls, 1);
});

test('callable failures never save a receipt and allow a later retry', async () => {
    let calls = 0;
    const h = registrationContext({ httpsCallable: () => async () => {
        calls++;
        if (calls === 1) throw new Error('functions/unavailable');
        if (calls === 2) return { data: { success: false } };
        return { data: { success: true } };
    } });
    await assert.rejects(h.registerDeviceToken({ uid: 'u' }, 'token'), /unavailable/);
    assert.equal(h.registrationReceipt(), null);
    await assert.rejects(h.registerDeviceToken({ uid: 'u' }, 'token'), /backend-rejected/);
    assert.equal(h.registrationReceipt(), null);
    await h.registerDeviceToken({ uid: 'u' }, 'token');
    assert.equal(h.registrationReceipt().uid, 'u');
});

test('disable binds the exact worker, unregisters before FCM deletion, and keeps browser permission', async () => {
    const events = [];
    const registration = { scope: `${origin}/firebase-cloud-messaging-push-scope/`, active: { scriptURL: `${origin}/firebase-messaging-sw.js` } };
    const messaging = {};
    const h = registrationContext({
        PUBLIC_VAPID_KEY: 'test-public-key', Notification: { permission: 'granted' },
        navigator: { serviceWorker: { getRegistrations: async () => [registration] } },
        httpsCallable: (functions, name) => async data => {
            assert.equal(name, 'unregisterPushToken');
            assert.equal(data.token, 'current-token');
            assert.deepEqual(Object.keys(data), ['token']);
            events.push('unregister');
            return { data: { success: true } };
        }
    });
    h.loadMessaging = async () => ({
        getMessaging: () => messaging,
        getToken: async (instance, options) => {
            assert.equal(instance, messaging);
            assert.equal(options.serviceWorkerRegistration, registration);
            assert.equal(options.vapidKey, 'test-public-key');
            events.push('getToken');
            return 'current-token';
        },
        deleteToken: async instance => { assert.equal(instance, messaging); events.push('deleteToken'); return true; }
    });
    h.localStorage.setItem('heliumtg_push_registration', JSON.stringify({ uid: 'u', id: 'a'.repeat(64) }));
    await h.disableDeviceNotifications({ uid: 'u' });
    assert.deepEqual(events, ['getToken', 'unregister', 'deleteToken']);
    assert.equal(h.registrationReceipt(), null);
    assert.equal(h.Notification.permission, 'granted');
});

test('unregister rejection does not delete the FCM token or clear the receipt', async () => {
    const h = registrationContext({
        PUBLIC_VAPID_KEY: 'test-public-key', Notification: { permission: 'granted' },
        navigator: { serviceWorker: { getRegistrations: async () => [{ scope: `${origin}/firebase-cloud-messaging-push-scope/`, active: { scriptURL: `${origin}/firebase-messaging-sw.js` } }] } },
        httpsCallable: () => async () => { throw new Error('unavailable'); }
    });
    h.loadMessaging = async () => ({ getMessaging: () => ({}), getToken: async () => 'token', deleteToken: async () => assert.fail('must not delete') });
    h.localStorage.setItem('heliumtg_push_registration', JSON.stringify({uid:'u',id:'hint'}));
    await assert.rejects(h.disableDeviceNotifications({ uid: 'u' }), /unavailable/);
    assert.ok(h.registrationReceipt());
    const p = await page({ permission: 'granted', subscribed: true, failDisable: true });
    await p.click();
    assert.match(p.status.textContent, /thử lại/);
    assert.equal(p.button.disabled, false);
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

test('logout unsubscribes only the FCM device and clears its local receipt', async () => {
    let unsubscribed = 0;
    const registration = {
        scope: `${origin}/firebase-cloud-messaging-push-scope/`,
        active: { scriptURL: `${origin}/firebase-messaging-sw.js` },
        pushManager: { getSubscription: async () => ({ unsubscribe: async () => { unsubscribed++; return true; } }) }
    };
    const h = registrationContext({
        navigator: { serviceWorker: { getRegistrations: async () => [registration] } }
    });
    h.localStorage.setItem('heliumtg_push_registration', JSON.stringify({ uid: 'u', id: 'a'.repeat(64) }));
    await h.revokeBrowserPush();
    assert.equal(unsubscribed, 1);
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
    assert.equal(w.shown[0].title, 'Manga');
    assert.equal(w.shown[0].options.body, 'Chapter 10.5');
    assert.equal(w.shown[0].options.icon, `${origin}/assets/icons/icon-192.png`);
    assert.equal(w.shown[0].options.badge, `${origin}/assets/icons/notification-badge.png`);
    assert.equal(w.shown[0].options.actions, undefined);
    assert.equal(w.shown[0].options.image, undefined);
    await w.background({ notification: { title: 'Automatic' }, data: { url: target } });
    await w.background({ data: { url: 'javascript:alert(1)' } });
    assert.equal(w.shown.length, 1);
});

test('background appearance prefers the manga cover and never substitutes OG images', async () => {
    const w = worker();
    const og = `${origin}/assets/og/example.png`;
    const cover = 'https://pub-a0cc60d51c6e4ebab81ee134d3dada9e.r2.dev/example/cover.jpg';
    await w.background({ data: { url: target, mangaTitle: 'Example manga', chapterTitle: 'Chương 10.5', ogImage: og, cover } });
    assert.equal(w.shown[0].title, 'Example manga có chương mới!');
    assert.equal(w.shown[0].options.body, 'Chương 10.5 vừa được đăng trên Hắc Âm Chi Các.');
    assert.equal(w.shown[0].options.image, cover);
    await w.background({ data: { url: target, image: 'https://untrusted.example/image.jpg', cover } });
    assert.equal(w.shown[1].options.image, cover);
    for (const invalid of [undefined, '', '/cover.jpg', 'http://heliumtg.com/cover.jpg', 'https://localhost/cover.jpg', 'https://user:pass@heliumtg.com/cover.jpg']) {
        await w.background({ data: { url: target, cover: invalid, image: og, ogImage: og } });
        assert.equal(w.shown.at(-1).options.image, undefined);
    }
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
