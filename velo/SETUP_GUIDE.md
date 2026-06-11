# Wanderlust Booking Engine — Wix Velo Setup Guide

This guide gets the booking engine running natively inside your Wix site using
Velo. Follow it in order. Steps marked **[YOU]** require your Wix login (I can't
do them remotely). Steps marked **[CODE]** are paste-the-file-in steps.

> Reference truth: the Python engine in `../booking_engine/` has 11 passing
> tests. The Velo JS mirrors it; the pricing math was verified to produce
> identical totals. Availability (DB queries) must be tested live in Wix.

---

## PREREQUISITES [YOU]
1. A paid **Wix Premium plan** (Velo backend + Wix Data require this; free
   sites cannot publish Velo backend code).
2. Turn on Dev Mode: open your site in the **Wix Editor** → top menu → toggle
   **Dev Mode** (a.k.a. "Velo"). You'll now see a code panel + a `Backend` and
   `Public` file tree.

---

## STEP 1 — Create the database collections [YOU]
In the Editor: left sidebar → **Content Manager** (CMS) → **+ Create
Collection**. Create these four. Field names must match EXACTLY (Velo is
case-sensitive).

### Collection: `Rooms`
| Field           | Type     | Notes                                  |
|-----------------|----------|----------------------------------------|
| roomCode        | Text     | adventure_suite / penthouse_apartment / two_bedroom_apartment |
| name            | Text     | Display name                           |
| units           | Number   | 3 / 1 / 1                              |
| baseOccupancy   | Number   | guests included in base rate           |
| maxOccupancy    | Number   | max guests the room sleeps             |
| extraGuestFee   | Number   | per night, per guest beyond baseOccupancy (0 if none) |
| description     | Text     |                                        |
| photoGallery    | Media Gallery | Native Wix gallery — upload room photos here in the Content Manager |
| mainPhoto       | Image    | Single hero/thumbnail image for list views |

**NOTE (2026-06-03): `baseRate` has been REMOVED from this collection.** Per-night
rates now live in the `RoomPricing` collection (below) and vary by length of stay.

Seed with these CONFIRMED values (owner 2026-06-01):
| roomCode              | name                  | units | baseOccupancy | maxOccupancy | extraGuestFee |
|-----------------------|-----------------------|-------|---------------|--------------|---------------|
| adventure_suite       | Adventure Suite       | 3     | 2             | 2            | 0             |
| penthouse_apartment   | Penthouse Apartment   | 1     | 2             | 2            | 0             |
| two_bedroom_apartment | Two-Bedroom Apartment | 1     | 3             | 4            | 396           |

### Collection: `RoomPricing`  [NEW — 2026-06-03]
Per-night Adventure Package rates that vary by length of stay.
| Field     | Type   | Notes                                                |
|-----------|--------|------------------------------------------------------|
| roomCode  | Text   | which room type this rate applies to                 |
| nights    | Number | length of stay in nights (e.g. 4, 5, 6, ...)        |
| baseRate  | Number | per-night Adventure Package price (USD, VAT not incl.) |

Permissions: **Read = Anyone** (search needs to look up rates); Write = Admin only.

**Exact match rule:** if a guest searches for a stay length that has no row for
a room, that room does NOT appear in search results. Add rows for every stay
length you want to support. Delete rows to stop accepting that length.

Seed with initial rates (3 rooms × 7 night counts = 21 rows):
| roomCode              | nights | baseRate |
|-----------------------|--------|----------|
| adventure_suite       | 4–10   | 792      |
| penthouse_apartment   | 4–10   | 930      |
| two_bedroom_apartment | 4–10   | 1188     |

(That means 7 rows per room: one for 4, one for 5, ..., one for 10.)
Edit rates per night count as needed — e.g. $750 for 7+ nights as a volume discount.

OCCUPANCY RULES (enforced in code): each room has a MINIMUM = its base occupancy
(no single-guest bookings) and a MAXIMUM. Adventure Suite & Penthouse: min 2 /
max 2. Two-Bedroom: min 3 / max 4 (the 4th guest is the +extraGuestFee add-on).
A booking for fewer than the base occupancy is rejected.

### Collection: `Bookings`
| Field      | Type      | Notes                                   |
|------------|-----------|-----------------------------------------|
| roomCode   | Text      | which room type                         |
| checkIn    | Date      | first night occupied                    |
| checkOut   | Date      | morning of departure (not a night)      |
| guests     | Number    |                                         |
| status     | Text      | confirmed / hold / cancelled / blocked  |
| quantity   | Number    | how many units this row consumes (default 1; used by blocks) |
| note       | Text      | e.g. blocked reason                     |
| alaCarte   | Tags     | array of selected AlaCarte.code strings (e.g. ["whale_watching", "airport_transfer"]) |
| quote      | Object   | full JSON price breakdown from quotePackage() (nested lineItems, vatByClass, totals) |

### Collection: `AlaCarte`
| Field      | Type   | Notes                                  |
|------------|--------|----------------------------------------|
| code       | Text   | whale_watching / canyoning / private_chef / airport_transfer |
| name       | Text   |                                        |
| price      | Number | USD                                    |
| taxClass   | Text   | always "standard" (15%)                |
| pricedPer  | Text   | person / booking                       |
| description| Text   |                                        |

NOTE (2026-06-03): the old **Packages** collection (Sampler/Explorer/Wanderluster)
has been REMOVED. The Adventure Package is now a single all-in per-night rate
in the RoomPricing collection. A la carte extras remain.

### Collection: `Settings`
Editable business settings (key/value) the admin can change without code.

| Field | Type   | Notes                          |
|-------|--------|--------------------------------|
| key   | Text   | setting name                   |
| value | Number | the value                      |

Seed rows:
- key=`accommodationShare`, value=`0.5` — package split: what % is accommodation vs adventure.
- key=`propertyFeeRate`, value=`0.05` — 5% property fee on net package price.
- key=`taxRate_accommodation`, value=`0.10` — VAT on room nights (10%).
- key=`taxRate_standard`, value=`0.15` — VAT on adventure services / a la carte (15%).

If any row is missing, the engine falls back to the defaults above.

### Collection: `Messages`  [NEW — 2026-06-05]
Table-driven messages displayed on the guest booking page (promos, closure notices).
| Field        | Type    | Notes                                               |
|--------------|---------|-----------------------------------------------------|
| title        | Text    | short headline                                      |
| body         | Text    | full message text                                   |
| startDate    | Date    | when to start showing (inclusive; null = no limit)  |
| endDate      | Date    | when to stop showing (inclusive; null = no limit)   |
| active       | Boolean | quick on/off toggle                                 |
| displayPage  | Text    | which page: search / detail / confirm               |
| priority     | Number  | sort order, higher = shown first                    |

Permissions: Read = Anyone (guest page fetches active messages); Write = Admin.

### Collection: `SeasonalRates`
Holds date-range pricing rules per room. Each row is one season/rule.
| Field        | Type   | Notes                                            |
|--------------|--------|--------------------------------------------------|
| roomCode     | Text   | which room type this rule applies to             |
| name         | Text   | e.g. "High Season", "Christmas Week"             |
| start        | Date   | first date of the rule (INCLUSIVE)               |
| end          | Date   | last date of the rule (INCLUSIVE)                |
| nightlyRate  | Number | USD per night during this rule                   |
| priority     | Number | higher wins when ranges overlap (e.g. holiday=100 over season=10) |

How it works: for each night of a stay, the engine finds the matching rule
with the HIGHEST priority; if none matches, it falls back to the room's
`baseRate`. A stay that crosses a season boundary is priced night-by-night.
Example: a Dec 13–17 stay with a "High Season" rule starting Dec 15 prices
2 nights at base + 2 nights at high season automatically.
Leave `SeasonalRates` empty and every night just uses the room's baseRate.

### Collection permissions [IMPORTANT]
- `Rooms`, `RoomPricing`, `AlaCarte`: **Read = Anyone** (so the booking page can
  show them); Write = Admin only.
- `Bookings`: Read = Admin (privacy!); the backend web module inserts on the
  guest's behalf, so guests never get direct write access to the raw collection.

---

## STEP 2 — Add the backend code files [CODE]
In the Editor code tree, under **Backend**, create these files and paste the
matching file contents from the `velo/backend/` folder in this repo:

| Create in Editor (Backend/) | Paste contents from           |
|-----------------------------|-------------------------------|
| `wbeConfig.js`              | `velo/backend/wbeConfig.js`     |
| `availability.web.js`       | `velo/backend/availability.web.js` |
| `pricing.web.js`            | `velo/backend/pricing.web.js`   |
| `seasonal.web.js`           | `velo/backend/seasonal.web.js`  |
| `messages.web.js`           | `velo/backend/messages.web.js`  |

Note: `.web.js` files are web modules — their exported functions run on the
server and are callable from page code via `import`.

---

## STEP 3 — Seed Rooms/RoomPricing/AlaCarte with REAL data [YOU]
Fill the collections with your confirmed prices, occupancy, photos, and
descriptions. (The code ships with PLACEHOLDER prices — do not go live until
these are your real numbers.) Also tell me whether your prices INCLUDE VAT or
not, so we set `pricesIncludeVat` correctly.

---

## STEP 4 — Frontend booking page [NEXT — needs your input]
The booking widget UI isn't built yet because it depends on your actual page
layout and Velo element IDs (date pickers, dropdowns, the "Book" button), which
I can't see. When you're ready, do ONE of:
  (a) Add the page elements in the Editor and send me their IDs (right-click
      element → it shows an ID like `#datePickerCheckIn`), and I'll write the
      page code wired to them, OR
  (b) Tell me to propose a layout and I'll give you element-by-element
      instructions + the matching page code.

The page code will simply call the backend, e.g.:
```js
import { isAvailable, createBooking } from 'backend/availability.web';
import { buildQuote } from 'backend/pricing.web';
```

---

## STEP 5 — Test live in Wix preview [YOU + ME]
Once collections + backend are in, use **Preview** and a test page (or the
browser console in Preview) to verify, e.g.:
- Booking the Penthouse twice on overlapping dates → 2nd is refused.
- Booking 3 Adventure Suites works; 4th overlapping is refused.
- A quote with a room + package shows 10% on the room, 15% on the package.

I'll give you an exact test checklist with expected results when we wire the page.

---

## What's verified vs. what needs live testing
- **Verified by me:** all pricing/VAT math (JS totals match the Python tests
  exactly).
- **Needs live testing in Wix (I can't run Velo here):** the Wix Data queries
  for availability, collection permissions, and the page wiring.
