import { app, db }
from "./firebase.js";
import{

collection,

addDoc,

doc,

getDoc,

getDocs,

query,

orderBy,

serverTimestamp

}

from

"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";


import{

getAuth

}


from

"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const auth =
getAuth(app);
const params =
new URLSearchParams(
window.location.search
);


const mangaId =
params.get("id");


async function sendComment(){

    if(!auth.currentUser){

        alert(
            "Bạn cần đăng nhập."
        );

        return;

    }

    const text =
    document
    .getElementById(
        "comment-input"
    )
    .value
    .trim();

    if(text==="") return;

    const userSnap =
    await getDoc(
        doc(
            db,
            "users",
            auth.currentUser.uid
        )
    );

const userData =
    userSnap.data();

    console.log(userData);
    console.log(userData.avatar);

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
        userData.name,

        avatar:
        userData.avatar,

        content:
        text,

        createdAt:
        serverTimestamp(),

        edited:false,

        likes:[]

    }

);

    document
    .getElementById(
        "comment-input"
    ).value="";

    loadComments();

}

document
.getElementById(
"send-comment"
)
.onclick=
sendComment;

async function loadComments(){

const q=
query(

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

const snapshot=
await getDocs(q);

const list=
document.getElementById(
"comments-list"
);

list.innerHTML="";

snapshot.forEach(docSnap=>{

const c=
docSnap.data();

console.log(c);

list.innerHTML+=`

<div class="comment">

<img
src="${c.avatar}"
class="comment-avatar">

<div>

<h4>

${c.name}

</h4>

<p>

${c.content}

</p>

</div>

</div>

`;

});

}

loadComments();