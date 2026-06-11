"""Tests for the RoomPricing module (per-night rate lookup by room + nights)."""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.room_pricing import (
    get_base_rate, has_rate, all_rates_for_room, ROOM_PRICING_CATALOG,
)


def test_lookup_known_rate():
    # Adventure Suite at 5 nights should return $792
    rate = get_base_rate("adventure_suite", 5)
    assert rate == 792.0
    print("PASS: Adventure Suite 5 nights -> $792.00")


def test_lookup_all_rooms_at_4_nights():
    assert get_base_rate("adventure_suite", 4) == 792.0
    assert get_base_rate("penthouse_apartment", 4) == 930.0
    assert get_base_rate("two_bedroom_apartment", 4) == 1188.0
    print("PASS: All rooms at 4 nights -> correct rates")


def test_lookup_missing_returns_none():
    # No row for 12 nights — should return None
    assert get_base_rate("adventure_suite", 12) is None
    assert get_base_rate("penthouse_apartment", 15) is None
    print("PASS: Missing night count returns None")


def test_lookup_unknown_room_returns_none():
    assert get_base_rate("presidential_suite", 5) is None
    print("PASS: Unknown room code returns None")


def test_has_rate_true():
    assert has_rate("adventure_suite", 4) is True
    assert has_rate("penthouse_apartment", 7) is True
    assert has_rate("two_bedroom_apartment", 10) is True
    print("PASS: has_rate returns True for defined combinations")


def test_has_rate_false():
    assert has_rate("adventure_suite", 12) is False
    assert has_rate("unknown_room", 5) is False
    print("PASS: has_rate returns False for undefined combinations")


def test_all_rates_for_room():
    rates = all_rates_for_room("adventure_suite")
    # Should have entries for 4-10 nights
    assert set(rates.keys()) == {4, 5, 6, 7, 8, 9, 10}
    assert all(v == 792.0 for v in rates.values())
    print("PASS: all_rates_for_room returns 4-10 nights for Adventure Suite")


def test_all_rates_unknown_room_empty():
    rates = all_rates_for_room("nonexistent")
    assert rates == {}
    print("PASS: all_rates_for_room returns empty dict for unknown room")


def test_catalog_has_21_entries():
    # 3 rooms x 7 night counts (4-10) = 21
    assert len(ROOM_PRICING_CATALOG) == 21
    print("PASS: catalog has 21 entries (3 rooms x 7 night counts)")


def test_all_seeded_rates_match_original_prices():
    """Verify the seeded rates match the original fixed per-night prices."""
    expected = {
        "adventure_suite": 792.0,
        "penthouse_apartment": 930.0,
        "two_bedroom_apartment": 1188.0,
    }
    for room_code, price in expected.items():
        for n in range(4, 11):
            rate = get_base_rate(room_code, n)
            assert rate == price, f"{room_code} @ {n} nights: {rate} != {price}"
    print("PASS: all seeded rates match original per-night prices")


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
