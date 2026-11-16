const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();
const REGION = "us-central1";
const ALLOWED_ROLES = ["user", "admin", "team_leader"];
/**
 * Validate a supported role.
 * @param {string} role Role to validate.
 * @return {boolean} Whether supported.
 */
function isAllowedRole(role) {
  return ALLOWED_ROLES.includes(role);
}

exports.setUserAccess = onCall(
    {
      region: REGION,
    },
    async (request) => {
      /*
       * Must be logged in.
       */
      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "Authentication required.",
        );
      }

      /*
       * Caller MUST already have
       * custom claim:
       *
       * role = admin
       */
      if (
        request.auth.token.role !== "admin"
      ) {
        throw new HttpsError(
            "permission-denied",
            "Only administrators can change user access.",
        );
      }

      const data =
        request.data || {};

      const uid =
        data.uid;

      const role =
        data.role;

      const teamId =
        data.teamId;

      /*
       * Validate uid.
       */
      if (
        !uid ||
        typeof uid !== "string"
      ) {
        throw new HttpsError(
            "invalid-argument",
            "uid is required.",
        );
      }

      /*
       * Validate role.
       */
      if (
        !role ||
        typeof role !== "string" ||
        !isAllowedRole(role)
      ) {
        throw new HttpsError(
            "invalid-argument",
            "Invalid role.",
        );
      }

      /*
       * Team leader requires teamId.
       */
      if (
        role === "team_leader" &&
        (
          !teamId ||
          typeof teamId !== "string"
        )
      ) {
        throw new HttpsError(
            "invalid-argument",
            "team_leader requires teamId.",
        );
      }

      /*
       * Other roles should not have teamId.
       */
      if (
        role !== "team_leader" &&
        teamId
      ) {
        throw new HttpsError(
            "invalid-argument",
            "teamId is only allowed for team_leader.",
        );
      }

      try {
        const auth =
          getAuth();

        /*
         * Make sure target user exists.
         */
        const targetUser =
          await auth.getUser(uid);

        /*
         * Preserve unrelated custom claims.
         */
        const currentClaims =
          targetUser.customClaims || {};

        const newClaims = {
          ...currentClaims,
          role: role,
        };

        /*
         * Add/remove teamId claim.
         */
        if (role === "team_leader") {
          newClaims.teamId =
            teamId;
        } else {
          delete newClaims.teamId;
        }

        /*
         * Update Firebase Auth custom claims.
         */
        await auth.setCustomUserClaims(
            uid,
            newClaims,
        );

        /*
         * Mirror role/teamId into Firestore
         * for frontend display.
         */
        const userRef = db
            .collection("users")
            .doc(uid);

        const profileUpdate = {
          role: role,
          updatedAt:
            FieldValue.serverTimestamp(),
        };

        if (role === "team_leader") {
          profileUpdate.teamId =
            teamId;
        } else {
          profileUpdate.teamId =
            FieldValue.delete();
        }

        await userRef.set(
            profileUpdate,
            {
              merge: true,
            },
        );

        return {
          ok: true,
          uid: uid,
          role: role,
          teamId:
            role === "team_leader" ?
              teamId :
              null,
        };
      } catch (error) {
        console.error(
            "setUserAccess failed:",
            error,
        );

        if (
          error &&
          error.code ===
            "auth/user-not-found"
        ) {
          throw new HttpsError(
              "not-found",
              "Target user does not exist.",
          );
        }

        throw new HttpsError(
            "internal",
            "Failed to update user access.",
        );
      }
    },
);


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
