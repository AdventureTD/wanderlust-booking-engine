"""
Wanderlust Booking Engine — guest availability search.

Guest enters check-in + check-out. For each room type we report:
  - status "full"    : a unit is free for the ENTIRE requested window
  - status "partial" : not free for the whole window, but there's a stretch of
                       MIN_NIGHTS+ consecutive available nights inside the window
                       (we return the single LONGEST such stretch)
  - status "none"    : no 4+ night stretch available

Rules:
  - MIN_NIGHTS = 4 (four-night minimum). Requests under 4 nights are rejected.
  - A night is "available" for a room type if the number of confirmed/hold
    bookings overlapping that night is below the room's unit count.

UPDATED 2026-06-03: rooms with no rate defined in the RoomPricing collection
for the requested number of nights are EXCLUDED from results (treated as
unavailable for that stay length). For partial offers, the rate must also
exist for the partial night count; otherwise the room is excluded.

Uses the same Calendar/inventory model as availability.py.
"""

from datetime import date, timedelta
from typing import List, Optional

from .rooms import all_rooms, get_room
from .room_pricing import get_base_rate, has_rate

MIN_NIGHTS = 4


def _nights_list(check_in: date, check_out: date) -> List[date]:
    n = (check_out - check_in).days
    return [check_in + timedelta(days=i) for i in range(n)]


def _longest_available_run(calendar, room_code: str, units: int,
                           nights: List[date]):
    """
    Find the longest run of consecutive available nights within `nights`.
    Returns (start_index, length) of the best run, or (None, 0) if none.
    A night is available if units_booked_on(night) < units.
    """
    best_start, best_len = None, 0
    cur_start, cur_len = None, 0
    for i, night in enumerate(nights):
        booked = calendar.units_booked_on(room_code, night)
        if booked < units:
            if cur_start is None:
                cur_start = i
                cur_len = 1
            else:
                cur_len += 1
            if cur_len > best_len:
                best_len = cur_len
                best_start = cur_start
        else:
            cur_start, cur_len = None, 0
    return best_start, best_len


def search_availability(calendar, check_in: date, check_out: date,
                        room_codes: Optional[List[str]] = None) -> dict:
    """
    Returns a dict:
      {
        "ok": bool,
        "error": str | None,           # set if request is invalid (e.g. <4 nights)
        "requested_nights": int,
        "results": [
          {
            "room_code", "room_name", "units",
            "status": "full" | "partial" | "none",
            "available_check_in": iso | None,
            "available_check_out": iso | None,
            "available_nights": int,
            "base_rate": float | None,  # per-night rate for the available nights
          }, ...
        ]
      }

    Rooms with no rate in RoomPricing for the requested (or partial) night count
    are EXCLUDED from results entirely.
    """
    if check_out <= check_in:
        return {"ok": False, "error": "Check-out must be after check-in.",
                "requested_nights": 0, "results": []}

    requested = (check_out - check_in).days
    if requested < MIN_NIGHTS:
        return {"ok": False,
                "error": f"We have a {MIN_NIGHTS}-night minimum stay. "
                         f"Please choose dates at least {MIN_NIGHTS} nights apart.",
                "requested_nights": requested, "results": []}

    nights = _nights_list(check_in, check_out)
    codes = room_codes or [r.code for r in all_rooms()]
    results = []

    for code in codes:
        room = get_room(code)

        # Full-stay availability?
        if calendar.is_available(code, check_in, check_out):
            # Check if a rate exists for this room + requested nights
            rate = get_base_rate(code, requested)
            if rate is None:
                # No rate = not available for this stay length — skip entirely
                continue
            results.append({
                "room_code": code, "room_name": room.name, "units": room.units,
                "status": "full",
                "available_check_in": check_in.isoformat(),
                "available_check_out": check_out.isoformat(),
                "available_nights": requested,
                "base_rate": rate,
            })
            continue

        # Otherwise find the longest available consecutive run within the window.
        start_idx, run_len = _longest_available_run(
            calendar, code, room.units, nights)

        if start_idx is not None and run_len >= MIN_NIGHTS:
            # Check if a rate exists for the partial night count
            rate = get_base_rate(code, run_len)
            if rate is None:
                # No rate for this partial length — skip
                continue
            avail_ci = nights[start_idx]
            avail_co = nights[start_idx + run_len - 1] + timedelta(days=1)
            results.append({
                "room_code": code, "room_name": room.name, "units": room.units,
                "status": "partial",
                "available_check_in": avail_ci.isoformat(),
                "available_check_out": avail_co.isoformat(),
                "available_nights": run_len,
                "base_rate": rate,
            })
        # If status would be "none" OR no rate for the partial, room is simply
        # not included in results.

    return {"ok": True, "error": None,
            "requested_nights": requested, "results": results}
