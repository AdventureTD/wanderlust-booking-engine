import unittest
from unittest.mock import patch

import invoice_service


class RoomCalendarEndpointTests(unittest.TestCase):
    def setUp(self):
        self.old_secret = invoice_service.SHARED_SECRET
        invoice_service.SHARED_SECRET = "service-secret"

    def tearDown(self):
        invoice_service.SHARED_SECRET = self.old_secret

    @patch("invoice_service.sync_room_calendar_event")
    def test_endpoint_forwards_one_room_and_returns_event_id(self, sync):
        sync.return_value = {"ok": True, "status": "created", "eventId": "event-123"}
        request = invoice_service.RoomCalendarRequest(
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

        result = invoice_service.sync_calendar_room(request, x_wbe_secret="service-secret")

        self.assertEqual(result["eventId"], "event-123")
        sync.assert_called_once_with(
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


if __name__ == "__main__":
    unittest.main()
