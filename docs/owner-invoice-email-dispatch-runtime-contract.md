# Owner invoice email journal — OFF, local review/recovery candidate

## Authoritative bounded increment (historical sections below superseded)

Committed queue/recovery closure: `d03daf60debb2add3ad2a1cc8b893ac3f5a0f5c8`.
Active-profile checkpoints `essential-email-review-recovery-final-review.json` and
`essential-email-review-recovery-parent-commit.json` retain the prior closure evidence.
The new private REQUEST recovery below is uncommitted and awaits exact-byte review.

The fourth new Admin method (fifth total including legacy `issueInvoice`),
`listOwnerInvoiceReviews(cursor)`, uses fixed two-root
ISSUANCE/_id keyset pages and the strict existing state reader. Cursor is null or
primitive lowercase 64-hex. Sanitized list/status never prepares or sends mail.
Unknown/corrupt state stays unresolved. START means possibly in flight / outcome
unknown, never failed or unsent; a valid ACK means provider accepted, not delivered.
Clients upsert by ID and must not clear prior review on page omission. A fresh valid
late ACK clears provisional review. Pages always declare snapshot:false.

The strict private no-store `scanPending` variant and Python adapter feed
`recover_pending_once`: two pages, four roots, one dispatch attempt, one shared
128 bridge-operation facade. Partial pages deny work from that page, pending rows
skipped after the attempt are explicitly deferred. The existing dispatcher freshly
reads state and alone owns unique START arbitration. START never expires or grants
resend. No admission/financial/dispatcher body changed. Named service startup runs
one pass behind the existing literal false gate; OFF returns before configuration
or journal/provider work. No timer, periodic scheduler or live activation is added.
The bound counts IO, not wall-clock cancellation.

Legacy/guest producers, full keyless booking integration, durable scan cursors and
periodic delivery guarantees remain excluded. REQUEST recovery is private and OFF.
Later callers must preserve cursors/reset cycles; short restarts do not guarantee
full backlog progress. Booking recovery remains independent of email uncertainty.
Hosted auth, consistency/uniqueness, quotas/privacy/retention/restore, exact deployed
transport, integration and runtime rollout remain gates. Live systems unverified.

Prior R1-R12 closure is committed; historical partial labels below are not current
readiness claims. New RR01-RR12 execution and exact hashes are recorded in
active-profile checkpoints/essential-email-request-recovery-implementation.md.
Independent review of these new bytes and all hosted/runtime gates remain pending.

### New local REQUEST-only admission recovery (independently OFF)

`recoverOwnerInvoiceRequestsOnce(cursor)` is a private module export, not a web or
HTTP operation. Its independent literal `OWNER_INVOICE_REQUEST_RECOVERY_ENABLED = false`
returns `{status:'disabled'}` before SDK/configuration work. Activated local fixtures
accept exactly one argument: null or primitive lowercase 64-hex discovery cursor.
No supplied REQUEST object, command, actor or service secret provides authority.

Recovery queries REQUEST rows, rereads exact IDs and validates detached canonical
application envelopes (160000 UTF-8 bytes including escaped document bytes), actor/
request key, original document/revision/digest and recipient bindings. It derives
only the original ISSUANCE. No repricing, new REQUEST, revision, parent qualification,
artifact/chunk loading, START/ACK insertion, dispatch or send grant is permitted.
Valid retained qualified children remain admitted after later parent START or ACK.
Custody under the reviewed immutable private Admin writer is a runtime prerequisite;
shape/hash consistency is not cryptographic provenance. Imported/restored unknown
histories require quarantine/OFF. Metadata is excluded from application identity;
complete hosted storage-envelope quotas including metadata remain a separate gate.

Fixed keyset pages contain at most two REQUESTs; at most two pages/four candidates
are examined. Every candidate on a page is classified before any page mutation.
Bad/unknown candidates stop that page without writes; earlier pages are not rolled
back. Existing exact roots are already_present with zero mutations, preserving a
different Admin winner's creator. Missing roots require exactly-null target-local
ARTIFACT/START/ACK reads. Unknown or orphan stages deny reconstruction.

At most one ISSUANCE insert attempt is made, with exact readback reserved in a shared
24-native-SDK-call budget (2 + 4*5 + 2). Acknowledged insertion requires the candidate
actor; duplicate/lost ACK may reconcile a valid same-content other-creator winner.
Unknown readback remains unresolved, never retries within that pass and never rolls
back retained storage. The next fresh pass adopts an existing root without mutation.

Sanitized protocol owner-invoice-request-recovery/v1 reports status, counters,
request-record/issuance IDs, admission-only outcomes/deferred IDs, nextCursor,
cycleEndObserved and snapshot:false. Invalid/partial pages retain their input cursor.
Explicit deferrals are not a durable queue; no fairness/backlog completion claim.
This SDK budget is not a wall-clock deadline. Existing effect review remains separate:
already_present does not clear owner review or claim delivery. HTTP, Python startup,
periodic behavior and all existing activation gates are unchanged. No live proof or
full-booking/keyless integration is established by the synthetic native SDK fixtures.

## Historical records


## Historical final scoped closure (not current readiness)

N2 now executes the actual authenticated HTTP bridge with missing/wrong secret and
forbidden creation, generic-write and callback-shaped commands, asserting zero SDK IO.
The permanent gate traverses actual JS/web.js/JSW production consumers and exercises
parser-valid forbidden/legacy-alias fixtures, including the old JS-only filter reversal.
Python forbidden-operation tests assert zero transport.

N8 reconstructs distinct actual Python dispatcher and bridge-adapter module objects
with fresh boot state over writer-produced retained START-without-ACK and ACK histories.
The actual endpoint returns review/accepted respectively with readIssuance only and
zero additional START/provider/mutation calls. Existing paused late ACK and pre-START
retry schedules remain. This is module reconstruction, not a fresh OS-process claim.

`dispatchOwnerInvoice` and `getOwnerInvoiceDispatch` now exist on the existing Admin
web module, with literal default OFF and authenticated actor validation. Existing roots
are strictly resolved before dispatch; creator audit is not per-Admin ownership. Only
the fixed existing `/issue-invoice` journal variant is sent. Status reads never wake the
service; START/ACK dispatch readback does not wake it either. Legacy callback bytes,
reviewed financial adapter and renderer bytes remain unchanged. Actual missing-export
RED preceded implementation; callback/platform/HTTP fixtures are local, not hosted proof.

Execution: **63 passed, 1 existing deprecation warning**, Python 3.13, plus actual Node
admission/bridge/wiring gate PASS and JS syntax/diff PASS. Evidence is the active-profile
`checkpoints/essential-email-endpoint-final-closure.md` and `essential-email-final-tests.log`.
**Remaining blocking gate:** the unchanged nonowned
`verify-cms-raw-invoice-bridge-permissions.js` fails `Expected exact import`, because it
pins the pre-wiring journal import and exactly two web exports. Its bytes are preserved
as requested; a separately authorized exact compatibility update and independent combined
review are required. No waiver or aggregate release PASS is claimed. All 15 protected
and 18 nonowned dirty paths remain unchanged. Feature OFF; live Wix unverified.

Startup/list/full booking/keyless integration and runtime rollout gates are not added
to this bounded closure. No stage, commit, push, schema/configuration or provider action.


## Historical continuation status (not current readiness)

The actual `/issue-invoice` strict `owner-invoice-journal-v1` branch, fixed authenticated
`post_invoiceEmailJournal`, Python adapter, immutable chunk/manifest/START/ACK journal,
and journal-only Gmail transport now exist as **uncommitted, locally tested candidates**.
All three activation constants remain literal false. No live schema, configuration,
provider email, deployment, publication, or browser action was performed.

The preserved cross-language tracer uses actual Admin admission, FastAPI, fixed Python
bridge, freshly reconstructed JS modules over serialized inert SDK storage, ReportLab,
MIME, and actual requests transport with an inert boundary. This continuation changes
only permanent coverage and this document, not production or reviewed N3 adapter bytes.

Locally exercised: malformed/unauthorized/missing/tampered-root denial; pre-START
credential failure then safe retry; disposable issuance-specific render paths;
competing actual renderers with distinct MIME and immutable winning manifest; missing,
tampered and oversized retained artifacts deny before START; START insert ACK loss,
readback loss and bridge-response loss never send; duplicate START never grants;
provider timeout/reset/401/redirect/bad status/malformed response never resends;
exact ACK replay and wrong-nonce/changed-ID conflict; lost ACK retries ACK only;
suspended provider winner permits a second real endpoint to observe review, then
retains its matching late ACK. Each endpoint invocation uses fresh bridge sessions;
each bridge operation reconstructs actual JS modules. Changing Python BOOT_ID during
the paused schedule is not a fresh Python interpreter restart test.

Final execution evidence: active-profile checkpoint
`essential-email-endpoint-continuation-final.json` and its referenced logs/hashes.
N1 and N6 finite local coverage are complete, **not independently reviewed**.
N2, N3 (consumer coverage; reviewed prerequisite preserved), N4, N5, N7, N8 and N9
retain explicit review/coverage gaps in that checkpoint. No aggregate acceptance
criterion is claimed complete from the passing tracer. Approved Admin dispatch/status
wiring, incoming-consumer exclusions, startup/list visibility, full booking/keyless
integration and independent consumer byte review remain. Existing legacy scheduling
and download/calendar security regressions pass. No new frontend or force-resend exists.

## Historical admission-only increment (retained context, not current inventory)


**OFF; partial implementation; not publication-ready.** The sole new web method is
`prepareOwnerInvoiceDispatch`, guarded by `Permissions.Admin` and a literal false
activation gate. Existing `issueInvoice` is unchanged. No HTTP bridge, Render
journal branch, dispatch, status/list, START, ACK, artifact store or sender exists
in this increment. `durably_prepared` means exact REQUEST/ISSUANCE readback only;
it does not mean queued for a running sender, booking completion or email sent.

## Implemented admission tracer

The actual Admin callback captures `currentUser.id`, rejects missing actor, and
calls the private `invoiceEmailJournal.js` module. No actor/role/ownerOnly/completed
or guest credential is accepted from the command. The module validates and
snapshots the complete command before SDK IO. It inserts REQUEST before ISSUANCE,
then compares every application field after consistent readback. Duplicate insert
and lost acknowledgment may reconcile admission only: this pattern MUST NOT be
reused to reconstruct a send grant.

Required command fields: requestId and revision (UUID, spelling preserved),
invoiceNumber, issueDate, guest {name,email,phone}, checkIn, checkOut, roomCode,
purpose (`guest_invoice` or `owner_copy`), payments (explicit ordered array), and
financial. Optional bookingNumber is reporting only. Optional parentIssuanceId
and reissueReason must occur together. New linked commands inspect valid existing
same-number, distinct-revision ancestry (bounded at 100 roots) before REQUEST.
Complete no-START/no-ACK permits a distinct non-superseding document. START
without ACK denies new commands for owner review. Exact retained REQUEST recovery
finishes only its original root without reconsidering a later parent START.
Exact valid START/ACK plus a complete digest-bound retained artifact permits a
new explicit child. Missing/corrupt artifacts deny before REQUEST. This reads
immutable SDK stage evidence only; no sender, MIME builder or START writer exists.

Financial is {currency: 'USD', components, lines}. Components are integer cents:
grossCents, discountCents, roomTotalCents, propertyFeeCents,
accommodationVatCents, packageVatCents, totalVatCents, grandTotalCents.
The component reconciliation equations follow Invoice.explicit_vat_amounts;
line net/VAT totals must agree, with class-specific VAT checks. Lines explicitly
carry label, taxClass, quantity, roomQuantity, unitPriceCents, netCents, vatCents,
grossCents and vatRateBasisPoints. Payments contain datePaid and
paymentAmountCents. Fractional quantities are unsupported; do not round them.
The disconnected `invoice_from_owner_issuance` strictly validates canonical root
integrity (not provenance), maps exact Decimal amounts through Invoice.from_quote
with internal component_cents, and preflights markup/quantity presentation loss.
Entity-like `&name`, `&#decimal` and `&#xhex` prefixes are unsupported display
text even without a semicolon: ReportLab may interpret them. Preparation rejects
rather than rewriting the canonical string or escaping the shared Invoice;
ordinary literal `A & B` remains supported. Renderer sources remain unchanged.
No pricing or BookingPayments importer exists. Actual DOCX, LibreOffice PDF,
ReportLab and real selector fallback are locally exercised. Word net-only versus
ReportLab gross/discount presentation differs intentionally. Word capacity+1
rejects visibly; complete ReportLab fallback retains rows/payments. Independent
exact-byte/parity review is mandatory before any incoming production consumer.

Canonical JSON sorts keys and preserves arrays. Versioned domain-separated
SHA-256 IDs bind actor/request and invoice/revision respectively. The canonical
document excludes requestId, allowing a new request ID to resolve the same effect.
Root actor is immutable creator audit, not per-Admin ownership. Cross-Admin
same-document duplicates converge; each REQUEST retains its own exact actor.
Acknowledged first insert requires that exact candidate readback; duplicate/lost
ACK may reconcile a valid same-content winner without rewriting its actor. Explicit recipients
are guest To + fixed hotel Cc, or hotel-only To with empty Cc. Fixed From is hotel.
Each complete canonical application record, including escaped document bytes,
is capped at 160000 UTF-8 bytes. Allowlisted `_createdDate`, `_updatedDate` and
`_owner` SDK metadata are excluded from both application equality and this size
check, including null/Date metadata; unknown application fields still reject.
No number/date/settings defaults are consulted.

## N3 retained parent artifact read format

ARTIFACT exact application fields: _id, kind, issuanceId, documentDigest, to, cc,
from, chunkIds (ordered), mimeDigest, byteLength, pdfDigest, rendererVersion.
ID is H([invoice-artifact/v1, issuanceId]); START.artifactDigest is SHA256 of
canonical application manifest bytes (allowlisted Wix metadata excluded).
ARTIFACT_CHUNK fields: _id, kind, data (canonical base64), digest (decoded bytes
SHA256). ID is H([invoice-artifact-chunk/v1, digest]); manifest order supplies
contiguous concatenation. Each encoded chunk <=100000 chars, <=128 chunks, total
encoded <=11184812 chars and decoded <=8388608 bytes. Validate all chunk hashes,
canonical concatenated base64, complete byte length/full digest and root envelope.
PDF digest is retained manifest binding; this stage reader does not parse MIME
or extract a PDF. Actual MIME/PDF semantic preparation remains the endpoint
tranche gate, not a claim established by synthetic stage fixture payloads.
No artifact publication, START creation or provider call is added here.

## Not provisioned / mandatory future runtime gates

`InvoiceEmailJournal` is a proposed private backend-only Wix collection; this task
creates no live schema. Verify unique explicit `_id` insertion, consistent reads,
ACLs, quotas and permanent immutable retention/backup before activation. Local
SDK fixtures are not hosted platform evidence. The future narrow fixed bridge
must not create REQUEST/ISSUANCE and requires separately authorized provisioning.
No new runtime secret/configuration or route has been created.

Admin webMethod denial is executed using an explicitly synthetic platform fixture;
real anonymous/member/Admin Wix authentication remains unverified. Incoming
consumer isolation across JS, web.js and JSW still needs the complete executable
gate. Legacy public deputies remain unchanged and not declared safe.

## Remaining frozen criteria

1. Partial Admin admission only; actual endpoint positive control, complete
   public-consumer isolation and all authority negatives remain.
2. Partial request replay/conflict/concurrency and request/root crash recovery;
   artifact winner and START grant/lost acknowledgment semantics remain.
3. PDF/MIME/credentials/chunk preparation, durable diagnostics and recovery remain.
4. Actual one-POST Gmail transport and every invoked-uncertainty schedule remain.
5. Exact retained ACK, conflicting outcomes and ACK-write recovery remain.
6. START/restart/paused-worker schedules and durable status/list visibility remain.
7. Partial document/recipient/payment admission; parent/reissue rules, full
   financial-renderer parity and MIME/chunk/attachment stability remain.
8. Admission touches only journal SDK; actual endpoint/provider separation,
   legacy regression and booking/keyless recovery integration remain.

No criterion is complete. Do not add a force-resend route or clear START when the
remaining implementation is built. Retained START without ACK must mean owner
review, never permission to automatically retry. Independent review of this
increment's exact bytes is next; full email functionality is not claimed.
