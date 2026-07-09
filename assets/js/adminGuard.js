import { app, db }
from "./firebase.js";

import {

getAuth,

onAuthStateChanged

}

from

"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {

doc,

getDoc

}

from

"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";


const auth =
    getAuth(app);

export function requireAdmin(){

    onAuthStateChanged(
        auth,
        async(user)=>{

            if(!user){

                location.href =
                    "login.html";

                return;

            }

            const snap =
                await getDoc(

                    doc(
                        db,
                        "users",
                        user.uid
                    )

                );

            const data =
                snap.data();

            if(
                data.role !==
                "admin"
            ){

                alert(
                    "Bạn không có quyền truy cập."
                );

                location.href =
                    "../index.html";

            }

        }
    );

}