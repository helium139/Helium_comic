import { auth } from "./firebase-session.js";
import { getStaffContext } from "./staff-access.js";

let navigationVersion = 0;

export function clearStaffNavigation() {
    ++navigationVersion;
    document.getElementById("staff-nav-link")?.remove();
    document.getElementById("staff-access-status")?.remove();
}

export async function updateStaffNavigation(user, profile) {
    const version = navigationVersion;
    const navigation = document.querySelector(".navigation");
    if (!navigation || !user) return;
    try {
        await getStaffContext(user, profile);
        if (version !== navigationVersion || auth.currentUser !== user) return;
        const link = document.createElement("a");
        link.id = "staff-nav-link";
        link.href = "/admin/";
        link.textContent = "Admin / Dashboard";
        clearStaffNavigation();
        navigation.appendChild(link);
    } catch (error) {
        if (version !== navigationVersion || auth.currentUser !== user || error.code === "staff/forbidden") return;
        const status = document.createElement("span");
        status.id = "staff-access-status";
        status.setAttribute("role", "status");
        status.textContent = error.message;
        clearStaffNavigation();
        navigation.appendChild(status);
    }
}
