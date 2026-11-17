// Release tooling only. Never serializes credentials or changes grants.
const CMS = 'https://helium-cms.mylengoctra06.workers.dev';
const PROJECT = 'helium-team-d7f80';

export class StaffBrowserSession {
    #sessions = new Map();
    #fetch;
    constructor(fetchImpl = fetch) { this.#fetch = fetchImpl; }
    capture(label, result, expectedUid) {
        if (!['admin', 'owner', 'test'].includes(label) || !expectedUid ||
            result?.uid !== expectedUid || typeof result?.token !== 'string') {
            throw Error('Session identity mismatch');
        }
        let claims;
        try { claims = JSON.parse(Buffer.from(result.token.split('.')[1], 'base64url')); }
        catch { throw Error('Invalid session envelope'); }
        if (claims.sub !== expectedUid || claims.aud !== PROJECT ||
            claims.iss !== `https://securetoken.google.com/${PROJECT}` ||
            !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) {
            throw Error('Session project or expiry mismatch');
        }
        // These decoded fields are display metadata, NOT token verification.
        // Firebase SDK obtained the token; production guards remain authoritative.
        const old = this.#sessions.get(label)?.old;
        this.#sessions.set(label, {current: result.token, old, uid: expectedUid,
            role: claims.role, version: claims.accessVersion});
        return {label, uid: expectedUid, role: claims.role || 'user',
            teamId: claims.teamId || null, accessVersion: claims.accessVersion ?? null,
            expiresAt: new Date(claims.exp * 1000).toISOString()};
    }
    freezeTest() {
        const session = this.#sessions.get('test');
        if (!session) throw Error('Test session required');
        if (session.role !== 'team_leader' || !Number.isSafeInteger(session.version) || session.version < 1) {
            throw Error('Freeze only an active versioned leader session after bootstrap');
        }
        if (session.old) throw Error('Old test session already frozen');
        session.old = session.current;
        return {label: 'test', frozen: true};
    }
    async probe(label, old = false) {
        const session = this.#sessions.get(label);
        if (old && label !== 'test') throw Error('Only test sessions may be replayed');
        const token = old ? session?.old : session?.current;
        if (!token) throw Error('Requested session unavailable');
        // Intentionally invalid upload: no file, folder, manga or chapter is sent.
        // Authentication executes first; validation MUST reject before any write.
        let response;
        try {
            response = await this.#fetch(`${CMS}/upload`, {method: 'POST',
                headers: {Authorization: `Bearer ${token}`, Origin: 'https://heliumtg.com',
                    'Content-Type': 'application/json'}, body: '{}', redirect: 'error',
                signal: AbortSignal.timeout(15000)});
            await response.body?.cancel();
        } catch {
            // Never propagate fetch/CDP/raw error messages carrying credentials.
            return {label, old, outcome: 'transport-error', http: null};
        }
        return {label, old, http: response.status,
            outcome: response.status === 403 ? 'access-denied' :
                response.status === 401 ? 'unauthenticated' :
                response.status === 400 || response.status === 415 ? 'invalid-payload-rejected' :
                'unexpected-status'};
    }
    clear() { this.#sessions.clear(); }
    toJSON() { return {credentials: 'memory-only', sessions: this.#sessions.size}; }
}
