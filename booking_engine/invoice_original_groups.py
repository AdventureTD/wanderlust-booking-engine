"""Disconnected original-group arithmetic projection, NOT accepted-record authority.

No transport, catalog access, pricing decisions or payment reads belong here.
One composite line retains each original group; it is not a tax-base subline.
"""
from datetime import date
from decimal import Decimal

from booking_engine.invoice import Guest, Invoice

_COMPONENTS = (
    "grossCents", "discountCents", "roomTotalCents", "propertyFeeCents",
    "accommodationVatCents", "packageVatCents", "grandTotalCents",
)
_LABELS = {
    "adventure_suite": "Adventure Suite",
    "penthouse_apartment": "Penthouse Apartment",
    "two_bedroom_apartment": "Two Bedroom Apartment",
}


_MAX = 2**53 - 1


def _require(condition):
    if not condition:
        raise ValueError("Invalid original-group invoice input")


def _record(value, keys):
    _require(type(value) is dict)
    _require(all(type(key) is str for key in value))
    _require(value.keys() == set(keys))


def _integer(value, minimum=0, maximum=_MAX):
    _require(type(value) is int and minimum <= value <= maximum)


def _validate_result(result):
    _record(result, ("v", "currency", "rounding", "groups", "totals"))
    _integer(result["v"], 1, 1)
    _require(type(result["currency"]) is str and result["currency"] == "USD")
    _require(type(result["rounding"]) is str and result["rounding"] == "original-group-backend-v1")
    groups, totals = result["groups"], result["totals"]
    _require(type(groups) is list and 1 <= len(groups) <= 4)
    _record(totals, (*_COMPONENTS, "totalVatCents", "totalRooms", "totalGuests"))
    for value in totals.values():
        _integer(value)
    sums = dict.fromkeys(_COMPONENTS, 0)
    counts = dict.fromkeys(_LABELS, 0)
    total_guests = 0
    for index, group in enumerate(groups):
        _record(group, ("index", "roomCode", "quantity", "guests", *_COMPONENTS))
        _integer(group["index"], index, index)
        code, quantity, guests = group["roomCode"], group["quantity"], group["guests"]
        _require(type(code) is str and code in _LABELS)
        _integer(quantity, 1, 4)
        _integer(guests, 3 if code == "two_bedroom_apartment" else 2,
                 4 if code == "two_bedroom_apartment" else 2)
        counts[code] += quantity
        total_guests += quantity * guests
        for key in _COMPONENTS:
            _integer(group[key])
            sums[key] += group[key]
            _integer(sums[key])
        _require(group["grossCents"] == group["discountCents"] + group["roomTotalCents"])
        _require(group["grandTotalCents"] == group["roomTotalCents"] + group["propertyFeeCents"]
                 + group["accommodationVatCents"] + group["packageVatCents"])
    _require(sum(counts.values()) <= 4 and counts["adventure_suite"] <= 3
             and counts["penthouse_apartment"] <= 1 and counts["two_bedroom_apartment"] <= 1)
    _require(totals["totalRooms"] == sum(counts.values()) and totals["totalGuests"] == total_guests)
    _require(all(totals[key] == sums[key] for key in _COMPONENTS))
    _require(totals["totalVatCents"] == sums["accommodationVatCents"] + sums["packageVatCents"])


def _text(value, maximum, *, empty=False):
    _require(type(value) is str and len(value) <= maximum and (empty or bool(value.strip())))
    _require(all(char not in "<>&" and char.isprintable() for char in value))


def _validate_display(invoice_number, issue_date, guest, display):
    _text(invoice_number, 64)
    _require(type(issue_date) is date and type(guest) is Guest)
    for value, maximum in ((guest.name, 256), (guest.email, 254), (guest.phone, 64)):
        _text(value, maximum)
    _record(display, ("nights", "check_in", "check_out", "package_title", "promo_code"))
    _integer(display["nights"], 1)
    dates = []
    for key in ("check_in", "check_out"):
        value = display[key]
        _text(value, 10)
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            raise ValueError("Invalid original-group invoice date") from None
        _require(parsed.isoformat() == value)
        dates.append(parsed)
    _require((dates[1] - dates[0]).days == display["nights"])
    _text(display["package_title"], 256, empty=True)
    _text(display["promo_code"], 256, empty=True)


def invoice_from_original_groups(result, *, invoice_number, issue_date, guest, display):
    """Build an actual explicit Invoice from internal numerical facts and display context.

    Caller provenance is not authenticated. This function must remain disconnected
    until a separate accepted-context integration and payment-read gate is reviewed.
    """
    _validate_result(result)
    _validate_display(invoice_number, issue_date, guest, display)
    totals = result["totals"]
    cents = {key: totals[key] for key in (*_COMPONENTS, "totalVatCents")}
    money = lambda amount: Decimal(amount) / 100
    lines = []
    for group in result["groups"]:
        net = group["roomTotalCents"]
        vat = group["accommodationVatCents"] + group["packageVatCents"]
        lines.append(dict(label=_LABELS[group["roomCode"]], tax_class="mixed",
                          quantity=display["nights"], room_quantity=group["quantity"],
                          unit_price=None, vat_rate=None, net=money(net),
                          vat=money(vat), gross=money(net + vat)))
    quote = dict(line_items=lines, subtotal_net=money(totals["roomTotalCents"]),
                 property_fee=money(totals["propertyFeeCents"]),
                 total_vat=money(totals["totalVatCents"]), total=money(totals["grandTotalCents"]),
                 promo_discount_amount=money(totals["discountCents"]),
                 vat_by_class=dict(accommodation=money(totals["accommodationVatCents"]),
                                   standard=money(totals["packageVatCents"])),
                 currency="USD", total_guests=totals["totalGuests"],
                 check_in=display["check_in"], check_out=display["check_out"],
                 package_title=display["package_title"], promo_code=display["promo_code"])
    return Invoice.from_quote(invoice_number, issue_date,
                              Guest(guest.name, guest.email, guest.phone),
                              quote, component_cents=cents)
