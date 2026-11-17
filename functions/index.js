const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();
const {createAccessEndpoint} = require("./lib/access/endpoint.js");
exports.setUserAccess = createAccessEndpoint(db);

/* Trusted chapter views reuse the existing Admin Firestore instance. */
const {createViewEndpoints} = require("./lib/views/endpoints.js");
const viewEndpoints = createViewEndpoints(db);
exports.startChapterViewSession = viewEndpoints.startChapterViewSession;
exports.recordChapterView = viewEndpoints.recordChapterView;
exports.getChapterViewAnalytics = viewEndpoints.getChapterViewAnalytics;

/* Threaded comments reuse the existing codebase and Admin SDK instance. */
const {createCommentEndpoints} = require("./lib/comments/endpoints.js");
const commentEndpoints = createCommentEndpoints(db);
exports.createComment = commentEndpoints.createComment;
exports.editComment = commentEndpoints.editComment;
exports.deleteComment = commentEndpoints.deleteComment;
exports.moderateComment = commentEndpoints.moderateComment;
exports.listComments = commentEndpoints.listComments;

/* Public popularity only; independent of valid-view accounting. */
const {createPopularityEndpoint} = require("./lib/popularity/endpoint.js");
exports.recordChapterPopularity = createPopularityEndpoint(db);

/* Read-only monthly analytics and immutable monthly reporting/export. */
const {createReportEndpoints} = require("./lib/reports/endpoints.js");
const reportEndpoints = createReportEndpoints(db);
exports.getMonthlyViewDashboard = reportEndpoints.getMonthlyViewDashboard;
exports.getMonthlyViewReports = reportEndpoints.getMonthlyViewReports;
exports.retryMonthlyViewReport = reportEndpoints.retryMonthlyViewReport;
exports.closeMonthlyViewReport = reportEndpoints.closeMonthlyViewReport;

exports.generateMonthlyViewReport = reportEndpoints.generateMonthlyViewReport;
