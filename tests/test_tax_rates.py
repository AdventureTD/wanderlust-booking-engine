"""
Test: dynamic tax rates can be changed at runtime via catalog.set_tax_rate().
All pricing must recalculate using the new rates.
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.catalog import (
    set_tax_rate, get_tax_rate, get_all_tax_rates, reset_tax_rates,
)
from booking_engine.package_pricing import quote_package
from booking_engine.rooms import register_room, unregister_room
from booking_engine.room_pricing import register_rate, clear_test_rates
from booking_engine.pricing import Quote


def setup_module():
    """Register a test room and rate before any test runs."""
    register_room(
        code="tax_test_suite",
        name="Tax Test Suite",
        units=3,
        base_occupancy=2,
        max_occupancy=2,
        extra_guest_fee=0.0,
    )
    register_rate("tax_test_suite", 5, 1000.0)   # 5 nights @ $1000/nt


def teardown_function():
    """Reset tax rates and clean up test room after each test."""
    reset_tax_rates()
    unregister_room("tax_test_suite")
    clear_test_rates("tax_test_suite")


def test_default_tax_rates():
    assert get_tax_rate("accommodation") == 0.10
    assert get_tax_rate("standard") == 0.15
    rates = get_all_tax_rates()
    assert rates["accommodation"] == 0.10
    assert rates["standard"] == 0.15


def test_set_tax_rate():
    set_tax_rate("accommodation", 0.12)
    assert get_tax_rate("accommodation") == 0.12
    assert get_tax_rate("standard") == 0.15   # unchanged

    set_tax_rate("standard", 0.18)
    assert get_tax_rate("standard") == 0.18
    assert get_tax_rate("accommodation") == 0.12


def test_package_pricing_with_custom_tax():
    """Custom tax rates directly change the VAT lines and grand total."""
    set_tax_rate("accommodation", 0.20)
    set_tax_rate("standard", 0.25)

    q = quote_package("tax_test_suite", 5, guests=2)
    assert q.vat_accommodation == 500.0   # $2500 * 0.20
    assert q.vat_adventure == 625.00      # $2500 * 0.25
    assert q.total_vat == 1125.00
    # grand = 5000 + 1125 + 250 (5% fee) = 6375
    assert q.grand_total == 6375.00


def test_package_pricing_breakdown_labels_reflect_rates():
    """Breakdown vatByClass labels must show the CURRENT rate."""
    set_tax_rate("accommodation", 0.20)
    set_tax_rate("standard", 0.25)

    q = quote_package("tax_test_suite", 5, guests=2)
    bd = q.breakdown()
    assert bd["vat_by_class"]["accommodation (20%)"] == 500.0
    assert bd["vat_by_class"]["standard (25%)"] == 625.00
    assert bd["line_items"][0]["vat_rate"] == 0.20
    assert bd["line_items"][1]["vat_rate"] == 0.25


def test_quote_class_with_custom_tax():
    """The old Quote class respects dynamic tax rates too."""
    set_tax_rate("accommodation", 0.20)
    set_tax_rate("standard", 0.25)

    quote = Quote()
    quote.add("Room (3 nights)", "accommodation", 3, 300)
    quote.add("Tour", "standard", 2, 150)

    # Room: 3*300=900 + 20% = 180  -> gross 1080
    # Tour: 2*150=300 + 25% = 75   -> gross 375
    assert quote.subtotal_net() == 1200.0
    assert quote.total_vat() == 255.0
    assert quote.total() == 1455.0


def test_reset_restores_defaults():
    set_tax_rate("accommodation", 0.99)
    set_tax_rate("standard", 0.99)
    reset_tax_rates()
    assert get_tax_rate("accommodation") == 0.10
    assert get_tax_rate("standard") == 0.15


def test_invalid_tax_class_rejected():
    try:
        set_tax_rate("invalid_class", 0.5)
        assert False, "Should have raised ValueError"
    except ValueError as e:
        assert "Unknown tax class" in str(e)

    try:
        get_tax_rate("bogus")
        assert False, "Should have raised ValueError"
    except ValueError as e:
        assert "Unknown tax class" in str(e)


if __name__ == "__main__":
    tests = [
        test_default_tax_rates,
        test_set_tax_rate,
        test_package_pricing_with_custom_tax,
        test_package_pricing_breakdown_labels_reflect_rates,
        test_quote_class_with_custom_tax,
        test_reset_restores_defaults,
        test_invalid_tax_class_rejected,
    ]
    passed = 0
    for t in tests:
        try:
            setup_module()   # re-seed room/rate
            t()
            print(f"PASS: {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"FAIL: {t.__name__} — {e}")
        finally:
            teardown_function()
    print(f"\n{passed}/{len(tests)} tests passed.")
