import {createHash} from "node:crypto";
import {deny, validSlug} from "./policy.mjs";

const ORIGIN = "https://heliumtg.com";
let cached; let pending;
export async function publishedCatalogue() {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  if (!pending) {
    pending = (async () => {
      const options = {signal: AbortSignal.timeout(10000), redirect: "error", headers: {"Cache-Control": "no-cache"}};
      const [dataResponse, teamResponse] = await Promise.all([
        fetch(`${ORIGIN}/assets/data/data.json`, options), fetch(`${ORIGIN}/assets/data/teams.json`, options),
      ]);
      if (!dataResponse.ok || !teamResponse.ok) throw new Error("Published catalogue unavailable");
      const text = await dataResponse.text();
      if (text.length > 10_000_000) throw new Error("Catalogue too large");
      const data = JSON.parse(text); const teams = await teamResponse.json();
      if (!data || Array.isArray(data) || !Array.isArray(teams)) throw new Error("Invalid published catalogue");
      const revision = createHash("sha256").update(text).digest("hex");
      const value = {data, teams, revision};
      cached = {at: Date.now(), value};
      return value;
    })().finally(() => {
      pending = null;
    });
  }
  return pending;
}
export function resolveChapter(catalogue, mangaId, chapterId) {
  if (!validSlug(mangaId) || !["string", "number"].includes(typeof chapterId) || !/^\d+(?:\.\d+)?$/.test(String(chapterId))) {
    deny("invalid-argument", "Invalid chapter identifiers");
  }
  chapterId = String(Number(chapterId));
  if (!Object.hasOwn(catalogue.data, mangaId)) deny("not-found", "Manga not found");
  const manga = catalogue.data[mangaId];
  if (!validSlug(manga.teamId) || !catalogue.teams.some((team) => team.id === manga.teamId)) deny("failed-precondition", "Invalid manga ownership");
  const chapter = manga.chapters?.find((chapter) => String(chapter.id) === chapterId);
  if (!chapter) deny("not-found", "Chapter not found");
  if (!Number.isSafeInteger(chapter.pages) || chapter.pages < 1 || typeof chapter.folder !== "string") deny("failed-precondition", "Chapter unavailable");
  let folder;
  try {
    folder = new URL(chapter.folder);
  } catch {
    deny("failed-precondition", "Chapter unavailable");
  }
  if (folder.protocol !== "https:" || folder.username || folder.password) deny("failed-precondition", "Chapter unavailable");
  return {teamId: manga.teamId, mangaId, chapterId, catalogueRevision: catalogue.revision};
}
