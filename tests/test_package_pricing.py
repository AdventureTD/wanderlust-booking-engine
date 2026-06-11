"""Tests for the NEW package-pricing model (50/50 split, 10%/15% VAT)."""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.package_pricing import quote_package


def test_adventure_suite_5_nights():
    # 5 x 792 = 3960 ; split 1980/1980 ; VAT 198 + 297 = 495 ; total 4455 (no fee)
    q = quote_package("adventure_suite", nights=5, property_fee_rate=0)
    assert q.total_package_price == 3960.00
    assert q.accommodation_net == 1980.00
    assert q.adventure_net == 1980.00
    assert q.vat_accommodation == 198.00   # 10%
    assert q.vat_adventure == 297.00       # 15%
    assert q.total_vat == 495.00
    assert q.grand_total == 4455.00
    print("PASS: Adventure Suite 5n @ $792 (no fee) -> total $4,455.00")


def test_penthouse_7_nights():
    # 7 x 930 = 6510 ; split 3255/3255 ; VAT 325.50 + 488.25 = 813.75 ; total 7323.75
    q = quote_package("penthouse_apartment", nights=7, property_fee_rate=0)
    assert q.total_package_price == 6510.00
    assert q.accommodation_net == 3255.00
    assert q.adventure_net == 3255.00
    assert q.vat_accommodation == 325.50
    assert q.vat_adventure == 488.25
    assert q.total_vat == 813.75
    assert q.grand_total == 7323.75
    print("PASS: Penthouse 7n @ $930 (no fee) -> total $7,323.75")


def test_two_bedroom_9_nights():
    # 9 x 1188 = 10692 ; split 5346/5346 ; VAT 534.60 + 801.90 = 1336.50 ; total 12028.50
    q = quote_package("two_bedroom_apartment", nights=9, property_fee_rate=0)
    assert q.total_package_price == 10692.00
    assert q.accommodation_net == 5346.00
    assert q.adventure_net == 5346.00
    assert q.vat_accommodation == 534.60
    assert q.vat_adventure == 801.90
    assert q.total_vat == 1336.50
    assert q.grand_total == 12028.50
    print("PASS: Two-Bedroom 9n @ $1,188 (3 guests, no fee) -> total $12,028.50")


def test_two_bedroom_4th_guest_adds_third_of_base():
    # 5 nights, 4 guests. Base 5x1188=5940. Extra guest = 1/3 of 1188 = 396/night
    # x 5 = 1980. Total = 7920. Split 3960/3960. VAT 396 + 594 = 990. Grand 8910 (no fee).
    q = quote_package("two_bedroom_apartment", nights=5, guests=4, property_fee_rate=0)
    assert q.base_total == 5940.00
    assert q.extra_per_night == 396.00          # 1/3 of 1188
    assert q.extra_total == 1980.00
    assert q.total_package_price == 7920.00
    assert q.accommodation_net == 3960.00
    assert q.adventure_net == 3960.00
    assert q.vat_accommodation == 396.00        # 10%
    assert q.vat_adventure == 594.00            # 15%
    assert q.total_vat == 990.00
    assert q.grand_total == 8910.00
    print("PASS: Two-Bedroom 5n + 4th guest (1/3 base, no fee) -> total $8,910.00")


def test_two_bedroom_3_guests_no_extra_charge():
    q = quote_package("two_bedroom_apartment", nights=5, guests=3)
    assert q.extra_guests == 0
    assert q.extra_total == 0.00
    assert q.total_package_price == 5940.00     # base only
    print("PASS: Two-Bedroom 3 guests adds no extra charge")


def test_suite_4_guests_rejected():
    # Suite max is 2; 4 guests must be rejected.
    try:
        quote_package("adventure_suite", nights=5, guests=4)
        assert False, "Expected Suite to reject 4 guests"
    except ValueError as e:
        assert "sleeps 2" in str(e)
    print("PASS: Adventure Suite rejects 4 guests (max 2)")


def test_below_base_rejected_in_package():
    try:
        quote_package("two_bedroom_apartment", nights=5, guests=2)
        assert False, "Expected Two-Bedroom to reject 2 guests (min 3)"
    except ValueError as e:
        assert "at least 3 guests" in str(e)
    print("PASS: package pricing rejects 2 guests in Two-Bedroom (min 3)")


def test_breakdown_shape():
    q = quote_package("adventure_suite", nights=4, property_fee_rate=0)
    bd = q.breakdown()
    assert bd["total_package_price"] == 3168.00         # 4 x 792
    assert len(bd["line_items"]) == 2
    acc = bd["line_items"][0]; adv = bd["line_items"][1]
    assert acc["tax_class"] == "accommodation" and acc["vat_rate"] == 0.10
    assert adv["tax_class"] == "standard" and adv["vat_rate"] == 0.15
    assert acc["net"] == 1584.00 and adv["net"] == 1584.00
    assert acc["vat"] == 158.40 and adv["vat"] == 237.60
    assert bd["total"] == 3168.00 + 158.40 + 237.60
    assert bd["property_fee"] == 0.0
    print("PASS: breakdown has accommodation(10%) + adventure(15%) + grand total")


def test_odd_cent_split_reconciles():
    # A package price that yields an odd total: halves must sum back exactly.
    q = quote_package("adventure_suite", nights=1, package_price_per_night=100.01)
    assert q.total_package_price == 100.01
    assert round(q.accommodation_net + q.adventure_net, 2) == 100.01
    assert q.accommodation_net == 50.01 and q.adventure_net == 50.00
    print("PASS: odd-cent package total splits and reconciles ($100.01)")


def test_grand_total_equals_total_plus_vat():
    # With the default 5% property fee in play, grand = total + VAT + fee.
    for code in ("adventure_suite", "penthouse_apartment", "two_bedroom_apartment"):
        for n in (4, 5, 6, 7, 8, 9, 10):
            q = quote_package(code, nights=n)
            assert round(q.total_package_price + q.total_vat + q.property_fee, 2) == q.grand_total
            assert round(q.accommodation_net + q.adventure_net, 2) == q.total_package_price
    print("PASS: grand total reconciles (total + VAT + fee) for all rooms x 4-10 nights")


def test_default_split_is_50_50():
    q = quote_package("adventure_suite", nights=5)   # no share passed
    assert q.accommodation_share == 0.50
    assert q.accommodation_net == q.adventure_net == 1980.00
    print("PASS: default split is 50/50")


def test_custom_60_40_split():
    # Adventure Suite 5n = 3960 total. 60/40: accom 2376, adventure 1584.
    # VAT: 2376*10% = 237.60 ; 1584*15% = 237.60 ; total VAT 475.20. (no fee here)
    q = quote_package("adventure_suite", nights=5, accommodation_share=0.60,
                      property_fee_rate=0)
    assert q.accommodation_share == 0.60
    assert q.accommodation_net == 2376.00
    assert q.adventure_net == 1584.00
    assert q.vat_accommodation == 237.60
    assert q.vat_adventure == 237.60
    assert q.total_vat == 475.20
    assert q.grand_total == 4435.20
    print("PASS: 60/40 split -> accom $2,376 / adventure $1,584, grand $4,435.20")


def test_custom_split_reconciles():
    # Halves must still sum to the total exactly at a non-even split (with fee).
    for share in (0.40, 0.55, 0.60, 0.667, 0.75):
        q = quote_package("two_bedroom_apartment", nights=7, guests=4,
                          accommodation_share=share)
        assert round(q.accommodation_net + q.adventure_net, 2) == q.total_package_price
        assert round(q.total_package_price + q.total_vat + q.property_fee, 2) == q.grand_total
    print("PASS: custom splits all reconcile (accom+adventure == total)")


# ---------------------------------------------------------------------------
# Property fee (configurable, 5% of net package price, below VAT, untaxed)
# ---------------------------------------------------------------------------

def test_property_fee_default_5pct():
    # Adventure Suite 5n: net 3960, VAT 495, fee 5% of 3960 = 198, grand 4653.
    q = quote_package("adventure_suite", nights=5)   # default 5% fee
    assert q.property_fee_rate == 0.05
    assert q.property_fee == 198.00
    assert q.total_vat == 495.00
    assert q.grand_total == 4653.00
    print("PASS: default 5% property fee -> fee $198.00, grand $4,653.00")


def test_property_fee_in_breakdown_below_vat():
    q = quote_package("adventure_suite", nights=5)
    bd = q.breakdown()
    # fee is reported separately (so the UI/invoice can place it below VAT)
    assert bd["total_vat"] == 495.00
    assert bd["property_fee"] == 198.00
    assert bd["property_fee_rate"] == 0.05
    assert bd["total"] == 3960.00 + 495.00 + 198.00
    print("PASS: property fee appears below VAT in breakdown, folds into grand total")


def test_property_fee_configurable_rate():
    # Change the rate to 8%: fee = 8% of 3960 = 316.80 ; grand = 3960+495+316.80
    q = quote_package("adventure_suite", nights=5, property_fee_rate=0.08)
    assert q.property_fee == 316.80
    assert q.grand_total == 4771.80
    print("PASS: configurable fee rate 8% -> fee $316.80, grand $4,771.80")


def test_property_fee_on_4th_guest_total():
    # Two-Bedroom 5n, 4 guests: net 7920, VAT 990, fee 5% of 7920 = 396, grand 9306.
    q = quote_package("two_bedroom_apartment", nights=5, guests=4)
    assert q.total_package_price == 7920.00
    assert q.total_vat == 990.00
    assert q.property_fee == 396.00
    assert q.grand_total == 9306.00
    print("PASS: fee applies to extra-guest total too -> grand $9,306.00")


def test_property_fee_zero():
    q = quote_package("adventure_suite", nights=5, property_fee_rate=0)
    assert q.property_fee == 0.0
    assert q.grand_total == 4455.00
    print("PASS: 0% property fee -> no fee, grand $4,455.00")


def test_invalid_property_fee_rejected():
    for bad in (-0.1, 1.5):
        try:
            quote_package("adventure_suite", nights=5, property_fee_rate=bad)
            assert False, f"Expected {bad} to be rejected"
        except ValueError as e:
            assert "property_fee_rate must be between 0 and 1" in str(e)
    print("PASS: out-of-range property fee rates rejected")


def test_invalid_split_rejected():
    for bad in (-0.1, 1.5, 2.0):
        try:
            quote_package("adventure_suite", nights=5, accommodation_share=bad)
            assert False, f"Expected {bad} to be rejected"
        except ValueError as e:
            assert "between 0 and 1" in str(e)
    print("PASS: out-of-range split values rejected")


# ---------------------------------------------------------------------------
# RoomPricing lookup (2026-06-03: rate varies by number of nights)
# ---------------------------------------------------------------------------

def test_no_rate_for_night_count_raises():
    """If RoomPricing has no entry for the requested room+nights, quote should fail."""
    try:
        quote_package("adventure_suite", nights=12)  # no rate seeded for 12 nights
        assert False, "Expected ValueError for missing rate"
    except ValueError as e:
        assert "No rate defined" in str(e)
        assert "12 nights" in str(e)
    print("PASS: missing rate for 12 nights raises ValueError")


def test_explicit_price_overrides_lookup():
    """When package_price_per_night is explicitly passed, it should be used
    regardless of what the RoomPricing catalog has (or doesn't have)."""
    # Pass a rate for a night count that has no catalog entry
    q = quote_package("adventure_suite", nights=12,
                      package_price_per_night=700.0, property_fee_rate=0)
    assert q.package_price_per_night == 700.0
    assert q.total_package_price == 8400.0  # 12 * 700
    print("PASS: explicit price override works even for uncataloged night counts")


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
