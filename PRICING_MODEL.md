# Wanderlust Booking Engine — Pricing Model (Adventure Package, 50/50 split)

**Effective 2026-06-02 — this REPLACES the earlier room-rate + separate-packages
+ extra-guest pricing model.**

**UPDATED 2026-06-03: per-night base rate now varies by length of stay** (moved
from the Rooms collection to a new Packages.baseRate collection).

## The model
Each room type has an **Adventure Package** price per night that **varies by
the number of nights booked**. Rates are stored in the **Packages.baseRate**
collection, keyed by `(roomCode, nights)`.

| Room                  | Night count example | Adventure Package / night |
|-----------------------|--------------------|--------------------------|
| Adventure Suite       | 4–10 (seeded)       | $792 (initial seed)      |
| Penthouse Apartment   | 4–10 (seeded)       | $930 (initial seed)      |
| Two-Bedroom Apartment | 4–10 (seeded)       | $1,188 (initial seed)    |

**The owner sets the actual rates per room per night count in the Wix Content
Manager.** For example, Suite at 4 nights might be $850/night while Suite at 7
nights might be $750/night. Add or remove rows to control which stay lengths
are bookable.

**Exact match rule:** if a guest searches for a stay length that has no row in
Packages.baseRate for a room, that room does NOT appear in search results. This is
intentional — the owner controls which stay lengths are bookable.

For a stay:
```
total_package_price = nights × package_price_per_night
```
That total is split **50/50** for tax (the split is an editable admin setting —
see "Configurable split" below):
- **Accommodation** = accommodation share → **10% VAT**
- **Adventure Package** = remainder → **15% VAT**
```
grand_total = total_package_price + VAT(accommodation) + VAT(adventure)
```

### Worked example (Adventure Suite, 5 nights @ $792)
- Total package price: 5 × 792 = **$3,960.00**
- Accommodation $1,980.00 + 10% = $198.00
- Adventure Package $1,980.00 + 15% = $297.00
- Total VAT = $495.00
- **Grand total = $4,455.00**

## Where the price shows (Room Detail page — after guest selects a room)

The baseRate in Packages.baseRate is the **all-in price** (room + adventure package
combined). When a guest selects a room, the page shows the pricing breakdown
from top to bottom:

1. **Overall price (top):** the total Adventure Package price for the stay
   (e.g. "5 nights @ $792/night = $3,960.00"). This is the all-in number.
2. **Accommodation VAT (10%):** 10% on the accommodation half of the 50/50
   split (e.g. "Accommodation: $1,980.00 + 10% VAT = $198.00").
3. **Adventure Package VAT (15%):** 15% on the adventure half of the 50/50
   split (e.g. "Adventure Package: $1,980.00 + 15% VAT = $297.00").
4. **Property fee:** the fee as a % of the net total, below the VAT lines,
   untaxed (e.g. "Property fee (5%): $198.00").
5. **Grand total (bottom):** overall price + both VATs + property fee
   (e.g. "$4,653.00").

## Code
- Python (reference, tested): `booking_engine/Packages collection` → rate lookup;
  `booking_engine/Packages collection` → `quote_package(room_code, nights)`.
  10 room-pricing tests + 22 package-pricing tests.
- Velo (mirror, verified to match): `velo/backend/roomPricing.web.js` →
  `getBaseRate(roomCode, nights)`; `velo/backend/packagePricing.web.js` →
  `quotePackage(roomCode, nights)`.
- Per-night price lives in the `Packages.baseRate` collection (editable in the Wix
  Content Manager), keyed by `roomCode` + `nights`.

## Wix Packages.baseRate collection — NEW (replaces baseRate on Rooms)
| Field     | Type   | Notes                                                    |
|-----------|--------|----------------------------------------------------------|
| roomCode  | Text   | which room type this rate applies to                     |
| nights    | Number | length of stay in nights (e.g. 4, 5, 6, ...)            |
| baseRate  | Number | per-night Adventure Package price (USD, VAT not incl.)   |

Seed (initial rates, all the same as the original fixed prices):
| roomCode              | nights | baseRate |
|-----------------------|--------|----------|
| adventure_suite       | 4      | 792      |
| adventure_suite       | 5      | 792      |
| adventure_suite       | 6      | 792      |
| adventure_suite       | 7      | 792      |
| adventure_suite       | 8      | 792      |
| adventure_suite       | 9      | 792      |
| adventure_suite       | 10     | 792      |
| penthouse_apartment   | 4      | 930      |
| penthouse_apartment   | 5      | 930      |
| penthouse_apartment   | 6      | 930      |
| penthouse_apartment   | 7      | 930      |
| penthouse_apartment   | 8      | 930      |
| penthouse_apartment   | 9      | 930      |
| penthouse_apartment   | 10     | 930      |
| two_bedroom_apartment | 4      | 1188     |
| two_bedroom_apartment | 5      | 1188     |
| two_bedroom_apartment | 6      | 1188     |
| two_bedroom_apartment | 7      | 1188     |
| two_bedroom_apartment | 8      | 1188     |
| two_bedroom_apartment | 9      | 1188     |
| two_bedroom_apartment | 10     | 1188     |

To change a rate: edit the row in Content Manager. To make a room unbookable
at a certain stay length: delete that row. To support longer stays: add rows.

## Wix Rooms collection — REMOVED field
`packagePricePerNight` is NO LONGER on the Rooms collection. The `baseRate`
field is also removed. Per-night rates now live in Packages.baseRate (above).

## What this RETIRED (no longer used for new pricing)
- The separate **Packages** (Sampler/Explorer/Wanderluster) as add-ons and the
  **à la carte** items are NOT part of the new price. (The old catalog.py still
  exists and `TAX_RATES` is still used, but the package/extra-guest pricing path
  is superseded by this model.)

## Extra-guest charge (Two-Bedroom 4th guest) — IN the new model
The Two-Bedroom Apartment allows a 4th guest (base occupancy is 3). The 4th
guest adds **1/3 of the base per-night package rate**, per night:
- 1/3 × $1,188 = **$396 / night** for the extra guest.
This extra amount is added to the package total BEFORE the 50/50 split, so it's
taxed 10%/15% like the rest of the package (owner decision 2026-06-02).

### Worked example (Two-Bedroom, 5 nights, 4 guests)
- Base package: 5 × $1,188 = $5,940.00
- 4th guest: 5 × $396 = $1,980.00
- Total package price = **$7,920.00**
- Accommodation $3,960 + 10% = $396.00
- Adventure Package $3,960 + 15% = $594.00
- Total VAT = $990.00
- **Grand total = $8,910.00**

`quote_package(room_code, nights, guests=N)` / `quotePackage(roomCode, nights,
null, guests)` apply this automatically. The extra/night is computed as
`packagePricePerNight / 3`, so it tracks the base rate if you change it.

## Configurable split (admin setting — change without code)
The accommodation/adventure split is an EDITABLE setting, not hardcoded. It's
stored in the Wix `Settings` collection under key `accommodationShare`
(a fraction 0..1). Default 0.50 (50/50). To change to 60/40, set it to 0.60 in
the admin console — the accommodation half becomes 60%, the Adventure Package
half the remaining 40%. No code change needed.

- Velo: `backend/settings.web.js` → `getAccommodationShare()` /
  `setAccommodationShare(share)` (admin-only; accepts 0.60 or 60).
  `quotePackage()` reads the current share automatically.
- Python: `quote_package(..., accommodation_share=0.60)`; default comes from
  `DEFAULT_ACCOMMODATION_SHARE`. Values outside 0..1 are rejected.
- Admin console: "Pricing settings" panel — enter accommodation share %
  (`#inputAccomShare`) + Save (`#btnSaveSplit`).

Worked example — Adventure Suite, 5 nights, 60/40:
- Total $3,960 → Accommodation $2,376 (+10% = $237.60) + Adventure Package
  $1,584 (+15% = $237.60) → Total VAT $475.20 → **Grand total $4,435.20**.

## Property fee (configurable, below VAT)
Every booking includes a **property fee** charged on the NET package price
(pre-VAT subtotal), shown as a line **below the VAT taxes** on both the booking
screen and the invoice. The fee is **NOT itself taxed**.

- Default **5%**. Editable admin setting — `Settings` key `propertyFeeRate`
  (fraction 0..1). Change to 8% by setting 0.08 (or entering 8 in the admin).
- Velo: `backend/settings.web.js` → `getPropertyFeeRate()` /
  `setPropertyFeeRate(rate)` (admin-only). `quotePackage()` reads it automatically.
- Python: `quote_package(..., property_fee_rate=0.05)`; default
  `DEFAULT_PROPERTY_FEE_RATE`. Out-of-range values rejected.
- Admin console: "Pricing settings" panel — "Property fee %" field
  (`#inputPropertyFee`) + Save.

### Worked example (Adventure Suite, 5 nights, 5% fee)
- Net package price: $3,960.00
- Total VAT: $495.00
- **Property fee (5% of $3,960): $198.00**  ← below VAT, untaxed
- **Grand total = $4,653.00**

## Reconciliation guarantee
The two halves always sum back to the total exactly (the second half is the
remainder, so odd-cent totals like $100.01 → $50.01 + $50.00 reconcile, at any
split). Verified for all rooms × 4–10 nights and at 40/55/60/66.7/75 splits, and
the Velo JS was checked to match Python.
