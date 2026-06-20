"""Tests for the booking report record — the fields logged for reporting."""

from datetime import date
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.seasonal import RateCalendar, RateRule
from booking_engine.pricing import Quote
from booking_engine.invoice import Guest
from booking_engine.report import build_report_record


def d(y, m, day):
    return date(y, m, day)


def test_report_buckets_and_reconciliation():
    """Two-Bedroom seasonal + extra guest + a la carte extras.
    Verify 10%/15% net sales, VAT splits, and grand total == invoice total."""
    cal = RateCalendar()
    cal.add_rule("two_bedroom_apartment", RateRule(
        "High Season", d(2026, 12, 15), d(2027, 4, 15), 1500.0, priority=10))

    q = Quote()
    # Dec 13-20 (7n): 2@1188 base + 5@1500 high = 2376 + 7500 = 9876 accom
    # extra guest (4th): 1 x 7 x 396 = 2772 accom  -> accom net = 12648
    q.add_room_seasonal("two_bedroom_apartment", d(2026, 12, 13), d(2026, 12, 20),
                        cal, guests=4)
    # a la carte: 4 x 2820 = 11280 (standard)
    q.add_extra("private_chef", quantity=4, price=2820.0)
    # a la carte chef 250 (standard)  -> standard net = 11530
    q.add_extra("canyoning", quantity=1, price=250.0)

    bd = q.breakdown()
    guest = Guest("Jim & Sandy Evans", "jim@example.com", "+1 555 012 3456")
    rec = build_report_record(
        guest=guest, invoice_number="WBE-INV-0007", quote_breakdown=bd,
        check_in=d(2026, 12, 13), check_out=d(2026, 12, 20),
        date_booked=d(2026, 6, 1), room_code="two_bedroom_apartment",
    )

    # Net sales by class
    assert rec.accommodationSaleNet == 12648.00, rec.accommodationSaleNet
    assert rec.packageSaleNet == 11530.00, rec.packageSaleNet
    # VAT by class
    assert rec.totalVat10 == 1264.80, rec.totalVat10   # 10% of 12648
    assert rec.totalVat15 == 1729.50, rec.totalVat15   # 15% of 11530
    assert rec.totalVat == 2994.30, rec.totalVat
    # Grand total reconciles to the invoice total exactly
    assert rec.grandTotal == bd["total"], (rec.grandTotal, bd["total"])
    assert rec.grandTotal == 27172.30, rec.grandTotal  # 12648+11530+2994.30

    # Required descriptive fields present
    assert rec.guestName == "Jim & Sandy Evans"
    assert rec.bookingNumber == "WBE-INV-0007"
    assert rec.guestPhone and rec.guestEmail
    assert rec.dateBooked == "2026-06-01"
    assert rec.checkInDate == "2026-12-13"
    assert rec.checkOutDate == "2026-12-20"
    print("PASS: report buckets correct; grandTotal == invoice total == $28,442.30")


def test_accommodation_only_booking():
    q = Quote()
    q.add_room("adventure_suite", nights=5)   # 5 x 792 = 3960 accom
    bd = q.breakdown()
    guest = Guest("Solo Tester", "s@example.com", "5550001111")
    rec = build_report_record(
        guest=guest, invoice_number="WBE-INV-0008", quote_breakdown=bd,
        check_in=d(2026, 7, 1), check_out=d(2026, 7, 6),
    )
    assert rec.accommodationSaleNet == 3960.00
    assert rec.packageSaleNet == 0.00
    assert rec.totalVat10 == 396.00
    assert rec.totalVat15 == 0.00
    assert rec.grandTotal == 4356.00 == bd["total"]
    print("PASS: accommodation-only booking reconciles = $4,356.00")


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
