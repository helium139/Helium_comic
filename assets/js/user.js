import { app, db } from "./firebase.js";

import {
    getAuth,
    onAuthStateChanged,
    updateProfile
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
    doc,
    getDoc,
    collection,
    getDocs
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";


const auth = getAuth(app);

onAuthStateChanged(auth, async(user)=>{

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

    const snap =
        await getDoc(userRef);

    const data =
        snap.data();

    document.getElementById(
        "user-avatar"
    ).src =
        data.avatar;

    document.getElementById(
        "user-name"
    ).textContent =
        data.name;

    document.getElementById(
        "user-email"
    ).textContent =
        data.email;

    document.getElementById(
        "likes-count"
    ).textContent =
        data.likes?.length || 0;

    document.getElementById(
        "follows-count"
    ).textContent =
        data.follows?.length || 0;


    const historyRef =
        collection(
            db,
            "users",
            user.uid,
            "history"
        );

    const historySnap =
        await getDocs(historyRef);

    document.getElementById(
        "history-count"
    ).textContent =
        historySnap.size;
});

document
.getElementById("saveNameBtn")
.addEventListener(
    "click",
    async ()=>{

        const newName =
            document
            .getElementById("newName")
            .value
            .trim();

        if(!newName) return;

        await updateProfile(
            auth.currentUser,
            {
                displayName:newName
            }
        );

        await updateDoc(
            userRef,
            {
                name:newName
            }
        );

        alert("Đã cập nhật");

        location.reload();

    }
);

document
.getElementById("saveAvatarBtn")
.addEventListener(
    "click",
    async()=>{

        const avatar =
            document
            .getElementById("avatarUrl")
            .value;

        await updateProfile(
            auth.currentUser,
            {
                photoURL:avatar
            }
        );

        await updateDoc(
            userRef,
            {
                avatar:avatar
            }
        );

        alert("Đã cập nhật avatar");

        location.reload();

    }
);