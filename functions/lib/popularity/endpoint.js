const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {FieldValue} = require("firebase-admin/firestore");
const {defineBoolean} = require("firebase-functions/params");
const {logger} = require("firebase-functions");

// Independent of paid-view App Check configuration and accounting policy.
const enforceAppCheck = defineBoolean("ENFORCE_POPULARITY_APP_CHECK", {default: false});
exports.createPopularityEndpoint = (db) => onCall({region: "us-central1", enforceAppCheck,
  cors: ["https://heliumtg.com", "https://www.heliumtg.com", "http://localhost:8000", "http://127.0.0.1:8000"],
  maxInstances: 20, timeoutSeconds: 30}, async (request) => {
  const {ViewError} = await import("../views/policy.mjs");
  try {
    const {publishedCatalogue} = await import("../views/catalogue.mjs");
    const {recordPopularity} = await import("./service.mjs");
    return await recordPopularity(request.data, {db, catalogue: publishedCatalogue, increment: (n) => FieldValue.increment(n)});
  } catch (error) {
    if (error instanceof ViewError) throw new HttpsError(error.code, error.message);
    logger.error("Popularity counter failed", {errorType: error?.name || "Error"});
    throw new HttpsError("unavailable", "Popularity counter temporarily unavailable");
  }
});
