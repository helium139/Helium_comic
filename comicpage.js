import { db } from "./firebase.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

let mangaId;

// ================== DEVICE ==================

function getDeviceId() {
  let id = localStorage.getItem("deviceId");

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("deviceId", id);
  }

  return id;
}

function generateFunnyName() {
  const adjectives = ["Bánh Mì", "Cá Mập", "Sói", "Gấu", "Mèo", "Thỏ", "Rồng", "Hổ"];
  const nouns = ["Vô Danh", "Lang Thang", "Bí Ẩn", "Ngủ Gật", "Huyền Thoại", "Mất Não", "Ẩn Sĩ"];

  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${
    nouns[Math.floor(Math.random() * nouns.length)]
  } #${Math.floor(Math.random() * 999)}`;
}

function getDisplayName() {
  let name = localStorage.getItem("anonName");

  if (!name) {
    name = generateFunnyName();
    localStorage.setItem("anonName", name);
  }

  return name;
}

// ================== COMMENTS ==================

async function sendComment(mangaId, content) {
  try {
    await addDoc(collection(db, "comments"), {
      mangaId,
      content,
      createAt: serverTimestamp(),
      deviceId: getDeviceId(),
      displayName: getDisplayName()
    });
  } catch (err) {
    console.error("sendComment error:", err);
  }
}

async function loadComments(mangaId) {
  const container = document.getElementById("renderComments");
  if (!container) return;

  container.innerHTML = "";

  try {
    const q = query(
      collection(db, "comments"),
      where("mangaId", "==", mangaId),
      orderBy("createAt", "desc")
    );

    const snapshot = await getDocs(q);

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      const div = document.createElement("div");
      div.className = "comment";

      div.innerHTML = `
        <div class="name">${data.displayName || "Anonymous"}</div>
        <div class="content">${data.content || ""}</div>
      `;

      container.appendChild(div);
    });

  } catch (err) {
    console.error("loadComments error (CHECK FIREBASE INDEX):", err);
  }
}

// ================== MAIN PAGE ==================

async function loadComicPage() {
  try {
    const params = new URLSearchParams(window.location.search);
    mangaId = params.get("id");

    console.log("mangaId:", mangaId);

    if (!mangaId) {
      console.error("Missing mangaId in URL");
      return;
    }

    const res = await fetch("data/data.json");
    if (!res.ok) throw new Error("Cannot load data.json");

    const data = await res.json();
    const manga = data[mangaId];

    console.log("manga:", manga);

    if (!manga) {
      console.error("Manga not found in JSON:", mangaId);
      return;
    }

    // ===== STATS =====
    const statRef = doc(db, "mangaStats", mangaId);
    const statSnap = await getDoc(statRef);

    if (!statSnap.exists()) {
      await setDoc(statRef, {
        views: 0,
        likes: 0,
        follows: 0
      });
    }

    const viewedKey = `viewed-${mangaId}`;

    if (!localStorage.getItem(viewedKey)) {
      await updateDoc(statRef, {
        views: increment(1)
      });

      localStorage.setItem(viewedKey, "1");
    }

    // ===== RENDER UI =====
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value ?? "";
    };

    const setImg = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.src = value ?? "";
    };

    setText("comic-title", manga.title);
    setImg("comic-cover", manga.cover);
    setText("comic-author", manga.author);
    setText("comic-team", manga.team);
    setText("comic-status", manga.status);
    setText("comic-description", manga.description);

    // 👉 nếu có chap thì render (tránh crash nếu chưa có UI)
    const chapContainer = document.getElementById("chapters");
    if (chapContainer && manga.chapters) {
      chapContainer.innerHTML = manga.chapters
        .map((c, i) => `<div class="chap">Chap ${i + 1}: ${c}</div>`)
        .join("");
    }

    // ===== COMMENTS =====
    await loadComments(mangaId);

    const sendBtn = document.querySelector(".btn-send-comment");
    const textarea = document.querySelector("textarea");

    if (sendBtn && textarea) {
      sendBtn.addEventListener("click", async () => {
        const content = textarea.value.trim();
        if (!content) return;

        await sendComment(mangaId, content);

        textarea.value = "";
        await loadComments(mangaId);
      });
    }

  } catch (err) {
    console.error("loadComicPage fatal error:", err);
  }
}

// ================== INIT ==================

loadComicPage();
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