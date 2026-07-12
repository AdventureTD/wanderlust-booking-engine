# Wanderlust Booking Engine — Debug State
## Session checkpoint: 2026-07-12

### Current Code State
- **GitHub `main` HEAD:** `598471d`
- **Render:** Auto-deployed from `main`
- **Wix Live status:** UNVERIFIED — files pushed to GitHub; copying into Wix Editor + Publish pending

### Promo Code Feature (NEW)
- Collection: `PromoCodes` (no space; fields: `title`, `discount`, `startDate`, `endDate`)
- Discount applied to subtotal BEFORE VAT and property fee
- Frontend: guest enters code on Booking Summary page; `validatePromoCode` webMethod checks startDate/endDate inclusive
- Displays: "Promo Code (CODE): -$XXX.XX (-15%)" 
- Invoice PDF shows: original subtotal → discount line → discounted subtotal → VAT/fees → TOTAL DUE
- Booking rows store `promoCode` and `promoDiscount` in Bookings collection

### Files Modified in Last Session
- `velo/page-booking-summary.js` — promo input triggers on Enter, blur, and button click
- `velo/backend/availability.web.js` — validatePromoCode queries `PromoCodes` collection (no space)
- `booking_engine/invoice.py` — Invoice dataclass gains promo_code, promo_discount_rate, promo_discount_amount
- `booking_engine/invoice_pdf.py` — promo discount line in totals block

### Critical Recalls
- BookingSummary `status` = `"In Process"` (with space, capital I and P)
- `accommodationShare` lives in Wix Settings Collection (decimal 0.0–1.0)
- Backend `search.web.js` fixed at `1bd4f96` — in-memory Date parsing for text-stored dates
- Calendar secret: `WBE_CALENDAR_SECRET` on Render must match Google Apps Script hardcoded `CALENDAR_SECRET`
