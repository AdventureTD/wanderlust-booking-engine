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


def create_calendar_event(guest_name: str, check_in: str, check_out: str) -> dict:
    """
    Create an all-day Google Calendar event from check-in to check-out.

    Args:
        guest_name: e.g. "John Smith"
        check_in: ISO date string e.g. "2026-06-01"
        check_out: ISO date string e.g. "2026-06-05"

    Returns:
        {"ok": True, "eventId": "..."} or {"ok": False, "error": "..."}
    """
    if not CALENDAR_WEB_APP_URL or not CALENDAR_SECRET:
        return {"ok": False, "error": "WBE_CALENDAR_WEB_APP_URL or WBE_CALENDAR_SECRET not configured"}

    payload = {
        "secret": CALENDAR_SECRET,
        "summary": f"Wanderlust: {guest_name}",
        "description": f"Wanderlust Booking: {guest_name}",
        "startDate": check_in,
        "endDate": check_out,
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        CALENDAR_WEB_APP_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            if result.get("status") == "created":
                return {"ok": True, "eventId": result.get("eventId")}
            return {"ok": False, "error": result.get("message", "Unknown response from calendar webhook")}
    except Exception as e:
        return {"ok": False, "error": str(e)}
