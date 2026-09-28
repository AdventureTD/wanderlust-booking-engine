"""Actual-source AST/transport tests; no service startup or live IO."""
import ast
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]

def function(name, globals_, file='invoice_service.py'):
    tree = ast.parse((ROOT / file).read_text(encoding='utf-8'))
    node = next(n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    node.decorator_list = []
    globals_.setdefault('Header', lambda **kw: '')
    # Keep function body exact; omit annotation evaluation in the inert host.
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(ROOT/'invoice_service.py'), 'exec'), globals_)
    return globals_[name]

def calendar_module():
    spec = importlib.util.spec_from_file_location('inert_calendar', ROOT/'booking_engine/calendar.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class CancellationTests(unittest.TestCase):
    def test_background_creation_passes_booking_identity(self):
        calls = []
        fn = function('_bg_calendar_event', {'create_calendar_event': lambda **kw: calls.append(kw) or {}, 'print': lambda *a: None})
        fn('INERT', '2027-02-27', '2027-03-07', booking_number='WC-1038')
        self.assertEqual(calls[0]['booking_number'], 'WC-1038')

    def test_actual_issue_caller_schedules_bound_identity(self):
        import asyncio
        from datetime import date
        calls = []
        req = SimpleNamespace(guest=SimpleNamespace(name='INERT', email='a@example.invalid', phone='x'), quote_breakdown={},
            issue_date=None, invoice_number='INERT-1', payments=None, booking_number='WC-1038', check_in='2027-02-27', check_out='2027-03-07', room_code='suite', send_email=False)
        env = dict(SHARED_SECRET='inert', date=date, Guest=lambda **kw: SimpleNamespace(**kw),
            Invoice=SimpleNamespace(from_quote=lambda *a: SimpleNamespace(total=1)), build_report_record=lambda **kw: SimpleNamespace(to_dict=lambda: {}),
            os=SimpleNamespace(path=SimpleNamespace(join=lambda *a: 'inert'), environ={}), tempfile=SimpleNamespace(gettempdir=lambda: 'inert'),
            render_invoice_pdf_for_service=lambda *a: 'inert', print=lambda *a: None, _bg_calendar_event='calendar')
        fn = function('issue_invoice', env)
        asyncio.run(fn(req, SimpleNamespace(add_task=lambda *a, **kw: calls.append((a,kw))), 'inert'))
        self.assertEqual(calls[0][1].get('booking_number'), 'WC-1038')

    def test_calendar_transport_sends_identity(self):
        import io
        m = calendar_module()
        m.CALENDAR_WEB_APP_URL = 'https://script.google.com/macros/s/inert/exec'
        m.CALENDAR_SECRET = 'inert'
        calls = []
        def open_(request, **kw):
            calls.append(json.loads(request.data))
            r = io.BytesIO(b'{"status":"created","eventId":"event1"}')
            r.status = 200
            return r
        with patch.object(m.urllib.request, 'urlopen', open_):
            result = m.create_calendar_event('INERT', '2027-02-27', '2027-03-07', booking_number='WC-1038')
        self.assertEqual(calls[0]['bookingNumber'], 'WC-1038')
        self.assertTrue(result['ok'])

    def test_calendar_cancellation_transport_validates_exact_receipt(self):
        import io
        m = calendar_module()
        self.assertTrue(callable(getattr(m, 'reconcile_calendar_cancellation', None)), 'missing cancellation transport')
        m.CALENDAR_WEB_APP_URL = 'https://script.google.com/macros/s/inert/exec'
        m.CALENDAR_SECRET = 'inert'
        calls = []
        def open_(request, **kw):
            calls.append((json.loads(request.data), kw))
            return io.BytesIO(b'{"status":"CANCELLED","bookingNumber":"WC-1038","eventId":"event1"}')
        with patch.object(m.urllib.request, 'urlopen', open_):
            result = m.reconcile_calendar_cancellation('WC-1038')
        self.assertEqual(result['status'], 'CANCELLED')
        self.assertEqual(calls[0][0], {'action':'cancel','bookingNumber':'WC-1038','secret':'inert'})
        self.assertEqual(calls[0][1]['timeout'], 15)

    def test_authenticated_calendar_endpoint(self):
        tree = ast.parse((ROOT/'invoice_service.py').read_text(encoding='utf-8'))
        self.assertTrue(any(isinstance(n, ast.FunctionDef) and n.name == 'cancel_calendar' for n in tree.body), 'missing endpoint')
        calls = []
        class Denied(Exception):
            def __init__(self, **kw): pass
        import hmac
        fn = function('cancel_calendar', dict(SHARED_SECRET='inert', hmac=hmac, HTTPException=Denied,
            reconcile_calendar_cancellation=lambda bn: calls.append(bn) or {'status':'NEEDS_RECONCILIATION'}))
        req = SimpleNamespace(booking_number='WC-1038')
        with self.assertRaises(Denied): fn(req, 'wrong')
        self.assertEqual(calls, [])
        self.assertEqual(fn(req,'inert')['status'], 'NEEDS_RECONCILIATION')
        self.assertEqual(calls, ['WC-1038'])

    def test_email_endpoint_requires_and_echoes_operation_identity(self):
        import hmac
        calls = []
        class Denied(Exception):
            def __init__(self, **kw): pass
        fn = function('send_cancellation_email_v2', dict(SHARED_SECRET='inert', hmac=hmac, HTTPException=Denied,
            gmail_sender=SimpleNamespace(send_cancellation_email=lambda **kw: calls.append(kw) or {'gmail_message_id':'receipt','booking_number':'WC-1038'})))
        req = SimpleNamespace(operation_id='bad',booking_number='WC-1038',guest_name='INERT',guest_email='test@example.invalid',check_in='2027-02-27',check_out='2027-03-07',rooms_desc='suite',reason='')
        with self.assertRaises(Denied): fn(req,'inert')
        self.assertEqual(calls, [])
        req.operation_id='a'*32
        result=fn(req,'inert')
        self.assertEqual(result['operation_id'], req.operation_id)
        self.assertEqual(len(calls),1)

    def test_gmail_cancellation_explicitly_disables_automatic_retries(self):
        import base64
        calls=[]
        provider=SimpleNamespace(users=lambda: SimpleNamespace(messages=lambda: SimpleNamespace(send=lambda **kw: SimpleNamespace(execute=lambda **kw: calls.append(kw) or {'id':'receipt'}))))
        fn=function('send_cancellation_email',dict(base64=base64,BCC_COPY='owner@example.invalid',build_cancellation_email=lambda *a:SimpleNamespace(as_bytes=lambda:b'inert'),_gmail_service=lambda **kw:provider),'booking_engine/gmail_sender.py')
        fn('test@example.invalid','INERT','WC-1038','2027-02-27','2027-03-07','suite')
        self.assertEqual(calls,[{'num_retries':0}])

    def test_missing_gmail_receipt_is_uncertain_not_success(self):
        import base64
        provider = SimpleNamespace(users=lambda: SimpleNamespace(messages=lambda: SimpleNamespace(send=lambda **kw: SimpleNamespace(execute=lambda **kw: {}))))
        fn = function('send_cancellation_email', dict(base64=base64, BCC_COPY='owner@example.invalid',
            build_cancellation_email=lambda *a: SimpleNamespace(as_bytes=lambda: b'inert'), _gmail_service=lambda **kw:provider), 'booking_engine/gmail_sender.py')
        with self.assertRaisesRegex(RuntimeError, 'receipt'):
            fn('a@example.invalid','INERT','WC-1038','2027-02-27','2027-03-07','suite')

if __name__ == '__main__':
    unittest.main()
