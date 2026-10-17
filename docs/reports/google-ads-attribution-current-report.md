# Google Ads attribution — current owner report

## Current status: test-site deployed; Summary test blocked by URL routing collision

Test revision **27114** is deployed at **0% exposure**; live revision **27108** remains at 100%. Search, pricing and room selection ran on the test version. Summary navigation replaced Wix’s `rc=test-site` selector with the selected-room `rc` value and loaded the live version, so candidate Summary acceptance remains blocked. No reservation, invoice or conversion-import action was invoked. See [test-site findings](wix-attribution-testsite-status.md).

### Earlier schema/Preview checkpoint

Eight Velo files and the iframe bridge are saved as an unpublished draft. With subsequent approval, `firstPaidTouch` and `latestPaidTouch` were added as Object fields and verified after editor reload. Read-only Wix Preview reached Home, Search and Summary initialization; Summary correctly lacked a prepared quote, and the Head handshake remained unverified. Opening the pages populated editor diagnostics, superseding the earlier idle-model zero-marker snapshot. **Do not publish the draft alone.** Head activation, publication, real booking/import tests and permission changes have not occurred. See [schema and Preview findings](wix-attribution-schema-preview-status.md) and the earlier [draft inventory](wix-attribution-draft-status.md).

The following sections describe the earlier GitHub verification milestone; their “Wix unchanged” statements apply to that earlier milestone, not the current draft. The claim about unchanged baseline backend files is repository-relative; fresh editor inspection required the additional attribution-reporting update described in the draft-status report.

## Prior milestone: attribution-only code saved to GitHub

The smaller Google attribution update is implemented, tested and saved on **`ric/attribution-only`**. Its verified code commit is **`48519ac79aad688817a3f0bbea60f1941f098d79`**. GitHub's remote branch matched that exact commit before this report was written. No changes were merged to main. No Wix editor, publication, collection permissions, Ads account configuration or real provider sends were changed in this work.

[Code commit](https://github.com/AdventureTD/wanderlust-booking-engine/commit/48519ac79aad688817a3f0bbea60f1941f098d79) · [Attribution-only branch](https://github.com/AdventureTD/wanderlust-booking-engine/tree/ric/attribution-only)

This supersedes the combined-candidate handoff as the proposed **tracking** installation package. The broader BookingSummary security work remains preserved on `ric/attribution-booking-access-review`, not included here.

## What was wrong and what changed

| Problem | Evidence and correction | Current status |
|---|---|---|
| Tracking loader previously used a broken address | Earlier production evidence showed a 404 loader; the owner's prior restoration returned to Google's standard loader and some hits were observed. The current packed snippet retains the working standard-loader approach. | Historical live loader repair; no new live test performed here. |
| Tracking components used incompatible message formats | Historical controlled tests showed Head rejecting older bridge/frontend envelopes, leaving the Summary page without click attribution and skipping import. The coordinated Head, iframe and worker set now agrees on the protocol. | Implemented, offline-tested, pushed; not installed or live-verified. |
| First ad-click identifier could be lost after an older first touch expired | Updated first-touch renewal and first/latest tracking-state handling. | Offline lifetime and booking-graph tests pass; hosted verification pending. |
| Older asynchronous operations could interfere with newer tracking state | Readiness fencing, ownership/revision checks and clock handling prevent stale operations from acting on newer state in the tested schedules. | Offline race tests pass; not proof of every possible browser schedule. |
| Frontend tracking Settings read could silently default to enabled | A dedicated read-only web method returns only the Google suspension flag. Master, Search and Summary now hold tracking if the flag cannot be verified; privacy handling remains available. | Offline enabled/held/suspended and booking-flow tests pass. Hosted endpoint behavior pending. |
| Unverified readiness could erase retained attribution, and consent-state access occurred too early | Per-copy privacy binding, non-destructive hold behavior and lazy consent-marker initialization distinguish uncertainty from actual withdrawal. | Offline binding, withdrawal, storage and lifecycle tests pass. Real banner delivery/storage partitions pending. |
| Tests depended on external workspace modules and a sibling baseline file | Dependencies are pinned in package-lock, a repo-relative runner sets its own paths, and fee/tax reference lines are held in a documented local fixture. | `npm ci` and full verification succeeded in a fresh Git clone. |

## What is proven by the latest execution

- A fresh local Git clone of the exact saved code installed dependencies with `npm ci`.
- Google Head build/parity check passed: **14,874 characters**, within the configured budget.
- **87/87 executable test/check scripts exited successfully**, with no failed processes. This includes test helpers and aggregate runners; it is not a claim of 87 independent suites or a summed unique-test-case total.
- The scope check confirms **all 35 existing backend JavaScript files are unchanged** and the only new backend module is `publicFlags.web.js`.
- It also protects 30 Summary business functions. The Continue function permits only the bounded tracking-flag await; the small initialization change was separately self-reviewed.
- Booking selection, actual synthetic single/multi-room producer flows, contact normalization, synthetic provider payloads, consent, attribution lifetime, privacy, cancellation and invoice regression harnesses passed. They do not create live bookings or contact Google, guests or payment providers.
- The clean clone remained clean after execution. Results are in `attribution-clean-clone-results.json` beside this report.

## Failures found during separation, and how they were resolved

The first broad transplant ran 88 scripts; 74 passed. Many failures arose because its fixtures explicitly loaded the BookingSummary security modules we were intentionally excluding. Four original baseline fixture files were restored for the retained backend/client behavior, rather than adding the security modules back. Two new security-only suites were excluded from this branch and remain preserved with the combined candidate; no baseline suite was removed. A Summary lifecycle extraction comment was aligned with its existing test anchor. Source-custody manifests were rebound after review, preserving the changes in `../attribution-only-custody-review.json`.

The adapted run passed 86 scripts. Adding the independent scope check brought the clean-clone final run to 87. A Windows newline mismatch in the new fixture generator was corrected before acceptance; no business code changed to satisfy that fixture. Earlier failed results are retained in `attribution-initial-separation-results.json` rather than discarded.

Review of this newly separated package was performed by Ric alone and is **self-review**, not a fresh independent review. Nine production files exactly match the previously reviewed combined candidate; the Summary file retains only the tracking integration edits. No Claude or paid subagent calls were used.

## Booking Summary changes are deferred

The Summary **page** needs tracking initialization and an attribution wait. That does not mean its collection security was redesigned.

This branch does not change collection permissions, booking authorization, room saving, owner CMS editing, invoice services, Microsoft conversion backend behavior or the guest room cap. No experimental checkout model is included. Existing public collection-access and stale-row/security risks remain unresolved, and restoring attribution does not certify them as safe. The owner-approved four-room rule remains separate unfinished booking work, not silently implemented in a tracking release.

## Google warnings that remain unverified

**“Tag is missing user-provided data” and “No user-provided data matches” are not yet confirmed resolved.** The historical message-format defect does not prove the cause of those warnings. The actual email attachment, form timing, consent, destination action mapping, receipt, processing and matching require hosted/account evidence. The upload serializer and hashing code were not changed without an established defect. Phone contribution was not proven. No numerical likelihood is presented as a root-cause finding.

Other known limits remain: real storage partitioning and cross-copy message delivery, the generic event bridge's existing origin/frame-check gap, historical SSR-onReady concerns, older published type definitions, and existing public collection access. Offline tests cannot settle these hosted/security questions. The pinned test toolchain includes deprecated ESLint/transitive packages; npm reported zero known vulnerabilities at installation, not a security warranty.

## Next approval boundary

Local preparation and GitHub saving are complete for this attribution-only candidate. The next step is approval to **open the Wix editor, back up/compare the exact installed files, and prepare the coordinated attribution update**. Do not blindly replace newer editor work. Confirm hosted compilation and endpoint behavior, preferably on a separate approved test site, before publishing.

Publication and any test that sends real invoices, calendar entries, emails or ad conversions are separate actions requiring explicit authorization. Keep the existing live site untouched until those gates are satisfied. There is no claim that Google diagnostics have improved or that a real booking has been attributed correctly yet.

The exact file inventory, repeatable commands, hosted acceptance checklist and recovery cautions are in [the handoff](../attribution-only-handoff.md).
