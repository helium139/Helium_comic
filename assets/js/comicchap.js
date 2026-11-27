import { recordChapterPopularity } from "./chapter-popularity.js";
import { startChapterViews } from "./chapter-views.js";
import { markChapterRead, showProgressError } from "./reading-progress.js";
import { auth, onAuthStateChanged } from "./firebase-session.js";
import { mangaUrl, chapterUrl, getRouteParams } from "./routes.js";
import { createChapterImageQueue, getChapterImageUrls, revealReadyPages } from "./chapter-image-queue.mjs";
const params = getRouteParams();

const mangaId = params.get("id");
const chapterId = params.get("chap");


// Resolve only after valid metadata and the first page image have loaded.
let loadedChapter = null;
let readingUser = null;
const savedForUsers = new Set();
async function saveProgress() {
    const user = readingUser;
    if (!user || !loadedChapter || savedForUsers.has(user.uid)) return;
    savedForUsers.add(user.uid);
    try {
        await markChapterRead(user.uid, mangaId, loadedChapter.manga, chapterId);
    } catch (error) {
        savedForUsers.delete(user.uid);
        if (readingUser === user) showProgressError(
            document.getElementById("chapter-content"),
            "Không thể lưu tiến độ đọc. Vui lòng tải lại trang để thử lại."
        );
    }
}
onAuthStateChanged(auth, user => {
    readingUser = user;
    return saveProgress();
});

// Do not initialize chapter images/progress/views behind the age confirmation.
Promise.resolve(globalThis.heliumAgeGateReady)
.then(() => fetch("/assets/data/data.json"))
.then(res => res.json())
.then(data => {

    
    const manga = data[mangaId];
    if (!manga) throw new Error("Manga not found");

document.querySelector(

'link[rel="canonical"]'

).href = location.href;


    const chapter = manga.chapters.find(
        c => String(c.id) === chapterId
    );

    if (!chapter || !chapter.pages || !chapter.folder) throw new Error("Chapter unavailable");

    const schema={

"@context":"https://schema.org",

"@type":"Article",

"headline":`${manga.title} ${chapter.title}`,

"author":{

"@type":"Organization",

"name":"HeliumTG"

},

"image":location.origin+"/"+manga.cover,

"url":location.href,

"isPartOf":{

"@type":"Book",

"name":manga.title

}

};

    // ===== TITLE =====

    document.getElementById(
        "chapter-title"
    ).innerHTML = `
        ${manga.title}
        - ${chapter.title}

        <span class="update-time">
            (${chapter.createAt.split("T")[0]})
        </span>
    `;

    document.getElementById("page-title").innerText = `${manga.title} - ${chapter.title} | Helium Team - Kho Truyện BL Nhà Helium`;

    // ===== BREADCRUMB =====

    document.getElementById(
        "breadcrumb"
    ).innerHTML = `
        <a href="/">
            Trang Chủ
        </a>

        &gt;

        <a href="${mangaUrl(mangaId)}">
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

    const pageCount = Number(chapter.pages);
    if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("Invalid chapter page count");
    const pageSlots = [];
    const loadedImages = Array(pageCount).fill(null);
    const pageStates = Array(pageCount).fill("idle");
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < pageCount; index++) {
        const slot = document.createElement("div");
        slot.className = "chapter-page";
        slot.dataset.page = String(index + 1);
        slot.setAttribute("aria-hidden", "true");
        pageSlots.push(slot);
        fragment.append(slot);
    }
    reader.replaceChildren(fragment);

    const imageUrls = getChapterImageUrls(chapter);
    let firstUnrevealed = 0;
    let chapterOpened = false;
    const renderFailedPage = pageIndex => {
        const message = document.createElement("p");
        message.className = "chapter-page-error";
        message.setAttribute("role", "status");
        message.textContent = `Không tải được trang ${pageIndex + 1}.`;
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "chapter-page-retry";
        retry.textContent = "Thử tải lại";
        retry.addEventListener("click", () => queue.retry(pageIndex), { once: true });
        pageSlots[pageIndex].replaceChildren(message, retry);
    };
    const queue = createChapterImageQueue(imageUrls, {
        onState(index, status, image, attempt) {
            const slot = pageSlots[index];
            pageStates[index] = status === "retrying" ? "loading" : status;
            slot.dataset.state = status;

            if (status === "loading" && image) {
                image.alt = `Trang ${index + 1}`;
                image.decoding = "async";
                image.className = "chapter-page-image";
                if (!slot.classList.contains("is-revealed") && index === firstUnrevealed &&
                    !slot.childElementCount) {
                    const loading = document.createElement("p");
                    loading.className = "chapter-page-loading";
                    loading.setAttribute("role", "status");
                    loading.textContent = `Đang tải trang ${index + 1}…`;
                    slot.replaceChildren(loading);
                }
            } else if (status === "retrying") {
                slot.dataset.attempt = String(attempt);
            } else if (status === "loaded") {
                loadedImages[index] = image;
                if (slot.classList.contains("is-revealed")) slot.replaceChildren(image);
            } else if (status === "failed" && slot.classList.contains("is-revealed")) {
                renderFailedPage(index);
            }

            firstUnrevealed = revealReadyPages(pageStates, firstUnrevealed, pageIndex => {
                const revealed = pageSlots[pageIndex];
                if (pageStates[pageIndex] === "loaded") {
                    revealed.replaceChildren(loadedImages[pageIndex]);
                } else {
                    renderFailedPage(pageIndex);
                }
                revealed.classList.add("is-revealed");
                revealed.setAttribute("aria-hidden", "false");
            });

            if (index === 0 && status === "loaded" && !chapterOpened) {
                chapterOpened = true;
                loadedChapter = { manga };
                saveProgress();
                const firstImage = loadedImages[0];
                startChapterViews({ mangaId, chapterId, manga, chapter, firstImage });
                recordChapterPopularity({ mangaId, chapterId, firstImage });
            }
        }
    });

    let observer;
    let scrollFrame = 0;
    const prioritizeViewport = () => {
        scrollFrame = 0;
        const viewportHeight = window.innerHeight;
        let nearestIndex = -1;
        let nearestDistance = Infinity;
        for (let index = 0; index < pageSlots.length; index++) {
            const rect = pageSlots[index].getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > viewportHeight) continue;
            const distance = Math.abs(rect.top);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = index;
            }
        }
        if (nearestIndex !== -1) queue.setPriorityIndex(nearestIndex);
    };
    const onScroll = () => {
        if (!scrollFrame) scrollFrame = window.requestAnimationFrame(prioritizeViewport);
    };
    if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver(entries => {
            let nearestIndex = -1;
            let nearestDistance = Infinity;
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const index = Number(entry.target.dataset.page) - 1;
                const distance = Math.abs(entry.boundingClientRect.top);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            }
            if (nearestIndex !== -1) queue.setPriorityIndex(nearestIndex);
        }, { rootMargin: "100% 0px" });
        pageSlots.forEach(slot => observer.observe(slot));
    } else {
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll, { passive: true });
        prioritizeViewport();
    }
    const cleanupImageLoading = event => {
        if (event.persisted) return;
        observer?.disconnect();
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
        queue.destroy();
    };
    window.addEventListener("pagehide", cleanupImageLoading);
    queue.start();

    // ===== CHAP TRƯỚC / SAU =====

    const currentIndex =
        manga.chapters.findIndex(
            c => String(c.id) === chapterId
        );

    if(currentIndex > 0){

        const prev =
            manga.chapters[
                currentIndex - 1
            ];

        document.getElementById(
            "prev-btn"
        ).href =
        chapterUrl(mangaId, prev.id);
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
        chapterUrl(mangaId, next.id);
    }
    if(currentIndex > 0){

        const prev =
            manga.chapters[
                currentIndex - 1
            ];

        document.getElementById(
            "toolbar-prev"
        ).href =
        chapterUrl(mangaId, prev.id);
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
        chapterUrl(mangaId, next.id);
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
        chapterUrl(mangaId, this.value);

    }
);
}).catch(() => {
    showProgressError(document.getElementById("chapter-content"), "Không thể tải chương truyện. Vui lòng tải lại trang.");
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
        lightBtn.innerHTML = '<i class="bx bx-bulb"></i> <span class="toolbar-label">Bật đèn</span>';
    } else {
        overlay.classList.remove("active");
        lightBtn.innerHTML = '<i class="bx bx-bulb"></i> <span class="toolbar-label">Tắt đèn</span>';
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
