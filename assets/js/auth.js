import { app, db } from "./firebase.js";

import {
    getAuth,
    onAuthStateChanged,
    signOut
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";


import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const auth = getAuth(app);


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
    await getDoc(userRef);

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
            <a href="user.html" class="user-link">

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
    <a href="admin/index.html">
        Admin
    </a>
    `;

}


            document
            .getElementById("logout-btn")
            .addEventListener(
                "click",
                async () => {

                    await signOut(auth);

                    location.reload();

                }
            );

        }
        else{

            userBox.innerHTML = `
            
            <a href="login.html">

                <i class="bx bx-user"></i>

                Đăng nhập

            </a>
            
            `;

        }

    }
);