# Wanderlust Booking Engine — Debug State
## Session checkpoint: 2026-07-12

### Current Code State
- **GitHub `main` HEAD:** `4f83a38`
- **Render:** Deployed and verified
- **Wix Live status:** page-booking-summary.js updated and published
- **Invoice creation:** working (tested WBE-INV-0001, total $12,038.94)

### Latest Fix
- **Invoice creation stopped** because `booking_engine/invoice_pdf.py` used `biz_html` before it was defined (NameError on Render).
- Fixed and deployed; 2.5s delay added so the invoice response is logged before redirect.

### Files Modified in Last Session
- `booking_engine/invoice_pdf.py` — moved `biz_html` definition before header table construction
- `velo/page-booking-summary.js` — wait up to 2.5s for invoice response before redirect

### Critical Recalls
- BookingSummary `status` = `"In Process"` (with space, capital I and P)
- `accommodationShare` lives in Wix Settings Collection (decimal 0.0–1.0)
- Backend `search.web.js` fixed at `1bd4f96` — in-memory Date parsing for text-stored dates
- Calendar secret: `WBE_CALENDAR_SECRET` on Render must match Google Apps Script hardcoded `CALENDAR_SECRET`
