# Booking Search selection totals — installation handoff

**Status:** local candidate, not installed or published. Independent review and GitHub delivery are required before copying. Do not open Wix Editor or deploy without Tom's explicit approval.

## Scope

Replace only `velo/page-booking-search.js` with the complete reviewed GitHub file after approval. No backend, CMS, cancellation, attribution or pricing-rule changes are required. Preserve existing Editor styles and compatible occupancy options; the page now explicitly defaults Adventure Suite / Penthouse / Two Bedroom Apartment to 2 / 2 / 3, bounded by the returned maximum. The guest-dropdown correction is based on `a913e2f4c7336458de10da1210b7641657c6f3c2`; reverting that correction to this baseline restores the known selector defect, not a working dropdown. Do not restore the whole site.

The baseline contains Search quote/interval guards, Scuba-last ordering, package radio and box7 selection, package-before-room ordering, and selected-package summary synchronization. The dropdown repair changes the two guest-control selectors and the local guest options/default calculation; those other behaviors remain unchanged.

## Exact elements

Text values:
- `#nightsDominica`: `7 nights in Dominica`
- `#selectedRooms`: `3 rooms`
- `#totalGuests`: `6 guests total`

Plural wording is retained even for one. Room quantities come from each row's `#roomQtyDropdown`. Guests are quantity × that row's **`#numberOfGuests`**, with uppercase `O`, matching the current exact element ID. The previous lowercase spelling in this guide and in commit `a913e2f` was incorrect. No alternate global selector is used. Compatible per-row occupancy choices are retained; defaults follow the explicit room policy below rather than CMS base occupancy.

Keep these elements initially collapsed in Editor (Tom reports this is already configured):

`#selection`, `#vacationDates`, `#nightsDominica`, `#roomsSelected`, `#selectedRoomsContainer`, `#yourSelection`, `#selectedRooms`, `#totalGuests`, `#priceSummary`, `#packageText`, `#subTotalBooking`, `#penthouseText`, `#penthouseFee`, `#totalText`, `#finalTotal`, `#selectionBox`, `#line102`, `#line103`, `#line106`, `#packageTitle`, `#packageAmenities`, `#btnSummary`.

`#roomsSelected` and `#selectedRooms` are intentionally distinct. Do not rename either. No new styles, radio options, collection fields, packages or site permissions are introduced.

## Empty guest-dropdown correction

The recent selection-summary commit changed both scoped guest selectors from `#numberOfGuests` to `#numberofGuests`. `safeItem` catches the missing-element lookup, so the actual dropdown receives neither options, a selected value, nor its change listener. Quantity selection can still proceed using the existing internal base-occupancy fallback, masking the unwired control. Earlier test doubles created any requested selector, so matching the same typo in tests concealed this regression.

The correction restores the exact ID in available and unavailable row branches. It does not replace pricing, date, quantity, listener, or visibility logic. Same-row readiness already preserves a valid guest choice and binds only once; the new regression exercises a four-guest apartment choice across readiness and summary/quantity refreshes. A new search still resets selections as before.

`search.web.js` returns `Rooms.maxOccupancy` as `occupancy` and `Rooms.baseOccupancy` as `baseOccupancy` (falling back to maximum if absent). Independent review demonstrated that selector repair alone therefore defaults an apartment to 4 when CMS base is absent and to 2 when CMS base is 2. That did not satisfy the requested default contract.

The page now explicitly defaults **Adventure Suite 2, Penthouse 2, Two Bedroom Apartment 3**, independently of CMS base. It includes the requested default in the options without discarding compatible existing choices: apartment base 2 / max 4 offers 2, 3, 4 with default 3; base absent (backend returns 4) or base 4 offers 3, 4 with default 3. The returned maximum remains the ceiling: apartment max 2 defaults to 2, not 3; max 0 yields no guest choices and cannot continue with an active room. Existing same-row binding preserves valid user choices, including 4, through readiness and quantity/summary refreshes. New searches reset to the explicit defaults. Backend pricing base and the `#defaultOccupancy` informational text remain CMS-derived and unchanged. No live CMS values were read or changed.

The original six-case strict-ID suite is retained, including its configured-minimum/maximum check against `wbeConfig.js` (2/2, 2/2, 3/4). That check validates the canonical fixture only; it is not evidence that Search normalizes CMS base to those minima. Three additional cases explicitly cover missing/different CMS base, returned-maximum bounds, and compatible choice preservation/handoff.

Verification:
- `node tests/booking-search-guest-dropdown.cjs`: actual page source, nine cases, strict rejection of the wrong-case selector. Historical selector RED remains in the original evidence. New defaults RED failed with apartment actual 4 versus required 3 after actual backend normalization of missing CMS base. A second bounds RED failed with max 0 yielding default 3. Both now pass; compatibility/preservation cases are passing controls, not separate production REDs.
- All `tests/booking-search-*.cjs`, `tests/legacy-search-*.cjs`, and `tests/legacy-date-handoff.cjs`: fresh final run, 12 suites / 276 distinct case titles passed with `TZ=America/New_York`.
- `node --check velo/page-booking-search.js`, `node --check tests/booking-search-guest-dropdown.cjs`, and `git diff --check` passed.
- Python health: `py -3.13 -m pytest tests -q` is blocked at collection by seven errors because existing `booking_engine.rooms`, `booking_engine.reservation`, and `booking_engine.pricing` source modules are absent. This is not a passing Python health gate; no unrelated modules were added. The default `python` also lacks pytest.
- Local evidence: `C:/Users/TomDe/AppData/Local/hermes/cache/scratch/booking-search-guest-dropdown/` contains original `red.*`, `green.*`, expanded regression and per-suite output/exit records; `python-health-terminal.*` is the normal-shell Python result. A separate Python subprocess attempt inherited an incompatible Pillow path and is retained as environment-failure evidence.
- Default-blocker evidence is separate in `default-blocker-fix/` beneath that directory: before snapshots, `defaults-red.*`, `defaults-green.*`, `bounds-red.*`, final per-suite stdout/stderr/exits and `suite-summary.json`. Original independent-review probe/output is untouched. Python health was not rerun for this page-only follow-up; the prior blocker remains unresolved. Different-author review is still required.

This is **local-only actual-source verification**, not confirmed parity with published Wix source, live CMS occupancy, or native browser rendering. Independent review remains required; nothing was committed, pushed, installed, or published. After approved installation, confirm the exact scoped ID, visible options/defaults, changing apartment guests to 4, mixed totals, and preservation through same-search refreshes without submitting a booking. Publication is a separate approval.

## Behavior

- All listed controls show and expand only when there is a current room selection; deselecting every room hides and collapses every listed control, including Continue.
- A zero-quantity room contributes no guests. Two rooms × two guests = four; two × two plus one × four = eight guests and three rooms.
- Calendar nights use the existing civil-date parsing boundary with UTC day subtraction, independent of DST and picker time-of-day. Editing dates retains the existing requirement to search again: selection and quote are invalidated immediately, not carried to the new stay.
- Package identity and amenities remain sourced from the selected quoted package. Missing amenities clear the text; the requested element remains expanded with the other selection controls rather than retaining stale amenities.
- The requested Penthouse label/fee controls are visible for any selected room. With no Penthouse selected the fee reads `$0.00`, never a prior Penthouse amount. This corrects a stale display value only; the backend fee formula and booking payload are unchanged.
- If pricing fails, selection controls can still be visible, but financial text is blank and Continue is disabled. The click handler independently refuses invalid/pending searches, empty selections, missing quotes or mismatched dates.
- Room quantities must be whole-number values from that row's existing quantity options and current available limit. Selected-row guest values must match its existing occupancy-derived options. Fractional, suffixed, empty, negative, nonnumeric and out-of-range values are not repaired. Invalid active input blanks financial totals and disables/blocks Continue for the entire cart; the guest total asks for valid quantities rather than displaying a partial total or `NaN`. A zero-quantity row's guest value is ignored. With no valid positive quantity the selection controls stay collapsed.
- Continue re-reads the current row controls, including programmatic changes that did not emit `onChange`. This is a frontend admission guard, not a change to backend pricing or booking authority. Explicit room defaults and compatible higher Two Bedroom options follow the policy above.
- Selection visibility operations track latest intent through native Promise completion and synchronous reentry. Late show/expand/enable operations are reconciled after deselection, and stale collapse completions cannot conceal a new valid selection.
- Initial summary visibility is collapsed before the Settings await; delayed package, quote, availability and highlight callbacks cannot restore invalidated selections.

## Verification and owner acceptance (only after approval)

Local tests execute the actual page module with inert Wix/transport boundaries; they are not live-Wix paint or navigation verification. No production searches or bookings were executed.

After independent review and approved installation, verify saved/reloaded full-source parity and hosted diagnostics before any publication. Check one room/two guests, two rooms/two guests, a mixed Two Bedroom selection, guest changes, removal of a selected Penthouse, clearing all rooms, date edits and invalid dates. Confirm no initially collapsed controls flash, unrelated hidden elements remain hidden, package radio/amenities/prices still agree, and Continue cannot navigate without valid selection and pricing. Do not submit a booking to test this presentation change. Publication requires separate explicit approval.

Local test commands: `node tests/booking-search-selection-totals.cjs` and `node tests/booking-search-selection-blockers.cjs`. Existing `legacy-date-handoff` and `legacy-search-*` suites provide quote, package, ordering and invalidation regressions. The narrowly adjusted legacy tests now use the exact `#numberOfGuests` ID and still expect empty amenities to remain expanded when rooms are selected.
