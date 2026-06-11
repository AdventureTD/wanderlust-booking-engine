# Wanderlust Booking Engine — Payments & Balance Due

Payments are processed MANUALLY. The admin records each payment as it arrives.
Standard schedule: 50% deposit at booking, 50% final ~30 days before check-in.
Balance due = grand total − total paid.

## What's built & verified
- `booking_engine/payments.py` — PaymentSchedule: 50/50 schedule, final-due
  date (check-in − 30 days), flexible payment recording, derived totals.
  8 passing tests (deposit/final, partial, overpay, refund, odd-cent split).
- `velo/backend/payments.web.js` — recordPayment, listPayments, balanceDueReport.
  Verified (Node) to match the Python totals + report aggregation.

## Collections to create in Wix

### `Payments`
| Field     | Type   | Notes                                   |
|-----------|--------|-----------------------------------------|
| bookingId | Text   | _id of the BookingReports row           |
| amount    | Number | positive = received; negative = refund  |
| date      | Date   | when the payment was received           |
| ptype     | Text   | deposit / final / other / refund        |
| note      | Text   | optional memo                           |
Permissions: Admin read/write only.

### Add these fields to `BookingReports` (cached for fast reporting)
| Field        | Type   | Notes                                |
|--------------|--------|--------------------------------------|
| totalPaid    | Number | sum of payments                      |
| balanceDue   | Number | grandTotal − totalPaid               |
| depositDue   | Number | 50% of grandTotal                    |
| finalDue     | Number | remaining 50%                        |
| finalDueDate | Date   | checkInDate − 30 days                |
| paidInFull   | Boolean| balanceDue <= 0                      |

## How it works (admin console)
- **Record a payment:** `recordPayment(bookingId, { amount, date, ptype, note })`
  inserts the payment and refreshes the booking's cached balance fields.
  - Deposit example: `{ amount: 13586.15, date: '2026-06-01', ptype: 'deposit' }`
  - Final example (~30 days before arrival): `ptype: 'final'`
  - Refund: `ptype: 'refund'` (stored as negative).
- **See a booking's payments:** `listPayments(bookingId)`.

## Balance Due Report (admin enters START + END date)
`balanceDueReport(startDate, endDate, dateField)` filters bookings by
**Check-out date** in the admin-entered range (default) and returns, per booking:
  guestName, invoiceNumber, dateBooked, checkInDate, finalDueDate, status,
  grandTotal, totalPaid, **balanceDue**, paidInFull
plus `totals` { grandTotal, totalPaid, balanceDue, revenueCount }.
Cancelled and Pending Confirmation are EXCLUDED from the money totals.
`dateField` defaults to 'checkOutDate'; pass 'dateBooked' or 'checkInDate' to
filter on a different date instead.

### Admin page wiring (add to your Admin Reports page code)
```js
import { balanceDueReport, recordPayment } from 'backend/payments.web';

// Run the balance-due report from two date pickers the admin fills in.
// Filters by CHECK-OUT date by default.
$w('#btnBalanceReport').onClick(async () => {
  const start = $w('#datePickerStart').value;   // admin-entered start date
  const end = $w('#datePickerEnd').value;        // admin-entered end date
  const { rows, totals } = await balanceDueReport(start.toISOString(), end.toISOString());
  $w('#balanceRepeater').data = rows.map(r => ({ _id: r.invoiceNumber, ...r }));
  $w('#sumBalanceDue').text = '$' + totals.balanceDue.toLocaleString('en-US', {minimumFractionDigits:2});
  $w('#sumPaid').text = '$' + totals.totalPaid.toLocaleString('en-US', {minimumFractionDigits:2});
  $w('#sumGrand').text = '$' + totals.grandTotal.toLocaleString('en-US', {minimumFractionDigits:2});
});

// Record a manual payment for the selected booking.
async function savePayment(bookingId) {
  const res = await recordPayment(bookingId, {
    amount: Number($w('#inputAmount').value),
    date: $w('#datePickerPaid').value.toISOString(),
    ptype: $w('#dropdownPayType').value,   // deposit/final/other/refund
    note: $w('#inputNote').value,
  });
  $w('#balanceText').text = 'Balance due: $' + res.balanceDue.toFixed(2);
}
```

## Verified vs. needs live testing
- Verified by me (Python + Node): 50/50 split, balance math, refunds/overpay,
  final-due date, and the report aggregation/exclusions.
- Needs live testing in Wix: the Payments collection inserts + the cached-field
  updates + the date-range query (Wix Data only runs inside Wix).
