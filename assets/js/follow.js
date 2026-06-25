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

onAuthStateChanged(
    auth,
    async(user)=>{

        if(!user){

            location.href =
                "login.html";

            return;
        }

        const userRef =
            doc(
                db,
                "users",
                user.uid
            );

        const userSnap =
            await getDoc(
                userRef
            );

        const userData =
            userSnap.data();

        loadFollowedManga(
            userData.follows || []
        );

    }
);

async function loadFollowedManga(
    follows
){

    const res =
        await fetch(
            "assets/data/data.json"
        );

    const data =
        await res.json();

    const container =
        document.getElementById(
            "follow-list"
        );

    container.innerHTML = "";

    follows.forEach(id => {

        const manga =
            data[id];

        if(!manga) return;

        container.innerHTML += `
        
        <a
            href="manga.html?id=${id}"
            class="comic-item">

            <div class="comic-poster">

                <img
                    src="${manga.cover}"
                    alt="${manga.title}">

            </div>

            <div class="comic-info">

                <h3>
                    ${manga.title}
                </h3>

            </div>

        </a>
        
        `;

    });

}