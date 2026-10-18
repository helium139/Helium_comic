import { auth, onAuthStateChanged } from "./firebase-session.js";


export function requireLogin(){

    onAuthStateChanged(
        auth,
        (user) => {

            if(!user){

                location.href =
                    "/login/";

            }

        }
    );

}