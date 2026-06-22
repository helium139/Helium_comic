import { app } from "./firebase.js";

import {
    getAuth,
    onAuthStateChanged,
    signOut
}
from 
"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";


const auth = getAuth(app);


const userBox =
    document.getElementById(
        "user-box"
    );


onAuthStateChanged(
    auth,
    (user) => {

        if(user){

            userBox.innerHTML = `
            
            <div class="user-profile">

                <img 
                    src="${user.photoURL}"
                    class="user-avatar"
                    alt="avatar"
                >

                <span>
                    ${user.displayName}
                </span>

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