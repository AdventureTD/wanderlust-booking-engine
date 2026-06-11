"""
Wanderlust Booking Engine — reservation status lifecycle.

Statuses:
  Confirmed   — set when the booking is made
  In-House    — guest has checked in (today >= check_in and < check_out)
  Checked-Out — today >= check_out
  Cancelled   — manually set; sticky (never auto-changes), excluded from revenue

Design: status is computed from dates so it's ALWAYS correct when viewed
(effective_status), AND a daily job writes the stored value so reports are
accurate. Cancelled is sticky — once cancelled, it stays cancelled regardless
of dates.
"""

from datetime import date

CONFIRMED = "Confirmed"
IN_HOUSE = "In-House"
CHECKED_OUT = "Checked-Out"
CANCELLED = "Cancelled"
PENDING_CONFIRMATION = "Pending Confirmation"
BLOCKED = "Blocked"

ALL_STATUSES = [CONFIRMED, IN_HOUSE, CHECKED_OUT, CANCELLED, PENDING_CONFIRMATION, BLOCKED]

# Statuses that count toward revenue in reports.
REVENUE_STATUSES = {CONFIRMED, IN_HOUSE, CHECKED_OUT}

# Statuses that are "sticky" — they override date-based transitions and are NOT
# advanced by the daily job (admin must move them manually).
STICKY_STATUSES = {CANCELLED, PENDING_CONFIRMATION, BLOCKED}


def effective_status(check_in: date, check_out: date,
                     stored_status: str = None, today: date = None) -> str:
    """
    Return the correct status for a booking given today's date.
    Sticky statuses (Cancelled, Pending Confirmation) override date logic.
    """
    if stored_status in STICKY_STATUSES:
        return stored_status
    today = today or date.today()
    if today >= check_out:
        return CHECKED_OUT
    if today >= check_in:
        return IN_HOUSE
    return CONFIRMED


def counts_as_revenue(status: str) -> bool:
    return status in REVENUE_STATUSES
