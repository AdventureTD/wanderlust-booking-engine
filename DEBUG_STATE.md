# Wanderlust Booking Engine — Debug State
## Session checkpoint: 2026-07-12

### Current Code State
- **GitHub `main` HEAD:** `5a9a277`
- **Render:** Auto-deployed from `main` (deploy in progress)
- **Wix Live status:** Python-only fix, no Velo copy needed this time

### Promo Code Feature (NEW)
### Latest Fix
- **Invoice creation stopped** because `booking_engine/invoice_pdf.py` used `biz_html` before it was defined (NameError on Render).
- Fix pushed in `5a9a277`; local PDF generation verified.

### Files Modified in Last Session
- `booking_engine/invoice_pdf.py` — moved `biz_html` definition before header table construction

### Critical Recalls
- BookingSummary `status` = `"In Process"` (with space, capital I and P)
- `accommodationShare` lives in Wix Settings Collection (decimal 0.0–1.0)
- Backend `search.web.js` fixed at `1bd4f96` — in-memory Date parsing for text-stored dates
- Calendar secret: `WBE_CALENDAR_SECRET` on Render must match Google Apps Script hardcoded `CALENDAR_SECRET`
