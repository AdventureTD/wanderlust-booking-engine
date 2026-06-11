"""Tests for real confirmed rates + extra-guest pricing."""

from datetime import date
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.rooms import get_room
from booking_engine.room_pricing import get_base_rate
from booking_engine.seasonal import RateCalendar, RateRule
from booking_engine.pricing import Quote


def d(y, m, day):
    return date(y, m, day)


def test_real_base_rates_loaded():
    # Rates now live in RoomPricing, keyed by (room_code, nights)
    assert get_base_rate("adventure_suite", 5) == 792.0
    assert get_base_rate("penthouse_apartment", 5) == 930.0
    assert get_base_rate("two_bedroom_apartment", 5) == 1188.0
    # Occupancy still on the Room
    assert get_room("two_bedroom_apartment").base_occupancy == 3
    assert get_room("two_bedroom_apartment").max_occupancy == 4
    assert get_room("two_bedroom_apartment").extra_guest_fee == 396.0
    print("PASS: real confirmed rates (from RoomPricing) + occupancy loaded")


def test_adventure_suite_quote_vat():
    # 5 nights @ 792 = 3960 net accommodation, +10% = 396 VAT
    q = Quote()
    q.add_room("adventure_suite", nights=5)
    assert q.subtotal_net() == 3960.00
    assert q.vat_by_class()["accommodation"] == 396.00
    assert q.total() == 4356.00
    print("PASS: Adventure Suite 5n @ $792 + 10% VAT = $4356.00")


def test_two_bedroom_with_extra_guest():
    # 7 nights @ 1188 = 8316 ; extra guest (4th): 1 x 7 nights x 396 = 2772
    # accommodation net = 11088 ; +10% VAT = 1108.80 ; total 12196.80
    q = Quote()
    q.add_room("two_bedroom_apartment", nights=7, guests=4)
    assert q.subtotal_net() == 11088.00, q.subtotal_net()
    assert q.vat_by_class()["accommodation"] == 1108.80, q.vat_by_class()
    assert q.total() == 12196.80, q.total()
    print("PASS: Two-Bedroom 7n + 1 extra guest + 10% VAT = $12196.80")


def test_two_bedroom_three_guests_no_extra_charge():
    # 3 guests = base occupancy, no extra-guest line
    # Use explicit nightly_rate since 2 nights has no RoomPricing entry
    q = Quote()
    q.add_room("two_bedroom_apartment", nights=2, guests=3, nightly_rate=1188.0)
    assert q.subtotal_net() == 2376.00  # 2 x 1188 only
    assert len(q.line_items) == 1
    print("PASS: Two-Bedroom at base occupancy (3) adds no extra-guest charge")


def test_extra_guest_beyond_max_rejected():
    # Use explicit nightly_rate to bypass rate lookup (testing occupancy, not pricing)
    q = Quote()
    try:
        q.add_room("two_bedroom_apartment", nights=2, guests=5, nightly_rate=1188.0)  # max is 4
        assert False, "Expected occupancy cap to reject 5 guests"
    except ValueError as e:
        assert "sleeps" in str(e)
    print("PASS: 5 guests in Two-Bedroom (max 4) rejected")


def test_extra_guest_with_seasonal_and_a_la_carte():
    """Two-Bedroom across a season boundary, 4 guests, plus an a la carte extra."""
    cal = RateCalendar()
    cal.add_rule("two_bedroom_apartment", RateRule(
        "High Season", d(2026, 12, 15), d(2027, 4, 15), 1500.0, priority=10))
    q = Quote()
    # Dec 13-17: nights 13,14 @ base 1188 ; 15,16 @ high 1500
    #   = 2*1188 + 2*1500 = 2376 + 3000 = 5376
    # extra guest (4th): 1 x 4 nights x 396 = 1584
    # accommodation net = 5376 + 1584 = 6960 ; VAT 10% = 696.00
    q.add_room_seasonal("two_bedroom_apartment", d(2026, 12, 13), d(2026, 12, 17),
                        cal, guests=4)
    # a la carte: 4 x 500 = 2000 net (standard 15%) -> 300 VAT
    q.add_extra("private_chef", quantity=4, price=500.0)

    assert q.vat_by_class()["accommodation"] == 696.00, q.vat_by_class()
    assert q.vat_by_class()["standard"] == 300.00, q.vat_by_class()
    assert q.subtotal_net() == 8960.00, q.subtotal_net()   # 6960 + 2000
    assert q.total() == 9956.00, q.total()                 # + 996 VAT
    print("PASS: Two-Bedroom seasonal + extra guest + a la carte = $9956.00")


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
