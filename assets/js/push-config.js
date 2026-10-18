// Firebase Console → Project settings → Cloud Messaging → Web configuration
// → Web Push certificates → Generate key pair. Paste ONLY the public key here.
export const PUBLIC_VAPID_KEY = "";

// Explicitly isolated from the site's existing third-party /sw.js registration.
export const PUSH_WORKER_URL = "/firebase-messaging-sw.js";
export const PUSH_WORKER_SCOPE = "/firebase-cloud-messaging-push-scope/";
