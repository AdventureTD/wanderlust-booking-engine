"""Actual crypto + inert syntax mappings only. ZERO retained/native authority."""
import base64
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parents[2]
# Exact candidate custody before any runtime import; not native fixture admission.
import hashlib
pins=json.loads((Path(__file__).parent/'source-pins.json').read_bytes())
for name,pin in pins.items():
    assert hashlib.sha256((ROOT/name).read_bytes().replace(b'\r\n',b'\n')).hexdigest()==pin['canonicalLF'],name
pkg = types.ModuleType('booking_engine')
pkg.__path__ = [str(ROOT / 'booking_engine')]
sys.modules['booking_engine'] = pkg
from booking_engine import guest_invoice_wire_auth as auth

class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000000
        self.config = dict(siteOrigin='https://example.test', audience='test',
            channel=dict(activeKid='k', keys=[dict(kid='k',keyHex='11'*32)]))
        auth._enabled = lambda: True
        auth._now = lambda: self.now
        auth._read_configuration = lambda: self.config
        self.claims = [1,'guest-invoice-service','initial','https://example.test','test',
            auth.digest(('wbe.acceptance-id.v2\0'+'22'*32).encode()),'22'*32,'33'*32,'44'*32,'55'*32,self.now,self.now+900000]
        scope = 'wgis1.s.'+base64.urlsafe_b64encode(auth.wire_json(self.claims)).decode().rstrip('=')+'.'+'66'*32
        raw = auth.wire_json(dict(protocol='guest-invoice-dispatch/v1',scope=scope))
        m=dict(direction='wix-to-render',destinationOrigin=auth._RENDER,path=auth._DISPATCH,kid='k',time=str(self.now),requestId='77'*32)
        headers=[('Content-Type','application/json'),('X-WBE-GI-Kid','k'),('X-WBE-GI-Time',m['time']),('X-WBE-GI-Request',m['requestId']),('X-WBE-GI-Mac',auth.request_mac(m,raw,'11'*32))]
        self.binding=auth.authenticate_dispatch(raw,headers,'POST',auth._DISPATCH)
        self.calls=[]
        self.result={'status':'DENIED'}
        self.module=None

    def adapter(self, transport=None):
        path=ROOT/'booking_engine/guest_invoice_bound_journal.py'
        self.assertTrue(path.exists(), 'missing bound journal adapter')
        from booking_engine import guest_invoice_bound_journal
        self.module=guest_invoice_bound_journal
        return self.module.BoundGuestInvoiceJournal.from_dispatch(self.binding, transport or self.exchange)

    def exchange(self, raw, headers):
        self.assertIs(type(raw),bytes)
        self.assertIs(type(headers),tuple)
        self.calls.append((raw,headers))
        h=dict(headers); body=json.loads(raw)
        meta=dict(direction='render-to-wix',destinationOrigin='https://example.test',path=auth._JOURNAL,kid=h['X-WBE-GI-Kid'],time=h['X-WBE-GI-Time'],requestId=h['X-WBE-GI-Request'])
        self.assertEqual(h['X-WBE-GI-Mac'],auth.request_mac(meta,raw,'11'*32))
        result=self.result(body) if callable(self.result) else self.result
        response=auth.wire_json(dict(protocol='guest-invoice-journal/v1',result=result))
        rh=[('Content-Type','application/json'),('X-WBE-GI-Kid','k'),('X-WBE-GI-Request',meta['requestId']),('X-WBE-GI-Mac',auth.response_mac(meta,auth.digest(raw),200,response,'11'*32))]
        return 200,response,rh

    def test_read_mapping_and_bound_issuance(self):
        journal=self.adapter()
        self.assertEqual(journal.call('readIssuance',self.claims[8]),self.result)
        self.assertEqual(json.loads(self.calls[0][0])['payload'],{})
        with self.assertRaises(ValueError): journal.call('readIssuance','99'*32)
        self.assertEqual(len(self.calls),1)
        self.assertEqual(dict(journal.expectation),dict(zip(('siteOrigin','audience','acceptanceId','operationId','rootDigest','issuanceId'),self.claims[3:9])))
        with self.assertRaises(TypeError): journal.expectation['issuanceId']='99'*32

    def test_transport_failure_consumed_nonretryable_and_ack_distinct(self):
        def broken(raw, headers):
            self.calls.append((raw,headers))
            raise OSError('applied then lost')
        journal=self.adapter(broken)
        payload=dict(artifactDigest='88'*32,invocationNonce='99'*32)
        with self.assertRaises(Exception) as caught: journal.call('tryStart',self.claims[8],payload)
        self.assertEqual(type(caught.exception).__name__,'NonRetryableJournalError')
        self.assertTrue(caught.exception.consumed)
        self.assertFalse(caught.exception.retryable)
        self.assertIsNone(auth._bindings[self.binding]['pending'])
        with self.assertRaises(ValueError): journal.call('tryStart',self.claims[8],dict(payload,invocationNonce='aa'*32))
        self.assertEqual(len(self.calls),1)
        journal2=self.module.BoundGuestInvoiceJournal.from_dispatch(self.binding,self.exchange)
        self.assertEqual(journal2.call('recordAck',self.claims[8],dict(payload,providerMessageId='id')),self.result)
        self.assertEqual(len(self.calls),2)

    def rich(self, ack=False):
        root=dict(_id=self.claims[8],schemaVersion=1,kind='INITIAL_ISSUANCE',revision='initial',audience='test',acceptanceId=self.claims[5],operationId=self.claims[6],rootDigest=self.claims[7],receiptId='gbc1-'+self.claims[5],projectionDigest='aa'*32,financialDigest='bb'*32,recipientBindingDigest='cc'*32,projectionCanonical='SYNTAX ONLY',to='inert@example.test',cc='inert@example.test',**{'from':'inert@example.test'})
        artifact=dict(_id='dd'*32,kind='PREPARED',issuanceId=self.claims[8],documentDigest=root['projectionDigest'],encoded='eA==',mimeDigest=auth.digest(b'x'),pdfDigest='ee'*32,rendererVersion='word',artifactDigest='88'*32)
        start=dict(_id='ff'*32,kind='START',issuanceId=self.claims[8],documentDigest=root['projectionDigest'],artifactDigest='88'*32,invocationNonce='99'*32)
        accepted=dict(start,_id='ab'*32,kind='ACK',providerMessageId='id') if ack else None
        return dict(status='PROVIDER_ACCEPTED' if ack else 'OWNER_REVIEW_REQUIRED',root=root,payments=[],artifact=artifact,start=start,ack=accepted)

    def test_rich_start_consumed_nonretryable_no_resend(self):
        for ack in (False,True):
            with self.subTest(ack=ack):
                self.setUp()
                self.result=self.rich(ack)
                # Demonstrate internally valid wire syntax without semantic credit.
                auth._rich_state(self.result,self.claims)
                journal=self.adapter()
                p=dict(artifactDigest='88'*32,invocationNonce='99'*32)
                with self.assertRaises(self.module.NonRetryableJournalError) as caught: journal.call('tryStart',self.claims[8],p)
                self.assertTrue(caught.exception.consumed)
                self.assertFalse(caught.exception.retryable)
                self.assertIsNone(auth._bindings[self.binding]['pending'])
                with self.assertRaises(ValueError): journal.call('tryStart',self.claims[8],dict(p,invocationNonce='aa'*32))
                self.assertEqual(len(self.calls),1)

    def test_exact_won_mapping_only_and_wrong_nonce_consumed(self):
        for wrong in (False,True):
            with self.subTest(wrong=wrong):
                self.setUp();journal=self.adapter()
                p=dict(artifactDigest='88'*32,invocationNonce='99'*32)
                self.result=dict(won=True,invocationNonce=('aa' if wrong else '99')*32,artifactDigest='88'*32)
                if wrong:
                    with self.assertRaises(self.module.NonRetryableJournalError): journal.call('tryStart',self.claims[8],p)
                else: self.assertEqual(journal.call('tryStart',self.claims[8],p),self.result)
                with self.assertRaises(ValueError): journal.call('tryStart',self.claims[8],p)
                self.assertEqual(len(self.calls),1)

    def test_other_operation_rich_mapping(self):
        journal=self.adapter()
        self.result=self.rich()
        self.assertEqual(journal.call('readIssuance',self.claims[8]),self.result)
        payload={k:self.result['artifact'][k] for k in ('encoded','mimeDigest','pdfDigest','rendererVersion')}
        self.assertEqual(journal.call('commitArtifact',self.claims[8],payload),self.result)
        self.result=self.rich(True)
        ack={k:self.result['ack'][k] for k in ('artifactDigest','invocationNonce','providerMessageId')}
        self.assertEqual(journal.call('recordAck',self.claims[8],ack),self.result)
        self.assertEqual([json.loads(raw)['operation'] for raw,h in self.calls],['readIssuance','commitArtifact','recordAck'])

    def test_original_response_bytes_duplicate_headers_expiry_key_fences(self):
        for fault in ('bytes','headers','expiry','key'):
            with self.subTest(fault=fault):
                self.setUp()
                def exchange(raw,headers):
                    status,body,rh=self.exchange(raw,headers)
                    if fault=='bytes': body+=b' '
                    if fault=='headers': rh.append(('x-wbe-gi-kid','k'))
                    if fault=='expiry': self.now=self.claims[11]
                    if fault=='key': self.config['channel']['keys'][0]['keyHex']='aa'*32
                    return status,body,rh
                journal=self.adapter(exchange)
                with self.assertRaises(self.module.NonRetryableJournalError): journal.call('readIssuance',self.claims[8])
                self.assertEqual(len(self.calls),1)
                self.assertIsNone(auth._bindings[self.binding]['pending'])

    def test_expiry_before_transport_and_forged_binding(self):
        journal=self.adapter();self.now=self.claims[11]
        with self.assertRaises(ValueError): journal.call('readIssuance',self.claims[8])
        with self.assertRaises(ValueError): self.module.BoundGuestInvoiceJournal.from_dispatch(object(),self.exchange)
        self.assertEqual(self.calls,[])

if __name__=='__main__': unittest.main(verbosity=2)
