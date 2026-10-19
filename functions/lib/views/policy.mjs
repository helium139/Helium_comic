import {createHmac} from "node:crypto";

export const DEFAULT_POLICY = Object.freeze({
  policyVersion: "valid-views-v1", sessionMs: 30 * 60_000, minimumMs: 10_000,
  dedupMs: 24 * 3600_000, readerHourlyLimit: 120, networkHourlyLimit: 2400,
  readerSessionHourlyLimit: 360, networkSessionHourlyLimit: 7200,
});
export class ViewError extends Error {
  constructor(code, message) {
    super(message); this.code = code;
  }
}
export const deny = (code, message) => {
  throw new ViewError(code, message);
};
export const millis = (value) => typeof value?.toMillis === "function" ? value.toMillis() : NaN;
export const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const validSlug = (value) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 200;
export function hash(secret, domain, ...parts) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("View identity secret is unavailable");
  return createHmac("sha256", secret).update(JSON.stringify([domain, ...parts])).digest("hex");
}
export function identity(context, anonymousReaderId, secret) {
  if (!uuid(anonymousReaderId)) deny("invalid-argument", "A valid reader identifier is required");
  const uid = context.uid || null;
  const deviceHash = hash(secret, "device-v1", anonymousReaderId);
  return {
    uid, deviceHash,
    accountHash: uid ? hash(secret, "account-v1", uid) : null,
    networkHash: hash(secret, "network-v1", context.network || "unavailable"),
  };
}
export function policy(config) {
  const result = {...DEFAULT_POLICY};
  if (typeof config.policyVersion === "string" && /^[a-z0-9-]{1,60}$/.test(config.policyVersion)) result.policyVersion = config.policyVersion;
  for (const field of ["readerHourlyLimit", "networkHourlyLimit", "readerSessionHourlyLimit", "networkSessionHourlyLimit"]) {
    if (config[field] !== undefined) {
      if (!Number.isSafeInteger(config[field]) || config[field] < 1 || config[field] > 10000) throw new Error("Invalid trusted view policy");
      result[field] = config[field];
    }
  }
  return result;
}
export function activation(config, now) {
  const timestamp = millis(config.activationAt);
  if (config.enabled !== true || !Number.isFinite(timestamp) || timestamp > now) deny("failed-precondition", "Valid views are not active yet");
  return timestamp;
}
export function scopeDescriptors(teamId, mangaId, chapterId) {
  const team = `team:${teamId}`; const manga = `manga:${teamId}:${mangaId}`;
  return [
    {scopeId: "site", kind: "site", parentScopeId: null, teamId: null},
    {scopeId: team, kind: "team", parentScopeId: "site", teamId},
    {scopeId: manga, kind: "manga", parentScopeId: team, teamId, mangaId},
    {scopeId: `chapter:${teamId}:${mangaId}:${chapterId}`, kind: "chapter", parentScopeId: manga, teamId, mangaId, chapterId},
  ];
}
export function authorizeAnalytics(context, scopeId) {
  const role = context.role;
  if (!["admin", "team_leader"].includes(role)) deny("permission-denied", "Staff access required");
  if (typeof scopeId !== "string" || !/^(site|team:[a-z0-9-]+|manga:[a-z0-9-]+:[a-z0-9-]+|chapter:[a-z0-9-]+:[a-z0-9-]+:[0-9]+(?:\.[0-9]+)?)$/.test(scopeId)) {
    deny("invalid-argument", "Invalid analytics scope");
  }
  const teamId = scopeId === "site" ? null : scopeId.split(":")[1];
  if (role === "team_leader" && (!validSlug(context.teamId) || context.teamId !== teamId)) deny("permission-denied", "Team analytics access denied");
  return {teamId, kind: scopeId.split(":")[0]};
}
