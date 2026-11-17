import {FIREBASE_PROJECT} from "./firebase-auth.js";
import {matchesAccess} from "../../functions/lib/access/policy.mjs";
import {fail} from "./cms-authorization.js";

// No OAuth credentials, permission cache, retry, registry download or user-controlled host.
export async function verifyCurrentAccess(actor, token, fetchImpl = fetch) {
    if (!Number.isSafeInteger(actor.accessVersion) || actor.accessVersion < 1) fail(403, "Access refresh required");
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/staffAccess/${encodeURIComponent(actor.uid)}`;
    let response, data;
    try {
        response = await fetchImpl(url, {headers: {Authorization: `Bearer ${token}`, "Cache-Control": "no-store"},
            redirect: "error", signal: AbortSignal.timeout(5000)});
        if ([401, 403, 404].includes(response.status)) fail(403, "Access changed or unavailable");
        if (!response.ok) fail(503, "Access verification unavailable");
        const reader = response.body.getReader(); const chunks = []; let bytes = 0;
        try {
            while (true) {
                const part = await reader.read(); if (part.done) break;
                bytes += part.value.byteLength;
                if (bytes > 8192) { await reader.cancel(); fail(503, "Invalid access response"); }
                chunks.push(part.value);
            }
        } finally { reader.releaseLock(); }
        const joined = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
        data = JSON.parse(new TextDecoder().decode(joined));
    } catch (error) {
        if (error?.status) throw error;
        fail(503, "Access verification unavailable");
    }
    const f = data.fields || {};
    const current = {state: f.state?.stringValue, role: f.role?.stringValue,
        teamId: f.teamId?.stringValue || null, version: Number(f.version?.integerValue)};
    if (!matchesAccess(actor, current)) fail(403, "Access changed or synchronization pending");
}
