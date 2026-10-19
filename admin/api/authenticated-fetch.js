import { auth } from "../../assets/js/firebase-session.js";

const CMS_ORIGIN = "https://helium-cms.mylengoctra06.workers.dev";
const MUTATION_PATHS = new Set([
    "/new-manga", "/edit-manga", "/delete-manga",
    "/new-chapter", "/edit-chapter", "/delete-chapter",
    "/upload", "/rename-images"
]);

export class CmsRequestError extends Error {
    constructor(message, status) {
        super(message);
        this.name = "CmsRequestError";
        this.status = status;
    }
}

// Tokens stay in memory for this request only. Authorization is enforced by the Worker.
export async function authenticatedFetch(path, options = {}) {
    if (!MUTATION_PATHS.has(path)) throw new Error("Unsupported CMS mutation path");
    if (options.method && options.method.toUpperCase() !== "POST") {
        throw new Error("CMS mutations require POST");
    }
    const user = auth.currentUser;
    if (!user) throw new CmsRequestError("Vui lòng đăng nhập để quản lý nội dung.", 401);

    let token;
    try {
        token = await user.getIdToken();
    } catch {
        throw new CmsRequestError("Không thể xác thực phiên đăng nhập. Vui lòng đăng nhập lại.", 401);
    }
    if (!token || auth.currentUser !== user) {
        throw new CmsRequestError("Phiên đăng nhập đã thay đổi. Vui lòng thử lại.", 401);
    }

    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${CMS_ORIGIN}${path}`, {
        ...options,
        method: "POST",
        headers,
        // Mutations must not be replayed or forward credentials through a redirect.
        redirect: "error",
        credentials: "omit"
    });
    if (!response.ok) {
        const fallback = response.status === 401
            ? "Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại."
            : response.status === 403
                ? "Bạn không có quyền thay đổi nội dung này."
                : `CMS request failed (${response.status}).`;
        let message = fallback;
        try {
            const body = await response.json();
            if (typeof body.message === "string" && body.message.trim()) message = body.message;
        } catch { /* CORS proxies and server errors may return non-JSON responses. */ }
        throw new CmsRequestError(message, response.status);
    }
    return response;
}
