# Wanderlust Booking Engine — Wix Page Build Spec (Element IDs)

This is the bridge between the visual mockup and the Velo code. Open the mockup
(`mockups/booking-pages-mockup.html`) in a browser to see the layout. In the Wix
Editor, add the elements below to each page and give every element the EXACT ID
shown (right-click an element → it shows its ID; rename it to match). Once the IDs
match, the Velo code drives everything — no code changes needed.

> How to set an element's ID in Wix: select the element → open the Properties &
> Events panel → set the "ID" field. IDs are case-sensitive.

---

## PAGE 1 — Availability Search (paste: `velo/page-booking-search.js`)

| Element to add        | Type            | ID                    | Notes |
|-----------------------|-----------------|-----------------------|-------|
| Messages container    | Repeater or Text| `messagesContainer`   | Shows active promo/closure notices above dates |
| Check-in picker       | Date Picker     | `datePickerCheckIn`   |       |
| Check-out picker      | Date Picker     | `datePickerCheckOut`  |       |
| Search button         | Button          | `btnSearchRooms`      |       |
| Status / error text   | Text            | `statusText`          |       |
| Results list          | Repeater        | `searchResultsRepeater`| One card per available room |
| — inside repeater: photo   | Image      | `roomThumb`           |       |
| — inside repeater: name    | Text       | `roomName`            |       |
| — inside repeater: price   | Text       | `roomPrice`           | Per-night rate |
| — inside repeater: occ     | Text       | `roomOccupancy`       | "Sleeps X–Y" |
| — inside repeater: badge   | Text       | `selectedBadge`       | Shows "✓ Added" or empty |
| — inside repeater: select  | Button     | `btnSelectRoom`       | "Add to booking" / "Remove" |
| Selected panel        | Container/Text  | `selectionPanel`      | Shows selected rooms summary |
| Selected rooms list   | Text            | `selectedRoomsContainer` | List of selected room names |
| Continue button       | Button          | `btnContinueToSummary`| Proceeds to Booking Summary |

**Data flow:** Search → results show in repeater → guest clicks "Add to booking" on one or more rooms → selection stored in browser session → "Continue" goes to Booking Summary.

---

## PAGE 2 — Booking Summary (paste: `velo/page-booking-summary.js`)

Shows all selected rooms with their guest counts and the combined price.

| Element                | Type           | ID                  | Notes |
|------------------------|----------------|---------------------|-------|
| Page status            | Text           | `summaryStatusText` | e.g. "2 rooms · 5 nights · Total $11,632.50" |
| Check-in display       | Text           | `checkInDisplay`    | Date from session |
| Check-out display      | Text           | `checkOutDisplay`   | Date from session |
| Rooms list repeater    | Repeater       | `summaryRoomsRepeater` | One row per selected room |
| — inside: room name    | Text           | `roomNameText`      |       |
| — inside: price        | Text           | `roomPriceText`     | Per-night rate |
| — inside: guests dd    | Dropdown       | `guestsDropdown`    | baseOcc..maxOcc for that room |
| — inside: room total   | Text           | `roomTotalText`     | Price for this room |
| — inside: remove btn   | Button         | `removeBtn`         | Removes room from selection |
| Accommodation names    | Text           | `accommodationNamesText` | "Adventure Suite + Two-Bedroom" |
| Total package price    | Text           | `pkgTotal`          | Combined net before VAT/fees |
| Line items repeater    | Repeater       | `lineItemsRepeater` | One row per line item (accom + adv for ALL rooms) |
| — inside: label        | Text           | `lineLabel`         | e.g. "Accommodation (Adventure Suite)" |
| — inside: net          | Text           | `lineNet`           |       |
| — inside: vatRate      | Text           | `lineVatRate`       | e.g. "10%" |
| — inside: vat          | Text           | `lineVat`           |       |
| — inside: gross        | Text           | `lineGross`         |       |
| Subtotal net           | Text           | `subtotalNetText`   |       |
| Accommodation VAT      | Text           | `vatAccommodationText`| e.g. "VAT 10% (accommodation): $495.00" |
| Adventure VAT          | Text           | `vatAdventureText`  | e.g. "VAT 15% (adventure): $742.50" |
| Total VAT              | Text           | `totalVatText`      |       |
| Property fee           | Text           | `propertyFeeText`   |       |
| Grand total            | Text           | `grandTotalText`    |       |
| Continue button        | Button         | `btnContinue`       | Navigates to Guest Confirm |

**Behavior:**
- On load: reads selected rooms from sessionStorage, fetches quotes for each room.
- Guest can change guest count per room via dropdown — recomputes that room's quote and combined totals.
- Guest can remove a room — updates totals and session.
- Continue passes dates to Guest Confirm; rooms stay in session.

---

## PAGE 3 — Guest Details & Confirm (paste: `velo/page-guest-confirm.js`)

Reads selected rooms from sessionStorage + dates from URL.

| Element            | Type   | ID                   | Notes |
|--------------------|--------|----------------------|-------|
| Review: dates      | Text   | `reviewDates`        | "Jul 1 – Jul 6 (5 nights)" |
| Review: rooms      | Text   | `reviewRooms`        | List with guest counts and per-room totals |
| Review: grand total| Text   | `reviewGrandTotal`   | Combined grand total |
| Guest name         | Input  | `inputGuestName`     | Required |
| Guest email        | Input  | `inputGuestEmail`    | Required |
| Guest phone        | Input  | `inputGuestPhone`    |       |
| Confirm button     | Button | `btnConfirmBooking`  |       |
| Result message     | Text   | `confirmStatus`      | Success / error |
| Deposit due        | Text   | `depositDueText`     | 50% of grand total |
| Balance due        | Text   | `balanceDueText`     | Remaining 50% |

**Behavior:**
- On load: shows review summary (all rooms, dates, guests, grand total, deposit).
- Confirm button: creates one booking PER room → generates combined invoice → stores PDF → logs report records.
- On success: clears session, shows "Booking confirmed! Invoice #WBE-INV-XXXX emailed."

---

## PAGE 4 — Admin Console (paste: `velo/page-admin-console.js`)

(Admin console unchanged — see full spec below for completeness)

### Reports section
| Element              | Type        | ID                 |
|----------------------|-------------|--------------------|
| From date            | Date Picker | `datePickerFrom`   |
| To date              | Date Picker | `datePickerTo`     |
| Filter-by dropdown   | Dropdown    | `dateFieldSelect`  |
| Run report button    | Button      | `btnRunReport`     |
| Bookings table/list  | Repeater    | `bookingsRepeater` |
| — Edit button (row)  | Button      | `btnEdit`          |
| — Cancel button (row)| Button      | `btnCancel`        |
| — Reinstate btn (row)| Button      | `btnReinstate`     |
| Status text          | Text        | `statusText`       |

### Report totals
| Element              | Type        | ID                 |
|----------------------|-------------|--------------------|
| Count                | Text        | `sumCount`         |
| Revenue count        | Text        | `sumRevenueCount`  |
| Accommodation net    | Text        | `sumAccommodation` |
| Package net          | Text        | `sumPackages`      |
| VAT 10%              | Text        | `sumVat10`         |
| VAT 15%              | Text        | `sumVat15`         |
| Total VAT            | Text        | `sumVatTotal`      |
| Grand total          | Text        | `sumGrandTotal`    |

### Payment recording
| Element              | Type        | ID                 |
|----------------------|-------------|--------------------|
| Amount               | Input       | `inputAmount`      |
| Date                 | Date Picker | `datePickerPaid`   |
| Type                 | Dropdown    | `dropdownPayType`  |
| Save payment button  | Button      | `btnSavePayment`   |
| Balance text         | Text        | `balanceText`      |

### Settings
| Element                   | Type   | ID                    |
|---------------------------|--------|-----------------------|
| Accommodation share %     | Input  | `inputAccomShare`     |
| Property fee %            | Input  | `inputPropertyFee`    |
| Save settings button      | Button | `btnSaveSplit`        |

### Tax rates
| Element                   | Type   | ID                    |
|---------------------------|--------|-----------------------|
| Accommodation VAT %       | Input  | `inpTaxRateAccom`     |
| Standard VAT %            | Input  | `inpTaxRateStandard`  |
| Save tax rates button     | Button | `btnSaveTaxRates`     |
| Current rates display     | Text   | `currentTaxRatesText` |

### Room blocking
| Element                   | Type        | ID                    |
|---------------------------|-------------|-----------------------|
| Room dropdown             | Dropdown    | `ddBlockRoom`         |
| Start date                | Date Picker | `dateBlockFrom`       |
| End date                  | Date Picker | `dateBlockTo`         |
| Quantity                  | Input       | `numBlockQuantity`    |
| Reason                    | Input       | `txtBlockReason`      |
| Block room button         | Button      | `btnBlockRoom`        |
| Close hotel button        | Button      | `btnBlockAllRooms`    |
| Blocks list               | Repeater    | `blocksListRepeater`  |
| — Unblock button          | Button      | `btnUnblock`          |
| Status text               | Text        | `statusTextBlocking`  |

### Messages
| Element                   | Type        | ID                    |
|---------------------------|-------------|-----------------------|
| Title                     | Input       | `txtMsgTitle`         |
| Body                      | Input       | `txtMsgBody`          |
| Start date                | Date Picker | `dateMsgStart`        |
| End date                  | Date Picker | `dateMsgEnd`          |
| Page dropdown             | Dropdown    | `ddMsgPage`           |
| Priority                  | Input       | `numMsgPriority`      |
| Active switch             | Switch      | `swMsgActive`         |
| Save message button       | Button      | `btnMsgCreate`        |
| Messages list             | Repeater    | `messagesListRepeater`|
| — Edit button             | Button      | `btnEditMessage`      |
| — Delete button           | Button      | `btnDeleteMessage`    |
| Status text               | Text        | `statusTextMessages`  |

### Booking CRUD (admin)
| Element                   | Type        | ID                    |
|---------------------------|-------------|-----------------------|
| Room dropdown             | Dropdown    | `ddBookingRoom`       |
| Check-in                  | Date Picker | `dateBookingCheckIn`  |
| Check-out                 | Date Picker | `dateBookingCheckOut` |
| Guests                    | Input       | `numBookingGuests`    |
| Create booking button     | Button      | `btnBookingCreate`    |
| Bookings list             | Repeater    | `bookingsListRepeater`|
| Status text               | Text        | `statusTextBookings`  |

---

## The two halves of the GUI (so the split is clear)
- **Visual layout** (drag elements, style, position): built in the Wix Editor by
  you or a designer, using this mockup as the target.
- **Behavior** (what each element DOES): already written as Velo code in
  `velo/backend/*.web.js` and the page snippets. It binds to the IDs above.

## Build order suggestion
1. Create the Wix data collections (SETUP_GUIDE.md) + add room photos (ROOM_PHOTOS.md).
2. Add the backend `.web.js` files under Backend in the Editor.
3. Build Page 1, set the IDs, paste `velo/page-booking-search.js`, preview, test search + multi-select.
4. Build Page 2, set the IDs, paste `velo/page-booking-summary.js`, test guest count changes + remove.
5. Build Page 3, set the IDs, paste `velo/page-guest-confirm.js`, test multi-room booking creation.
6. Build Page 4, set the IDs, paste `velo/page-admin-console.js`, test reports.
7. Deploy the external invoice service (INVOICING_EMAIL.md) and wire the confirm step.

## What I can/can't do (honest)
- I CANNOT place or style elements on your live Wix page (that's manual Editor work).
- I CAN: provide this spec, write all the behavior code, adjust the mockup, and
  give you/your designer exact step-by-step Editor instructions for any page.
