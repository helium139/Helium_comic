import { clearStaffNavigation, updateStaffNavigation } from "./staff-navigation.js";
import { createDefaultProfile } from "./user-profile.js";
import "./notifications.js";
import { auth, onAuthStateChanged, getUserSnapshot } from "./firebase-session.js";
import { db } from "./firebase.js";

import {
    signOut
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";


import {
    doc,
    setDoc
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";


let authVersion = 0;

const userBox =
    document.getElementById(
        "user-box"
    );


onAuthStateChanged(
    auth,
    async (user) => {
        const version = ++authVersion;
        clearStaffNavigation();

        if(user){

            const userRef =
    doc(
        db,
        "users",
        user.uid
    );


const userSnap =
    await getUserSnapshot(user.uid);

let userData = {};

if(userSnap.exists()){

    userData = userSnap.data();

}else{

    userData = createDefaultProfile(user);
    await setDoc(userRef, userData);
}
            if (version !== authVersion || auth.currentUser !== user) return;
            userBox.innerHTML = `
            
            <div class="user-profile">
            <a href="/user/" class="user-link">

                <img 
                    src="${userData.avatar || user.photoURL}"
                    class="user-avatar"
                    alt="avatar"
                >

                <span>
                    ${userData.name || user.displayName}
                </span>
                </a>
                <button id="logout-btn">
                    Đăng xuất
                </button>
            
            </div>
            
            `;



            document
            .getElementById("logout-btn")
            .addEventListener(
                "click",
                async () => {

                    try {
                        const { stopBrowserNotifications } = await import("./notifications.js");
                        await stopBrowserNotifications();
                    } catch {
                        alert("Chưa thể tắt thông báo trên thiết bị này. Vui lòng thử đăng xuất lại.");
                        return;
                    }
                    await signOut(auth);

                    location.reload();

                }
            );

            await updateStaffNavigation(user, userData);

        }
        else{

            userBox.innerHTML = `
            
            <a href="/login/">

                <i class="bx bx-user"></i>

                Đăng nhập

            </a>
            
            `;

        }

    }
);