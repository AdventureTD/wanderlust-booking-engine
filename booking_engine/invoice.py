"""
Wanderlust Booking Engine — Guest contact + invoice data models.

Captures guest contact info during booking (name, phone, email) with light
validation, and defines the Invoice structure that the PDF generator renders.

BUSINESS DETAILS below are PLACEHOLDERS the owner must confirm — per the
project's no-fabrication rule, do NOT treat these as real until the owner
supplies them:
  - TAX_ID
  - LOGO_PATH / LOGO_URL
  - business address (Calibishie address line)
  - invoice number format
"""

import os
import re
from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional


# ---------------------------------------------------------------------------
# Business identity for the invoice header.
# CONFIRMED by owner 2026-06-01.
# ---------------------------------------------------------------------------
BUSINESS = {
    "legal_name": "Wanderlust Caribbean",
    "address_lines": [
        "Pt. Dubique, Calibishie",
        "Dominica",
    ],
    "phone": "980-934-1813",
    "email": "info@wanderlustcaribbean.com",
    "website": "wanderlustcaribbean.com",
    "tax_id": "1051705",
    # Logo pulled from Google Drive (1_Primary_logo.jpg).
    # In the live Wix deployment, the logo is stored in Wix Media and its URL
    # is stored as logo_media_url in the business record. Here, use a local path
    # relative to this module (works both locally and on Render).
    "logo_path": os.environ.get(
        "WBE_LOGO_PATH",
        os.path.join(os.path.dirname(__file__), "..", "assets", "wanderlust_logo.jpg"),
    ),
}

# Where invoice copies go.
WANDERLUST_INVOICE_EMAIL = "info@wanderlustcaribbean.com"

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass
class Guest:
    name: str
    email: str
    phone: str

    def __post_init__(self):
        if not self.name or not self.name.strip():
            raise ValueError("Guest name is required.")
        if not _EMAIL_RE.match(self.email or ""):
            raise ValueError(f"Invalid email: {self.email!r}")
        digits = re.sub(r"\D", "", self.phone or "")
        if len(digits) < 7:
            raise ValueError(f"Phone number looks invalid: {self.phone!r}")


@dataclass
class InvoiceLine:
    label: str
    tax_class: str       # "accommodation" (10%) | "standard" (15%)
    quantity: float
    unit_price: float
    net: float
    vat_rate: float
    vat: float
    gross: float


@dataclass
class Invoice:
    invoice_number: str
    issue_date: date
    guest: Guest
    lines: List[InvoiceLine]
    subtotal_net: float
    vat_by_class: dict          # {"accommodation": x, "standard": y}
    total_vat: float
    total: float
    property_fee_rate: float = 0.0   # e.g. 0.05 (shown below VAT)
    property_fee: float = 0.0        # amount, below VAT, untaxed
    currency: str = "USD"
    business: dict = field(default_factory=lambda: dict(BUSINESS))
    notes: str = ""

    @classmethod
    def from_quote(cls, invoice_number: str, issue_date: date, guest: Guest,
                   quote_breakdown: dict) -> "Invoice":
        """Build an Invoice from a Quote.breakdown() or package_pricing
        breakdown() dict. Handles both shapes (the package breakdown has no
        quantity/unit_price on its line items)."""
        # Use display_line_items if present (one row per room, no VAT columns).
        # Fall back to line_items for backward compatibility.
        display_items = quote_breakdown.get("display_line_items", quote_breakdown["line_items"])
        lines = [
            InvoiceLine(
                label=li["label"], tax_class=li.get("tax_class", "standard"),
                quantity=li.get("quantity", 1), unit_price=li.get("unit_price", li["net"]),
                net=li["net"], vat_rate=li["vat_rate"], vat=li["vat"],
                gross=li["gross"],
            )
            for li in display_items
        ]
        # Prefer pre-computed vat_by_class if available; otherwise compute from line_items.
        raw_vbc = quote_breakdown.get("vat_by_class")
        if raw_vbc is None:
            raw_vbc = {}
            for li in quote_breakdown["line_items"]:
                tax_cls = li.get("tax_class", "standard")
                raw_vbc[tax_cls] = round(raw_vbc.get(tax_cls, 0.0) + li["vat"], 2)
        # Invoice total = subtotal_net + total_vat (property fee is shown separately)
        # Wix may send 'total' as grand total including property fee, so we
        # recalculate to avoid double-counting.
        invoice_total = quote_breakdown.get("subtotal_net", 0) + quote_breakdown.get("total_vat", 0)
        return cls(
            invoice_number=invoice_number, issue_date=issue_date, guest=guest,
            lines=lines, subtotal_net=quote_breakdown["subtotal_net"],
            vat_by_class=raw_vbc, total_vat=quote_breakdown["total_vat"],
            total=invoice_total,
            property_fee_rate=quote_breakdown.get("property_fee_rate", 0.0),
            property_fee=quote_breakdown.get("property_fee", 0.0),
            currency=quote_breakdown.get("currency", "USD"),
        )
