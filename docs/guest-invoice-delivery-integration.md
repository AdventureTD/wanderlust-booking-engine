# Initial guest invoice delivery: disconnected integration contract

**Proposed documentation/support, requiring independent review. Not deployment or commit approval.**

## Authority and lifecycle boundaries

- A safely completed booking remains confirmed independently of invoice preparation or uncertain email delivery. This tranche does not complete pending bookings, collect deposits, cancel bookings, or reserve rooms.
- Actual retained completion validation and initial issuance admission are separate from dispatch authority. A projection/digest, booking number, intent-resume credential, caller-supplied root or owner journal is not guest invoice authority.
- `guestBookingInvoiceDeliveryOperation` is a private operation interface bound to server-discovered acceptance/operation/root identity. `booking_engine.guest_invoice_delivery` consumes a trusted private transport; that production transport and its public authorization boundary are not implemented here.
- `INITIAL_ISSUANCE_ADMITTED` means admission only. `READY` means validated initial/prepared state, not a send grant. `PREPARED` binds immutable MIME/PDF digests and exact saved bytes, not delivery.
- Sending requires the current call's exact `won: true` grant, invocation nonce and artifact digest after native START insertion and exact keyed readback. Existing START, duplicate insertion/readback, lost acknowledgment or status reads never reconstruct a grant. No provider or START retry is permitted after uncertainty.
- `PROVIDER_ACCEPTED` means a valid provider message identifier and validated retained acknowledgment. It does not certify recipient receipt, inbox placement or exactly-once distributed delivery. `OWNER_REVIEW_REQUIRED` must not be treated as permission to resend.
- Before START, invalid/missing journal state, unresolved payment state, token/render/MIME/commit failure returns `UNAVAILABLE`. At START an absent/invalid grant or exception returns Python `OWNER_REVIEW_REQUIRED`, including when the underlying JS response was `UNAVAILABLE`.
- After one provider invocation only the identical ACK payload can be retried, at most twice. ACK recovery returns `PROVIDER_ACCEPTED`; exhaustion or uncertain provider outcome returns `OWNER_REVIEW_REQUIRED`. A later read never initiates sending.
- Only positively verified empty retained BookingPayments are admitted in this initial tranche. Unknown, absent, incomplete or nonempty payment state is not an invented zero balance or paid-booking support.

## Financial and rendering contract

Preserve original ordered accepted groups, integer component cents and exact Decimal Invoice values; do not regroup, recalculate current prices or infer a tax rate. Completion financial/projection digest domains use newline; acceptance and issuance/delivery identities use NUL. Preserve the Word template and existing Word-to-PDF primary renderer and ReportLab fallback. The inert guest tests establish mapping arguments and MIME artifact semantics, not rendered document contents, LibreOffice execution or renderer parity. Recipient is guest To, hotel visible Cc and hotel From, with no Bcc/Resent recipients and one exact PDF attachment.

## Evidence status at this proposal

- Independently authenticated saved GP01/03/04, GP05/06/10 outcomes: local behavioral evidence reused, not a fresh combined run.
- GP02 mapping is partial: actual admission must still supply distinct-valued original groups and observe their rendered order. Both declared retained histories have identical financial groups; a projection-only fixture cannot be promoted into retained completion authority.
- GP07–09 latest lifecycle test/support bytes are included unchanged. Its saved report records 12 passing IDs; this packaging task does not independently approve or rerun that behavioral evidence.
- GDR01–08 JS approval belongs to the separate exact-byte JS review. This support does not replace its scanner or transfer old bridge execution to new verifier bytes.
- GP11: the proposal now checks the exact application source set under `velo/` (.js, .web.js, .jsw, .html), `booking_engine/` (.py), and root Python entrypoints, including `invoice_service.py` and `booking_engine/invoice_email_recovery.py`. Static imports are parsed without evaluation; literal incoming delivery/admission references are absent except in the three exact owned runtime modules. Full-file pins and exact file-set equality reject added content/files. Inactive-by-disconnection is not a tested default-OFF gate.
- Real transport wiring, computed-import dataflow/outside-root consumers, combined-current execution, renderer parity, independent support review, combined exact-path packaging approval and live verification remain separate gates. No schema changes, publication, deployment, live token or provider calls are authorized.

## Portable package closure (proposal)

The machine-readable `scripts/guest-delivery-custody.json` declares every packaged dependency and application scan file with raw/canonical SHA-256, LF/CRLF/binary restoration, exact Python imports and the complete finite `application_imports` map. Its own bytes are an externally pinned trust root, not a recursive self-hash.

Test support is repository-relative:

- `scripts/verify-guest-booking-invoice-delivery.js`: first-four actual `--bridge` adapter remains inside the unchanged reviewed verifier. Its entire bridge suffix equals the historical first-four suffix.
- `scripts/python-middle-bridge.cjs`: unchanged middle adapter beside that verifier.
- `scripts/python-lifecycle-bridge.cjs` and `tests/guest_delivery_lifecycle_support.py`: unchanged latest lifecycle adapters.
- `tests/test_guest_invoice_delivery.py`: latest lifecycle candidate, preserving the entire first-four/middle raw-byte prefix; no assertion or path edits.
- `scripts/guest_delivery_custody.py`, `scripts/guest_delivery_entrypoints.py`, `scripts/guest-delivery-static-imports.cjs`: offline source custody, finite incoming scan, and Node static parser. Parsing creates unlinked SourceTextModules only, with no application evaluation.
- `scripts/test_guest_delivery_custody.py` and `scripts/test_guest_delivery_entrypoints.py`: backend-free support controls.
- This document.

This is a combined package proposal, not standalone one-file test approval. Existing application files added for the finite scan remain unchanged. Exact baseline classifications are in the external proposal file manifest. Do not borrow unlisted working-tree dependencies or execute every case merely because its file is packaged.

Prepare from an exact Git-blob export plus the declared proposals:

```sh
python -B scripts/test_guest_delivery_custody.py
python -B scripts/test_guest_delivery_entrypoints.py
python -B scripts/guest_delivery_custody.py --source . --output ../guest-delivery-frozen
```

Output must not exist and must be disjoint from source. The materializer validates canonical bytes and restores exact reviewed raw bytes for historical raw-pin readers. The binary template is never normalized. LF/CRLF are the only permitted text conversion; appended content fails. The output includes all support, its manifest, `frozen-hashes.json` and the empty dedicated pytest configuration.

After separate execution admission, change into the output, set `WBE_GUEST_DELIVERY_TEST_OVERLAY`, `WBE_GUEST_DELIVERY_MIDDLE_OVERLAY` and `WBE_GUEST_DELIVERY_LAST_OVERLAY` to its absolute directory. Set `WBE_GUEST_DELIVERY_TEST_EVIDENCE` to an existing new external evidence directory. Existing tests consume all paths through these variables without checkpoint literals or test edits. Use only independently admitted explicit pytest node IDs, with `-c pytest-guest-delivery.ini -p no:cacheprovider`. The historical dependency invocation is `uv run --offline --no-project --with pytest --with reportlab --with docxtpl --with requests python -B -m pytest`; offline dependencies must already be available. Preserve native pytest/Node exits and JUnit IDs. No broad pytest, verifier/default/restricted suite, producer, renderer or provider execution is admitted by this packaging proposal. Combined behavioral execution is NOTRUN.

## Finite incoming scope and limitations

The manifest lists the exact source files and imports, rather than reopening a prohibited test/case inventory. It includes HTTP/web modules, frontend/master/public sources and Python HTTP/recovery paths. Source-set equality rejects a new application entrypoint even if benign. Node parses `.js`, `.web.js` and `.jsw` imports/reexports; Python AST parses all static imports. Conservative literal fences also reject dynamic/require references to the disconnected modules. HTML gets literal absence plus whole-file custody, not embedded-script import parsing. The controls prove extension inclusion, parser-valid benign/forbidden fixtures, old `.jsw` filter reversal, extra import/reexport rejection, Python HTTP/recovery incoming rejection and new-file rejection. Existing JS GDR08 ownership and verifier bytes are unchanged.

Computed-string import dataflow and callers outside these application roots remain unverified. Static absence does not establish runtime default-OFF behavior, production transport security or live activation readiness. Independent combined support/lifecycle review is still required.
