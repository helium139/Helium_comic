// Only explicit stable IDs determine public ownership; unassigned manga stay excluded.
export function teamManga(catalogue, teamId) {
    return Object.entries(catalogue).filter(([, manga]) => manga.teamId === teamId);
}

export function getUpdateTime(manga) {
    return Math.max(0, ...(manga.chapters || []).map(chapter => Date.parse(chapter.createAt) || 0));
}

export function sortTeamManga(entries) {
    return [...entries].sort((a, b) => getUpdateTime(b[1]) - getUpdateTime(a[1]));
}

export const validTeamId = id => typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
