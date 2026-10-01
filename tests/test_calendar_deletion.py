import io
import json
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from test_complete_cancellation import calendar_module

class CalendarDeletionProof(unittest.TestCase):
    def test_old_mark_receipt_is_not_deletion(self):
        self.assertEqual(self.call({'status':'CANCELLED','bookingNumber':'WC-1038','eventId':'exact'})['status'], 'UNKNOWN')

    def call(self, receipt):
        m=calendar_module()
        m.CALENDAR_WEB_APP_URL='https://script.google.com/macros/s/inert/exec'
        m.CALENDAR_SECRET='inert'
        with patch.object(m.urllib.request,'build_opener',return_value=SimpleNamespace(open=lambda *a,**k:io.BytesIO(json.dumps(receipt).encode()))):
            return m.reconcile_calendar_cancellation('WC-1038')

    def test_versioned_exact_identity_is_forwarded(self):
        receipt={'status':'CANCELLED','bookingNumber':'WC-1038','eventId':'exact','calendarId':'owner-calendar','disposition':'DELETED','deletionVersion':1}
        self.assertEqual(self.call(receipt),{'status':'CANCELLED','booking_number':'WC-1038','event_id':'exact','calendar_id':'owner-calendar','disposition':'DELETED','deletion_version':1})
        for key,value in [('bookingNumber','WC-999'),('calendarId',''),('deletionVersion',True),('deletionVersion',2),('disposition','MARKED')]:
            with self.subTest(key=key,value=value):
                self.assertEqual(self.call({**receipt,key:value})['status'],'UNKNOWN')

if __name__=='__main__': unittest.main()
