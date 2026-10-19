import {resolveChapter} from "../views/catalogue.mjs";

// Legacy/public popularity only. Never writes accounting events or aggregates.
export async function recordPopularity(data, {db, catalogue, increment}) {
  const chapter = resolveChapter(await catalogue(), data?.mangaId, data?.chapterId);
  await db.doc(`mangaStats/${chapter.mangaId}`).set({views: increment(1)}, {merge: true});
  return {success: true};
}
