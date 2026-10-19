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
const teamId = process.argv[3];

if (!uid || !teamId) {
  console.error(
      "Usage: node scripts/set-team-leader.js <UID> <TEAM_ID>",
  );
  process.exit(1);
}

/**
 * Set a test Team Leader.
 *
 * @return {Promise<void>}
 */
async function main() {
  const auth = getAuth();
  const db = getFirestore();

  const user = await auth.getUser(uid);

  await auth.setCustomUserClaims(
      uid,
      {
        ...(user.customClaims || {}),
        role: "team_leader",
        teamId: teamId,
      },
  );

  await db
      .collection("users")
      .doc(uid)
      .set(
          {
            role: "team_leader",
            teamId: teamId,
            updatedAt:
              FieldValue.serverTimestamp(),
          },
          {
            merge: true,
          },
      );

  console.log(
      "Team leader access applied:",
      uid,
      teamId,
  );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
