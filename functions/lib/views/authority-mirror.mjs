export async function currentActor(db, request, {strict = false, clock = Date.now} = {}) {
  const token = request.auth?.token || {};
  const actor = {uid: request.auth?.uid || null, role: token.role, teamId: token.teamId};
  if (!strict || !actor.uid) return actor;
  if (!["admin", "team_leader"].includes(token.role)) return {uid: actor.uid, role: "user", teamId: null};
  const row = (await db.doc(`authzMirrors/${actor.uid}`).get()).data();
  const matches = row?.state === "active" && Number.isSafeInteger(row.version) && row.version === token.accessVersion &&
    row.role === token.role && (row.teamId || null) === (token.teamId || null) && Number.isFinite(row.leaseUntilMs) && row.leaseUntilMs > clock();
  return matches ? {...actor, accessVersion: row.version} : {uid: actor.uid, role: "user", teamId: null};
}
