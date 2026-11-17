const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {getAuth} = require("firebase-admin/auth");
const {Timestamp} = require("firebase-admin/firestore");
exports.createAccessEndpoint = (db) => onCall({region: "us-central1", timeoutSeconds: 60}, async (request) => {
  try {
    const {createAccessService} = await import("./service.mjs");
    const {publishedCatalogue} = await import("../views/catalogue.mjs");
    return await createAccessService({db, auth: getAuth(), catalogue: publishedCatalogue,
      timestamp: (ms) => Timestamp.fromMillis(ms)})(request.data, request.auth);
  } catch (error) {
    if (["invalid-argument", "permission-denied", "unauthenticated", "failed-precondition",
      "already-exists", "aborted"].includes(error.code)) throw new HttpsError(error.code, error.message);
    if (error.code === "auth/user-not-found") throw new HttpsError("not-found", "Target user does not exist");
    console.error("Access operation unavailable", {errorType: error.name || "Error"});
    throw new HttpsError("unavailable", "Access operation unavailable; check state before retrying");
  }
});
