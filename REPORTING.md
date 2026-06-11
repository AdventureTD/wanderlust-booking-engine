# Wanderlust Booking Engine — Reporting & Admin Console

Every completed booking is logged to a Wix collection for reporting, and an
admin page lets you view bookings by date range with aggregated totals.

## The collection: `BookingReports`
Create this in the Wix Content Manager. Fields (exactly what the owner requested
2026-06-01):

| Field                 | Type   | Meaning                                            |
|-----------------------|--------|----------------------------------------------------|
| guestName             | Text   | Guest Name                                         |
| invoiceNumber         | Text   | Invoice #                                          |
| guestPhone            | Text   | Guest Phone Number                                 |
| guestEmail            | Text   | Guest Email                                        |
| dateBooked            | Date   | Date Booked                                        |
| checkInDate           | Date   | Check-in date                                      |
| checkOutDate          | Date   | Check-out date                                     |
| totalVat10            | Number | Total 10% VAT (accommodation)                      |
| totalVat15            | Number | Total 15% VAT (packages/services)                  |
| totalVat              | Number | Total VAT (10% + 15%)                              |
| accommodationSaleNet  | Number | Total accommodation sale, NET, all 10% items       |
| packageSaleNet        | Number | Total package/services sale, NET, all 15% items    |
| grandTotal            | Number | Grand total: all sales + all taxes + property fee (= invoice total)|
| propertyFeeRate       | Number | property fee rate applied, e.g. 0.05               |
| propertyFee           | Number | property fee amount (below VAT, untaxed)           |
| roomCode              | Text   | (optional) which room type                         |
| currency              | Text   | USD                                                |
| status                | Text   | Confirmed / In-House / Checked-Out / Cancelled / Pending Confirmation |
| originalCheckIn        | Date   | original check-in (anchors the 2-year rebook window) |
| lockedNightlyRate      | Number | snapshot nightly rate for postponed rebooking (no extra charge) |

### Status lifecycle (added 2026-06-01)
- **Confirmed** — set when the booking is made.
- **In-House** — automatically on/after the check-in date.
- **Checked-Out** — automatically on/after the check-out date.
- **Cancelled** — set manually. Keeps the row; EXCLUDED from revenue.
- **Pending Confirmation** — guest postponed (illness/injury). Keeps the row;
  EXCLUDED from revenue; sticky (the daily job won't move it). Rates are LOCKED
  so a later rebooking carries no additional charge.

Sticky statuses (Cancelled, Pending Confirmation) override the date logic and
are never auto-advanced.

### Postpone → rebook (illness/injury), no additional charge
Guests can rebook up to **2 years from the original check-in** with no extra
charge. Flow:
1. `postponeReservation(recordId)` — sets status to Pending Confirmation, stores
   `originalCheckIn`, and locks the nightly rate (`lockedNightlyRate` =
   original accommodation net ÷ original nights). Now excluded from revenue.
2. Guest picks new dates. Admin enters them. The external service `/recompute`
   reprices at the LOCKED nightly rate (NOT current/seasonal rates) — so the
   same nights cost the same even if the new dates are high season; a different
   number of nights scales at the locked rate.
3. `reinstateReservation(recordId, newCheckIn, newCheckOut, recomputed, opts)` —
   enforces the 2-year window (anchored on `originalCheckIn`), writes the new
   dates + recomputed financials, and sets status back to **Confirmed**.
   - Outside 2 years → blocked; pass `{overrideTwoYear:true}` to allow.

Verified (Python + Node): a low-season booking ($792/night) postponed and
reinstated into high season (current $1,200/night) still prices at $792 —
$3,960 for 5 nights, NOT $6,000. 2-year boundary is exact.

### Cancel / Edit (admin console)
backend/reporting.web.js provides:
- `cancelReservation(recordId)` — sets status to Cancelled (row kept).
- `applyEditedReservation(recordId, recomputed)` — after a guest changes dates
  or adds a room, overwrites the row's date + financial fields with freshly
  recomputed values. Refuses to edit a Cancelled booking.
- `advanceStatuses()` — daily job; flips Confirmed->In-House->Checked-Out.

**Edit flow (recompute is mandatory so totals never go stale):**
1. Admin edits the reservation (new dates / added room) on the page.
2. Page rebuilds the quote via `pricing.web.js` buildQuote (+ seasonal/extra-guest),
   OR calls the external service `POST /recompute` with the new quote_breakdown.
3. The recomputed report_record (new VAT/nets/grandTotal) is passed to
   `applyEditedReservation`. All taxes/totals are updated atomically.

Revenue totals from `queryBookingsByDateRange` now also return `revenueCount`
and `cancelledCount`, and EXCLUDE Cancelled rows from the money totals.

Permissions: **Admin read/write only** (financial data). The booking page never
writes here directly — the admin backend module does.

### Sales figures are NET (pre-VAT)
`accommodationSaleNet` and `packageSaleNet` are the sale amounts BEFORE VAT
(standard for sales reporting — sales reported separately from tax collected).
`grandTotal = accommodationSaleNet + packageSaleNet + totalVat`, which equals
the invoice total. accommodationSaleNet includes room nights AND extra-guest
charges (both are 10%); packageSaleNet includes packages AND a la carte (15%).

## How a booking gets logged (data flow)
1. Booking completes -> Velo calls the external invoice service.
2. The service returns `report_record` (all the fields above) in its JSON
   response (already built + reconciled; verified in Python tests).
3. Velo calls `logBookingReport(report_record)` (backend/reporting.web.js),
   which inserts it into `BookingReports`.

Example Velo glue (after issueInvoice returns):
```js
import { logBookingReport } from 'backend/reporting.web';
const resp = await issueInvoice(guest, quoteBreakdown);   // calls external service
if (resp.report_record) {
  await logBookingReport(resp.report_record);
}
```

## Admin console (date-range reporting)
Backend: `backend/reporting.web.js` -> `queryBookingsByDateRange(from, to, dateField)`
- dateField: 'dateBooked' (default), 'checkInDate', or 'checkOutDate'
- Returns `{ rows, totals }`. `totals` aggregates all financial columns for the
  range (verified: sums + reconciliation correct).

Page: `velo/page-admin-console.js` wires:
- `#datePickerFrom`, `#datePickerTo` — the range
- `#dateFieldSelect` (optional dropdown) — which date to filter on
- `#btnRunReport` — runs it
- `#bookingsRepeater` — one row per booking (bind the text fields inside)
- Totals labels: `#sumCount`, `#sumAccommodation`, `#sumPackages`,
  `#sumVat10`, `#sumVat15`, `#sumVatTotal`, `#sumGrandTotal`
- `#statusText` — status/errors

### Build the admin page in the Editor
1. Add a new page "Admin Reports". Set page Permissions -> Members only; restrict
   to your admin account(s).
2. Add the elements above (2 date pickers, a button, a repeater, text labels).
   Right-click each element to see/set its ID; match the IDs in the page code.
3. Paste `velo/page-admin-console.js` into that page's code panel.
4. Add `backend/reporting.web.js` under Backend.

## Verified
- Report record fields + reconciliation (Python tests, test_report.py).
- Admin aggregation sums + reconcile across multiple bookings (Node check).
- Needs live testing in Wix: the collection insert + date-range query
  (depends on Wix Data, only runs inside Wix).
