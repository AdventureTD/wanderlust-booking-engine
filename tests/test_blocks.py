"""
Tests for booking_engine/blocks.py — room blocking and hotel closure.
Run: python3 tests/test_blocks.py
"""

from datetime import date, timedelta
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from booking_engine.availability import Calendar
from booking_engine.blocks import Blocker
from booking_engine.status import BLOCKED


# === Helpers ================================================================

ROOM_SUITE = "adventure_suite"
ROOM_PENTHOUSE = "penthouse_apartment"
ROOM_TWO_BED = "two_bedroom_apartment"


def make_calendar_with_bookings():
    """Calendar: 2 suites booked Jan 10-15, everything else free."""
    cal = Calendar()
    # Suite 1: Jan 10-15
    cal.add_booking(ROOM_SUITE, date(2026, 1, 10), date(2026, 1, 15), guests=2)
    # Suite 2: Jan 10-15
    cal.add_booking(ROOM_SUITE, date(2026, 1, 10), date(2026, 1, 15), guests=2)
    # Suite 3: free
    # Penthouse: free
    # Two-Bedroom: free
    return cal


# === Block a single room ====================================================

def test_block_one_unit_ok():
    cal = make_calendar_with_bookings()
    blocker = Blocker(cal)
    b, warnings = blocker.block_room(ROOM_SUITE, date(2026, 1, 10), date(2026, 1, 15), quantity=1, reason="Maintenance")
    assert b is not None
    assert b.status == "blocked"
    assert b.quantity == 1
    assert b.note == "Maintenance"
    assert not warnings  # no warnings needed
    # 2 suites occupied + 1 blocked = 3, so no unit left for a guest booking
    assert not cal.is_available(ROOM_SUITE, date(2026, 1, 10), date(2026, 1, 15))
    print("PASS: test_block_one_unit_ok")


def test_block_reduced_due_to_existing_bookings():
    """Request to block 2 suites when only 1 is free — should reduce to 1 with a warning."""
    cal = make_calendar_with_bookings()
    blocker = Blocker(cal)
    b, warnings = blocker.block_room(ROOM_SUITE, date(2026, 1, 10), date(2026, 1, 15), quantity=2)
    assert b.quantity == 1
    assert len(warnings) == 1
    assert "requested 2" in warnings[0]
    assert "only 1 available" in warnings[0]
    print("PASS: test_block_reduced_due_to_existing_bookings")


def test_block_refused_when_fully_booked():
    """All 3 suites occupied; no block possible."""
    cal = make_calendar_with_bookings()
    blocker = Blocker(cal)
    # Block the remaining 1 unit first
    blocker.block_room(ROOM_SUITE, date(2026, 1, 10), date(2026, 1, 15), quantity=1)
    # Now all 3 are taken
    try:
        blocker.block_room(ROOM_SUITE, date(2026, 1, 10), date(2026, 1, 15), quantity=1)
        assert False, "Should have raised ValueError"
    except ValueError as e:
        assert "all units already booked" in str(e)
    print("PASS: test_block_refused_when_fully_booked")


def test_block_never_overrides_existing_booking():
    """Even if we ask to block 10 units, it won't kick out existing guests."""
    cal = make_calendar_with_bookings()
    blocker = Blocker(cal)
    b, warnings = blocker.block_room(ROOM_SUITE, date(2026, 1, 10), date(2026, 1, 15), quantity=10)
    assert b.quantity == 1  # only 1 free
    # The 2 original bookings still exist
    assert len([x for x in cal.all_bookings() if x.room_code == ROOM_SUITE and x.status == "confirmed"]) == 2
    print("PASS: test_block_never_overrides_existing_booking")


def test_block_prevents_guest_booking():
    """After blocking, a guest cannot book that room."""
    cal = Calendar()  # empty
    blocker = Blocker(cal)
    blocker.block_room(ROOM_PENTHOUSE, date(2026, 2, 1), date(2026, 2, 5), quantity=1)
    assert not cal.is_available(ROOM_PENTHOUSE, date(2026, 2, 1), date(2026, 2, 5))
    print("PASS: test_block_prevents_guest_booking")


def test_block_counts_as_active_inventory():
    """A blocked booking is in _active() and counts in units_booked_on."""
    cal = Calendar()
    blocker = Blocker(cal)
    blocker.block_room(ROOM_SUITE, date(2026, 3, 1), date(2026, 3, 5), quantity=2)
    # Suite has 3 units; 2 blocked = 1 free. Guest can book 1.
    assert cal.is_available(ROOM_SUITE, date(2026, 3, 1), date(2026, 3, 5), requested_units=1)
    assert not cal.is_available(ROOM_SUITE, date(2026, 3, 1), date(2026, 3, 5), requested_units=2)
    print("PASS: test_block_counts_as_active_inventory")


def test_block_with_quantity_field():
    """A block can consume multiple units (e.g. block 2 suites)."""
    cal = Calendar()
    blocker = Blocker(cal)
    b, _ = blocker.block_room(ROOM_SUITE, date(2026, 4, 1), date(2026, 4, 5), quantity=2, reason="Wedding party")
    assert b.quantity == 2
    assert b.note == "Wedding party"
    # 3 total - 2 blocked = 1 free
    assert cal.units_available(ROOM_SUITE, date(2026, 4, 1), date(2026, 4, 5)) == 1
    print("PASS: test_block_with_quantity_field")


# === Unblock ================================================================

def test_unblock_restores_availability():
    cal = Calendar()
    blocker = Blocker(cal)
    b, _ = blocker.block_room(ROOM_SUITE, date(2026, 5, 1), date(2026, 5, 5), quantity=3)
    assert not cal.is_available(ROOM_SUITE, date(2026, 5, 1), date(2026, 5, 5))
    removed = blocker.unblock(b.booking_id)
    assert removed.booking_id == b.booking_id
    assert cal.is_available(ROOM_SUITE, date(2026, 5, 1), date(2026, 5, 5))
    print("PASS: test_unblock_restores_availability")


def test_unblock_rejects_non_blocked():
    cal = Calendar()
    guest = cal.add_booking(ROOM_SUITE, date(2026, 5, 1), date(2026, 5, 5), guests=2)
    try:
        Blocker(cal).unblock(guest.booking_id)
        assert False, "Should have raised ValueError"
    except ValueError as e:
        assert "not a block" in str(e)
    print("PASS: test_unblock_rejects_non_blocked")


# === Hotel closure (block all rooms) ========================================

def test_hotel_closure_blocks_all_rooms():
    """Close the hotel for off-season: all room types get a block for their full unit count."""
    cal = Calendar()
    blocker = Blocker(cal)
    results = blocker.block_all_rooms(date(2026, 6, 1), date(2026, 6, 15), reason="Off-season closure")
    assert len(results) == 3  # 3 room types

    # Every room type should have one blocked booking
    for b, warnings in results:
        assert b is not None
        assert b.status == "blocked"
        assert b.note == "Off-season closure"

    # All rooms should be unavailable
    assert not cal.is_available(ROOM_SUITE, date(2026, 6, 10), date(2026, 6, 12))
    assert not cal.is_available(ROOM_PENTHOUSE, date(2026, 6, 10), date(2026, 6, 12))
    assert not cal.is_available(ROOM_TWO_BED, date(2026, 6, 10), date(2026, 6, 12))
    print("PASS: test_hotel_closure_blocks_all_rooms")


def test_hotel_closure_skips_overbooked_room():
    """Penthouse already has a guest; closure blocks only Suites and Two-Bedroom."""
    cal = Calendar()
    cal.add_booking(ROOM_PENTHOUSE, date(2026, 7, 1), date(2026, 7, 10), guests=2)
    blocker = Blocker(cal)
    results = blocker.block_all_rooms(date(2026, 7, 1), date(2026, 7, 10))

    block_ids = {b.room_code for b, _ in results if b is not None}
    assert ROOM_PENTHOUSE not in block_ids  # skipped, fully booked
    assert ROOM_SUITE in block_ids
    assert ROOM_TWO_BED in block_ids
    print("PASS: test_hotel_closure_skips_overbooked_room")


def test_block_does_not_show_in_revenue():
    """Blocked bookings are excluded from revenue counts."""
    from booking_engine.status import REVENUE_STATUSES
    assert BLOCKED not in REVENUE_STATUSES
    print("PASS: test_block_does_not_show_in_revenue")


def test_block_is_sticky():
    """Blocked status is in STICKY_STATUSES and is not advanced by date logic."""
    from booking_engine.status import STICKY_STATUSES, effective_status
    assert BLOCKED in STICKY_STATUSES
    # A block from 2 years ago should still show as Blocked
    result = effective_status(date(2020, 1, 1), date(2020, 1, 5), stored_status=BLOCKED)
    assert result == BLOCKED
    print("PASS: test_block_is_sticky")


# === List blocks ============================================================

def test_list_blocks():
    cal = Calendar()
    blocker = Blocker(cal)
    blocker.block_room(ROOM_SUITE, date(2026, 8, 1), date(2026, 8, 5), quantity=1)
    blocker.block_room(ROOM_PENTHOUSE, date(2026, 8, 1), date(2026, 8, 5), quantity=1)

    all_blocks = blocker.list_blocks()
    assert len(all_blocks) == 2

    suite_only = blocker.list_blocks(ROOM_SUITE)
    assert len(suite_only) == 1
    assert suite_only[0].room_code == ROOM_SUITE
    print("PASS: test_list_blocks")


if __name__ == "__main__":
    test_block_one_unit_ok()
    test_block_reduced_due_to_existing_bookings()
    test_block_refused_when_fully_booked()
    test_block_never_overrides_existing_booking()
    test_block_prevents_guest_booking()
    test_block_counts_as_active_inventory()
    test_block_with_quantity_field()
    test_unblock_restores_availability()
    test_unblock_rejects_non_blocked()
    test_hotel_closure_blocks_all_rooms()
    test_hotel_closure_skips_overbooked_room()
    test_block_does_not_show_in_revenue()
    test_block_is_sticky()
    test_list_blocks()
    print("\n=== All 14 block tests passed ===")
