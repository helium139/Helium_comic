import {
    requireLogin
}
from "./authGuard.js";

requireLogin();
import { app, db }
from "./firebase.js";

import {
    getAuth,
    onAuthStateChanged
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
    collection,
    getDocs
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";


const auth = getAuth(app);

onAuthStateChanged(auth, user => {

    if(!user) return;

    document.getElementById(
        "user-avatar"
    ).src = user.photoURL;

    document.getElementById(
        "user-name"
    ).textContent = user.displayName;

    document.getElementById(
        "user-email"
    ).textContent = user.email;

});


async function loadHistory(user){

    const historyRef =
        collection(
            db,
            "users",
            user.uid,
            "history"
        );

    const snapshot =
        await getDocs(historyRef);

    const history =
        snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

    history.sort((a,b) => {

    const timeA =
        a.updatedAt?.seconds || 0;

    const timeB =
        b.updatedAt?.seconds || 0;

    return timeB - timeA;

});

    renderHistory(history);

}

async function renderHistory(history){

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

    history.forEach(item => {

    const manga =
        data[item.mangaId];

    if(!manga) return;

    const chapter =
        manga.chapters.find(
            c => c.id === item.chapterId
        );

    container.innerHTML += `
    
    <div class="comic-item">

        <div class="comic-poster">

            <img
                src="${manga.cover}"
                alt="${manga.title}">

        </div>

        <div class="comic-info">

            <h3>
                ${manga.title}
            </h3>

            <p>
                Đọc đến:
                ${chapter?.title || ""}
            </p>

            <a
                class="continue-btn"
                href="
                chapter.html?id=${item.mangaId}&chap=${item.chapterId}
                "
            >
                Tiếp tục đọc
            </a>

        </div>

    </div>
    
    `;
});
}


onAuthStateChanged(
    auth,
    async (user) => {

        if(!user){

            location.href = "login.html";
            return;

        }

        loadHistory(user);

    }
);

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