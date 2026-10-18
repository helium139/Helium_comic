# Firebase audit and conservative optimization

Audit date: 2026-10-18. Scope: all workspace source and generated HTML entry points, public modules, admin modules/API wrappers, scripts, workflow and service worker. No production requests were issued. No deployed rules, emulator configuration, Firebase deployment configuration or backend implementation is present. No commits or pushes were made.

## Baseline request inventory

Paths below are relative to `assets/js/`. Each callback runs initially after Auth restoration and again when authentication changes. Navigation uses full document loads; there is no SPA mount/rerender cycle, popstate data loader, Firebase timer or scroll request. Generated routes import the same modules as their source templates. ES module imports already deduplicate initialization within a document.

| File / function | Service / resource | Operation | Trigger and frequency | Assessment |
| --- | --- | --- | --- | --- |
| firebase.js / module | App / Firestore | initializeApp, getFirestore | Once per document importing Firebase | Already one shared app; config unchanged |
| auth.js / auth callback | Auth, users/{uid} | onAuthStateChanged, getDoc, setDoc if missing | Initial signed-in state and login changes; at most one profile creation per callback | Profile reads overlap page loaders; missing profile creation can race other tabs |
| auth.js / logout handler | Auth | signOut | Each logout click, then reload | Preserved |
| authGuard.js / requireLogin | Auth | onAuthStateChanged | Each call registers another redirect callback | Redundant with follow/history/user callbacks |
| adminGuard.js / requireAdmin | Auth, users/{uid} | onAuthStateChanged and getDoc role | Initial auth and every later signed-in state; each requireAdmin call | Promise settles once but observer remains; role checking retained on auth changes |
| comicpage.js / updateView | Firestore mangaStats/{mangaId} | getDoc then setDoc defaults OR updateDoc views increment(1) | After static JSON resolves; skipped if viewed-{mangaId} is in localStorage | Extra existence read; missing document set can overwrite a concurrent creation |
| comicchap.js / updateChapterView | Same stats document | getDoc then setDoc defaults OR updateDoc increment(1) | Module load; skipped for viewed-{mangaId}-{chapterId} | Same creation race; suppression persists across sessions and refreshes |
| comicpage.js / loadStats | Same stats document | getDoc | After static JSON resolves and after each successful like/follow click | Runs concurrently with view write; may initially show old views |
| comicpage.js / setupLikeButton | Firestore users/{uid} | getDoc | Signed-in auth callback | Duplicates follow setup and header |
| comicpage.js / setupFollowButton | Same user document | getDoc | After like setup | Sequential duplicate read |
| comicpage.js / toggleLike | Stats + users/{uid} | Two updateDoc operations: likes increment and likes arrayUnion/arrayRemove | Click, guarded by likeBusy | Two writes + subsequent stats read; independent writes risk partial success; stale cross-tab state risks incorrect counts |
| comicpage.js / toggleFollow | Stats + users/{uid} | Two updateDoc operations: follows increment and follows arrayUnion/arrayRemove | Click, guarded by followBusy | Same risks; not a collection scan |
| comicchap.js / saveHistory | users/{uid}/history/{mangaId} | setDoc with chapter and serverTimestamp | Signed-in auth callback on every chapter document load | Refresh intentionally updates recency; preserved |
| comment.js / sendComment | users/{uid} | getDoc | Once per accepted submission | Fresh author lookup; busy flag covers click and Enter |
| comment.js / sendComment | comments/{mangaId}/messages | addDoc with embedded author, content and timestamp | Once per accepted submission | Existing submission guard retained; no custom retries |
| comment.js / module/startComments | Same messages collection | query orderBy createdAt desc, onSnapshot | Manga page load; live changes thereafter | Entire thread, no limit; unsubscribe discarded originally |
| follow.js / auth callback | users/{uid} | getDoc | Signed-in auth callback | Duplicates header profile; followed manga metadata is static JSON |
| history.js / loadHistory | users/{uid}/history | getDocs entire collection | Signed-in auth callback | All results rendered, sorted locally; unbounded but useful |
| user.js / auth callback | users/{uid} | getDoc | Signed-in auth callback | Duplicates header |
| user.js / auth callback | users/{uid}/history | getDocs entire collection | Signed-in auth callback | Result unused: wasted reads proportional to history size |
| user.js / saveNameBtn | Auth + user document | updateProfile + updateDoc name | Each nonempty save, then reload | Originally wrote unchanged values |
| user.js / saveAvatarBtn | User document | updateDoc avatar | Each save, then reload | Originally wrote unchanged values |
| login.js / click handler | Auth / Google | GoogleAuthProvider, signInWithPopup | Each click | Missing busy guard; successful login logged sensitive user object |
| login.js / click handler | users/{uid} | getDoc; setDoc merge for new profile | After popup succeeds, then redirect home | Preserved creation fields; login page does not load header auth.js |
| script.js / loadHotComics | mangaStats | getDocs(query(orderBy views desc, limit 12)) | Once after static JSON loads | Already bounded, up to 12 documents |

`doc`, `collection`, `query`, `orderBy`, `limit`, `arrayUnion`, `arrayRemove`, `increment`, and `serverTimestamp` construct references/operations; they do not independently make requests. Repeated getAuth(app) calls reused the SDK instance, not separate logins. Auth observer counts do not directly equal billed Firestore reads or HTTP request counts.

No Realtime Database, Firebase Storage API usage, Cloud Functions, direct REST Firebase wrappers, getIdToken, reload, email/password login, Firestore deleteDoc, transactions, writeBatch, where queries, or custom retry loops were found. The configured Storage bucket is not used by these modules. Admin API wrappers call an external Worker for CMS/R2, not Firebase. Its implementation cannot be audited here.

## Priorities and remaining risks

- HIGH / low risk: remove account's unused history query; combine like/follow profile reads; share concurrent profile requests; clean up comments listener on pagehide and restart once on persisted pageshow.
- MEDIUM: share auth dispatch while preserving every consumer's checks; remove redundant protected-page redirect subscribers; prevent duplicate login submissions and unchanged profile saves.
- Deferred: view writes already use atomic increments for existing documents. Replacing existence reads with merge increments would change missing-document defaults and potentially deployed-rule compatibility. Preserve existing suppression and write shape until rules can be validated. Also validate route resources before counting views in a separate correctness change.
- Deferred: transactional likes/follows should read authoritative user membership and atomically change user membership plus stats, avoiding partial success and cross-tab stale toggles. This costs transaction reads and needs deployed-rule/emulator validation. A batch alone would not solve stale membership. Current same-page busy flags remain.
- Optional: comment pagination with explicit load-more, preserving new-message behavior and cursor correctness. Do not silently limit existing content. History pagination likewise requires UI work. No replies feature or comment-author N+1 exists: author data is embedded. Full DOM reconstruction is a rendering cost, not a new read per displayed comment.
- Admin observer remains subscribed through the shared dispatcher intentionally so an auth change still rechecks access. Client guards supplement, never replace, server-side rules. Admin manga/chapter callers do not await requireAdmin; preexisting behavior outside this optimization's scope.

Likely largest production usage: comment initial snapshots/reconnections on large threads; chapter view/history writes under reading traffic; homepage ranking reads. Actual ranking requires production metrics.

## Implemented changes / important diffs

| Files | Before | After | Estimated savings |
| --- | --- | --- | --- |
| firebase-session.js (new); auth.js, comicpage.js, follow.js, user.js | Independent overlapping profile reads | One pending promise per uid; entries removed on success/failure; no settled cache | Manga setup: 2 reads becomes 1, typically shared with header for 3 to 1. Follow/account: typically 2 to 1. Overlap-dependent, not guaranteed |
| comicpage.js | Separate sequential like/follow profile requests | Both consume one snapshot; abandon setup if auth user changed while awaiting | At least 1 profile read per signed-in setup |
| user.js | Read full history and discard | Query removed | H document reads per account load for H history entries; empty queries can still have minimum billing |
| firebase-session.js; auth.js, authGuard.js, adminGuard.js, comicchap.js, comicpage.js, follow.js, history.js, user.js | Multiple native SDK observers | One native observer fans out to page callbacks; callback errors handled separately | Fewer callbacks/registrations; no claimed direct network savings |
| follow.js, history.js, user.js | Guard plus page callback both redirect | Existing page callback retains login enforcement | One redundant subscriber per protected page |
| login.js, comment.js | Each obtained auth instance locally | Import shared auth instance | Consistency; no claimed request savings |
| comment.js | Discarded unsubscribe | Retain handle; idempotent cleanup on pagehide; restart once on bfcache restore | Prevents retained listener work while away; restoring legitimately reads data again |
| login.js | Multiple clicks could start popup flows | Disable and guard while login is pending, reset on failure; remove full user log | Prevent overlapping auth/profile flows; normal path unchanged |
| user.js | Save unchanged profile values | Skip unchanged name/avatar | Up to 1 Firestore write plus 1 Auth update for name; 1 write for avatar, and avoids reload reads |

No persistent profile cache: role, like state and author information are not retained after requests settle. This avoids introducing stale authorization/UI data. No token storage or new production diagnostic logging. No full architectural rewrite, HTML changes, indexes, schemas, Firebase rules or dependency changes. No custom write retries. View counts, comment contents, history ordering/recency, and live comments remain as before. Unchanged saves now return without alert/reload; login button is disabled while pending.

## Verification and limits

Run `node --test scripts/test-firebase-session.mjs`. Isolated mocks verify shared auth dispatch, unsubscribe, late subscriber delivery, in-flight read identity, eviction after success/failure, fresh subsequent reads, comment cleanup, and single listener restoration through bfcache. Syntax-check every JS module with `node --input-type=module --check < file`. `git diff --check` checks whitespace. Tests never contact Firebase.

These are not production/browser/emulator integration tests. Actual security-rule acceptance, Google popup behavior, network savings and browser bfcache behavior require the checks below. SDK HTTP streams can multiplex many logical reads; use Firestore usage metrics alongside DevTools, not HTTP request counts alone.

## Manual checklist

1. Anonymous: open home and manga; ranking/stats/comments display; existing anonymous interactions remain; protected follow/history/account redirect to login.
2. Login: Google popup completes, new and existing profiles work, rapidly click twice, cancel/fail then retry; button recovers and no user/token object appears in console.
3. Logout: header updates/reloads, protected pages redirect on logout/account changes; verify switching accounts never mixes data; admin access still rejects non-admin users.
4. Views: using an appropriate test environment, open an unviewed manga/chapter; verify one increment and localStorage marker after success. Refresh and back/forward must not increment again. Do not clear production suppression markers just to test. Existing missing-document initialization race remains deferred.
5. Like/unlike: verify initial membership and totals; each normal click changes membership and count once; rapid clicks remain guarded. Exercise offline/permission failures. Cross-tab and partial-write consistency remain preexisting risks documented above.
6. Follow/unfollow: same checks; open follow page and verify membership.
7. Comments: compare full thread before/after; submit using click and Enter rapidly; one message is created, errors restore controls; verify author information and updates from a second tab. Replies are not implemented, so no reply requests should appear.
8. Account: name/avatar and counts display; changed saves persist; unchanged values produce no write/reload. History page still displays all history despite account page query removal.
9. Chapter navigation: previous/next/select preserve chapter history and view behavior. Refresh updates reading recency; back/forward returns correct chapter.
10. Comments navigation: leave manga then return using browser Back with bfcache enabled; comments update live again. Repeat several times and confirm one active subscription.
11. DevTools: enable Preserve log, filter `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, and `securetoken.googleapis.com`; compare the same account/route before and after with consistent cache settings. Look for one logical user document read during overlapping header/page startup (not two/three), no account history query, one comments query target, and no extra targets after repeated navigation. Network Listen channels may be reused for SDK-internal purposes; use targets/document names or temporary local breakpoints at getUserSnapshot/getDoc/startComments to count logical operations. Never share raw HAR files containing credentials or private data.
12. Check Console for exceptions, permission errors and failed auth handlers. No new production console.debug logging is added. For billing changes, compare Firestore read/write metrics over equivalent traffic and allow for cache, rule reads, reconnects and SDK retries.
