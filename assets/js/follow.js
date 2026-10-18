import { auth, onAuthStateChanged, getUserSnapshot } from "./firebase-session.js";
import { mangaUrl } from "./routes.js";


onAuthStateChanged(
    auth,
    async(user)=>{

        if(!user){

            location.href =
                "/login/";

            return;
        }


        const userSnap =
            await getUserSnapshot(user.uid);

        const userData =
            userSnap.data();

        loadFollowedManga(
            userData.follows || []
        );

    }
);

async function loadFollowedManga(
    follows
){

    const res =
        await fetch(
            "/assets/data/data.json"
        );

    const data =
        await res.json();

    const container =
        document.getElementById(
            "follow-list"
        );

    container.innerHTML = "";

    follows.forEach(id => {

        const manga =
            data[id];

        if(!manga) return;

        container.innerHTML += `
        
        <a
            href="${mangaUrl(id)}"
            class="comic-item">

            <div class="comic-poster">

                <img
                    src="${manga.cover}"
                    alt="${manga.title}">

            </div>

            <div class="comic-info">

                <h3>
                    ${manga.title}
                </h3>

            </div>

        </a>
        
        `;

    });

}

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