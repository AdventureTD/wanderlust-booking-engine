# Attribution diagnostic v1 — operator guide (candidate only)

Not deployed. Requires independent review, then separately authorized GitHub delivery and coordinated Wix installation/publication. Do not replay a historical booking to obtain these logs.

## Where to look

In the **published site's browser Developer Tools → Console**, enable Preserve log before navigating, include worker/iframe execution contexts, and filter `ATTR_DIAG`. Head observations originate in the parent page; Public/Summary observations originate in Wix's frontend worker. Preview is not proof of published installation. No browser inspection or hosted installation was performed for this candidate.

**No CMS collection is created or written by these diagnostics.** They are not in BookingSummary, Bookings, Wix backend logs or Google Ads UI. Existing backend attempt/result evidence remains in **Wix CMS → GoogleAdsAttemptJournal**; absence of an ATTEMPT does not independently establish the cause. This change adds no journal entries, endpoint, network requests, retries or provider calls.

Console logs are not durable across tab/browser close; Preserve log only assists navigation in the current debugging session. This cannot retroactively diagnose WC-1041. Do not export the entire legacy console: unrelated existing logs can contain guest/booking data. Retain only objects whose event is `ATTR_DIAG` and exactly the four fields below.

## Exact new schema

`{"event":"ATTR_DIAG","v":1,"stage":"policy","reason":"TIMEOUT"}`

Only event/version/stage/reason, all finite constants. No contact values, hashes, click IDs, URLs, queries, booking references, capabilities, raw errors or raw records. No correlation identifiers. New objects serialize under 180 ASCII bytes. Worker logging is deduplicated by stage/reason for the module lifetime (hard cap 32); Head is at most three distinct reasons per listener lifetime. Summary emits at most one boundary reason per confirmed-cart callback; its existing submission latch remains unchanged. A missing repeated log is not a successful repeated handshake.

| Stage | Reason | Actual observation, not an inferred cause |
|---|---|---|
| policy | TIMEOUT | Existing 500 ms policy timer fired while this epoch remained current. |
| policy | REJECTED | Policy promise rejected before the race settled. Error content discarded. |
| open/read/confirm/clear | TIMEOUT | That request's existing 500 ms response timer fired. **Not proof of frame mismatch or consent denial.** |
| open/read/confirm/clear | REJECTED | Authenticated, schema-accepted response had allowed=false; not automatically a user denial. |
| open/read/confirm/clear | TRANSPORT_ERROR | Existing postMessage invocation threw; no error text retained. |
| open | CRYPTO_UNAVAILABLE | Existing secure-nonce creation returned empty; no fallback added. |
| worker | READY_EMPTY / READY_RECORD | Actual permitted confirm returned no record / valid record stored. Empty is a valid direct visit. |
| head | FRAME_BINDING | The existing exact frame-count/connection/source/origin guard rejected an otherwise schema-valid attribution request. This log alone is not authenticated evidence tying the message to a booking or a particular worker. |
| head | CONSENT_DENIED | Existing stored denial branch was observed. |
| head | WITHDRAWAL | Existing choice(false) transition ran, including explicit negative consent updates and conservative storage-event invalidation. Does **not** prove a human clicked Withdraw at that instant. |
| browser | FINANCIAL_MISSING | Confirmed-cart analytics gate had no valid financial snapshot; no Google invocation. |
| browser | ATTRIBUTION_NULL | Existing currentAttribution() revalidation returned null; no Google invocation. No null-to-empty conversion. |
| browser | RPC_INVOKED | About to invoke the existing Google backend RPC once. Not receipt, success, processing or attribution proof. |

A browser ATTRIBUTION_NULL with no corresponding source diagnostic remains unresolved. Malformed policy receipts, invalid records, epoch changes, missing component and storage failures do not all receive distinct codes in this narrow candidate. Current Head/worker logs cannot reconstruct an earlier unlogged epoch; deduplication and absent correlation forbid claiming a unique historical chain.

## Installation inventory and unchanged boundaries

After review only: Public `clickAttribution.js`; Booking Summary page source; Head `google-tag-and-consent.html` (generated from `.source.html`). No iframe replacement, tracking.js change, backend change, public webmethod, collection migration or setting change. Install the coordinated reviewed versions; a worker-only installation cannot observe Head frame failures. Head v1 is exactly 14,900 LF characters, at the unchanged packaging budget, so rebuild/check after any later edit.

Existing 500 ms handshake deadlines, 10 second bounded late-readiness envelope, existing retry count, exact protocol schema/version, consent/expiry/revision/storage fences, clear/revocation behavior and Summary 2–5 second redirect scheduling remain unchanged. Local tests use inert boundaries: no claim of actual hosted latency, native Wix frame destruction/replacement, backend processing or provider receipt. The unrelated Date bug is untouched.

## Reproduce offline

```
npm ci --ignore-scripts --offline
node --experimental-vm-modules --test tests/attribution-diagnostics.cjs
node --experimental-vm-modules tests/attribution-diagnostics-lifecycle.cjs
npm run test:google-tag
```

If packages are not already cached, ordinary `npm ci --ignore-scripts` uses the same unchanged lockfile. No external historical checkpoint or NODE_PATH is required. Lifecycle tests use actual worker/Head/iframe validators, existing inert page SDK and actual Summary callback; remount preserves the fixture's WindowProxy/component handle. Provider network entry is zero because backend/provider implementations are not loaded; Google RPC boundary counts are separately asserted.
