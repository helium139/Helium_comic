import { auth, onAuthStateChanged, getUserSnapshot } from "./firebase-session.js";

import { db } from "./firebase.js";

import {
    updateProfile
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
    doc,
    updateDoc
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

let currentUserRef = null;
let loadedProfile = null;


onAuthStateChanged(auth, async(user)=>{

    if(!user){

        location.href =
            "/login/";

        return;
    }

    currentUserRef =
    doc(
        db,
        "users",
        user.uid
    );

const snap =
    await getUserSnapshot(user.uid);

    const data =
        snap.data();
    loadedProfile = data;

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

        if(!newName || !auth.currentUser || !loadedProfile) return;
        if (newName === loadedProfile.name && newName === auth.currentUser.displayName) return;

        await updateProfile(
            auth.currentUser,
            {
                displayName:newName
            }
        );

        await updateDoc(
    currentUserRef,
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


        if (!auth.currentUser || !loadedProfile || avatar === loadedProfile.avatar) return;

        await updateDoc(
    currentUserRef,
    {
        avatar: avatar
    }
);

        alert("Đã cập nhật avatar");

        location.reload();

    }
);