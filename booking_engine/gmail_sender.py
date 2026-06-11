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

GMAIL_TOKEN_PATH = os.path.expanduser("~/.hermes/gmail_token.json")
GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send"]
SENDER = "info@wanderlustcaribbean.com"
BCC_COPY = "info@wanderlustcaribbean.com"


def build_invoice_email(to_email: str, guest_name: str, invoice_number: str,
                        pdf_path: str, total_str: str) -> EmailMessage:
    """Assemble the MIME email with the PDF attached. No network — pure build."""
    msg = EmailMessage()
    msg["From"] = f"Wanderlust Caribbean <{SENDER}>"
    msg["To"] = to_email
    # Send a copy to the hotel. Use a visible CC so the hotel copy is obvious.
    msg["Cc"] = BCC_COPY
    msg["Subject"] = f"Your Wanderlust Caribbean Invoice {invoice_number}"

    body = (
        f"Dear {guest_name},\n\n"
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
    fname = os.path.basename(pdf_path)
    msg.add_attachment(pdf_bytes, maintype="application", subtype="pdf",
                       filename=fname)
    return msg


def _gmail_service():
    """Build an authorized Gmail API client from the stored token."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    if not os.path.exists(GMAIL_TOKEN_PATH):
        raise FileNotFoundError(
            f"Gmail token not found at {GMAIL_TOKEN_PATH}. Run the Gmail "
            "authorization step first (see INVOICING_EMAIL.md)."
        )
    tok = json.load(open(GMAIL_TOKEN_PATH))
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
    return build("gmail", "v1", credentials=creds)


def send_invoice_email(to_email: str, guest_name: str, invoice_number: str,
                       pdf_path: str, total_str: str) -> dict:
    """Build + send the invoice email via Gmail API. Returns the Gmail response."""
    msg = build_invoice_email(to_email, guest_name, invoice_number,
                              pdf_path, total_str)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service = _gmail_service()
    sent = service.users().messages().send(
        userId="me", body={"raw": raw}).execute()
    return {"gmail_message_id": sent.get("id"),
            "to": to_email, "cc": BCC_COPY,
            "invoice_number": invoice_number}
