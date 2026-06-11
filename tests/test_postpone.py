"""Tests for postpone -> Pending Confirmation -> reinstate at locked rates."""

from datetime import date
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.status import (
    effective_status, counts_as_revenue,
    PENDING_CONFIRMATION, CONFIRMED, IN_HOUSE,
)
from booking_engine.reservation import Reservation
from booking_engine.seasonal import RateCalendar, RateRule
from booking_engine.invoice import Guest


def d(y, m, day):
    return date(y, m, day)


def _seasonal_cal():
    cal = RateCalendar()
    # High season is pricier — used to prove locked rates ignore it on reinstate.
    cal.add_rule("adventure_suite", RateRule(
        "High Season", d(2026, 12, 15), d(2027, 4, 15), 1200.0, priority=10))
    return cal


def test_pending_confirmation_excluded_from_revenue():
    assert not counts_as_revenue(PENDING_CONFIRMATION)
    print("PASS: Pending Confirmation excluded from revenue")


def test_pending_confirmation_is_sticky():
    # dates say In-House, but Pending Confirmation overrides
    s = effective_status(d(2026, 7, 10), d(2026, 7, 15),
                         stored_status=PENDING_CONFIRMATION, today=d(2026, 7, 12))
    assert s == PENDING_CONFIRMATION
    print("PASS: Pending Confirmation is sticky (date logic does not override)")


def test_postpone_locks_rate_and_sets_status():
    cal = _seasonal_cal()
    guest = Guest("Sick Guest", "s@example.com", "5550003333")
    r = Reservation("WBE-INV-0100", guest, date_booked=d(2026, 6, 1),
                    rate_calendar=cal)
    # Original: Adventure Suite, low season (July), 5 nights @ base 792
    r.add_room("adventure_suite", d(2026, 7, 1), d(2026, 7, 6))
    bd0, rec0 = r.recompute()
    assert rec0["accommodationSaleNet"] == 3960.00  # 5 x 792
    # Guest gets sick -> postpone
    r.postpone()
    assert r.status == PENDING_CONFIRMATION
    assert r.rooms[0].locked_nightly_rate == 792.0      # locked at original
    assert r.original_check_in == d(2026, 7, 1)
    _, recP = r.recompute()
    assert recP["status"] == PENDING_CONFIRMATION
    print("PASS: postpone locks rate $792 + status Pending Confirmation")


def test_reinstate_into_high_season_keeps_locked_rate():
    cal = _seasonal_cal()
    guest = Guest("Sick Guest", "s@example.com", "5550003333")
    r = Reservation("WBE-INV-0101", guest, date_booked=d(2026, 6, 1),
                    rate_calendar=cal)
    r.add_room("adventure_suite", d(2026, 7, 1), d(2026, 7, 6))  # 5n low @ 792
    r.recompute()
    r.postpone()
    # Reinstate into HIGH SEASON (would be $1200/night at current rates),
    # same 5 nights. Must still price at locked $792.
    res = r.reinstate([(d(2027, 1, 10), d(2027, 1, 15))])
    assert res["two_year_ok"] is True
    assert r.status == CONFIRMED
    bd, rec = r.recompute()
    # 5 nights x locked 792 = 3960  (NOT 5 x 1200 = 6000)
    assert rec["accommodationSaleNet"] == 3960.00, rec["accommodationSaleNet"]
    assert rec["totalVat10"] == 396.00
    print("PASS: reinstate into high season keeps locked $792 (=$3,960, not $6,000)")


def test_reinstate_different_nights_scales_at_locked_rate():
    cal = _seasonal_cal()
    guest = Guest("Sick Guest", "s@example.com", "5550003333")
    r = Reservation("WBE-INV-0102", guest, date_booked=d(2026, 6, 1),
                    rate_calendar=cal)
    r.add_room("adventure_suite", d(2026, 7, 1), d(2026, 7, 6))  # 5n @ 792
    r.recompute()
    r.postpone()
    # Reinstate to only 3 nights -> 3 x locked 792 = 2376
    r.reinstate([(d(2027, 2, 1), d(2027, 2, 4))])
    _, rec = r.recompute()
    assert rec["accommodationSaleNet"] == 2376.00, rec["accommodationSaleNet"]
    print("PASS: reinstate to 3 nights scales at locked rate = $2,376")


def test_two_year_guardrail_blocks_and_overrides():
    cal = _seasonal_cal()
    guest = Guest("Sick Guest", "s@example.com", "5550003333")
    r = Reservation("WBE-INV-0103", guest, date_booked=d(2026, 6, 1),
                    rate_calendar=cal)
    r.add_room("adventure_suite", d(2026, 7, 1), d(2026, 7, 6))
    r.recompute()
    r.postpone()
    # More than 2 years after original check-in (2026-07-01) -> blocked
    try:
        r.reinstate([(d(2028, 8, 1), d(2028, 8, 6))])
        assert False, "Expected 2-year guardrail to block"
    except ValueError as e:
        assert "2 years" in str(e)
    # Override allowed
    res = r.reinstate([(d(2028, 8, 1), d(2028, 8, 6))], enforce_two_year=False)
    assert res["two_year_ok"] is False and res["warnings"]
    assert r.status == CONFIRMED
    print("PASS: 2-year guardrail blocks by default, override works w/ warning")


def test_within_two_years_boundary():
    cal = _seasonal_cal()
    guest = Guest("G", "g@example.com", "5550004444")
    r = Reservation("WBE-INV-0104", guest, date_booked=d(2026, 6, 1),
                    rate_calendar=cal)
    r.add_room("adventure_suite", d(2026, 7, 1), d(2026, 7, 6))
    r.recompute(); r.postpone()
    # Exactly 2 years later is allowed; one day past is not.
    assert r.within_two_years(d(2028, 7, 1)) is True
    assert r.within_two_years(d(2028, 7, 2)) is False
    print("PASS: 2-year boundary exact (2028-07-01 ok, 2028-07-02 not)")


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
