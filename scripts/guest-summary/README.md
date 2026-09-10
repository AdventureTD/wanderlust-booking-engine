# Finite disconnected Summary connector package

Release HOLD. This is permanent repo-relative support for the reviewed private same-realm connector; not Summary UI, RPC, recovery, confirmation, invoice or publication authority.

## Custody

`package-manifest.json` freezes exact support bytes and the eleven admitted core dependencies plus separately counted connector. Raw support bytes are preserved with local `.gitattributes`; dependencies accept only their historical raw hash or exact core Git LF hash, with CRLF-to-LF canonical equality also mandatory. No arbitrary whitespace normalization. The manifest itself must be authenticated against the independently reviewed package report. Historical JSON custody paths are provenance, never loaded as external paths. The actual approved fixture and original public quote vector remain byte-identical. Loader changes only root relocation and exact LF/raw admission; its import bindings, private fresh cache, native crypto, controlled clock and restricted SDK remain unchanged.

## Permitted static reproduction

From repository root:

```
python -B scripts/guest-summary/verify-package.py STATIC
node scripts/guest-summary/booking-guest-offer-loader.cjs L01
node scripts/guest-summary/booking-guest-offer-fixture-controls.cjs F01
python -B scripts/guest-summary/booking-guest-summary-financial-oracle.py vectors
```

L01 compiles but never evaluates backend functions. Fixture F01 is fixture-only (not financial F01). Decimal `vectors` reproduces all expected arithmetic without Node/backend dispatch or rewriting frozen files. No default selector is authorized.

## Separate next financial test-byte review — NOTRUN here

Review Python Decimal formulas, exact input/rate semantics, revision-domain digest, every expected component/order, Node actual-issuer/acceptance assertions, immutable vector equality, explicit selector and changed support custody independently. Historical author financial PASS does not supply independent test-byte approval. Following separate authorization, run exactly `python -B scripts/guest-summary/booking-guest-summary-financial-oracle.py F01` and separately F02, F03. Capture native stdout/stderr/exits externally; runner never rewrites support. These dispatch actual backend functions and are prohibited in this preparation task.

Other relocated historical cases, also NOTRUN here: `node scripts/guest-summary/booking-guest-offer-connector-tests.cjs C01` (or C02/C03), and `node scripts/guest-summary/booking-guest-summary-connector-boundaries.cjs B01` (or B02–B06). Distinct historical candidate/boundary independent reviews remain provenance, not fresh portable behavioral approval. Check full package STATIC first. No producer/default/full/restricted runner is wired into package.json.

## Remaining gates

Precise combined baseline/overlay and proposed inherited isolation-guard changes are recorded in the external `booking-guest-summary-connector-package.md`. Do not widen guards or activate runtime from this package. Independent financial byte review, relocation controls, incoming-edge metacontrols and combined dependency approval remain separate. Live Wix unverified.
