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

from fastapi import FastAPI, Header, HTTPException, BackgroundTasks
from pydantic import BaseModel
from starlette.responses import FileResponse

from booking_engine.invoice import Guest, Invoice
from booking_engine.invoice_pdf import render_invoice_pdf
from booking_engine.invoice_number import next_invoice_number
from booking_engine.report import build_report_record
from booking_engine import gmail_sender
from booking_engine.calendar import create_calendar_event

SHARED_SECRET = os.environ.get("WBE_SHARED_SECRET", "")

app = FastAPI(title="Wanderlust Invoice Service")


def _bg_send_email(to_email, guest_name, invoice_number, pdf_path, total_str):
    """Background task for Gmail send."""
    try:
        gmail_sender.send_invoice_email(
            to_email=to_email,
            guest_name=guest_name,
            invoice_number=invoice_number,
            pdf_path=pdf_path,
            total_str=total_str,
        )
        print(f"[WBE-BG] Email sent OK to {to_email}")
    except Exception as e:
        print(f"[WBE-BG] Email FAILED: {e}")


def _bg_calendar_event(guest_name, check_in, check_out):
    """Background task for Google Calendar event creation."""
    try:
        result = create_calendar_event(
            guest_name=guest_name,
            check_in=check_in,
            check_out=check_out,
        )
        print(f"[WBE-BG] Calendar result: {result}")
    except Exception as e:
        print(f"[WBE-BG] Calendar FAILED: {e}")


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
    invoice_number: str | None = None


@app.get("/health")
def health():
    return {"status": "ok"}


class CancellationEmailRequest(BaseModel):
    guest_name: str
    guest_email: str
    booking_number: str
    check_in: str
    check_out: str
    rooms_desc: str
    reason: str = ""


@app.post("/send-cancellation-email")
def send_cancellation_email(req: CancellationEmailRequest,
                            x_wbe_secret: str = Header(default="")):
    """Send a booking-cancellation email from info@ via Gmail API."""
    if not SHARED_SECRET or x_wbe_secret != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Bad or missing X-WBE-Secret")
    try:
        result = gmail_sender.send_cancellation_email(
            to_email=req.guest_email,
            guest_name=req.guest_name,
            booking_number=req.booking_number,
            check_in=req.check_in,
            check_out=req.check_out,
            rooms_desc=req.rooms_desc,
            reason=req.reason,
        )
        return {"ok": True, **result}
    except Exception as e:
        print(f"[WBE] Cancellation email FAILED for {req.booking_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
async def issue_invoice(req: IssueRequest, background_tasks: BackgroundTasks, x_wbe_secret: str = Header(default="")):
    if not SHARED_SECRET or x_wbe_secret != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Bad or missing X-WBE-Secret")

    try:
        guest = Guest(name=req.guest.name, email=req.guest.email,
                      phone=req.guest.phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid guest: {e}")

    issue = date.fromisoformat(req.issue_date) if req.issue_date else date.today()
    invoice_number = req.invoice_number or next_invoice_number()

    inv = Invoice.from_quote(invoice_number, issue, guest, req.quote_breakdown)

    # Build the reporting record
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

    # Build a download URL served by this Render service.
    base_url = os.environ.get("RENDER_EXTERNAL_URL", "https://wanderlust-invoice-service.onrender.com")
    invoice_url = f"{base_url}/download/{invoice_number}"

    result = {"invoice_number": invoice_number,
              "total": inv.total, "pdf_path": pdf_path, "emailed": False,
              "pdf_filename": f"{invoice_number}.pdf",
              "invoice_url": invoice_url,
              "issue_date": issue.isoformat(),
              "report_record": report.to_dict()}

    # Schedule Gmail send in background — never block the response.
    if req.send_email:
        background_tasks.add_task(
            _bg_send_email,
            to_email=guest.email,
            guest_name=guest.name,
            invoice_number=invoice_number,
            pdf_path=pdf_path,
            total_str=f"${inv.total:,.2f} {inv.currency}",
        )
        result["emailed"] = "scheduled"
    else:
        result["emailed"] = False

    # Schedule Google Calendar event creation in background — never block.
    if req.check_in and req.check_out and guest.name:
        result["calendar"] = "scheduled"
        background_tasks.add_task(
            _bg_calendar_event,
            guest_name=guest.name,
            check_in=req.check_in[:10],
            check_out=req.check_out[:10],
        )
    else:
        result["calendar"] = "skipped"
        result["calendar_reason"] = "Missing check_in/check_out or guest.name"

    return result


@app.get("/calendar-debug")
def calendar_debug():
    """Standalone endpoint to test calendar env vars and connectivity
    without needing a booking payload."""
    import os
    from booking_engine.calendar import CALENDAR_WEB_APP_URL, CALENDAR_SECRET
    return {
        "env_vars_present": {
            "WBE_CALENDAR_WEB_APP_URL": bool(CALENDAR_WEB_APP_URL),
            "WBE_CALENDAR_SECRET": bool(CALENDAR_SECRET),
        },
        "WBE_CALENDAR_WEB_APP_URL_length": len(CALENDAR_WEB_APP_URL or ""),
        "WBE_CALENDAR_SECRET_length": len(CALENDAR_SECRET or ""),
        "sample_event_test": create_calendar_event(
            guest_name="Debug Test",
            check_in="2099-01-01",
            check_out="2099-01-02",
        ),
    }


@app.get("/download/{invoice_number}")
def download_invoice(invoice_number: str):
    """Serve the generated PDF invoice directly from the temp directory.
    Returns 404 if the file is no longer available (e.g. service restarted)."""
    pdf_path = os.path.join(tempfile.gettempdir(), f"{invoice_number}.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail=f"Invoice {invoice_number} not found on this server. "
                           "It may have been cleared after a restart. Check your email for the PDF.")
    return FileResponse(pdf_path, media_type="application/pdf",
                        filename=f"{invoice_number}.pdf",
                        content_disposition_type="attachment")
