// One state machine per reader page. Timers only wake it; elapsed time comes from visible intervals.
export function createActiveViewSession({ doc, win, now, wallNow, schedule, cancel, start, record,
    makeRequestId, onError = () => {} }) {
    let identityKnown = false, identity, ready = false, suspended = false, disposed = false;
    let generation = 0, requestId, session, activeMs = 0, visibleSince = null;
    let timer = null, busy = false, done = false, failures = 0;
    const visible = () => !suspended && doc.visibilityState === 'visible';
    const clearTimer = () => { if (timer !== null) cancel(timer); timer = null; };
    function accumulate() {
        if (visibleSince !== null) activeMs += Math.max(0, now() - visibleSince);
        visibleSince = session && visible() && !done ? now() : null;
    }
    function retryable(error) {
        return ['functions/unavailable', 'functions/internal', 'functions/deadline-exceeded', 'functions/resource-exhausted',
            'unavailable', 'internal', 'deadline-exceeded', 'resource-exhausted'].includes(error?.code) || error instanceof TypeError;
    }
    function arm(delay) {
        clearTimer();
        if (!disposed && !done && visible()) timer = schedule(() => { timer = null; pump(); }, Math.max(0, delay));
    }
    async function pump() {
        if (disposed || done || busy || !ready || !identityKnown || !visible()) return;
        accumulate();
        const version = generation;
        busy = true;
        try {
            if (!session) {
                const created = await start({ requestId });
                if (version !== generation || disposed) return;
                session = created;
                activeMs = 0;
                visibleSince = visible() ? now() : null;
                failures = 0;
                arm(session.minimumActiveMs || 10000);
            } else if (activeMs >= (session.minimumActiveMs || 10000)) {
                const outcome = await record({ sessionId: session.sessionId });
                if (version !== generation || disposed) return;
                if (outcome && typeof outcome.accepted === 'boolean') {
                    done = true; visibleSince = null; clearTimer();
                } else throw new TypeError('Invalid view response');
            } else if (wallNow() >= session.expiresAt) {
                session = null; activeMs = 0; visibleSince = null; requestId = makeRequestId(); arm(0);
            } else arm((session.minimumActiveMs || 10000) - activeMs);
        } catch (error) {
            if (version !== generation || disposed) return;
            if (session && /deadline-exceeded$/.test(error?.code || '') && wallNow() >= session.expiresAt) {
                session = null; activeMs = 0; visibleSince = null; requestId = makeRequestId(); arm(0);
            } else if (retryable(error)) arm(Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)));
            else { done = true; clearTimer(); visibleSince = null; onError(error); }
        } finally {
            if (version === generation) busy = false;
        }
    }
    function visibilityChanged() {
        accumulate(); clearTimer();
        if (visible() && !busy) pump();
    }
    function pagehide(event) {
        accumulate(); suspended = true; visibleSince = null; clearTimer();
        if (!event.persisted) dispose();
    }
    function pageshow(event) {
        if (!event.persisted || disposed) return;
        suspended = false; visibleSince = session && visible() ? now() : null; pump();
    }
    function dispose() {
        disposed = true; ++generation; clearTimer();
        doc.removeEventListener('visibilitychange', visibilityChanged);
        win.removeEventListener('pagehide', pagehide);
        win.removeEventListener('pageshow', pageshow);
    }
    doc.addEventListener('visibilitychange', visibilityChanged);
    win.addEventListener('pagehide', pagehide);
    win.addEventListener('pageshow', pageshow);
    return {
        ready() { if (!ready) { ready = true; pump(); } },
        setIdentity(uid) {
            if (identityKnown && uid === identity) return;
            identityKnown = true; identity = uid; ++generation;
            session = null; activeMs = 0; visibleSince = null; busy = false; done = false; failures = 0;
            requestId = makeRequestId(); clearTimer(); pump();
        },
        dispose
    };
}
