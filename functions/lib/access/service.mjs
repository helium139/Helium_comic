import {randomUUID} from "node:crypto";
import {actorFromAuth, assertAccess, deny} from "./policy.mjs";

// Cooperative recovery lease, not an authorization cache or a cross-service transaction.
const LEASE_MS = 120000;
const requestId = (s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
export function createAccessService({db, auth, timestamp, catalogue, clock = Date.now}) {
  return async function change(data, callerAuth) {
    const actor = actorFromAuth(callerAuth);
    if (!data || !/^[A-Za-z0-9:_-]{1,128}$/.test(data.uid || "") || !requestId(data.requestId) ||
      !Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0 ||
      !["user", "admin", "team_leader"].includes(data.role) ||
      (data.role === "team_leader" ? !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.teamId || "") : !!data.teamId)) {
      deny("invalid-argument", "Valid uid, role, requestId and expectedVersion required");
    }
    // Authorize BEFORE fetching registry or touching any target account.
    const callerRef = db.doc(`staffAccess/${actor.uid || "_anonymous"}`);
    assertAccess(actor, (await callerRef.get()).data(), ["admin"]);
    if (actor.uid === data.uid) deny("failed-precondition", "Use another administrator for your own access changes");
    if (data.role === "team_leader") {
      const source = await catalogue();
      if (!source.teams.some((t) => t.id === data.teamId && t.active === true)) {
        deny("invalid-argument", "Unknown or inactive team");
      }
    }
    // Check existence before fencing; no unrelated user/profile creation.
    await auth.getUser(data.uid);
    const targetRef = db.doc(`staffAccess/${data.uid}`);
    const operationRef = db.doc(`staffAccessChanges/${data.uid}_${data.requestId}`);
    const profileRef = db.doc(`users/${data.uid}`);
    const leaseOwner = randomUUID();
    const teamId = data.role === "team_leader" ? data.teamId : null;
    const pending = (version, retryAfterMs = 0) => ({ok: false, status: "pending",
      requestId: data.requestId, accessVersion: version, retryAfterMs});
    const start = await db.runTransaction(async (tx) => {
      const [caller, target, operation] = await tx.getAll(callerRef, targetRef, operationRef);
      assertAccess(actor, caller.data(), ["admin"]);
      const current = target.data(); const previous = operation.data();
      if (previous) {
        if (previous.role !== data.role || previous.teamId !== teamId || previous.expectedVersion !== data.expectedVersion) {
          deny("already-exists", "Request ID already used for another change");
        }
        if (previous.status === "complete") {
          // A historical receipt is not proof that a later assignment is still current.
          return {complete: true, version: previous.version, current: current?.state === "active" && current?.version === previous.version};
        }
        if (current?.operationId !== data.requestId || current?.state !== "pending") deny("aborted", "Change superseded");
        if (previous.leaseUntil > clock()) return {busy: true, version: previous.version, retryAfterMs: previous.leaseUntil - clock()};
      } else {
        if (current?.state === "pending") deny("aborted", "Another access change is pending; recover it first");
        if ((current?.version || 0) !== data.expectedVersion) deny("aborted", "Access version changed; reload before editing");
      }
      const version = previous?.version || data.expectedVersion + 1;
      // One leader per team. Slot changes and the revocation fence are atomic.
      if (!previous) {
        const oldTeam = current?.role === "team_leader" ? current.teamId : null;
        const nextSlot = teamId ? db.doc(`teamLeaderSlots/${teamId}`) : null;
        const oldSlot = oldTeam && oldTeam !== teamId ? db.doc(`teamLeaderSlots/${oldTeam}`) : null;
        const nextOwner = nextSlot ? (await tx.get(nextSlot)).data() : null;
        const oldOwner = oldSlot ? (await tx.get(oldSlot)).data() : null;
        if (nextOwner?.uid && nextOwner.uid !== data.uid) {
          deny("failed-precondition", "Team already has a leader; revoke that assignment first");
        }
        if (oldOwner?.uid === data.uid) tx.set(oldSlot, {uid: null, updatedAt: timestamp(clock())});
        if (nextSlot) tx.set(nextSlot, {uid: data.uid, version, updatedAt: timestamp(clock())});
      }
      tx.set(targetRef, {state: "pending", role: data.role, teamId, version,
        operationId: data.requestId, updatedAt: timestamp(clock())});
      tx.set(operationRef, {uid: data.uid, requestId: data.requestId,
        role: data.role, teamId, expectedVersion: data.expectedVersion, version,
        status: "pending", phase: "sync", leaseOwner, leaseUntil: clock() + LEASE_MS,
        attempts: (previous?.attempts || 0) + 1, requestedBy: previous?.requestedBy || actor.uid,
        updatedAt: timestamp(clock())});
      return {version};
    });
    if (start.complete) {
      if (start.current) {
        const [user, profile] = await Promise.all([auth.getUser(data.uid), profileRef.get()]);
        const ack = user.customClaims; const p = profile.data();
        if (ack?.role !== data.role || (ack.teamId || null) !== teamId || ack.accessVersion !== start.version ||
          p?.role !== data.role || (p.teamId || null) !== teamId || p.accessVersion !== start.version) {
          return {ok: false, status: "inconsistent", current: false,
            requestId: data.requestId, accessVersion: start.version};
        }
      }
      return {ok: start.current, status: start.current ? "complete" : "superseded", current: start.current,
        requestId: data.requestId, accessVersion: start.version};
    }
    if (start.busy) return pending(start.version, start.retryAfterMs);
    const checkLease = async () => {
      const operation = (await operationRef.get()).data();
      if (operation?.status !== "pending" || operation.leaseOwner !== leaseOwner || operation.leaseUntil <= clock()) {
        deny("aborted", "Synchronization lease changed; do not continue old work");
      }
    };
    try {
      assertAccess(actor, (await callerRef.get()).data(), ["admin"]);
      const user = await auth.getUser(data.uid);
      const claims = {...user.customClaims, role: data.role, accessVersion: start.version};
      if (teamId) claims.teamId = teamId;
      else delete claims.teamId;
      await checkLease();
      await auth.setCustomUserClaims(data.uid, claims);
      await checkLease();
      await profileRef.set({role: data.role, teamId, accessVersion: start.version,
        updatedAt: timestamp(clock())}, {merge: true});
      const ack = (await auth.getUser(data.uid)).customClaims;
      if (ack?.role !== data.role || (ack.teamId || null) !== teamId || ack.accessVersion !== start.version) {
        throw new Error("Claims not acknowledged");
      }
      await db.runTransaction(async (tx) => {
        const [caller, target, operation, profile] = await tx.getAll(callerRef, targetRef, operationRef, profileRef);
        assertAccess(actor, caller.data(), ["admin"]);
        if (target.data()?.operationId !== data.requestId || target.data()?.state !== "pending" ||
          target.data()?.version !== start.version || target.data()?.role !== data.role || (target.data()?.teamId || null) !== teamId ||
          operation.data()?.leaseOwner !== leaseOwner || operation.data()?.leaseUntil <= clock()) {
          deny("aborted", "Access synchronization lease changed");
        }
        const p = profile.data();
        if (p?.role !== data.role || (p.teamId || null) !== teamId || p.accessVersion !== start.version) {
          deny("aborted", "Profile not acknowledged");
        }
        tx.update(targetRef, {state: "active", updatedAt: timestamp(clock())});
        tx.update(operationRef, {status: "complete", phase: "acknowledged", leaseUntil: 0, updatedAt: timestamp(clock())});
        tx.create(db.doc(`staffAccessAudit/${data.uid}_${data.requestId}`), {
          uid: data.uid, role: data.role, teamId, version: start.version,
          requestId: data.requestId, completedBy: actor.uid, createdAt: timestamp(clock())});
      });
      return {ok: true, status: "complete", current: true,
        requestId: data.requestId, accessVersion: start.version};
    } catch {
      // Outcome may be unknown. Do not restore the previous grant or mint another version.
      // Keep the lease: same requestId is recoverable after the old invocation has ended.
      return pending(start.version, LEASE_MS);
    }
  };
}
