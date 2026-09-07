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


import pytest


@pytest.mark.parametrize('mode', ['accepted', '401', 'redirect', 'bad_status', 'reset', 'timeout', 'bad_id', 'non_json'])
def test_journal_actual_lower_transport_once(monkeypatch, mode):
    """Real Session/HTTPAdapter/urllib3 retry machinery; socket IO replaced only."""
    import io
    import socket
    import urllib3
    from urllib3.connectionpool import HTTPSConnectionPool
    from urllib3.exceptions import ProtocolError, ReadTimeoutError
    from booking_engine.gmail_sender import send_journal_mime
    calls = []
    def deny_socket(*args, **kwargs):
        raise AssertionError('NETWORK_DENIED')
    monkeypatch.setattr(socket, 'create_connection', deny_socket)
    def lower(self, conn, method, url, **kwargs):
        calls.append((self.host, method, url, kwargs))
        assert kwargs['retries'].total == 0
        assert kwargs['timeout'].connect_timeout == 5
        assert kwargs['timeout'].read_timeout == 30
        if mode == 'reset':
            raise ProtocolError('inert reset')
        if mode == 'timeout':
            raise ReadTimeoutError(self, url, 'inert timeout')
        body = b'{"id":"fixture-exact-lower-ID"}'
        if mode == 'bad_id': body = b'{"id":""}'
        if mode == 'non_json': body = b'not-json'
        return urllib3.response.HTTPResponse(body=io.BytesIO(body), preload_content=False,
            status={'401':401, 'redirect':302, 'bad_status':503}.get(mode, 200),
            headers={'Location': 'https://must-not-follow.invalid/'})
    monkeypatch.setattr(HTTPSConnectionPool, '_make_request', lower)
    if mode == 'accepted':
        assert send_journal_mime(b'fixture MIME', 'inert-token') == 'fixture-exact-lower-ID'
    else:
        with pytest.raises(Exception):
            send_journal_mime(b'fixture MIME', 'inert-token')
    assert len(calls) == 1
    assert calls[0][:3] == ('gmail.googleapis.com', 'POST', '/gmail/v1/users/me/messages/send')
