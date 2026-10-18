import { app } from "./firebase.js";
import { auth, onAuthStateChanged } from "./firebase-session.js";
import { PUBLIC_VAPID_KEY } from "./push-config.js";
import { loadMessaging, existingPushWorker, ensurePushWorker, registrationReceipt,
    registerDeviceToken, revokeBrowserPush } from "./push-registration.js";

const button = document.getElementById("notification-button");
const status = document.getElementById("notification-status");
let user = null;
let authReady = false;
let supported = false;
let busy = false;
let registered = false;
let receiverStarted = false;
let version = 0;
let signingOut = false;
let activeSetup = Promise.resolve();
const seenMessages = new Set();

function render(message = "") {
    if (!button) return;
    button.disabled = !supported || !authReady || busy || signingOut;
    button.textContent = !supported ? "Thông báo chưa được hỗ trợ" :
        Notification.permission === "denied" ? "🔕 Thông báo bị chặn" :
        registered && user && Notification.permission === "granted" ? "🔔 Đã bật thông báo" : "🔔 Nhận thông báo";
    status.textContent = message;
}
function safeChapterUrl(value) {
    try {
        const url = new URL(value, location.origin);
        if (url.origin === location.origin && /^\/manga\/[^/]+\/chapter\/[^/]+\/$/.test(url.pathname)) {
            url.search = "";
            url.hash = "";
            return url.href;
        }
    } catch { /* Ignore malformed messages. */ }
    return null;
}
function receiveMessage(payload) {
    if (signingOut || !user || Notification.permission !== "granted") return;
    const data = payload.data || {};
    const url = safeChapterUrl(data.url || payload.fcmOptions?.link);
    if (!url || (data.uid && data.uid !== user.uid)) return;
    const key = payload.messageId || data.eventId || url;
    if (seenMessages.has(key)) return;
    seenMessages.add(key);
    if (seenMessages.size > 100) seenMessages.delete(seenMessages.values().next().value);
    document.querySelector(".chapter-notification-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "chapter-notification-toast";
    toast.setAttribute("role", "status");
    const link = document.createElement("a");
    link.href = url;
    // Text content prevents message content from becoming HTML.
    link.textContent = `${data.title || payload.notification?.title || "HeliumTG có chương mới!"} — ${data.body || payload.notification?.body || "Nhấn để đọc chương mới."}`;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Đóng thông báo");
    close.addEventListener("click", () => toast.remove());
    toast.append(link, close);
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 15000);
}
function browserSupportError() {
    if (!globalThis.isSecureContext) return "Thông báo yêu cầu HTTPS hoặc localhost.";
    if (!("serviceWorker" in navigator)) return "Trình duyệt chưa hỗ trợ Service Worker. Trên iPhone/iPad, hãy mở trang từ Màn hình chính.";
    if (!("PushManager" in globalThis)) return "Trình duyệt chưa hỗ trợ Web Push. Trên iPhone/iPad, hãy thêm trang vào Màn hình chính rồi mở lại.";
    if (!("Notification" in globalThis)) return "Trình duyệt chưa hỗ trợ Notification API. Trên iPhone/iPad, hãy mở trang từ Màn hình chính.";
    return "";
}
function registrationError(error) {
    const code = error.code || error.message;
    if (code === "push/not-configured") return "Thiếu khóa VAPID công khai trong cấu hình Firebase. Vui lòng liên hệ quản trị viên.";
    if (code === "functions/unauthenticated") return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để bật thông báo.";
    if (code === "functions/not-found") return "Không tìm thấy registerPushToken. Vui lòng kiểm tra vùng triển khai Cloud Functions.";
    if (code === "functions/permission-denied") return "Máy chủ từ chối đăng ký thông báo cho tài khoản này. Vui lòng liên hệ quản trị viên.";
    return "Chưa thể đăng ký thông báo. Vui lòng kiểm tra kết nối rồi thử lại.";
}

async function startReceiver() {
    if (receiverStarted || !PUBLIC_VAPID_KEY || !supported || !user || Notification.permission !== "granted") return;
    const sdk = await loadMessaging();
    if (!receiverStarted) {
        sdk.onMessage(sdk.getMessaging(app), receiveMessage);
        receiverStarted = true;
    }
}

function synchronize(explicit = false) {
    if (signingOut || busy || !supported || !user) return activeSetup;
    activeSetup = synchronizeDevice(explicit);
    return activeSetup;
}
async function synchronizeDevice(explicit) {
    const account = user;
    const requestVersion = version;
    busy = true;
    let errorMessage = "";
    let registrationAttempted = false;
    registered = false;
    render("Đang kiểm tra thông báo…");
    try {
        if (!PUBLIC_VAPID_KEY) throw new Error("push/not-configured");
        const receipt = registrationReceipt();
        if (receipt && receipt.uid !== account.uid) await revokeBrowserPush();
        if (!explicit) {
            const existing = await existingPushWorker();
            if (!existing || !await existing.pushManager.getSubscription()) return;
        }
        // getToken may request permission itself: never call unless already granted.
        if (Notification.permission !== "granted" || auth.currentUser?.uid !== account.uid) return;
        const sdk = await loadMessaging();
        const registration = await ensurePushWorker();
        registrationAttempted = true;
        const token = await sdk.getToken(sdk.getMessaging(app), {
            vapidKey: PUBLIC_VAPID_KEY, serviceWorkerRegistration: registration
        });
        if (requestVersion !== version || auth.currentUser?.uid !== account.uid) {
            await revokeBrowserPush();
            return;
        }
        await registerDeviceToken(account, token);
        if (requestVersion !== version || user?.uid !== account.uid) return;
        registered = true;
        await startReceiver();
    } catch (error) {
        registered = false;
        if (registrationAttempted) {
            try { await revokeBrowserPush(); }
            catch {
                errorMessage = "Chưa thể cập nhật đăng ký thông báo. Vui lòng kiểm tra cài đặt trang web rồi thử lại.";
            }
        }
        errorMessage = errorMessage || registrationError(error);
    } finally {
        busy = false;
        if (requestVersion === version) render(errorMessage);
        else render();
    }
}

button?.addEventListener("click", async () => {
    if (busy || signingOut) return;
    const supportError = browserSupportError();
    if (supportError) {
        supported = false;
        render(supportError);
        return;
    }
    if (!supported) {
        render("Firebase Messaging không được hỗ trợ trên trình duyệt này.");
        return;
    }
    if (!user) {
        render("Vui lòng đăng nhập để nhận thông báo cho truyện đang theo dõi.");
        return;
    }
    if (Notification.permission === "denied") {
        render("Thông báo bị chặn. Hãy cho phép thông báo trong phần cài đặt trang web của trình duyệt, rồi tải lại trang.");
        return;
    }
    if (!PUBLIC_VAPID_KEY) {
        render(registrationError(new Error("push/not-configured")));
        return;
    }
    if (Notification.permission === "default") {
        // Called directly in the click handler, preserving the user gesture.
        busy = true;
        render();
        try {
            const permission = await Notification.requestPermission();
            if (permission !== "granted") {
                render(permission === "denied" ? "Hãy cho phép thông báo trong cài đặt trang web của trình duyệt." : "Bạn chưa cho phép thông báo.");
                return;
            }
        } catch {
            render("Không thể yêu cầu quyền thông báo. Vui lòng kiểm tra cài đặt trình duyệt.");
            return;
        } finally {
            busy = false;
            button.disabled = !supported || !authReady;
        }
    }
    await synchronize(true);
});

async function initialize() {
    const supportError = browserSupportError();
    if (supportError) {
        render(supportError);
        return;
    }
    try { supported = await (await loadMessaging()).isSupported(); }
    catch { supported = false; }
    render(supported ? "" : "Không thể sử dụng thông báo trên trình duyệt này.");
    onAuthStateChanged(auth, async account => {
        user = account;
        if (account) signingOut = false;
        authReady = true;
        registered = false;
        ++version;
        render();
        if (!supported) return;
        const receipt = registrationReceipt();
        if (!account || !receipt || receipt.uid !== account.uid || Notification.permission === "denied") {
            try { await revokeBrowserPush(); }
            catch {
                render("Chưa thể cập nhật thông báo cho phiên đăng nhập. Vui lòng kiểm tra cài đặt trang web.");
                return;
            }
            if (!account || Notification.permission === "denied") return;
        }
        try { await startReceiver(); }
        catch {
            render("Chưa thể nhận thông báo. Vui lòng tải lại trang để thử lại.");
            return;
        }
        // A permission grant alone isn't proof this device was registered.
        // Only the homepage restores an existing opted-in subscription.
        if (button && Notification.permission === "granted") await synchronize();
    });
}
window.addEventListener("pageshow", event => {
    if (event.persisted && supported) {
        registered = false;
        render();
        if (button && user && Notification.permission === "granted") synchronize();
    }
});
initialize();

// Finish/cancel in-flight setup before invalidating the subscription on logout.
export async function stopBrowserNotifications() {
    signingOut = true;
    registered = false;
    ++version;
    render();
    try {
        await activeSetup;
        await revokeBrowserPush();
    } catch (error) {
        signingOut = false;
        render();
        throw error;
    }
}
