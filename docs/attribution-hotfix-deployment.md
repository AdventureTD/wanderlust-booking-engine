# Attribution hotfix — manual deployment and rollback

Baseline: `306946f4c112cab7ed220d3c7591c198afc9a3da`.
Candidate requires independent review before commit or deployment. No automated Wix publish.

## Entire files Tom must replace (after approval)

1. `velo/page-booking-summary.js` → replace **all** Booking Summary page code in Wix Editor.
2. `velo/custom-code/google-tag-and-consent.html` → replace the **entire existing Google head Custom Code entry**, not add another entry. Retain its existing placement/load settings. Preserve the Microsoft entry separately.

3. `velo/backend/availability.web.js` → replace the complete matching backend module together with Summary. The review correction adds explicit failure outcomes consumed by the page. Verify the deployed `backend/availability` import resolves to this module before any rollout. Do not deploy the new backend with an old Summary consumer.

Do not replace Search, master page, tracking helpers, Settings, CMS schema, Google Ads destinations, pricing configuration, or invoice renderer. Repository-only support: `tests/attribution-hotfix.cjs`, `tests/attribution-hotfix-sources.json`, and `scripts/verify-purchase-value-source.js`; do not paste these into Wix.

Save the current live whole-file contents and entry settings before editing; Git baseline is a rollback source only if it matches the previously deployed version. Compare the approved candidate to those live contents first. Tom owns the later save/publish decision. No test purchases, uploads, invoice generation, email, or production Settings changes are authorized by this offline verification.

## Exact behavior and limitations

- The Google **message listener** installs once per page realm. Existing configuration, consent defaults and destinations remain unchanged. Reexecuting the snippet can still repeat its loader/config/consent initialization; this is not a global tag-stack or transaction deduplication solution. Separate live tag owners, repeated bridge messages and new tabs remain outside this guard.
- Summary captures a frozen numeric USD total from its existing calculation before any booking await; it does not parse mutable display text. Missing/nonfinite/negative calculated totals skip analytics, not confirmed booking/invoice handling. Legitimate calculated zero is retained. This is **client-calculated, not a server-confirmed canonical invoice snapshot**. Existing rounding/rates and backend invoice calculation remain unchanged and may differ.
- Promo/removal/Continue callbacks are fenced during pending promo/render and after booking submission. Room rows, stay strings, package/token and promo values used for submissions are captured before awaits. A successful or uncertain/partially failed submission stays locally latched: Continue cannot replay that cart. On failure, contact the property to reconcile before retrying; reloading is not idempotent recovery. This deliberately avoids the former in-page partial-cart replay, but is not a cross-tab/restart guarantee.
- Remaining rooms are awaited sequentially, preserving the existing per-room API and error aggregation. Each normal `createBooking` call already awaits its draft-invoice addition, preventing the demonstrated **same Summary cart** parallel lost update.
- **Backend race fix is NOT complete.** `createBooking` is publicly exported (`Permissions.Anyone`), so callers from other tabs/requests can overlap. `createDraftInvoice` still uses non-atomic read/add/update or read/insert; its failures are still swallowed by `createBookingImpl`. No process-memory lock is presented as distributed protection. A complete fix needs durable per-room financial contributions/idempotent finalization or datastore-supported atomic versioned updates and separate schema/API review. No historical invoice correction is included.
- Browser analytics failures cannot prevent the existing invoice request/confirmed redirect. Existing browser-lifetime/invoice-host scheduling limitations are not repaired here.

## Recovery outcome contract

- `NO_RESERVATION` plus one of `INVALID_DATES`, `UNKNOWN_ROOM`, `INVALID_STAY`, `MIN_OCCUPANCY`, `MAX_OCCUPANCY`, `UNAVAILABLE`, with no booking number, is emitted only by explicit checks before booking-number allocation or reservation dispatch. The page unlocks only a first-room result with that exact structured contract. It never parses arbitrary exception text to grant retry.
- An insert-or-later exception returns `UNKNOWN` with the known booking number, even after conflict removal (draft financial effects may remain). Successful inserted-row shape is unchanged. Later-room rejection never unlocks an already-started cart.
- Transport failures, malformed returns and other pre-insert failures (including quote/pricing reads after number allocation) remain conservatively nonretryable. A lost response can hide the reference: the page then requests Contact Us reconciliation without inventing one. Local preparation errors before dispatch unlock with correction/retry instructions.
- Promo input and Apply visibly disable during validation/render, restore only when idle, and stay disabled during booking. Replayed callbacks are still fenced. A programmatic input replacement detected during validation requires explicit reapply before Continue. This is not cross-tab isolation or distributed financial authority.
- Outstanding financial defects live in [Known financial correctness issues](known-financial-correctness-issues.md), not the noncritical backlog.

## Offline verification

Run from a clean candidate checkout with Node (no npm packages):

```
node tests/attribution-hotfix.cjs
node scripts/verify-purchase-value-source.js
```

The 41-case suite reads actual Summary/head, complete createBookingImpl and draft-invoice functions with repo-relative, fixed canonical-LF source pins. It exercises the booking implementation using inert dependency boundaries (not actual signed-price verification or CMS). Pin mismatches fail a named assertion; pins are static authoring-time data, not regenerated during tests. The watchdog prevents unresolved async cases from exiting successfully. Added controls cover definitive rejection, transport/insert uncertainty, post-insert conflict, managed preparation, pending promo/render callbacks, negative/zero money and repeated configuration. No live CMS consistency, GA4 receipt or deployed-settings claim follows.

The six `tests/legacy-*.cjs` suites must also pass separately with explicit `TZ=UTC`, `TZ=America/New_York`, and `TZ=Pacific/Auckland`; verify Node's actual resolved timezone and date offset, not just the environment label. The old `verify-booking-summary-value-reveal.js` has an existing baseline failure; preserve that evidence rather than weakening it. The old purchase-display string guard was intentionally replaced by the numeric snapshot contract; behavioral tests remain the stronger evidence.

## Rollback

Replace those same **three entire live entries/files together** with the predeployment saved versions (or verified matching baseline blobs), then let Tom explicitly decide whether to republish. Remove no reservations, invoice rows, conversions, or history. Rolling source back neither reverses already-created records nor repairs historical revenue/invoices. Stop rollout if real deployment parity, an unexpected tag owner, missing totals, invoice mismatch, or booking failures require further investigation.
