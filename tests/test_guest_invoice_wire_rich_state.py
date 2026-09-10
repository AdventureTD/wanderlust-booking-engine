"""Disconnected syntax fixtures, NOT retained authority or START grants.

Independent stdlib JSON/HMAC oracles sign inert original response bytes.
Only pure wire module is executed; delivery consumer remains unimported.
"""
import base64
import copy
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import unittest

BASE = Path(__file__).resolve().parents[1]
KEY = '11' * 32
NOW = 1700000000000

def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def mac(value):
    return hmac.new(bytes.fromhex(KEY), encoded(value), hashlib.sha256).hexdigest()

class RichTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('pure_rich_wire', BASE/'booking_engine/guest_invoice_wire_auth.py')
        self.a = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.a)
        self.config = dict(siteOrigin='https://example.test', audience='fixture-site', channel=dict(activeKid='c1',keys=[dict(kid='c1',keyHex=KEY)]))
        self.a._enabled = lambda: True
        self.a._now = lambda: NOW
        self.a._read_configuration = lambda: self.config
        self.claims = [1,'guest-invoice-service','initial','https://example.test','fixture-site',sha(('wbe.acceptance-id.v2\0'+'33'*32).encode()),'33'*32,'44'*32,'55'*32,'66'*32,NOW,NOW+900000]
        payload = base64.urlsafe_b64encode(encoded(self.claims)).decode().rstrip('=')
        seal = hmac.new(bytes.fromhex('22'*32), ('wbe.guest-invoice.scope.v1\ns1\n'+payload).encode(), hashlib.sha256).hexdigest()
        self.scope = 'wgis1.s1.'+payload+'.'+seal
        raw = encoded(dict(protocol='guest-invoice-dispatch/v1',scope=self.scope))
        signature = mac(['wbe.guest-invoice.http.v1','wix-to-render','c1','POST','https://wanderlust-invoice-service.onrender.com','/private/guest-invoice/v1/dispatch',str(NOW),'12'*32,sha(raw)])
        headers = [('Content-Type','application/json'),('X-WBE-GI-Kid','c1'),('X-WBE-GI-Time',str(NOW)),('X-WBE-GI-Request','12'*32),('X-WBE-GI-Mac',signature)]
        self.binding = self.a.authenticate_dispatch(raw,headers,'POST','/private/guest-invoice/v1/dispatch')

    def begin(self, operation='readIssuance'):
        return self.a.begin_journal(self.binding,operation,{} if operation=='readIssuance' else dict(artifactDigest='77'*32,invocationNonce='88'*32))

    def response(self, pending, result, raw=None):
        handle, request, headers = pending
        if raw is None:
            raw = encoded(dict(protocol='guest-invoice-journal/v1',result=result))
        sig = mac(['wbe.guest-invoice.response.v1','render-to-wix-response','c1','https://example.test','/_functions/guestInvoiceJournal',headers['X-WBE-GI-Request'],sha(request),200,sha(raw)])
        rh = [('Content-Type','application/json'),('X-WBE-GI-Kid','c1'),('X-WBE-GI-Request',headers['X-WBE-GI-Request']),('X-WBE-GI-Mac',sig)]
        return handle,200,raw,rh

    def state(self, stage=0):
        c = self.claims
        root = dict(_id=c[8],schemaVersion=1,kind='INITIAL_ISSUANCE',revision='initial',audience=c[4],acceptanceId=c[5],operationId=c[6],rootDigest=c[7],receiptId='gbc1-'+c[5],projectionDigest='71'*32,financialDigest='72'*32,recipientBindingDigest='73'*32,projectionCanonical='syntax-only é e\u0301 😀',to='guest@example.test',cc='info@wanderlustcaribbean.com',**{'from':'info@wanderlustcaribbean.com'})
        artifact = dict(_id='74'*32,kind='PREPARED',issuanceId=c[8],documentDigest=root['projectionDigest'],encoded=base64.b64encode(b'inert MIME bytes; not a valid authority fixture').decode(),mimeDigest=sha(b'inert MIME bytes; not a valid authority fixture'),pdfDigest='75'*32,rendererVersion='word',artifactDigest='77'*32)
        start = dict(_id='76'*32,kind='START',issuanceId=c[8],documentDigest=root['projectionDigest'],artifactDigest=artifact['artifactDigest'],invocationNonce='88'*32)
        ack = dict(_id='78'*32,kind='ACK',issuanceId=c[8],documentDigest=root['projectionDigest'],artifactDigest=artifact['artifactDigest'],invocationNonce=start['invocationNonce'],providerMessageId='inert_message-1')
        return dict(status='PROVIDER_ACCEPTED' if stage==3 else 'OWNER_REVIEW_REQUIRED' if stage==2 else 'READY',root=root,payments=[],artifact=artifact if stage else None,start=start if stage>=2 else None,ack=ack if stage==3 else None)

    def test_WR02_rich_observation_stages(self):
        for stage in range(4):
            with self.subTest(stage=stage):
                state = self.state(stage)
                args = self.response(self.begin(),state)
                try:
                    observed = self.a.consume_response(*args)
                except ValueError:
                    self.fail('correctly signed rich observation rejected')
                self.assertEqual(observed,state)
                self.assertNotIn('won',observed)
                state['root']['to'] = 'detached@example.test'
                self.assertEqual(observed['root']['to'],'guest@example.test')
                with self.assertRaises(ValueError): self.a.consume_response(*args)
        # Observation does not set or reconstruct the live START grant flag.
        self.assertFalse(self.a._bindings[self.binding]['started'])
        self.assertIsNone(self.a._bindings[self.binding]['pending'])

    def test_WR03_read_never_accepts_won(self):
        # Adversarial signed response only; no successful or reconstructed grant.
        args = self.response(self.begin(),dict(won=True,invocationNonce='88'*32,artifactDigest='77'*32))
        try:
            with self.assertRaises(ValueError): self.a.consume_response(*args)
        except KeyError:
            self.fail('read response reached tryStart payload classification')
        with self.assertRaises(ValueError): self.a.consume_response(*args)

    def test_WR04_signed_schema_negatives_baseline_green(self):
        cases = []
        full = self.state(3)
        def change(label, path, value=None, remove=False):
            candidate = copy.deepcopy(full)
            target = candidate
            for key in path[:-1]: target = target[key]
            if remove: del target[path[-1]]
            else: target[path[-1]] = value
            cases.append((label,candidate))
        for name in ('outer','root','artifact','start','ack'):
            parent = [] if name=='outer' else [name]
            record = full if name=='outer' else full[name]
            change(name+'-extra',parent+['extra'],True)
            for field in record:
                change(name+'-'+field+'-missing',parent+[field],remove=True)
                change(name+'-'+field+'-type',parent+[field],False if field=='schemaVersion' else 17)
            change(name+'-order',parent+[next(iter(record))],record[next(iter(record))])
            # Reorder without changing values, to test exact ordered schema.
            candidate = cases.pop()[1]
            target = candidate if name=='outer' else candidate[name]
            first = next(iter(target))
            target[first] = target.pop(first)
            cases.append((name+'-order',candidate))
        for field in ('_id','acceptanceId','operationId','rootDigest','audience'):
            change('subject-'+field,['root',field],'99'*32 if field!='audience' else 'other')
        for name in ('root','artifact','start','ack'):
            for field in full[name]:
                if field in ('_id','issuanceId','acceptanceId','operationId','rootDigest','projectionDigest','financialDigest','recipientBindingDigest','documentDigest','artifactDigest','mimeDigest','pdfDigest','invocationNonce'):
                    change(name+'-'+field+'-hex',[name,field],'AA'*32)
        for field,value in [('schemaVersion',2),('kind','OTHER'),('revision','other'),('receiptId','gbc1-'+'99'*32)]:
            change('root-'+field+'-value',['root',field],value)
        for name in ('artifact','start','ack'):
            for field,value in [('kind','OTHER'),('issuanceId','99'*32),('documentDigest','99'*32)]:
                change(name+'-'+field+'-link',[name,field],value)
        for value in ('','Zg===','Zh==',' Zg==','_w==','é','Zg==\n'):
            change('base64-'+repr(value),['artifact','encoded'],value)
        change('mime-hash',['artifact','mimeDigest'],'99'*32)
        change('renderer',['artifact','rendererVersion'],'other')
        for value in ('','bad id','x'*257): change('provider-'+repr(value),['ack','providerMessageId'],value)
        change('payments-nonempty',['payments'],[{}])
        change('missing-artifact',['artifact'],None)
        change('missing-start',['start'],None)
        change('start-artifact',['start','artifactDigest'],'99'*32)
        change('ack-artifact',['ack','artifactDigest'],'99'*32)
        change('ack-nonce',['ack','invocationNonce'],'99'*32)
        for stage in range(4):
            for status in ('READY','OWNER_REVIEW_REQUIRED','PROVIDER_ACCEPTED','DENIED'):
                state = self.state(stage)
                if status != state['status']:
                    state['status'] = status
                    cases.append(('status-'+str(stage)+'-'+status,state))
        ids = []
        for label,state in cases:
            with self.subTest(case=label):
                args = self.response(self.begin(),state)  # correct independent outer MAC
                with self.assertRaises(ValueError): self.a.consume_response(*args)
                with self.assertRaises(ValueError): self.a.consume_response(*args)
                ids.append(label)
        self.assertEqual(len(ids),len(set(ids)))
        print(json.dumps(dict(baseline_green_schema_cases=ids)))

    def test_WR05_fences_and_operation_baseline_green(self):
        ids = []
        for fault in ('expired','off','site','audience','retired-kid','replaced-key'):
            self.setUp()
            args = self.response(self.begin(),self.state(3))
            if fault=='expired': self.a._now = lambda: NOW+900000
            if fault=='off': self.a._enabled = lambda: False
            if fault=='site': self.config['siteOrigin']='https://other.test'
            if fault=='audience': self.config['audience']='other'
            if fault=='retired-kid': self.config['channel']=dict(activeKid='c2',keys=[dict(kid='c2',keyHex='22'*32)])
            if fault=='replaced-key': self.config['channel']['keys'][0]['keyHex']='22'*32
            with self.subTest(fault=fault):
                with self.assertRaises(ValueError): self.a.consume_response(*args)
                with self.assertRaises(ValueError): self.a.consume_response(*args)
            ids.append(fault)
        self.setUp()
        args = self.response(self.begin('tryStart'),self.state(2))
        with self.assertRaises(ValueError): self.a.consume_response(*args)
        with self.assertRaises(ValueError): self.a.consume_response(*args)
        with self.assertRaises(ValueError): self.begin('tryStart')
        ids.append('rich-on-tryStart-spent')
        for status in ('DENIED','UNAVAILABLE','OWNER_REVIEW_REQUIRED'):
            args = self.response(self.begin(),dict(status=status))
            self.assertEqual(self.a.consume_response(*args),dict(status=status))
            with self.assertRaises(ValueError): self.a.consume_response(*args)
            ids.append('scalar-'+status)
        print(json.dumps(dict(baseline_green_fence_cases=ids)))

    def test_WR06_base64_boundaries_baseline_green(self):
        ids = []
        for size,allowed in ((397804,True),(397808,True),(397812,False)):
            state = self.state(1)
            raw = b'x'*(size//4*3)
            state['artifact']['encoded']=base64.b64encode(raw).decode()
            self.assertEqual(len(state['artifact']['encoded']),size)
            state['artifact']['mimeDigest']=sha(raw)
            args = self.response(self.begin(),state)
            if allowed: self.assertEqual(self.a.consume_response(*args),state)
            else:
                with self.assertRaises(ValueError): self.a.consume_response(*args)
            with self.assertRaises(ValueError): self.a.consume_response(*args)
            ids.append(str(size))
        for renderer in ('word','reportlab','reportlab-fallback'):
            state=self.state(1); state['artifact']['rendererVersion']=renderer
            self.assertEqual(self.a.consume_response(*self.response(self.begin(),state)),state)
            ids.append(renderer)
        print(json.dumps(dict(baseline_green_boundary_cases=ids)))

    def test_WR07_original_bytes_baseline_green(self):
        state = self.state(0)
        canonical = encoded(dict(protocol='guest-invoice-journal/v1',result=state))
        negatives = [('whitespace',canonical+b' '),('malformed-utf8',b'\xff'),
            ('duplicate-root-field',canonical.replace(b'"schemaVersion":1',b'"schemaVersion":1,"schemaVersion":1')),
            ('duplicate-envelope-field',canonical.replace(b'"result":',b'"protocol":"guest-invoice-journal/v1","result":')),
            ('escaped-unicode',canonical.replace('é'.encode(),b'\\u00e9')),
            ('float-version',canonical.replace(b'"schemaVersion":1',b'"schemaVersion":1.0'))]
        ids = []
        for label,raw in negatives:
            args = self.response(self.begin(),state,raw)
            with self.subTest(case=label):
                with self.assertRaises(ValueError): self.a.consume_response(*args)
                with self.assertRaises(ValueError): self.a.consume_response(*args)
            ids.append(label)
        # Literal Unicode, combining marks and a lone surrogate are preserved.
        raw = canonical.replace(b'syntax-only ',b'\\ud800 ')
        args = self.response(self.begin(),state,raw)
        observed = self.a.consume_response(*args)
        self.assertEqual(observed['root']['projectionCanonical'],'\ud800 é e\u0301 😀')
        self.assertEqual(self.a.wire_json(dict(protocol='guest-invoice-journal/v1',result=observed)),raw)
        # Same well-formed bytes but stale MAC must fail, not normalize into a match.
        pending = self.begin()
        args = list(self.response(pending,state))
        args[2] = args[2].replace('é'.encode(),'e\u0301'.encode())
        with self.assertRaises(ValueError): self.a.consume_response(*args)
        ids.extend(['surrogate-unicode-roundtrip','normalized-bytes-stale-mac'])
        for size,allowed in ((900000,True),(900001,False)):
            candidate = self.state(0)
            candidate['root']['projectionCanonical']=''
            length = len(encoded(dict(protocol='guest-invoice-journal/v1',result=candidate)))
            candidate['root']['projectionCanonical']='x'*(size-length)
            args = self.response(self.begin(),candidate)
            self.assertEqual(len(args[2]),size)
            if allowed: self.assertEqual(self.a.consume_response(*args),candidate)
            else:
                with self.assertRaises(ValueError): self.a.consume_response(*args)
            ids.append('provisional-cap-'+str(size))
        # Above cap-positive string intentionally violates the semantic consumer's
        # 160000-byte projection limit: wire cap evidence is NOT consumer authority.
        print(json.dumps(dict(baseline_green_original_byte_cases=ids)))

    def test_WR01_read_request_scalar_consumption(self):
        try:
            pending = self.begin()
        except ValueError:
            self.fail('valid enrolled readIssuance request denied')
        _, raw, headers = pending
        self.assertEqual(raw,encoded(dict(protocol='guest-invoice-journal/v1',scope=self.scope,operation='readIssuance',payload={})))
        self.assertEqual(headers['X-WBE-GI-Mac'],mac(['wbe.guest-invoice.http.v1','render-to-wix','c1','POST','https://example.test','/_functions/guestInvoiceJournal',str(NOW),headers['X-WBE-GI-Request'],sha(raw)]))
        with self.assertRaises(ValueError): self.begin()
        args = self.response(pending,dict(status='UNAVAILABLE'))
        self.assertEqual(self.a.consume_response(*args),dict(status='UNAVAILABLE'))
        with self.assertRaises(ValueError): self.a.consume_response(*args)
        for op in ('commitArtifact','recordAck'):
            with self.assertRaises(ValueError): self.a.begin_journal(self.binding,op,{})
        with self.assertRaises(ValueError): self.a.begin_journal(self.binding,'readIssuance',{'extra':1})
        self.begin()  # A read is not a spent START attempt.

if __name__ == '__main__':
    unittest.main(verbosity=2)
