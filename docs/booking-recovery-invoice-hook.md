# Private recovery → initial invoice admission hook

## Scope and result

Candidate on exact MIME commit `b78a8ef7d0e5438f47cc08ac13b6919db4feb6b3`. Not committed, reviewed, scheduled or deployed. The existing private recovery quantum now awaits the committed immutable initial-invoice admission only after its actual coordinator returns an own-data `CONFIRMED` status. No new coordinator, transport, endpoint or scheduler is introduced.

Graph:

```
recoverGuestBookingCompletions() [private, zero args, still no jobs caller]
  → progress head/reserve → discoverGuestBookingAcceptances(cursor)
  → capture selected context's primitive A/O/D before coordinator await
  → resumeGuestBookingPhysicalAcquisition(A)
  → CONFIRMED hint only
  → advanceInitialGuestInvoiceForRecoveredAcceptance(A,O,D)
    → readRecoveredGuestBookingCompletion(A,O,D)
      → readGuestBookingInvoiceSiteAudience() [WBE_GUEST_BOOKING_KEYS audience only]
      → actual retained receipt/physical/model/two-pass verification
    → deterministic GuestBookingInvoiceIssuances admission
  → unchanged visit/progress append protocol
```

The snapshot requires exactly one matching context, lowercase primitive 64-hex A/O/D, selected A equality, and existing NUL-domain A derivation from O. It never derives expected subject from the coordinator result, receipt, browser, or job argument. Invalid invoice context defers only invoice work. Retired signing keys and guest/offer expiry do not gate durable accepted-work replay; absent audience defers invoice only. Receipt verification, not the scheduling hint or admission journal, establishes confirmation.

Invoice status/exception cannot alter coordinator classification, compensate or unconfirm a booking. Admission is awaited and has existing bounded read/write counts and retained-reader budgets. **No new wall-clock timeout guarantee:** a stalled native SDK promise remains a scheduler/runtime gate; no Promise.race or detached write pretends to cancel it. Completed replays revalidate retained authority and converge on one issuance identity without an additional admission insertion. START/provider code is absent from this closure.

Read-only retained completion, discovery and progress-head remain observers. No invoice or recovery call was added to guest status/access endpoints. Existing legacy public invoice routes remain unchanged and are not certified secure by this work.

## Finite execution admission

`scripts/fixtures/recovery-invoice-hook-admission.json` freezes **37 pinned backend modules; 34-module recovery closure**, plus three retained-fixture/dependency files. `guestBookingAllocationEvidence.js`, `guestBookingAllocationHandoff.js`, and `wholeCartPlanningRules.js` are pinned provenance dependencies, not reachable from recovery or the other hook test entry modules; do not count them as runtime-loaded. Canonical hashes allow only CRLF→LF. External bindings are inert wix-data, wix-auth, wix-secrets-backend.v2, Node crypto and buffer. Loader rejects all other modules. SDK insert permits only initial admission and administrative recovery progress; booking mutations, START and provider writes reject. No other verifier, fixture producer, full/default/restricted suite or Python service executes.

Run only:

```
node --experimental-vm-modules scripts/verify-guest-booking-recovery-invoice-hook.js --hook
```

The standalone harness derives its inert fixture/loader mechanics from the committed admission verifier but does not import or dispatch that verifier. Writer-produced history and distinct foreign history are authenticated retained files, not regenerated producer output. Ordinary tests use unchanged actual modules. RH05/RH09 add one declared recovery-source tap after actual discovery to mutate/observe its returned page; actual discovery, coordinator, reader and admission still execute. This is an explicit fault seam, not a claim that storage normally mutates those detached contexts.

## Local behavioral evidence

RH01 was RED against unchanged recovery (native exit 1, zero admission), then GREEN after the hook. The first attempted RED stopped before backend dispatch on the inherited raw fixture hash under CRLF checkout; exact Git blobs established LF equivalence and only this new harness's fixture hash reader was corrected. Subsequent coverage additions were baseline-GREEN, not manufactured RED.

Ten named assertions pass in the pinned run (native exit 0): actual completed recovery admission; fresh-module replay without duplicate admission/START; retired keys, year-2100 clock and no deposit/guest credential; config and admission ACK/readback uncertainty preserving independently reverified completion; pre-await A/O/D snapshot despite later B mutation; legitimate distinct local B; read-only observers; unresolved coordinator with no invoice IO; malformed context deferring only invoice; pending retained reader returning no authority and zero writes. Final count is asserted by the harness. Node reports only its expected experimental VM-modules warning.

Evidence covers **completed retained accepted-work replay**, not regeneration of an unfinished acceptance by excluded producers or live Wix storage. Email uncertainty itself retains historical MIME/dispatcher evidence; this new test executes admission uncertainty, never sends. A new delivery-state test cannot be credited from the zero-START graph alone.

## Exact next private service interface proposal — NOT implemented

Source establishes no authenticated guest service binding: `booking_engine/guest_invoice_delivery.py` explicitly requires a supplied private transport; `invoice_service.py` has owner-invoice lifespan and existing legacy routes, not a guest dispatcher binding. Owner `InvoiceEmailJournal`/X-WBE-Secret transport is not guest subject authority. Do not reuse it as one.

Proposed next finite adapter must bind immutable server-captured `{audience,A,O,D,issuanceId}` to a private invocation before any request. Python's existing `dispatch_initial_guest_invoice(issuanceId, journal)` calls:

| Python call | Actual JS operation payload |
|---|---|
| `journal.call('readIssuance', issuanceId)` | `{}` |
| `journal.call('commitArtifact', issuanceId, payload)` | `{encoded,mimeDigest,pdfDigest,rendererVersion}` |
| `journal.call('tryStart', issuanceId, payload)` | `{artifactDigest,invocationNonce}` |
| `journal.call('recordAck', issuanceId, payload)` | `{artifactDigest,invocationNonce,providerMessageId}` |

The backend maps only that already authenticated bound context to `guestBookingInvoiceDeliveryOperation(A,O,D,operation,payload)`. It must verify requested issuanceId equals the binding and configured audience remains the site audience. No browser-selected A/O/D, recipient override, receipt DTO or Boolean authority. No URL/header/key/signature is invented here. A concrete authenticated channel, replay/tenant binding, secret custody, bounded transport/response sizes and retry behavior require independent design/source approval before a route exists. START must never be transport-retried or reconstructed following lost acknowledgment; only native successful insertion plus exact readback yields the existing nonce/artifact-bound ephemeral grant. ACK retries remain exact ACK reconciliation, never provider retries.

Next implementation is this finite private transport binding and actual dispatcher consumer once authenticated service authority is established—not another receipt mapper. Scheduler cadence/lifetime/concurrency, private ACL/index/visibility, guest capability access and coordinated public replacement remain separate gates. No real send, CMS change, deployment or publication is authorized.

## Review gate

New recovery→issuance and recovery→identity-helper edges intentionally change previously disconnected custody. The guard-only successor `scripts/recovery-invoice-hook-guard-package.json` preserves the historical custody and final-package trust roots, applies four exact before/after custody records, and adds only the finite hook/guard packaging members. Its effective recovery `application_imports` contains the three old edges plus issuance and IssuerAuthority. Byte-only export produces Git-canonical LF; it validates historical CRLF restoration hashes without rewriting runtime checkout bytes. The original packaging route remains historical and is not claimed to pass on this successor.

GI11 and GDR08 incoming guards admit only the complete reviewed recovery source/hash and exact five static imports, never recovery→delivery or a broad caller exemption. The Python entry fence retains recovery outside `OWN`. The old recovery verifier changes only its recovery pin and the three already-reviewed newly reachable module pins; its old orchestration fixture, loader bodies, producer selectors and execution restrictions are untouched. The retained `--hook` 10-ID evidence is reused for unchanged runtime/harness bytes, not rerun here.

Only extracted GI11 source scanning (before its fixture call), GDR08 incoming helpers (not graphRegression), recovery pin/resolve/compile declarations (no backend evaluation), backend-free entrypoint controls, and byte-only successor package controls are admitted in this correction. The inherited GDR08 delivery body pin mismatch and B08 delivery→reader mismatch remain unmodified, unwaived and NOTRUN. No producer, full/default/restricted suite or historical audit dispatcher may be invoked indirectly. Revised guard/package bytes require separate independent review before any staging or commit; no new backend dependency receives execution approval from these controls.
