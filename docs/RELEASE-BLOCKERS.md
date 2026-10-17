# Review branch — NOT approved for Wix installation

This branch preserves the accepted offline attribution/BookingSummary candidate and the separately accepted **conditional** M0 r4 model. Neither GitHub storage nor passing offline tests authorizes editor changes, publication, collection-permission changes, real bookings or provider traffic.

## Current boundaries

- `velo/`: previously reviewed baseline-remediation r2, plus portable test-fixture adaptation only. This is NOT a complete security remediation.
- `research/m0-checkout-contract/`: offline model, not imported by Velo. Requires unproven atomic store-time deadlines, cross-record conditional insertion, complete cross-worker snapshot enumeration, and restart-safe unique write nonces. No production duration selected. Fungible nightly capacity is not physical-room assignment.
- The separate intake gate is **not integrated**. Even integrating it would not contain public direct collection writes or establish bounded draining.
- Existing code still has guest cap 5; owner rule is 4 physical rooms. M0 enforces 4; it is not live code.
- Additional-room calls concern the SAME original multi-room checkout. Later additions remain Tom's direct CMS edits. Caller-supplied booking-number authorization remains unresolved in Velo.
- Admin stale writes, invoice/Microsoft endpoint authorization, possible sensitive logs, invoice download access, identity allocation races and permission-transition requirements remain open. Do not claim these fixed.
- Google Ads import matching, Enhanced Conversions warnings, conversion-action mapping, form timing and hosted consent/message behavior remain unverified live.

## Platform feasibility evidence

Current official documentation reviewed during GitHub preparation:

1. https://dev.wix.com/docs/api-reference/business-solutions/cms/eventual-consistency — `consistentRead:true` reads the primary rather than an eventually consistent mirror. This does **not** establish a consistent cross-page snapshot or cross-record transaction.
2. https://dev.wix.com/docs/sdk/business-solutions/data/items/wix-data-patch/introduction — a patch modifies one item. This is **not** evidence of atomic cross-record claim admission or store-evaluated time conditions.
3. https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/introduction — full updates replace the payload; selective patches preserve other fields. Documentation cautions against more than one update per second to an item.

These sources do not substantiate M0's required A8/A9/A12 primitives. Absence from these pages is not proof no implementation exists. No adapter has been built by substituting read/check/write for atomicity. Further feasibility work is required; do not publish model-backed claims as Wix guarantees.

## Verification

- Original accepted candidate re-run: 88/88 top-level test files exit 0.
- First assembled-tree run: 87/88 because one test referenced an external sibling baseline folder.
- Portable fixture correction: exact historical fee/tax lines extracted with source SHA256; no production code change. Targeted suite 24/24. In-memory fee mutation (0.05 to 0.06) fails as intended.
- Corrected assembled tree: 88/88 test files exit 0. Build check: 14,874 characters.
- Historical M0 independent verification: 52/52 plus 137,029 generated plans (136,949 unique), not exhaustive scheduler coverage. See separate review for assumptions and limitations.
- Testing uses pre-existing external pinned toolchain; a reproducible fresh-clone dependency bootstrap is still required. Wix fetch type definitions are from 2023 and not verified against current hosted runtime.

## Owner-approved policy

Four physical rooms per online reservation; explicit per-room occupancy; original admitted quote retained. Failed/uncertain room saves require owner review without guest invoice, preserve reserved rooms, no automatic retry/release. Manual owner additions remain direct CMS editing. No guest interface or live permission change has been authorized by this document.
