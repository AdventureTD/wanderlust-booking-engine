import json
import unittest
from unittest.mock import patch

from booking_engine import calendar


class _Response:
    status = 200

    def __init__(self, body):
        self._body = json.dumps(body).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class RoomCalendarSyncTests(unittest.TestCase):
    def setUp(self):
        self.old_url = calendar.CALENDAR_WEB_APP_URL
        self.old_secret = calendar.CALENDAR_SECRET
        calendar.CALENDAR_WEB_APP_URL = "https://example.test/calendar"
        calendar.CALENDAR_SECRET = "test-secret"

    def tearDown(self):
        calendar.CALENDAR_WEB_APP_URL = self.old_url
        calendar.CALENDAR_SECRET = self.old_secret

    @patch("booking_engine.calendar.urllib.request.urlopen")
    def test_sync_room_sends_stable_room_identity_and_returns_event_id(self, urlopen):
        urlopen.return_value = _Response({"status": "created", "eventId": "event-123"})

        result = calendar.sync_room_calendar_event(
            booking_id="row-1",
            booking_number="WC-1023",
            guest_name="Tom Decherd",
            room_code="adventure_suite",
            assigned_room="2",
            check_in="2027-03-21",
            check_out="2027-03-28",
            status="confirmed",
            event_id="",
            updated_at="2026-08-29T13:00:00.000Z",
        )

        request = urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["action"], "syncRoom")
        self.assertEqual(payload["bookingId"], "row-1")
        self.assertEqual(payload["bookingNumber"], "WC-1023")
        self.assertEqual(payload["assignedRoom"], "2")
        self.assertEqual(payload["startDate"], "2027-03-21")
        self.assertEqual(payload["endDate"], "2027-03-28")
        self.assertEqual(payload["updatedAt"], "2026-08-29T13:00:00.000Z")
        self.assertEqual(result["eventId"], "event-123")
        self.assertTrue(result["ok"])

    @patch("booking_engine.calendar.urllib.request.urlopen")
    def test_cancelled_room_requests_event_deletion(self, urlopen):
        urlopen.return_value = _Response({"status": "deleted", "eventId": ""})

        result = calendar.sync_room_calendar_event(
            booking_id="row-1",
            booking_number="WC-1023",
            guest_name="Tom Decherd",
            room_code="adventure_suite",
            assigned_room="2",
            check_in="2027-03-21",
            check_out="2027-03-28",
            status="Cancelled",
            event_id="event-123",
            updated_at="2026-08-29T13:00:00.000Z",
        )

        request = urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["eventId"], "event-123")
        self.assertEqual(payload["status"], "Cancelled")
        self.assertEqual(result["status"], "deleted")
        self.assertTrue(result["ok"])


if __name__ == "__main__":
    unittest.main()
