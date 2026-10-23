import { renderAdminPicks } from "./admin-picks.js";
import { renderRanking, installRankingFallback } from "./home-ranking.js";
import { renderMangaCard, rawBadge } from "./manga-card.js";
import { mangaUrl } from "./routes.js";
import { loadPopularity } from "./popularity.js";

let mangas = [];
let mangaData = {};

let currentPage = 1;
const perPage =
window.innerWidth <= 768
? 9
: 12;

function renderComics() {

    const container =
        document.getElementById("comic-list");

    container.innerHTML = "";


    const showMangas =
        mangas.slice(
            0,
            currentPage * perPage
        );


    showMangas.forEach(([slug, manga]) => {

        container.innerHTML += renderMangaCard(slug, manga);
    });


    checkViewMore();
}

async function loadHotComics(data) {
    const container = document.getElementById("hot-comic-list");
    if (!container) return;
    installRankingFallback(container);
    try {
        // Read existing public popularity once; filter stale IDs before taking ten.
        renderRanking(container, await loadPopularity(), data);
    } catch {
        container.innerHTML = '<p class="ranking-message" role="status">Chưa thể tải bảng xếp hạng. Vui lòng thử lại sau.</p>';
    }
}

function checkViewMore(){

    const button =
        document.querySelector(
            ".view-more-button"
        );


    if(
        currentPage * perPage
        >= mangas.length
    ){

        button.style.display = "none";

    }

    else{

        button.style.display = "block";

    }

}

fetch("/assets/data/data.json")
  .then(res => res.json())
  .then(data => {

    mangaData = data;

    renderAdminPicks(data);

    mangas = Object.entries(data);

    mangas.sort(([,a],[,b]) => {

        const aLast =
            a.chapters[a.chapters.length - 1];

        const bLast =
            b.chapters[b.chapters.length - 1];


        return new Date(bLast.createAt)
            - new Date(aLast.createAt);

    });

    console.table(

mangas.map(([slug,manga])=>({

    slug,

    title:manga.title,

    latest:manga.chapters.at(-1)?.title,

    time:manga.chapters.at(-1)?.createAt

}))

);


    renderComics();
    loadHotComics(data);
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


// ================= XỬ LÝ NÚT XEM THÊM ================= //
document
.getElementById("viewMoreLastest")
.addEventListener(
    "click",
    () => {

        document
.getElementById("viewMoreLastest")
.onclick=()=>{

    currentPage++;

    renderComics();

    document
    .querySelector("#comic-list")
    .scrollIntoView({

        behavior:"smooth",

        block:"end"

    });

};

    }
);
// ================= xử lý sort tim kiem ================= //
function handleSearch(){

    const keyword =
        document
        .getElementById("search-input")
        .value
        .toLowerCase()
        .trim();


    const resultBox =
        document.getElementById(
            "search-result"
        );


    // Không nhập gì thì ẩn
    if(keyword === ""){

        resultBox.style.display = "none";
        resultBox.innerHTML = "";

        return;
    }


    const results =
        mangas.filter(([slug, manga]) => {


            const text = [
                manga.title,
                manga.original_title,
                manga.author,
                ...(manga.tags || [])
            ]
            .join(" ")
            .toLowerCase();


            return text.includes(keyword);

        });


    resultBox.innerHTML = "";


    // Không tìm thấy
    if(results.length === 0){

        resultBox.innerHTML =
        `
        <div class="search-item">
            Không tìm thấy truyện
        </div>
        `;

        resultBox.style.display = "block";

        return;
    }


    results.forEach(([slug, manga]) => {


        const latest =
            manga.chapters[
                manga.chapters.length - 1
            ];


        resultBox.innerHTML +=
        `
        <a 
        href="${mangaUrl(slug)}"
        class="search-item">

            <div class="search-cover">${rawBadge(manga)}<img
            src="${manga.cover}"
            alt="${manga.title}"></div>

            <div class="search-info">

                <h4>
                    ${manga.title}
                </h4>

                <p>
                    ${latest.title}
                </p>

            </div>

        </a>
        `;

    });


    resultBox.style.display = "block";

}

document
.getElementById("search-input")
.addEventListener("input", handleSearch);

document
.getElementById("search-button")
.addEventListener("click", handleSearch);

document.addEventListener("click", function(e){

    const search =
        document.querySelector(".search_bar_form");

    const result =
        document.getElementById("search-result");


    if(!search.contains(e.target)){

        result.style.display = "none";

    }

});

// ================= XỬ LÝ RENDER ADMIN PICKS ================= //
function isNewChapter(manga) {

    if (
        !manga.chapters ||
        manga.chapters.length === 0
    ) {
        return false;
    }

    const latestChapter =
        manga.chapters[manga.chapters.length - 1];

    if (!latestChapter.createAt) {
        return false;
    }

    const chapterTime =
        new Date(latestChapter.createAt).getTime();

    const now =
        Date.now();

    const fourtyEightHours =
        24 * 60 * 60 * 1000 * 2; // 2 days in milliseconds

    return (
        now - chapterTime >= 0 &&
        now - chapterTime <= fourtyEightHours
    );
}