# Google Ads private attempt journal — bounded candidate, NOT installed

Base: `054e3e4bcebaf60c5bb45edfccad5891109e9669` (fresh `origin/main`). Independent review and reviewed GitHub delivery are required before installation. This supersedes the *prospective admission blocker* in `google-ads-private-journal-admission.md`, not its historical vulnerability evidence. Transport-only history remains in `google-ads-upload-reliability-hold.md`.

## What this changes

A private backend-only helper issues a conversion-only bearer capability after the actual legacy first-room producer has successfully saved its room, draft invoice and **new** Summary. It must have obtained the number from the server allocator, have no preexisting room rows for that number, and have no caller-supplied existing number. Existing Summary updates, fallback numbers, failed saves, additional-room calls and historical lookups do not issue capabilities. Booking saves/confirmation retain their existing behavior when conversion configuration/storage fails.

The token uses existing Node backend `crypto.randomBytes(32)` (256 bits), with a `gac1.` version prefix. A SHA-256 token hash is stored in a private AUTH record bound to purpose `google-ads-purchase-attempt`, version 1, exact booking number, first saved room ID, saved Summary ID and server-configured Google account/action. It expires 30 minutes after server issuance. This is the explicitly approved **opaque random token plus private hash binding alternative**, not a signed financial receipt. There is **no new signing-key secret** to install or read. Production never uses the deterministic entropy used by the inert tests. There is no public mint, auth-row readback, or retroactive issuance API.

Summary keeps the token only in the current confirmation handler's local memory, takes it from the first-room response, and passes it only to the Google conversion RPC at the existing all-rooms-success point. No URLs, cookies, browser storage, GA4, Microsoft payloads or logs receive it. A reload or lost first response loses that guest's capability; do not recover it by minting another one.

The anonymous conversion RPC now denies missing/forged/wrong-booking/wrong-purpose/expired authority **before any journal write** or provider call. Valid admission binds the server destination before native ATTEMPT insert and readback. Only that invocation's successful exclusive insert/readback permits one provider entry. A duplicate, uncertain insert or readback failure never sends. There is no query-before-insert lock, module-memory lock, recursion, scheduler, background promise or retry loop.

After awaiting the provider, the same backend invocation awaits a bounded RESULT insert/readback. Empty HTTP 200, missing/oversized request ID, invalid JSON and transport uncertainty do not become success. Valid original request IDs up to 512 printable non-space ASCII characters are retained without truncation; fieldWarnings become a Boolean, not raw text. A request ID means **ingestion acknowledgment only**, not processing, matching, attribution or financial correctness.

## One new private collection — owner installation required

Create a normal **multiple-item** native CMS collection with exact collection ID **`GoogleAdsAttemptJournal`**. Do not use a single-item collection, public collection or external database substitute. Native read/create/update/delete permissions must all be **Admin only**, including sandbox and live configurations; no dataset, public logger, CMS form or public web method may expose it. Native administrators/collaborators remain privileged. No custom hooks or automations should write these records. The private module uses `suppressAuth: true`, `suppressHooks: true` and strong readback (`consistentRead: true`).

| Exact field ID | CMS type | Usage |
|---|---|---|
| `_id` | System ID | Native unique insertion authority. 36-character deterministic `aut-`, `att-`, `res-` IDs. |
| `kind` | Text | AUTH, ATTEMPT, RESULT |
| `schemaVersion` | Number | Fixed 1 |
| `purpose` | Text | Fixed google-ads-purchase-attempt |
| `bookingNumber` | Text | Bound booking reference; relation by value, not a public authorization secret |
| `commercialAuthority` | Text | Fixed UNVERIFIED |
| `recordedAt` | Date and Time | Native server Date |
| `expiresAt` | Date and Time | AUTH only; native server Date |
| `roomId` | Text | AUTH only; original saved Bookings `_id` |
| `summaryId` | Text | AUTH only; original saved BookingSummary `_id` |
| `tokenHash` | Text | AUTH only; private lowercase SHA-256 hex, never plaintext token |
| `destinationAccount` | Text | Server-configured numeric Google account ID |
| `destinationAction` | Text | Server-configured numeric Google action ID |
| `attemptKey` | Text | ATTEMPT/RESULT relation to original ATTEMPT `_id` |
| `outcome` | Text | UNKNOWN, NOT_ATTEMPTED, EXPLICIT_REJECTION, INGESTION_ACKNOWLEDGED |
| `reasonCode` | Text | Fixed allowlisted transport classification, RESULT only |
| `statusCode` | Number | Bounded HTTP status or 0 when unavailable, RESULT only |
| `requestId` | Text | Original validated provider request ID or empty, RESULT only |
| `warningPresent` | Boolean | RESULT only; no warning bodies |

At most three immutable records per admitted new booking, each application payload capped at 2 KiB (native system metadata is additional). Deterministic keys are booking/purchase scoped, intentionally more conservative than creating another opportunity after destination changes. No raw contacts, contact hashes, click IDs, payloads, provider bodies, exception strings, prices, payment information or plaintext capability are journaled. Random AUTH tokens are different even when the server allocator collides, but a native unique AUTH insert allows only one winner; this does **not** repair the existing booking allocator or invoice races.

Never delete ATTEMPT tombstones or reset IDs to obtain a resend. Missing RESULT means **UNKNOWN**, even when Google may have received the request. An insert-applied/ACK-lost result can exist privately while the RPC reports UNKNOWN. A failed claim can remain UNKNOWN with no provider entry. There is no implemented recovery/status endpoint and no automatic repair.

## Configuration and coordinated installation

1. Obtain independent source/test review and the parent's reviewed GitHub commit. No code in this worktree has been committed, pushed or published by this worker.
2. Create the collection and exact fields above; verify private ACLs in the intended environment. Preserve existing booking collection types and DateTime fields. Do not migrate historical bookings or seed AUTH/ATTEMPT rows.
3. Add **Settings key `googleAdsPrivateJournalEnabled` with value `0`** using the existing Settings key/value convention. Missing key defaults OFF. The conversion-only gate also requires an explicit `suspendGoogleAds` value `0`; missing/unreadable settings fail closed. Do not change existing suspension settings as part of testing.
4. Keep existing Wix secrets configured: `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_CONVERSION_ACTION_ID`, `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`. Destination IDs must be numeric strings of 1–20 digits. No secret values were accessed here. Existing quote/invoice secrets are unchanged.
5. Copy all four coordinated runtime files: `velo/backend/googleAdsAttemptJournal.js` → backend `googleAdsAttemptJournal.js` (**plain private .js**, not .web.js); `velo/backend/availability.web.js`; `velo/backend/googleAdsConversions.web.js`; `velo/page-booking-summary.js` → existing Summary page. Retain baseline `dataManagerClient.web.js` from the same reviewed revision. Do not install the new page against the old unrestricted sender or the new sender without its helper/collection.
6. Inspect unrelated draft changes before any separately authorized Wix publish. Verify editor import resolution and the native backend crypto dependency. The current repo already uses `import crypto from 'crypto'` and `randomBytes` in `pricingQuote.js`, and RSA crypto in `dataManagerClient.web.js`; no npm dependency or new key is introduced. Local Node execution and official Node-runtime docs do not prove published-site compilation.
7. Only after installation/permissions/import verification, separately activate `googleAdsPrivateJournalEnabled=1` while Google suspension is explicitly OFF. Missing/uncreated collection fails closed for conversion and does not block booking confirmation. No automatic historical send occurs. Observe only a separately authorized new real booking; do not fabricate click IDs or send a test merely to obtain a request ID.
8. Roll back first by setting the new key to `0`, not by deleting journal rows. Keep the private helper and coordinated safe sender while investigating. Restoring the old anonymous sender or admin retry reintroduces the preexisting unguarded dispatch path and is not a safe rollback.

Official references inspected: [Wix Node backend](https://dev.wix.com/docs/develop-websites/articles/coding-with-velo/backend-code/about-the-site-backend), [native insert rejects existing IDs](https://dev.wix.com/docs/velo/apis/wix-data/insert). Hosted SDK guarantees, ACLs and code compilation remain installation verification gates; no live schema writes were made.

## Legacy retraction flags and remaining constraints

After a persisted Google ingestion ACK, backend loads the **privately bound Summary ID**, checks its exact booking number, and sets `googleConversionUploaded=true` while preserving native dates, financial fields and `googleConversionRetracted`. The browser no longer owns that write. Existing cancellation gates in `availability.web.js` and `adminConsole.web.js` remain unchanged: uploaded true and not retracted. Historical flags remain valid legacy gates. The flag now explicitly records ingestion acknowledgment, **not attribution**. If the backend flag update fails, the private RESULT survives, the RPC reports `legacyFlagUpdated:false`, and automatic cancellation retraction may still be skipped until a separately reviewed manual flag repair. Do not resend the conversion to repair it. No retractions were invoked.

The unsafe legacy Admin retry method now returns `RETRY_DISABLED_UNKNOWN_HISTORY` without reads/writes/provider entry. Old bookings missing a token receive a clear denial. **WC-1030 stays UNKNOWN; no capability, backfill, upload or retraction is created for it.**

The existing financial snapshot, GA4 exact numeric value (including zero), stay dates, UI and 2000-ms redirect are preserved. Client contacts/value/time remain **UNVERIFIED**; mutable Summary contacts and additive invoice totals are not promoted to ownership or financial authority. The existing public additional-room updater can still mutate contacts. Private AUTH remains separate and unchanged. No full-cart receipt, pricing rewrite, public booking authorization rewrite or financial-race fix is claimed.

**No browser-close guarantee:** the existing page starts Google asynchronously and keeps its existing redirect timing. Awaited backend persistence improves observability when the invocation survives, but Wix can cancel execution before provider completion or RESULT persistence. A retained ATTEMPT with no RESULT remains UNKNOWN and permanently nonretryable through this sender. This is bounded admission plus at-most-one provider entry per native attempt, not guaranteed completion, exactly-once provider effect, attribution or retry delivery.

Legacy Summary updates remain whole-row updates, not transactional field patches; concurrent legacy writers can still race with the uploaded flag and other fields. Capability possession authorizes only this single conversion attempt, not proof that the entire cart was saved honestly. Booking allocator collisions, cross-request additive invoice races, swallowed booking draft/Summary failures and existing public mutation surfaces remain scoped legacy constraints.

## Offline evidence

`node --test tests/google-ads-private-journal.cjs` executes actual private helper, sender, client transport and booking-producer orchestration with inert SDK/transport and labelled fixed test entropy. It separately exercises the actual public Summary updater and actual full Summary page through existing repo-relative test support. Booking financial/availability dependencies in the producer orchestration fixture remain inert; this is not a live booking or distributed Wix concurrency test.

`node --test tests/google-ads-upload-reliability.cjs` exercises the unchanged actual Data Manager client. `node tests/attribution-hotfix.cjs` retains all 41 original assertions; its three-file pin manifest is refreshed for this candidate's deliberate source edits (not inherited review approval). Original pins and native RED/GREEN reports are under `C:/Users/TomDe/checkpoints/google-ads-journal-*`. The old `google-ads-journal-admission-blocker.cjs` is historical baseline vulnerability evidence and is not a candidate acceptance suite.

Observed causal RED slices: unrestricted forged dispatch, absent first-room capability, missing Summary handoff, raw booking-object logging. Follow-up fault/concurrency coverage was added against the working candidate and is baseline-GREEN extension coverage, not falsely labelled separate historical RED. Early fixture errors (undefined failGet inadvertently matched Summary's missing kind; financial-settings failure was incorrectly used as conversion-only failure) were corrected without runtime changes. No external provider, browser, live SDK, secret retrieval or Wix writes executed.
