"""
Wanderlust Booking Engine — Calendar integration.

Posts to a Google Apps Script webhook that creates calendar events.
Uses the same shared-secret pattern as the invoice service.
"""

import json
import os
import urllib.request

CALENDAR_WEB_APP_URL = os.environ.get("WBE_CALENDAR_WEB_APP_URL", "")
CALENDAR_SECRET = os.environ.get("WBE_CALENDAR_SECRET", "")


def _post_calendar_payload(payload: dict) -> dict:
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

    payload = dict(payload)
    payload["secret"] = CALENDAR_SECRET
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
            if result.get("status") in ("created", "updated", "deleted", "skipped"):
                return {
                    "ok": True,
                    "status": result.get("status"),
                    "eventId": result.get("eventId", ""),
                    "_diagnostics": _diag,
                }
            return {
                "ok": False,
                "error": result.get("message", "Unknown response from calendar webhook"),
                "_diagnostics": _diag,
            }
    except Exception as e:
        _diag["exception"] = str(e)
        return {"ok": False, "error": str(e), "_diagnostics": _diag}


def create_calendar_event(guest_name: str, check_in: str, check_out: str) -> dict:
    """Create the legacy booking-level all-day event."""
    return _post_calendar_payload({
        "summary": f"Wanderlust Caribbean Booking: {guest_name}",
        "description": f"Wanderlust Booking: {guest_name}",
        "startDate": check_in,
        "endDate": check_out,
    })


def sync_room_calendar_event(*, booking_id: str, booking_number: str,
                             guest_name: str, room_code: str,
                             assigned_room: str, check_in: str,
                             check_out: str, status: str,
                             event_id: str = "", updated_at: str = "") -> dict:
    """Create, update, or delete one room-level calendar event."""
    return _post_calendar_payload({
        "action": "syncRoom",
        "bookingId": booking_id,
        "bookingNumber": booking_number,
        "guestName": guest_name,
        "roomCode": room_code,
        "assignedRoom": assigned_room or "",
        "startDate": check_in,
        "endDate": check_out,
        "status": status,
        "eventId": event_id or "",
        "updatedAt": updated_at or "",
    })
