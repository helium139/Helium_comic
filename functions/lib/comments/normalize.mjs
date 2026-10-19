// Non-destructive operator-only metadata normalization, resumable and bounded.
import {initializeApp} from "firebase-admin/app";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
if (process.env.GCLOUD_PROJECT !== "helium-team-d7f80" || process.argv[2] !== "--normalize") throw new Error("Explicit production project and --normalize required");
initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = getFirestore();
const {publishedCatalogue} = await import("../views/catalogue.mjs");
const snapshot = await publishedCatalogue();
for (const mangaId of Object.keys(snapshot.data)) {
  let after;
  let more = true;
  while (more) {
    let query = db.collection(`comments/${mangaId}/messages`).orderBy("__name__").limit(100);
    if (after) query = query.startAfter(after);
    const page = await query.get();
    for (const doc of page.docs) {
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(doc.ref)).data();
        if (!current) return;
        const patch = {};
        if (!("parentId" in current)) patch.parentId = null;
        if (!("rootId" in current)) patch.rootId = null;
        // Existing timestamps/text are never rewritten. Missing date has no historic timestamp.
        if (!current.createdAt) patch.createdAt = FieldValue.serverTimestamp();
        if (Object.keys(patch).length) tx.update(doc.ref, patch);
      });
    }
    more = page.size === 100;
    after = page.docs.at(-1);
  }
  await db.doc(`commentSystem/${mangaId}`).set({rootsReady: true, normalizedAt: FieldValue.serverTimestamp()});
}
console.log("Comment root metadata normalized; existing content retained.");
