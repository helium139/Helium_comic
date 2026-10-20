const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret, defineString, defineBoolean} = require("firebase-functions/params");
const {Timestamp} = require("firebase-admin/firestore");
const {logger} = require("firebase-functions");
const clientId = defineSecret("GOOGLE_REPORT_CLIENT_ID");
const clientSecret = defineSecret("GOOGLE_REPORT_CLIENT_SECRET");
const refreshToken = defineSecret("GOOGLE_REPORT_REFRESH_TOKEN");
const folderId = defineString("GOOGLE_REPORT_FOLDER_ID", {default: ""});
const enforceAppCheck = defineBoolean("ENFORCE_REPORT_APP_CHECK", {default: false});
const secrets = [clientId, clientSecret, refreshToken];
exports.createReportEndpoints = (db) => {
  async function service() {
    const deadline = Date.now() + 480000;
    const {createReportService} = await import("./service.mjs");
    const {publishedCatalogue} = await import("../views/catalogue.mjs");
    let google;
    const getExporter = () => google || (google = exporter(deadline));
    return createReportService({db, catalogue: publishedCatalogue, timestamp: (ms) => Timestamp.fromMillis(ms), folderId: folderId.value(),
      exporter: {
        async find(data) {
          return (await getExporter()).find(data);
        },
        async verify(id, data) {
          return (await getExporter()).verify(id, data);
        },
        async create(data) {
          return (await getExporter()).create(data);
        },
        async populate(id, data) {
          return (await getExporter()).populate(id, data);
        },
      }});
  }
  // One refresh token exchange per invocation, not per row/API call.
  async function exporter(deadline) {
    const {createGoogleExporter} = await import("./google.mjs");
    return createGoogleExporter({deadline, clientId: clientId.value(), clientSecret: clientSecret.value(), refreshToken: refreshToken.value()});
  }
  const options = {region: "us-central1", enforceAppCheck, cors: ["https://heliumtg.com", "https://www.heliumtg.com", "http://localhost:8000", "http://127.0.0.1:8000"], maxInstances: 10};
  const safe = async (work) => {
    try {
      return await work();
    } catch (error) {
      if (["invalid-argument", "permission-denied", "unauthenticated", "failed-precondition", "resource-exhausted", "aborted"].includes(error.code)) throw new HttpsError(error.code, error.message);
      logger.error("Monthly report operation failed", {errorType: error?.name || "Error",
        errorCode: error?.code || null,
        errorMessage: error?.message || null,
        stack: error?.stack || null,
      });
      throw new HttpsError("unavailable", "Report service temporarily unavailable");
    }
  };
  const actor = (request) => ({uid: request.auth?.uid || null, role: request.auth?.token?.role, teamId: request.auth?.token?.teamId});
  return {
    getMonthlyViewDashboard: onCall(options, (request) => safe(async () => {
      const {getMonthlyDashboard} = await import("./dashboard.mjs");
      return getMonthlyDashboard(request.data, actor(request), {db});
    })),
    getMonthlyViewReports: onCall(options, (request) => safe(async () => (await service()).history(request.data, actor(request)))),
    retryMonthlyViewReport: onCall({...options, secrets, timeoutSeconds: 540, memory: "512MiB", concurrency: 1}, (request) => safe(async () => (await service()).retry(request.data, actor(request)))),
    closeMonthlyViewReport: onSchedule({region: "us-central1", schedule: "10 0 1 * *", timeZone: "UTC", secrets,
      retryCount: 5, minBackoffSeconds: 60, maxBackoffSeconds: 3600, maxRetrySeconds: 86400,
      timeoutSeconds: 540, memory: "512MiB", maxInstances: 1, concurrency: 1}, async (event) => {
      try {
        return await (await service()).scheduled(event);
      } catch (error) {
        logger.error("Monthly close failed", {errorType: error?.name || "Error"});
        throw new Error("Monthly close failed; use report history for safe status");
      }
    }),
  };
};
