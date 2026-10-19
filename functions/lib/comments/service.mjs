import {randomUUID} from "node:crypto";

export class CommentError extends Error {
  constructor(code, message) {
    super(message); this.code = code;
  }
}
const fail = (code, message) => {
  throw new CommentError(code, message);
};
const id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const slug = (value) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 200;
export function commentText(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 4000) fail("invalid-argument", "Comment must contain 1–4000 characters");
  return value.trim();
}
export function publicComment(key, data) {
  const deleted = data.deleted === true;
  const hidden = data.moderationStatus === "hidden";
  return {id: key, uid: data.uid || null, name: typeof data.name === "string" ? data.name : "Reader",
    avatar: typeof data.avatar === "string" && /^https:\/\//.test(data.avatar) ? data.avatar : null,
    text: deleted || hidden ? null : String(data.text ?? data.content ?? ""),
    parentId: data.parentId ?? null, rootId: data.rootId ?? null,
    replyCount: Number.isSafeInteger(data.replyCount) ? Math.max(0, data.replyCount) : 0,
    deleted, moderationStatus: hidden ? "hidden" : "visible",
    createdAt: data.createdAt?.toMillis?.() ?? null, updatedAt: data.updatedAt?.toMillis?.() ?? null};
}
export function createCommentService({db, catalogue, serverTimestamp, timestampFromParts, fieldDelete}) {
  const ref = (manga, key) => db.doc(`comments/${manga}/messages/${key}`);
  const authenticate = (actor) => {
    if (!actor.uid) fail("unauthenticated", "Sign in to comment");
  };
  async function manga(data) {
    if (!slug(data?.mangaId)) fail("invalid-argument", "Invalid manga ID");
    const snapshot = await catalogue();
    const value = Object.hasOwn(snapshot.data, data.mangaId) ? snapshot.data[data.mangaId] : null;
    if (!value || !slug(value.teamId) || !snapshot.teams.some((team) => team.id === value.teamId)) fail("not-found", "Manga unavailable");
    return value;
  }
  function staff(actor, owner) {
    return !!actor.uid && (actor.role === "admin" || (actor.role === "team_leader" && actor.teamId === owner.teamId));
  }
  function commentId(data) {
    if (!id(data?.commentId)) fail("invalid-argument", "Invalid comment ID");
  }
  async function create(data, actor) {
    authenticate(actor); await manga(data);
    const text = commentText(data.text); const parentId = data.parentId ?? null;
    if (parentId !== null && !id(parentId)) fail("invalid-argument", "Invalid parent ID");
    // Caller-chosen UUID makes retries idempotent, never an authorization identity.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.requestId || "")) fail("invalid-argument", "Invalid request ID");
    const key = data.requestId;
    if (parentId === key) fail("invalid-argument", "Invalid parent relationship");
    return db.runTransaction(async (tx) => {
      const existing = await tx.get(ref(data.mangaId, key));
      if (existing.exists) {
        if (existing.data().uid !== actor.uid) fail("permission-denied", "Permission denied");
        return {id: key};
      }
      const profile = (await tx.get(db.doc(`users/${actor.uid}`))).data() || {};
      let parent; let root; let rootId = null;
      if (parentId) {
        parent = (await tx.get(ref(data.mangaId, parentId))).data();
        if (!parent) fail("not-found", "Parent comment not found");
        if (parent.deleted || parent.moderationStatus === "hidden") fail("failed-precondition", "Cannot reply to this comment");
        rootId = parent.rootId ?? parentId;
        if (!id(rootId) || rootId === key) fail("failed-precondition", "Invalid thread");
        root = rootId === parentId ? parent : (await tx.get(ref(data.mangaId, rootId))).data();
        if (!root || root.parentId != null || root.rootId != null) fail("failed-precondition", "Invalid thread root");
        if (root.deleted || root.moderationStatus === "hidden") fail("failed-precondition", "Thread unavailable");
        // Bound traversal and reject malformed pre-Phase-4 relationships as well.
        const seen = new Set([key]);
        let ancestor = parent; let ancestorId = parentId; let reachedRoot = false;
        for (let depth = 0; depth < 32; depth++) {
          if (seen.has(ancestorId)) fail("failed-precondition", "Invalid thread cycle");
          seen.add(ancestorId);
          if (ancestorId === rootId) {
            reachedRoot = true; break;
          }
          if (ancestor.rootId !== rootId || !id(ancestor.parentId)) fail("failed-precondition", "Invalid thread ancestry");
          ancestorId = ancestor.parentId;
          ancestor = ancestorId === rootId ? root : (await tx.get(ref(data.mangaId, ancestorId))).data();
          if (!ancestor) fail("failed-precondition", "Invalid thread ancestry");
        }
        if (!reachedRoot) fail("failed-precondition", "Maximum thread depth reached");
      }
      const createdAt = serverTimestamp();
      tx.create(ref(data.mangaId, key), {uid: actor.uid, text, name: String(profile.name || "Reader").slice(0, 100),
        avatar: typeof profile.avatar === "string" ? profile.avatar.slice(0, 2000) : null,
        createdAt, updatedAt: createdAt, parentId, rootId, replyCount: 0, deleted: false, deletedAt: null, moderationStatus: "visible"});
      // Root replyCount counts all descendants, including soft-deleted placeholders.
      if (root) tx.update(ref(data.mangaId, rootId), {replyCount: (Number.isSafeInteger(root.replyCount) && root.replyCount >= 0 ? root.replyCount : 0) + 1});
      return {id: key};
    });
  }
  async function edit(data, actor) {
    authenticate(actor); await manga(data); commentId(data);
    const text = commentText(data.text);
    await db.runTransaction(async (tx) => {
      const old = (await tx.get(ref(data.mangaId, data.commentId))).data();
      if (!old) fail("not-found", "Comment not found");
      if (old.uid !== actor.uid) fail("permission-denied", "Permission denied");
      if (old.deleted || old.moderationStatus === "hidden") fail("failed-precondition", "Comment unavailable");
      tx.update(ref(data.mangaId, data.commentId), {text, content: fieldDelete(), updatedAt: serverTimestamp()});
    });
    return {success: true};
  }
  async function remove(data, actor) {
    authenticate(actor); await manga(data); commentId(data);
    await db.runTransaction(async (tx) => {
      const old = (await tx.get(ref(data.mangaId, data.commentId))).data();
      if (!old) fail("not-found", "Comment not found");
      if (old.uid !== actor.uid) fail("permission-denied", "Permission denied");
      if (!old.deleted) tx.update(ref(data.mangaId, data.commentId), {deleted: true, text: "", content: fieldDelete(), deletedAt: serverTimestamp(), updatedAt: serverTimestamp()});
    });
    return {success: true};
  }
  async function moderate(data, actor) {
    authenticate(actor); const owner = await manga(data); commentId(data);
    if (!staff(actor, owner)) fail("permission-denied", "Permission denied");
    if (!["hide", "restore", "delete"].includes(data.action)) fail("invalid-argument", "Invalid moderation action");
    const auditId = randomUUID();
    await db.runTransaction(async (tx) => {
      const old = (await tx.get(ref(data.mangaId, data.commentId))).data();
      if (!old) fail("not-found", "Comment not found");
      if (old.deleted && data.action === "restore") fail("failed-precondition", "Deleted text cannot be restored");
      const createdAt = serverTimestamp();
      const patch = {updatedAt: createdAt};
      if (data.action === "delete") Object.assign(patch, {deleted: true, deletedAt: createdAt, text: "", content: fieldDelete()});
      else patch.moderationStatus = data.action === "hide" ? "hidden" : "visible";
      tx.update(ref(data.mangaId, data.commentId), patch);
      tx.create(db.doc(`commentModerationEvents/${auditId}`), {moderatorUid: actor.uid, moderatorRole: actor.role,
        teamId: owner.teamId, mangaId: data.mangaId, commentId: data.commentId, action: data.action, createdAt});
    });
    return {success: true};
  }
  async function list(data, actor) {
    const owner = await manga(data);
    const rootId = data.rootId ?? null;
    if (rootId !== null && !id(rootId)) fail("invalid-argument", "Invalid root ID");
    const cursor = data.cursor ?? null;
    if (cursor && (!id(cursor.id) || !Number.isSafeInteger(cursor.createdAt?.seconds) || cursor.createdAt.seconds < 0 || !Number.isInteger(cursor.createdAt?.nanoseconds) || cursor.createdAt.nanoseconds < 0 || cursor.createdAt.nanoseconds > 999999999)) fail("invalid-argument", "Invalid cursor");
    const ready = (await db.doc(`commentSystem/${data.mangaId}`).get()).data()?.rootsReady === true;
    let query = db.collection(`comments/${data.mangaId}/messages`);
    if (rootId) query = query.where("rootId", "==", rootId);
    else if (ready) query = query.where("parentId", "==", null);
    const direction = rootId ? "asc" : "desc";
    query = query.orderBy("createdAt", direction).orderBy("__name__", direction);
    if (cursor) query = query.startAfter(timestampFromParts(cursor.createdAt), cursor.id);
    // Compatibility scans are bounded to 20 documents, never a whole collection.
    const docs = (await query.limit(21).get()).docs;
    const page = docs.slice(0, 20);
    const comments = page.filter((doc) => rootId || doc.data().parentId == null).map((doc) => publicComment(doc.id, doc.data()));
    const last = page.at(-1);
    return {comments, canModerate: staff(actor, owner), compatibilityMode: !ready,
      nextCursor: docs.length > 20 && last ? {id: last.id, createdAt: {seconds: last.data().createdAt.seconds, nanoseconds: last.data().createdAt.nanoseconds}} : null};
  }
  return {create, edit, remove, moderate, list};
}
