const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineBoolean} = require("firebase-functions/params");
const {Timestamp, FieldValue} = require("firebase-admin/firestore");
const {logger} = require("firebase-functions");
const enforceAppCheck = defineBoolean("ENFORCE_COMMENT_APP_CHECK", {default: false});
exports.createCommentEndpoints = (db) => {
  const endpoint = (method) => onCall({region: "us-central1", enforceAppCheck,
    cors: ["https://heliumtg.com", "https://www.heliumtg.com", "http://localhost:8000", "http://127.0.0.1:8000"],
    maxInstances: 20, timeoutSeconds: 30}, async (request) => {
    const {CommentError, createCommentService} = await import("./service.mjs");
    try {
      const {currentActor, actorFromAuth} = await import("../access/policy.mjs");
      const actor = method === "moderate" || ["admin", "team_leader"].includes(request.auth?.token?.role) ?
        await currentActor(db, request.auth) : actorFromAuth(request.auth);
      const {publishedCatalogue} = await import("../views/catalogue.mjs");
      return await createCommentService({db, catalogue: publishedCatalogue, serverTimestamp: () => FieldValue.serverTimestamp(),
        timestampFromParts: (parts) => new Timestamp(parts.seconds, parts.nanoseconds), fieldDelete: () => FieldValue.delete()})[method](request.data, actor);
    } catch (error) {
      if (error instanceof CommentError || ["permission-denied", "unauthenticated"].includes(error.code)) throw new HttpsError(error.code, error.message);
      logger.error("Comment operation failed", {operation: method, errorType: error?.name || "Error"});
      throw new HttpsError("unavailable", "Comments temporarily unavailable");
    }
  });
  return {createComment: endpoint("create"), editComment: endpoint("edit"), deleteComment: endpoint("remove"),
    moderateComment: endpoint("moderate"), listComments: endpoint("list")};
};
