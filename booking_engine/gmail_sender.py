"""
Wanderlust Booking Engine — Gmail sender (Gmail API, OAuth gmail.send).

Sends the invoice PDF as an attachment, FROM info@wanderlustcaribbean.com,
TO the guest and a copy to info@wanderlustcaribbean.com.

Why Gmail API (not SMTP): no stored password, sends as the real mailbox,
reliable deliverability. Reuses the same Google Cloud project/OAuth client as
the Drive integration, but needs its own token with the gmail.send scope.

Token: ~/.hermes/gmail_token.json (separate from the Drive token).
Build the email MIME first (testable without a token), then send.
"""

import os
import json
import base64
from email.message import EmailMessage

GMAIL_TOKEN_PATH = os.environ.get("GMAIL_TOKEN_PATH", os.path.expanduser("~/.hermes/gmail_token.json"))
GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send"]
SENDER = "info@wanderlustcaribbean.com"
BCC_COPY = "info@wanderlustcaribbean.com"


def _first_name(full_name: str) -> str:
    """Return the first whitespace-delimited word of the guest's full name."""
    if not full_name:
        return full_name
    first = full_name.split()[0]
    return first if first else full_name


def build_invoice_email(to_email: str, guest_name: str, invoice_number: str,
                        pdf_path: str, total_str: str,
                        owner_only: bool = False) -> EmailMessage:
    """Assemble the MIME email with the PDF attached. No network — pure build."""
    msg = EmailMessage()
    msg["From"] = f"Wanderlust Caribbean <{SENDER}>"
    if owner_only:
        msg["To"] = BCC_COPY
        msg["Subject"] = f"Internal copy — Wanderlust Caribbean Invoice {invoice_number}"
        body_prefix = (
            f"This is an internal copy of invoice {invoice_number} for {guest_name}.\n\n"
        )
    else:
        msg["To"] = to_email
        # Send a copy to the hotel. Use a visible CC so the hotel copy is obvious.
        msg["Cc"] = BCC_COPY
        msg["Subject"] = f"Your Wanderlust Caribbean Invoice {invoice_number}"
        body_prefix = f"Dear {_first_name(guest_name)},\n\n"

    body = (
        body_prefix +
        "Thank you for booking your adventure with Wanderlust Caribbean.\n"
        f"Your invoice {invoice_number} is attached as a PDF.\n\n"
        f"Total: {total_str}\n\n"
        "We can't wait to host you on the Nature Island.\n"
        "Come as guests, leave as friends.\n\n"
        "Wanderlust Caribbean\n"
        "Pt. Dubique, Calibishie, Dominica\n"
        "980-934-1813 | info@wanderlustcaribbean.com\n"
        "wanderlustcaribbean.com\n"
    )
    msg.set_content(body)

    with open(pdf_path, "rb") as f:
        pdf_bytes = f.read()
    fname = f"Wanderlust Caribbean Invoice - {invoice_number}.pdf"
    msg.add_attachment(pdf_bytes, maintype="application", subtype="pdf",
                       filename=fname)
    return msg


class _CancellationHttp:
    """Single-attempt Gmail transport; no httplib2 or auth-response replay."""
    def __init__(self, credentials):
        import requests
        self.credentials = credentials
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.mount('https://', requests.adapters.HTTPAdapter(max_retries=0))

    def request(self, uri, method='GET', body=None, headers=None, **kwargs):
        from google.auth.transport.requests import Request
        import httplib2
        headers = dict(headers or {})
        # Refresh, if necessary, BEFORE Gmail POST. Never refresh/replay on 401.
        self.credentials.before_request(Request(session=self.session), method, uri, headers)
        response = self.session.request(method, uri, data=body, headers=headers,
                                       timeout=(10, 30), allow_redirects=False)
        try:
            return httplib2.Response(dict(response.headers, status=str(response.status_code))), response.content
        finally:
            response.close()

    def close(self):
        self.session.close()


def _gmail_service(cancellation=False):
    """Build an authorized Gmail API client from the stored token."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    if not os.path.exists(GMAIL_TOKEN_PATH):
        raise FileNotFoundError(
            f"Gmail token not found at {GMAIL_TOKEN_PATH}. Run the Gmail "
            "authorization step first (see INVOICING_EMAIL.md)."
        )
    with open(GMAIL_TOKEN_PATH) as token_file:
        tok = json.load(token_file)
    creds = Credentials(
        token=tok.get("token"), refresh_token=tok.get("refresh_token"),
        token_uri=tok.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=tok["client_id"], client_secret=tok["client_secret"],
        scopes=GMAIL_SCOPES,
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        tok["token"] = creds.token
        with open(GMAIL_TOKEN_PATH, "w") as fh:
            json.dump(tok, fh, indent=2)
    if cancellation:
        return build("gmail", "v1", http=_CancellationHttp(creds), static_discovery=True)
    return build("gmail", "v1", credentials=creds)


def build_cancellation_email(to_email: str, guest_name: str, booking_number: str,
                             check_in: str, check_out: str, rooms_desc: str,
                             reason: str = "") -> EmailMessage:
    """Assemble a plain-text cancellation email. No network — pure build."""
    msg = EmailMessage()
    msg["From"] = f"Wanderlust Caribbean <{SENDER}>"
    msg["To"] = to_email
    msg["Cc"] = BCC_COPY
    msg["Subject"] = f"Wanderlust Caribbean — Booking {booking_number} Cancelled"

    reason_block = f"Reason: {reason}\n\n" if reason else ""
    body = (
        f"Dear {guest_name},\n\n"
        f"Your booking {booking_number} with Wanderlust Caribbean has been cancelled.\n\n"
        f"Original stay: {check_in} to {check_out}\n"
        f"Rooms: {rooms_desc}\n\n"
        f"{reason_block}"
        "If you have already made a payment and are due a refund under our "
        "cancellation policy, we will process it separately and confirm by email.\n\n"
        "We're sorry to miss you this time — we hope to host you on the Nature "
        "Island another day.\n"
        "Come as guests, leave as friends.\n\n"
        "Wanderlust Caribbean\n"
        "Pt. Dubique, Calibishie, Dominica\n"
        "980-934-1813 | info@wanderlustcaribbean.com\n"
        "wanderlustcaribbean.com\n"
    )
    msg.set_content(body)
    return msg


def send_cancellation_email(to_email: str, guest_name: str, booking_number: str,
                            check_in: str, check_out: str, rooms_desc: str,
                            reason: str = "") -> dict:
    """Build + send the cancellation email via Gmail API."""
    msg = build_cancellation_email(to_email, guest_name, booking_number,
                                   check_in, check_out, rooms_desc, reason)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service = _gmail_service(cancellation=True)
    sent = service.users().messages().send(
        userId="me", body={"raw": raw}).execute(num_retries=0)
    if not isinstance(sent, dict) or not isinstance(sent.get("id"), str) or not sent["id"]:
        raise RuntimeError("Cancellation send receipt missing; reconcile before retry")
    return {"gmail_message_id": sent.get("id"),
            "to": to_email, "cc": BCC_COPY,
            "booking_number": booking_number}


def send_invoice_email(to_email: str, guest_name: str, invoice_number: str,
                       pdf_path: str, total_str: str,
                       owner_only: bool = False) -> dict:
    """Build + send the invoice email via Gmail API. Returns the Gmail response."""
    msg = build_invoice_email(to_email, guest_name, invoice_number,
                              pdf_path, total_str, owner_only=owner_only)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service = _gmail_service()
    sent = service.users().messages().send(
        userId="me", body={"raw": raw}).execute()
    return {"gmail_message_id": sent.get("id"),
            "to": BCC_COPY if owner_only else to_email,
            "cc": None if owner_only else BCC_COPY,
            "invoice_number": invoice_number,
            "owner_only": owner_only}
