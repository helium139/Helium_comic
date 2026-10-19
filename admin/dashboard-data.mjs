// Temporary catalogue-based dashboard metrics. No view events or Firestore reads.
export function getDashboardScope(staff, requestedScope, teams) {
    if (!["admin", "team_leader"].includes(staff.role)) throw new Error("Staff access required");
    const scope = staff.role === "team_leader" ? staff.teamId : requestedScope || "all";
    if (staff.role === "admin" && scope === "all") return scope;
    if (!scope || !teams.some(team => team.id === scope)) throw new Error("Unknown dashboard team scope");
    return scope;
}

export function utcMonthBounds(now = new Date()) {
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid dashboard date");
    const year = now.getUTCFullYear(), month = now.getUTCMonth();
    return {
        start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1),
        key: `${year}-${String(month + 1).padStart(2, "0")}`
    };
}

export function chapterDate(value) {
    if (typeof value !== "string") return null;
    // Explicit offsets and date-only UTC are deterministic; timezone-less times are not accepted.
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
    if (!match) return null;
    const [, y, m, d, h = "00", min = "00", sec = "00"] = match;
    const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > days ||
        Number(h) > 23 || Number(min) > 59 || Number(sec) > 59) return null;
    const timestamp = Date.parse(match[8] ? value : `${value}T00:00:00Z`);
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function buildDashboardModel(staff, catalogue, teams, requestedScope, now = new Date()) {
    const scope = getDashboardScope(staff, requestedScope, teams);
    const month = utcMonthBounds(now);
    const byId = new Map(teams.map(team => [team.id, team]));
    const allTeams = staff.role === "admin" && scope === "all";
    let monthlyChapters = 0, invalidDates = 0;
    const mangas = [];
    for (const [slug, manga] of Object.entries(catalogue)) {
        // Fixed leader scope is enforced here as well as in the caller's staff filter.
        if (!allTeams && manga.teamId !== scope) continue;
        const team = byId.get(manga.teamId);
        if (!team) throw new Error(`Unknown manga team ownership: ${slug}`);
        const chapters = Array.isArray(manga.chapters) ? manga.chapters : [];
        let latestChapter = chapters.at(-1) || null, latestDate = null;
        for (const chapter of chapters) {
            const timestamp = chapterDate(chapter.createAt);
            if (timestamp === null) { invalidDates++; continue; }
            if (timestamp >= month.start && timestamp < month.end) monthlyChapters++;
            if (latestDate === null || timestamp >= latestDate) {
                latestDate = timestamp;
                latestChapter = chapter;
            }
        }
        mangas.push({ slug, manga, team, chapterCount: chapters.length, latestChapter, latestDate });
    }
    mangas.sort((a, b) => String(a.manga.title).localeCompare(String(b.manga.title), "vi"));
    return {
        scope, scopeName: allTeams ? "All Teams" : byId.get(scope).name,
        month, mangaCount: mangas.length, monthlyChapters, invalidDates, mangas
    };
}
