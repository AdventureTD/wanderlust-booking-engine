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
import hashlib
import hmac
import json
import re
import time
from datetime import date
from urllib.parse import quote

from fastapi import FastAPI, Header, HTTPException, BackgroundTasks
from pydantic import BaseModel
from starlette.responses import FileResponse

from booking_engine.invoice import Guest, Invoice
from booking_engine.invoice_renderer import render_invoice_pdf_for_service
from booking_engine.invoice_word import DEFAULT_TEMPLATE_PATH, find_libreoffice
from booking_engine.invoice_number import next_invoice_number
from booking_engine.report import build_report_record
from booking_engine import gmail_sender
from booking_engine.calendar import create_calendar_event, sync_room_calendar_event

SHARED_SECRET = os.environ.get("WBE_SHARED_SECRET", "")

app = FastAPI(title="Wanderlust Invoice Service")


def _valid_invoice_number(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{1,64}", str(value or "")))


def _download_token(invoice_number: str, ttl_seconds: int = 7 * 24 * 60 * 60) -> str:
    expires = int(time.time()) + ttl_seconds
    message = f"{invoice_number}|{expires}".encode("utf-8")
    signature = hmac.new(SHARED_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return f"{expires}.{signature}"


def _download_token_valid(invoice_number: str, token: str) -> bool:
    try:
        expires_text, supplied = str(token or "").split(".", 1)
        expires = int(expires_text)
    except (TypeError, ValueError):
        return False
    if expires < int(time.time()) or not SHARED_SECRET:
        return False
    message = f"{invoice_number}|{expires}".encode("utf-8")
    expected = hmac.new(SHARED_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(supplied, expected)


def _idempotency_paths(key: str):
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    base = os.path.join(tempfile.gettempdir(), f"wbe-invoice-{digest}")
    return base + ".lock", base + ".json"


def _idempotency_begin(key: str):
    if not key:
        return None
    lock_path, result_path = _idempotency_paths(key)
    if os.path.exists(result_path):
        with open(result_path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.close(fd)
        return None
    except FileExistsError:
        if os.path.exists(result_path):
            with open(result_path, "r", encoding="utf-8") as handle:
                return json.load(handle)
        raise HTTPException(status_code=409, detail="Invoice request is already processing")


def _idempotency_complete(key: str, result: dict):
    if not key:
        return
    lock_path, result_path = _idempotency_paths(key)
    temp_path = result_path + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, default=str)
    os.replace(temp_path, result_path)
    try:
        os.remove(lock_path)
    except FileNotFoundError:
        pass



def _bg_send_email(to_email, guest_name, invoice_number, pdf_path, total_str,
                   owner_only=False):
    """Background task for Gmail send."""
    try:
        gmail_sender.send_invoice_email(
            to_email=to_email,
            guest_name=guest_name,
            invoice_number=invoice_number,
            pdf_path=pdf_path,
            total_str=total_str,
            owner_only=owner_only,
        )
        print(f"[WBE-BG] Email sent OK to {to_email} (owner_only={owner_only})")
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
    owner_only: bool = False
    payments: list[dict] | None = None
    booking_number: str | None = None
    room_calendar_sync: bool = False
    idempotency_key: str = ""


class RoomCalendarRequest(BaseModel):
    booking_id: str
    booking_number: str
    guest_name: str
    room_code: str
    assigned_room: str = ""
    check_in: str
    check_out: str
    status: str = "confirmed"
    event_id: str = ""
    updated_at: str = ""


@app.get("/")
def root():
    return {"service": "Wanderlust Invoice Service", "status": "ok"}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "invoice_renderer": os.environ.get("WBE_INVOICE_RENDERER", "word"),
        "libreoffice_available": bool(find_libreoffice()),
        "word_template_available": DEFAULT_TEMPLATE_PATH.exists(),
        "git_commit": os.environ.get("RENDER_GIT_COMMIT", ""),
    }


@app.post("/sync-calendar-room")
def sync_calendar_room(req: RoomCalendarRequest,
                       x_wbe_secret: str = Header(default="")):
    """Create, update, or delete the event for one physical room record."""
    if not SHARED_SECRET or x_wbe_secret != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Bad or missing X-WBE-Secret")
    return sync_room_calendar_event(
        booking_id=req.booking_id,
        booking_number=req.booking_number,
        guest_name=req.guest_name,
        room_code=req.room_code,
        assigned_room=req.assigned_room,
        check_in=req.check_in[:10],
        check_out=req.check_out[:10],
        status=req.status,
        event_id=req.event_id,
        updated_at=req.updated_at,
    )


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
    full current quote_breakdown rebuilt from the active locked-pricing flow,
    plus guest + dates; we return a fresh report record. No email, no new
    invoice number — keeps the existing invoice #."""
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
    cached_result = _idempotency_begin(req.idempotency_key)
    if cached_result is not None:
        cached_result["idempotent_replay"] = True
        return cached_result

    try:
        guest = Guest(name=req.guest.name, email=req.guest.email,
                      phone=req.guest.phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid guest: {e}")

    issue = date.fromisoformat(req.issue_date) if req.issue_date else date.today()
    invoice_number = req.invoice_number or next_invoice_number()
    if not _valid_invoice_number(invoice_number):
        raise HTTPException(status_code=400, detail="Invalid invoice number")

    # Pass payment data through to the invoice renderer if provided.
    if req.payments is not None:
        req.quote_breakdown["payments"] = req.payments
    if req.booking_number:
        req.quote_breakdown["booking_number"] = req.booking_number

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
    renderer_used = render_invoice_pdf_for_service(inv, pdf_path)
    print(f"[WBE-INVOICE] Generated {invoice_number} with renderer={renderer_used}")

    # Build a download URL served by this Render service.
    base_url = os.environ.get("RENDER_EXTERNAL_URL", "https://wanderlust-invoice-service.onrender.com")
    invoice_url = f"{base_url}/download/{invoice_number}?token={quote(_download_token(invoice_number))}"

    result = {"invoice_number": invoice_number,
              "total": inv.total, "pdf_path": pdf_path, "emailed": False,
              "pdf_filename": f"{invoice_number}.pdf",
              "invoice_url": invoice_url,
              "renderer": renderer_used,
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
            owner_only=req.owner_only,
        )
        result["emailed"] = "scheduled"
    else:
        result["emailed"] = False

    # Legacy callers still receive one booking-level event during a staged
    # deployment. Updated Wix code manages one event per physical room.
    if not req.room_calendar_sync and req.check_in and req.check_out and guest.name:
        result["calendar"] = "scheduled"
        background_tasks.add_task(
            _bg_calendar_event,
            guest_name=guest.name,
            check_in=req.check_in[:10],
            check_out=req.check_out[:10],
        )
    elif req.room_calendar_sync:
        result["calendar"] = "room-sync-managed-by-wix"
    else:
        result["calendar"] = "skipped"
        result["calendar_reason"] = "Missing check_in/check_out or guest.name"

    _idempotency_complete(req.idempotency_key, result)
    return result


@app.get("/download/{invoice_number}")
def download_invoice(invoice_number: str, token: str = ""):
    """Serve a temporary PDF only through a signed, expiring URL."""
    if not _valid_invoice_number(invoice_number) or not _download_token_valid(invoice_number, token):
        raise HTTPException(status_code=401, detail="Invalid or expired download token")
    pdf_path = os.path.join(tempfile.gettempdir(), f"{invoice_number}.pdf")
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail=f"Invoice {invoice_number} not found on this server. "
                           "It may have been cleared after a restart. Check your email for the PDF.")
    return FileResponse(pdf_path, media_type="application/pdf",
                        filename=f"{invoice_number}.pdf",
                        content_disposition_type="attachment")
