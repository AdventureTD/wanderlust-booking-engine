# Private guest-booking acceptance runtime contract

Status: local private candidate, transport-emulated, **live-Wix unverified**. Not implementation-approved, deployable checkout, complete booking recovery or booking confirmation. Baseline: `e0f33103fb7485f5ead427cf45a410109b0ea38d`. No public consumers or scheduled jobs are added.

## Actual private graph

- `guestBookingIssuerAuthority.js`: fixed secret readers, real credential factory, fixed revision query, domain-separated SHA-256 and backend clock helpers.
- `guestBookingOfferIssuer.js`: existing canonical purchase input, ordered groups and financial calculator; existing real locked quote authority; configured immutable financial revision; real separate-key bootstrap credential. It constructs the complete capsule and stable number proposal. It does not promote `guestBookingFinancialAuthority` preview results.
- `guestBookingAcceptance.js`: authenticates bootstrap/status, recomputes complete capsule binding, samples admission time, invokes immutable insert and reconciles exact winner. Separate v2 root validator; existing v1 policy/credentials are unchanged.
- `guestBookingAcceptanceStore.js`: fixed insert, exact ID read and keyset scan over `GuestBookingAcceptances`; no save/update/delete.
- `guestBookingAcceptanceDiscovery.js`: private validated context handoff, not a scheduler or room completion engine.

All five modules are ordinary private `.js` modules. No Anyone/internal flag bridge, public web method, Summary/Search integration, room write, invoice, email, provider or legacy createBooking call is present. `roomAvailability.js` remains read-only availability composition, not a recovery engine.

## Configuration and trust boundary

These names are candidate runtime requirements, not assertions that live secrets or collections exist:

- `WBE_GUEST_BOOKING_KEYS`: canonical JSON `{audience,activeKid,keys:[{kid,keyHex}]}`, validated by the existing real credential factory. Distinct booking keys, approved audience and rotation/retention policy must be selected/provisioned separately. No fallback key.
- `WBE_GUEST_BOOKING_ISSUER_CONFIG`: canonical JSON `{v:1,revisionId,revisionDigest,numberPrefix}`. Revision IDs match `[A-Za-z0-9_-]{1,128}`, digest is lowercase 64-hex SHA-256, prefix matches `[A-Z][A-Z0-9-]{0,15}`.
- `GuestBookingFinancialRevisions`: fixed exact `_id` lookup, one row, no continuation. `revisionBytes` must be canonical JSON and its `wbe.financial-revision.v1` digest must match the selector.
- Existing `WBE_PRICING_QUOTE_SECRET` is accessed only through the unchanged locked quote authority during preparation.

Revision JSON includes `v`, package `{id,nights,baseRate,priceModifier}`, penthouse fee, property/accommodation/standard rates and complete promo entries `{code,discountRate,minimumNights,startDate,endDate}`. Issuance checks package/stay applicability, promo occupied-night boundaries and legacy positive tax/fee settings. Admission and discovery use embedded original facts, not current catalog/revision reads. Trusted module-load realm, protected selectors, immutable revision publication and private trusted writers are assumptions. Root hashes detect mismatch, not a compromised privileged writer. There is no claimed revocation service or invented `active` claim.

The issuer proposal is prefix plus 24 cryptographic random bytes encoded as hex. It is not proof of ownership of historical WC numbers. Independent root uniqueness cannot fence legacy writers.

## Capsule, root and clocks

The v2 capsule contains exact canonical input (including literal signed quote), quote claims/title/whole-stay price, revision ID/digest/bytes, factors, original ordered group component cents and totals, stable booking number, policy/version and issue/expiry. All are bound by `SHA256('wbe.complete-offer.v2' + NUL + capsule)` in the real credential. Contact, quote, group order, cents and revision cannot be replaced by caller-supplied digests or verified flags.

The root application fields, in digest order, are:

`schemaVersion, validityPolicy, _id, operationId, audience, bookingNumber, capsule, intentDigest, quoteDigest, issuedAtMs, offerExpiresAtMs, credentialKid, validatedAtMs`, followed by `rootDigest`.

Policy is `backend-complete-validation-v2`. `_id` is `SHA256('wbe.acceptance-id.v2' + NUL + operationId)`; full operation identity is retained and checked. `rootDigest` uses domain `wbe.acceptance-root.v2` over JSON of those ordered application fields. Valid admission interval is `issuedAtMs <= validatedAtMs < offerExpiresAtMs` with safe integer times. Provider `_createdDate`/`_updatedDate` are optional valid Date metadata, excluded from application digest, not admission timestamps.

Final qualification must not regress behind the authentication sample; issuance must not regress behind its post-quote sample. Equal samples are legal. These are observable local comparisons, not Byzantine-clock or global monotonicity guarantees. All awaited authentication/validation completes before the final trusted backend sample. No awaited queue or external effect intervenes before insert invocation. An initiated qualified insert may finish after expiry without repricing. A fresh post-expiry guest attempt denies without a new write; it must not delete prior acceptance or settle an earlier unknown attempt. Same-operation racing candidates may have different valid qualification times/root digests: adopt only a matching winner whose own evidence validates.

Current code bounds canonical capsule JSON to 120000 UTF-8 bytes, revision to 24000, secret JSON to 16384 and serialized inserted root to 160000. Issuance preflights the shared complete root representation with actual configured audience/kid, fixed-width operation/digest fields and latest legal qualification time (maximum decimal width). Escaping and duplicate fields are included before a token is returned. Store size denial remains defense-in-depth and does not prove an insert was invoked; old competing attempts remain UNKNOWN. These local limits do not establish Wix field/item support. The canonical input dependency has its own earlier scalar and room limits.

SDK transport pages are snapshotted through own data descriptors into detached null-prototype row records before row use; bounded dense arrays and captured data-property `hasNext` methods are required. SDK class prototypes are permitted (including inherited data methods within a bounded prototype walk), not authenticated by their class name. Arbitrary row/page getters are never invoked. Root application values must be string/number scalars before JSON serialization; only native valid Date metadata is exempt. SDK methods and the module-load realm are trusted dependencies; this does not claim sandboxing hostile Proxies or malicious SDK method implementations. Live SDK compatibility remains unverified.

## Store outcomes and ownership

Only fixed key/config initialization reads are allowed before guest authentication. Acceptance reads/writes follow real MAC, purpose, audience, lifetime and full capsule binding. Lookup identity derives from authenticated claims, not email/number/caller ID. Returned root must match operation/audience/offer/quote/time interval and fully reconcile financials before returning minimal own status.

- Insert uses `{suppressAuth:true,suppressHooks:true}`. Acknowledgment is not sufficient for acceptance; all thrown insert errors become `UNRESOLVED` and exact readback still runs.
- Exact reads use `_id`, `limit(2)`, and `{suppressAuth:true,suppressHooks:true,consistentRead:true}`. Outcomes are FOUND, ABSENT, UNRESOLVED or INTEGRITY.
- Admission maps exact valid winner to `ACCEPTED_PENDING` plus booking number, malformed/conflicting winner to INTEGRITY, absence/unreadable readback to UNKNOWN, and failed pre-write authentication/qualification to DENIED.
- Duplicate errors alone do not establish finality. Current absence cannot prove a delayed initiated write will never arrive. No automatic identity/number rotation, abort tombstone or final EXPIRED state exists.
- DENIED on a later guest call is denial of that call, not reversal of accepted work or a conclusion that earlier unknown work was never accepted.

A live independent unique index on non-null `bookingNumber`, separate from `_id` uniqueness, is mandatory. No preflight query or composite unique index substitutes for it.

## Discovery continuation

One invocation reads up to 25 rows ascending by `_id`; non-null cursor adds `_id > cursor`. Every page has explicit authoritative options. Strictly increasing unique bounded printable-ASCII traversal keys (1–128 characters) are required; these are advisory query cursors, not acceptance identities. Root identity remains strict 64-hex. Duplicate/out-of-order keys or inconsistent page shape produce INTEGRITY. Read failure produces UNRESOLVED, never exhausted work.

Malformed roots, including non-hex but bounded printable-ASCII keys, are explicitly reported in `invalid`, while later roots continue. Full malformed-key pages yield their final traversal key as continuation, so repeated sweeps do not starve later valid roots. This is a returned quarantine report, not a database mutation. Unorderable/missing/non-string/oversized/non-ASCII keys and unreadable/active pages remain explicit INTEGRITY or UNRESOLVED without exhaustion or invented continuation. **Architecture boundary:** automatic progress through those transport failures requires a trustworthy provider continuation/order contract or a separately reviewed alternate indexed scan. Neither skipping an unknown range nor forever retrying the same failed page is an approved recovery solution. This broader malformed-transport case remains an activation blocker; no manual completion fallback is approved. Valid roots yield operation ID, booking number, exact capsule, calculation and root digest. Guest credentials, current expiry, keyring and revision selection are not consulted.

Caller must persist advisory `nextCursor`, resume until `exhausted`, then restart at null. Repeated full sweeps discover insertions behind earlier cursors. Cursor/enqueue hints are not acceptance authority. No scheduler is wired; actual recurring full-cart completion/compensation remains required before activation.

## Local evidence and remaining work

`node scripts/verify-guest-booking-acceptance.js` passes 22 integrated suites using actual production modules and public fixture cryptography with data/secret/clock transport substituted. The original issuer-to-root-to-readback-to-erased-module-discovery tracer is preserved. The original ten suites are retained. Correction regressions had actual assertion REDs before each minimal fix; reviewer coverage-only promotions are labeled baseline-GREEN. The predecessor transcript records original missing-issuer assertion RED and subsequent first GREEN.

Coverage includes bad MAC/valid-MAC wrong audience and purpose, expiry, foreign capsule, every top-level capsule field, nested contact/title/cents/rate tampering, fixed economics after configuration change, missing config, fifth-room denial, delayed qualified write, validation delayed beyond expiry, same-operation race with different valid qualification, independent same-number conflict, suspended-write current absence/UNKNOWN, lost acknowledgment/unreadable readback, exact malformed winner, restart with keys/revision removed, continuation beyond one page, invalid root skipping, repeated sweep behind cursor, errors and duplicate page IDs, split 26-cent versus merged 24-cent rounding and ordered-group tamper denial. Fixture credential re-signing includes an exact original-token positive control.

Initial all-verifier run enumerated 31 `scripts/verify-*.js` (30 existing plus acceptance): 26 passed and exactly five existing isolation guards failed. Their original negative fixtures/body pins are untouched. Exact reviewed edge/body-pin updates remain pending in:

- `verify-guest-booking-access-policy.js`
- `verify-guest-booking-price-groups.js`
- `verify-guest-booking-purchase-input.js`
- `verify-locked-pricing-quote-authority.js`
- `verify-strict-locked-pricing-quote.js`

Permanent corrections cover canonical Unicode/LF/TAB byte preservation, reachable serialized-root issuance neighbors and max identifiers, authentication-to-qualification and post-quote issuer clock regression, bounded malformed-key progress, and zero-accessor transport/serialization-hook execution. Coverage-only promotions exercise internally valid redigested foreign winners, same-realm valid/invalid/string/fake native Dates, real attenuation/status/bootstrap separation and expiry with keyless discovery, all original fee/tax/promo component economics (18800 versus 25200 cents), and malformed/out-of-order/error/recovered SDK pages. The private API has bootstrap acceptance and own status as reconciliation; no full-cart resume engine is claimed. Precise incoming-consumer isolation negatives and fresh independent review remain required; this document does not self-approve.

Before any activation: separately authorize and verify private ACLs, hooks/language behavior, SDK DTOs, custom ID format, independent unique index READY/enforcement under contention, durable exact readback/application loss, field/item limits, key/revision/clock configuration and health, all-writer legacy namespace fencing, real recurring scheduler/cadence/backlog handling, actual full-cart acquire/commit/compensate recovery and completion receipt, Summary confirmation gating, accepted-component invoice/payment revision parity, provider effect idempotency/UNKNOWN and consent restrictions. No schema, browser, installation, network, live-secret read, provider action, staging, commit, push or deployment occurred in this recovery tranche.
