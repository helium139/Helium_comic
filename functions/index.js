const {
  onRequest,
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const {
  defineSecret,
} = require("firebase-functions/params");

const {
  initializeApp,
} = require("firebase-admin/app");

const {
  getAuth,
} = require("firebase-admin/auth");

const {
  getFirestore,
  FieldValue,
} = require("firebase-admin/firestore");

const {
  getMessaging,
} = require("firebase-admin/messaging");

const crypto = require("crypto");


/*
 * =========================================================
 * Firebase initialization
 * =========================================================
 */

initializeApp();

const db = getFirestore();

const REGION = "us-central1";

const chapterNotifySecret =
  defineSecret("CHAPTER_NOTIFY_SECRET");

const ALLOWED_ROLES = [
  "user",
  "admin",
  "team_leader",
];


/*
 * =========================================================
 * Helpers
 * =========================================================
 */

/**
 * Hash an FCM token using SHA-256.
 *
 * @param {string} token FCM registration token.
 * @return {string} SHA-256 hash.
 */
function hashToken(token) {
  return crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
}


/**
 * Check whether a value is a valid HTTPS URL string.
 *
 * @param {*} value Value to validate.
 * @return {boolean} True when value uses HTTPS.
 */
function isHttpsUrl(value) {
  return (
    typeof value === "string" &&
    value.startsWith("https://")
  );
}


/**
 * Check whether a role is supported.
 *
 * @param {string} role User role.
 * @return {boolean} True when the role is supported.
 */
function isAllowedRole(role) {
  return ALLOWED_ROLES.includes(role);
}

/*
 * =========================================================
 * health
 * =========================================================
 */

exports.health = onRequest(
    {
      region: REGION,
    },
    (req, res) => {
      res.status(200).json({
        ok: true,
        service: "HeliumTG Backend",
      });
    },
);


/*
 * =========================================================
 * registerPushToken
 * =========================================================
 */

exports.registerPushToken = onCall(
    {
      region: REGION,
    },
    async (request) => {
      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "You must be logged in.",
        );
      }

      const token =
        request.data &&
        request.data.token;

      if (
        !token ||
        typeof token !== "string"
      ) {
        throw new HttpsError(
            "invalid-argument",
            "A valid FCM token is required.",
        );
      }

      const uid =
        request.auth.uid;

      const tokenId =
        hashToken(token);

      const tokenRef = db
          .collection("users")
          .doc(uid)
          .collection("pushTokens")
          .doc(tokenId);

      const existing =
        await tokenRef.get();

      const tokenData = {
        token: token,
        enabled: true,
        updatedAt:
          FieldValue.serverTimestamp(),
      };

      if (!existing.exists) {
        tokenData.createdAt =
          FieldValue.serverTimestamp();
      }

      await tokenRef.set(
          tokenData,
          {
            merge: true,
          },
      );

      return {
        ok: true,
      };
    },
);


/*
 * =========================================================
 * unregisterPushToken
 * =========================================================
 */

exports.unregisterPushToken = onCall(
    {
      region: REGION,
    },
    async (request) => {
      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "You must be logged in.",
        );
      }

      const token =
        request.data &&
        request.data.token;

      if (
        !token ||
        typeof token !== "string"
      ) {
        throw new HttpsError(
            "invalid-argument",
            "A valid FCM token is required.",
        );
      }

      const uid =
        request.auth.uid;

      const tokenId =
        hashToken(token);

      await db
          .collection("users")
          .doc(uid)
          .collection("pushTokens")
          .doc(tokenId)
          .delete();

      return {
        ok: true,
      };
    },
);


/*
 * =========================================================
 * setUserAccess
 * =========================================================
 *
 * ADMIN ONLY
 *
 * Used to assign:
 *
 * user
 * admin
 * team_leader
 *
 * Example:
 *
 * {
 *   uid: "...",
 *   role: "team_leader",
 *   teamId: "heliumtg"
 * }
 *
 * Authorization comes from Firebase Auth custom claims.
 * NOT from Firestore users/{uid}.role.
 */

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


/*
 * =========================================================
 * notifyNewChapter
 * =========================================================
 */

exports.notifyNewChapter = onRequest(
    {
      region: REGION,
      secrets: [
        chapterNotifySecret,
      ],
    },
    async (req, res) => {
      /*
       * POST only.
       */
      if (req.method !== "POST") {
        res.status(405).json({
          error: "Method not allowed",
        });

        return;
      }

      /*
       * Validate GitHub / backend secret.
       */
      const providedSecret =
        req.get("x-helium-secret");

      if (
        !providedSecret ||
        providedSecret !==
          chapterNotifySecret.value()
      ) {
        res.status(401).json({
          error: "Unauthorized",
        });

        return;
      }

      const body =
        req.body || {};

      const mangaSlug =
        body.mangaSlug;

      const mangaTitle =
        body.mangaTitle;

      const chapterTitle =
        body.chapterTitle;

      const url =
        body.url;

      const cover =
        body.cover;

      /*
       * Validate required fields.
       */
      if (
        !mangaSlug ||
        !mangaTitle ||
        !chapterTitle ||
        !url
      ) {
        res.status(400).json({
          error:
            "Missing required fields",
        });

        return;
      }

      /*
       * Validate types.
       */
      if (
        typeof mangaSlug !== "string" ||
        typeof mangaTitle !== "string" ||
        typeof chapterTitle !== "string" ||
        typeof url !== "string"
      ) {
        res.status(400).json({
          error:
            "Invalid field types",
        });

        return;
      }

      /*
       * Require HTTPS chapter URL.
       */
      if (!isHttpsUrl(url)) {
        res.status(400).json({
          error:
            "Chapter URL must use HTTPS",
        });

        return;
      }

      /*
       * Cover optional,
       * but HTTPS only.
       */
      if (
        cover &&
        !isHttpsUrl(cover)
      ) {
        res.status(400).json({
          error:
            "Cover URL must use HTTPS",
        });

        return;
      }

      try {
        /*
         * Find followers.
         */
        const followersSnapshot =
          await db
              .collection("users")
              .where(
                  "follows",
                  "array-contains",
                  mangaSlug,
              )
              .get();

        const tokenMap =
          new Map();

        /*
         * Collect enabled FCM tokens.
         */
        for (
          const userDoc
          of followersSnapshot.docs
        ) {
          const tokenSnapshot =
            await userDoc.ref
                .collection("pushTokens")
                .where(
                    "enabled",
                    "==",
                    true,
                )
                .get();

          for (
            const tokenDoc
            of tokenSnapshot.docs
          ) {
            const tokenData =
              tokenDoc.data();

            if (
              tokenData.token &&
              typeof tokenData.token ===
                "string"
            ) {
              tokenMap.set(
                  tokenData.token,
                  {
                    ref:
                      tokenDoc.ref,
                  },
              );
            }
          }
        }

        const tokens =
          Array.from(
              tokenMap.keys(),
          );

        /*
         * Nothing to send.
         */
        if (
          tokens.length === 0
        ) {
          res.status(200).json({
            ok: true,
            mangaSlug: mangaSlug,
            followers:
              followersSnapshot.size,
            tokens: 0,
            successCount: 0,
            failureCount: 0,
            removedInvalidTokens: 0,
          });

          return;
        }

        let successCount = 0;
        let failureCount = 0;
        let removedInvalidTokens = 0;

        /*
         * FCM max:
         * 500 tokens per multicast.
         */
        for (
          let i = 0;
          i < tokens.length;
          i += 500
        ) {
          const batch =
            tokens.slice(
                i,
                i + 500,
            );

          const message = {
            tokens: batch,

            notification: {
              title:
                mangaTitle +
                " có chương mới!",

              body:
                chapterTitle +
                " đã được đăng trên HeliumTG.",
            },

            data: {
              mangaSlug:
                mangaSlug,

              mangaTitle:
                mangaTitle,

              chapterTitle:
                chapterTitle,

              url:
                url,

              cover:
                cover || "",
            },

            webpush: {
              notification: {
                icon:
                  "https://heliumtg.com/" +
                  "assets/icons/icon-192.png",
              },

              fcmOptions: {
                link:
                  url,
              },
            },
          };

          /*
           * Large manga cover.
           */
          if (cover) {
            message.notification.imageUrl =
              cover;

            message.webpush
                .notification
                .image =
              cover;
          }

          /*
           * Send notifications.
           */
          const result =
            await getMessaging()
                .sendEachForMulticast(
                    message,
                );

          successCount +=
            result.successCount;

          failureCount +=
            result.failureCount;

          /*
           * Remove invalid FCM tokens.
           */
          for (
            let j = 0;
            j <
              result.responses.length;
            j++
          ) {
            const response =
              result.responses[j];

            if (
              response.success
            ) {
              continue;
            }

            const errorCode =
              response.error &&
              response.error.code;

            const shouldDelete =
              errorCode ===
                "messaging/" +
                "registration-token-not-registered" ||
              errorCode ===
                "messaging/" +
                "invalid-registration-token";

            if (!shouldDelete) {
              continue;
            }

            const failedToken =
              batch[j];

            const tokenInfo =
              tokenMap.get(
                  failedToken,
              );

            if (
              tokenInfo &&
              tokenInfo.ref
            ) {
              try {
                await tokenInfo.ref
                    .delete();

                removedInvalidTokens++;
              } catch (deleteError) {
                console.error(
                    "Failed deleting invalid token:",
                    deleteError,
                );
              }
            }
          }
        }

        /*
         * Final response.
         */
        res.status(200).json({
          ok: true,
          mangaSlug: mangaSlug,
          followers:
            followersSnapshot.size,
          tokens:
            tokens.length,
          successCount:
            successCount,
          failureCount:
            failureCount,
          removedInvalidTokens:
            removedInvalidTokens,
        });
      } catch (error) {
        console.error(
            "notifyNewChapter failed:",
            error,
        );

        res.status(500).json({
          ok: false,
          error:
            "Internal server error",
        });
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
