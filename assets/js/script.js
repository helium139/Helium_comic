fetch("data/data.json")
  .then(res => res.json())
  .then(data => {

    

    const container =
        document.getElementById("comic-list");


        const mangas = Object.entries(data);

    // Chuyển DD/MM/YYYY -> timestamp
    const parseDate = (dateStr) => {
      const [day, month, year] = dateStr.split("/");
      return new Date(year, month - 1, day).getTime();
    };

    // Sắp xếp theo ngày chap mới nhất
    mangas.sort(([, a], [, b]) => {
      const aLast = a.chapters[a.chapters.length - 1];
      const bLast = b.chapters[b.chapters.length - 1];

      return parseDate(bLast.date) - parseDate(aLast.date);
    });


    container.innerHTML = "";

    mangas.forEach(([slug, manga]) => {
      const latestChap = manga.chapters[manga.chapters.length - 1];

      container.innerHTML += `
        <a href="comicpage.html?id=${slug}" class="comic-item">
          <div class="comic-poster">
            <img src="${manga.cover}" alt="${manga.title}">
          </div>

          <div class="comic-info">
            <h3 class="comic-name">${manga.title}</h3>
            <span class="comic-chapter">${latestChap.title}</span>
          </div>
        </a>
      `;
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