import { createRemoteJWKSet, jwtVerify } from "jose";

export const FIREBASE_PROJECT = "helium-team-d7f80";
// Google's JWK representation of the Firebase securetoken signing certificates.
const signingKeys = createRemoteJWKSet(new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
));

export async function verifyFirebaseToken(token, keys = signingKeys) {
    const { payload, protectedHeader } = await jwtVerify(token, keys, {
        algorithms: ["RS256"],
        issuer: `https://securetoken.google.com/${FIREBASE_PROJECT}`,
        audience: FIREBASE_PROJECT,
        requiredClaims: ["sub", "exp", "iat", "auth_time"],
        clockTolerance: 0
    });
    const now = Math.floor(Date.now() / 1000);
    if (typeof protectedHeader.kid !== "string" || !protectedHeader.kid ||
        payload.aud !== FIREBASE_PROJECT ||
        typeof payload.sub !== "string" || !payload.sub.trim() || payload.sub.length > 128 ||
        !Number.isFinite(payload.iat) || payload.iat < 0 || payload.iat > now ||
        !Number.isFinite(payload.auth_time) || payload.auth_time < 0 || payload.auth_time > now ||
        payload.auth_time > payload.iat || payload.exp <= payload.iat) {
        throw new Error("Invalid Firebase ID token claims");
    }
    // Only verified identity/authorization claims leave this module.
    return Object.freeze({ uid: payload.sub, role: payload.role, teamId: payload.teamId });
}
