
from datetime import date
import sys
sys.path.insert(0, r"C:\Users\TomDe\wanderlust-booking-engine-github-current")
from booking_engine.invoice import Invoice, Guest
from booking_engine.invoice_pdf import render_invoice_pdf

invoice = Invoice.from_quote(
    invoice_number="111",
    issue_date=date(2026, 7, 31),
    guest=Guest(name="Lisa Pierce", email="info@wanderlustcaribbean.com", phone="+19809341813"),
    quote_breakdown={
        "subtotal_net": 8370.00,
        "total_vat": 1046.25,
        "property_fee": 418.50,
        "property_fee_rate": 0.05,
        "currency": "USD",
        "package_title": "10-day Wanderluster Package",
        "check_in": "2026-12-03",
        "check_out": "2026-12-12",
        "total_guests": 2,
        "accommodation_share": 0.5,
        "line_items": [
            {"label": "Penthouse Apartment", "tax_class": "accommodation", "quantity": 9, "unit_price": 930.00, "net": 8370.00, "vat_rate": 0.10, "vat": 418.50, "gross": 8788.50, "room_quantity": 1}
        ],
        "display_line_items": [
            {"label": "Penthouse Apartment", "tax_class": "accommodation", "quantity": 9, "unit_price": 930.00, "net": 8370.00, "vat_rate": 0.10, "vat": 418.50, "gross": 8788.50, "room_quantity": 1}
        ],
        "vat_by_class": {"accommodation": 1046.25},
        "promo_code": "",
        "promo_discount_rate": 0,
        "promo_discount_amount": 0,
        "payments": [
            {"datePaid": "2026-07-31", "paymentAmount": 4917.38},
            {"datePaid": "2026-08-15", "paymentAmount": 4917.37},
        ],
        "booking_number": "WC-111",
    }
)

out_path = r"C:\Users\TomDe\wanderlust-booking-engine-github-current\sample_invoice_111_v2.pdf"
render_invoice_pdf(invoice, out_path)
print("Generated:", out_path)
