import { paginateMangas, renderPagination } from "./pagination.mjs";
import { createDashboardAnalytics } from "./view-analytics.js";
import { requireStaff } from "../assets/js/adminGuard.js";
import { scopeMangas, assertCanManageManga, showStaffAccessError } from "../assets/js/staff-access.js";
import { getTeams } from "../assets/js/teams.js";
import { getDashboardScope, buildDashboardModel } from "./dashboard-data.mjs";

const currentStaff = await requireStaff();
const dashboard = document.getElementById("dashboard");
dashboard.setAttribute("aria-busy", "true");

try {
    const [teams, catalogue] = await Promise.all([
        getTeams(),
        fetch("/assets/data/data.json").then(response => {
            if (!response.ok) throw new Error("Không thể tải danh sách truyện.");
            return response.json();
        })
    ]);
    const accessibleMangas = scopeMangas(currentStaff, catalogue);
    const analytics = createDashboardAnalytics({ staff: currentStaff, teams, catalogue });
    const filter = document.getElementById("dashboard-team");
    const isAdmin = currentStaff.role === "admin";
    let mangaPage = 1;
    let scope = getDashboardScope(currentStaff, "all", teams);
    document.getElementById("dashboard-title").textContent = isAdmin ? "Admin Dashboard" : "Team Dashboard";

    if (isAdmin) {
        const options = [{ id: "all", name: "All Teams" }, ...teams];
        for (const team of options) {
            const option = document.createElement("option");
            option.value = team.id;
            option.textContent = team.name + (team.active === false ? " (inactive)" : "");
            filter.appendChild(option);
        }
        filter.value = "all";
        filter.disabled = false;
        document.getElementById("team-filter-container").hidden = false;
        filter.addEventListener("change", () => {
            try {
                scope = getDashboardScope(currentStaff, filter.value, teams);
                mangaPage = 1;
                render();
            } catch (error) { showStaffAccessError(error); }
        });
    }

    function cell(text, className) {
        const element = document.createElement("td");
        element.textContent = text;
        if (className) element.className = className;
        return element;
    }

    function render(updateAnalytics = true) {
        const model = buildDashboardModel(currentStaff, accessibleMangas, teams, scope);
        if (updateAnalytics) analytics.update(model.scope);
        document.getElementById("dashboard-scope").textContent = `Team: ${model.scopeName}`;
        document.getElementById("total-manga").textContent = String(model.mangaCount);
        document.getElementById("monthly-chapters").textContent = String(model.monthlyChapters);
        document.getElementById("dashboard-month").textContent = `${model.month.key} · UTC · catalogue createAt`;
        const pagination = paginateMangas(model.mangas, mangaPage);
        mangaPage = pagination.page;
        document.getElementById("manga-results").textContent = `Showing ${pagination.first}–${pagination.last} of ${pagination.total} manga · ${model.scopeName}`;
        renderPagination(document.getElementById("manga-pagination"), pagination, page => { mangaPage = page; render(false); });
        const warning = document.getElementById("dashboard-date-warning");
        warning.hidden = !model.invalidDates;
        warning.textContent = model.invalidDates
            ? `${model.invalidDates} chương thiếu hoặc có ngày không hợp lệ; không tính vào số chương tháng.` : "";
        const list = document.getElementById("manga-list");
        list.replaceChildren();
        for (const item of pagination.items) {
            assertCanManageManga(currentStaff, item.manga);
            const row = document.createElement("tr");
            const title = document.createElement("td");
            const identity = document.createElement("div");
            identity.className = "dashboard-manga-identity";
            const cover = document.createElement("img");
            cover.className = "manga-cover";
            cover.src = item.manga.cover;
            cover.alt = "";
            cover.loading = "lazy";
            const name = document.createElement("span");
            name.textContent = item.manga.title;
            identity.append(cover, name);
            title.appendChild(identity);
            const update = document.createElement("td");
            const chapter = document.createElement("span");
            chapter.textContent = item.latestChapter?.title || "Chưa có chương";
            update.appendChild(chapter);
            if (item.latestDate !== null) {
                const date = document.createElement("time");
                date.dateTime = new Date(item.latestDate).toISOString();
                date.textContent = date.dateTime.slice(0, 10);
                update.appendChild(date);
            }
            const action = document.createElement("td");
            const link = document.createElement("a");
            link.className = "dashboard-edit-link";
            link.href = `/admin/manga/?manga=${encodeURIComponent(item.slug)}`;
            link.textContent = "Edit";
            link.setAttribute("aria-label", `Edit ${item.manga.title}`);
            action.appendChild(link);
            row.append(title, cell(item.team.name), cell(String(item.chapterCount), "dashboard-chapter-count"),
                cell(item.manga.status || "—"), update, action);
            list.appendChild(row);
        }
        document.getElementById("dashboard-empty").hidden = model.mangaCount !== 0;
    }

    render();
    document.getElementById("dashboard-content").hidden = false;
    dashboard.setAttribute("aria-busy", "false");
} catch (error) {
    dashboard.setAttribute("aria-busy", "false");
    showStaffAccessError(error);
}
