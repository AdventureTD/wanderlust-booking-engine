"""
Wanderlust Booking Engine — room blocking (inventory holds).

Admin can block one or more units of a room type, or block the entire hotel
(all rooms), for a given date range. Blocked bookings:
- Have status = "blocked"
- Count as ACTIVE for inventory (they consume units, preventing guest bookings)
- Are STICKY (never auto-advanced by the daily status job)
- Are EXCLUDED from revenue reports
- ARE checked against existing reservations — a block NEVER overrides an existing guest booking

Usage:
  from booking_engine.blocks import Blocker
  blocker = Blocker(calendar)
  blocker.block_room(room_code, check_in, check_out, quantity=1, reason="Maintenance")
  blocker.block_all_rooms(check_in, check_out, reason="Off-season closure")

Conflicts: if an existing guest booking overlaps the requested block dates,
quantity is REDUCED to what fits, and the operation returns a warning list.
If the requested quantity is 0 after reduction, the block is REFUSED.
"""

from datetime import date
from typing import List, Dict

from .availability import Calendar, Booking
from .rooms import get_room
from .status import BLOCKED


class Blocker:
    def __init__(self, calendar: Calendar):
        self.cal = calendar

    def _compute_quantity(self, room_code: str, check_in: date, check_out: date,
                          requested_quantity: int) -> tuple[int, List[str]]:
        """
        Determine the actual quantity that will fit for the whole date range,
        given existing bookings. Returns (actual_qty, warnings).

        Strategy: for each night in the block range, find the max units that
        could be added without exceeding inventory. The actual block quantity
        is the MINIMUM of those across all nights (the binding constraint).
        """
        room = get_room(room_code)
        warnings: List[str] = []
        min_free = room.units  # worst-case free units across the range

        probe = Booking("probe", room_code, check_in, check_out)
        for night in probe.occupied_nights():
            booked = self.cal.units_booked_on(room_code, night)
            free = room.units - booked
            min_free = min(min_free, free)

        actual = min(requested_quantity, min_free)
        if actual < requested_quantity:
            warnings.append(
                f"{room.name}: requested {requested_quantity} unit(s) blocked, "
                f"but only {actual} available for the full range "
                f"({check_in} to {check_out}). Reduced to {actual}."
            )
        return actual, warnings

    def block_room(self, room_code: str, check_in: date, check_out: date,
                   quantity: int = 1, reason: str = "") -> tuple[Booking, List[str]]:
        """
        Block `quantity` units of `room_code` for the date range.
        Returns (booking, warnings).
        Raises ValueError if zero units can be blocked.
        """
        if check_out <= check_in:
            raise ValueError("check_out must be after check_in")
        if quantity < 1:
            raise ValueError("quantity must be >= 1")

        actual, warnings = self._compute_quantity(room_code, check_in, check_out, quantity)
        if actual < 1:
            raise ValueError(
                f"Cannot block {room_code}: all units already booked for the "
                f"requested period ({check_in} to {check_out})."
            )

        b = Booking(
            self.cal._next_id(),
            room_code, check_in, check_out,
            guests=1,
            status="blocked",
            quantity=actual,
            note=reason,
        )
        self.cal._bookings[b.booking_id] = b
        return b, warnings

    def block_all_rooms(self, check_in: date, check_out: date,
                        reason: str = "") -> List[tuple[Booking, List[str]]]:
        """
        Block ALL units of ALL room types for the date range (hotel closure).
        For each room, the block quantity is the FULL unit count of that room,
        but reduced if existing bookings overlap (never overriding guests).
        Returns a list of (booking, warnings) per room type.
        """
        from .rooms import ROOM_CATALOG
        results: List[tuple[Booking, List[str]]] = []
        for room_code in ROOM_CATALOG:
            room = get_room(room_code)
            try:
                b, warnings = self.block_room(room_code, check_in, check_out,
                                              quantity=room.units, reason=reason)
                results.append((b, warnings))
            except ValueError as e:
                # If a room type was fully booked, skip it but record a no-op.
                results.append((None, [str(e)]))
        return results

    def unblock(self, booking_id: str) -> Booking:
        """Remove a block by deleting the booking row."""
        b = self.cal.get(booking_id)
        if not b.is_blocked():
            raise ValueError(f"Booking {booking_id} is not a block (status={b.status})")
        del self.cal._bookings[booking_id]
        return b

    def list_blocks(self, room_code: str = None) -> List[Booking]:
        """Return all blocked bookings, optionally filtered by room."""
        blocks = [b for b in self.cal.all_bookings() if b.is_blocked()]
        if room_code:
            blocks = [b for b in blocks if b.room_code == room_code]
        return blocks
