import { auth, onAuthStateChanged } from "./firebase-session.js";
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { resolveStaffContext } from "./user-profile.js";
import { getTeamById } from "./teams.js";

// UI guard only. Worker authorization must be implemented separately in Phase 1B.
function requireContext(adminOnly) {
    return new Promise((resolve, reject) => {
        onAuthStateChanged(auth, async user => {
            if (!user) {
                location.href = "/login/";
                reject(new Error("Login required"));
                return;
            }
            try {
                const snapshot = await getDoc(doc(db, "users", user.uid));
                const context = resolveStaffContext(user.uid, snapshot.data());
                if (context.role === "team_leader") {
                    const team = await getTeamById(context.teamId);
                    if (!team.active) throw new Error("Assigned team is inactive");
                }
                if (adminOnly && context.role !== "admin") {
                    throw new Error("Team leader management is disabled until Phase 1B");
                }
                if (auth.currentUser?.uid !== user.uid) throw new Error("Authentication changed");
                resolve(context);
            } catch (error) {
                location.href = "/";
                reject(error);
            }
        });
    });
}

export function requireStaff() {
    return requireContext(false);
}

// All existing admin routes keep this stricter guard throughout Phase 1A.
export function requireAdmin() {
    return requireContext(true);
}
