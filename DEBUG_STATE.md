# Wanderlust Booking Engine — Debug State
## Session checkpoint: 2026-07-05

### Current Bug
**Room inventory filter fails:** Booking search for 07/05/2026 → 07/12/2026 returns Adventure Suite with `maxQty: 3` (fully available) despite **5 confirmed bookings** existing for those exact dates in the CMS.

### Root Cause Hypothesis
Backend `search.web.js` overlap logic calculates zero overlapping bookings for `adventure_suite`. The status-filtering allow-list was removed in favor of a "exclude cancelled only" approach, but the console still shows `maxQty: 3`.

### Current Code State
- **GitHub `main` commit:** `d7b97c4`
- **File with the fix:** `velo/backend/search.web.js`
  - Logic: excludes `cancelled`/`canceled` bookings only; everything else counts as occupied
  - Response now includes `_ver: 'cancel-only-v2'` to verify deployment
- **Frontend:** `velo/page-booking-search.js` is stable (no diagnostics imports — was reverted after crash)

### Immediate Test Needed
1. Copy `velo/backend/search.web.js` from GitHub commit `d7b97c4` into Wix Editor → Backend
2. Click **Publish**
3. Hard-refresh live site (Ctrl+F5)
4. Search dates: **07/05/2026 to 07/12/2026**
5. Open browser console
6. Check `[WBE-SEARCH] raw results:` JSON
7. **CRITICAL:** Look for `"_ver":"cancel-only-v2"` in the response
   - If **YES** → code is deployed. If `adventure_suite.maxQty` is still `3`, the bug is in overlap logic (BookingSummary dates or bookingNumber mismatch).
   - If **NO** → Wix is not deploying the updated `search.web.js`. Need to check Wix Editor backend file contents.

### Other Deployments (Stable)
- **Invoice PDF:** `booking_engine/invoice_pdf.py` — "Package Details:" label + spacer fix; Render redeployment still needed
- **Google Calendar Webhook:** `scripts/google-calendar-webhook.gs` — `CALENDAR_SECRET` synced; needs new Apps Script deployment version
- **Wix Velo files:** `availability.web.js`, `page-booking-search.js` are deployed and functional

### Known CMS Data
- Adventure Suite bookings exist: WBE-INV-0001, 0004, 0005, 0006, 0007 (all 07/05-07/12)
- BookingSummary collection has matching records with correct `checkIn`/`checkOut` dates
- Bookings status field value is `"In Process"` (observed earlier; may include other values)

### Next Steps If _ver Is Present But maxQty Still 3
- Inspect `summaryMap` population — verify `bookingNumber` string matching between Bookings and BookingSummary
- Add logging inside the `bpn` loop to print `summaryMap[String(bk.bookingNumber)]` for each booking
- Consider whether `overlapNumbers` query (line 136-146) finds the summaries before the main loop runs
