import { initializeApp } from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

import {
  getFirestore
} from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import "./firebase-config.js";

const app = initializeApp(globalThis.HELIUM_FIREBASE_CONFIG);

export const db = getFirestore(app);

export { app };