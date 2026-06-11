"""Tests for minimum occupancy (no single-guest bookings; min = base occupancy)."""

from datetime import date
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.availability import Calendar
from booking_engine.pricing import Quote


def d(y, m, day):
    return date(y, m, day)


# ---- availability.add_booking ----

def test_single_guest_rejected_suite():
    cal = Calendar()
    try:
        cal.add_booking("adventure_suite", d(2026, 7, 1), d(2026, 7, 6), guests=1)
        assert False, "Expected 1 guest to be rejected (min 2)"
    except ValueError as e:
        assert "at least 2 guests" in str(e)
    print("PASS: Adventure Suite rejects 1 guest (min 2)")


def test_single_guest_rejected_penthouse():
    cal = Calendar()
    try:
        cal.add_booking("penthouse_apartment", d(2026, 7, 1), d(2026, 7, 6), guests=1)
        assert False, "Expected 1 guest to be rejected (min 2)"
    except ValueError as e:
        assert "at least 2 guests" in str(e)
    print("PASS: Penthouse rejects 1 guest (min 2)")


def test_two_bedroom_min_three():
    cal = Calendar()
    # 2 guests is below the Two-Bedroom base of 3 -> rejected
    try:
        cal.add_booking("two_bedroom_apartment", d(2026, 7, 1), d(2026, 7, 6), guests=2)
        assert False, "Expected 2 guests to be rejected (Two-Bedroom min 3)"
    except ValueError as e:
        assert "at least 3 guests" in str(e)
    print("PASS: Two-Bedroom rejects 2 guests (min 3)")


def test_base_occupancy_allowed():
    cal = Calendar()
    cal.add_booking("adventure_suite", d(2026, 7, 1), d(2026, 7, 6), guests=2)
    cal.add_booking("two_bedroom_apartment", d(2026, 8, 1), d(2026, 8, 6), guests=3)
    cal.add_booking("two_bedroom_apartment", d(2026, 9, 1), d(2026, 9, 6), guests=4)
    print("PASS: base occupancy (and the 4th in Two-Bedroom) allowed")


def test_default_guests_is_base():
    cal = Calendar()
    # No guests specified -> defaults to base occupancy, so it's allowed.
    b = cal.add_booking("penthouse_apartment", d(2026, 7, 1), d(2026, 7, 6))
    assert b.guests == 2
    print("PASS: unspecified guests defaults to base occupancy (2)")


# ---- pricing Quote ----

def test_quote_rejects_below_base():
    q = Quote()
    try:
        q.add_room("adventure_suite", nights=5, guests=1)
        assert False, "Expected pricing to reject 1 guest"
    except ValueError as e:
        assert "at least 2 guests" in str(e)
    print("PASS: pricing rejects 1 guest in a suite")


def test_quote_two_bedroom_below_base():
    q = Quote()
    try:
        q.add_room("two_bedroom_apartment", nights=5, guests=2)
        assert False, "Expected pricing to reject 2 guests in Two-Bedroom"
    except ValueError as e:
        assert "at least 3 guests" in str(e)
    print("PASS: pricing rejects 2 guests in Two-Bedroom (min 3)")


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
