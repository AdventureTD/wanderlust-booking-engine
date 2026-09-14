# Google Ads transport safeguards — partial candidate, coordinated fix ON HOLD

Base: `7f44435b1338969e404b2c8d950d77cd6500b9fd`. This is **not** a completed durable-upload fix or a Wix installation release. No live changes, Google API calls, schema creation, historical backfill or WC-1030 resend were performed. WC-1030 remains UNKNOWN.

## Implemented local scope

`velo/backend/dataManagerClient.web.js` now requires a nonblank `requestId` from a successful ingest response; empty, array, missing-ID and invalid-JSON success cannot be reported as accepted. `fieldWarnings` with a request ID are allowed. Explicit rejection objects fail. Pre-ingest token/serialization failure is `not_attempted`; errors after entering fetch are conservatively `unknown` (including HTTP errors). Structured exceptions expose fixed `code`, `outcome` and optional `httpStatus`, not provider body/payload/credential exceptions. There is one fetch invocation and no retry loop. This is not SDK/native retry verification or cross-request deduplication.

The acknowledgment remains ingestion acknowledgment only: neither completed processing nor attribution. The returned request ID is still **not durably persisted**. No attempted/acknowledged record or ledger is added. Existing higher-level sender logging/debug payload exposure remains outside this bounded transport-only candidate; do not claim all logging is sanitized.

## Exact blocker from current incoming flow

`googleAdsConversions.web.js` record method is `Permissions.Anyone` and accepts arbitrary transaction ID, value and contacts without a guest credential. Summary sends precisely that shape at lines 1075–1092. Booking creation returns a booking number, not an authenticated guest-operation receipt. Its pricing quote token does not authenticate ownership of a completed arbitrary booking. Do not add privileged BookingSummary updates or an unrestricted private-CMS writer behind this unauthenticated interface. This is a pre-existing public privileged sender, not a new send authority introduced by this transport patch.

Server financial totals exist in `BookingInvoices`, not reliably `BookingSummary.grandTotal` as legacy retry assumes. `availability.web.js:createDraftInvoice` selects mutable Active/Draft state and accumulates room totals; Summary uploads its accepted `financialSnapshot` before independent invoice creation. There is no retained immutable whole-cart acceptance/value contract tied to a guest proof in this current flow. Selecting latest invoice or trusting caller value would change or invent authority, not preserve accepted financial truth. That limits claims of financial authority; it does not make a full-cart receipt a prerequisite for honest transport telemetry. A private append-only attempt may label its input provenance UNVERIFIED and record ingestion acknowledgment without claiming financial correctness, processing success, attribution, or setting uploaded flags. Such instrumentation still needs bounded admission and privacy controls: private collection permissions alone do not prevent public callers exhausting storage or claiming another booking's deduplication key. No evidence establishes a new whole-cart receipt as an owner requirement for this bounded legacy instrumentation task.

Consequently backend flag ownership, atomic attempt claim, browser flag removal, status reconciliation and redirect cutover remain HOLD. The Admin retry path remains unsafe for unknown historical attempts and is NOT authorized for use. No WC-1030 attempt is created.

## Timing decision

This candidate leaves Summary **byte-for-byte unchanged**, including its existing 2000-ms timer, GA4 purchase, Microsoft path, invoices and booking UI. That timer still starts without awaiting Google; it does not guarantee backend completion. The eventual coordinated design should await an authenticated backend attempt/result acknowledgment before redirect, accepting that requests over two seconds exceed the target. A UI timeout/Promise.race cannot establish durability. Native Wix browser-close/request lifetime is unproven; an exclusive persisted attempt prevents blind resend but cannot guarantee effect completion. No scheduler or background lifetime guarantee is proposed.

## Status API prerequisite

Official docs read 2026-09-14:
- https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest — requestId, optional fieldWarnings.
- https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve — `GET https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=<encoded-original-ID>`, empty body, Data Manager OAuth scope, `requestStatusPerDestination`.

Do not query by booking number, resend to obtain an ID, treat PROCESSING as failure, or make all warnings fatal. A future authenticated read-only reconciliation path must retain the original ID and destination and distinguish FAILED/PARTIAL_SUCCESS from ingestion acknowledgment. No status query was executed or implemented in this transport-only candidate.

## Installation / schema

**Do not install as the requested complete reliability release.** Parent must independently review this partial diff and decide whether to deliver it separately. If separately approved after review, the only runtime copy is `velo/backend/dataManagerClient.web.js` to Wix `backend/dataManagerClient.web.js`. No collection or field additions are required for this partial candidate. Any durable follow-up needs reviewed caller admission, atomic unique attempt insertion, bounded private storage and explicit schema approval before code/schema changes; financial-authority claims additionally need an appropriate trusted value contract. No speculative ledger fields are presented as installation prerequisites.

## Verification

Run `node --test tests/google-ads-upload-reliability.cjs` (actual client VM; inert OAuth/fetch, no sockets) and `node tests/attribution-hotfix.cjs` (existing actual Summary regression). RED/GREEN native transcripts are retained externally in `C:/Users/TomDe/checkpoints/google-ads-upload-{red,green}-{1,2}.txt`.

Durable duplicates/concurrency, database failure after provider, backend persistence despite ignored browser callback and native browser closure are **NOTRUN / NOT IMPLEMENTED**, not passing tests. Do not substitute client one-fetch tests for these acceptance criteria. Independent review passed the bounded transport runtime and existing targeted regression; the reviewer also corrected the overbroad telemetry prerequisite above. This is eligible for a separately labeled partial GitHub delivery, not full reliability completion or Wix publication.
