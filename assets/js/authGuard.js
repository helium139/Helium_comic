import { app }
from "./firebase.js";

import {
    getAuth,
    onAuthStateChanged
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const auth = getAuth(app);

export function requireLogin(){

    onAuthStateChanged(
        auth,
        (user) => {

            if(!user){

                location.href =
                    "login.html";

            }

        }
    );

}