import { initializeApp } from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

import {
  getFirestore
} from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig = {
apiKey: "AIzaSyBAXG1_rRHKkn9jP4IIIMzTbZmttTuzr1g",
authDomain: "helium-team-d7f80.firebaseapp.com",
projectId: "helium-team-d7f80",
storageBucket: "helium-team-d7f80.firebasestorage.app",
messagingSenderId: "351410825333",
appId: "1:351410825333:web:f02fc89a3ab18bf272703c",
measurementId: "G-XWZSTJFVXB"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);