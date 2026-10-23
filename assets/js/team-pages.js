import { getTeams } from "./teams.js";
import { escapeHTML as esc, imageURL, renderMangaCard, installCoverFallback } from "./manga-card.js";
import { teamManga, sortTeamManga, getUpdateTime, validTeamId } from "./team-catalogue.js";

const root = document.getElementById("team-content");
const detail = document.body.dataset.page === "team";
const fallback = "/assets/images/helium_logo.webp";
const teamURL = id => `/team.html?id=${encodeURIComponent(id)}`;
const avatar = team => imageURL(team.avatar || fallback);
const portrait = team => `<img class="team-avatar" src="${esc(avatar(team))}" alt="${esc(team.leader ? `Trưởng nhóm ${team.leader}` : `Ảnh đại diện ${team.name}`)}" decoding="async">`;

try {
    if (localStorage.getItem("userWebTheme") === "dark") document.documentElement.dataset.theme = "dark";
} catch { /* Storage may be disabled. */ }

installCoverFallback(root);

function message(text) {
    root.innerHTML = `<section class="team-state"><h1>${esc(text)}</h1><a href="/teams.html">Xem tất cả nhóm dịch</a></section>`;
}

async function init() {
    const id = new URLSearchParams(location.search).get("id");
    if (detail && !validTeamId(id)) { message("Không tìm thấy nhóm dịch."); return; }
    try {
        const [teams, catalogue] = await Promise.all([
            getTeams(),
            fetch("/assets/data/data.json").then(response => {
                if (!response.ok) throw new Error("Catalogue unavailable");
                return response.json();
            })
        ]);
        if (!detail) {
            root.innerHTML = '<h1>Thông tin nhóm dịch</h1><div class="teams-grid"></div>';
            root.querySelector(".teams-grid").innerHTML = teams.map(team => {
                const entries = sortTeamManga(teamManga(catalogue, team.id));
                const latest = entries.find(([, manga]) => getUpdateTime(manga) > 0)?.[1];
                return `<a class="team-card" href="${teamURL(team.id)}">${portrait(team)}<div class="team-copy">
                    <span class="team-badge">Nhóm dịch</span><h2>${esc(team.name)}</h2>
                    <p>${entries.length} bộ truyện</p><p>Mới cập nhật: ${esc(latest?.title || "Chưa có cập nhật")}</p></div></a>`;
            }).join("");
            if (!teams.length) root.querySelector(".teams-grid").textContent = "Chưa có nhóm dịch.";
            return;
        }
        const team = teams.find(team => team.id === id);
        if (!team) { message("Không tìm thấy nhóm dịch."); return; }
        const entries = sortTeamManga(teamManga(catalogue, team.id));
        document.title = `${team.name} | HeliumTG`;
        root.innerHTML = `<nav class="team-breadcrumb" aria-label="Đường dẫn"><a href="/">Trang chủ</a> <span aria-hidden="true">›</span> <a href="/teams.html">Nhóm dịch</a> <span aria-hidden="true">›</span> <span aria-current="page">${esc(team.name)}</span></nav>
            <section class="team-hero"><div class="team-hero-background" aria-hidden="true"></div>${portrait(team)}
                <div class="team-copy"><span class="team-badge">Nhóm dịch</span><h1>${esc(team.name)}</h1><p>${entries.length} bộ truyện</p>
                ${team.description ? `<p>${esc(team.description)}</p>` : ''}</div></section>
            <section aria-labelledby="team-manga-title"><h2 id="team-manga-title">Truyện của nhóm <span class="team-badge">${entries.length} bộ</span></h2>
            <div class="comics-grid">${entries.map(([slug, manga]) => renderMangaCard(slug, manga)).join("")}</div>
            ${entries.length ? '' : '<p class="team-state">Nhóm chưa có truyện được đăng tải.</p>'}</section>`;
        root.querySelector(".team-hero-background").style.backgroundImage = `url(${JSON.stringify(avatar(team))})`;
    } catch {
        message("Chưa thể tải thông tin nhóm dịch. Vui lòng thử lại sau.");
    }
}
init();
