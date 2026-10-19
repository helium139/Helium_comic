import { serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Only trusted provisioning may assign staff roles/teamId. Never spread user input.
export function createDefaultProfile(user) {
    return {
        name: user.displayName,
        email: user.email,
        avatar: user.photoURL || "/assets/images/helium_logo.webp",
        createdAt: serverTimestamp(),
        role: "user",
        likes: [],
        follows: [],
        history: []
    };
}

export function resolveStaffContext(uid, profile) {
    const role = profile?.role || "user";
    if (!["admin", "team_leader"].includes(role)) throw new Error("Staff access required");
    if (role === "team_leader" && (typeof profile.teamId !== "string" || !profile.teamId)) {
        throw new Error("Team leader has no assigned team");
    }
    return Object.freeze({ uid, role, teamId: profile.teamId || null });
}
