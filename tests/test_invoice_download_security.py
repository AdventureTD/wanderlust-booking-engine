import os
import tempfile
import unittest

from fastapi import HTTPException

import invoice_service


class InvoiceDownloadSecurityTests(unittest.TestCase):
    def setUp(self):
        self.old_secret = invoice_service.SHARED_SECRET
        invoice_service.SHARED_SECRET = "download-test-secret"
        self.invoice_number = "12345"
        self.pdf_path = os.path.join(tempfile.gettempdir(), self.invoice_number + ".pdf")
        with open(self.pdf_path, "wb") as handle:
            handle.write(b"%PDF-test")

    def tearDown(self):
        invoice_service.SHARED_SECRET = self.old_secret
        try:
            os.remove(self.pdf_path)
        except FileNotFoundError:
            pass

    def test_download_requires_valid_signed_token(self):
        with self.assertRaises(HTTPException) as missing:
            invoice_service.download_invoice(self.invoice_number, "")
        self.assertEqual(missing.exception.status_code, 401)

        token = invoice_service._download_token(self.invoice_number, ttl_seconds=60)
        response = invoice_service.download_invoice(self.invoice_number, token)
        self.assertEqual(response.path, self.pdf_path)

    def test_download_token_is_bound_to_invoice_and_expiry(self):
        token = invoice_service._download_token(self.invoice_number, ttl_seconds=60)
        self.assertTrue(invoice_service._download_token_valid(self.invoice_number, token))
        self.assertFalse(invoice_service._download_token_valid("54321", token))
        expired = invoice_service._download_token(self.invoice_number, ttl_seconds=-1)
        self.assertFalse(invoice_service._download_token_valid(self.invoice_number, expired))

    def test_calendar_debug_route_is_not_exposed(self):
        paths = [route.path for route in invoice_service.app.routes]
        self.assertNotIn("/calendar-debug", paths)

    def test_invoice_idempotency_returns_completed_result_and_blocks_inflight_duplicate(self):
        key = "test-idempotency-key"
        lock_path, result_path = invoice_service._idempotency_paths(key)
        for path in (lock_path, result_path, result_path + ".tmp"):
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
        self.assertIsNone(invoice_service._idempotency_begin(key))
        with self.assertRaises(HTTPException) as duplicate:
            invoice_service._idempotency_begin(key)
        self.assertEqual(duplicate.exception.status_code, 409)
        expected = {"invoice_number": "12345", "emailed": "scheduled"}
        invoice_service._idempotency_complete(key, expected)
        self.assertEqual(invoice_service._idempotency_begin(key), expected)
        for path in (lock_path, result_path, result_path + ".tmp"):
            try:
                os.remove(path)
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    unittest.main()
