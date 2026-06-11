"""
Wanderlust Booking Engine — editable reservation + recompute.

A Reservation bundles everything a guest booked (one or more rooms plus
optional a la carte extras) plus guest + dates. When the admin edits it
(change dates, add a room, add an extra), call recompute() to rebuild the
full pricing Quote and a fresh report record so all taxes/totals are correct.

This is the single place that turns "what the guest has" into "the numbers",
so an edit can never leave stale totals behind.

NOTE (2026-06-03): the old PackageItem / add_package() have been REMOVED.
The new model uses a single Adventure Package rate per night (see
package_pricing.py). A la carte extras (ExtraItem / add_extra) remain.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional

from .pricing import Quote
from .seasonal import RateCalendar
from .report import build_report_record
from .status import (
    effective_status, CONFIRMED, CANCELLED, PENDING_CONFIRMATION,
)


@dataclass
class RoomStay:
    room_code: str
    check_in: date
    check_out: date
    guests: int = None          # None -> base occupancy, no extra-guest charge
    locked_nightly_rate: float = None   # snapshot; set when rates are frozen


@dataclass
class ExtraItem:
    code: str
    quantity: float = 1
    price: float = None


@dataclass
class Reservation:
    invoice_number: str
    guest: object               # booking_engine.invoice.Guest
    rooms: List[RoomStay] = field(default_factory=list)
    extras: List[ExtraItem] = field(default_factory=list)
    date_booked: date = None
    status: str = CONFIRMED
    rate_calendar: Optional[RateCalendar] = None
    original_check_in: date = None   # set when first booked; anchors the 2-yr rule
    rates_locked: bool = False       # True once snapshot_rates() has run

    # ---- mutations (admin edits) ----
    def add_room(self, room_code, check_in, check_out, guests=None):
        self.rooms.append(RoomStay(room_code, check_in, check_out, guests))

    def change_room_dates(self, index, check_in, check_out):
        self.rooms[index].check_in = check_in
        self.rooms[index].check_out = check_out

    def add_extra(self, code, quantity=1, price=None):
        self.extras.append(ExtraItem(code, quantity, price))

    def cancel(self):
        self.status = CANCELLED

    # ---- postpone / reinstate at locked rates ----
    def snapshot_rates(self):
        """
        Freeze each room's nightly rate at the CURRENT (original) pricing, so a
        later postponement can be repriced at these locked rates regardless of
        season/base-rate changes. Also records the original check-in for the
        2-year window. Call this when the booking is first confirmed.
        """
        cal = self.rate_calendar or RateCalendar()
        from .rooms import get_room
        from .room_pricing import get_base_rate
        for r in self.rooms:
            if r.locked_nightly_rate is None:
                room = get_room(r.room_code)
                nights = (r.check_out - r.check_in).days
                base = get_base_rate(r.room_code, nights)
                if base is None:
                    raise ValueError(
                        f"No rate defined for {room.name} at {nights} nights."
                    )
                if self.rate_calendar:
                    # Use the season rate for the original check-in night.
                    rate, _ = cal.rate_for_night(r.room_code, r.check_in,
                                                 base)
                else:
                    rate = base
                r.locked_nightly_rate = rate
        if self.original_check_in is None:
            ci, _ = self.span()
            self.original_check_in = ci
        self.rates_locked = True

    def postpone(self):
        """Guest postpones (illness/injury). Lock rates if not already, then
        set status to Pending Confirmation (excluded from revenue)."""
        if not self.rates_locked:
            self.snapshot_rates()
        self.status = PENDING_CONFIRMATION

    def within_two_years(self, new_check_in: date) -> bool:
        """Is the new check-in within 2 years of the ORIGINAL check-in?"""
        anchor = self.original_check_in or self.span()[0]
        if anchor is None:
            return True
        # 2 years = same date two years later (handles leap years via try).
        try:
            limit = anchor.replace(year=anchor.year + 2)
        except ValueError:  # Feb 29 -> Feb 28
            limit = anchor.replace(year=anchor.year + 2, day=28)
        return new_check_in <= limit

    def reinstate(self, new_dates, enforce_two_year=True):
        """
        Reinstate a postponed booking to new dates at the LOCKED rates.
        new_dates: list of (check_in, check_out) tuples, one per room (in the
        same order as self.rooms). Status returns to Confirmed.
        Returns a dict: {ok, warnings, two_year_ok}.
        """
        if len(new_dates) != len(self.rooms):
            raise ValueError(
                f"Expected {len(self.rooms)} (check_in, check_out) pair(s), "
                f"got {len(new_dates)}."
            )
        if not self.rates_locked:
            # Nothing to lock against — snapshot current as a fallback.
            self.snapshot_rates()

        warnings = []
        first_new_ci = min(ci for ci, _ in new_dates)
        two_year_ok = self.within_two_years(first_new_ci)
        if not two_year_ok:
            msg = (f"New check-in {first_new_ci} is MORE than 2 years after the "
                   f"original {self.original_check_in}.")
            if enforce_two_year:
                raise ValueError(msg + " Reinstatement blocked (set "
                                 "enforce_two_year=False to override).")
            warnings.append(msg + " (override allowed)")

        for r, (ci, co) in zip(self.rooms, new_dates):
            if co <= ci:
                raise ValueError(f"check_out {co} must be after check_in {ci}")
            r.check_in = ci
            r.check_out = co
        self.status = CONFIRMED
        return {"ok": True, "warnings": warnings, "two_year_ok": two_year_ok}

    # ---- derived ----
    def span(self):
        """Overall check-in (earliest) and check-out (latest) across rooms."""
        if not self.rooms:
            return None, None
        ci = min(r.check_in for r in self.rooms)
        co = max(r.check_out for r in self.rooms)
        return ci, co

    def current_status(self, today=None):
        ci, co = self.span()
        if ci is None:
            return self.status
        return effective_status(ci, co, stored_status=self.status, today=today)

    def build_quote(self) -> Quote:
        q = Quote()
        cal = self.rate_calendar or RateCalendar()
        for r in self.rooms:
            nights = (r.check_out - r.check_in).days
            if r.locked_nightly_rate is not None:
                # Locked (postponed/reinstated): price all nights at the snapshot
                # nightly rate, ignoring current seasonal/base rates.
                q.add_room(r.room_code, nights, nightly_rate=r.locked_nightly_rate,
                           guests=r.guests)
            elif self.rate_calendar:
                q.add_room_seasonal(r.room_code, r.check_in, r.check_out, cal,
                                    guests=r.guests)
            else:
                q.add_room(r.room_code, nights, guests=r.guests)
        for e in self.extras:
            q.add_extra(e.code, e.quantity, e.price)
        return q

    def recompute(self):
        """
        Rebuild the quote + report record from current components. Call after
        any edit. Returns (quote_breakdown, report_record_dict).
        """
        ci, co = self.span()
        q = self.build_quote()
        bd = q.breakdown()
        rec = build_report_record(
            guest=self.guest, invoice_number=self.invoice_number,
            quote_breakdown=bd, check_in=ci, check_out=co,
            date_booked=self.date_booked or date.today(),
            room_code=",".join(r.room_code for r in self.rooms),
        )
        rec_dict = rec.to_dict()
        # Stamp the current status onto the record.
        rec_dict["status"] = self.current_status()
        return bd, rec_dict
