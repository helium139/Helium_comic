import { app, db } from "./firebase.js";

import {
    getAuth,
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


const auth = getAuth(app);

const provider = new GoogleAuthProvider();


const loginBtn =
    document.getElementById(
        "google-login"
    );


loginBtn.addEventListener(
    "click",
    async () => {

        try {

            const result =
                await signInWithPopup(
                    auth,
                    provider
                );


            const user =
                result.user;


            console.log(
                "Đăng nhập thành công:",
                user
            );


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

                        createdAt:
                            new Date(),

                        role:
                            "user"
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
                "index.html";


        } catch(error) {

            console.error(
                "Lỗi đăng nhập:",
                error
            );

            alert(
                "Đăng nhập thất bại!"
            );

        }

    }
);