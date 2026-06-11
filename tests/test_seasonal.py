"""Tests for seasonal/date-based room pricing."""

from datetime import date
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.seasonal import RateCalendar, RateRule
from booking_engine.pricing import Quote


def d(y, m, day):
    return date(y, m, day)


def build_calendar():
    cal = RateCalendar()
    # Low season base is the room base_rate (no rule). High season + holiday spike.
    cal.add_rule("penthouse_apartment", RateRule(
        "High Season", d(2026, 12, 15), d(2027, 4, 15), 500.0, priority=10))
    cal.add_rule("penthouse_apartment", RateRule(
        "Christmas Week", d(2026, 12, 24), d(2026, 12, 31), 800.0, priority=100))
    return cal


def test_single_season_nights():
    cal = build_calendar()
    # 3 nights fully inside High Season, base 300 (ignored since rule matches)
    bd = cal.price_stay("penthouse_apartment", d(2027, 1, 10), d(2027, 1, 13), 300.0)
    assert bd["nights"] == 3
    assert bd["total_room_charge"] == 1500.00, bd  # 3 x 500
    assert len(bd["grouped"]) == 1
    assert bd["grouped"][0]["season"] == "High Season"
    print("PASS: 3 nights in High Season = $1500.00")


def test_boundary_crossing_stay():
    cal = build_calendar()
    # Check in Dec 13 (base/low), cross into High Season Dec 15.
    # Nights occupied: 13, 14 (base 300) ; 15, 16 (High 500). checkout=17.
    bd = cal.price_stay("penthouse_apartment", d(2026, 12, 13), d(2026, 12, 17), 300.0)
    assert bd["nights"] == 4
    # 2*300 + 2*500 = 1600
    assert bd["total_room_charge"] == 1600.00, bd
    seasons = [g["season"] for g in bd["grouped"]]
    assert seasons == ["Base", "High Season"], seasons
    print("PASS: boundary-crossing stay split correctly = $1600.00 (2@base + 2@high)")


def test_holiday_priority_override():
    cal = build_calendar()
    # Dec 23 (High 500), Dec 24-25 (Christmas 800 overrides High). checkout Dec 26.
    bd = cal.price_stay("penthouse_apartment", d(2026, 12, 23), d(2026, 12, 26), 300.0)
    # nights: 23 High(500), 24 Xmas(800), 25 Xmas(800) = 2100
    assert bd["total_room_charge"] == 2100.00, bd
    seasons = [g["season"] for g in bd["grouped"]]
    assert seasons == ["High Season", "Christmas Week"], seasons
    print("PASS: high-priority holiday overrides season = $2100.00")


def test_no_rule_falls_back_to_base():
    cal = build_calendar()
    # July — no rule, uses base 300
    bd = cal.price_stay("penthouse_apartment", d(2026, 7, 1), d(2026, 7, 4), 300.0)
    assert bd["total_room_charge"] == 900.00  # 3 x 300
    assert bd["grouped"][0]["season"] == "Base"
    print("PASS: no rule -> base rate = $900.00")


def test_seasonal_quote_with_vat():
    """Boundary-crossing room + a la carte extra, with correct dual VAT."""
    cal = build_calendar()
    q = Quote()
    # 2@base300 + 2@high500 = 1600 accommodation net, +10% = 160 VAT
    q.add_room_seasonal("penthouse_apartment", d(2026, 12, 13), d(2026, 12, 17),
                        cal, base_rate=300.0)
    # a la carte 2 x 1000 = 2000 net, +15% = 300 VAT
    q.add_extra("private_chef", quantity=2, price=1000.0)

    assert q.vat_by_class()["accommodation"] == 160.00, q.vat_by_class()
    assert q.vat_by_class()["standard"] == 300.00, q.vat_by_class()
    assert q.subtotal_net() == 3600.00, q.subtotal_net()   # 1600 + 2000
    assert q.total() == 4060.00, q.total()                 # +460 VAT
    print("PASS: seasonal room + a la carte quote w/ dual VAT = $4060.00")


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
