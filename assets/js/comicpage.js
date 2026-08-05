import { app, db } from "./firebase.js";

import {
    getAuth,
    onAuthStateChanged
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    increment,
    arrayUnion,
    arrayRemove
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const auth = getAuth(app);

let currentUser = null;

let likeBusy = false;
let followBusy = false;

let liked = false;
let followed = false;


onAuthStateChanged(
    auth,
    async (user) => {

        currentUser = user;

        if(user){

            await setupLikeButton();
            await setupFollowButton();

        }

    }
);


const params =
    new URLSearchParams(
        window.location.search
    );

const mangaId =
    params.get("id");

    async function updateView() {

    const viewKey =
        `viewed-${mangaId}`;


    // Đã xem rồi thì không tăng
    if(localStorage.getItem(viewKey)) {

        return;
    }


    const statRef =
        doc(
            db,
            "mangaStats",
            mangaId
        );


    const statSnap =
        await getDoc(statRef);


    // Nếu chưa có dữ liệu
    if(!statSnap.exists()) {

        await setDoc(
            statRef,
            {
                views: 1,
                likes: 0,
                follows: 0
            }
        );

    }
    else {

        await updateDoc(
            statRef,
            {
                views: increment(1)
            }
        );

    }


    // Đánh dấu đã xem
    localStorage.setItem(
        viewKey,
        "1"
    );

}

async function loadStats() {

    const statRef =
        doc(
            db,
            "mangaStats",
            mangaId
        );

    const statSnap =
        await getDoc(statRef);

    if(!statSnap.exists()) return;

    const stats =
        statSnap.data();

    document.getElementById(
        "view-count"
    ).textContent =
        `👁️ ${stats.views || 0}`;

    document.getElementById(
        "like-count"
    ).textContent =
        `❤️ ${stats.likes || 0}`;

    document.getElementById(
        "follow-count"
    ).textContent =
        `💖 ${stats.follows || 0}`;

}

async function setupLikeButton(){

    const likeBtn = document.getElementById("likeBtn");

    if(!likeBtn) return;

    if(!currentUser){

        likeBtn.onclick = () => {

            alert("Vui lòng đăng nhập");

        };

        return;
    }

    const userRef = doc(db,"users",currentUser.uid);

    const snap = await getDoc(userRef);

    const userData = snap.data();

    liked = userData.likes?.includes(mangaId);

    updateLikeButton();

    likeBtn.onclick = toggleLike;

}

function updateLikeButton(){

    const likeBtn =
        document.getElementById("likeBtn");

    likeBtn.textContent =
        liked
        ? "🤍 Bỏ thích"
        : "💜 Thích";

}

async function toggleLike(){

    if(likeBusy) return;

    likeBusy = true;

    const likeBtn =
        document.getElementById("likeBtn");

    likeBtn.disabled = true;

    try{

        const userRef =
            doc(db,"users",currentUser.uid);

        const statRef =
            doc(db,"mangaStats",mangaId);

        if(liked){

            await Promise.all([

                updateDoc(statRef,{
                    likes:increment(-1)
                }),

                updateDoc(userRef,{
                    likes:arrayRemove(mangaId)
                })

            ]);

            liked = false;

        }else{

            await Promise.all([

                updateDoc(statRef,{
                    likes:increment(1)
                }),

                updateDoc(userRef,{
                    likes:arrayUnion(mangaId)
                })

            ]);

            liked = true;

        }

        updateLikeButton();

        loadStats();

    }

    finally{

        likeBusy = false;

        likeBtn.disabled = false;

    }

}

async function setupFollowButton(){

    const btn =
        document.getElementById("followBtn");

    if(!btn) return;

    if(!currentUser){

        btn.onclick = ()=>{

            alert("Vui lòng đăng nhập");

        };

        return;

    }

    const snap = await getDoc(

        doc(db,"users",currentUser.uid)

    );

    followed =
        snap.data().follows?.includes(mangaId);

    updateFollowButton();

    btn.onclick = toggleFollow;

}

function updateFollowButton(){

    const btn =
        document.getElementById("followBtn");

    btn.textContent =
        followed
        ? "💔 Bỏ theo dõi"
        : "💖 Theo dõi";

}

async function toggleFollow(){

    if(followBusy) return;

    followBusy = true;

    const btn =
        document.getElementById("followBtn");

    btn.disabled = true;

    try{

        const userRef =
            doc(db,"users",currentUser.uid);

        const statRef =
            doc(db,"mangaStats",mangaId);

        if(followed){

            await Promise.all([

                updateDoc(statRef,{
                    follows:increment(-1)
                }),

                updateDoc(userRef,{
                    follows:arrayRemove(mangaId)
                })

            ]);

            followed = false;

        }else{

            await Promise.all([

                updateDoc(statRef,{
                    follows:increment(1)
                }),

                updateDoc(userRef,{
                    follows:arrayUnion(mangaId)
                })

            ]);

            followed = true;

        }

        updateFollowButton();

        loadStats();

    }

    finally{

        followBusy = false;

        btn.disabled = false;

    }

}

    fetch("assets/data/data.json")
.then(res => res.json())
.then(data => {

    updateView();
    loadStats();

    const manga =
        data[mangaId];

    function setMeta(name, content){

    let meta = document.querySelector(
        `meta[name="${name}"]`
    );

    if(!meta){

        meta = document.createElement("meta");

        meta.setAttribute("name", name);

        document.head.appendChild(meta);

    }

    meta.content = content;

}

setMeta(

"description",

`Đọc ${manga.title} bản dịch tiếng Việt tại HeliumTG. ${manga.description}`

);

setMeta(

"title",

`${manga.title} | Đọc Manhwa BL Tiếng Việt - HeliumTG`

);

function setProperty(property,content){

    let meta=document.querySelector(

        `meta[property="${property}"]`

    );

    if(!meta){

        meta=document.createElement("meta");

        meta.setAttribute(

            "property",

            property

        );

        document.head.appendChild(meta);

    }

    meta.content=content;

}

setProperty(

"og:title",

manga.title

);

setProperty(

"og:description",

manga.description

);

setProperty(

"og:image",

location.origin + "/" + manga.cover

);

setProperty(

"og:type",

"book"

);

setProperty(

"og:url",

location.href

);

const schema = {

"@context":"https://schema.org",

"@type":"Book",

"name":manga.title,

"author":{

    "@type":"Person",

    "name":manga.author

},

"description":manga.description,

"image":location.origin+"/"+manga.cover,

"url":location.href,

"inLanguage":"vi",

"genre":manga.tags,

"publisher":{

    "@type":"Organization",

    "name":"HeliumTG"

}

};

const script=document.createElement("script");

script.type="application/ld+json";

script.text=JSON.stringify(schema);

document.head.appendChild(script);

document.querySelector(

'link[rel="canonical"]'

).href = location.href;

    const firstChapter = manga.chapters[0];

document
.getElementById("read-first-btn")
.onclick = () => {

    location.href =
    `chapter.html?id=${mangaId}&chap=${firstChapter.id}`;

};

    document.getElementById(
        "comic-title"
    ).textContent =
        manga.title;

    document.getElementById("comic-original-title").textContent =
        manga.original_title;

    document.getElementById(
        "comic-cover"
    ).src =
        manga.cover;

    document.getElementById(
        "comic-author"
    ).textContent =
        manga.author;

    document.getElementById(
        "comic-team"
    ).textContent =
        manga.team;

    document.getElementById(
        "comic-status"
    ).textContent =
        manga.status;

    document.getElementById(
        "comic-description"
    ).textContent =
        manga.description;

    
const tagsContainer =
    document.getElementById(
        "comic-tags"
    );

    manga.tags.forEach(tag => {

    tagsContainer.innerHTML += `
        <span class="tag">
            ${tag}
        </span>
    `;

});

const chapterContainer =
    document.getElementById(
        "chapters-list"
    );

    manga.chapters.forEach(chap => {

    chapterContainer.innerHTML += `
        <div class="chapter-item">

            <a href="
                chapter.html?id=${mangaId}&chap=${chap.id}">
                ${chap.title}
            </a>

            <span class="chapter-date">
                ${chap.createAt.split("T")[0]}
            </span>

        </div>
    `;
    console.log(
    `chapter.html?id=${mangaId}&chap=${chap.id}`
);

});


});


const menuToggleBtn = document.getElementById("menuToggleBtn");
const menuCloseBtn = document.getElementById("menuCloseBtn");
const sideMenu = document.getElementById("sideMenu");
const menuOverlay = document.getElementById("menuOverlay");

const themeLightBtn = document.getElementById("themeLightBtn");
const themeDarkBtn = document.getElementById("themeDarkBtn");

// ================= SYNC ĐÓNG / MỞ MENU =================
menuToggleBtn.addEventListener("click", () => {
  sideMenu.classList.add("open");
  menuOverlay.classList.add("show");
});

function closeMenu() {
  sideMenu.classList.remove("open");
  menuOverlay.classList.remove("show");
}

menuCloseBtn.addEventListener("click", closeMenu);
menuOverlay.addEventListener("click", closeMenu);


// ================= XỬ LÝ ĐỔI THEME VÀ LƯU LOCALSTORAGE =================

// 1. Hàm áp dụng theme lên thẻ <html> hoặc <body>
function setTheme(themeName) {
  if (themeName === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    themeDarkBtn.classList.add("active");
    themeLightBtn.classList.remove("active");
  } else {
    document.documentElement.removeAttribute("data-theme");
    themeLightBtn.classList.add("active");
    themeDarkBtn.classList.remove("active");
  }
  // Lưu lại lựa chọn vào máy người dùng
  localStorage.setItem("userWebTheme", themeName);
}

// 2. Khi vừa tải trang: Kiểm tra xem trước đó người dùng chọn gì chưa
const savedTheme = localStorage.getItem("userWebTheme") || "light";
setTheme(savedTheme);

// 3. Lắng nghe sự kiện click nút đổi theme
themeLightBtn.addEventListener("click", () => setTheme("light"));
themeDarkBtn.addEventListener("click", () => setTheme("dark"));