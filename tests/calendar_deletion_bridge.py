"""Inert bridge: real Calendar mapper and extracted real authenticated Render handler."""
import io
import json
import sys
import hmac
from types import SimpleNamespace
from unittest.mock import patch
from test_complete_cancellation import calendar_module, function

receipt=json.load(sys.stdin)
m=calendar_module()
m.CALENDAR_WEB_APP_URL='https://script.google.com/macros/s/inert/exec'
m.CALENDAR_SECRET='inert'
def open_(req,**kwargs):
    body=json.loads(req.data)
    assert body == {'action':'cancel','bookingNumber':receipt['bookingNumber'],'secret':'inert'}
    return io.BytesIO(json.dumps(receipt).encode())
def denied(**kwargs):
    return RuntimeError('denied')
handler=function('cancel_calendar',dict(SHARED_SECRET='inert',hmac=hmac,HTTPException=denied,reconcile_calendar_cancellation=m.reconcile_calendar_cancellation))
with patch.object(m.urllib.request,'build_opener',return_value=SimpleNamespace(open=open_)):
    print(json.dumps(handler(SimpleNamespace(booking_number=receipt['bookingNumber']),'inert')))
