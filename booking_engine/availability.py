"""
Wanderlust Booking Engine — Availability & calendar.

Core rule: never overbook. For each room type we own a fixed number of
physical units (Adventure Suite x3, Penthouse x1, Two-Bedroom x1). On any
given night, the number of overlapping confirmed bookings for a room type
must never exceed that room type's unit count.

Date model:
  - check_in is the first night the guest occupies.
  - check_out is the morning the guest leaves (NOT a night occupied).
  - So a booking occupies nights [check_in, check_out).
  - Two bookings of the same room type conflict only if their night-ranges
    overlap. Same-day turnover (one guest checks out, another checks in the
    same date) is allowed.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Dict, List
import itertools

from .rooms import get_room


@dataclass
class Booking:
    booking_id: str
    room_code: str
    check_in: date
    check_out: date
    guests: int = 1
    status: str = "confirmed"   # "confirmed" | "cancelled" | "hold" | "blocked"
    quantity: int = 1           # how many units this booking consumes (used for blocks)
    note: str = ""              # e.g. blocked reason

    def __post_init__(self):
        if self.check_out <= self.check_in:
            raise ValueError(
                f"check_out ({self.check_out}) must be after check_in "
                f"({self.check_in})."
            )
        if self.quantity < 1:
            raise ValueError("quantity must be >= 1")

    def nights(self) -> int:
        return (self.check_out - self.check_in).days

    def occupied_nights(self) -> List[date]:
        return [
            self.check_in + timedelta(days=i) for i in range(self.nights())
        ]

    def is_blocked(self) -> bool:
        return self.status == "blocked"

    def is_active(self) -> bool:
        return self.status in ("confirmed", "hold", "blocked")

    def overlaps(self, other: "Booking") -> bool:
        # Half-open interval overlap: [a_in, a_out) intersects [b_in, b_out)
        return self.check_in < other.check_out and other.check_in < self.check_out


class Calendar:
    """Holds all bookings and answers availability questions."""

    def __init__(self):
        self._bookings: Dict[str, Booking] = {}
        self._counter = itertools.count(1)

    # ---- internal helpers -------------------------------------------------
    def _active(self) -> List[Booking]:
        # Active = confirmed, hold, or blocked — all consume inventory.
        return [b for b in self._bookings.values() if b.is_active()]

    def _next_id(self) -> str:
        return f"WBE-{next(self._counter):05d}"

    # ---- availability -----------------------------------------------------
    def units_booked_on(self, room_code: str, night: date) -> int:
        """How many units of a room type are occupied on a given night."""
        get_room(room_code)  # validates code
        return sum(
            b.quantity for b in self._active()
            if b.room_code == room_code and night in b.occupied_nights()
        )

    def is_available(self, room_code: str, check_in: date, check_out: date,
                     requested_units: int = 1) -> bool:
        """True if at least `requested_units` free for the whole stay."""
        room = get_room(room_code)
        probe = Booking("probe", room_code, check_in, check_out)
        for night in probe.occupied_nights():
            if self.units_booked_on(room_code, night) + requested_units > room.units:
                return False
        return True

    def units_available(self, room_code: str, check_in: date, check_out: date) -> int:
        """Minimum free units across the requested stay (the binding constraint)."""
        room = get_room(room_code)
        probe = Booking("probe", room_code, check_in, check_out)
        worst = room.units
        for night in probe.occupied_nights():
            free = room.units - self.units_booked_on(room_code, night)
            worst = min(worst, free)
        return max(0, worst)

    # ---- mutations --------------------------------------------------------
    def add_booking(self, room_code: str, check_in: date, check_out: date,
                    guests: int = None, status: str = "confirmed",
                    validate_occupancy: bool = True) -> Booking:
        """Create a booking, refusing it if it would overbook the room type.

        Occupancy rule: a real booking must have at least base_occupancy guests
        (no single-guest bookings) and at most max_occupancy. When `guests` is
        None it defaults to the room's base_occupancy. Pass
        validate_occupancy=False for pure availability tests that don't care.
        """
        room = get_room(room_code)
        if guests is None:
            guests = room.base_occupancy
        if validate_occupancy:
            if guests < room.base_occupancy:
                raise ValueError(
                    f"{room.name} requires at least {room.base_occupancy} guests "
                    f"(no single-guest bookings); requested {guests}."
                )
            if guests > room.max_occupancy:
                raise ValueError(
                    f"{room.name} sleeps {room.max_occupancy}; requested {guests}."
                )
        if not self.is_available(room_code, check_in, check_out):
            raise ValueError(
                f"No {room.name} available for {check_in} to {check_out} "
                f"(all {room.units} unit(s) booked on at least one night)."
            )
        b = Booking(self._next_id(), room_code, check_in, check_out, guests, status)
        self._bookings[b.booking_id] = b
        return b

    def cancel(self, booking_id: str) -> None:
        if booking_id not in self._bookings:
            raise KeyError(f"No booking {booking_id}")
        self._bookings[booking_id].status = "cancelled"

    def get(self, booking_id: str) -> Booking:
        return self._bookings[booking_id]

    def all_bookings(self) -> List[Booking]:
        return list(self._bookings.values())
