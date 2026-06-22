let mangas = [];

let currentPage = 1;
const perPage = 10;

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

        const latestChap =
            manga.chapters[
                manga.chapters.length - 1
            ];


        container.innerHTML += `
        <a href="manga.html?id=${slug}" class="comic-item">

            <div class="comic-poster">
                <img
                    src="${manga.cover}"
                    alt="${manga.title}"
                    loading="lazy">

            </div>


            <div class="comic-info">

                <h3 class="comic-name">
                    ${manga.title}
                </h3>


                <span class="comic-chapter">
                    ${latestChap.title}
                </span>


            </div>

        </a>
        `;
    });


    checkViewMore();
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

fetch("assets/data/data.json")
  .then(res => res.json())
  .then(data => {

    mangas = Object.entries(data);


    mangas.sort(([,a],[,b]) => {

        const aLast =
            a.chapters[a.chapters.length - 1];

        const bLast =
            b.chapters[b.chapters.length - 1];


        return new Date(bLast.createAt)
            - new Date(aLast.createAt);

    });


    renderComics();
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
.querySelector(".view-more-button")
.addEventListener(
    "click",
    () => {

        currentPage++;

        renderComics();

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
        href="manga.html?id=${slug}" 
        class="search-item">

            <img 
            src="${manga.cover}" 
            alt="${manga.title}">

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

document.addEventListener("click", function(e){

    const search =
        document.querySelector(".search_bar_form");

    const result =
        document.getElementById("search-result");


    if(!search.contains(e.target)){

        result.style.display = "none";

    }

});