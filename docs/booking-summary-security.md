# BookingSummary security remediation (isolated candidate; not installed)

## Problem
The live BookingSummary collection grants Everyone View/Add/Update/Delete. The guest Summary page relied on this:
- a client-side full-row read plus update for notes and click IDs;
- a client-side read plus update for `microsoftConversionUploaded`.

BookingSummary holds guest PII, financial mirrors and attribution.

## Change
- `velo/page-booking-summary.js` no longer reads or writes BookingSummary. The only client data reads left are literal `Rooms`, `PromoCodes` and `Packages` queries.
- **Notes.** These were already saved on the first-room Bookings row by `createBooking` (`note`), and the Summary writer aggregates them into `BookingSummary.notes`. The redundant client write is removed.
- **Attribution.** Booking-time reporting (legacy IDs and first/latest paid touches) is still written server-side by `createBooking` (`suppressAuth`, allowlisted). A snapshot-scoped read returns the same snapshot or `null`, so the old post-creation client refresh could only ever be a no-op or a clear. It is now a clear-only, capability-gated RPC, `backend/bookingSummaryReporting.web.js#clearBookingSummaryReporting(bookingNumber, capability)`. That RPC takes no field values and returns only `{ok}`/`{ok:false, reasonCode}`.
- **Microsoft flag.** `recordMicrosoftBookingConversion` detaches `summaryCapability` (it is never uploaded, logged or returned). The upload behaviour is unchanged. Only after an HTTP-success JSON response with no `PartialErrors` does it set `microsoftConversionUploaded` on the capability-bound row via the private `markMicrosoftConversionUploaded`.
- **Capability** (`backend/bookingSummaryCapability.js`, a private module with no web method):
  - Format: `bsc1.<expiresAt>.<128-bit nonce>.<HMAC-SHA256>` over a domain string plus bookingNumber, Summary `_id`, expiry and nonce.
  - Minted only inside `createBooking`'s existing fresh-allocation gate, the same as Google's `mintGoogleAdsCapability`, and returned as `summaryCapability`. Function-local on the page; never stored or logged.
  - Verification requires exactly one Summary row for the bookingNumber, an HMAC match against that row's `_id` (so a recreated row or another booking is rejected), and an unexpired 30-minute TTL.
  - Stateless: replay within the TTL is limited to the two idempotent operations on the bound row.
  - Uses the existing `WBE_PRICING_QUOTE_SECRET` (>=32 chars) with domain separation. It fails closed if the secret is missing or short. No new secret or collection.

## Writer policy (round 4)
`backend/bookingSummaryWriter.js` is a private module (no web method). It is the only writer of existing BookingSummary rows except the admin console's `patchAdminFields` (W9, `adminConsole.web.js`).

W9 is an `Admin`-only builder field patch and is unchanged here. It has no bookingNumber condition and is not elevated. See *Not claimed* for its stale-form behaviour. Every write is a single documented direct-form Data Items SDK patch, `items.patch('BookingSummary', itemId, fieldModifications, { condition: items.filter().eq('bookingNumber', bookingNumber) })`, made of `SET_FIELD` modifications on a fixed field list. No row read earlier is ever written back.
- P1, creation: the `createBooking` insert stays the only full-row write.
- P2, refresh (`updateBookingSummary`, existing row): sets only the computed aggregate fields (checkIn, checkOut, roomCount, status, notes; plus guestName/Email/Phone, marketSource, packageTitle and a missing bookingDate when non-empty). It never writes the Google/Microsoft flags or cancellation fields.
  - Reporting is monotonic on existing rows. An explicit `null` paid touch clears it. Non-empty identifiers and paid touches are never written after creation, so a delayed, retried or second-caller additional-room call carrying stale reporting cannot resurrect a withdrawal clear.
  - Omitted reporting leaves the stored value unchanged.
- P3, withdrawal clear: the 4 legacy identifiers are set to `''` and both paid touches to `null`.
- P4, flags: only `googleConversionUploaded` or `microsoftConversionUploaded`.
- P5, cancellation: status, cancellationSettlement, cancellationReason. Runs with the admin caller's own permissions (no elevation), hooks suppressed as before.
- P6, invoice date mirror: checkIn, checkOut, bookingDate.

Elevation, via `auth.elevate(items.patch)` from `@wix/essentials`, is used only on the public paths: P2, P3, the Microsoft P4 mark, the Google P4 journal mark and P6. Admin paths (P5 and the admin Microsoft retry) are not elevated.

Capability operations re-check expiry after the verify awaits (inside verify) and again synchronously immediately before dispatching the patch. If either check fails, nothing is written.

### Contract narrowing (intended)
- Reporting on an existing row is authoritative from the creation snapshot (P1). Afterwards it can only be cleared.
- Late attribution corrections or backfills through `createBooking`/`updateBookingSummary` are NOT supported. A later call carrying non-empty identifiers or paid touches is ignored, even when the stored value is empty and even if the later value were genuinely newer.
- In the current page flow later rooms carry only the same snapshot or null. A different non-empty value previously overwrote; it no longer does. Any future need to correct attribution needs its own authorized writer.
- A refresh no longer blanks guest name/email/phone when they are not supplied.
- Unlisted fields can no longer be dropped by a full-row rewrite.

### Not claimed
- Admin console save (W9) is a stale-form write. `page-admin-bookings.js` sends every form field on save, including gclid/gbraid/wbraid, googleConversionUploaded/Retracted and notes, loaded when the booking was opened. `adminUpdateBooking` patches all of them.
  - An admin who opened a booking before a guest withdrawal clear or a Google upload mark, and saves afterwards, re-writes the old identifiers and/or a stale flag value.
  - This is pre-existing and Admin-authorized (not public). msclkid and paid touches are not sent.
  - The withdrawal and flag preservation claims therefore exclude W9.
- Same-field aggregate writers (refresh vs date mirror vs cancellation status, admin edits of notes) remain last-writer-wins. They are outside the withdrawal claim.
- Offline tests use a fake that models only the documented patch/condition semantics. They prove the algorithm, not Wix server enforcement or that elevation is honoured.

## Why this is authorization
- bookingNumber is sequential (`WC-<n>`), so it is not a secret.
- `suppressAuth` is only used after HMAC verification, and only to touch fixed fields of the bound row.

## Install order (each step needs separate owner approval)
1. Confirm `@wix/essentials` and `@wix/data` are installed in the site's backend (read-only check). Install the backend files: `bookingSummaryWriter.js`, `bookingSummaryCapability.js`, `bookingSummaryReporting.web.js`, `microsoftAdsConversions.web.js`, `availability.web.js`, `bookingCancellation.js`, `googleAdsAttemptJournal.js`. Then install the Summary page code. Install these together with the Option B set.
2. Verify with an owner-approved, clearly labelled internal booking, BEFORE restricting permissions and again after: notes, attribution, invoice/date mirror, cancellation, and the Microsoft flag (if applicable). Elevated patches must succeed with BookingSummary set to Admin-only; this is the only proof that elevation is honoured.
3. Only then restrict BookingSummary permissions to Admin for View/Add/Update/Delete. First do a read-only check that no editor dataset is bound to BookingSummary.

## Residual (out of scope)
- `recordMicrosoftBookingConversion` and `issueBookingInvoice` remain public web methods (`Permissions.Anyone`) that accept caller data or booking numbers.
- The invoice-date mirror (P6) is pre-existing behaviour: any caller who knows a sequential bookingNumber can invoke `issueBookingInvoice(bookingNumber, ownerOnly)`, and the method re-mirrors server-derived dates onto that booking's Summary row.
  - Elevation does NOT authorize that caller. It only replaces the public collection permission the old write relied on.
  - The caller still chooses only the bookingNumber, as before. Item id and values are server-derived. No new input, field or row access was added.
  - The pre-existing Anyone invocation remains a residual for separate review.
- Collection permissions for Bookings (read by the public `createBooking`/`updateBookingSummary` without `suppressAuth`), BookingInvoices and PromoCodes are unreviewed.
