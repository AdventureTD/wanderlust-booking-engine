"""Email attachments replace invoice-number-only public PDF downloads."""

from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import invoice_service


@pytest.mark.parametrize("suffix", ["", "/", "?download=true"])
@pytest.mark.parametrize("secret", [None, "invalid", "synthetic-test-secret"])
def test_retired_download_never_discloses_existing_pdf(tmp_path, monkeypatch, suffix, secret):
    number = "SYNTHETIC-SECURITY-TEST-NOT-A-REAL-INVOICE"
    content = b"%PDF-1.4\n% SYNTHETIC TEST ONLY - NO GUEST DATA\n%%EOF\n"
    (tmp_path / f"{number}.pdf").write_bytes(content)
    monkeypatch.setattr(invoice_service.tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(invoice_service, "SHARED_SECRET", "synthetic-test-secret")
    headers = {} if secret is None else {"X-WBE-Secret": secret}

    with TestClient(invoice_service.app) as client:
        response = client.get(f"/download/{number}{suffix}", headers=headers)

    assert (response.status_code, content in response.content) == (404, False)
    assert "application/pdf" not in response.headers.get("content-type", "")
    assert "content-disposition" not in response.headers
    assert number not in response.text
    assert str(tmp_path) not in response.text


@pytest.fixture
def issue_context(tmp_path, monkeypatch):
    from unittest.mock import Mock

    # Keep real routing, auth, Invoice/report construction, PDF rendering and
    # BackgroundTasks execution. Isolate delivery ports and local file storage.
    monkeypatch.setattr(invoice_service, "SHARED_SECRET", "synthetic-test-secret")
    monkeypatch.setattr(invoice_service.tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setenv("WBE_INVOICE_RENDERER", "reportlab")
    email = Mock(return_value={"id": "synthetic-no-email-sent"})
    calendar = Mock(return_value={"status": "synthetic-no-calendar-write"})
    monkeypatch.setattr(invoice_service.gmail_sender, "send_invoice_email", email)
    monkeypatch.setattr(invoice_service, "create_calendar_event", calendar)
    payload = {
        "guest": {"name": "SYNTHETIC TEST ONLY", "email": "synthetic@example.invalid", "phone": "0000000000"},
        "invoice_number": "SYNTHETIC-ISSUE-NOT-A-REAL-INVOICE",
        "issue_date": "2099-01-01",
        "check_in": "2099-02-01",
        "check_out": "2099-02-02",
        "quote_breakdown": {
            "line_items": [{"label": "SYNTHETIC TEST STAY", "tax_class": "accommodation",
                            "quantity": 1, "unit_price": 100, "net": 100,
                            "vat_rate": 0.1, "vat": 10, "gross": 110}],
            "subtotal_net": 100, "total_vat": 10, "property_fee": 5,
            "currency": "USD",
        },
    }
    return payload, email, calendar, tmp_path


@pytest.mark.parametrize("send_email,owner_only", [(True, False), (True, True), (False, False)])
def test_issue_invoice_keeps_generation_and_attachment_scheduling_without_public_url(issue_context, send_email, owner_only):
    payload, email, calendar, tmp_path = issue_context
    payload.update(send_email=send_email, owner_only=owner_only)
    with TestClient(invoice_service.app) as client:
        response = client.post("/issue-invoice", json=payload,
                               headers={"X-WBE-Secret": "synthetic-test-secret"})

    assert response.status_code == 200
    result = response.json()
    pdf_path = tmp_path / f"{payload['invoice_number']}.pdf"
    assert pdf_path.read_bytes().startswith(b"%PDF-")
    assert result["invoice_number"] == payload["invoice_number"]
    assert result["pdf_path"] == str(pdf_path)
    assert result["pdf_filename"] == pdf_path.name
    assert result["renderer"] == "reportlab"
    assert result["total"] == 115
    assert result["report_record"]["grandTotal"] == 115
    assert result["issue_date"] == payload["issue_date"]
    assert result["emailed"] == ("scheduled" if send_email else False)
    if send_email:
        email.assert_called_once_with(
            to_email=payload["guest"]["email"], guest_name=payload["guest"]["name"],
            invoice_number=payload["invoice_number"], pdf_path=str(pdf_path),
            total_str="$115.00 USD", owner_only=owner_only,
        )
    else:
        email.assert_not_called()
    assert result["calendar"] == "scheduled"
    calendar.assert_called_once_with(guest_name=payload["guest"]["name"],
                                     check_in=payload["check_in"], check_out=payload["check_out"])
    assert result["invoice_url"] == ""


@pytest.mark.parametrize("configured_secret,header", [("synthetic-test-secret", None),
                                                       ("synthetic-test-secret", "invalid"),
                                                       ("", "synthetic-test-secret")])
def test_issue_invoice_still_requires_configured_shared_secret(issue_context, monkeypatch, configured_secret, header):
    payload, email, calendar, tmp_path = issue_context
    monkeypatch.setattr(invoice_service, "SHARED_SECRET", configured_secret)
    headers = {} if header is None else {"X-WBE-Secret": header}
    with TestClient(invoice_service.app) as client:
        response = client.post("/issue-invoice", json=payload, headers=headers)
    assert response.status_code == 401
    assert not list(tmp_path.glob("*.pdf"))
    email.assert_not_called()
    calendar.assert_not_called()
