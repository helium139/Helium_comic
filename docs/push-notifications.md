# Chapter push retired

Chapter subscriptions, permission prompts, FCM callers and sender are removed.
Discord chapter delivery remains separate and unchanged.

`firebase-messaging-sw.js` and `assets/js/notifications.js` are retirement
compatibility files for cached clients, not notification implementations. Keep
them through a client-update window: a404 alone does not retire installed workers.
Cleanup matches the exact script URL and known push scopes and checks all lifecycle
slots. `/sw.js`, PWA/cache workers and unknown replacements are preserved.

Browser permission can remain granted in browser settings; the site no longer
requests or uses it. Offline clients receive retirement on next online visit/update.
Auth storage, profiles, follows, comments and view records are preserved.
Remaining `users/*/pushTokens/*` need separately approved bounded cleanup.
