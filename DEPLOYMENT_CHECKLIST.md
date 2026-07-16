# Wanderlust Booking Engine — MASTER DEPLOYMENT CHECKLIST

How all the code gets into Wix, in order. There is **no automated deploy** into
Wix — Velo code is **pasted into the Wix Editor by hand** (one-time). The only
piece that deploys elsewhere is the invoice PDF/email service (Python).

Work top to bottom. ✅ = you do it in Wix; 🐍 = the external Python service.

---

## STAGE 0 — Prerequisites ✅
- [ ] Paid **Wix Premium** plan (Velo backend + Wix Data need it).
- [ ] Open the site in the **Wix Editor** → turn on **Dev Mode** (a.k.a. Velo).
      You'll now see a code tree with **Backend** and **Public** sections, plus a
      code panel on each page.

## STAGE 1 — Create the data collections ✅
In **Content Manager** (CMS) → Create Collection. Field names must match EXACTLY.
Full field lists are in `velo/SETUP_GUIDE.md`, `REPORTING.md`, `PAYMENTS.md`,
`INVOICES.md`, `ROOM_PHOTOS.md`. Collections to create:
- [ ] `Rooms` (incl. baseOccupancy, maxOccupancy,
      extraGuestFee, photoGallery, mainPhoto) — seed the 3 rooms.
      NOTE: baseRate is NO LONGER on Rooms (moved to Packages).
- [ ] `Packages` (roomCode, nights, baseRate) — seed 21 rows
      (3 rooms × 7 night counts 4–10). Read=Anyone, Write=Admin.
- [ ] `Bookings` (availability/booking rows; incl. `quantity` default 1, `note`,
      `status` now supports `blocked`)
- [ ] `BookingReports` (reporting rows + payment cache + currentInvoice pointer)
- [ ] `Payments`
- [ ] `Invoices`
- [ ] `Settings` — seed three rows:
  - key=`accommodationShare` value=`0.5` (package split)
  - key=`propertyFeeRate` value=`0.05` (5% property fee)
  - key=`taxRate_accommodation` value=`0.10` (VAT on room nights)
  - key=`taxRate_standard` value=`0.15` (VAT on adventure / a la carte)
- [ ] `Messages` [NEW] — title, body, startDate, endDate, active, displayPage, priority.
      Read=Anyone (guest page shows active ones), Write=Admin.
- [ ] `SeasonalRates` (optional — only if using seasonal pricing)
- [ ] (`Packages` — RETIRED, do NOT create.)
Set permissions: guest-readable for Rooms; **Admin only** for Bookings/
BookingReports/Payments/Invoices/Settings.

## STAGE 2 — Paste the BACKEND files ✅
In the Editor code tree under **Backend**, create each file with the EXACT name
and paste the contents from this repo's `velo/backend/`:

|| Create in Backend/      | Paste from                              |
||-------------------------|-----------------------------------------|
|| `wbeConfig.js`          | velo/backend/wbeConfig.js               |
|| `availability.web.js`   | velo/backend/availability.web.js        |
|| `seasonal.web.js`       | velo/backend/seasonal.web.js            |
|| `pricing.web.js`        | velo/backend/pricing.web.js (old model) |
|| `roomPricing.web.js`    | velo/backend/roomPricing.web.js  (NEW)  |
|| `packagePricing.web.js` | velo/backend/packagePricing.web.js (NEW)|
|| `settings.web.js`       | velo/backend/settings.web.js            |
|| `search.web.js`         | velo/backend/search.web.js              |
|| `rooms.web.js`          | velo/backend/rooms.web.js               |
|| `payments.web.js`       | velo/backend/payments.web.js            |
|| `reporting.web.js`      | velo/backend/reporting.web.js           |
|| `invoices.web.js`       | velo/backend/invoices.web.js            |
|| `messages.web.js`       | velo/backend/messages.web.js   (NEW)    |
|| `issueInvoice.web.js`   | velo/backend/issueInvoice.web.js (NEW)  |
|| `jobs.config`           | velo/backend/jobs.config (daily status job) |

|- [ ] All 15 created and pasted. (Tip: paste in this order so imports resolve.)

## STAGE 3 — Build the PAGES + paste page code ✅
Use the mockup (`mockups/booking-pages-mockup.html`) as the visual target and
`mockups/WIX_PAGE_BUILD_SPEC.md` for the exact element IDs.
- [ ] **Search page:** add elements, set IDs, paste `velo/page-booking-search.js`.
      This page fetches active messages and shows them above the date pickers.
      Guests can select MULTIPLE rooms from the results.
- [ ] **Booking Summary page:** review selected rooms, adjust guest counts per room,
      paste `velo/page-booking-summary.js`. Reads selections from session storage.
- [ ] **Guest & Confirm page:** capture name/email/phone, call `velo/page-guest-confirm.js`.
      Creates one booking per room, generates combined invoice, stores PDF, logs reports.
- [ ] **Admin Console page:** add elements per spec, paste `velo/page-admin-console.js`
      (+ payments/settings snippets from `PAYMENTS.md`, `PRICING_MODEL.md`).
      Then LOCK IT DOWN per `ADMIN_ACCESS.md`: hide from menu + Members-only.

## STAGE 4 — Deploy the invoice/PDF/email service 🐍
This is the ONE part that is NOT pasted into Wix (Velo can't run Python/reportlab).
Follow `INVOICING_EMAIL.md`:
- [ ] Deploy `invoice_service.py` to a host (Google Cloud Run recommended; Render/
      Fly/VM also fine). Set env: `WBE_SHARED_SECRET`, `WBE_COUNTER_PATH`.
- [ ] Copy `~/.hermes/gmail_token.json` + `~/.hermes/google_client_secret.json`
      to the host (Gmail send is already authorized & tested).
- [ ] In Wix: store the same secret in **Secrets Manager** (`WBE_SHARED_SECRET`).
- [ ] Add a Velo backend module that fetches the service URL with the secret
      header (snippet in `INVOICING_EMAIL.md`), then calls `storeInvoice`.

## STAGE 5 — Test on the published site ✅
- [ ] Preview: search dates → see rooms/prices → book → invoice emailed + stored.
- [ ] Messages: create a message in admin → confirm it shows on the booking page.
- [ ] Blocking: block a room → confirm guest search shows it unavailable.
- [ ] Hotel closure: block all rooms → confirm no bookings possible.
- [ ] Overlap protection: try blocking a room with an existing booking → confirm
      block is reduced or refused, never overriding the guest.
- [ ] Admin: run report, record a payment, cancel/edit, change split + property fee %.
- [ ] Confirm a quote shows the property fee BELOW the VAT lines (booking screen + invoice).
- [ ] Logged-out / as a visitor: confirm the admin page is NOT reachable.
- [ ] Confirm the daily status job advances Confirmed→In-House→Checked-Out.
- [ ] Confirm Blocked bookings are excluded from revenue reports.

---

## The mental model (so the "how does code get in" is clear)
- **Backend logic + page code** → copy-paste into the Wix Editor (Stages 2–3).
  No git, no upload — Wix stores it inside your site.
- **Invoice PDF/email service (Python)** → deployed to a separate host, called by
  Wix over HTTPS (Stage 4). This is the only "real deployment."
- **The GUI (visual layout)** → you build it in the Editor by dragging elements
  (Stage 3), matched to the mockup + element-ID spec.

## What's verified vs. what needs live Wix testing
- All booking/pricing/VAT/payment/report/invoice LOGIC is unit-tested in Python
  and the Velo JS was checked to match. The Gmail email send is proven live.
- The Wix-only parts (Wix Data reads/writes, Media gallery, the scheduled job,
  page wiring, the deployed service URL) can only be tested inside Wix once loaded.
