# Wanderlust Booking Engine — Admin Console Element ID Reference

This doc lists every UI element ID that the admin console page code expects.
Add these elements to your Wix page in the Editor, set their ID exactly as shown
(case-sensitive), then paste the page code. No code changes needed.

> Tip: In the Editor, click an element → Properties panel → ID field. Change it
to the exact value below. The code uses these IDs to read values and attach click
handlers.

---

## SHARED / FALLBACK ELEMENTS

| Element ID | Type | Purpose |
|------------|------|---------|
| `#statusText` | Text | General fallback status / error messages (used by all sections if their own status text is missing) |

---

## 1) REPORTS SECTION

| Element ID | Type | Purpose |
|------------|------|---------|
| `#datePickerFrom` | Date Picker | Report start date |
| `#datePickerTo` | Date Picker | Report end date |
| `#dateFieldSelect` | Dropdown | Which date to filter by: `dateBooked` / `checkInDate` / `checkOutDate` |
| `#btnRunReport` | Button | Run the report |
| `#bookingsRepeater` | Repeater | Displays booking rows from the report |
| `#sumCount` | Text | Total bookings found |
| `#sumRevenueCount` | Text | Bookings that count toward revenue (excludes Cancelled/Pending/Blocked) |
| `#sumAccommodation` | Text | Total accommodation net |
| `#sumPackages` | Text | Total package net |
| `#sumVat10` | Text | Total 10% VAT |
| `#sumVat15` | Text | Total 15% VAT |
| `#sumVatTotal` | Text | Combined VAT |
| `#sumGrandTotal` | Text | Grand total |

**Repeater fields to bind inside `#bookingsRepeater`:**
- `guestName`, `bookingNumber`, `guestPhone`, `guestEmail`
- `dateBooked`, `checkInDate`, `checkOutDate`, `status`
- `accommodationSaleNet`, `packageSaleNet`, `totalVat10`, `totalVat15`, `totalVat`, `grandTotal`

---

## 2) BOOKING CRUD SECTION

| Element ID | Type | Purpose |
|------------|------|---------|
| `#sectionBookings` | Container | Wrapper for the booking section (optional) |
| `#ddBookingRoom` | Dropdown | Room type: `adventure_suite`, `penthouse_apartment`, `two_bedroom_apartment` |
| `#dpBookingCheckIn` | Date Picker | Guest check-in |
| `#dpBookingCheckOut` | Date Picker | Guest check-out |
| `#inpBookingGuests` | Input | Number of guests |
| `#inpBookingName` | Input | Guest full name |
| `#inpBookingEmail` | Input | Guest email |
| `#inpBookingPhone` | Input | Guest phone |
| `#btnCreateBooking` | Button | Create the booking |
| `#btnLoadBookings` | Button | Refresh the bookings list (optional — auto-loads on page ready) |
| `#bookingsListRepeater` | Repeater | List of recent bookings |
| `#bookingStatusText` | Text | Section-specific status (falls back to `#statusText` if missing) |

**Repeater fields to bind inside `#bookingsListRepeater`:**
- `guestName`, `roomCode`, `checkInDate`, `checkOutDate`, `status`, `grandTotal`

---

## 3) BLOCKING SECTION

| Element ID | Type | Purpose |
|------------|------|---------|
| `#sectionBlocking` | Container | Wrapper for the blocking section (optional) |
| `#ddBlockRoom` | Dropdown | Room to block |
| `#dpBlockStart` | Date Picker | Block start date |
| `#dpBlockEnd` | Date Picker | Block end date |
| `#inpBlockQuantity` | Input | How many units to block (default 1) |
| `#inpBlockReason` | Input | Reason / note (e.g. "Maintenance", "Off-season closure") |
| `#btnBlockRoom` | Button | Block the selected room |
| `#btnBlockAllRooms` | Button | Close the entire hotel for the date range |
| `#btnLoadBlocks` | Button | Refresh blocks list (optional — auto-loads on page ready) |
| `#blocksListRepeater` | Repeater | List of current blocks |
| `#blockStatusText` | Text | Section-specific status (falls back to `#statusText` if missing) |

**Repeater fields to bind inside `#blocksListRepeater`:**
- `roomCode`, `quantity`, `checkIn`, `checkOut`, `note`

**Button inside repeater item:**
- `#btnUnblock` | Button | Removes the block when clicked

---

## 4) MESSAGES SECTION

| Element ID | Type | Purpose |
|------------|------|---------|
| `#sectionMessages` | Container | Wrapper for the messages section (optional) |
| `#inpMsgTitle` | Input | Message title / headline |
| `#inpMsgBody` | Input (or Text Box) | Full message text |
| `#dpMsgStart` | Date Picker | When to start showing (null = no limit) |
| `#dpMsgEnd` | Date Picker | When to stop showing (null = no limit) |
| `#ddMsgPage` | Dropdown | Which page: `search` / `detail` / `confirm` |
| `#inpMsgPriority` | Input | Priority number (higher = shown first) |
| `#swMsgActive` | Switch | On/off toggle for the message |
| `#btnSaveMessage` | Button | Create or update the message |
| `#btnLoadMessages` | Button | Refresh messages list (optional — auto-loads on page ready) |
| `#messagesListRepeater` | Repeater | List of all messages |
| `#msgStatusText` | Text | Section-specific status (falls back to `#statusText` if missing) |

**Repeater fields to bind inside `#messagesListRepeater`:**
- `title`, `body`, `page`, `priority`, `active`, `start`, `end`

**Buttons inside repeater item:**
- `#btnEditMessage` | Button | Loads the message into the form for editing
- `#btnDeleteMessage` | Button | Deletes the message

---

## 5) TAX RATES SECTION

**What:** Update VAT percentages without touching code. These two rates drive
ALL pricing in the engine: every quote, invoice, and report recalculates from
the live settings.

| Element ID | Type | Purpose |
|------------|------|---------|
| `#sectionTaxRates` | Container | Wrapper for the tax rates section (optional) |
| `#inpTaxRateAccom` | Input | Accommodation VAT % (default 10, for room nights) |
| `#inpTaxRateStandard` | Input | Standard VAT % (default 15, for adventure / a la carte) |
| `#btnSaveTaxRates` | Button | Save the new rates into Settings |
| `#currentTaxRatesText` | Text | Read-only display: "Current: Accommodation X% / Standard Y%" |
| `#taxStatusText` | Text | Section-specific status (falls back to `#statusText`) |

**How it works:**
1. The page loads → `loadTaxRates()` reads `Settings` rows `taxRate_accommodation`
   and `taxRate_standard`, displays them.
2. Admin enters new numbers → clicks Save → `setTaxRate('accommodation', n)` and
   `setTaxRate('standard', n)` update the Settings collection.
3. **Every future quote/report picks up the new rates automatically.** No Velo
   deploy needed.

**Validation:** `setTaxRate()` rejects values outside 0–99%. If a row is missing,
the engine uses its hard-coded fallback (10% / 15%) so nothing breaks.

---

## GUEST BOOKING SEARCH PAGE

This is a separate page (not the admin console). Paste `velo/page-booking-search.js`
into its code panel.

| Element ID | Type | Purpose |
|------------|------|---------|
| `#messagesContainer` | Container | Wrapper for active messages (can be a Box that shows/hides) |
| `#messagesRepeater` | Repeater | (Optional) if you want multiple messages; falls back to `#messageText` if missing |
| `#messageText` | Text | (Fallback) single text element for the top message |
| `#datePickerCheckIn` | Date Picker | Guest check-in |
| `#datePickerCheckOut` | Date Picker | Guest check-out |
| `#btnSearchRooms` | Button | Search availability |
| `#searchResultsRepeater` | Repeater | Room search results |
| `#statusText` | Text | Status / error messages |

---

## PERMISSIONS REMINDER

After building the page in the Editor:

1. Go to the page → **Settings** (gear icon) → **Permissions**
2. Set to **Members only**
3. Restrict to the **Admin** role

The backend functions are already `Permissions.Admin`, so even if the page were
accidentally exposed, no non-admin could read financial data or modify bookings.
But locking the page is the correct second layer.

---

## QUICK CHECKLIST (before you paste code)

- [ ] All element IDs above are created and named exactly
- [ ] Dropdown options match the expected values (room codes, date fields, pages)
- [ ] Repeaters have the bound fields listed above
- [ ] `#btnUnblock`, `#btnEditMessage`, `#btnDeleteMessage` exist INSIDE their repeater items
- [ ] Page permissions = Members only → Admin role
- [ ] Admin console is hidden from the site menu
