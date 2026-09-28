"""Actual Gmail request preparation and transport edges; no provider sockets."""
import base64
import importlib.util
import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from http.client import BadStatusLine
import httplib2
import requests

ROOT = Path(__file__).resolve().parents[1]

class GmailTransportTests(unittest.TestCase):
    def sender(self):
        spec = importlib.util.spec_from_file_location('blocker_gmail', ROOT/'booking_engine/gmail_sender.py')
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m

    def exercise(self, lost, status=200):
        m = self.sender()
        calls = []
        class Connection:
            sock = object()
            reads = 0
            def connect(self): self.sock = object()
            def close(self): self.sock = None
            def request(self, method, uri, body, headers): calls.append((method, uri, body, headers))
            def getresponse(self):
                self.reads += 1
                if lost and self.reads == 1: raise BadStatusLine('accepted then response lost')
                class Response:
                    status=200; reason='OK'; version=11
                    def items(self): return [('status','200'),('content-type','application/json')]
                    def getheaders(self): return [('content-type','application/json')]
                    def read(self): return b'{"id":"receipt"}'
                return Response()
        conn = Connection()
        original = httplib2.Http._conn_request
        def edge(http, ignored, uri, method, body, headers):
            return original(http, conn, uri, method, body, headers)
        def send(adapter, request, **kw):
            calls.append((request.method, request.url, request.body, request.headers))
            self.assertEqual(adapter.max_retries.total, 0)
            self.assertEqual(kw['proxies'], {})
            self.assertEqual(kw['timeout'], (10, 30))
            if lost: raise requests.ConnectionError('accepted then response lost')
            response = requests.Response(); response.status_code=status
            response._content=b'{"id":"receipt"}'; response.request=request
            response.headers['Content-Type']='application/json'
            if status in (302,307): response.headers['Location']='https://gmail.googleapis.com/inert-redirect'
            return response
        with tempfile.TemporaryDirectory() as td:
            token=Path(td)/'token.json'; token.write_text(json.dumps(dict(token='inert-token',client_id='inert',client_secret='inert')))
            m.GMAIL_TOKEN_PATH=str(token)
            with patch.object(socket.socket,'connect',side_effect=AssertionError('LIVE SOCKET FORBIDDEN')), patch.object(httplib2.Http,'_conn_request',edge), patch.object(requests.adapters.HTTPAdapter,'send',send), patch.dict('os.environ',{'HTTPS_PROXY':'http://inert.invalid:9'}):
                error=None; result=None
                try: result=m.send_cancellation_email('guest@example.invalid','INERT','WC-1038','2027-02-27','2027-03-07','suite')
                except Exception as exc: error=exc
        return calls,error,result

    def test_lost_response_never_replays_actual_gmail_post(self):
        calls,error,result=self.exercise(True)
        self.assertEqual(len(calls),1, 'underlying transport replayed accepted POST')
        self.assertIsNotNone(error)
        self.assertIsNone(result)

    def test_redirect_auth_and_server_failure_never_replay(self):
        for status in (302,307,401,500):
            with self.subTest(status=status):
                calls,error,result=self.exercise(False,status)
                self.assertEqual(len(calls),1)
                self.assertIsNotNone(error)
                self.assertIsNone(result)

    def test_real_prepared_gmail_request_and_receipt(self):
        calls,error,result=self.exercise(False)
        self.assertIsNone(error)
        self.assertEqual(len(calls),1)
        method,url,body,headers=calls[0]
        self.assertEqual(method,'POST')
        self.assertEqual(url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send?alt=json')
        self.assertEqual(headers['authorization'],'Bearer inert-token')
        self.assertIn(b'To: guest@example.invalid',base64.urlsafe_b64decode(json.loads(body)['raw']))
        self.assertEqual(result['gmail_message_id'],'receipt')

class EndpointCompatibilityTests(unittest.TestCase):
    def test_original_caller_and_versioned_fail_closed_route(self):
        import ast
        import hmac
        from fastapi import FastAPI, Header, HTTPException
        from fastapi.testclient import TestClient
        from pydantic import BaseModel
        from types import SimpleNamespace
        tree=ast.parse((ROOT/'invoice_service.py').read_text(encoding='utf-8'))
        names={'CancellationEmailRequest','CancellationEmailV2Request','send_cancellation_email','send_cancellation_email_v2'}
        nodes=[n for n in tree.body if isinstance(n,(ast.ClassDef,ast.FunctionDef)) and n.name in names]
        calls=[]
        env=dict(BaseModel=BaseModel,Header=Header,HTTPException=HTTPException,app=FastAPI(),hmac=hmac,SHARED_SECRET='inert',
                 gmail_sender=SimpleNamespace(send_cancellation_email=lambda **kw:calls.append(kw) or {'gmail_message_id':'receipt','booking_number':kw['booking_number']}))
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'actual-cancellation-routes','exec'),env)
        body=dict(guest_name='INERT',guest_email='guest@example.invalid',booking_number='WC-1038',check_in='2027-02-27',check_out='2027-03-07',rooms_desc='suite')
        with TestClient(env['app']) as client:
            old=client.post('/send-cancellation-email',json=body,headers={'X-WBE-Secret':'inert'})
            self.assertEqual(old.status_code,200)
            self.assertEqual(old.json(),{'ok':True,'gmail_message_id':'receipt','booking_number':'WC-1038'})
            self.assertEqual(client.post('/v2/send-cancellation-email',json=body,headers={'X-WBE-Secret':'inert'}).status_code,422)
            body['operation_id']='a'*32
            self.assertEqual(client.post('/v2/send-cancellation-email',json=body,headers={'X-WBE-Secret':'bad'}).status_code,401)
            body['operation_id']='bad'
            self.assertEqual(client.post('/v2/send-cancellation-email',json=body,headers={'X-WBE-Secret':'inert'}).status_code,400)
            body['operation_id']='a'*32
            new=client.post('/v2/send-cancellation-email',json=body,headers={'X-WBE-Secret':'inert'})
            self.assertEqual(new.status_code,200)
            self.assertEqual(new.json()['operation_id'],'a'*32)
        self.assertEqual(len(calls),2)

if __name__=='__main__': unittest.main()
