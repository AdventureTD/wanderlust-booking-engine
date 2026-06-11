"""Tests for reservation status lifecycle, editing, and recompute."""

from datetime import date
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.status import (
    effective_status, counts_as_revenue,
    CONFIRMED, IN_HOUSE, CHECKED_OUT, CANCELLED,
)
from booking_engine.reservation import Reservation
from booking_engine.seasonal import RateCalendar, RateRule
from booking_engine.invoice import Guest


def d(y, m, day):
    return date(y, m, day)


# ---------------- status lifecycle ----------------

def test_status_before_checkin_is_confirmed():
    s = effective_status(d(2026, 7, 10), d(2026, 7, 15), today=d(2026, 7, 1))
    assert s == CONFIRMED, s
    print("PASS: before check-in -> Confirmed")


def test_status_on_checkin_is_in_house():
    # On the check-in date itself -> In-House
    s = effective_status(d(2026, 7, 10), d(2026, 7, 15), today=d(2026, 7, 10))
    assert s == IN_HOUSE, s
    # mid-stay also In-House
    s2 = effective_status(d(2026, 7, 10), d(2026, 7, 15), today=d(2026, 7, 12))
    assert s2 == IN_HOUSE
    print("PASS: on/after check-in -> In-House")


def test_status_on_checkout_is_checked_out():
    s = effective_status(d(2026, 7, 10), d(2026, 7, 15), today=d(2026, 7, 15))
    assert s == CHECKED_OUT, s
    print("PASS: on/after check-out -> Checked-Out")


def test_cancelled_is_sticky():
    # Even if dates say In-House, a cancelled booking stays Cancelled.
    s = effective_status(d(2026, 7, 10), d(2026, 7, 15),
                         stored_status=CANCELLED, today=d(2026, 7, 12))
    assert s == CANCELLED, s
    print("PASS: Cancelled is sticky (overrides date logic)")


def test_revenue_inclusion():
    assert counts_as_revenue(CONFIRMED)
    assert counts_as_revenue(IN_HOUSE)
    assert counts_as_revenue(CHECKED_OUT)
    assert not counts_as_revenue(CANCELLED)
    print("PASS: Cancelled excluded from revenue; others included")


# ---------------- editing + recompute ----------------

def _res():
    cal = RateCalendar()
    cal.add_rule("two_bedroom_apartment", RateRule(
        "High Season", d(2026, 12, 15), d(2027, 4, 15), 1500.0, priority=10))
    guest = Guest("Edit Tester", "e@example.com", "5550002222")
    r = Reservation(invoice_number="WBE-INV-0009", guest=guest,
                    date_booked=d(2026, 6, 1), rate_calendar=cal)
    return r


def test_recompute_after_changing_dates():
    r = _res()
    r.add_room("two_bedroom_apartment", d(2026, 7, 1), d(2026, 7, 5))  # 4n base
    bd1, rec1 = r.recompute()
    assert rec1["accommodationSaleNet"] == 4752.00  # 4 x 1188
    # Guest extends to 6 nights
    r.change_room_dates(0, d(2026, 7, 1), d(2026, 7, 7))               # 6n base
    bd2, rec2 = r.recompute()
    assert rec2["accommodationSaleNet"] == 7128.00  # 6 x 1188
    assert rec2["totalVat10"] == 712.80
    assert rec2["grandTotal"] == bd2["total"]
    print("PASS: changing dates recomputes totals (4n -> 6n = $7,128 net)")


def test_recompute_after_adding_room():
    r = _res()
    r.add_room("two_bedroom_apartment", d(2026, 7, 1), d(2026, 7, 5))  # 4 x 1188 = 4752
    r.add_room("adventure_suite", d(2026, 7, 1), d(2026, 7, 5))        # 4 x 792 = 3168
    bd, rec = r.recompute()
    assert rec["accommodationSaleNet"] == 7920.00, rec["accommodationSaleNet"]
    assert rec["totalVat10"] == 792.00
    assert rec["grandTotal"] == bd["total"]
    print("PASS: adding a room recomputes totals (= $7,920 net accom)")


def test_recompute_with_extra_guest_and_a_la_carte():
    r = _res()
    # Two-Bedroom across season boundary, 4 guests + an a la carte extra
    r.add_room("two_bedroom_apartment", d(2026, 12, 13), d(2026, 12, 17), guests=4)
    r.add_extra("private_chef", quantity=2, price=1000.0)
    bd, rec = r.recompute()
    # accom: 2@1188 + 2@1500 = 5376 ; extra guest 1x4x396 = 1584 ; = 6960 net
    assert rec["accommodationSaleNet"] == 6960.00, rec["accommodationSaleNet"]
    assert rec["packageSaleNet"] == 2000.00
    assert rec["totalVat10"] == 696.00
    assert rec["totalVat15"] == 300.00
    assert rec["grandTotal"] == bd["total"] == 9956.00
    print("PASS: recompute w/ seasonal + extra guest + a la carte = $9,956.00")


def test_status_stamped_on_record():
    r = _res()
    r.add_room("two_bedroom_apartment", d(2030, 1, 1), d(2030, 1, 5))  # future
    _, rec = r.recompute()
    assert rec["status"] == CONFIRMED
    r.cancel()
    _, rec2 = r.recompute()
    assert rec2["status"] == CANCELLED
    print("PASS: status stamped on report record (Confirmed -> Cancelled)")


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
