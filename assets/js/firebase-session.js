import { app, db } from "./firebase.js";
import { getAuth, onAuthStateChanged as observeAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const auth = getAuth(app);
const subscribers = new Set();
let ready = false;
let currentUser = null;

function notify(callback, user) {
    Promise.resolve().then(() => callback(user)).catch(error => {
        console.error("Authentication state handler failed", error.code || error.name);
    });
}

// One SDK observer for this document. Full navigation destroys the module;
// keeping it alive during bfcache suspension preserves auth checks on return.
observeAuth(auth, user => {
    ready = true;
    currentUser = user;
    for (const callback of subscribers) notify(callback, user);
});

export function onAuthStateChanged(instance, callback) {
    if (instance !== auth) throw new Error("Unexpected Auth instance");
    subscribers.add(callback);
    if (ready) queueMicrotask(() => {
        if (subscribers.has(callback)) notify(callback, currentUser);
    });
    return () => subscribers.delete(callback);
}

const pendingProfiles = new Map();
export function getUserSnapshot(uid) {
    if (!pendingProfiles.has(uid)) {
        const request = getDoc(doc(db, "users", uid)).finally(() => {
            pendingProfiles.delete(uid);
        });
        pendingProfiles.set(uid, request);
    }
    return pendingProfiles.get(uid);
}
