# Portable native-Date regression support (offline only)

This new support delta does not modify either reviewed runtime adapter, the reviewed extended bridge/runner, or any historical pin. It is not an independent review receipt.

## Commands (from repository root)

- `node scripts/guest-native-date/custody.cjs`
- `node scripts/guest-native-date/controls.cjs`
- `node scripts/guest-native-date/boundaries.cjs` — the original 12 boundary assertions.
- `node --test scripts/verify-native-date-adapter.test.cjs` — the original 44 Store cases.
- `python -B scripts/guest-native-date/run.py <NEW-EXTERNAL-EVIDENCE-DIRECTORY>` — one fresh two-subject run, real Word/LibreOffice, actual invoice and Apps Script handlers with existing inert transports, followed by payload audit. Use an installed interpreter containing the project's Word/FastAPI dependencies. No live transport or fallback renderer is admitted.
- `python -B scripts/guest-native-date/audit.py --run <FRESH-RUN-DIRECTORY> --output <NEW-AUDIT-JSON-OUTSIDE-RUN>` — read-only repeat audit; output must not exist.

`pins.json` is an explicit finite author-time map of the existing selected integration closure plus these new test/audit sources and the Store test. `custody.cjs` is its trust anchor: the manifest canonical digest is a literal, not computed from current sources to admit them. All selected files are checked before the boundary VM or business runner starts. Canonical text normalization replaces paired CRLF bytes only; BOM, lone CR, whitespace edits, malformed/missing files and stale manifests fail. The existing Word template remains binary/raw. This custody verifies exact fixture bytes, not a schema-compatible replacement. The root trust anchor's raw and canonical hashes are recorded in the external delivery report; as with any static test verifier, replacing the verifier itself is outside its own self-authentication guarantee.

## Minimal fixture and authority separation

`ledger.json` contains one Bookings row and its eleven exact original RoomBookingClaimEvents, projected without value changes from a saved **synthetic inert actual test producer**. `provenance.json` records the source artifact digest, archived producer support references, projection and exclusions. The first booking genuinely completed before the original second-subject native-date failure. That historical process exited 1; it is NOT a successful two-booking run. The original full evidence stays external and unchanged. No guest contact data, acceptance capsules, credential strings, receipt object, invoice/Calendar journal, provider grant, PDF, MIME or progress history is packaged in this fixture.

This ledger is reference boundary input only. The boundary VM reconstructs its two stored native Date values so the actual snapshot/source-rule code can validate original retained relationships. It cannot accept a booking, mint a receipt, grant START or invoke a provider. The unchanged twelve assertions include legacy behavior and deliberately forged detached test rows. A forged testing row or expected reference receipt must never be described as writer-produced authority.

The fresh business runner does **not** read `ledger.json` or any saved producer history: it reuses the reviewed fresh actual-producer runner unchanged. Its mismatched-receipt control corrupts a detached read response only, not the retained receipt or journal. Actual fresh receipts, Word PDFs and inert provider bytes remain outside the source tree. The audit checks their within-run identities and equality, not equality to old nondeterministic PDFs. Its PASS is an author execution result, not a different-author verdict or live provider receipt.

## Scope

No browser, live CMS, real provider call, deployment, commit or push is part of these commands. Do not use test fixture identifiers as live authority. Hosted native SDK/ACL/concurrency, scheduling and activation remain separate unproven gates. Newly authored support needs different-author review before any commit; the earlier runtime/integration PASS does not approve this delta.
