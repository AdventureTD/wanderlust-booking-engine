# Wanderlust Booking Engine — Admin Console Access & Security

## Who uses what
- **Guests (public):** the booking flow only — search dates, view rooms/prices,
  enter their details, confirm. They never see or use the admin console.
- **You / staff (admin):** the admin console — bookings, reports, balance due,
  record payments, cancel/edit/reinstate, view invoices, change pricing split.

## Two layers of protection (both required for full safety)

### Layer 1 — Server-level function permissions (BUILT, in the code)
Every back-office Velo function is marked `Permissions.Admin`, so Wix's servers
refuse to run it unless the caller is logged in as a site admin — even if someone
knew the function name. This is the real, unbypassable lock.

Admin-only functions (verified):
- Invoices: storeInvoice, listInvoices, getCurrentInvoice
- Payments: recordPayment, listPayments, balanceDueReport
- Reporting: logBookingReport, queryBookingsByDateRange, cancelReservation,
  applyEditedReservation, advanceStatuses, postponeReservation, reinstateReservation
- Booking: cancelBooking (changed to Admin so guests can't self-cancel)
- Settings: setAccommodationShare

Public (Anyone) — correct, guests need these:
- searchAvailability, quotePackage, isAvailable, unitsAvailable, createBooking,
  getRoomsWithPhotos/getRoomMedia/getRoomThumbnails, priceStay, buildQuote,
  getAccommodationShare (read-only).

### Layer 2 — Hidden, login-locked admin PAGE (you set this in the Wix Editor)
Chosen approach: a hidden admin page on the same site, restricted to admin login.
Steps in the Wix Editor:
1. Add a new page, name it e.g. **"Admin Console"**.
2. Open the page's **SEO/Settings** → turn OFF "Show in menu" / hide it from
   navigation so the public never sees a link to it.
3. Open the page **Permissions** → set to **"Members only"**, then restrict to
   your admin role/account (Wix: Member Permissions → specific members/roles).
   - If you don't use Wix Members, you can gate it behind Wix's site-owner login;
     simplest is to make it a members-only page and only invite yourself/staff.
4. (Optional but recommended) Give it an unguessable URL slug, e.g. `/wbe-admin-x7q`.
5. Publish. The page now: isn't linked anywhere public, requires login to open,
   AND every function on it still independently enforces admin-only at the server.

## Why both layers
- Page lock alone isn't enough (a determined person could try to call functions
  directly) — Layer 1 stops that.
- Function lock alone would let the public SEE the page (ugly, confusing) even if
  the buttons failed — Layer 2 keeps it invisible.
Together: invisible to the public AND safe even if discovered.

## HARD RULE: bookings are edited ONLY in the admin console
Guests can CREATE a new booking through the public flow, but they can NEVER edit,
cancel, postpone, reinstate, re-date, add rooms to, or take payment on an existing
booking. A guest who needs to change their vacation dates CALLS the hotel, and an
admin makes the change in the console.

This is enforced in code: every function that MODIFIES an existing booking is
`Permissions.Admin`:
- applyEditedReservation (change dates / add rooms)
- cancelReservation, cancelBooking
- postponeReservation, reinstateReservation
- recordPayment, storeInvoice, advanceStatuses, setAccommodationShare
The ONLY public booking-write is `createBooking` (new booking only — it cannot
alter an existing one). Do NOT change any edit/cancel/payment function to
`Permissions.Anyone` — that would break this rule.

## How you use the admin console day to day
1. Log into your site as admin, go to the hidden admin URL.
2. **Reports:** pick a start + end date (filters by check-out date) → Run report.
   See each booking's balance due + totals (Cancelled/Pending excluded).
3. **Payments:** open a booking, enter a payment (deposit/final/other/refund) +
   date → Save. Balance updates.
4. **Cancel:** select a booking → Cancel (status → Cancelled, row kept, excluded
   from revenue).
5. **Edit dates / add rooms:** change the booking → totals/taxes recompute → a
   NEW invoice is issued and the old one is kept (superseded).
6. **Postpone / reinstate:** mark a booking Pending Confirmation (illness/injury);
   later set new dates within 2 years at the locked rate → back to Confirmed.
7. **Pricing split:** change the accommodation share (e.g. 50 → 60) and Save.

## NOTE on testing
Permissions only take effect on the published Wix site (and Preview as the
relevant user). Test the admin page logged in as admin AND while logged out /
as a regular visitor to confirm the public can't reach it.
