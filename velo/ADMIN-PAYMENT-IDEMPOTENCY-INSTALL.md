# Admin payment/refund duplicate correction

## Release boundary

Replace **both** files together in one coordinated Wix site publication, after independent review:

- `velo/page-admin-bookings.js` → existing Admin Bookings page code.
- `velo/backend/adminConsole.web.js` → existing `backend/adminConsole.web.js`.

No new CMS collections, custom fields, indexes, secrets, packages, or Editor elements are required by this design. The only new persisted field supplied is the existing native `_id`; all previous payment fields remain unchanged. No existing rows or native IDs are migrated, merged, deleted or rewritten.

GitHub delivery is not Wix installation/publication. This work did not access Editor or execute live financial actions. Before GitHub main delivery, verify Render's current Auto-Deploy/build filters: a main push may trigger Render even though no Render executable/configuration files change. Do not change Render settings as part of this correction.

## Coordinated installation

1. Stop administrative payment/refund entry during cutover. First reconcile any **uncertain old-page** submission against its actual financial transaction and exact CMS rows; do not retry it on the new page just because it failed visibly. Historical cleanup needs separate approval.
2. Install both files without publishing an intermediate client/backend combination. Existing older pages without `operationId` now fail closed with an explicit reload/reconciliation message; there is no unsafe compatibility fallback. All four committed payment/refund call sites were on this page and are routed through the new common submit function.
3. Check existing live BookingPayments hooks, automations, connected datasets and visual event handlers. None were found in repository source; live configuration was not inspected. In particular, hooks must not replace the supplied `_id`, mutate the immutable financial payload or create additional payment records. Native insert/get hooks remain enabled as before. Unique-ID protection covers this writer, not arbitrary other writers or hook side effects.
4. Publish only with owner authorization; close/reload all **settled** old admin sessions. Verify actual hosted `crypto.getRandomValues` and Wix session-storage availability, admin permissions, native `_id` retention and the intended UI bindings using separately authorized nonproduction data. Offline tests do not establish hosted parity. A crypto/storage failure prevents dispatch rather than falling back to insecure IDs.

## Retry instructions

A new operation receives 128 random bits. The site-owned BookingPayments namespace stores it as native `_id = ap-<32 lowercase hex characters>` (35 ASCII letters/digits/hyphen characters). Booking identity and payment/refund type are **immutable payload bindings**, not separate ID namespaces: reusing the token for another booking or swapping payment for refund conflicts rather than generating another native row. Admin identity changes likewise do not create a second row for that token. The token is not an authorization credential: both web methods remain `Permissions.Admin` and perform their existing role check.

A minimal recovery journal is kept in Wix **session** storage: opaque random token, SHA-256 of canonical immutable payment fields, frozen civil date, and `pending`/`acknowledged` state. The compatibility token key contains only the token. No raw booking number, amount, method, note or contact data is stored. The digest is not encryption; treat session storage as sensitive and same-tab recovery only. Secure random generation **and Web Crypto SHA-256** must be available or dispatch is blocked.

Blank dates are frozen when the operation is first accepted and reused before fingerprint comparison, including across midnight, DST and same-tab reload. Explicit date edits while an operation remains unsettled conflict. On reload, re-enter the **original booking, amount, method, note and operation type**; leave an originally blank date blank or supply its original date. Save reconciles the original operation; it does **not** ask you to make the actual payment again. Canonical rounding is identical to the existing server's `Math.round(amount * 100) / 100`. Unsupported currency overrides remain rejected.

Backend acknowledgment is distinct from form settlement. The acknowledged journal is verified before deleting the compatibility token, and is **never deleted during cleanup**. If deletion, storage readback or amount clearing fails, the operation remains bound. The UI says **Payment recorded** when acknowledgment is known; otherwise it instructs reconciliation without claiming that payment failed. Retry the unchanged entry to reconcile only. Do not close the tab, clear storage, change browser, or create another payment to work around uncertainty. No retry of an actual card/cash transfer is required.

Only a successful amount clear with observed empty readback admits a subsequent new entry in the same page realm. An automatic detail render is not a new-intent signal. A newly entered payment may legitimately have exactly the same amount/date; no generic financial-value dedupe is used. Across reload, even a previously acknowledged journal is conservatively recovered once rather than assuming that repeated values are new intent. Reconcile it using original details first, then enter the new payment after confirmed clearing. The latest journal replaces its predecessor only when a new locally settled operation starts; there is no unbounded journal or background loop.

Session storage ends when the tab/window closes or storage is cleared. This design cannot survive those events, a different browser, or arbitrary external storage modification. If recovery identity is lost, reconcile manually before starting another operation. No reset-pending bypass is supplied. Storage exceptions never authorize a new token around an unresolved operation.

## Datastore guarantee and limits

The native unique `_id` **insert**, not the preceding lookup, arbitrates concurrent copies. The initial direct `get(..., {consistentRead:true})` recognizes a completed operation before capacity checks. A capacity rejection or capacity-query exception triggers a second exact operation read: an equal winner is returned, while absent/uncertain/conflicting state does not permit an insert. This closes the same-operation fourth-slot loser window, not the distinct-operation capacity race. After insert success **or any insert error**, direct readback must match booking number, rounded signed amount, date instant, type, method and note. If readback is unavailable or conflicting, the caller retains the token and does not mint a replacement. `save()`/upsert is not used. The display `paymentId` is not part of request identity and may differ between competing proposed rows; the winner's stored display ID is returned.

Official Wix contracts consulted:
- https://dev.wix.com/docs/velo/apis/wix-data/insert — supplied native IDs; an existing ID rejects insert rather than overwriting; insert hooks run.
- https://dev.wix.com/docs/velo/apis/wix-data/get — direct ID lookup, null for missing/hidden items, get hooks and read permissions.
- https://dev.wix.com/docs/velo/apis/wix-data/introduction — consistentRead selects the up-to-date primary instance.
- https://dev.wix.com/docs/velo/apis/wix-data/error-codes — WDE0074 / WD_ITEM_ALREADY_EXISTS. Runtime intentionally does not assume every failure has this code; it reconciles exact readback instead.
- https://dev.wix.com/docs/velo/apis/wix-storage-frontend/introduction — session storage survives reload but not tab/window closure.

**Separate unresolved races, not fixed by this duplicate correction:**
- Existing `P-####` display IDs still use max-plus-one, including the inherited four-digit wrap behavior. Distinct simultaneous operations may share a display ID. Native IDs are different and authoritative. No old display IDs or ordering were changed.
- The existing four-record cap is a non-atomic query then insert. Identical-operation races now occupy one slot, but distinct operations from separate tabs/admins can still exceed four. Invoice display remains limited to four rows. Serialize administrative entries while this separate ledger-capacity problem remains; this release does not claim a transactional capacity reservation. Do not add a unique paymentId index as an unreviewed workaround.

## Local verification

Run from a clean repository checkout with Node:

```
node --test scripts/verify-admin-payment-idempotency.cjs scripts/verify-admin-payment-recovery.cjs scripts/verify-admin-payment-blockers.cjs
```

The portable inert fixture loads the actual complete page/backend source with import/export adaptation. It denies unrelated mutation/provider entry and models native unique insert and direct ID reads; no live payment, refund, invoice, email, Calendar or Ads calls occur. It includes all original 13 schedules, the four-render/one-click regression, reload/ACK-loss recovery, concurrency, payload conflicts, stale-selection suppression and security failures. The explicitly labelled distinct-operation capacity/display-ID test demonstrates the **remaining limitation**, not its correction. The original incident WC-1026 rows and installed-source parity remain unknown; this change does not repair or reconcile them.
