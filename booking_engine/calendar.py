"""
Wanderlust Booking Engine — Calendar integration.

Posts to a Google Apps Script webhook that creates calendar events.
Uses the same shared-secret pattern as the invoice service.
"""

import json
import re
import os
import urllib.request

CALENDAR_WEB_APP_URL = os.environ.get("WBE_CALENDAR_WEB_APP_URL", "")
CALENDAR_SECRET = os.environ.get("WBE_CALENDAR_SECRET", "")


def reconcile_calendar_cancellation(booking_number: str) -> dict:
    if not re.fullmatch(r"WC-[0-9]+", booking_number):
        return {"status": "INVALID_REQUEST"}
    if not CALENDAR_SECRET or not CALENDAR_WEB_APP_URL.startswith("https://script.google.com/macros/s/"):
        return {"status": "UNSENT_CONFIGURATION"}
    payload = {"action": "cancel", "bookingNumber": booking_number, "secret": CALENDAR_SECRET}
    req = urllib.request.Request(CALENDAR_WEB_APP_URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read(16385)
        if len(raw) > 16384:
            return {"status": "UNKNOWN"}
        result = json.loads(raw)
        if result.get("status") == "CANCELLED" and result.get("bookingNumber") == booking_number and isinstance(result.get("eventId"), str) and result["eventId"]:
            return {"status": "CANCELLED", "booking_number": booking_number, "event_id": result["eventId"]}
        return {"status": "NEEDS_RECONCILIATION" if result.get("status") == "NEEDS_RECONCILIATION" else "UNKNOWN"}
    except Exception:
        return {"status": "UNKNOWN"}


def create_calendar_event(guest_name: str, check_in: str, check_out: str, booking_number: str | None = None) -> dict:
    """
    Create an all-day Google Calendar event from check-in to check-out.

    Args:
        guest_name: e.g. "John Smith"
        check_in: ISO date string e.g. "2026-06-01"
        check_out: ISO date string e.g. "2026-06-05"

    Returns:
        {"ok": True, "eventId": "..."} or {"ok": False, "error": "...", "_diagnostics": {...}}
    """
    _diag = {
        "url_present": bool(CALENDAR_WEB_APP_URL),
        "secret_present": bool(CALENDAR_SECRET),
        "url_length": len(CALENDAR_WEB_APP_URL or ""),
    }
    if not CALENDAR_WEB_APP_URL or not CALENDAR_SECRET:
        return {
            "ok": False,
            "error": "WBE_CALENDAR_WEB_APP_URL or WBE_CALENDAR_SECRET not configured",
            "_diagnostics": _diag,
        }

    payload = {
        "secret": CALENDAR_SECRET,
        "summary": f"Wanderlust Caribbean Booking: {guest_name}",
        "description": f"Wanderlust Booking: {guest_name}",
        "startDate": check_in,
        "endDate": check_out,
    }
    if booking_number:
        payload["bookingNumber"] = booking_number
    _diag["payload_sent"] = {k: v for k, v in payload.items() if k != "secret"}
    _diag["payload_secret_present"] = bool(payload.get("secret"))

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        CALENDAR_WEB_APP_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw_body = resp.read().decode("utf-8")
            _diag["http_status"] = resp.status
            _diag["raw_response"] = raw_body[:500]
            result = json.loads(raw_body)
            _diag["parsed_response"] = result
            if result.get("status") == "created":
                return {"ok": True, "eventId": result.get("eventId"), "_diagnostics": _diag}
            return {
                "ok": False,
                "error": result.get("message", "Unknown response from calendar webhook"),
                "_diagnostics": _diag,
            }
    except Exception as e:
        _diag["exception"] = str(e)
        return {"ok": False, "error": str(e), "_diagnostics": _diag}
