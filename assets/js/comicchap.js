import {
    doc,
    setDoc,
    serverTimestamp
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import { app, db }
from "./firebase.js";

import {
    getAuth
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const auth = getAuth(app);


const params = new URLSearchParams(
    window.location.search
);

const mangaId = params.get("id");
const chapterId = parseInt(
    params.get("chap")
);

async function saveHistory() {

    if(!auth.currentUser) return;

    const historyRef =
        doc(
            db,
            "users",
            auth.currentUser.uid,
            "history",
            mangaId
        );

    await setDoc(
        historyRef,
        {
            mangaId: mangaId,
            chapterId: chapterId,
            updatedAt: serverTimestamp()
        }
    );

}

onAuthStateChanged(auth, (user) => {

    if(user){

        saveHistory();

    }

});

fetch("assets/data/data.json")
.then(res => res.json())
.then(data => {

    
    const manga = data[mangaId];


    const chapter = manga.chapters.find(
        c => c.id === chapterId
    );

    // ===== TITLE =====

    document.getElementById(
        "chapter-title"
    ).innerHTML = `
        ${manga.title}
        - ${chapter.title}

        <span class="update-time">
            (${chapter.date})
        </span>
    `;

    // ===== BREADCRUMB =====

    document.getElementById(
        "breadcrumb"
    ).innerHTML = `
        <a href="index.html">
            Trang Chủ
        </a>

        &gt;

        <a href="manga.html?id=${mangaId}">
            ${manga.title}
        </a>

        &gt;

        ${chapter.title}
    `;

    // ===== LOAD IMAGES =====

    const reader =
        document.getElementById(
            "chapter-content"
        );

    for(
    let i = 1;
    i <= chapter.pages;
    i++
){

    const imageUrl =
        `${chapter.folder}/${i}.jpg`;

    reader.innerHTML += `
        <img
            src="${imageUrl}"
            loading="lazy"
            alt="page ${i}"
        >
    `;
}


    // ===== CHAP TRƯỚC / SAU =====

    const currentIndex =
        manga.chapters.findIndex(
            c => c.id === chapterId
        );

    if(currentIndex > 0){

        const prev =
            manga.chapters[
                currentIndex - 1
            ];

        document.getElementById(
            "prev-btn"
        ).href =
        `chapter.html?id=${mangaId}&chap=${prev.id}`;
    }

    if(
        currentIndex <
        manga.chapters.length - 1
    ){

        const next =
            manga.chapters[
                currentIndex + 1
            ];

        document.getElementById(
            "next-btn"
        ).href =
        `chapter.html?id=${mangaId}&chap=${next.id}`;
    }
    if(currentIndex > 0){

        const prev =
            manga.chapters[
                currentIndex - 1
            ];

        document.getElementById(
            "toolbar-prev"
        ).href =
        `chapter.html?id=${mangaId}&chap=${prev.id}`;
    }

    if(
        currentIndex <
        manga.chapters.length - 1
    ){

        const next =
            manga.chapters[
                currentIndex + 1
            ];

        document.getElementById(
            "toolbar-next"
        ).href =
        `chapter.html?id=${mangaId}&chap=${next.id}`;
    }

    const select =
document.getElementById("chapSelect");

manga.chapters.forEach(chap => {

    select.innerHTML += `
        <option value="${chap.id}">
            ${chap.title}
        </option>
    `;

});
    select.value = chapterId;

    select.addEventListener(
    "change",
    function(){

        window.location.href =
        `chapter.html?id=${mangaId}&chap=${this.value}`;

    }
);
});

const scrollBtn =
    document.getElementById("scrollTopBtn");

window.addEventListener("scroll", () => {

    if (window.scrollY > 500) {
        scrollBtn.style.display = "flex";
    } else {
        scrollBtn.style.display = "none";
    }

});

scrollBtn.addEventListener("click", () => {

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

});

const lightBtn =
    document.getElementById("lightBtn");

const overlay =
    document.getElementById("darkOverlay");

let lightOff = localStorage.getItem("lightOffState") === "true";

// Hàm xử lý giao diện dựa trên trạng thái của biến lightOff
function applyLightSettings() {
    if (lightOff) {
        overlay.classList.add("active");
        lightBtn.innerHTML = '<i class="bx bx-bulb"></i> Bật đèn';
    } else {
        overlay.classList.remove("active");
        lightBtn.innerHTML = '<i class="bx bx-bulb"></i> Tắt đèn';
    }
}

// 2. Chạy hàm này ngay khi vừa tải trang để áp dụng cấu hình cũ của người dùng
applyLightSettings();

// 3. XỬ LÝ SỰ KIỆN CLICK NÚT ĐÈN
lightBtn.addEventListener("click", () => {
    // Đảo trạng thái true <-> false
    lightOff = !lightOff;

    // LƯU TRẠNG THÁI MỚI VÀO TRÌNH DUYỆT (Chuyển boolean thành chuỗi để lưu)
    localStorage.setItem("lightOffState", lightOff);

    // Cập nhật lại giao diện ngay lập tức
    applyLightSettings();
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