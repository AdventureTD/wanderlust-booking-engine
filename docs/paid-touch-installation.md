# Paid-touch attribution candidate — installation prerequisites

**Candidate only; independent review and owner installation/publication remain required.** No live CMS schema, Editor, Ads setting, test booking or provider send was performed by this implementation. Do not install a subset.

## Coordinated files

| Repository file | Destination |
|---|---|
| `velo/custom-code/google-tag-and-consent.html` | Existing Google Head Custom Code (paste this generated file only) |
| `velo/custom-code/google-tag-and-consent.source.html` | Readable/build source, not a second Custom Code entry |
| `velo/custom-code/event-bridge-iframe.html` | Existing Master Page HTML component `#wbeEventBridge`; rendered outer iframe title must remain `WBE event bridge` |
| `velo/public/paidTouchState.js` | New Public `paidTouchState.js` |
| `velo/public/clickAttribution.js` | Existing Public module |
| `velo/public/tracking.js` | Existing Public module |
| `velo/page-booking-summary.js` | Existing Booking Summary page code |
| `velo/backend/availability.web.js` | Existing Backend web module |

The official Head builder and its 14,900 UTF-16-unit budget remain unchanged. Run `node scripts/build-google-tag.cjs --check` on the final reviewed delivery. The click envelopes retain protocol `v:2` and now require `schema:1`; mixed installations reject instead of silently truncating or accepting legacy wire records. Existing policy challenges, channel/nonce/sequence, frame binding and local deadlines remain in force.

## CMS additions (must be created/verified by owner before activation)

**Exact Head copy:** paste the entire generated `google-tag-and-consent.html`, not the readable `.source.html`. Preserve its existing final newline, but add no BOM, extra trailing CRLF or blank line. The B2 revision artifact measures **14,670 LF / 14,672 normal-CRLF UTF-16 units** (ASCII, no BOM, 2 newlines) against the 14,900 budget, which now applies to **both** representations (`tests/google-tag-size.cjs` asserts LF ≤ 14,900, CRLF ≤ 14,900 and the 15,000 Wix cap). The size reduction comes from moving the documentation-only Microsoft UET HTML comment out of the pasted artifact (see note below); no script, loader or attribute bytes changed for that. These are local measurements, not a hosted Editor acceptance claim: after saving, read back the published inline Head script and require exactly one exact match with the repository bytes. Owner approval is required before even opening Wix Editor.

**Microsoft UET note (moved from the Head artifact):** Microsoft UET is intentionally installed as a separate Wix Custom Code entry using `custom-code/microsoft-uet-and-events.html`. Keeping one UET owner avoids duplicate tags and ensures it runs on every funnel page.

Collection: **BookingSummary**. Add only:

| Field ID (exact) | CMS/API type | Value |
|---|---|---|
| `firstPaidTouch` | Object / `OBJECT` | Original first landing bundle, or null |
| `latestPaidTouch` | Object / `OBJECT` | Latest distinct paid landing bundle, or null |

Each Object has only five **string** properties: `capturedAt` (original ISO timestamp), `gclid`, `gbraid`, `wbraid`, `msclkid`. Empty identifier strings represent absence. Do not make nested `capturedAt` a CMS Date field, do not add contact/URL/referrer fields, and do not add these fields to child **Bookings** rows. Preserve existing collection permissions; no new public read permission. No new collection, secrets, jobs, package or Ads account configuration is required.

Wix explicitly documents `OBJECT: JSON object` in its [collection-field API](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/create-data-collection-field). This confirms supported field type, **not** the existence or permissions of either field on the live site. No known safe pre-existing reporting JSON field was found in source, so none is repurposed.

Attribution is optional: createBooking's existing Summary-write catch preserves the reservation if the optional aggregate write fails. Missing/misconfigured schema can still lose Summary/reporting or prevent optional conversion admission; that is not a reason to skip schema installation. There is no silent retry without the new fields, no guessed schema auto-creation and no duplicate booking attempt.

## Data and conversion semantics

- Browser storage and wire records are `{v:1,first,latest}`. Legacy flat browser records migrate on the authorized path, retaining their original capture timestamp. Historical BookingSummary rows are not backfilled or rewritten.
- First and latest describe separate complete landing bundles. Later Microsoft identifiers are not combined with earlier Google identifiers. Intermediate touches are intentionally not retained.
- Direct visits and identical first/latest ID bundles do not renew their original timestamps. Both snapshots use independent 90-day browser expiry. If first expires while latest remains, a direct visit, an identical re-landing or an older landing does **not** promote latest into first, and flat conversion IDs stay empty. A **distinct newer paid landing** after first expiry begins a new lifetime (`first = latest = new landing`), so its identifiers are uploaded. A live first is never replaced. The Head (`aS`) and `paidTouchState.capturePaidTouch` implement the same rule (parity tested in `tests/paid-touch-new-lifetime.cjs`).
- Existing flat fields remain original-first outbound attribution; Google/Microsoft provider payload selection is unchanged. Latest is reporting only.
- Existing Summary Continue passes detached, bound/revalidated reporting into first-room creation and every additional room. The page never reads or writes BookingSummary: notes persist through the first-room createBooking write, and a withdrawal/clear observed after first-room creation is propagated only through the capability-gated `clearBookingSummaryReporting` (see `docs/booking-summary-security.md`). Browser cleanup after acknowledged upload does not delete already persisted reporting.
- Summary aggregate refresh with omitted/undefined reporting preserves existing values. Explicit null clears; a later omitted refresh preserves that null rather than restoring old data. Browser expiry does not expire historical booking reporting.
- Withdrawal/suspension invalidates captured work. Late upload completion cannot recreate pending-clear private state after denial. Snapshot-scoped upload cleanup compares the whole state so it cannot erase a newer latest touch with the same first. A `clearClickIds` call while attribution is denied or not yet admitted (explicit withdrawal, suspension, policy UNRESOLVED/error, or pending initial readiness) performs only an IO-free fence (`fenceAttribution`: cancel pending readiness, bump revision). It opens no channel, writes no storage and grants nothing, but prevents a pending handshake from re-admitting the cleared state. This is deliberately fail-closed: such a clear also cancels any in-progress readiness for the current page lifecycle, so attribution stays unavailable until the next navigation performs a fresh policy-bound handshake. No denial is relaxed, no consent is inferred, and no retry or replay is scheduled.

## Rollout and rollback limits

### Worker partition admission and restart limits

Worker storage is data, not consent or epoch authority. A fresh worker may propose a valid persisted/legacy first touch (including a 14-day-old visit) only through the current policy-bound Head read/confirm handshake. After a confirmed response, public reads and new snapshots require the exact whole-state bytes accepted by that handshake; an empty response admits no residual bytes. Replacing local storage cannot replace the accepted state or create a new snapshot. Revision/nonce/channel fences discard pending responses and snapshots across observed withdrawal and refresh.

Observed withdrawal closes worker reconciliation, drops its admitted bytes and attempts both deletion and a value-free `wl_click_attribution_revoked` marker. Same-realm safety does not depend on those writes succeeding. The marker is only a best-effort negative across worker reconstruction, never a grant: it blocks old local proposals while a current Head can still supply a freshly captured URL state. A successfully stored, freshly confirmed state retires the marker. Matching whole-state conversion cleanup also closes old local admission; cleanup for an older snapshot does not erase a newer state.

This is not a durable consent-history service. If both realms restart and deletion/marker persistence failed or storage was replaced, the old bytes cannot intrinsically prove whether revocation occurred. Fresh-process migration must consult current policy/Head consent and retains valid timestamps; timestamps or untrusted storage epoch fields never authorize access. No guarantee of recovering an unpersisted cross-realm denial is made. Existing Head same-realm admission is unchanged.

Conversion/tracking exception diagnostics use fixed value-free codes only; they never stringify arbitrary provider exceptions, payloads or identifier hashes. Unrelated booking/invoice diagnostics are outside this targeted change.

Deliver all reviewed files through GitHub first; the owner controls Wix installation and publication. No live send, historical repair/backfill, conversion replay, Ads setting change or Editor access is authorized by this candidate. A local inert serializer PASS is not Google/Microsoft acceptance or hosted deployment verification.

Rollback must restore the coordinated runtime set from the prior approved commit. Preserve existing BookingSummary reporting and schema; do not bulk-clear/backfill or resend conversions. Legacy code cannot interpret the new storage shape; expect loss of optional browser attribution during mixed versions rather than attempting an unreviewed downgrade migration.
