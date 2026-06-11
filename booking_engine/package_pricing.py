"""
Wanderlust Booking Engine — NEW package-pricing model (replaces the old
room-rate + separate-packages + extra-guest model as of 2026-06-02).

UPDATED 2026-06-03: the per-night rate now comes from the RoomPricing
collection (keyed by room_code + nights) rather than a single fixed price on
the room. Everything else is unchanged — the 50/50 split, dual VAT, property
fee, and extra-guest logic all work the same with the looked-up rate.

Each room type has ONE all-in "Adventure Package" price per night, looked up
from the RoomPricing collection by (room_code, nights). For a stay:

  total_package_price = nights * base_rate_per_night  (from RoomPricing)

That total is split 50/50 for tax:
  - Accommodation       = 50%  -> 10% VAT
  - Adventure Package   = 50%  -> 15% VAT

  grand_total = total_package_price + VAT(accommodation) + VAT(adventure)

This module is self-contained and does NOT use the old packages/a-la-carte/
extra-guest logic. Tax rates are read at compute time via get_tax_rate().
"""

from dataclasses import dataclass
from datetime import date

from .catalog import get_tax_rate
from .rooms import get_room
from .room_pricing import get_base_rate

ACCOMMODATION = "accommodation"   # 10%
ADVENTURE = "standard"            # 15% (the "Adventure Package" tax class)

# Default accommodation share of the package total (the rest goes to the
# Adventure Package). 0.50 = 50/50. This is a DEFAULT; the live value is an
# editable admin setting (Wix `Settings` collection, key "accommodationShare").
DEFAULT_ACCOMMODATION_SHARE = 0.50

# Default property fee rate, charged on the NET package price (pre-VAT) and shown
# BELOW the VAT taxes. 0.05 = 5%. Editable admin setting (Settings key
# "propertyFeeRate"). The fee is NOT itself taxed.
DEFAULT_PROPERTY_FEE_RATE = 0.05


def _r2(x: float) -> float:
    return round(x + 1e-9, 2)


@dataclass
class PackageQuote:
    room_code: str
    room_name: str
    nights: int
    package_price_per_night: float

    # totals
    total_package_price: float
    accommodation_net: float
    adventure_net: float
    vat_accommodation: float        # 10%
    vat_adventure: float            # 15%
    total_vat: float
    grand_total: float
    property_fee_rate: float = 0.0  # e.g. 0.05
    property_fee: float = 0.0       # 5% of net package price, below VAT, untaxed
    currency: str = "USD"

    def breakdown(self) -> dict:
        return {
            "currency": self.currency,
            "room_code": self.room_code,
            "room_name": self.room_name,
            "nights": self.nights,
            "package_price_per_night": self.package_price_per_night,
            "total_package_price": self.total_package_price,
            "line_items": [
                {
                    "label": f"Accommodation ({self.room_name})",
                    "tax_class": ACCOMMODATION,
                    "vat_rate": get_tax_rate(ACCOMMODATION),
                    "net": self.accommodation_net,
                    "vat": self.vat_accommodation,
                    "gross": _r2(self.accommodation_net + self.vat_accommodation),
                },
                {
                    "label": f"Adventure Package ({self.room_name})",
                    "tax_class": ADVENTURE,
                    "vat_rate": get_tax_rate(ADVENTURE),
                    "net": self.adventure_net,
                    "vat": self.vat_adventure,
                    "gross": _r2(self.adventure_net + self.vat_adventure),
                },
            ],
            "subtotal_net": _r2(self.accommodation_net + self.adventure_net),
            "vat_by_class": {
                f"accommodation ({int(get_tax_rate('accommodation')*100)}%)": self.vat_accommodation,
                f"standard ({int(get_tax_rate('standard')*100)}%)": self.vat_adventure,
            },
            "total_vat": self.total_vat,
            "property_fee_rate": self.property_fee_rate,
            "property_fee": self.property_fee,
            "total": self.grand_total,
        }


def quote_package(room_code: str, nights: int,
                  package_price_per_night: float = None,
                  guests: int = None,
                  accommodation_share: float = None,
                  property_fee_rate: float = None) -> PackageQuote:
    """
    Build a PackageQuote for `nights` nights of a room's Adventure Package.

    Rate lookup (2026-06-03 change):
    - If package_price_per_night is explicitly passed, use that (override).
    - Otherwise, look up (room_code, nights) in the RoomPricing catalog.
    - If no rate is found, raise ValueError (room not available at that length).

    Extra-guest charge: for guests beyond base occupancy, each extra guest adds
    1/3 of the base per-night rate per night. That extra amount is added to the
    total BEFORE the split, so it's taxed 10%/15% like the rest of the package.

    accommodation_share: the fraction of the total taxed as accommodation (10%);
    the remainder is the Adventure Package (15%). Defaults to
    DEFAULT_ACCOMMODATION_SHARE (0.50 = 50/50). Editable admin setting.

    property_fee_rate: a fee on NET package price, below VAT, not taxed.
    Defaults to DEFAULT_PROPERTY_FEE_RATE (0.05 = 5%). Editable admin setting.
    """
    if nights < 1:
        raise ValueError("nights must be >= 1")

    share = (DEFAULT_ACCOMMODATION_SHARE if accommodation_share is None
             else accommodation_share)
    if not (0.0 <= share <= 1.0):
        raise ValueError(
            f"accommodation_share must be between 0 and 1; got {share}."
        )

    fee_rate = (DEFAULT_PROPERTY_FEE_RATE if property_fee_rate is None
                else property_fee_rate)
    if not (0.0 <= fee_rate <= 1.0):
        raise ValueError(
            f"property_fee_rate must be between 0 and 1; got {fee_rate}."
        )

    room = get_room(room_code)

    # Rate lookup: explicit override > RoomPricing catalog
    if package_price_per_night is not None:
        ppn = package_price_per_night
    else:
        ppn = get_base_rate(room_code, nights)
        if ppn is None:
            raise ValueError(
                f"No rate defined for {room.name} at {nights} nights. "
                f"Add a row to the RoomPricing collection for this combination."
            )
    if ppn <= 0:
        raise ValueError(f"{room.name} has no Adventure Package price set.")

    # Occupancy validation (no single-guest bookings; cap at max).
    if guests is None:
        guests = room.base_occupancy
    if guests < room.base_occupancy:
        raise ValueError(
            f"{room.name} requires at least {room.base_occupancy} guests "
            f"(no single-guest bookings); requested {guests}."
        )
    if guests > room.max_occupancy:
        raise ValueError(
            f"{room.name} sleeps {room.max_occupancy}; requested {guests}."
        )

    base_total = _r2(nights * ppn)

    # Extra-guest charge = 1/3 of the base per-night rate, per extra guest, per night.
    extra_guests = guests - room.base_occupancy
    extra_per_night = _r2(ppn / 3.0)
    extra_total = _r2(extra_guests * extra_per_night * nights)

    total = _r2(base_total + extra_total)

    # Split by the configured accommodation share. The adventure half is the
    # remainder, so the two always sum back to the total exactly (odd-cent safe).
    accommodation_net = _r2(total * share)
    adventure_net = _r2(total - accommodation_net)

    vat_acc = _r2(accommodation_net * get_tax_rate(ACCOMMODATION))
    vat_adv = _r2(adventure_net * get_tax_rate(ADVENTURE))
    total_vat = _r2(vat_acc + vat_adv)

    # Property fee on the NET package price, added BELOW the VAT lines, untaxed.
    property_fee = _r2(total * fee_rate)

    grand = _r2(total + total_vat + property_fee)

    q = PackageQuote(
        room_code=room_code, room_name=room.name, nights=nights,
        package_price_per_night=ppn,
        total_package_price=total,
        accommodation_net=accommodation_net, adventure_net=adventure_net,
        vat_accommodation=vat_acc, vat_adventure=vat_adv,
        total_vat=total_vat, grand_total=grand,
        property_fee_rate=fee_rate, property_fee=property_fee,
    )
    # attach extra-guest + split detail for display/breakdown
    q.guests = guests
    q.base_total = base_total
    q.extra_guests = extra_guests
    q.extra_per_night = extra_per_night
    q.extra_total = extra_total
    q.accommodation_share = share
    return q
