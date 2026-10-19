import {randomUUID, createHash} from "node:crypto";
import {utcMonths, monthEnd} from "./utc-months.mjs";
import {buildSnapshot, requireAdmin, fail} from "./accounting.mjs";
const LEASE_MS = 15 * 60_000;

export function createReportService({db, catalogue, exporter, folderId, timestamp, clock = Date.now, projectId = "helium-team-d7f80"}) {
  const ref = (month) => db.doc(`monthlyReports/${month}`);
  const owned = (data, runId) => {
    if (data?.runId !== runId || data.status !== "generating") fail("aborted", "Report lease changed");
  };
  async function checkpoint(month, runId, patch) {
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref(month))).data(); owned(current, runId);
      tx.update(ref(month), patch);
    });
  }
  async function snapshot(month, runId) {
    const existing = (await ref(month).get()).data();
    if (existing.snapshotHash) return existing;
    const source = await catalogue();
    return db.runTransaction(async (tx) => {
      const current = (await tx.get(ref(month))).data(); owned(current, runId);
      if (current.snapshotHash) return current;
      const site = (await tx.get(db.doc(`analyticsScopes/site/periods/${month}`))).data();
      const query = (kind) => db.collectionGroup("periods").where("kind", "==", kind).where("period", "==", month).orderBy("scopeId").limit(10001);
      const trustedRows = (snapshot) => snapshot.docs.map((doc) => {
        const row = doc.data();
        if (doc.ref.path !== `analyticsScopes/${row.scopeId}/periods/${month}`) fail("failed-precondition", "Unexpected accounting source path");
        return row;
      });
      const teamDocs = trustedRows(await tx.get(query("team")));
      const mangaDocs = trustedRows(await tx.get(query("manga")));
      const data = buildSnapshot(month, source, site, teamDocs, mangaDocs);
      if (Buffer.byteLength(JSON.stringify(data)) > 4_000_000) fail("resource-exhausted", "Monthly snapshot requires partitioning");
      const {mangas, ...summary} = data;
      const chunks = [];
      for (let index = 0; index < mangas.length; index += 100) chunks.push(mangas.slice(index, index + 100));
      if (Buffer.byteLength(JSON.stringify(summary)) > 500_000) fail("resource-exhausted", "Monthly summary too large");
      for (const [index, rows] of chunks.entries()) {
        tx.create(db.doc(`monthlyReports/${month}/snapshotChunks/${String(index).padStart(5, "0")}`), {rows, snapshotHash: data.snapshotHash, part: index});
      }
      const patch = {...summary, chunkCount: chunks.length, mangaCount: mangas.length, closedAt: timestamp(clock())};
      tx.update(ref(month), patch);
      return {...current, ...patch};
    });
  }
  async function run(month, actor = {trigger: "scheduler"}) {
    let end;
    try {
      end = monthEnd(month);
    } catch {
      fail("invalid-argument", "Invalid report month");
    }
    if (clock() < end + 10 * 60_000) fail("failed-precondition", "Month is not ready to close");
    const runId = randomUUID();
    const claimed = await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref(month))).data();
      if (current?.status === "generated") return false;
      if (current?.status === "generating" && current.leaseUntil.toMillis() > clock()) fail("aborted", "Report generation is already running");
      tx.set(ref(month), {month, timezone: "UTC", schemaVersion: 1, ...(!current ? {generatedAt: null, closedAt: null, snapshotHash: null,
        spreadsheetId: null, spreadsheetUrl: null, creationState: "not_started",
        exportKey: createHash("sha256").update(`${projectId}:monthly-views:v1:${month}`).digest("hex"),
        driveFolderId: folderId} : {}), driveFolderId: current?.driveFolderId || folderId, status: "generating", runId, leaseUntil: timestamp(clock() + LEASE_MS),
      attempts: (current?.attempts || 0) + 1, lastAttemptAt: timestamp(clock()), lastTrigger: actor.trigger,
      lastRequestedBy: actor.uid || null, error: null}, {merge: true});
      tx.create(db.doc(`monthlyReports/${month}/attempts/${runId}_start`), {runId, trigger: actor.trigger,
        requestedBy: actor.uid || null, outcome: "started", createdAt: timestamp(clock())});
      return true;
    });
    if (!claimed) return {status: "generated", alreadyGenerated: true, month};
    try {
      const data = await snapshot(month, runId);
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(data.driveFolderId || "")) fail("failed-precondition", "Report folder is not configured");
      const chunks = await db.collection(`monthlyReports/${month}/snapshotChunks`).orderBy("part").get();
      if (chunks.size !== data.chunkCount || chunks.docs.some((doc) => doc.data().snapshotHash !== data.snapshotHash)) fail("failed-precondition", "Snapshot chunks are inconsistent");
      const mangas = chunks.docs.flatMap((doc) => doc.data().rows);
      let file;
      if (data.spreadsheetId) file = await exporter.verify(data.spreadsheetId, data);
      else {
        const matches = await exporter.find(data);
        if (matches.length > 1) fail("failed-precondition", "Multiple export files require owner reconciliation");
        file = matches[0];
        if (!file) {
          if (data.creationState === "issued") fail("failed-precondition", "Uncertain Sheet creation requires owner reconciliation; retry lookup later");
          // Persist intent BEFORE Google POST. Never automatically POST a second time after an uncertain result.
          await checkpoint(month, runId, {creationState: "issued"});
          try {
            file = await exporter.create(data);
          } catch (error) {
            if (error.definitiveRejection) await checkpoint(month, runId, {creationState: "not_started"});
            throw error;
          }
        }
        file = await exporter.verify(file.id, data);
        await checkpoint(month, runId, {spreadsheetId: file.id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${file.id}/edit`, creationState: "identified"});
      }
      // Only incomplete exports may be repopulated. Accounting snapshot never changes.
      await exporter.populate(file.id, {...data, mangas});
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref(month))).data(); owned(current, runId);
        tx.update(ref(month), {status: "generated", generatedAt: timestamp(clock()), leaseUntil: timestamp(clock()), error: null});
        tx.create(db.doc(`monthlyReports/${month}/attempts/${runId}_finish`), {runId, trigger: actor.trigger,
          requestedBy: actor.uid || null, outcome: "generated", createdAt: timestamp(clock())});
      });
      return {month, status: "generated", alreadyGenerated: false};
    } catch (error) {
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref(month))).data();
        if (current?.runId !== runId || current.status !== "generating") return;
        // No raw OAuth/Google responses or secrets are persisted.
        tx.update(ref(month), {status: "failed", error: error.reportSafe === true ? error.message : "Report generation failed; check configuration and retry", leaseUntil: timestamp(clock())});
        tx.create(db.doc(`monthlyReports/${month}/attempts/${runId}_finish`), {runId, trigger: actor.trigger,
          requestedBy: actor.uid || null, outcome: "failed", createdAt: timestamp(clock())});
      });
      throw error;
    }
  }
  async function retry(data, actor) {
    requireAdmin(actor);
    try {
      monthEnd(data?.month);
    } catch {
      fail("invalid-argument", "Invalid report month");
    }
    const existing = (await ref(data.month).get()).data();
    if (!existing) fail("failed-precondition", "Only an existing incomplete report can be retried");
    return run(data.month, {uid: actor.uid, trigger: "admin_retry"});
  }
  async function history(data, actor) {
    requireAdmin(actor);
    if (data?.cursor) {
      try {
        monthEnd(data.cursor);
      } catch {
        fail("invalid-argument", "Invalid cursor");
      }
    }
    let query = db.collection("monthlyReports").orderBy("__name__", "desc").limit(21);
    if (data?.cursor) query = query.startAfter(data.cursor);
    const docs = (await query.get()).docs;
    return {reports: docs.slice(0, 20).map((doc) => {
      const row = doc.data();
      return {month: row.month, totalValidViews: row.totalValidViews ?? null, teamCount: row.teams?.length ?? null,
        status: row.status, generatedAt: row.generatedAt?.toMillis?.() ?? null, closedAt: row.closedAt?.toMillis?.() ?? null,
        spreadsheetUrl: row.status === "generated" ? row.spreadsheetUrl : null, error: row.error || null, attempts: row.attempts || 0};
    }), nextCursor: docs.length > 20 ? docs[19].id : null};
  }
  const scheduled = (event) => run(utcMonths(event?.scheduleTime || clock()).previousPeriod, {trigger: "scheduler"});
  return {run, retry, history, scheduled};
}
