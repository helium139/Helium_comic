import { app, db } from "./firebase.js";

import{
    collection,
    addDoc,
    doc,
    getDoc,
    query,
    orderBy,
    serverTimestamp,
    onSnapshot
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import{
    getAuth
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const auth = getAuth(app);

const params =
new URLSearchParams(window.location.search);

const mangaId = params.get("id");

const input =
document.getElementById("comment-input");

const sendBtn =
document.getElementById("send-comment");

const list =
document.getElementById("comments-list");



// ==========================
// GỬI COMMENT
// ==========================

// ==========================
// SEND COMMENT
// ==========================

let sending = false;

async function sendComment(){

    if(sending) return;

    if(!auth.currentUser){

        alert("Bạn cần đăng nhập.");

        return;

    }

    const text =
        input.value.trim();

    if(text === "") return;

    sending = true;

    sendBtn.disabled = true;

    sendBtn.innerHTML = "⏳";

    try{

        const userSnap =
            await getDoc(

                doc(
                    db,
                    "users",
                    auth.currentUser.uid
                )

            );

        if(!userSnap.exists()){

            throw new Error(
                "Không tìm thấy thông tin người dùng."
            );

        }

        const user =
            userSnap.data();

        await addDoc(

            collection(
                db,
                "comments",
                mangaId,
                "messages"
            ),

            {

                uid:
                    auth.currentUser.uid,

                name:
                    user.name,

                avatar:
                    user.avatar,

                content:
                    text,

                createdAt:
                    serverTimestamp(),

                edited:
                    false,

                likes:
                    []

            }

        );

        input.value = "";

        input.focus();

    }

    catch(err){

        console.error(err);

        alert("Gửi bình luận thất bại.");

    }

    finally{

        sending = false;

        sendBtn.disabled = false;

        sendBtn.innerHTML = "🚀";

    }

}



// ==========================
// REALTIME COMMENT
// ==========================

const q = query(

    collection(
        db,
        "comments",
        mangaId,
        "messages"
    ),

    orderBy(
        "createdAt",
        "desc"
    )

);

onSnapshot(q,(snapshot)=>{

    list.innerHTML = "";

    const fragment =
        document.createDocumentFragment();

    snapshot.forEach(docSnap=>{

        const c =
            docSnap.data();

        const div =
            document.createElement("div");

        div.className =
            "comment";

        div.innerHTML = `

        <div class="comment-header">

            <img
                src="${c.avatar}"
                class="comment-avatar">

            <h4>

                ${c.name}

            </h4>

        </div>

        <p class="comment-content">

            ${c.content}

        </p>

        `;

        fragment.appendChild(div);

    });

    list.appendChild(fragment);

});



// ==========================
// EVENTS
// ==========================

sendBtn.addEventListener(
    "click",
    sendComment
);

input.addEventListener(
    "keydown",
    e=>{

        if(
            e.key === "Enter"
            &&
            !e.shiftKey
        ){

            e.preventDefault();

            if(!sending){

                sendComment();

            }

        }

    }
);