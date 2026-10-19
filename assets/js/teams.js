// Canonical metadata lives in teams.json. These helpers do not authorize writes.
const stableKey = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeTeam(value) {
    // Explicit compatibility mapping: never derive stable IDs from display names.
    if (value === "HeliumTG") value = {
        id: "heliumtg", name: "HeliumTG", slug: "heliumtg", active: true
    };
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        typeof value.id !== "string" || !stableKey.test(value.id) ||
        typeof value.slug !== "string" || !stableKey.test(value.slug) ||
        typeof value.name !== "string" || !value.name.trim() ||
        typeof value.active !== "boolean") {
        throw new Error("Invalid team metadata: explicit id, name, slug and boolean active are required");
    }
    return Object.freeze({ id: value.id, name: value.name, slug: value.slug, active: value.active });
}

export function normalizeTeams(values) {
    if (!Array.isArray(values)) throw new Error("Teams must be an array");
    const teams = values.map(normalizeTeam);
    for (const field of ["id", "slug"]) {
        if (new Set(teams.map(team => team[field])).size !== teams.length) {
            throw new Error(`Duplicate team ${field}`);
        }
    }
    return Object.freeze(teams);
}

let pendingTeams;
export function getTeams() {
    if (!pendingTeams) pendingTeams = fetch("/assets/data/teams.json")
        .then(response => {
            if (!response.ok) throw new Error("Unable to load team metadata");
            return response.json();
        })
        .then(normalizeTeams)
        .catch(error => { pendingTeams = null; throw error; });
    return pendingTeams;
}

export async function getTeamById(teamId, teams) {
    teams = teams || await getTeams();
    const team = teams.find(team => team.id === teamId);
    if (!team) throw new Error(`Unknown team ownership: ${teamId}`);
    return team;
}

export async function getTeamDisplayName(teamId) {
    return (await getTeamById(teamId)).name;
}

export function resolveMangaTeam(manga, teams) {
    // A present but invalid ID must never fall back to a legacy name.
    if (Object.hasOwn(manga, "teamId")) {
        const team = teams.find(team => team.id === manga.teamId);
        if (!team) throw new Error(`Unknown team ownership: ${manga.teamId}`);
        return team;
    }
    const matches = teams.filter(team => team.name === manga.team);
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous legacy team: ${manga.team}`);
    return matches[0];
}

export function validateCatalogue(catalogue, teams) {
    const registry = normalizeTeams(teams);
    for (const [mangaId, manga] of Object.entries(catalogue)) {
        if (!Object.hasOwn(manga, "teamId")) throw new Error(`Missing teamId: ${mangaId}`);
        resolveMangaTeam(manga, registry);
    }
    return Object.keys(catalogue).length;
}
