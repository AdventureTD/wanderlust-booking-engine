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

The first whole-suite run was **80/87 executable scripts passing**. All seven failing scripts read cart data from the old outgoing `rc` key. Only those URL-reader assertions were migrated to `rooms`; expected room quantities, occupancy, dates, pricing and signed-quote checks were preserved. No suite was removed. The full rerun passed **87/87 executable scripts**. Clean-clone and hosted results appear at the verification checkpoint below.

Source-pin changes are recorded in `routing-custody-review.json`, with prior pins verified against the Git base before updating. Historical rebase evidence was retained. Review is solo self-review, not independent review.

## Installation and verification boundary

Only `velo/page-booking-search.js` → `file:///public/pages/z6bea.js` and `velo/page-booking-summary.js` → `file:///public/pages/f04do.js` change in Wix for this fix. Back up and compare preexisting editor source, save, reload and hash-check both files, deploy Test Site only, verify 0% exposure, and observe the candidate revision on Summary after real UI navigation. Stop before Confirm Booking; enter no guest contact data. The matching new Head remains unapplied, so this is not end-to-end attribution acceptance.

## Verified completion checkpoint

Code commit: `573c995ca67380ee4f478937983456c00e5abd24` on `ric/attribution-only`, pushed and remote-verified. A fresh clone completed `npm ci`, Head build/parity checks, and **87/87 executable scripts**, with a clean worktree. See `routing-clean-clone-results.json`.

Both editor page sources were backed up, compared to the preceding GitHub revision, updated, saved and hash-verified after a full editor reload. Backup directory: `C:/Users/TomDe/AppData/Local/hermes/profiles/ric/marketing-reference/google-ads/editor-backups/routing-20261017T143538Z/`.

Wix Test Site **27117** was deployed. Release Manager readback confirmed **0% test exposure** and **100% live exposure on 27108**. A final unauthenticated default-homepage fetch confirmed live revision 27108. Deployment propagation briefly served the preceding test revision on Search; no acceptance checks ran until Search reported 27117.

### Real UI checks, February 14–21, 2027

| Case | Selection | Summary revision | Displayed package | Displayed final total |
|---|---|---|---|---|
| Single room | 1 Adventure Suite, 2 guests | 27117 | $5,443.90 | $6,396.59 |
| Mixed two rooms | 1 Adventure Suite, 2 guests; 1 Two Bedroom Apartment, 3 guests | 27117 | $13,609.75 | $15,991.46 |

Both cases used real calendar, availability, package/room-selection and Continue-with-Booking controls, reached Summary with valid signed quotes, retained `rc=test-site`, and carried the exact selected rooms under `rooms`. The mixed case retained the two room types and per-room guest counts. All contact inputs remained empty. Confirm Booking was NOT clicked.

The captured RPC paths show no booking-creation, invoice, Summary-update or conversion-import invocation; no uncaught page errors were captured. Browser measurement requests were guarded in fresh contexts. No backend, CMS field/permission, pricing formula or Head change accompanied this routing fix. Evidence is in `routing-hosted-results.json` (two cases, read back and checked).

**The URL-routing blocker is resolved at the tested pre-confirmation boundary.** This does not prove booking persistence, invoice delivery, actual conversion processing or user-data matching. The matching Head is still unapplied; live publication and a real booking/import test remain separate approval gates. Do not publish the editor alone.
