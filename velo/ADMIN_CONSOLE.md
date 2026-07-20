# Wanderlust Admin Console — Setup Guide

The admin console is a member-restricted page (`/admin-bookings`) for managing
reservations and recording off-site payments/refunds.

## What it does

- **List all bookings** — search by guest name, email, or booking number; filter
  by status and check-in date range; sort by check-in (asc/desc).
- **Edit a booking** — guest info, dates (with an automatic availability
  re-check before saving), guest count, grand total, promo code, status.
- **Cancel a booking** — one click (plus a reason field). The system:
  1. Sets all `Bookings` rows for that booking number to `Cancelled`
     (frees the room nights immediately).
  2. Sets `BookingSummary.status = 'Cancelled'`.
  3. Sends a cancellation email from info@wanderlustcaribbean.com to the guest
     (cc info@) via the Render invoice service.
  4. If a Google Ads conversion was uploaded for this booking and not yet
     retracted, sends a RETRACTION to the Data Manager API and sets
     `BookingSummary.googleConversionRetracted = true`.
- **Payments & refunds** — record off-site payments (positive amounts) and
  partial refunds (stored as negative amounts) in `BookingPayments`, linked by
  `bookingNumber`. Shows invoice total, total paid, total refunded, and
  balance. Overpayment/over-refund produces a warning but is allowed.

## Files

| File | Where it goes in Wix |
|---|---|
| `velo/backend/adminConsole.web.js` | Backend / Web modules |
| `velo/page-admin-bookings.js` | Page code for `/admin-bookings` |

Plus, on the Render invoice service (already deployed):

- `booking_engine/gmail_sender.py` — added `send_cancellation_email`
- `invoice_service.py` — added `POST /send-cancellation-email`

Deploy the updated service to Render (push to the repo Render watches, or
manual deploy). No new env vars — it reuses `WBE_SHARED_SECRET` and the
existing Gmail token.

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

## CMS: BookingSummary (no changes)

Cancel flow uses the existing `status`, `googleConversionUploaded`,
`googleConversionRetracted` fields.

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
`inputGrandTotal`, `inputPromoCode` (Text Inputs); `editStatusDropdown`
(Dropdown); `btnSaveChanges` (Button); `saveStatusText` (Text).

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
