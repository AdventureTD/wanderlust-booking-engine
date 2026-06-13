"""
Wanderlust Booking Engine — external invoice service.

A tiny HTTP service that Wix Velo calls after a booking completes. It:
  1. Authenticates the caller with a shared secret (X-WBE-Secret header).
  2. Builds the Invoice from the posted booking/quote data.
  3. Generates the PDF (reusing the tested reportlab generator).
  4. Sends it via Gmail (info@) to the guest + a copy to info@.
  5. Returns the invoice number + Gmail message id.

Run (dev):  uvicorn invoice_service:app --host 0.0.0.0 --port 8080
Deploy:     any host that runs Python (Cloud Run, Render, Fly, a small VM).

POST /issue-invoice
Body JSON:
{
  "guest": {"name": "...", "email": "...", "phone": "..."},
  "quote_breakdown": { ...output of pricing.Quote.breakdown()... },
  "issue_date": "2026-06-01"   # optional, defaults to today
}
Header: X-WBE-Secret: <shared secret>
"""

import os
import tempfile
from datetime import date

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from booking_engine.invoice import Guest, Invoice
from booking_engine.invoice_pdf import render_invoice_pdf
from booking_engine.invoice_number import next_invoice_number
from booking_engine.report import build_report_record
from booking_engine import gmail_sender
from booking_engine.drive_uploader import upload_invoice_pdf

SHARED_SECRET = os.environ.get("WBE_SHARED_SECRET", "")

app = FastAPI(title="Wanderlust Invoice Service")


class GuestIn(BaseModel):
    name: str
    email: str
    phone: str


class IssueRequest(BaseModel):
    guest: GuestIn
    quote_breakdown: dict
    issue_date: str | None = None
    check_in: str | None = None
    check_out: str | None = None
    room_code: str = ""
    send_email: bool = True


@app.get("/health")
def health():
    return {"status": "ok"}


class RecomputeRequest(BaseModel):
    """Recompute totals for an edited reservation. The caller (Velo) sends the
    full current quote_breakdown (rebuilt from the edited rooms/packages via
    pricing.web.js's buildQuote) plus guest + dates; we return a fresh report
    record. No email, no new invoice number — keeps the existing invoice #."""
    guest: GuestIn
    quote_breakdown: dict
    invoice_number: str
    check_in: str
    check_out: str
    room_code: str = ""
    date_booked: str | None = None
    status: str | None = None


@app.post("/recompute")
def recompute(req: RecomputeRequest, x_wbe_secret: str = Header(default="")):
    if not SHARED_SECRET or x_wbe_secret != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Bad or missing X-WBE-Secret")
    from datetime import date as _date
    try:
        guest = Guest(name=req.guest.name, email=req.guest.email,
                      phone=req.guest.phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid guest: {e}")
    db = _date.fromisoformat(req.date_booked[:10]) if req.date_booked else _date.today()
    rec = build_report_record(
        guest=guest, invoice_number=req.invoice_number,
        quote_breakdown=req.quote_breakdown,
        check_in=_date.fromisoformat(req.check_in[:10]),
        check_out=_date.fromisoformat(req.check_out[:10]),
        date_booked=db, room_code=req.room_code,
    )
    out = rec.to_dict()
    if req.status:
        out["status"] = req.status
    return {"report_record": out}


@app.post("/issue-invoice")
def issue_invoice(req: IssueRequest, x_wbe_secret: str = Header(default="")):
    if not SHARED_SECRET or x_wbe_secret != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Bad or missing X-WBE-Secret")

    try:
        guest = Guest(name=req.guest.name, email=req.guest.email,
                      phone=req.guest.phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid guest: {e}")

    issue = date.fromisoformat(req.issue_date) if req.issue_date else date.today()
    invoice_number = next_invoice_number()

    inv = Invoice.from_quote(invoice_number, issue, guest, req.quote_breakdown)

    # Build the reporting record (returned so Velo can log it to the Bookings
    # collection). check_in/check_out default to issue date if not supplied.
    from datetime import date as _date
    ci = _date.fromisoformat(req.check_in[:10]) if req.check_in else issue
    co = _date.fromisoformat(req.check_out[:10]) if req.check_out else issue
    report = build_report_record(
        guest=guest, invoice_number=invoice_number,
        quote_breakdown=req.quote_breakdown,
        check_in=ci, check_out=co, date_booked=issue, room_code=req.room_code,
    )

    # Generate the PDF to a temp file.
    pdf_path = os.path.join(tempfile.gettempdir(), f"{invoice_number}.pdf")
    render_invoice_pdf(inv, pdf_path)

    # Upload PDF to Google Drive and get a shareable URL.
    try:
        invoice_url = upload_invoice_pdf(pdf_path, invoice_number)
    except Exception as e:
        # Drive upload failure is not fatal — invoice number and email still work.
        invoice_url = ""
        import logging
        logging.warning(f"Drive upload failed for {invoice_number}: {e}")

    result = {"invoice_number": invoice_number,
              "total": inv.total, "pdf_path": pdf_path, "emailed": False,
              "pdf_filename": f"{invoice_number}.pdf",
              "invoice_url": invoice_url,
              "issue_date": issue.isoformat(),
              "report_record": report.to_dict()}

    if req.send_email:
        try:
            sent = gmail_sender.send_invoice_email(
                to_email=guest.email, guest_name=guest.name,
                invoice_number=invoice_number, pdf_path=pdf_path,
                total_str=f"${inv.total:,.2f} {inv.currency}",
            )
            result["emailed"] = True
            result["gmail_message_id"] = sent.get("gmail_message_id")
        except Exception as e:
            # Don't lose the invoice if email fails; report it clearly.
            result["email_error"] = str(e)
    return result
