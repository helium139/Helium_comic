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

export function resolveStaffContext(uid, profile, claims) {
    const staffRoles = ["admin", "team_leader"];
    const role = claims?.role || "user";
    const profileRole = profile?.role || "user";
    const deny = (code, message) => {
        const error = new Error(message);
        error.code = code;
        throw error;
    };
    const stale = () => deny("staff/stale-token",
        "Quyền trong hồ sơ và Firebase token không khớp. Hãy làm mới token hoặc đăng xuất rồi đăng nhập lại. Nếu vẫn lỗi, liên hệ quản trị viên.");
    if (role !== profileRole && (staffRoles.includes(role) || staffRoles.includes(profileRole))) stale();
    if (!staffRoles.includes(role)) deny("staff/forbidden", "Staff access required");
    if (role === "team_leader") {
        if (typeof claims.teamId !== "string" || !claims.teamId.trim()) {
            if (profile?.teamId) stale();
            deny("staff/team-required", "Team leader chưa được gán teamId. Vui lòng liên hệ quản trị viên.");
        }
        if (profile?.teamId !== claims.teamId) stale();
    }
    return Object.freeze({ uid, role, teamId: typeof claims.teamId === "string" ? claims.teamId : null });
}
