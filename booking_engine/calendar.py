"""
Wanderlust Booking Engine — Calendar integration.

Posts to a Google Apps Script webhook that creates calendar events.
Uses the same shared-secret pattern as the invoice service.
"""

import json
import re
import os
import urllib.error
import urllib.parse
import urllib.request

CALENDAR_WEB_APP_URL = os.environ.get("WBE_CALENDAR_WEB_APP_URL", "")
CALENDAR_SECRET = os.environ.get("WBE_CALENDAR_SECRET", "")


class _CancellationContentRedirect(urllib.request.HTTPRedirectHandler):
    """Permit only Google's one-time ContentService response GET, never POST replay."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        destination = urllib.parse.urlsplit(newurl)
        if (req.get_method() != "POST" or code not in (301, 302, 303)
                or destination.scheme != "https"
                or "#" in newurl or "#" in headers.get("Location", "")
                or destination.netloc != "script.googleusercontent.com"):
            raise urllib.error.HTTPError(req.full_url, code, "Redirect denied", headers, fp)
        # Fresh request deliberately carries neither original headers nor secret body.
        return urllib.request.Request(newurl, method="GET")

    def http_error_302(self, req, fp, code, msg, headers):
        # Do not use the inherited handler: it drains fp.read() without a cap.
        # Close the response even on rejection, before any successor is opened.
        try:
            successor = self.redirect_request(
                req, fp, code, msg, headers, headers.get("Location", ""))
        finally:
            fp.close()
        return self.parent.open(successor, timeout=req.timeout)

    http_error_301 = http_error_302
    http_error_303 = http_error_302
    http_error_307 = http_error_302
    http_error_308 = http_error_302


def reconcile_calendar_cancellation(booking_number: str) -> dict:
    if not re.fullmatch(r"WC-[0-9]+", booking_number):
        return {"status": "INVALID_REQUEST"}
    if not CALENDAR_SECRET or not CALENDAR_WEB_APP_URL.startswith("https://script.google.com/macros/s/"):
        return {"status": "UNSENT_CONFIGURATION"}
    payload = {"action": "cancel", "bookingNumber": booking_number, "secret": CALENDAR_SECRET}
    req = urllib.request.Request(CALENDAR_WEB_APP_URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        opener = urllib.request.build_opener(_CancellationContentRedirect())
        with opener.open(req, timeout=15) as response:
            raw = response.read(16385)
        if len(raw) > 16384:
            return {"status": "UNKNOWN"}
        result = json.loads(raw)
        if (result.get("status") == "CANCELLED" and result.get("bookingNumber") == booking_number
                and result.get("disposition") == "DELETED"
                and type(result.get("deletionVersion")) is int and result["deletionVersion"] == 1
                and isinstance(result.get("calendarId"), str) and result["calendarId"]
                and isinstance(result.get("eventId"), str) and result["eventId"]):
            return {"status": "CANCELLED", "booking_number": booking_number, "event_id": result["eventId"],
                    "calendar_id": result["calendarId"], "disposition": "DELETED", "deletion_version": 1}
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
