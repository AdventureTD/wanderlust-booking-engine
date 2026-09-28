"""Real urllib redirect processing with an inert HTTPS handler (no sockets)."""
import io
import json
import urllib.request
import urllib.response
from email.message import Message
from unittest.mock import patch
import unittest
from test_complete_cancellation import calendar_module

class CalendarRedirectTests(unittest.TestCase):
    def run_transport(self, code, location, second_redirect=False):
        m = calendar_module()
        m.CALENDAR_WEB_APP_URL = 'https://script.google.com/macros/s/inert/exec'
        m.CALENDAR_SECRET = 'INERT_NOT_SECRET'
        calls = []
        class InertHTTPS(urllib.request.HTTPSHandler):
            def https_open(self, req):
                calls.append((req.full_url, req.get_method(), req.data, dict(req.header_items())))
                headers = Message()
                status = code if len(calls) == 1 or second_redirect else 200
                if status != 200:
                    headers['Location'] = location
                body = json.dumps({'status':'CANCELLED','bookingNumber':'WC-900001','eventId':'exact-event'}).encode()
                response = urllib.response.addinfourl(io.BytesIO(body), headers, req.full_url, status)
                response.msg = 'INERT'
                return response
        # Default urlopen and the corrected private opener both use real redirect processing.
        with patch.object(urllib.request, 'HTTPSHandler', InertHTTPS), patch.object(urllib.request, '_opener', None):
            result = m.reconcile_calendar_cancellation('WC-900001')
        return result, calls

    def test_fragment_redirect_never_enters_destination(self):
        for code in (301, 302, 303, 307, 308):
            for fragment in ('#forbidden-fragment', '#'):
                with self.subTest(code=code, fragment=fragment):
                    result, calls = self.run_transport(
                        code, 'https://script.googleusercontent.com/macros/echo' + fragment)
                    self.assertEqual(len(calls), 1)
                    self.assertEqual(result['status'], 'UNKNOWN')

    def test_redirect_bodies_are_never_read_and_close_before_successor(self):
        for code in (301, 302, 303, 307, 308):
            for second_redirect in (False, True):
                with self.subTest(code=code, second_redirect=second_redirect):
                    m = calendar_module()
                    m.CALENDAR_WEB_APP_URL = 'https://script.google.com/macros/s/inert/exec'
                    m.CALENDAR_SECRET = 'INERT_NOT_SECRET'
                    calls, redirects, reads, final_reads = [], [], [], []
                    owner = self

                    class UnreadRedirect(io.BytesIO):
                        def read(self, size=-1):
                            reads.append(size)
                            raise AssertionError('ANY_REDIRECT_BODY_READ_FORBIDDEN')

                    class CappedReceipt(io.BytesIO):
                        def read(self, size=-1):
                            final_reads.append(size)
                            owner.assertEqual(size, 16385)
                            return super().read(size)

                    class InertHTTPS(urllib.request.HTTPSHandler):
                        def https_open(self, req):
                            owner.assertTrue(all(body.closed for body in redirects))
                            calls.append(req)
                            headers = Message()
                            status = code if len(calls) == 1 or second_redirect else 200
                            if status != 200:
                                headers['Location'] = 'https://script.googleusercontent.com/macros/echo'
                                body = UnreadRedirect(b'unread redirect body')
                                redirects.append(body)
                            else:
                                body = CappedReceipt(json.dumps({'status': 'CANCELLED',
                                    'bookingNumber': 'WC-900001', 'eventId': 'exact-event'}).encode())
                            response = urllib.response.addinfourl(body, headers, req.full_url, status)
                            response.msg = 'INERT'
                            return response

                    with patch.object(urllib.request, 'HTTPSHandler', InertHTTPS):
                        result = m.reconcile_calendar_cancellation('WC-900001')
                    self.assertEqual(reads, [], 'redirect body must never be consumed')
                    self.assertTrue(all(body.closed for body in redirects))
                    allowed = code in (301, 302, 303)
                    self.assertEqual(len(calls), 2 if allowed else 1)
                    self.assertEqual(result['status'],
                                     'CANCELLED' if allowed and not second_redirect else 'UNKNOWN')
                    self.assertEqual(final_reads, [16385] if allowed and not second_redirect else [])
                    if allowed:
                        self.assertEqual(calls[1].get_method(), 'GET')
                        self.assertIsNone(calls[1].data)
                        self.assertNotIn('INERT_NOT_SECRET', str(calls[1].header_items()))
                        for header in ('Authorization', 'Cookie', 'Referer', 'Content-type'):
                            self.assertIsNone(calls[1].get_header(header))

    def test_untrusted_redirects_never_enter_destination(self):
        for code in (301,302,303,307,308):
            with self.subTest(code=code):
                result, calls = self.run_transport(code, 'https://untrusted.invalid/content')
                self.assertEqual(len(calls),1)
                self.assertEqual(result['status'],'UNKNOWN')

    def test_content_service_response_get_has_no_body_or_secret(self):
        for code in (301,302,303):
            with self.subTest(code=code):
                result,calls = self.run_transport(code,'https://script.googleusercontent.com/macros/echo?user_content_key=inert')
                self.assertEqual(result['status'],'CANCELLED')
                self.assertEqual(len(calls),2)
                self.assertEqual(calls[1][1],'GET')
                self.assertIsNone(calls[1][2])
                self.assertNotIn('INERT_NOT_SECRET',str(calls[1]))

    def test_no_post_replay_even_to_content_host(self):
        for code in (307,308):
            result,calls = self.run_transport(code,'https://script.googleusercontent.com/macros/echo')
            self.assertEqual(result['status'],'UNKNOWN')
            self.assertEqual(len(calls),1)

    def test_content_get_cannot_redirect_again(self):
        result,calls = self.run_transport(302,'https://script.googleusercontent.com/macros/echo',True)
        self.assertEqual(result['status'],'UNKNOWN')
        self.assertEqual(len(calls),2)

    def test_destination_credentials_ports_and_host_suffixes_denied(self):
        for url in ('https://script.googleusercontent.com.evil.invalid/x',
                    'https://user@script.googleusercontent.com/x',
                    'https://script.googleusercontent.com:444/x'):
            result,calls = self.run_transport(302,url)
            self.assertEqual(result['status'],'UNKNOWN')
            self.assertEqual(len(calls),1)
