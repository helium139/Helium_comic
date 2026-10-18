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
    setDoc,
    serverTimestamp
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";


const userBox =
    document.getElementById(
        "user-box"
    );


onAuthStateChanged(
    auth,
    async (user) => {

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

    await setDoc(userRef,{
        name: user.displayName,
        email: user.email,
        avatar: user.photoURL || "assets/images/default-avatar.png",
        createdAt: serverTimestamp(),
        likes: [],
        follows: [],
        history: []
    });

    userData = {
        name: user.displayName,
        avatar: user.photoURL
    };
}
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

            if(userData.role === "admin"){

    document.querySelector(
        ".navigation"
    ).innerHTML +=
    `
    <a href="/admin/">
        Admin
    </a>
    `;

}


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