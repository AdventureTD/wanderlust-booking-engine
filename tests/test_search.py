"""Tests for guest availability search (full + partial 4+ night, 4-night min).

UPDATED 2026-06-03: search now also checks RoomPricing for rates. Rooms with
no rate for the requested (or partial) night count are excluded from results
instead of being shown with status 'none'.
"""

from datetime import date
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.availability import Calendar
from booking_engine.search import search_availability, MIN_NIGHTS


def d(y, m, day):
    return date(y, m, day)


def _result_for(res, code):
    return next((r for r in res["results"] if r["room_code"] == code), None)


def test_under_min_nights_rejected():
    cal = Calendar()
    res = search_availability(cal, d(2026, 7, 1), d(2026, 7, 4))  # 3 nights
    assert res["ok"] is False
    assert "4-night minimum" in res["error"]
    assert res["results"] == []
    print("PASS: <4 night request rejected with 4-night-minimum message")


def test_full_availability_all_rooms():
    cal = Calendar()
    res = search_availability(cal, d(2026, 7, 1), d(2026, 7, 8))  # 7 nights, empty
    assert res["ok"]
    pent = _result_for(res, "penthouse_apartment")
    assert pent is not None, "Penthouse should appear (rate exists for 7 nights)"
    assert pent["status"] == "full"
    assert pent["available_nights"] == 7
    assert pent["available_check_in"] == "2026-07-01"
    assert pent["available_check_out"] == "2026-07-08"
    assert pent["base_rate"] == 930.0
    print("PASS: empty calendar -> all rooms full for 7-night request (with rates)")


def test_search_results_include_base_rate():
    cal = Calendar()
    res = search_availability(cal, d(2026, 7, 1), d(2026, 7, 5))  # 4 nights
    assert res["ok"]
    suite = _result_for(res, "adventure_suite")
    assert suite["base_rate"] == 792.0
    pent = _result_for(res, "penthouse_apartment")
    assert pent["base_rate"] == 930.0
    twob = _result_for(res, "two_bedroom_apartment")
    assert twob["base_rate"] == 1188.0
    print("PASS: search results include correct base_rate for each room")


def test_partial_offers_4plus_stretch():
    cal = Calendar()
    # Penthouse (1 unit) booked the LAST 3 nights of a 7-night window.
    # Requested Jul 1-8. Booked Jul 5-8 -> nights 5,6,7 taken.
    # Available stretch: Jul 1-5 = 4 nights (qualifies).
    cal.add_booking("penthouse_apartment", d(2026, 7, 5), d(2026, 7, 8))
    res = search_availability(cal, d(2026, 7, 1), d(2026, 7, 8))
    pent = _result_for(res, "penthouse_apartment")
    assert pent is not None, "Penthouse should appear (rate exists for 4 nights)"
    assert pent["status"] == "partial", pent
    assert pent["available_check_in"] == "2026-07-01"
    assert pent["available_check_out"] == "2026-07-05"
    assert pent["available_nights"] == 4
    assert pent["base_rate"] == 930.0
    print("PASS: partial availability offers the 4-night front stretch (with rate)")


def test_partial_too_short_excluded():
    cal = Calendar()
    # Penthouse booked a middle night, splitting the window into 3- and 2-night
    # pieces — neither reaches 4. Room should be EXCLUDED (not shown at all).
    cal.add_booking("penthouse_apartment", d(2026, 7, 4), d(2026, 7, 5))
    res = search_availability(cal, d(2026, 7, 1), d(2026, 7, 7))
    pent = _result_for(res, "penthouse_apartment")
    assert pent is None, "Penthouse should be excluded (no 4+ night run)"
    print("PASS: split window with no 4-night run -> room excluded from results")


def test_longest_run_chosen_when_multiple():
    cal = Calendar()
    # Window Jul 1-15 (14 nights). Book Jul 6 only.
    # Runs: Jul1-6 (5 nights) and Jul7-15 (8 nights). Longest = the 8-night tail.
    cal.add_booking("penthouse_apartment", d(2026, 7, 6), d(2026, 7, 7))
    res = search_availability(cal, d(2026, 7, 1), d(2026, 7, 15))
    pent = _result_for(res, "penthouse_apartment")
    assert pent is not None
    assert pent["status"] == "partial"
    assert pent["available_check_in"] == "2026-07-07"
    assert pent["available_check_out"] == "2026-07-15"
    assert pent["available_nights"] == 8
    assert pent["base_rate"] == 930.0
    print("PASS: when two stretches exist, the LONGEST is offered (8 nights)")


def test_multi_unit_suite_still_full_with_some_bookings():
    cal = Calendar()
    # 3 Adventure Suites. Book 2 of them for the full window — 1 still free,
    # so a full-stay match should still be reported.
    cal.add_booking("adventure_suite", d(2026, 7, 1), d(2026, 7, 8))
    cal.add_booking("adventure_suite", d(2026, 7, 1), d(2026, 7, 8))
    res = search_availability(cal, d(2026, 7, 1), d(2026, 7, 8))
    suite = _result_for(res, "adventure_suite")
    assert suite is not None
    assert suite["status"] == "full", suite
    print("PASS: 2 of 3 suites booked -> still full (1 unit free)")


def test_multi_unit_suite_partial_when_all_booked_some_nights():
    cal = Calendar()
    # All 3 suites booked for the last 3 nights of a 7-night window.
    for _ in range(3):
        cal.add_booking("adventure_suite", d(2026, 7, 5), d(2026, 7, 8))
    res = search_availability(cal, d(2026, 7, 1), d(2026, 7, 8))
    suite = _result_for(res, "adventure_suite")
    assert suite is not None
    # Jul 1-5 (4 nights) all 3 units free -> partial 4-night front stretch
    assert suite["status"] == "partial", suite
    assert suite["available_nights"] == 4
    assert suite["available_check_out"] == "2026-07-05"
    print("PASS: all suites full on some nights -> partial 4-night offer")


def test_no_rate_for_requested_nights_excludes_room():
    """If the RoomPricing catalog has no entry for a room at the requested
    number of nights, that room should not appear in results at all."""
    cal = Calendar()
    # 12-night request — no rates seeded for 12 nights
    res = search_availability(cal, d(2026, 7, 1), d(2026, 7, 13))
    assert res["ok"]
    # All three rooms should be excluded (no rate for 12 nights)
    assert len(res["results"]) == 0, f"Expected 0 results, got {len(res['results'])}"
    print("PASS: no rate for 12 nights -> all rooms excluded from results")


def test_no_rate_for_partial_excludes_room():
    """Even if there's a 4-night stretch available, if the RoomPricing catalog
    has no entry for that night count, the room is excluded."""
    # Temporarily remove the 4-night rate for penthouse to test this
    from booking_engine.room_pricing import ROOM_PRICING_CATALOG
    key = ("penthouse_apartment", 4)
    saved_rate = ROOM_PRICING_CATALOG.pop(key)
    try:
        cal = Calendar()
        cal.add_booking("penthouse_apartment", d(2026, 7, 5), d(2026, 7, 8))
        res = search_availability(cal, d(2026, 7, 1), d(2026, 7, 8))
        pent = _result_for(res, "penthouse_apartment")
        assert pent is None, "Penthouse should be excluded (no rate for 4 nights)"
        print("PASS: no rate for partial night count -> room excluded")
    finally:
        ROOM_PRICING_CATALOG[key] = saved_rate


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
        except AssertionError as e:
            failed += 1
            print(f"FAIL: {fn.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"ERROR: {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} tests passed.")
    sys.exit(1 if failed else 0)
