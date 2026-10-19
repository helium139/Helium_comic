const {
  initializeApp,
  applicationDefault,
} = require("firebase-admin/app");

const {
  getAuth,
} = require("firebase-admin/auth");

const {
  getFirestore,
  FieldValue,
} = require("firebase-admin/firestore");

initializeApp({
  credential: applicationDefault(),
  projectId: "helium-team-d7f80",
});

const uid = process.argv[2];

if (!uid) {
  console.error(
      "Usage: node scripts/bootstrap-admin.js <FIREBASE_UID>",
  );

  process.exit(1);
}

/**
 * Bootstrap the first trusted admin account.
 *
 * @return {Promise<void>}
 */
async function main() {
  const auth = getAuth();
  const db = getFirestore();

  const user =
    await auth.getUser(uid);

  const currentClaims =
    user.customClaims || {};

  const newClaims = {
    ...currentClaims,
    role: "admin",
  };

  delete newClaims.teamId;

  await auth.setCustomUserClaims(
      uid,
      newClaims,
  );

  await db
      .collection("users")
      .doc(uid)
      .set(
          {
            role: "admin",
            teamId:
              FieldValue.delete(),
            updatedAt:
              FieldValue.serverTimestamp(),
          },
          {
            merge: true,
          },
      );

  console.log(
      "Admin custom claim applied successfully.",
  );
}

main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(
          "Bootstrap failed:",
          error,
      );

      process.exit(1);
    });
