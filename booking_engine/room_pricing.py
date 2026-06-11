"""
Wanderlust Booking Engine — Room Pricing by length of stay.

New model (2026-06-03): the per-night Adventure Package rate now varies by the
number of nights booked. Instead of a single packagePricePerNight on each Room,
there is a RoomPricing collection keyed by (room_code, nights) → base_rate.

LOOKUP RULE: exact match only. If there is no row for a given room + night
count, the room is treated as NOT AVAILABLE for that length of stay. This is
intentional — the owner controls which stay lengths are bookable by entering
(or not entering) rows in the collection.

In Python (reference/testing): the rates live in ROOM_PRICING_CATALOG below.
In Wix (production): the rates live in the RoomPricing collection — editable
in the Content Manager, no code changes needed.
"""

from typing import Optional


# In-memory catalog for testing. In production (Velo), this data lives in the
# Wix RoomPricing collection and is queried via wixData.
#
# Key: (room_code, nights) → base_rate (Adventure Package per-night price).
#
# Seed with current confirmed rates (the existing prices now become the
# default for all currently-supported stay lengths). The owner will update
# these and add more rows as needed.
#
# NOTE: The owner said they will enter a row for EVERY night count they want
# to support. Stays with no matching row = room not shown to the guest.
ROOM_PRICING_CATALOG: dict[tuple[str, int], float] = {
    # Adventure Suite — seeded at $792/night for 4-10 nights
    ("adventure_suite", 4): 792.0,
    ("adventure_suite", 5): 792.0,
    ("adventure_suite", 6): 792.0,
    ("adventure_suite", 7): 792.0,
    ("adventure_suite", 8): 792.0,
    ("adventure_suite", 9): 792.0,
    ("adventure_suite", 10): 792.0,

    # Penthouse Apartment — seeded at $930/night for 4-10 nights
    ("penthouse_apartment", 4): 930.0,
    ("penthouse_apartment", 5): 930.0,
    ("penthouse_apartment", 6): 930.0,
    ("penthouse_apartment", 7): 930.0,
    ("penthouse_apartment", 8): 930.0,
    ("penthouse_apartment", 9): 930.0,
    ("penthouse_apartment", 10): 930.0,

    # Two-Bedroom Apartment — seeded at $1,188/night for 4-10 nights
    ("two_bedroom_apartment", 4): 1188.0,
    ("two_bedroom_apartment", 5): 1188.0,
    ("two_bedroom_apartment", 6): 1188.0,
    ("two_bedroom_apartment", 7): 1188.0,
    ("two_bedroom_apartment", 8): 1188.0,
    ("two_bedroom_apartment", 9): 1188.0,
    ("two_bedroom_apartment", 10): 1188.0,
}


def get_base_rate(room_code: str, nights: int) -> Optional[float]:
    """Look up the per-night base rate for a room + night count.

    Returns the rate (float) if found, or None if no row exists for this
    combination. None means: this room is NOT available for this stay length.
    """
    return ROOM_PRICING_CATALOG.get((room_code, nights))


def has_rate(room_code: str, nights: int) -> bool:
    """Quick check: is there a rate defined for this room + night count?"""
    return (room_code, nights) in ROOM_PRICING_CATALOG


def all_rates_for_room(room_code: str) -> dict[int, float]:
    """Return all defined {nights: base_rate} entries for a given room."""
    return {
        n: rate
        for (code, n), rate in ROOM_PRICING_CATALOG.items()
        if code == room_code
    }


def register_rate(room_code: str, nights: int, base_rate: float) -> None:
    """Add or overwrite a rate row in the catalog (used for testing)."""
    ROOM_PRICING_CATALOG[(room_code, nights)] = base_rate


def clear_test_rates(room_code: str) -> None:
    """Remove all rate entries for a room (used in test teardown)."""
    keys_to_remove = [k for k in ROOM_PRICING_CATALOG if k[0] == room_code]
    for k in keys_to_remove:
        del ROOM_PRICING_CATALOG[k]
