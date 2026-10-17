# Backward-compatible test-site room routing

## Approved scope

Fix only the Search-to-Summary query-key collision; retain the attribution release, backend behavior, pricing rules, booking creation and collection permissions unchanged. Live publication and Head activation are not authorized.

## Implementation

- Search uses `rooms` for its encoded cart, preserving dates, package and signed quote exactly as before.
- Search carries `rc=test-site` only when its current Wix query contains that exact selector. Ordinary live navigation does not introduce the test selector.
- Summary prefers `rooms`, accepts legacy cart-valued `rc` links, and never interprets `rc=test-site` as a room. Existing roomCode/date and local-storage fallback behavior remains.
- Search and Summary must deploy/roll back together. An old Summary reader cannot consume new `rooms` URLs by itself. Rolling back both restores the former test-route limitation.

## Local evidence

The actual-page handler suite was extended before product changes: **24 cases, 7 failing** against the prior source. Those failures were the renamed outgoing-key expectation plus six new test-site/compatibility cases. After the two-page correction: **24/24 passed**. Existing legacy Summary rendering/quote tests still run.

The first whole-suite run was **80/87 executable scripts passing**. All seven failing scripts read cart data from the old outgoing `rc` key. Only those URL-reader assertions were migrated to `rooms`; expected room quantities, occupancy, dates, pricing and signed-quote checks were preserved. No suite was removed. The full rerun passed **87/87 executable scripts**. Clean-clone and hosted results will be recorded at the verification checkpoint below.

Source-pin changes are recorded in `routing-custody-review.json`, with prior pins verified against the Git base before updating. Historical rebase evidence was retained. Review is solo self-review, not independent review.

## Installation and verification boundary

Only `velo/page-booking-search.js` → `file:///public/pages/z6bea.js` and `velo/page-booking-summary.js` → `file:///public/pages/f04do.js` change in Wix for this fix. Back up and compare preexisting editor source, save, reload and hash-check both files, deploy Test Site only, verify 0% exposure, and observe the candidate revision on Summary after real UI navigation. Stop before Confirm Booking; enter no guest contact data. The old Head remains unapplied, so this is not end-to-end attribution acceptance.
