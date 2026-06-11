# Wanderlust Booking Engine — Guest Availability Search

The first step of the guest booking flow: the guest enters check-in + check-out,
the system checks availability, and shows what's bookable.

## Rules
- **Both dates required.** Check-out must be after check-in.
- **Four-night minimum.** Requests under 4 nights are rejected up front with a
  clear "4-night minimum stay" message — nothing under 4 nights is ever offered.
- For each room type, the result is one of:
  - **full** — a unit is free for the ENTIRE requested window. Show it.
  - **partial** — not free for the whole window, but there's a stretch of 4+
    consecutive available nights inside the window. We show the SINGLE LONGEST
    such stretch (its own check-in/check-out + night count).
  - **none** — no 4+ night stretch available; not shown as bookable.

Multi-unit aware: Adventure Suite has 3 units, so a night is "available" as long
as fewer than 3 of them are booked. The Penthouse and Two-Bedroom have 1 unit each.

## Backend
`velo/backend/search.web.js` -> `searchAvailability(checkIn, checkOut)`
Returns:
```
{
  ok: true|false,
  error: string|null,          // e.g. the 4-night-minimum message
  requestedNights: number,
  results: [
    { roomCode, roomName, units, status,           // 'full'|'partial'|'none'
      availableCheckIn, availableCheckOut, availableNights }
  ]
}
```
Mirrors the tested Python engine (`booking_engine/search.py`); the algorithm was
verified to match Python on full / partial / longest-run / none / multi-unit cases.

## Guest booking page wiring (Velo page code)
```js
import { searchAvailability } from 'backend/search.web';

$w('#btnSearch').onClick(async () => {
  const ci = $w('#datePickerCheckIn').value;
  const co = $w('#datePickerCheckOut').value;
  if (!ci || !co) { $w('#searchStatus').text = 'Please choose both dates.'; return; }

  const r = await searchAvailability(ci.toISOString(), co.toISOString());
  if (!r.ok) { $w('#searchStatus').text = r.error; $w('#roomsRepeater').data = []; return; }

  // Only show bookable rooms (full or partial). Hide 'none'.
  const bookable = r.results.filter(x => x.status !== 'none');
  $w('#roomsRepeater').data = bookable.map(x => ({
    _id: x.roomCode,
    roomName: x.roomName,
    offer: x.status === 'full'
      ? `Available for your full ${r.requestedNights} nights`
      : `Available for ${x.availableNights} nights `
        + `(${fmt(x.availableCheckIn)} – ${fmt(x.availableCheckOut)})`,
    status: x.status,
    availableCheckIn: x.availableCheckIn,
    availableCheckOut: x.availableCheckOut,
    availableNights: x.availableNights,
  }));
  $w('#searchStatus').text = bookable.length
    ? `${bookable.length} option(s) found.`
    : 'No rooms available for these dates. Try different dates.';
});

function fmt(iso) { return iso ? new Date(iso).toISOString().slice(0,10) : ''; }
```
Inside the repeater, bind `roomName` + `offer`. When the guest selects a room,
carry `availableCheckIn`/`availableCheckOut` forward to the booking step (these
may be the shorter partial dates, not the originally requested ones).

## Verified vs. needs live testing
- Verified by me (Python 7 tests + Node algorithm check): full, partial (longest
  4+ run), none, 4-night-minimum rejection, multi-unit suite behavior.
- Needs live testing in Wix: the per-night Bookings-collection availability
  queries (Wix Data only runs inside Wix).
