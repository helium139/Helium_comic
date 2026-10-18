import { app } from "./firebase.js";
import { auth } from "./firebase-session.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-functions.js";
import { PUSH_WORKER_URL, PUSH_WORKER_SCOPE, PUSH_FUNCTIONS_REGION } from "./push-config.js";

const RECEIPT_KEY = "heliumtg_push_registration";
// Auth credentials are attached by the callable SDK. The server must derive UID
// from request.auth, validate the token, and upsert it idempotently.
const functions = getFunctions(app, PUSH_FUNCTIONS_REGION);
export const registerPushToken = httpsCallable(functions, "registerPushToken");
const pendingRegistrations = new Map();
let messagingSdk;
export function loadMessaging() {
    if (!messagingSdk) messagingSdk = import("https://www.gstatic.com/firebasejs/12.1.0/firebase-messaging.js")
        .catch(error => { messagingSdk = null; throw error; });
    return messagingSdk;
}
export function registrationReceipt() {
    try { return JSON.parse(localStorage.getItem(RECEIPT_KEY)); }
    catch { return null; }
}
export async function tokenDocumentId(token) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function isPushWorker(registration) {
    return registration.scope === new URL(PUSH_WORKER_SCOPE, location.origin).href &&
        [registration.active, registration.waiting, registration.installing]
            .some(worker => worker && new URL(worker.scriptURL).pathname === PUSH_WORKER_URL);
}
export async function existingPushWorker() {
    if (!("serviceWorker" in navigator)) return null;
    return (await navigator.serviceWorker.getRegistrations()).find(isPushWorker) || null;
}
export async function ensurePushWorker() {
    const scope = new URL(PUSH_WORKER_SCOPE, location.origin).href;
    const registrations = await navigator.serviceWorker.getRegistrations();
    const conflict = registrations.find(item => item.scope === scope && !isPushWorker(item));
    if (conflict) throw new Error("push/scope-conflict");
    const registration = await navigator.serviceWorker.register(PUSH_WORKER_URL, { scope: PUSH_WORKER_SCOPE });
    // serviceWorker.ready refers to the worker controlling this page (possibly ads).
    // Wait for THIS registration instead; it need not control the homepage.
    if (!registration.active) await new Promise((resolve, reject) => {
        const worker = registration.installing || registration.waiting;
        if (!worker) return reject(new Error("push/worker-unavailable"));
        const timeout = setTimeout(() => finish(new Error("push/worker-timeout")), 15000);
        function finish(error) {
            clearTimeout(timeout);
            worker.removeEventListener("statechange", changed);
            error ? reject(error) : resolve();
        }
        function changed() {
            if (worker.state === "activated") finish();
            else if (worker.state === "redundant") finish(new Error("push/worker-unavailable"));
        }
        worker.addEventListener("statechange", changed);
        changed();
    });
    return registration;
}

export async function registerDeviceToken(user, token) {
    if (!token || token.length > 4096) throw new Error("push/invalid-token");
    if (auth.currentUser?.uid !== user.uid) throw new Error("push/auth-changed");
    const id = await tokenDocumentId(token);
    if (auth.currentUser?.uid !== user.uid) throw new Error("push/auth-changed");
    const requestKey = JSON.stringify([user.uid, id]);
    if (!pendingRegistrations.has(requestKey)) {
        const request = registerPushToken({ token }).then(result => {
            if (result.data?.success === false || result.data?.ok === false) {
                throw new Error("push/backend-rejected");
            }
        }).finally(() => pendingRegistrations.delete(requestKey));
        pendingRegistrations.set(requestKey, request);
    }
    await pendingRegistrations.get(requestKey);
    if (auth.currentUser?.uid !== user.uid) throw new Error("push/auth-changed");
    // A local receipt is a hint for account changes, never proof of registration.
    // Do not keep raw tokens in localStorage or log them.
    localStorage.setItem(RECEIPT_KEY, JSON.stringify({ uid: user.uid, id }));
    return id;
}

export async function revokeBrowserPush() {
    const registration = await existingPushWorker();
    if (registration) {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription && !await subscription.unsubscribe() && await registration.pushManager.getSubscription()) {
            throw new Error("push/unsubscribe-failed");
        }
        // Unsubscribe the exact registration. Calling FCM deleteToken from a fresh
        // page can select its default registration instead of our explicit scope.
        // getToken detects the absent subscription and refreshes on next opt-in.
    }
    try { localStorage.removeItem(RECEIPT_KEY); } catch { /* Storage may be disabled. */ }
}
