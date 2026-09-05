# Physical-room booking production integration

Status: **NOT deployment-ready**. Disconnected core baseline: `080b2b8f30a502bba1cbc1903c782b41fdfb1f14` on `fix/room-booking-search-compat`. Production baseline fetched for comparison: `origin/main` at `a07b213`. Neither baseline is proof of live Wix source parity.

## Approved business behavior

- Confirm a booking only after **every requested room across every room type** is secured. Interrupted persistence remains pending explicit recovery, not a partial customer confirmation.
- Invoice room lines use each physical room's actual price. Allocate the booking's discount proportionally and preserve authoritative booking totals exactly.
- Preserve current authoritative pricing and the existing room-type-group rounding boundary unless a separate decision changes it. Splitting persistence into individual rooms must not reprice the booking.
- Guests are per physical room, not an aggregate to divide. Non-Penthouse room fees are zero. The booking note belongs only to the designated primary row.
- Keep the published Booking Search design and behavior unchanged during preparation. A later reviewed Summary submission change may replace separate room-group calls with one whole-cart request without changing the visual design.
- Publication, production activation and data migration require explicit approval. Preparation authorization is not cutover approval.

## Observed integration gaps

The current Summary page calls `createBooking` for the first room group, then remaining groups in parallel. It lacks a stable whole-cart retry identity and final-cart manifest. `availability.web.js` inserts a quantity-bearing row, additively updates a draft invoice, and separately updates summary. These operations are not a transaction. Browser-owned invoice/conversion calls are separate again.

The approved coordinator accepts one room class and commits one to three physical rows. Its digest binds room business fields, not guest contact, attribution, package/quote identity, financial totals, or all room groups. It must not be used as a whole-booking finalization receipt.

Confirmed-operation cancellation is **not compensation**: the permanent `commit-rows` decision cannot become `compensate`. Existing admin edits, cancellations, blocks, invoice helpers that overwrite Bookings, direct CMS writers and any live-only automation must be migrated/fenced before claims activate.

Existing active Bookings cannot simply coexist with an empty claim ledger. Migration must preserve stable references and prove nightly unit/capacity parity under writer exclusion. Code rollback does not roll back CMS or external effects.

## Incremental implementation gates

Each module: causal RED→GREEN tests, full relevant regression gate, independent fail-closed review, isolated-branch commit/push and remote verification. No production imports until the integration gate explicitly replaces the current isolation contract.

### P1 — Pure physical-room invoice allocation

**Locally verified and independently reviewed:** commit `ebaa5d27fbf065aa327d0b22978abc9ebfbc1a12`, pushed and exact remote branch SHA verified. The final gate passed 44 existing verification scripts, including 26 allocator behavioral cases. Independent causal replay established assertion witnesses for all 24 targeted mutants; the verifier's generic failure collector alone is not proof that every failure is causal. Source remains disconnected; no live invoice behavior changed.

The disconnected minor-unit allocator takes row prices and discount/tax/fee totals supplied by a later authoritative pricing snapshot; this module neither validates signed quotes nor establishes price authority.

- Exact integer minor units; reject coercion, negative zero, fractions, unsafe sums and impossible discounts.
- Proportional discount by actual pre-discount row price. Largest-remainder rounding, deterministic ties by booking-row ID.
- Allocate already-authoritative tax/fee totals by net row values while preserving each supplied total. Do not calculate new rates or reround the booking total.
- Exact row/aggregate identities and totals, detached immutable output, no external effects or production imports.
- A zero-net booking cannot have nonzero supplied net-based tax/fee totals.

### P2 — Immutable whole-booking request and accepted context

Design a versioned full-cart manifest with a stable server-authorized booking/request identity and deterministic room-group identities. Bind canonical stay, complete requested room groups, guest contact, package/verified quote snapshot, promo/settings-derived financial contributions, attribution and accepted event timestamp. Store personal context separately from the room-claim ledger.

The public request must not authorize client-supplied prices, arbitrary status, or attachment to another booking number. Retry with the same key but changed context is a conflict. Recovery uses accepted pricing rather than an expired quote or mutable current rates. Booking-number allocation needs an atomic uniqueness strategy, not Settings read/increment/update.

### P3 — Whole-cart claim decision and recovery

The reviewed single-group exports cannot resume every interrupted acquisition: identity plus an incomplete resource prefix without terminal completion remains pending, and the existing compensation API cannot safely manufacture that missing completion. A timeout or one-time lease check does not exclude a delayed writer. Whole-cart integration must therefore add separately reviewed acquisition fencing/takeover or a genuinely drained operational repair procedure before production readiness. Start-versus-skip admission gates are also required before declaring an aborted cart fully cleaned up; a currently absent identity alone does not prove that no delayed starter exists.

Extend coordination under a reviewed protocol: acquire every requested resource before authorizing room-row persistence, expose one whole-booking terminal direction, and recover interrupted row writes without rebooking already-secured groups. Reusing independent current coordinators in parallel is insufficient.

Design and review the exact cross-group identity, ordering, decision, resource compensation and durable context correspondence before implementation. No customer confirmation, financial finalization or external dispatch until all expected rows and booking context are authoritatively complete.

### P4 — Confirmed-booking lifecycle and all inventory writers

Design append-only cancellation/reschedule/reinstatement and real maintenance blocks. Do not weaken immutable commit decisions or delete claim history. Acquire destination resources before releasing source occupancy for a move; ambiguous outcomes stop for recovery. Derived owner reservations and actual unavailable units need distinct semantics.

Inventory every deployed writer. Replace or fence public legacy creation, admin full-record updates/cancellation, separate cancellation endpoints, block/unblock, legacy invoice full-row writers, CMS imports, API integrations, jobs and automations. A flag consulted only by new code or once before an await is not a drain barrier.

### P5 — Idempotent booking-level finalization

Persist summary and financial state from the immutable accepted context with deterministic identities and exact retry reconciliation. Never increment draft totals on retry. Payments remain booking-level and are not multiplied across physical rooms. Preserve package title, contact, note and attribution without frontend read-modify-write races.

Choose one durable owner for invoice/Calendar/provider-conversion dispatch; do not add server dispatch while retaining duplicate browser dispatch. Use stable effect identities and provider-side idempotency or explicit uncertain-outcome reconciliation. Local sent flags alone do not establish exactly-once external delivery. Invoice reissue must not create another occupancy event.

### P6 — Compatibility integration and acceptance

Wire the reviewed whole-cart service into Summary while preserving Search UI and initialization. Confirm raw primary booking return compatibility where retained. Switch availability/pricing readers to correctly interpret quantity-one rows, legacy migration and owner protection. Define handling of pending/recovery states without implying success.

Test mixed-room carts, concurrent same-unit requests, repeated/lost responses, every partial-row boundary, summary/financial failures, provider response loss, cancellation/move races and all legacy writer bypasses. Verify invoice line sums, preserved totals, booking-level payment balances, event identity and conversion timestamp/value authority.

### P7 — Migration, Wix verification and release

- Compare live code to expected baseline; inventory hooks/automations/secrets/providers and exact CMS field IDs, types, permissions and indexes.
- Export all affected collections with system IDs; audit active inventory/summary consistency and physically assignable occupancy.
- Prepare dry-run migration and restartable reconciliation under an effective writer-exclusion barrier. Do not manufacture completion around incompatible historical records.
- Provision only explicitly approved schema in an authorized test/staging environment first. Verify deterministic custom-ID insert contention, missing-field round-trips, Date/Number fidelity and manifest size limits.
- Validate the Wix compiler/runtime and external endpoint contracts; local Node success alone is not Wix verification.
- Prepare file-by-file publication order, drain/activation/rollback procedure and operational recovery instructions. Obtain explicit cutover approval before production edits/migration/publication.

## Release boundaries and remaining verification

`RoomBookingClaimEvents` remains unprovisioned per saved checkpoint; live confirmation pending. The user's existing Chrome was confirmed authenticated with the Wix dashboard and editor open; the earlier sign-in screen belonged to a separate automation profile. A subsequent read-only CDP connection timed out. This is an unresolved browser-connection issue, not evidence that Wix requires another sign-in. Exact editor source, collection fields, indexes and permissions remain unverified.

Live Penthouse fee precision is unverified. Current production accepts finite decimal fees, while the physical core binds whole-unit safe integers. Do not silently round or change units; resolve from live values and explicit monetary contract before wiring.

Existing room-claim manifest text has a 60,000-character cap. Very long multi-room stays can be rejected before effects despite the global 800-night maximum. Preserve safe rejection until product limits or a reviewed encoding change are specified.

Docker/start.sh deploy `invoice_service:app`, not the incomplete Python booking-engine tests. Static reachable local imports for that service contain none of the missing rooms/reservation/pricing modules. Relevant invoice/renderer/Gmail tests pass (14 tests with requirements-deploy.txt); this is local evidence, not Render runtime verification.

No release-ready claim is permitted until writer transition, occupied-state migration, lifecycle, whole-cart completion, Wix runtime and rollback gates are complete.
