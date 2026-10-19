// Server UTC boundaries + monotonic elapsed time; independent of browser timezone/clock skew.
export function createMonthRollover({refresh, doc, win, now, schedule, cancel, wallNow = Date.now}) {
    let timer = null, serverNow = 0, boundary = 0, anchoredAt = 0, wallAt = 0, disposed = false, busy = false;
    const clear = () => { if (timer !== null) cancel(timer); timer = null; };
    const elapsed = () => Math.max(0, now() - anchoredAt, wallNow() - wallAt);
    function arm() {
        clear();
        if (disposed || !boundary || doc.visibilityState !== 'visible') return;
        const remaining = boundary - (serverNow + elapsed());
        timer = schedule(tick, Math.min(60000, Math.max(100, remaining + 50)));
    }
    async function check(force = false) {
        if (disposed || busy || doc.visibilityState !== 'visible' || !boundary) return;
        if (!force && serverNow + elapsed() < boundary) { arm(); return; }
        busy = true;
        try { await refresh(); } finally { busy = false; if (!disposed && doc.visibilityState === 'visible' && timer === null) timer = schedule(tick, 60000); }
    }
    function tick() { timer = null; return check(); }
    function visibility() { clear(); if (doc.visibilityState === 'visible') void check(true); }
    function focus() { clear(); void check(true); }
    function pageshow(event) { if (event.persisted) { clear(); void check(true); } }
    function pagehide(event) { clear(); if (!event.persisted) dispose(); }
    function dispose() {
        disposed = true; clear(); doc.removeEventListener('visibilitychange', visibility);
        win.removeEventListener('pageshow', pageshow); win.removeEventListener('pagehide', pagehide); win.removeEventListener('focus', focus);
    }
    doc.addEventListener('visibilitychange', visibility); win.addEventListener('pageshow', pageshow); win.addEventListener('pagehide', pagehide); win.addEventListener('focus', focus);
    return {sync(result) {serverNow = result.serverNow; boundary = result.nextBoundary; anchoredAt = now(); wallAt = wallNow(); arm();}, dispose};
}
