# Google Ads attribution-only handoff

**Scope:** local implementation and tests; Wix editor and publication require separate approval. This branch does not implement the BookingSummary security redesign.

## Purpose

Repair the coordinated Head/iframe/worker attribution handoff, retain correct first/latest paid touches, prevent older asynchronous work from invalidating newer attribution, and pause tracking safely when its Settings flag cannot be verified. Consent withdrawal and ordinary booking flow remain separately tested. No new advertising channel or provider upload format is introduced.

## Exact installation inventory

These are the only production changes relative to repository baseline `2b946df`:

| File | Purpose |
|---|---|
| `velo/custom-code/google-tag-and-consent.source.html` | Readable Head source: coordinated message protocol, privacy binding and first-touch lifetime fixes. Authoring source, not an additional snippet to install. |
| `velo/custom-code/google-tag-and-consent.html` | Built Head snippet; install this artifact, not both versions. |
| `velo/custom-code/event-bridge-iframe.html` | Matching iframe relay for the same protocol. |
| `velo/public/clickAttribution.js` | Worker-side binding, readiness, lifetime, stale-operation and lazy consent-storage handling. |
| `velo/public/paidTouchState.js` | First-paid-touch renewal handling. |
| `velo/public/tracking.js` | Tracking flag hold and consumer/send checks. |
| `velo/masterPage.js` | Initializes privacy listeners and uses the read-only tracking flag endpoint. |
| `velo/page-booking-search.js` | Tracking flag adapter; no search UI or room-selection redesign. |
| `velo/page-booking-summary.js` | Tracking flag adapter, early privacy binding and a bounded flag await before attribution capture. Existing booking, invoice and collection access behavior is retained. |
| `velo/backend/publicFlags.web.js` | New public read-only method exposing only the Google suspension Boolean; does not expose the Settings dictionary or modify collections. |

Do not paste whole files until comparing fresh editor backups with this baseline: the live editor may contain newer unrelated changes. Head, iframe and frontend must be deployed as a coordinated set, not mixed across versions. Matching repository files alone do not prove which code is currently published.

## Deliberately NOT included

- No `bookingSummaryCapability`, `bookingSummaryReporting`, or `bookingSummaryWriter` modules.
- No checkout model, intake-gate integration, collection-permission change, room-cap change or booking authorization redesign.
- All 35 baseline backend JavaScript files remain unchanged; only `publicFlags.web.js` is added.
- Original checkout continuation, direct Summary writes, owner CMS editing and known existing collection/security limitations remain. This tracking release does not fix or certify them.
- Google upload serializer, action mapping and contact hashing code remain unchanged: no defect in these was established by this work.

## Reproduce offline verification

Use Node 22 and npm, from the repository root:

```sh
npm ci
npm run check:google-tag
npm run test:offline
```

`test:offline` runs top-level `.cjs` and `.test.js` harness/check files serially with repo-local dependencies and a 30-minute per-script cap. It writes individual logs and `results.json` into ignored `.test-results/`; `WBE_TEST_OUTPUT` can select another directory. Nonzero exit or timeout fails the run. The count is executable scripts, **not a claim that every script is an independent test suite**. Helpers and aggregate runners are included.

Dependencies are locked locally: no Claude workspace paths or external NODE_PATH required. ESLint 8 and the frozen type definitions emit age/deprecation limitations; the hosted Wix SDK still requires verification. npm reported zero known vulnerabilities during installation, not a general security certification.

## Separation review

The initial broad test transplant failed because it included tests written for the deferred Summary security modules. The original four baseline fixtures were restored for fresh producer, reporting privacy, cancellation and persistence. Their assertions run against the real retained baseline backend and Summary paths. Two newly added security-only suites are not included; their code/evidence remains on the combined review branch. No baseline suite was dropped.

The Summary lifecycle harness uses the exact reviewed tracking comment anchor. Custody hashes were deliberately rebound after reviewing the smaller tree, with previous/current entries recorded in `attribution-only-custody-review.json`; pins alone are not behavioral proof. The independent scope check protects all baseline backend files and 30 Summary business functions; it permits the one tracking-flag await in Continue. `initSummary` is excluded from function hashing because its old tracking suspension block was removed, and its small diff was self-reviewed.

This separation review is Ric's **self-review**, not new independent review. Previously reviewed tracking components are reused; no paid agent was called.

## Required hosted checks after editor approval

1. Back up and compare exact editor sources, snippet configuration, iframe placement and installed SDK versions without changing permissions.
2. Prepare the coordinated update; check Wix compilation before publication. Confirm the public flag method returns only its documented shape and unknown settings keep tracking held without blocking booking.
3. Use a separately approved test environment and synthetic contact data. Keep real email, invoice, calendar and ad sends disabled unless explicitly authorized. Test single/multi-room flows and consent allow/deny/withdrawal. No synthetic click IDs sent to Google.
4. After publication authorization, inspect actual loader requests, Head/iframe readiness, click-ID handoff and booking conversion invocation. Do not log click IDs, guest contacts or capability values.
5. Verify destination action mapping and customer-data settings read-only. A controlled real-ad-click conversion needs explicit authorization, correct action and consent. Google request acceptance is not proof of successful processing or matching; inspect the subsequent outcome.
6. Investigate missing/unmatched user-data warnings using actual form timing, email attachment, consent, provider receipt and diagnostic state. This branch does not claim those warnings resolved. Allow provider diagnostics time to update after a demonstrated corrected event; do not manufacture a promised deadline.

## Recovery boundary

Back up the installed set before editing. Do not revert only one protocol component. Do not describe old/new attribution storage rollback as lossless; older readers may remove newer records. Tracking failures must not trigger booking retries or duplicate invoices. No collection-permission rollback is part of this attribution-only release.
