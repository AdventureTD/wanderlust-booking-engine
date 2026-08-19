"""Tests for invoice email MIME construction."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from booking_engine.gmail_sender import build_invoice_email


def test_invoice_attachment_uses_business_filename(tmp_path):
    pdf = tmp_path / "internal-temp-name.pdf"
    pdf.write_bytes(b"%PDF-test")
    msg = build_invoice_email(
        to_email="guest@example.com",
        guest_name="Test Guest",
        invoice_number="WBE-INV-1234",
        pdf_path=str(pdf),
        total_str="$1,000.00 USD",
    )
    attachments = list(msg.iter_attachments())
    assert len(attachments) == 1
    assert attachments[0].get_filename() == "Wanderlust Caribbean Invoice - WBE-INV-1234.pdf"


def test_completed_booking_email_goes_to_guest_and_copies_hotel(tmp_path):
    pdf = tmp_path / "invoice.pdf"
    pdf.write_bytes(b"%PDF-test")
    msg = build_invoice_email(
        to_email="guest@example.com",
        guest_name="Test Guest",
        invoice_number="WBE-INV-1234",
        pdf_path=str(pdf),
        total_str="$1,000.00 USD",
        owner_only=False,
    )
    assert msg["To"] == "guest@example.com"
    assert msg["Cc"] == "info@wanderlustcaribbean.com"


def test_admin_reissue_email_is_owner_only(tmp_path):
    pdf = tmp_path / "invoice.pdf"
    pdf.write_bytes(b"%PDF-test")
    msg = build_invoice_email(
        to_email="guest@example.com",
        guest_name="Test Guest",
        invoice_number="WBE-INV-1234",
        pdf_path=str(pdf),
        total_str="$1,000.00 USD",
        owner_only=True,
    )
    assert msg["To"] == "info@wanderlustcaribbean.com"
    assert msg["Cc"] is None
