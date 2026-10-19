import { requireStaff } from "../assets/js/adminGuard.js";
import { scopeMangas, assertCanManageManga, showStaffAccessError } from "../assets/js/staff-access.js";

const currentStaff = await requireStaff();

try {
    const response = await fetch("/assets/data/data.json");
    if (!response.ok) throw new Error("Không thể tải danh sách truyện.");
    const mangas = scopeMangas(currentStaff, await response.json());
    const list = document.getElementById("manga-list");
    list.replaceChildren();
    for (const [slug, manga] of Object.entries(mangas)) {
        assertCanManageManga(currentStaff, manga);
        const row = document.createElement("a");
        row.className = "manga-item manga-row";
        row.href = `/admin/manga/?manga=${encodeURIComponent(slug)}`;
        const cover = document.createElement("img");
        cover.className = "manga-cover";
        cover.src = manga.cover;
        cover.alt = "";
        const title = document.createElement("span");
        title.textContent = manga.title;
        row.append(cover, title);
        list.appendChild(row);
    }
    if (!Object.keys(mangas).length) list.textContent = "Chưa có truyện trong nhóm của bạn.";
} catch (error) {
    showStaffAccessError(error);
}
