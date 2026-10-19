// Explicit operator action only; never imported by deployed functions or CI.
import {initializeApp} from "firebase-admin/app";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {DEFAULT_POLICY} from "./policy.mjs";
const projectId = process.env.GCLOUD_PROJECT;
if (process.argv[2] !== "--activate" || projectId !== "helium-team-d7f80") {
  throw new Error("Set GCLOUD_PROJECT=helium-team-d7f80 and pass --activate after rules/App Check staging validation");
}
initializeApp({projectId});
const db = getFirestore();
await db.runTransaction(async (tx) => {
  const ref = db.doc("viewSystem/config");
  const previous = await tx.get(ref);
  if (previous.exists) throw new Error("Activation config already exists; do not reset the accounting epoch");
  const {readerHourlyLimit, networkHourlyLimit, readerSessionHourlyLimit, networkSessionHourlyLimit, policyVersion} = DEFAULT_POLICY;
  tx.create(ref, {enabled: true, activationAt: FieldValue.serverTimestamp(),
    readerHourlyLimit, networkHourlyLimit, readerSessionHourlyLimit, networkSessionHourlyLimit, policyVersion});
});
console.log("Valid-view activation recorded using a server timestamp. Legacy counts were not imported.");
