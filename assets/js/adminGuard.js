import { auth, onAuthStateChanged, getUserSnapshot } from "./firebase-session.js";
import { getStaffContext, showStaffAccessError } from "./staff-access.js";

// Frontend gate; Worker authorization remains authoritative.
export function requireStaff() {
    return new Promise((resolve, reject) => {
        let revision = 0;
        let resolvedContext;
        onAuthStateChanged(auth, async user => {
            const requestRevision = ++revision;
            if (!user) {
                showStaffAccessError(new Error("Login required"));
                location.href = "/login/";
                reject(new Error("Login required"));
                return;
            }
            try {
                const profile = await getUserSnapshot(user.uid);
                const context = await getStaffContext(user, profile.data());
                if (requestRevision !== revision || auth.currentUser !== user) return;
                if (resolvedContext && (resolvedContext.uid !== context.uid ||
                    resolvedContext.role !== context.role || resolvedContext.teamId !== context.teamId)) {
                    showStaffAccessError(new Error("Phiên quản trị đã thay đổi. Đang tải lại phạm vi truy cập…"));
                    location.href = "/admin/";
                    return;
                }
                resolvedContext = context;
                resolve(context);
            } catch (error) {
                if (requestRevision !== revision || auth.currentUser !== user) return;
                showStaffAccessError(error);
                if (error.code === "staff/forbidden") location.href = "/";
                reject(error);
            }
        });
    });
}

// Compatibility name: the existing admin area now accepts both staff roles.
export const requireAdmin = requireStaff;
