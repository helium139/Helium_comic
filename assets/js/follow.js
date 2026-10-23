import { rawBadge } from "./manga-card.js";
import { auth, onAuthStateChanged, getUserSnapshot } from "./firebase-session.js";
import { mangaUrl } from "./routes.js";


import { getReadingProgressMap, hasUnreadChapter, showProgressError } from "./reading-progress.js";

const container = document.getElementById("follow-list");
let currentUser = null;
let loadVersion = 0;
let catalogue;
function getCatalogue() {
    if (!catalogue) catalogue = fetch("/assets/data/data.json").then(res => {
        if (!res.ok) throw new Error("Catalogue unavailable");
        return res.json();
    }).catch(error => { catalogue = null; throw error; });
    return catalogue;
}

async function loadFollowedManga(user) {
    const version = ++loadVersion;
    container.innerHTML = "";
    try {
        const [profile, data, progressResult] = await Promise.all([
            getUserSnapshot(user.uid),
            getCatalogue(),
            getReadingProgressMap(user.uid).then(value => ({ value }), error => ({ error }))
        ]);
        if (version !== loadVersion || currentUser !== user) return;
        (profile.data()?.follows || []).forEach(id => {
            const manga = data[id];
            if (!manga) return;
            const unread = progressResult.value && hasUnreadChapter(manga, progressResult.value.get(id));
            container.insertAdjacentHTML("beforeend", `
                <a href="${mangaUrl(id)}" class="comic-item">
                    <div class="comic-poster">${rawBadge(manga)}
                        ${unread ? '<span class="new-chapter-badge">UP</span>' : ""}
                        <img src="${manga.cover}" alt="${manga.title}">
                    </div>
                    <div class="comic-info"><h3>${manga.title}</h3></div>
                </a>
            `);
        });
        if (progressResult.error) showProgressError(container, "Không thể tải tiến độ đọc. Vui lòng tải lại trang.");
    } catch (error) {
        if (version === loadVersion && currentUser === user) {
            showProgressError(container, "Không thể tải truyện theo dõi. Vui lòng tải lại trang.");
        }
    }
}

onAuthStateChanged(auth, user => {
    currentUser = user;
    if (!user) {
        ++loadVersion;
        container.innerHTML = "";
        location.href = "/login/";
        return;
    }
    return loadFollowedManga(user);
});
window.addEventListener("pageshow", event => {
    if (event.persisted && currentUser) {
        catalogue = null;
        loadFollowedManga(currentUser);
    }
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