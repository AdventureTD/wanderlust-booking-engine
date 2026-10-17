# Independent M0r4 review — ACCEPT conditional reservation/review model only

## Recommendation

**Accept the B1/B2 correction and conditional offline reservation/review model under its stated assumptions.** No new reachable reservation-safety or wrongful automatic review-clear defect was reproduced under those assumptions. Successful reservation with retained review is an allowed conservative false positive. This is NOT adapter, staging, Wix, guest-flow, provider-send or production approval. Invoice identity reconciliation, owner authorization and general exception containment are not established by this acceptance.

Read both source files, all four test/helper/explorer/mutation files, REPORT-R4.txt and the prior independent REVIEW.md. Loaded owner-rules and offline-checkout-contract-review skills. Original files were not edited; no network, guest, provider, site, git, commit or push operations occurred.

## Reproducibility and custody

Execution directory:
`C:/Users/TomDe/AppData/Local/hermes/profiles/ric/cache/scratch/m0r4-independent/candidate/`

Node v22.23.2. Exact substantive commands, all against the scratch copy:

```sh
node tests/r4/orchestrator.test.cjs > suite.log 2>&1
node tests/r4/explorer.cjs --d2=s1,s2,s3,s4,s5,s6,s7 --depth3=2100 --out=explorer.json > explorer.log 2>&1
ONLY=M19,M31,M32,N1,N2,N6,N7,N11,N12 node tests/r4/mutations.runner.cjs > selected-mutations.log 2>&1
node probes.cjs > probes.log 2>&1
```

- Supplied suite: **52 tests / 52 pass / 0 fail**.
- Full requested explorer: **137,029 generated / 136,949 unique / 0 invariant-failing runs**, independently reproduced exactly.
- Independent probes: **18 / 18 pass**. Several deliberately assert limitations, not desirable behavior; see below.
- Selected mutations: **9 executed; 6 caught; M19/M31/M32 not distinguished; 0 invalid executions or anchor misses**. Crash self-check correctly classified invalid. The runner prints catalog `total=52` even when ONLY selects nine. I did not independently reproduce the author's entire 49/52 result.
- Original-before/after SHA256 comparison: **17 original work-tree files checked, none changed**, including earlier revisions. `original-hashes.json` and `custody.json` retain evidence.
- Frozen orchestrator SHA256: `7fd8ccd68aea76149f5992eaca1179c50b1497e507e58203885fc7a662689878`.
- Frozen store SHA256: `f5cc629a2aeae1d7064f4b6f03f8c13c1dec096fe1b81ec15e6197df46dd56a4`.

## Main findings

References below use `O` = src/r4/checkoutOrchestrator.cjs, `S` = src/r4/modelStoreR4.cjs, `E` = tests/r4/explorer.cjs, `T` = tests/r4/orchestrator.test.cjs.

### 1. Default review and B2 repair are sound within the model

O202–210 creates the obligation atomically with admission. Dispatch, settlement, finalization, fence, conclusion and cancellation preserve it. O255–277 separates finalization from discharge: only the invocation that confirmed its own final CAS issues discharge, chained to the next expected version. A persisted FINALIZED row by itself does not discharge review or restart execution.

The old B2 schedule (final applies, ACK and readback fail, every later CAS fails, then recovery and sweep) now preserves durable OPEN review and performs no invoice allocation. Independently reproduced in probes and T523–533. ZERO_PROVEN likewise preserves review; it is absence evidence, not retry/release authority.

Discharge distinctions were independently exercised:
- Applied + lost ACK + exact successful readback: confirmed DISCHARGED; invoice identity may proceed.
- Applied + lost ACK + failed readback: response conservatively says RETAINED/reviewRequired:true, while durable status is reviewRequired:false. No invoice attempted. This is truthful historical reservation success, not a failed reservation silently cleared.
- Definitely unapplied discharge: successful booking stays review-required and invoice NOT_ATTEMPTED (T539–544).
- Cancellation during delivery of an exact discharge readback: historical discharge can still be confirmed, but chained invoice publication conflicts; CANCELLED is not overwritten. A fresh orphan invoice-number allocation can still occur: identity is not a send.

Do not interpret RETAINED as proof the durable obligation remains open, nor finalConfirmed/state:FINALIZED in a response as current state after a later cancellation.

### 2. Owner resolution races do not resurrect or overwrite authoritative state

O391–402 refuses ADMITTING/ACTIVE, but FINALIZED can still have an executor in its discharge/invoice tail. Therefore “non-executing” means room-work-closed states, NOT no in-flight method. Independent probes cover:
- Owner resolution wins before discharge: changes only review; executor's stale discharge conflicts, returns conservative RETAINED, and does not allocate invoice.
- Discharge already applied: owner resolution returns NOT_REQUIRED without a write.
- Owner read captures old OPEN review, then discharge and invoice publish: stale owner CAS conflicts and retries; it does not overwrite invoice or CONFIRMED_SUCCESS.
- Owner resolution CAS pending while cancellation commits: stale CAS conflicts; retry resolves review while retaining CANCELLED and claims.
- Owner resolution after final applies but before its lost ACK: exact final readback does not misattribute the owner's newer version. Executor stops; review is false only by explicit owner action, no invoice allocation.
- During invoice allocation, ownerResolveReview is a no-op when discharged; cancellation still blocks canonical publication.

Owner authority is **assumed**, not modeled: these functions accept a checkout ID and perform no authentication/authorization or proof that Tom examined evidence. An API exposure must supply that boundary; neither booking number nor ID is authorization. Explicit resolution is allowed even with UNKNOWN evidence, without releasing, certifying, changing quote, or allocating/sending.

### 3. Invoice uncertainty is outside the discharged reservation obligation

O278–289 does not reopen review for uncertain invoice-number insertion or uncertain canonical publication. Independent probes produce `ok:true`, `finalConfirmed:true`, `invoice:UNKNOWN`, `reviewRequired:false`; durable invoice may respectively be null or already published. Replay remains nonexecuting and claims remain intact.

This does not demonstrate a failed room save bypassing D2: reservation finalization was confirmed before discharge. It DOES mean reviewRequired is not a universal reconciliation queue for invoice identity failures. No recovery/send policy is established. If a future requirement makes *every post-final identity/notification problem* require durable owner review, this model needs a separate obligation; do not claim that guarantee today.

### 4. Successful-path exceptions: safe boundary, not general containment

Independent nonce-callback throws at final stamp, discharge stamp, and invoice-publication stamp were executed. Before final/discharge, the default obligation remains true; no wrong automatic clear occurs. After confirmed discharge, a throwing publication nonce rejects the checkout Promise while durable review remains false and an invoice number may be orphaned.

Finite, successful configuration callbacks are explicitly assumed (REPORT line 88), so the last case is outside the accepted contract, not an A1–A13 counterexample. There is no top-level catch restoring review for arbitrary JS/config/trace exceptions. Do not infer production exception safety from store-fault handling. Abrupt process loss after discharge similarly cannot turn historical confirmed reservation success into a guarantee of client delivery or invoice completion.

### 5. Evidence semantics are conservative but not completely uniform

- O135–146 and O309–334 require confirmed fence plus complete single-snapshot enumeration at/after fence sequence for ZERO_PROVEN. A stale, mixed or failed page does not prove absence. The suite includes load-bearing false-proof demonstrations when A12 is deliberately violated.
- Independent owner-fence-before-claim probe: durable ABANDONED/ZERO_PROVEN exists, but stopped executor sees conclusion ABANDONED and returns reservationEvidence UNKNOWN because O295 maps NO_RESERVATION, not ABANDONED. Safe underclaim, not false zero; status is accurate.
- A captured status result can legitimately report reviewRequired:true after another actor discharges; it is a historical read, never authority.
- Successful checkout responses (O277/289) omit reservationEvidence; admission-unknown responses (O214) omit reviewRequired. Thus REPORT lines 13–19 should not be read as a uniform response schema or “every failure response” claim. Admission-unknown has durable review if admission applied, but caller must treat uncertainty conservatively.
- Cancellation after FINALIZED preserves null durable evidence; status then falls back UNKNOWN rather than CLAIMS_PRESENT (O373/405). Again conservative loss of evidence precision, not loss of review or claims.

Bounded corruption defense clarification: O338–342 recursively traverses object **values**, not property names. My forced nested `{[checkoutId]: 'reference-as-key'}` row is missed and can coexist with NO_RESERVATION. This requires forceSet corruption outside the canonical writer protocol. REPORT line 49's “keys and values” is correct only for the storage row key plus nested values, not all nested object keys. Narrow the wording; it is not an in-contract reservation blocker. Depth limits and lying adapters remain excluded.

## Explorer count and coverage assessment

| Group | Generated | Unique | Fully activated | Partial |
|---|---:|---:|---:|---:|
| Depth 1 | 1,564 | 1,564 | 1,564 | 0 |
| Depth 2 | 133,882 | 133,882 | 133,882 | 0 |
| Sampled depth 3 | 1,583 | 1,503 | 1,581 | 2 |

All sampled plans have length three. Seed 12345, requested depth3=2100, continuation-less draws skipped. All-seven --d2 is necessary; default is only s1,s2,s3,s6. Counts are generated injected plans over deterministic Promise ordering, not all scheduler interleavings. Hook activation need not imply effective interference.

Important residual coverage limitation: S83–118 supports DURING readback, but E35–40 permits only readFail at the after-read phase; cancel/fence/deadline/outage are excluded there by `phase === 'before' || isWrite(op)`. The suite's targeted DURING tests T592–614 cover claim/settle/final cancellation/deadline/fence, and my discharge/stale-owner/status probes extend them. The 137,029-run explorer itself does NOT systematically enumerate these after-read owner/deadline interferences. OwnerResolveReview is not an explorer interference kind at all. E143 checks existence of a finalConfirmed event, not a comprehensive per-invocation temporal proof. Keep these as coverage limits, not exhaustive correctness claims. The stale r3 header at E11 also contradicts the now-full depth2 kind set.

M19/M31/M32 remaining indistinguishability is consistent with current structural redundancy, not proof the guards can safely be removed in a future design. Selected N6/N7/N11/N12 were caught by suite only; their clean explorer runs underscore its owner-resolution/API gaps.

## Load-bearing assumptions and acceptance boundary

- **A8/A11:** admission quote expiry and dispatch/claim/settle/final deadlines are tested at store apply under one monotonic clock. Discharge/invoice publication and response delivery are not deadline bounded.
- **A9:** atomic predicate+insert serialized against CAS prevents new claims APPLYING after terminal closure. Calls may still reach the store. No await between check and commit in S56–62. Epoch/entry checks remain part of the specified adapter requirement.
- **A12:** complete cross-worker snapshot with common sequence and pagination integrity is required. Ordinary queries are not evidence of that capability.
- **A13/A1–A4:** admission nonce plus exact payload attribution prevents duplicate invocations adopting another winner; CAS additionally requires exact next version and value. Insert rows reuse admission nonce under single-writer serialized operations; they do not have fresh per-insert nonces. Faulted operations must be complete before readback: no delayed post-timeout commit. Process-global fixture counters are not restart-safe proof.
- Quote provenance, normalized owner CMS mapping, finite successful callbacks, durable store/clock/nonce feasibility and call-duration feasibility remain unproven.
- Cap four physical rooms and occupancy per room/quantity are preserved; quote snapshot remains immutable. No self-service additions after booking; manual owner CMS additions are outside this online cap and owner-edit/claim races are unfenced.
- Nightly fungible slots do not establish persistent physical-room continuity.
- No guest cancellation API is in scope; its absence is not a newly imposed policy change. Privacy request recording remains available but is not actual deletion/withdrawal execution.
- Failed/uncertain reservation execution preserves claims, stops automatic continuation and leaves owner review (unless explicitly resolved). Eventual conclusion may require sweep/owner; no automatic release or safe replay follows from zero proof.

**Final gate:** accept the isolated conditional model with these limitations; require capability proof or redesign before adapter work can claim equivalent guarantees, and separate explicit approvals before staging/live/provider behavior. No original edits were made. Scratch contains copied candidate, probe source, raw execution logs, explorer JSON, custody manifests, and this review.
