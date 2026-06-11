"""
Wanderlust Booking Engine — Pricing & dual-VAT engine.

Tax rules (confirmed by owner 2026-06-01):
  - Accommodation (room nights): 10% VAT
  - Everything else (adventure services, a la carte extras): 15% VAT

VAT here is treated as ADDED ON TOP of the listed price (tax-exclusive
pricing), which is the safe default for a booking quote. If the owner's
listed prices are meant to already INCLUDE VAT, flip `prices_include_vat`
to True and the engine back-computes the net + tax instead.

All money is rounded to 2 dp only at the line level, then summed, to avoid
penny drift. Returns a fully itemized quote so the guest sees the breakdown.

NOTE (2026-06-03): the old Packages (Sampler/Explorer/Wanderluster)
add_package() method has been REMOVED. A la carte extras (add_extra) remain.
The new pricing model uses package_pricing.py (Adventure Package per-night
rate, 50/50 split). This Quote class is still used by the Reservation module
for seasonal pricing and a la carte extras.
"""

from dataclasses import dataclass, field
from typing import List, Dict

from .catalog import get_tax_rate, CatalogItem, get_a_la_carte
from .rooms import get_room
from .room_pricing import get_base_rate as _lookup_rate


def _round2(x: float) -> float:
    # round-half-up to cents
    return float(f"{x:.2f}")


@dataclass
class LineItem:
    label: str
    tax_class: str
    quantity: float
    unit_price: float

    @property
    def net(self) -> float:
        return _round2(self.quantity * self.unit_price)

    def vat(self, prices_include_vat: bool = False) -> float:
        rate = get_tax_rate(self.tax_class)
        if prices_include_vat:
            gross = self.quantity * self.unit_price
            net = gross / (1 + rate)
            return _round2(gross - net)
        return _round2(self.net * rate)

    def gross(self, prices_include_vat: bool = False) -> float:
        if prices_include_vat:
            return _round2(self.quantity * self.unit_price)
        return _round2(self.net + self.vat(prices_include_vat))


@dataclass
class Quote:
    line_items: List[LineItem] = field(default_factory=list)
    prices_include_vat: bool = False

    def add(self, label, tax_class, quantity, unit_price):
        self.line_items.append(LineItem(label, tax_class, quantity, unit_price))

    # ---- room ----
    def add_room(self, room_code: str, nights: int, nightly_rate: float = None,
                 guests: int = None):
        room = get_room(room_code)
        if nightly_rate is not None:
            rate = nightly_rate
        else:
            rate = _lookup_rate(room_code, nights)
            if rate is None:
                raise ValueError(
                    f"No rate defined for {room.name} at {nights} nights."
                )
        self.add(f"{room.name} ({nights} night(s))", "accommodation", nights, rate)
        self._add_extra_guests(room, nights, guests)

    def add_room_seasonal(self, room_code, check_in, check_out, rate_calendar,
                          base_rate: float = None, guests: int = None):
        """
        Add accommodation lines using a RateCalendar, one line per season run.
        Each night is priced at its season's rate; accommodation is taxed at 10%.
        Extra guests beyond base occupancy are charged per night (also 10%).
        Returns the seasonal breakdown dict for display.
        """
        room = get_room(room_code)
        if base_rate is not None:
            base = base_rate
        else:
            nights_count = (check_out - check_in).days
            base = _lookup_rate(room_code, nights_count)
            if base is None:
                raise ValueError(
                    f"No rate defined for {room.name} at {nights_count} nights."
                )
        bd = rate_calendar.price_stay(room_code, check_in, check_out, base)
        for g in bd["grouped"]:
            label = f"{room.name} — {g['season']} ({g['nights']} night(s) @ ${g['rate']:.2f})"
            self.add(label, "accommodation", g["nights"], g["rate"])
        self._add_extra_guests(room, bd["nights"], guests)
        return bd

    def _add_extra_guests(self, room, nights: int, guests: int):
        """Add an accommodation line for guests beyond base occupancy."""
        if not guests:
            return
        if guests < room.base_occupancy:
            raise ValueError(
                f"{room.name} requires at least {room.base_occupancy} guests "
                f"(no single-guest bookings); requested {guests}."
            )
        if guests > room.max_occupancy:
            raise ValueError(
                f"{room.name} sleeps {room.max_occupancy}; requested {guests}."
            )
        extra = guests - room.base_occupancy
        if extra > 0 and room.extra_guest_fee > 0:
            # extra guests x nights, at the per-guest-per-night fee
            self.add(
                f"{room.name} — extra guest x{extra} ({nights} night(s) @ "
                f"${room.extra_guest_fee:.2f})",
                "accommodation", extra * nights, room.extra_guest_fee,
            )

    # ---- a la carte ----
    def add_extra(self, code: str, quantity: float = 1, price: float = None):
        item = get_a_la_carte(code)
        self.add(item.name, item.tax_class, quantity,
                 item.price if price is None else price)

    # ---- totals ----
    def subtotal_net(self) -> float:
        if self.prices_include_vat:
            return _round2(sum(li.gross(True) - li.vat(True) for li in self.line_items))
        return _round2(sum(li.net for li in self.line_items))

    def vat_by_class(self) -> Dict[str, float]:
        out = {}
        for li in self.line_items:
            out[li.tax_class] = _round2(
                out.get(li.tax_class, 0.0) + li.vat(self.prices_include_vat)
            )
        return out

    def total_vat(self) -> float:
        return _round2(sum(self.vat_by_class().values()))

    def total(self) -> float:
        return _round2(self.subtotal_net() + self.total_vat())

    def breakdown(self) -> dict:
        return {
            "currency": "USD",
            "prices_include_vat": self.prices_include_vat,
            "line_items": [
                {
                    "label": li.label,
                    "tax_class": li.tax_class,
                    "vat_rate": get_tax_rate(li.tax_class),
                    "quantity": li.quantity,
                    "unit_price": li.unit_price,
                    "net": li.net if not self.prices_include_vat
                           else _round2(li.gross(True) - li.vat(True)),
                    "vat": li.vat(self.prices_include_vat),
                    "gross": li.gross(self.prices_include_vat),
                }
                for li in self.line_items
            ],
            "subtotal_net": self.subtotal_net(),
            "vat_by_class": {
                f"{k} ({int(get_tax_rate(k)*100)}%)": v
                for k, v in self.vat_by_class().items()
            },
            "total_vat": self.total_vat(),
            "total": self.total(),
        }
