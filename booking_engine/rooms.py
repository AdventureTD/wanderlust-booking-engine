"""
Wanderlust Booking Engine — Room catalog & inventory.

Source of truth for room types, how many physical units exist of each,
descriptions, and photos. Photos are stored as a list of public URLs (the
same catbox/Drive pipeline used by the social agent can populate these).

Inventory (confirmed by owner 2026-06-01):
  - Adventure Suite        x3
  - Penthouse Apartment    x1
  - Two-Bedroom Apartment  x1

ARCHITECTURAL CHANGE (2026-06-03): the per-night base rate (Adventure Package
price) has been MOVED OUT of this collection into a separate RoomPricing
collection keyed by (room_code, nights). The rate now varies by length of
stay. See room_pricing.py for the lookup, and PRICING_MODEL.md for the full
explanation. The `base_rate` and `package_price_per_night` fields are REMOVED
from RoomType.
"""

from dataclasses import dataclass, field
from typing import List


@dataclass(frozen=True)
class RoomType:
    code: str                 # stable machine id, e.g. "adventure_suite"
    name: str                 # display name
    units: int                # how many physical units exist (inventory cap)
    base_occupancy: int       # guests included in base rate
    max_occupancy: int        # max guests this room sleeps
    description: str
    extra_guest_fee: float = 0.0   # per night, per guest beyond base_occupancy (accommodation, 10% VAT)
    photos: List[str] = field(default_factory=list)


# Rates CONFIRMED by owner 2026-06-01 (VAT NOT included — added on top at 10%).
# NOTE (2026-06-03): per-night base rates have been MOVED to room_pricing.py /
# the RoomPricing Wix collection. They vary by number of nights booked.
ROOM_CATALOG = {
    "adventure_suite": RoomType(
        code="adventure_suite",
        name="Adventure Suite",
        units=3,
        base_occupancy=2,
        max_occupancy=2,
        extra_guest_fee=0.0,   # no extra-guest option
        description=(
            "Our signature oceanfront Adventure Suite — your boutique base camp "
            "between days of hiking, waterfalls, and canyoning. Comfortable, "
            "well-appointed, with the best views possible. By day, knee-deep "
            "adventure; by night, boutique relaxation."
        ),
        photos=[],       # TODO: add public photo URLs (from Drive/Hotel folder)
    ),
    "penthouse_apartment": RoomType(
        code="penthouse_apartment",
        name="Penthouse Apartment",
        units=1,
        base_occupancy=2,
        max_occupancy=2,
        extra_guest_fee=0.0,   # no extra-guest option
        description=(
            "The Penthouse Apartment — our top-floor retreat with a large private "
            "deck, sweeping ocean views, and a hammock made for sunset. A short "
            "walk down to the water. Spacious, with everything you need after a "
            "day on the trails."
        ),
        photos=[],
    ),
    "two_bedroom_apartment": RoomType(
        code="two_bedroom_apartment",
        name="Two-Bedroom Apartment",
        units=1,
        base_occupancy=3,
        max_occupancy=4,       # 3 base + 1 extra
        extra_guest_fee=396.0, # per night for the 4th guest
        description=(
            "The Two-Bedroom Apartment — ideal for friends or families travelling "
            "together. Two private bedrooms, room to spread out, and the same "
            "easy access to beaches, rivers, and the village of Calibishie. "
            "Sleeps three, with space for a fourth guest."
        ),
        photos=[],
    ),
}


def get_room(code: str) -> RoomType:
    if code not in ROOM_CATALOG:
        raise KeyError(
            f"Unknown room type '{code}'. Valid: {list(ROOM_CATALOG.keys())}"
        )
    return ROOM_CATALOG[code]


def all_rooms() -> List[RoomType]:
    return list(ROOM_CATALOG.values())


def register_room(code: str, name: str, units: int, base_occupancy: int,
                  max_occupancy: int, extra_guest_fee: float = 0.0,
                  description: str = "", photos: List[str] = None) -> None:
    """Add or overwrite a room in the catalog (used by tests)."""
    ROOM_CATALOG[code] = RoomType(
        code=code, name=name, units=units,
        base_occupancy=base_occupancy, max_occupancy=max_occupancy,
        description=description, extra_guest_fee=extra_guest_fee,
        photos=photos or [],
    )


def unregister_room(code: str) -> None:
    """Remove a room from the catalog (used in test teardown)."""
    if code in ROOM_CATALOG:
        del ROOM_CATALOG[code]
