import {DEFAULT_POLICY, deny, millis, uuid, hash, identity, policy, activation, scopeDescriptors, authorizeAnalytics} from "./policy.mjs";
import {resolveChapter} from "./catalogue.mjs";

// SDK-independent orchestration; production supplies Admin Firestore and server Timestamp.
export function createViewService({db, timestamp, secret, catalogue, clock = Date.now}) {
  const ref = (path) => db.doc(path);
  const read = async (tx, path) => (await tx.get(ref(path))).data();
  function ratePaths(reader, type) {
    return [
      {key: reader.deviceHash, limit: "reader"},
      ...(reader.accountHash ? [{key: reader.accountHash, limit: "reader"}] : []),
      {key: reader.networkHash, limit: "network"},
    ].map((item) => ({...item, path: `viewRateLimits/${type}_${item.key}`}));
  }
  function recent(data, now) {
    return (data?.acceptedAt || []).filter((time) => Number.isFinite(time) && time > now - 3600_000);
  }

  async function start(data, context) {
    const reader = identity(context, data?.anonymousReaderId, secret);
    if (!uuid(data?.requestId)) deny("invalid-argument", "A start request ID is required");
    const chapter = resolveChapter(await catalogue(), data.mangaId || data.mangaSlug, data.chapterId);
    const sessionId = hash(secret, "session-v1", reader.deviceHash, reader.uid, data.requestId, chapter.mangaId, chapter.chapterId);
    return db.runTransaction(async (tx) => {
      const now = clock();
      const config = await read(tx, "viewSystem/config") || {};
      const activationAt = activation(config, now); const p = policy(config);
      const path = `chapterViewSessions/${sessionId}`;
      const previous = await read(tx, path);
      if (previous) {
        if (millis(previous.expiresAt) <= now) deny("deadline-exceeded", "View session expired");
        return {sessionId, expiresAt: millis(previous.expiresAt), minimumActiveMs: p.minimumMs};
      }
      const rates = ratePaths(reader, "starts");
      for (const rate of rates) {
        rate.times = recent(await read(tx, rate.path), now);
        const limit = rate.limit === "reader" ? p.readerSessionHourlyLimit : p.networkSessionHourlyLimit;
        if (rate.times.length >= limit) deny("resource-exhausted", "View session rate limit reached");
      }
      tx.create(ref(path), {
        ...chapter, uid: reader.uid, anonymousReaderHash: reader.deviceHash,
        startedAt: timestamp(now), expiresAt: timestamp(now + p.sessionMs),
        deleteAfter: timestamp(now + 48 * 3600_000), activationAt: timestamp(activationAt),
        policyVersion: p.policyVersion, consumed: false,
      });
      for (const rate of rates) tx.set(ref(rate.path), {acceptedAt: [...rate.times, now], deleteAfter: timestamp(now + 2 * 3600_000)});
      return {sessionId, expiresAt: now + p.sessionMs, minimumActiveMs: p.minimumMs};
    });
  }

  async function record(data, context) {
    const reader = identity(context, data?.anonymousReaderId, secret);
    const sessionId = data?.sessionId;
    if (typeof sessionId !== "string" || !/^[a-f0-9]{64}$/.test(sessionId)) deny("invalid-argument", "Invalid session ID");
    // A consumed receipt remains available even if catalogue fetching is temporarily down.
    const receipt = (await ref(`chapterViewSessions/${sessionId}`).get()).data();
    if (receipt) {
      if (receipt.anonymousReaderHash !== reader.deviceHash || (receipt.uid && receipt.uid !== reader.uid)) deny("permission-denied", "View session identity mismatch");
      if (receipt.consumed) return receipt.outcome;
    }
    // Resource snapshot is server-fetched and bounded-cache; never supplied by the reader.
    const snapshot = await catalogue();
    return db.runTransaction(async (tx) => {
      const now = clock();
      const sessionPath = `chapterViewSessions/${sessionId}`;
      const session = await read(tx, sessionPath);
      if (!session) deny("not-found", "View session not found");
      if (session.anonymousReaderHash !== reader.deviceHash || (session.uid && session.uid !== reader.uid)) deny("permission-denied", "View session identity mismatch");
      if (session.consumed) return session.outcome;
      if (millis(session.expiresAt) <= now) deny("deadline-exceeded", "View session expired");
      const config = await read(tx, "viewSystem/config") || {};
      const activationAt = activation(config, now); const p = policy(config);
      if (millis(session.activationAt) !== activationAt || session.policyVersion !== p.policyVersion) deny("failed-precondition", "View policy changed; start a new session");
      if (now - millis(session.startedAt) < DEFAULT_POLICY.minimumMs) deny("failed-precondition", "Minimum reading time not reached");
      const chapter = resolveChapter(snapshot, session.mangaId, session.chapterId);
      if (chapter.teamId !== session.teamId) deny("failed-precondition", "Chapter ownership changed; start a new session");
      const keys = [reader.deviceHash, ...(reader.accountHash ? [reader.accountHash] : [])];
      const dedups = [];
      for (const key of keys) {
        const path = `viewDedup/${hash(secret, "chapter-dedup-v1", key, session.mangaId, session.chapterId)}`;
        dedups.push({path, data: await read(tx, path)});
      }
      const finish = (outcome) => {
        tx.update(ref(sessionPath), {consumed: true, consumedAt: timestamp(now), outcome});
        return outcome;
      };
      if (dedups.some((item) => millis(item.data?.nextEligibleAt) > now)) return finish({accepted: false, reason: "duplicate"});
      const rates = ratePaths(reader, "accepted");
      for (const rate of rates) {
        rate.times = recent(await read(tx, rate.path), now);
        const limit = rate.limit === "reader" ? p.readerHourlyLimit : p.networkHourlyLimit;
        if (rate.times.length >= limit) return finish({accepted: false, reason: "rate-limited"});
      }
      const month = new Date(now).toISOString().slice(0, 7);
      const aggregates = [];
      for (const scope of scopeDescriptors(session.teamId, session.mangaId, session.chapterId)) {
        for (const period of ["all", month]) {
          const path = `analyticsScopes/${scope.scopeId}/periods/${period}`;
          const previous = await read(tx, path);
          aggregates.push({path, scope, period, previous});
        }
      }
      // Every read above precedes every write. Firestore retries re-check dedup/rates/counters.
      const createdAt = timestamp(now);
      tx.create(ref(`chapterViewEvents/${sessionId}`), {
        teamId: session.teamId, mangaId: session.mangaId, chapterId: session.chapterId,
        uid: reader.uid, anonymousReaderHash: reader.deviceHash, createdAt, sessionId,
        policyVersion: session.policyVersion, catalogueRevision: chapter.catalogueRevision,
        sessionCatalogueRevision: session.catalogueRevision, activationAt: timestamp(activationAt), valid: true,
      });
      for (const item of dedups) tx.set(ref(item.path), {nextEligibleAt: timestamp(now + p.dedupMs), deleteAfter: timestamp(now + 48 * 3600_000)});
      for (const rate of rates) tx.set(ref(rate.path), {acceptedAt: [...rate.times, now], deleteAfter: timestamp(now + 2 * 3600_000)});
      for (const item of aggregates) {
        tx.set(ref(item.path), {
          ...item.scope, period: item.period, validViews: (item.previous?.validViews || 0) + 1,
          updatedAt: createdAt, activationAt: timestamp(activationAt),
        });
      }
      return finish({accepted: true, eventId: sessionId});
    });
  }

  async function analytics(data, context) {
    const scopeId = data?.scopeId;
    const scope = authorizeAnalytics(context, scopeId);
    const month = new Date(clock()).toISOString().slice(0, 7);
    const period = data.period || "all";
    if (period !== "all" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) deny("invalid-argument", "Invalid analytics period");
    const cursor = data.cursor || null;
    if (cursor && (typeof cursor !== "string" || cursor.length > 650)) deny("invalid-argument", "Invalid analytics cursor");
    const result = await db.runTransaction(async (tx) => {
      const config = await read(tx, "viewSystem/config") || {};
      const active = config.enabled === true && millis(config.activationAt) <= clock();
      const all = await read(tx, `analyticsScopes/${scopeId}/periods/all`);
      const monthly = await read(tx, `analyticsScopes/${scopeId}/periods/${month}`);
      return {active, activationAt: Number.isFinite(millis(config.activationAt)) ? millis(config.activationAt) : null,
        total: all?.validViews || 0, monthly: monthly?.validViews || 0, month};
    });
    let children = []; let nextCursor = null;
    if (data.includeChildren && scope.kind !== "chapter" && result.active) {
      let query = db.collectionGroup("periods").where("parentScopeId", "==", scopeId)
          .where("period", "==", period).orderBy("scopeId").limit(26);
      if (cursor) query = query.startAfter(cursor);
      const rows = (await query.get()).docs.map((doc) => doc.data());
      children = rows.slice(0, 25).map((row) => ({scopeId: row.scopeId, kind: row.kind, teamId: row.teamId,
        mangaId: row.mangaId || null, chapterId: row.chapterId ?? null, validViews: row.validViews}));
      if (children.some((row) => context.role === "team_leader" && row.teamId !== context.teamId)) deny("permission-denied", "Analytics ownership mismatch");
      if (rows.length > 25) nextCursor = children.at(-1).scopeId;
    }
    return {...result, scopeId, period, children, nextCursor};
  }
  return {start, record, analytics};
}
