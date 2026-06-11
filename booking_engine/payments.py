"""
Wanderlust Booking Engine — manual payments + balance due.

Payments are processed manually (outside the system). The admin records each
payment as it arrives. The standard schedule is:
  - Deposit: 50% of grand total, due at booking
  - Final:   50% of grand total, due ~30 days before check-in

But payments are recorded flexibly (amount + date + type + note) so partial
payments, overpayments, and refunds are all handled. Balance due is derived:
  balance_due = grand_total - sum(payments)

Types: 'deposit', 'final', 'other', 'refund' (refund is a negative payment).
"""

from dataclasses import dataclass, field, asdict
from datetime import date, timedelta
from typing import List, Optional


FINAL_DUE_DAYS_BEFORE_CHECKIN = 30
DEPOSIT_FRACTION = 0.50


def _r2(x):
    return round(x + 1e-9, 2)


@dataclass
class Payment:
    amount: float            # positive = payment received; negative = refund
    date: str                # ISO date the payment was recorded
    ptype: str = "other"     # 'deposit' | 'final' | 'other' | 'refund'
    note: str = ""

    def to_dict(self):
        return asdict(self)


@dataclass
class PaymentSchedule:
    """Expected schedule + actual payments + derived balance for one booking."""
    grand_total: float
    check_in: date
    payments: List[Payment] = field(default_factory=list)

    # ---- expected schedule ----
    def deposit_amount(self) -> float:
        return _r2(self.grand_total * DEPOSIT_FRACTION)

    def final_amount(self) -> float:
        # remainder so deposit + final always equals grand_total exactly
        return _r2(self.grand_total - self.deposit_amount())

    def final_due_date(self) -> date:
        return self.check_in - timedelta(days=FINAL_DUE_DAYS_BEFORE_CHECKIN)

    # ---- record ----
    def add_payment(self, amount: float, when: date, ptype: str = "other",
                    note: str = "") -> Payment:
        if ptype not in ("deposit", "final", "other", "refund"):
            raise ValueError(f"Invalid payment type: {ptype}")
        if ptype == "refund" and amount > 0:
            amount = -amount  # store refunds as negative
        p = Payment(amount=_r2(amount), date=when.isoformat(), ptype=ptype,
                    note=note)
        self.payments.append(p)
        return p

    # ---- derived ----
    def total_paid(self) -> float:
        return _r2(sum(p.amount for p in self.payments))

    def balance_due(self) -> float:
        return _r2(self.grand_total - self.total_paid())

    def is_paid_in_full(self) -> bool:
        return self.balance_due() <= 0.0

    def deposit_paid(self) -> float:
        return _r2(sum(p.amount for p in self.payments if p.ptype == "deposit"))

    def final_paid(self) -> float:
        return _r2(sum(p.amount for p in self.payments if p.ptype == "final"))

    def summary(self) -> dict:
        return {
            "grandTotal": _r2(self.grand_total),
            "depositDue": self.deposit_amount(),
            "finalDue": self.final_amount(),
            "finalDueDate": self.final_due_date().isoformat(),
            "totalPaid": self.total_paid(),
            "balanceDue": self.balance_due(),
            "paidInFull": self.is_paid_in_full(),
            "depositPaid": self.deposit_paid(),
            "finalPaid": self.final_paid(),
            "payments": [p.to_dict() for p in self.payments],
        }
