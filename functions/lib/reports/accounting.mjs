import {createHash} from "node:crypto";
export class ReportError extends Error {
  constructor(code, message) {
    super(message); this.code = code; this.reportSafe = true;
  }
}
export const fail = (code, message) => {
  throw new ReportError(code, message);
};
export function requireAdmin(actor) {
  if (!actor?.uid) fail("unauthenticated", "Sign in required");
  if (actor.role !== "admin") fail("permission-denied", "Admin access required");
}
const validId = (value) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 200;
export function validCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail("failed-precondition", "Invalid accounting aggregate");
  return value;
}
export function buildSnapshot(month, catalogue, site, teamDocs, mangaDocs) {
  const registry = new Map();
  for (const team of catalogue.teams) {
    if (!validId(team.id) || registry.has(team.id)) fail("failed-precondition", "Invalid team registry");
    registry.set(team.id, team);
  }
  const counts = new Map([...registry.values()].filter((team) => team.active === true).map((team) => [team.id, 0]));
  for (const row of teamDocs) {
    if (!validId(row.teamId) || row.scopeId !== `team:${row.teamId}` || row.kind !== "team" || row.period !== month || row.parentScopeId !== "site") fail("failed-precondition", "Invalid team aggregate");
    counts.set(row.teamId, validCount(row.validViews));
  }
  const teams = [...counts].map(([teamId, validViews]) => ({teamId, teamName: String(registry.get(teamId)?.name || teamId).slice(0, 300), validViews}));
  teams.sort((a, b) => a.teamName.localeCompare(b.teamName, "en") || a.teamId.localeCompare(b.teamId, "en"));
  const totalValidViews = validCount(site?.validViews ?? 0);
  if (teams.reduce((sum, team) => sum + team.validViews, 0) !== totalValidViews) fail("failed-precondition", "Site and team aggregates do not reconcile");
  const mangaTotals = new Map();
  const mangas = mangaDocs.map((row) => {
    if (!validId(row.teamId) || !validId(row.mangaId) || row.scopeId !== `manga:${row.teamId}:${row.mangaId}` || row.parentScopeId !== `team:${row.teamId}` || row.kind !== "manga" || row.period !== month || !counts.has(row.teamId)) fail("failed-precondition", "Invalid manga aggregate");
    const count = validCount(row.validViews);
    mangaTotals.set(row.teamId, (mangaTotals.get(row.teamId) || 0) + count);
    return {teamId: row.teamId, teamName: String(registry.get(row.teamId)?.name || row.teamId).slice(0, 300), mangaId: row.mangaId,
      mangaTitle: String(catalogue.data[row.mangaId]?.title || row.mangaId).slice(0, 300), validViews: count};
  });
  for (const team of teams) if ((mangaTotals.get(team.teamId) || 0) !== team.validViews) fail("failed-precondition", "Team and manga aggregates do not reconcile");
  mangas.sort((a, b) => a.teamName.localeCompare(b.teamName, "en") || a.teamId.localeCompare(b.teamId, "en") || a.mangaTitle.localeCompare(b.mangaTitle, "en") || a.mangaId.localeCompare(b.mangaId, "en"));
  if (teams.length > 500 || mangas.length > 10000) fail("resource-exhausted", "Monthly report size requires partitioning");
  const snapshot = {schemaVersion: 1, snapshotVersion: 1, month, timezone: "UTC", totalValidViews, teams, mangas,
    catalogueRevision: catalogue.revision, adjustmentPolicy: "Future corrections require separate audited adjustments"};
  const snapshotHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return {...snapshot, snapshotHash};
}
