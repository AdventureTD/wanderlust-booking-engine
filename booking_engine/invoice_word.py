"""Word-template invoice rendering for Wanderlust Caribbean.

Populates ``invoice_template.docx`` with an existing :class:`Invoice` and
produces an intermediate DOCX. PDF conversion is handled separately so the
context and template can be tested without LibreOffice.
"""

from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any
from zipfile import ZipFile

from docxtpl import DocxTemplate
from jinja2 import Environment, StrictUndefined

from booking_engine.invoice import Invoice

MAX_ROOMS = 5
MAX_PAYMENTS = 4
DEFAULT_TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "invoice_template.docx"


def _money(value: Any, *, exact: bool = False) -> str:
    amount = Decimal(str(value or 0)) if exact else float(value or 0)
    if amount < 0:
        return f"-${abs(amount):,.2f}"
    return f"${amount:,.2f}"


def _quantity(value: Any) -> str:
    amount = float(value or 0)
    return f"{amount:g}"


def build_invoice_context(inv: Invoice) -> dict[str, Any]:
    """Build the strict ``docxtpl`` context for one invoice.

    Oversized bookings are rejected instead of silently omitting financially
    relevant room or payment rows from the invoice.
    """
    room_quantity_total = sum(float(line.room_quantity or 0) for line in inv.lines)
    if len(inv.lines) > MAX_ROOMS or room_quantity_total > MAX_ROOMS:
        raise ValueError(
            f"Invoice supports a maximum of {MAX_ROOMS} rooms; "
            f"received {room_quantity_total:g} across {len(inv.lines)} rows"
        )
    if len(inv.payments) > MAX_PAYMENTS:
        raise ValueError(f"Invoice supports a maximum of {MAX_PAYMENTS} payments; received {len(inv.payments)}")

    rooms = [
        {
            "name": line.label,
            "quantity": _quantity(line.room_quantity),
            "nights": _quantity(line.quantity),
        }
        for line in inv.lines
    ]

    explicit_vat = inv.explicit_vat_amounts()
    if explicit_vat is not None:
        # Format the validated integer projection, never reconstructed floats.
        amounts = {key: Decimal(value) / 100 for key, value in inv._component_cents.items()}
    payments = []
    total_paid = Decimal(0) if explicit_vat is not None else 0.0
    for payment in inv.payments:
        raw_amount = payment.get("paymentAmount") or payment.get("amount") or 0
        amount = Decimal(str(raw_amount)) if explicit_vat is not None else float(raw_amount)
        total_paid += amount
        payments.append({
            "date": str(payment.get("datePaid") or payment.get("date") or ""),
            "amount": _money(amount, exact=explicit_vat is not None),
        })

    if explicit_vat is None:
        subtotal = float(inv.subtotal_net or 0)
        accommodation_net = subtotal * float(inv.accommodation_allocation or 0)
        services_net = subtotal * float(inv.services_allocation or 0)
        accommodation_vat = accommodation_net * 0.10
        services_vat = services_net * 0.15
    remaining_balance = (amounts["grandTotalCents"] - total_paid
                         if explicit_vat is not None else round(float(inv.total or 0) - total_paid, 2))
    business = inv.business or {}

    return {
        "business_name": business.get("legal_name", ""),
        "business_address": "\n".join(business.get("address_lines") or []),
        "business_phone": business.get("phone", ""),
        "business_email": business.get("email", ""),
        "business_website": business.get("website", ""),
        "tax_id": business.get("tax_id", ""),
        "invoice_number": inv.invoice_number,
        "issue_date": inv.issue_date.strftime("%B %d, %Y"),
        "currency": inv.currency,
        "guest_name": inv.guest.name,
        "guest_email": inv.guest.email,
        "guest_phone": inv.guest.phone,
        "check_in": inv.check_in,
        "check_out": inv.check_out,
        "package_title": inv.package_title,
        "total_guests": _quantity(inv.total_guests),
        "subtotal_net": _money(amounts["roomTotalCents"], exact=True) if explicit_vat is not None else _money(inv.subtotal_net),
        "total_vat": _money(amounts["totalVatCents"], exact=True) if explicit_vat is not None else _money(inv.total_vat),
        "property_fee": _money(amounts["propertyFeeCents"], exact=True) if explicit_vat is not None else _money(inv.property_fee),
        "total_due": _money(amounts["grandTotalCents"], exact=True) if explicit_vat is not None else _money(inv.total),
        "accommodation_vat_formula": (
            _money(explicit_vat[0], exact=True) if explicit_vat is not None else
            f"{_money(accommodation_net)} * 10% = {_money(accommodation_vat)}"
        ),
        "services_vat_formula": (
            _money(explicit_vat[1], exact=True) if explicit_vat is not None else
            f"{_money(services_net)} * 15% = {_money(services_vat)}"
        ),
        "remaining_balance": _money(remaining_balance, exact=explicit_vat is not None),
        "rooms": rooms,
        "payments": payments,
    }


def _assert_no_template_tokens(docx_path: Path) -> None:
    """Fail when rendered Word XML still contains Jinja delimiters."""
    with ZipFile(docx_path) as archive:
        for name in archive.namelist():
            if not name.endswith(".xml"):
                continue
            data = archive.read(name)
            if b"{{" in data or b"{%" in data or b"{#" in data:
                raise ValueError(f"Unrendered template token remains in {name}")


def render_invoice_docx(
    inv: Invoice,
    out_path: str | Path,
    template_path: str | Path = DEFAULT_TEMPLATE_PATH,
) -> str:
    """Populate the editable Word template and return the output path."""
    template = Path(template_path)
    output = Path(out_path)
    if not template.exists():
        raise FileNotFoundError(f"Invoice Word template not found: {template}")

    output.parent.mkdir(parents=True, exist_ok=True)
    doc = DocxTemplate(str(template))
    jinja_env = Environment(undefined=StrictUndefined, autoescape=True)
    doc.render(build_invoice_context(inv), jinja_env)
    doc.save(str(output))
    _assert_no_template_tokens(output)
    return str(output)


def find_libreoffice() -> str | None:
    """Return the configured or installed LibreOffice executable."""
    configured = os.environ.get("LIBREOFFICE_PATH", "").strip()
    candidates = [
        configured,
        shutil.which("soffice") or "",
        shutil.which("libreoffice") or "",
    ]
    if os.name == "nt":
        candidates.extend([
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        ])
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate))
    return None


def render_invoice_word_pdf(
    inv: Invoice,
    out_path: str | Path,
    template_path: str | Path = DEFAULT_TEMPLATE_PATH,
) -> str:
    """Render the Word template and convert it to a real PDF."""
    executable = find_libreoffice()
    if not executable:
        raise RuntimeError(
            "LibreOffice is required for Word invoice PDF conversion; "
            "set LIBREOFFICE_PATH or install soffice"
        )

    output = Path(out_path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="wbe-word-invoice-") as temp_dir_name:
        temp_dir = Path(temp_dir_name).resolve()
        docx_path = temp_dir / f"{output.stem}.docx"
        profile_dir = temp_dir / "libreoffice-profile"
        profile_dir.mkdir()
        render_invoice_docx(inv, docx_path, template_path)

        command = [
            executable,
            "--headless",
            f"-env:UserInstallation={profile_dir.as_uri()}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(temp_dir),
            str(docx_path),
        ]
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=90,
        )
        converted = temp_dir / f"{output.stem}.pdf"
        if completed.returncode != 0 or not converted.exists():
            details = (completed.stderr or completed.stdout or "no output").strip()
            raise RuntimeError(
                f"LibreOffice invoice conversion failed ({completed.returncode}): {details}"
            )
        if converted.stat().st_size < 1000 or not converted.read_bytes().startswith(b"%PDF"):
            raise RuntimeError("LibreOffice produced an invalid invoice PDF")
        shutil.copy2(converted, output)
    return str(output)
