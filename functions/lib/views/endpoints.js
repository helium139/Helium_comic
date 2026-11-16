const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret, defineBoolean, defineString} = require("firebase-functions/params");
const {Timestamp} = require("firebase-admin/firestore");
const {logger} = require("firebase-functions");
const {enforceCurrentAuthority} = require("../authority-config.js");

const readerKey = defineSecret("VIEW_READER_HMAC_KEY");
const enforceAppCheck = defineBoolean("ENFORCE_VIEW_APP_CHECK", {default: false});
const viewWriter = defineString("VIEW_WRITER", {default: "google"});
const workerURL = defineString("VIEW_WORKER_URL", {default: ""});

exports.createViewEndpoints = (db) => {
  const options = {
    region: "us-central1",
    secrets: [readerKey],
    enforceAppCheck,
    cors: ["https://heliumtg.com", "https://www.heliumtg.com",
      "http://localhost:8000", "http://127.0.0.1:8000"],
    maxInstances: 20,
    timeoutSeconds: 30,
  };
  const endpoint = (method) => onCall(options, async (request) => {
    const {ViewError} = await import("./policy.mjs");
    try {
      if (method !== "analytics" && viewWriter.value() !== "google") {
        if (viewWriter.value() !== "cloudflare") throw new HttpsError("failed-precondition", "Unknown view writer");
        const {forwardView} = await import("./migration-bridge.mjs");
        return await forwardView({url: workerURL.value(), name: method === "start" ? "startChapterViewSession" : "recordChapterView",
          secret: readerKey.value(), data: request.data, uid: request.auth?.uid,
          network: request.rawRequest.ip?.toLowerCase().replace(/^::ffff:/, "") || "unavailable",
          authorization: request.rawRequest.get("authorization"), appCheck: request.rawRequest.get("X-Firebase-AppCheck")});
      }
      const {createViewService} = await import("./view-service.mjs");
      const {publishedCatalogue} = await import("./catalogue.mjs");
      const {currentActor} = await import("./authority-mirror.mjs");
      const actor = await currentActor(db, request, {strict: method === "analytics" && enforceCurrentAuthority.value()});
      const service = createViewService({db, timestamp: (ms) => Timestamp.fromMillis(ms),
        secret: readerKey.value(), catalogue: publishedCatalogue});
      return await service[method](request.data, {
        ...actor,
        network: request.rawRequest.ip?.toLowerCase().replace(/^::ffff:/, "") || "unavailable",
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof ViewError || ["unauthenticated", "permission-denied", "resource-exhausted", "failed-precondition", "deadline-exceeded", "invalid-argument", "not-found"].includes(error.code)) throw new HttpsError(error.code, error.message);
      logger.error("Trusted view operation failed", {operation: method, errorType: error?.name || "Error"});
      throw new HttpsError("unavailable", "View service temporarily unavailable");
    }
  });
  return {
    startChapterViewSession: endpoint("start"),
    recordChapterView: endpoint("record"),
    getChapterViewAnalytics: endpoint("analytics"),
  };
};
