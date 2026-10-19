import { resolveStaffContext } from "./user-profile.js";
import { getTeamById } from "./teams.js";

// Frontend scope only. The Worker independently verifies the token on every mutation.
export async function getStaffContext(user, profile) {
    const result = await user.getIdTokenResult();
    const context = resolveStaffContext(user.uid, profile, result.claims);
    if (context.role === "team_leader") {
        const team = await getTeamById(context.teamId);
        if (!team.active) throw new Error("Nhóm của bạn hiện không hoạt động. Vui lòng liên hệ quản trị viên.");
    }
    return context;
}

export function canManageManga(staff, manga) {
    return !!manga && (staff.role === "admin" ||
        (staff.role === "team_leader" && !!staff.teamId && manga.teamId === staff.teamId));
}

export function assertCanManageManga(staff, manga) {
    if (!canManageManga(staff, manga)) {
        const error = new Error("Permission denied: bạn không có quyền quản lý truyện này.");
        error.code = "staff/permission-denied";
        throw error;
    }
}

export function scopeMangas(staff, catalogue) {
    return Object.fromEntries(Object.entries(catalogue).filter(([, manga]) => canManageManga(staff, manga)));
}

export function showStaffAccessError(error) {
    const container = document.querySelector(".content");
    if (!container) return;
    const heading = document.createElement("h1");
    heading.textContent = "Không thể truy cập quản trị";
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = error.message;
    const link = document.createElement("a");
    link.href = "/";
    link.textContent = "Về trang chủ";
    container.replaceChildren(heading, message, link);
}
