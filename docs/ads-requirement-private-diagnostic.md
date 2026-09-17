# Private Ads requirement diagnostic — not a fix

This adds only a disconnected, read-only backend diagnostic. It does not change application behavior, consent policy, booking flow, provider sending, or the existing policy reader. Hosted Wix execution is **NOTRUN**; local inert-SDK tests do not establish the production incident's cause.

## Owner-only draft check

The only new file to copy from GitHub is `velo/backend/adsRequirementDiagnostics.js`, into **Backend → adsRequirementDiagnostics.js** as an ordinary private `.js` file. Do not use `.private.js`, `.web.js`, `.jsw`, an HTTP handler, or a frontend/public wrapper. Its existing dependencies are `backend/guestConsentRequirementsReader` and that reader's `backend/guestConsentLocationPolicy`; do not replace those unchanged files for this diagnostic. No new collection, secret, provider configuration, or publication is needed.

1. In the draft Editor file, use the play icon beside **`diagnoseAdsRequirementRead`**. Confirm that exact function name in the Functional Testing tab. Do not use the generic site/code-panel Run toolbar, which can start unrelated site code.
2. The signature is `export async function diagnoseAdsRequirementRead()`: **zero arguments**. In Set Parameters, use an empty JSON object **`{}`** (no parameter entries). This represents no named parameters, not an object passed as an argument. Direct invocation is `diagnoseAdsRequirementRead()`. Passing even `undefined` as an argument returns `INVALID_CALL`.
3. Before running, record the tester tab/function, draft source identity, sandbox enablement and the selected **LIVE or Sandbox** collection environment from the actual setting/metadata. If unknown, record UNKNOWN; do not infer it from row counts or a historical LIVE-empty observation. Do not synchronize or change collections.
4. Clear retained old output and use Run **inside that function's Set Parameters panel**. Retain only its finite returned DTO: `v`, `stage`, `reason`, `pages`, `rows`, plus the environment labels above. Do not run the raw reader export or share rows, IDs, policy hashes, contacts or errors. If the named tester is unavailable, stop and record NOTRUN; do not add a public endpoint.

This is owner-operated draft testing, not proof of published backend execution, even if the selected data environment is LIVE. Do not publish, create a booking, invoke provider senders, or alter access permissions to obtain diagnostic evidence.

## Meaning and limits

`OBSERVED` means the real imported reader exhausted its bounded scan in that invocation; `pages` is 1–41 and `rows` is 0–4096. Other outcomes have null counts and finite classifications: `INVALID_CALL`, `INVALID_DATA`, `READ_FAILED`, `READ_TIMEOUT`, `INCOMPLETE_READ`, `OVERFLOW`, `UNEXPECTED_RESULT`, or `THREW`. It does not identify the data environment or prove the hosted endpoint's source/import identity. It cannot authorize form collection or repair attribution.

The separate zero-argument `diagnoseAdsRequirementSdkShape()` export is included byte-for-byte in the reviewed source, but is not the first requested check. If separately needed/authorized, it performs a different fixed first-page query, returns only finite descriptor categories and bounded counts, and never invokes result getters or `hasNext`. It does not inspect the reader's same response or establish an atomic snapshot. `SHAPE_ONLY` is not validation; null counts are not an empty page. Its 10-second asynchronous wait does not cancel native IO or preempt synchronous stalls.

## Review and local evidence

Approved diagnostic SHA-256 (exact bytes): `3f7030d099162e2dcd58c47c3ef71aaa31f71769c7304cabb7501cb6455fceaa`.

The independent review passed the original 23-case diagnostic suite and an independently authored 20-case probe suite against actual ESM with inert SDK boundaries. Delivery gates rerun both unchanged suites against exact staged Git blobs and fetched remote blobs using an external, hash-pinned source-path loader. Dependency CRLF-to-LF equivalence is explicitly authorized and verified against the original review manifest and unchanged main blobs; the diagnostic retains its exact raw hash above. Application sources and test assertions are not rewritten. The external suites/fixture contain workstation-specific absolute paths, so they are not added as misleading portable repository tests. These overlapping suite counts are not a count of unique product behaviors.

Official tester/environment references used in the review:
- https://dev.wix.com/docs/develop-websites/articles/workspace-tools/testing-monitoring/functional-testing/about-functional-testing.md
- https://dev.wix.com/docs/develop-websites/articles/workspace-tools/testing-monitoring/functional-testing/test-backend-functions-with-functional-testing.md
- https://support.wix.com/en/article/cms-about-sandbox-and-live-collections-and-syncing
