# Private acceptance → allocation handoff (local candidate)

## Verified finite tracer

Run `node scripts/verify-guest-booking-allocation-handoff.js`.

The permanent test uses actual issuer, acceptance, discovery and root validation with substituted public-fixture SDK/clock/secret transport. It accepts an original cart ordered suite q1, Penthouse q1 at fee .25, suite q2. It erases credentials and module state, discovers the root, derives the existing acceptance ID, reloads authoritative acceptance, scans the real fixed evidence collections, runs the unchanged reviewed planner/core and inserts/readbacks one immutable manifest. Historical nonempty real-core claim events carry native Date metadata created in the tested realm; the retained ledger omits validated metadata and the sidecar retains timestamps. The primary original suite retains the note despite physical class order p,a.

After another erased-module restart the same manifest is returned with evidence, planning, clock and key reads forbidden. The result is only `ALLOCATION_HANDOFF_PENDING`. No Booking, Summary, claim acquisition, room completion, confirmation, public activation or scheduler is implemented.

## Candidate protocol

- `handoffGuestBookingAllocation(acceptanceId)` is private and takes only the exact acceptance identity hint. It reloads the authoritative root on every attempt.
- Full 256-bit accepted operation bytes are reversibly encoded in `cg2_<base64url>_<class>` and `ga2_<base64url>` identities.
- The allocation commitment binds the exact immutable capsule, root qualification and original slot/guest/note mapping. It is not the legacy financial row payload. Original financial groups/factors/cents are never merged, repriced or rounded here.
- Proposed fixed private collection: `GuestBookingAllocationManifests`. Application fields are `_id`, `schemaVersion`, `manifestCanonical`, `manifestDigest`. This collection is NOT provisioned or activated.
- Existing winners undergo static root-binding/topology validation rather than reallocation. Hashes are integrity checks, not authentication; a separately verified private writer/ACL boundary is required.
- After any insert outcome, exact readback decides the winner. Unresolved outcomes remain pending/unknown, not aborted.
- Evidence uses fresh keyset queries with explicit read options, page100 and maximum100 pages per collection, plus local400000-byte budgets. Sequential reads are not an atomic snapshot.

## Verification status and open work

**Locally verified finite recovery tranche; live-Wix unverified; independent implementation byte review pending.** In addition to the preserved first tracer, run `node scripts/verify-guest-booking-allocation-manifest.js` (six suites) and `node scripts/verify-guest-booking-allocation-evidence.js` (three suites). Permanent coverage includes exact .25/10.005 capsule and component preservation, static winner with forbidden planner/evidence/keys/clock, genuine concurrent different valid allocation adoption, lost acknowledgement/read-error reset, delayed insert with current absence, independently valid foreign qualification-root rejection, inert SDK class methods, malformed pages with zero planner/insert, and native Date metadata sidecars and invalid/hooked metadata denial. Eight suites were baseline-GREEN additions. One observed causal RED→GREEN corrected manifest-store metadata mutation during `hasNext`: timestamps/owner are now compared across page inspection without becoming application authority.

This finite tranche is not every negative requirement. Still require full identity/golden/tamper/budget matrices, final-descriptor/prototype stability adversaries, target-aware dependency verifier resolution and independent review. The bounded ordinary retained-evidence findings are corrected below; this does not certify an exhaustive history/security corpus. Success remains allocation-pending only.

The corrections run discovered 38 verifier scripts: 33 passed and five existing isolation guards still reject the private handoff edge (access-policy, price-groups, purchase-input, locked-pricing-quote-authority, strict-locked-pricing-quote). These remain actual failures, not waived passes. The planner verifier now uses an honestly test-only request-tuple digest instead of loading absent legacy financial projection dependencies: all 36 existing cases and 13 existing mutation witnesses pass. Imported pure planner/core and existing production/isolation guards remain byte-unchanged. Exact external logs and candidate hashes are under the Hermes checkpoints directory.

Before activation, require finite live Wix SDK/corpus proof; collection fields/ACL/hooks/index and durable arbitration/size checks; reserved-prefix legacy writer exclusions and historical audit; helpable V2 acquisition/sealing/compensation/row/Summary/invoice projections; durable complete receipt; recurring recovery scheduler; every admitted stay/size domain; consent/provider UNKNOWN handling. Accepted work must remain discoverable even when unsupported by this finite allocation envelope. No pricing or expiry business decision is reopened.

## Bounded retained-evidence correction

Run `node scripts/verify-guest-booking-allocation-retained.js` and `node scripts/verify-guest-booking-allocation-native-history.js` in addition to the existing gates.

- All ten concrete external malformed-data witnesses are permanent negative assertions. Each was observed RED before its production correction: seven ledger cases, then the numeric Date sidecar and two snapshot cases. Two additional foreign-kind fields were observed RED in the per-kind matrix before the exact-shape correction. Other passing additions are baseline-GREEN, not invented RED.
- `guestBookingAllocationRetainedRules.js` contains only static rc1 grammar/linked-history validation derived from the unchanged core, plus strict normalized per-kind fields. It has no effectful or planner imports. The existing captured-intrinsic boundary protects its detached input call. It validates identities, manifest prefixes, completion/decision linkage, release suffixes and continuous generations; it never allocates again.
- Retained metadata timestamps are null or safe integer native-Date-range epochs, including negative epochs and both endpoints, excluding negative zero. Snapshot nightly keys must exactly match the bound occupied stay, in order, with sorted unique units 1..5 and an exact union. Diagnostics cannot be erased into a successful manifest.
- The finite retained verifier has 146 malformed-data cases, nine valid linked-history controls, five valid sidecar controls and a raw JSON negative-zero rejection. The native-history verifier preserves every application field of complete compensated/released history through five real SDK-boundary Date/boxed-number cases. Native Date identity is checked in the tested realm before normalization.
- Existing original-group .25/10.005 economics, complete acceptance-root binding, original primary slot and alternative valid stored winner tests remain green. Stored-winner checks forbid planner, evidence, keys and clock reads; no availability refresh or reprice was added.

Retained history is internally checked evidence, **not an atomic snapshot certificate**, a proof of current availability, or privileged-writer authentication. Removing an entire unrelated history cannot be detected by internal references. Full source retention depends on the bounded sequential reader and private writer/ACL contract. Independent fresh implementation review remains required; no live-Wix or activation approval is implied.
