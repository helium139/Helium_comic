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



const historyRef =
    collection(
        db,
        "users",
        user.uid,
        "history"
    );

const snapshot =
    await getDocs(
        historyRef
    );
    const history =
    snapshot.docs.sort(
        (a,b)=>
            b.data().updatedAt.seconds
            -
            a.data().updatedAt.seconds
    );

async function loadHistory(
    history
){

    const res =
        await fetch(
            "assets/data/data.json"
        );

    const data =
        await res.json();

    const container =
        document.getElementById(
            "history-list"
        );

    container.innerHTML = "";

    history.forEach(manga => {

        const manga =
            data[manga.id];

        if(!manga) return;

        container.innerHTML += `
        
        <a
            href="manga.html?id=${manga.id}"
            class="comic-item">

            <div class="comic-poster">

                <img
                    src="${manga.cover}"
                    alt="${manga.title}">

            </div>

            <div class="comic-info">

                <h3>
                    ${manga.title}
                    ${manga.chapter}
                </h3>
                <button>
                <a href="chapter.html?id=${manga.id}&chapter=${chapterId}">
                    <span>
                        Tiếp tục đọc
                    </span>
                </a>
                </button>
            </div>

        </a>
        
        `;

    });

}