import {authorizeAnalytics, millis} from "../views/policy.mjs";
import {utcMonths} from "./utc-months.mjs";

// Read-only extension: no changes to accepted-view functions or aggregate writes.
export async function getMonthlyDashboard(data, actor, {db, clock = Date.now}) {
  if (!actor.uid) {
    const error = new Error("Sign in required"); error.code = "unauthenticated"; throw error;
  }
  const scopeId = actor.role === "team_leader" ? `team:${actor.teamId}` : data?.scopeId;
  authorizeAnalytics(actor, scopeId);
  if (actor.role === "team_leader" && data?.scopeId && data.scopeId !== scopeId) {
    const error = new Error("Team analytics access denied"); error.code = "permission-denied"; throw error;
  }
  if (scopeId !== "site" && !scopeId.startsWith("team:")) {
    const error = new Error("Invalid dashboard scope"); error.code = "invalid-argument"; throw error;
  }
  return db.runTransaction(async (tx) => {
    const now = clock(); const months = utcMonths(now);
    const refs = ["viewSystem/config", ...["all", months.currentPeriod, months.previousPeriod].map((period) => `analyticsScopes/${scopeId}/periods/${period}`)];
    const docs = await tx.getAll(...refs.map((path) => db.doc(path)));
    const [config = {}, total, current, previous] = docs.map((doc) => doc.data());
    const activationAt = millis(config.activationAt);
    return {scopeId, ...months, month: months.currentPeriod, serverNow: now,
      active: config.enabled === true && Number.isFinite(activationAt) && activationAt <= now,
      activationAt: Number.isFinite(activationAt) ? activationAt : null,
      total: total?.validViews ?? 0, monthly: current?.validViews ?? 0, previousMonthly: previous?.validViews ?? 0};
  }, {readOnly: true});
}
