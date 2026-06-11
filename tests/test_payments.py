"""Tests for manual payments + balance due."""

from datetime import date
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.payments import PaymentSchedule


def d(y, m, day):
    return date(y, m, day)


def test_schedule_50_50_split():
    s = PaymentSchedule(grand_total=27172.30, check_in=d(2026, 12, 13))
    assert s.deposit_amount() == 13586.15
    assert s.final_amount() == 13586.15
    assert s.deposit_amount() + s.final_amount() == 27172.30
    print("PASS: 50/50 split of $27,172.30 = $13,586.15 each")


def test_odd_cent_split_reconciles():
    # Odd total: deposit + final must still equal grand total exactly.
    s = PaymentSchedule(grand_total=100.01, check_in=d(2026, 7, 10))
    # Compare in cents to avoid float representation noise (money best practice).
    assert round(s.deposit_amount() + s.final_amount(), 2) == 100.01
    assert s.deposit_amount() == 50.01 and s.final_amount() == 50.00
    print("PASS: odd-cent total split reconciles ($100.01 = $50.01 + $50.00)")


def test_final_due_30_days_before_checkin():
    s = PaymentSchedule(grand_total=1000.0, check_in=d(2026, 12, 31))
    assert s.final_due_date() == d(2026, 12, 1)   # 30 days before
    print("PASS: final payment due = check-in minus 30 days")


def test_deposit_then_final_paid_in_full():
    s = PaymentSchedule(grand_total=4356.00, check_in=d(2026, 9, 1))
    s.add_payment(2178.00, d(2026, 6, 1), "deposit")
    assert s.total_paid() == 2178.00
    assert s.balance_due() == 2178.00
    assert not s.is_paid_in_full()
    s.add_payment(2178.00, d(2026, 8, 1), "final")
    assert s.total_paid() == 4356.00
    assert s.balance_due() == 0.00
    assert s.is_paid_in_full()
    print("PASS: deposit + final -> paid in full, balance $0.00")


def test_partial_payment_balance():
    s = PaymentSchedule(grand_total=4356.00, check_in=d(2026, 9, 1))
    s.add_payment(1000.00, d(2026, 6, 1), "deposit")   # partial deposit
    assert s.balance_due() == 3356.00
    assert not s.is_paid_in_full()
    print("PASS: partial payment leaves correct balance ($3,356.00)")


def test_overpayment_negative_balance():
    s = PaymentSchedule(grand_total=1000.00, check_in=d(2026, 9, 1))
    s.add_payment(1200.00, d(2026, 6, 1), "other")
    assert s.balance_due() == -200.00   # overpaid -> negative balance
    assert s.is_paid_in_full()
    print("PASS: overpayment -> negative balance, paid in full")


def test_refund_reduces_paid():
    s = PaymentSchedule(grand_total=4356.00, check_in=d(2026, 9, 1))
    s.add_payment(4356.00, d(2026, 6, 1), "deposit")
    assert s.balance_due() == 0.00
    s.add_payment(500.00, d(2026, 7, 1), "refund")   # stored as -500
    assert s.total_paid() == 3856.00
    assert s.balance_due() == 500.00
    print("PASS: refund reduces paid, balance reopens ($500.00 due)")


def test_summary_shape():
    s = PaymentSchedule(grand_total=4356.00, check_in=d(2026, 9, 1))
    s.add_payment(2178.00, d(2026, 6, 1), "deposit")
    summ = s.summary()
    assert summ["grandTotal"] == 4356.00
    assert summ["depositDue"] == 2178.00
    assert summ["finalDue"] == 2178.00
    assert summ["finalDueDate"] == "2026-08-02"   # 30 days before Sep 1
    assert summ["totalPaid"] == 2178.00
    assert summ["balanceDue"] == 2178.00
    assert summ["paidInFull"] is False
    assert len(summ["payments"]) == 1
    print("PASS: summary dict has all expected fields")


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
