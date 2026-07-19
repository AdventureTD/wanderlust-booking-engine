# Wanderlust Booking Engine

Adventure-travel booking system for Wanderlust Caribbean. This repo contains
a **tested core engine** plus a **Wix Velo integration layer** (`velo/`) for
pages, backend modules, and Google Ads server-side conversion tracking. The
Python core runs availability, dual-VAT pricing, invoicing, and reporting logic.

## Status (2026-06-03)
- [x] Room catalog & inventory (Adventure Suite x3, Penthouse x1, Two-Bedroom x1)
- [x] **Room Pricing by length of stay** — per-night rate varies by nights booked
      (Packages.baseRate collection: roomCode + nights → baseRate)
- [x] Availability engine — prevents overbooking per unit count; same-day turnover OK
- [x] Pricing engine — dual VAT (10% accommodation / 15% everything else)
- [x] A la carte add-ons (whale watching, canyoning, private chef, airport transfer)
- [x] 97 passing tests (run all: `for f in tests/test_*.py; do python3 "$f"; done`)
- [ ] Wix integration path — AWAITING OWNER DECISION
- [ ] Real photos, room descriptions — PLACEHOLDERS in code, owner to confirm
- [ ] Persistent storage (currently in-memory) — depends on chosen Wix path
- [ ] Payment handling — not started

## IMPORTANT: prices, photos, occupancy are PLACEHOLDERS
Per the project's strict no-fabrication rule, all dollar amounts, photo URLs,
and max-occupancy figures in `rooms.py` / `catalog.py` are clearly marked
placeholders. They MUST be replaced with owner-confirmed values before this
quotes a real guest.

## How the money works
- Per-night base rate is looked up from the **Packages.baseRate** collection by
  room code + number of nights booked (rates vary by length of stay).
- Accommodation (room nights) → 10% VAT
- A la carte extras → 15% VAT
- Default is tax-EXCLUSIVE (VAT added on top). If your listed prices already
  include VAT, set `Quote(prices_include_vat=True)` and the engine
  back-computes net + tax. (Owner: confirm which one your prices are.)

## Wix integration — three paths (owner to choose)

The core logic above runs anywhere. How it gets INTO your Wix site is the
open decision. Honest trade-offs:

1. **Wix native Bookings/Hotels apps** — least code, least flexible.
   May not support dual-VAT or the exact package+a-la-carte flow. Worth
   checking first whether it can even do per-class VAT.

2. **Wix Velo (custom code inside Wix)** — runs natively in your site using
   Wix's own database + backend. Requires a paid Premium plan + Dev Mode on.
   This engine's logic would be translated to Velo's JavaScript. Most
   "native" feel; bounded by Velo's platform limits.

3. **Standalone app embedded via iframe** — I host a small booking web app
   elsewhere and embed it in a Wix HTML element. Full control, any database,
   any payment provider. Downside: separate hosting to maintain + styling
   effort to match your Wix look.

Recommendation: confirm whether Wix's native Hotels app supports the dual-VAT
+ packages flow. If yes, cheapest. If no, the iframe app (path 3) gives the
most control with the least fighting against Wix's limits.

## Layout
```
booking_engine/
  rooms.py         room types, unit counts, descriptions, photos
  Packages collection  per-night rates by room + nights (Packages.baseRate lookup)
  catalog.py       a la carte items, tax classes + VAT rates
  availability.py  Calendar + Booking; overbooking prevention
  pricing.py       Quote builder + dual-VAT math + itemized breakdown
  Packages collection  Adventure Package model (50/50 split, property fee)
  search.py        guest availability search (filters by rate availability)
tests/
  test_Packages collection   10 tests for Packages.baseRate lookup
  test_Packages collection 22 tests for package pricing + property fee
  test_search.py          10 tests for search + rate filtering
  test_engine.py          11 tests for core availability + pricing
  (+ 6 more test files: occupancy, rates, payments, reservation, report, seasonal)
velo/backend/
  roomPricing.web.js   rate lookup from Packages.baseRate collection  [NEW]
  packagePricing.web.js  Adventure Package pricing (mirrors Python)
  search.web.js        availability search (mirrors Python)
  rooms.web.js         room media/photos
  (+ 7 more backend files)
```
