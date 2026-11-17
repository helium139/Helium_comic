export class AccessError extends Error {
  constructor(code, message) {
    super(message); this.code = code;
  }
}
export const deny = (code, message) => {
  throw new AccessError(code, message);
};
export function matchesAccess(actor, current) {
  return !!actor?.uid && current?.state === "active" &&
    Number.isSafeInteger(actor.accessVersion) && actor.accessVersion > 0 &&
    actor.accessVersion === current.version && actor.role === current.role &&
    (actor.teamId || null) === (current.teamId || null);
}
export function assertAccess(actor, current, roles = ["admin", "team_leader"]) {
  if (!actor?.uid) deny("unauthenticated", "Sign in required");
  if (!roles.includes(actor.role) || !matchesAccess(actor, current)) {
    deny("permission-denied", "Access changed or synchronization pending; sign in again");
  }
  return actor;
}
export const actorFromAuth = (auth) => ({uid: auth?.uid || null,
  role: auth?.token?.role, teamId: auth?.token?.teamId || null,
  accessVersion: auth?.token?.accessVersion});
export async function currentActor(db, auth, roles) {
  const actor = actorFromAuth(auth);
  if (!actor.uid) deny("unauthenticated", "Sign in required");
  const current = (await db.doc(`staffAccess/${actor.uid}`).get()).data();
  return assertAccess(actor, current, roles);
}
