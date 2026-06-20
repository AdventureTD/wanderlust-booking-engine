"""
Wanderlust Booking Engine — booking report record.

Builds the flat record logged to the Wix `Bookings` collection for reporting.
Exactly the fields the owner requested (2026-06-01):

  guestName, bookingNumber, guestPhone, guestEmail,
  dateBooked, checkInDate, checkOutDate,
  totalVat10  (total 10% VAT — accommodation),
  totalVat15  (total 15% VAT — packages/services),
  totalVat    (totalVat10 + totalVat15),
  accommodationSaleNet  (net sale of all 10% items: room nights + extra guest),
  packageSaleNet        (net sale of all 15% items: packages + a la carte),
  grandTotal            (accommodationSaleNet + packageSaleNet + totalVat)

Sales figures are NET (pre-VAT) — standard for sales reporting (sales reported
separately from tax collected). grandTotal equals the invoice total.
"""

from dataclasses import dataclass, asdict
from datetime import date
from typing import Optional


ACCOMMODATION = "accommodation"   # 10%
STANDARD = "standard"             # 15%


def _r2(x):
    return round(x + 1e-9, 2)


@dataclass
class BookingReportRecord:
    guestName: str
    bookingNumber: str
    guestPhone: str
    guestEmail: str
    dateBooked: str        # ISO date the booking was made
    checkInDate: str       # ISO
    checkOutDate: str      # ISO
    totalVat10: float
    totalVat15: float
    totalVat: float
    accommodationSaleNet: float
    packageSaleNet: float
    grandTotal: float
    propertyFeeRate: float = 0.0
    propertyFee: float = 0.0
    roomCode: str = ""
    currency: str = "USD"
    currentInvoiceNumber: str = ""   # the latest (current) invoice for this booking
    currentInvoiceUrl: str = ""      # convenience: URL of the current invoice PDF

    def to_dict(self):
        return asdict(self)


def build_report_record(*, guest, invoice_number: str, quote_breakdown: dict,
                        check_in: date, check_out: date,
                        date_booked: Optional[date] = None,
                        room_code: str = "") -> BookingReportRecord:
    """
    Derive all reporting fields from a pricing Quote.breakdown() dict.
    Splits net sales and VAT by tax class so the 10%/15% buckets are exact.
    Includes the property fee (below VAT, untaxed) in the grand total.
    """
    date_booked = date_booked or date.today()

    acc_net = 0.0
    std_net = 0.0
    vat10 = 0.0
    vat15 = 0.0
    for li in quote_breakdown["line_items"]:
        if li["tax_class"] == ACCOMMODATION:
            acc_net += li["net"]
            vat10 += li["vat"]
        elif li["tax_class"] == STANDARD:
            std_net += li["net"]
            vat15 += li["vat"]
        else:
            raise ValueError(f"Unexpected tax_class: {li['tax_class']}")

    acc_net = _r2(acc_net)
    std_net = _r2(std_net)
    vat10 = _r2(vat10)
    vat15 = _r2(vat15)
    total_vat = _r2(vat10 + vat15)
    property_fee = _r2(quote_breakdown.get("property_fee", 0.0))
    property_fee_rate = quote_breakdown.get("property_fee_rate", 0.0)
    grand = _r2(acc_net + std_net + total_vat + property_fee)

    return BookingReportRecord(
        guestName=guest.name,
        bookingNumber=invoice_number,
        guestPhone=guest.phone,
        guestEmail=guest.email,
        dateBooked=date_booked.isoformat(),
        checkInDate=check_in.isoformat(),
        checkOutDate=check_out.isoformat(),
        totalVat10=vat10,
        totalVat15=vat15,
        totalVat=total_vat,
        accommodationSaleNet=acc_net,
        packageSaleNet=std_net,
        grandTotal=grand,
        propertyFeeRate=property_fee_rate,
        propertyFee=property_fee,
        roomCode=room_code,
        currency=quote_breakdown.get("currency", "USD"),
    )
