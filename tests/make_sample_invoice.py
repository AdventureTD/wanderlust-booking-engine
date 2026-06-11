"""Generate a real sample invoice PDF from a realistic booking, to verify
the whole chain works: Quote -> breakdown -> Invoice -> PDF."""

from datetime import date
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from booking_engine.seasonal import RateCalendar, RateRule
from booking_engine.pricing import Quote
from booking_engine.invoice import Guest, Invoice
from booking_engine.invoice_pdf import render_invoice_pdf


def d(y, m, day):
    return date(y, m, day)

# Realistic booking: Two-Bedroom, 7 nights crossing into high season, 4 guests,
# plus a la carte extras.
cal = RateCalendar()
cal.add_rule("two_bedroom_apartment", RateRule(
    "High Season", d(2026, 12, 15), d(2027, 4, 15), 1500.0, priority=10))

q = Quote()
bd_room = q.add_room_seasonal("two_bedroom_apartment",
                              d(2026, 12, 13), d(2026, 12, 20), cal, guests=4)
q.add_extra("private_chef", quantity=4, price=2820.0)
q.add_extra("canyoning", quantity=1, price=250.0)

breakdown = q.breakdown()

guest = Guest(name="Jim & Sandy Evans",
              email="jim.sandy@example.com",
              phone="+1 555 012 3456")

inv = Invoice.from_quote(
    invoice_number="WBE-INV-0001",
    issue_date=date(2026, 6, 1),
    guest=guest,
    quote_breakdown=breakdown,
)

out = "/home/wanderlust/wanderlust-booking-engine/sample_invoice.pdf"
render_invoice_pdf(inv, out)

print("Invoice totals:")
print(f"  Subtotal net: ${inv.subtotal_net:,.2f}")
for k, v in inv.vat_by_class.items():
    print(f"  VAT {k}: ${v:,.2f}")
print(f"  Total VAT:    ${inv.total_vat:,.2f}")
print(f"  TOTAL:        ${inv.total:,.2f}")
print(f"  Line items:   {len(inv.lines)}")
print(f"PDF written: {out}")
