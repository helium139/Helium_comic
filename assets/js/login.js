import { auth } from "./firebase-session.js";
import { db } from "./firebase.js";

import {
GoogleAuthProvider,
    signInWithPopup
}
from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
    doc,
    getDoc,
    setDoc
}
from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";




const provider = new GoogleAuthProvider();


const loginBtn =
    document.getElementById(
        "google-login"
    );


let signingIn = false;

loginBtn.addEventListener(
    "click",
    async () => {

        if (signingIn) return;
        signingIn = true;
        loginBtn.disabled = true;

        try {

            const result =
                await signInWithPopup(
                    auth,
                    provider
                );


            const user =
                result.user;


            const userRef =
                doc(
                    db,
                    "users",
                    user.uid
                );


            const userSnap =
                await getDoc(userRef);


            // Nếu là user mới
            if(!userSnap.exists()) {

                await setDoc(
                    userRef,
                    {
                        name:
                            user.displayName,

                        email:
                            user.email,

                        avatar:
                            user.photoURL,

                        createdAt: new Date(),

                        role: "user",

                        likes: [],

                        follows: [],

                        history: []
                    },
                    {
                        merge: true
                    }
                );

                console.log(
                    "Đã tạo tài khoản mới"
                );

            }

            alert(
                "Đăng nhập thành công!"
            );

            window.location.href =
                "/";


        } catch(error) {

            console.error(
                "Lỗi đăng nhập:",
                error
            );

            alert(
                "Đăng nhập thất bại!"
            );

        }

        finally {
            signingIn = false;
            loginBtn.disabled = false;
        }
    }
);