# Booking Search selection totals — installation handoff

**Status:** local candidate, not installed or published. Independent review and GitHub delivery are required before copying. Do not open Wix Editor or deploy without Tom's explicit approval.

## Scope

Replace only `velo/page-booking-search.js` with the complete reviewed GitHub file after approval. No backend, CMS, cancellation, attribution, pricing-rule or guest-limit changes are required. Preserve existing Editor styles and all dropdown options/defaults. Roll back with that same file from parent commit `091d01c1abf13c4136f10b7a4171ed7f1aa1f7fe`; do not restore the whole site.

The parent contains the latest committed Search quote/interval guards, Scuba-last ordering, package radio and box7 selection, package-before-room ordering, and selected-package summary synchronization. Local `main` is older and is not this candidate's baseline.

## Exact elements

Text values:
- `#nightsDominica`: `7 nights in Dominica`
- `#selectedRooms`: `3 rooms`
- `#totalGuests`: `6 guests total`

Plural wording is retained even for one. Room quantities come from each row's `#roomQtyDropdown`. Guests are quantity × that row's **`#numberofGuests`**, with lowercase `of`, as specified by Tom; the former code used `#numberOfGuests`. No alternate global selector is used. Existing per-row occupancy-derived choices and default occupancy are unchanged.

Keep these elements initially collapsed in Editor (Tom reports this is already configured):

`#selection`, `#vacationDates`, `#nightsDominica`, `#roomsSelected`, `#selectedRoomsContainer`, `#yourSelection`, `#selectedRooms`, `#totalGuests`, `#priceSummary`, `#packageText`, `#subTotalBooking`, `#penthouseText`, `#penthouseFee`, `#totalText`, `#finalTotal`, `#selectionBox`, `#line102`, `#line103`, `#line106`, `#packageTitle`, `#packageAmenities`, `#btnSummary`.

`#roomsSelected` and `#selectedRooms` are intentionally distinct. Do not rename either. No new styles, radio options, collection fields, packages or site permissions are introduced.

## Behavior

- All listed controls show and expand only when there is a current room selection; deselecting every room hides and collapses every listed control, including Continue.
- A zero-quantity room contributes no guests. Two rooms × two guests = four; two × two plus one × four = eight guests and three rooms.
- Calendar nights use the existing civil-date parsing boundary with UTC day subtraction, independent of DST and picker time-of-day. Editing dates retains the existing requirement to search again: selection and quote are invalidated immediately, not carried to the new stay.
- Package identity and amenities remain sourced from the selected quoted package. Missing amenities clear the text; the requested element remains expanded with the other selection controls rather than retaining stale amenities.
- The requested Penthouse label/fee controls are visible for any selected room. With no Penthouse selected the fee reads `$0.00`, never a prior Penthouse amount. This corrects a stale display value only; the backend fee formula and booking payload are unchanged.
- If pricing fails, selection controls can still be visible, but financial text is blank and Continue is disabled. The click handler independently refuses invalid/pending searches, empty selections, missing quotes or mismatched dates.
- Room quantities must be whole-number values from that row's existing quantity options and current available limit. Selected-row guest values must match its existing occupancy-derived options. Fractional, suffixed, empty, negative, nonnumeric and out-of-range values are not repaired. Invalid active input blanks financial totals and disables/blocks Continue for the entire cart; the guest total asks for valid quantities rather than displaying a partial total or `NaN`. A zero-quantity row's guest value is ignored. With no valid positive quantity the selection controls stay collapsed.
- Continue re-reads the current row controls, including programmatic changes that did not emit `onChange`. This is a frontend admission guard, not a change to backend pricing or booking authority. Existing defaults and higher Two Bedroom options remain unchanged.
- Selection visibility operations track latest intent through native Promise completion and synchronous reentry. Late show/expand/enable operations are reconciled after deselection, and stale collapse completions cannot conceal a new valid selection.
- Initial summary visibility is collapsed before the Settings await; delayed package, quote, availability and highlight callbacks cannot restore invalidated selections.

## Verification and owner acceptance (only after approval)

Local tests execute the actual page module with inert Wix/transport boundaries; they are not live-Wix paint or navigation verification. No production searches or bookings were executed.

After independent review and approved installation, verify saved/reloaded full-source parity and hosted diagnostics before any publication. Check one room/two guests, two rooms/two guests, a mixed Two Bedroom selection, guest changes, removal of a selected Penthouse, clearing all rooms, date edits and invalid dates. Confirm no initially collapsed controls flash, unrelated hidden elements remain hidden, package radio/amenities/prices still agree, and Continue cannot navigate without valid selection and pricing. Do not submit a booking to test this presentation change. Publication requires separate explicit approval.

Local test commands: `node tests/booking-search-selection-totals.cjs` and `node tests/booking-search-selection-blockers.cjs`. Existing `legacy-date-handoff` and `legacy-search-*` suites provide quote, package, ordering and invalidation regressions. The narrowly adjusted legacy tests use Tom's exact lowercase guest ID and expect empty amenities to remain expanded when rooms are selected.
