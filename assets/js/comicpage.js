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


onAuthStateChanged(
    auth,
    (user) => {

        currentUser = user;

        console.log(currentUser);

        if(user){

        console.log(
            "Đã đăng nhập:",
            user.uid
        );

        await setupLikeButton();
        await setupFollowButton();

    }

    }
);
await updateDoc(
    statRef,
    {
        views: increment(1)
    }
);

document.getElementById("view-count")
.textContent =
`👁️ ${views}`;


const params =
    new URLSearchParams(
        window.location.search
    );

const mangaId =
    params.get("id");


    fetch("assets/data/data.json")
.then(res => res.json())
.then(data => {

    const manga =
        data[mangaId];

    document.getElementById(
        "comic-title"
    ).textContent =
        manga.title;

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
                ${chap.date}
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