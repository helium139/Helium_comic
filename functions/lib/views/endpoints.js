const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret, defineBoolean} = require("firebase-functions/params");
const {Timestamp} = require("firebase-admin/firestore");
const {logger} = require("firebase-functions");

const readerKey = defineSecret("VIEW_READER_HMAC_KEY");
const enforceAppCheck = defineBoolean("ENFORCE_VIEW_APP_CHECK", {default: false});

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
      const {createViewService} = await import("./view-service.mjs");
      const {publishedCatalogue} = await import("./catalogue.mjs");
      const service = createViewService({db, timestamp: (ms) => Timestamp.fromMillis(ms),
        secret: readerKey.value(), catalogue: publishedCatalogue});
      return await service[method](request.data, {
        uid: request.auth?.uid || null,
        role: request.auth?.token?.role,
        teamId: request.auth?.token?.teamId,
        network: request.rawRequest.ip?.toLowerCase().replace(/^::ffff:/, "") || "unavailable",
      });
    } catch (error) {
      if (error instanceof ViewError) throw new HttpsError(error.code, error.message);
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
