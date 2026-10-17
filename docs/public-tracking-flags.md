# Public tracking flag (isolated candidate; not installed)

## Problem
The published master page imports `getAllSettings` from `backend/settings`. That function is a plain export, not a webMethod. In the published bundle the import compiles to an empty module, so the call throws, the error is swallowed, and suspension resolves to `false` (fail-open). Verified for the published master bundle only.

## Server: `backend/publicFlags.web.js`
- One export: `getPublicTrackingFlags = webMethod(Permissions.Anyone, async () => …)`.
  - No parameters.
  - No webMethod options, so no cache.
- Read: `query('Settings').eq('key','suspendGoogleAds').limit(2).find({ suppressAuth: true, consistentRead: true })`.
  - Raced against a 2500 ms server timeout.
  - Never returns the dictionary, raw values or error text.
- Response is exactly `{ ok, suspendGoogleAds }`:
  - string `'0'`, or number `0` → `{ ok: true, suspendGoogleAds: false }`;
  - string `'1'`, or number `1` → `{ ok: true, suspendGoogleAds: true }`;
  - strings are trimmed first;
  - anything else → `{ ok: false, suspendGoogleAds: true }`. That covers missing, duplicate, wrong key, null/undefined, boolean, NaN/Infinity, other numbers or strings, objects/arrays, read error and timeout.

## Client: `public/tracking.js`
- The initial state is a NON-DESTRUCTIVE hold. While held:
  - `pushDataLayer` (and so every `track*`) drops the event;
  - the Ads form path returns 0;
  - `waitForClickAttribution` performs no open/read/confirm/erase;
  - `getStoredClickIds` returns null;
  - storage is never written.
- Entering the hold is synchronous at the start of every `resolveTrackingFlags` call, even if tracking was already enabled. It also happens on ok:false, malformed results, rejection and timeout. Entering the hold:
  - fences in-flight work non-destructively: `fenceAttribution()` cancels any late readiness wake and bumps the attribution revision, so an already-running readiness cannot store or admit after its awaits (the existing B2/B4 checks);
  - drops any pending Ads-form continuation;
  - does NOT revoke, erase, close the partition or infer consent. Consent revoke and clears are exempt.
  - Pre-hold snapshots are therefore stale and are never revived. A fresh readiness after release re-admits from the Head. A clear scoped to a pre-hold snapshot is a stale-epoch no-op (existing B4 rule); an unscoped `clearClickIds()` still erases while held.
- `resolveTrackingFlags(getter)` uses a bounded timeout, `TRACKING_FLAG_TIMEOUT_MS = 3000`.
  - Enable: only an exactly-shaped `{ ok: true, suspendGoogleAds: false }` from the CURRENT generation enables.
  - Suspend: a valid `{ ok: true, suspendGoogleAds: true }` from ANY generation suspends. It uses the existing destructive `setSuspendGoogleAds(true)` and is sticky for the module instance; there is no re-enable this session.
  - Hold: `ok: false`, a malformed result, a rejection, a sync throw, a non-function getter or a timeout keeps or returns the hold.
  - A response arriving after its own timeout is ignored entirely.
- The legacy `setSuspendGoogleAds(false)` never releases the hold and never re-enables after a flag suspension.

## Adapters
- `masterPage.js`: binds `initTracking`, `initClickAttribution` and the consent observer BEFORE awaiting the flag. Readiness and capture run only when the result is `enabled`.
- `page-booking-search.js`: `initTracking`, then the bounded flag resolution, then the existing `captureClickIds()`. Nothing else on the page changed.
- `page-booking-summary.js`:
  - flag resolution starts at `initTracking`;
  - the click path awaits that bounded result before attribution readiness;
  - the `getAllSettings` read and the fee/tax display rates are UNCHANGED (out of scope);
  - the dictionary `suspendGoogleAds` read was removed.

## Timeout defaults and reasoning
- Client: 3000 ms.
  - The worst case is a held page, which loses measurement but never erases anything.
  - It is short enough that late responses do not change state after the page has moved on.
  - It is long enough for an ordinary webMethod round trip. Cold-start latency on the platform is unmeasured, so it needs a staging observation.
- Server: 2500 ms. It sits below the client timeout so the server's own fail-safe answer can arrive first.

## Scope and limits
- This controls only consumers wired through `public/tracking.js`. It does NOT stop:
  - independently loaded Head/custom-code Google tags;
  - other third-party tags;
  - server-side conversion uploads.
- It is not deployment containment.
- PER-COPY ONLY (no global or page-session claim): master and page bundles each embed their own copy of the public modules (as observed in the published master bundle). Each copy starts held and resolves independently. Stickiness, generation and hold apply per copy, and nothing coordinates a suspension across copies or page loads.
- UNRESOLVED ACCEPTANCE BLOCKER (initial-hold withdrawal): when consent is withdrawn while a copy is held and has never bound a channel, the Head cannot notify the worker. The worker's prior-session copy remains, unreadable by every wired consumer, until a later readiness after release erases it. If no enabled load follows, it is retained indefinitely. This does NOT meet "withdrawal while held erases". No hook is implemented here. A candidate-local option (erase the worker copy on a Wix consentPolicy change to denied advertising/analytics, erase-only, with no grant inference and no Head/protocol change) is possible, but it depends on the Wix consentPolicy signal matching the Head's consent source, which cannot be verified offline. It needs a decision.
- Published behavior of the new getter is unverified. After a staging build, check statically that the bundle's module for `backend/publicFlags.web.js` is a `getJSON` proxy and not an empty stub.
