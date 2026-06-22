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

            console.log(
                "Đã đăng nhập:",
                user.displayName
            );

        }else{

            console.log(
                "Chưa đăng nhập"
            );

        }

    }
);