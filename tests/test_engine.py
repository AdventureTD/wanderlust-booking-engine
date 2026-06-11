"""Tests for the Wanderlust Booking Engine core logic."""

from datetime import date
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.availability import Calendar
from booking_engine.pricing import Quote


def d(y, m, day):
    return date(y, m, day)


# ============================================================
# AVAILABILITY / OVERBOOKING TESTS
# ============================================================

def test_three_suites_can_book_three_then_fourth_rejected():
    cal = Calendar()
    # 3 Adventure Suites exist. Book all 3 on the same overlapping nights.
    cal.add_booking("adventure_suite", d(2026, 7, 1), d(2026, 7, 5))
    cal.add_booking("adventure_suite", d(2026, 7, 2), d(2026, 7, 6))
    cal.add_booking("adventure_suite", d(2026, 7, 3), d(2026, 7, 4))
    # 4th overlapping booking must be refused.
    try:
        cal.add_booking("adventure_suite", d(2026, 7, 3), d(2026, 7, 4))
        assert False, "Expected overbooking to be rejected"
    except ValueError as e:
        assert "available" in str(e)
    print("PASS: 3 suites bookable, 4th overlapping rejected")


def test_penthouse_single_unit_overbook_rejected():
    cal = Calendar()
    cal.add_booking("penthouse_apartment", d(2026, 8, 10), d(2026, 8, 15))
    try:
        cal.add_booking("penthouse_apartment", d(2026, 8, 12), d(2026, 8, 14))
        assert False, "Expected single-unit overbooking to be rejected"
    except ValueError:
        pass
    print("PASS: penthouse (1 unit) overbooking rejected")


def test_same_day_turnover_allowed():
    cal = Calendar()
    # Guest A leaves morning of the 15th; Guest B arrives the 15th. No conflict.
    cal.add_booking("penthouse_apartment", d(2026, 8, 10), d(2026, 8, 15))
    cal.add_booking("penthouse_apartment", d(2026, 8, 15), d(2026, 8, 20))
    print("PASS: same-day turnover (checkout==checkin) allowed")


def test_non_overlapping_dates_allowed():
    cal = Calendar()
    cal.add_booking("two_bedroom_apartment", d(2026, 9, 1), d(2026, 9, 5))
    cal.add_booking("two_bedroom_apartment", d(2026, 9, 10), d(2026, 9, 12))
    print("PASS: non-overlapping bookings for 1-unit room allowed")


def test_cancel_frees_inventory():
    cal = Calendar()
    b = cal.add_booking("penthouse_apartment", d(2026, 8, 10), d(2026, 8, 15))
    assert not cal.is_available("penthouse_apartment", d(2026, 8, 12), d(2026, 8, 13))
    cal.cancel(b.booking_id)
    assert cal.is_available("penthouse_apartment", d(2026, 8, 12), d(2026, 8, 13))
    print("PASS: cancelling a booking frees the unit")


def test_units_available_count():
    cal = Calendar()
    assert cal.units_available("adventure_suite", d(2026, 7, 1), d(2026, 7, 5)) == 3
    cal.add_booking("adventure_suite", d(2026, 7, 1), d(2026, 7, 5))
    assert cal.units_available("adventure_suite", d(2026, 7, 1), d(2026, 7, 5)) == 2
    print("PASS: units_available reflects remaining inventory")


def test_occupancy_cap_enforced():
    cal = Calendar()
    # Adventure Suite sleeps 2; 3 guests should be refused.
    try:
        cal.add_booking("adventure_suite", d(2026, 7, 1), d(2026, 7, 3), guests=3)
        assert False, "Expected occupancy cap to be enforced"
    except ValueError as e:
        assert "sleeps" in str(e)
    print("PASS: occupancy cap enforced")


# ============================================================
# PRICING / DUAL-VAT TESTS
# ============================================================

def test_dual_vat_tax_exclusive():
    """Room @ 10% VAT, a la carte @ 15% VAT, added on top of listed prices."""
    q = Quote(prices_include_vat=False)
    # 5 nights @ $300 accommodation = $1500 net, +10% VAT = $150
    q.add_room("adventure_suite", nights=5, nightly_rate=300.0)
    # A la carte: 2 x $1000 = $2000 net, +15% VAT = $300
    q.add_extra("canyoning", quantity=2, price=1000.0)

    assert q.subtotal_net() == 3500.00, q.subtotal_net()
    vat = q.vat_by_class()
    assert vat["accommodation"] == 150.00, vat
    assert vat["standard"] == 300.00, vat
    assert q.total_vat() == 450.00, q.total_vat()
    assert q.total() == 3950.00, q.total()
    print("PASS: dual VAT (10% accom + 15% standard), tax-exclusive = $3950.00")


def test_a_la_carte_taxed_at_15():
    q = Quote()
    q.add_extra("canyoning", quantity=2, price=150.0)  # 2 x $150 = $300 net
    assert q.subtotal_net() == 300.00
    assert q.vat_by_class()["standard"] == 45.00   # 15% of 300
    assert q.total() == 345.00
    print("PASS: a la carte taxed at 15% = $345.00")


def test_vat_inclusive_backcompute():
    """If listed prices already include VAT, back-compute net + tax."""
    q = Quote(prices_include_vat=True)
    # $110 gross accommodation that includes 10% VAT -> net $100, VAT $10
    q.add_room("penthouse_apartment", nights=1, nightly_rate=110.0)
    assert q.vat_by_class()["accommodation"] == 10.00, q.vat_by_class()
    assert q.subtotal_net() == 100.00, q.subtotal_net()
    assert q.total() == 110.00, q.total()
    print("PASS: VAT-inclusive back-computation correct")


def test_full_booking_breakdown():
    """Realistic mixed booking: room + a la carte extras."""
    q = Quote()
    q.add_room("penthouse_apartment", nights=7, nightly_rate=400.0)   # 2800 net, 280 vat
    q.add_extra("private_chef", quantity=2, price=2820.0)             # 5640 net, 846 vat
    q.add_extra("canyoning", quantity=1, price=250.0)                 # 250 net, 37.50 vat
    bd = q.breakdown()
    assert bd["subtotal_net"] == 8690.00, bd["subtotal_net"]
    assert bd["total_vat"] == 1163.50, bd["total_vat"]   # 280 + 846 + 37.50
    assert bd["total"] == 9853.50, bd["total"]
    print("PASS: full mixed booking breakdown total = $9853.50")


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
