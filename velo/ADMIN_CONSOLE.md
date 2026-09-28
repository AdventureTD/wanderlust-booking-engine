# Wanderlust Admin Console — Setup Guide

The admin console is a member-restricted page (`/admin-bookings`) for managing
reservations and recording off-site payments/refunds.

## What it does

- **List all bookings** — search by guest name, email, or booking number; filter
  by status and check-in date range; sort by check-in (asc/desc).
- **Edit a booking** — guest info, dates (with an automatic availability
  re-check before saving), guest count, grand total, promo code. Status is display-only; use the dedicated cancellation action (generic reactivation is unsupported).
- **Cancel a booking — review candidate, not approved for deployment.** Two clicks
  confirm the displayed full/no-fee target. The candidate paginates child rows,
  retains an immutable cancellation decision, resumes status changes and verifies
  reservation readback. Historical invoices and payments are preserved; current
  no-fee obligation is zero. Email, Calendar, Ads and GA4 report separate outcomes;
  an uncertain send is not automatically resent. `complete` remains false.
  See [candidate scope, schema and activation blockers](CANCELLATION_CANDIDATE.md).
  No claim that Data Manager ingestion retracts a conversion, or that a successful
  HTTP response proves GA4 processing or email inbox delivery.
- **Payments & refunds** — record off-site payments (positive amounts) and
  partial refunds (stored as negative amounts) in `BookingPayments`, linked by
  `bookingNumber`. Shows invoice total, total paid, total refunded, and
  balance. Overpayment/over-refund produces a warning but is allowed.

## Files

| File | Where it goes in Wix |
|---|---|
| `velo/backend/adminConsole.web.js` | Backend / Web modules |
| `velo/page-admin-bookings.js` | Page code for `/admin-bookings` |

Plus, on the Render invoice service (candidate parity is NOT verified):

- `booking_engine/gmail_sender.py` — added `send_cancellation_email`
- `invoice_service.py` — added `POST /send-cancellation-email`

Do not push this candidate to Render's auto-deploy branch or publish Wix/Apps
Script before independent review and explicit rollout approval. Configuration
and schema changes are listed in `CANCELLATION_CANDIDATE.md`.

## CMS: BookingPayments fields

Add to the `BookingPayments` collection:

| Field | Type | Notes |
|---|---|---|
| `paymentId` | Text | exists — auto `P-0001`, `P-0002`, ... |
| `bookingNumber` | Text | exists |
| `datePaid` | Date | exists |
| `paymentAmount` | Number | exists — negative = refund |
| `paymentType` | Text | **new** — `payment` or `refund` |
| `paymentMethod` | Text | **new** — bank/cash/check/card-offsite/other |
| `note` | Text | **new** — free text |

## CMS: BookingSummary and cancellation journals

The candidate adds `cancellationSettlement` and `cancellationReason` and three
private cancellation collections. Existing conversion flags are not proof of
adjustment success and are not overwritten. See `CANCELLATION_CANDIDATE.md`.

## Page elements (IDs the code expects)

### Filters / list

| ID | Element | Notes |
|---|---|---|
| `searchGuestInput` | Text Input | search name/email/booking# |
| `btnSearch` | Button | triggers refresh |
| `dateFrom`, `dateTo` | Date Picker | optional check-in range |
| `statusDropdown` | Dropdown | options: `All`, `confirmed`, `In Process`, `Cancelled` (values must match your BookingSummary.status values) |
| `sortDropdown` | Dropdown | options with values: `checkIn` (asc), `checkIn_desc` |
| `listStatusText` | Text | shows "N booking(s)" / errors |
| `bookingsRepeater` | Repeater | one item per booking |

Inside `bookingsRepeater` item:

| ID | Element |
|---|---|
| `rowBookingNumber` | Text |
| `rowGuestName` | Text |
| `rowDates` | Text |
| `rowTotal` | Text |
| `rowStatus` | Text |
| `btnViewBooking` | Button — opens detail panel |

### Detail panel

| ID | Element |
|---|---|
| `detailPanel` | Container/Box — starts collapsed |
| `detailTitle` | Text |
| `btnCloseDetail` | Button |
| `detailStatusText` | Text |

**Details tab:** `inputGuestName`, `inputGuestEmail`, `inputGuestPhone`,
`inputNumGuests` (Text Inputs); `dateCheckIn`, `dateCheckOut` (Date Pickers);
`inputGrandTotal`, `inputPromoCode` (Text Inputs); `inputStatusDropdown`
(read-only Dropdown); `btnSaveChanges` (Button); `saveStatusText` (Text).

**Payments tab:** `invoiceTotalText`, `totalPaidText`, `totalRefundedText`,
`balanceText` (Texts); `paymentsRepeater` (Repeater) with item elements
`payRowId`, `payRowDate`, `payRowAmount`, `payRowMethod`, `payRowNote`;
payment form: `inputPayAmount`, `datePaid` (Date Picker), `payMethodDropdown`,
`inputPayNote`, `btnRecordPayment`;
refund form: `inputRefundAmount`, `dateRefund`, `refundMethodDropdown`,
`inputRefundNote`, `btnRecordRefund`; `paymentStatusText` (Text).

**Danger zone:** `cancelBalanceText` (Text — shows paid/refunded/balance),
`inputCancelReason` (Text Input), `btnCancelBooking` (Button),
`cancelStatusText` (Text).

> Tabs can be real Wix tabs or three collapsible sections — the code only
> touches the element IDs above, so layout is up to you.

## Access control (Wix Members)

1. In the Wix Editor, open the `/admin-bookings` page settings.
2. Set **Permissions → Members only**.
3. In **Members Area → Roles**, create a role named **Administrator** and
   assign your own member account to it.
4. The backend web methods use `Permissions.Admin` (Wix built-in admin
   privileges) plus an explicit role check matching any role title containing
   "admin".

## Deploy checklist

1. Push/pull this repo — Render redeploys `invoice_service.py` automatically
   (check Render logs for the new `/send-cancellation-email` route).
2. In Wix: add the CMS fields, create the page, paste the two code files,
   add the elements, restrict the page to the Administrator role.
3. Publish.
4. Test: open `/admin-bookings`, pick a test booking, record a small payment,
   then a small refund, then cancel a throwaway booking and confirm:
   - Bookings rows show `Cancelled` (rooms freed).
   - Cancellation email arrives (guest + info@).
   - `BookingSummary.googleConversionRetracted = true` (if it was uploaded).
