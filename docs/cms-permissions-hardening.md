# CMS permissions hardening — preparation only

**Not deployment-ready. No live permission changes or publication authorized.**

## Verified problem
Authenticated CMS metadata currently declares Anyone read/insert/update on Bookings and Anyone read/insert/update/remove on BookingSummary. BookingInvoices and BookingPayments also declare Anyone read. This is a configuration finding; no anonymous mutation or bulk guest-data retrieval was performed.

The private-data and booking-integrity boundary must be enforced both at collection permissions and at every public backend method. Merely making collections private while exposing equivalent unchecked privileged methods is not a fix.

## Protected compatibility contract
- Preserve published Booking Search source, visibility, dates, dropdown behavior, pricing and returned availability shape.
- Preserve anonymous guest booking; do not silently introduce a member-login requirement.
- Preserve legitimate multi-room creation and invoice delivery without accepting a caller's knowledge of a booking number as proof of ownership.
- Preserve Admin-only cancellation, date/status changes, owner blocks, refunds and invoice reissue.
- Do not grant privileged access before validating authorization and input.
- Do not return guest/financial/attribution data through diagnostic or generic collection endpoints.
- Do not use arbitrary collection names, row IDs, booking numbers, caller-supplied status or ownerOnly flags as authority.
- Do not change live permissions until corresponding backend/client code is independently reviewed, deployed under explicit approval, and ready for immediate verification and rollback.

## Baseline
Isolated worktree: C:/Users/TomDe/wanderlust-cms-permissions-hotfix.
Branch: hotfix/cms-booking-permissions.
Baseline: 2039faee1b6f0773fd6fe48d744f1dd3edda8c6b, matching the observed already-published read-only inventory/search graph. origin/main alone omits that graph. All 17 existing verification scripts passed before changes.

## Required acceptance gates
1. Anonymous direct collection access is denied according to the approved final role/action matrix.
2. Anonymous availability and pricing still return only their intended public contract.
3. Legitimate first-room and subsequent-room creation succeeds through validated backend authority.
4. Foreign booking numbers, IDs and invalid/missing credentials cause zero sensitive reads/updates/invoice sends.
5. Invoice delivery and permitted retries are bound to the authorized booking; admin reissue remains available.
6. Diagnostics cannot disclose booking identifiers, dates or private collection schemas to anonymous callers.
7. Public conversion/calendar/email bridges cannot mutate another booking's records using a guessed identifier.
8. The role/action matrix is verified by readback after an explicitly approved live change; test writes require separate scope approval.

## Upstream guidance
Wix Security Best Practices: https://dev.wix.com/docs/develop-websites/articles/best-practices/security-best-practices
Wix recommends restrictive collection permissions and narrowly scoped backend access. A suppressAuth operation must perform its own authorization checks and/or filter sensitive returned data; exported backend code can be called independently of the intended UI.

## Pending design
Dependency/authorization audit is in progress. Exact capability design, affected files, rollback sequence and final role/action matrix are not yet approved. This document is a gate list, not a claim of implementation.
