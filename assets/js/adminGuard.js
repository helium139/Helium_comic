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

export async function requireAdmin(){

    return new Promise((resolve,reject)=>{

        onAuthStateChanged(

            auth,

            async(user)=>{

                if(!user){

                    location.href="../login.html";

                    reject();

                    return;

                }

                try{

                    const snap=
                    await getDoc(

                        doc(
                            db,
                            "users",
                            user.uid
                        )

                    );

                    if(!snap.exists()){

                        location.href="../index.html";

                        reject();

                        return;

                    }

                    const data=snap.data();

                    if(data.role!=="admin"){

                        location.href="../index.html";

                        reject();

                        return;

                    }

                    resolve(user);

                }

                catch(err){

                    reject(err);

                }

            }

        );

    });

}