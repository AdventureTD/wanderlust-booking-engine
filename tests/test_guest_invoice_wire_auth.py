"""Finite pure auth suite; exact file-spec load, no booking_engine initializer."""
import base64
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

BASE = Path(__file__).resolve().parents[1]
MODULE = BASE / 'booking_engine/guest_invoice_wire_auth.py'


def native_node(bridge=None):
    command = ['node', str(BASE / 'scripts/verify-guest-invoice-wire-auth.cjs')]
    if bridge is not None:
        command.append('--wp03-bridge')
    run = subprocess.run(command, input=None if bridge is None else json.dumps(bridge), capture_output=True, text=True, timeout=30)
    # Native child evidence is retained by the outer bounded runner, not discarded.
    print(json.dumps(dict(native_command=command, exit_code=run.returncode, stdout=run.stdout, stderr=run.stderr)))
    if run.returncode:
        raise AssertionError(run.stderr)
    result = json.loads(run.stdout)
    expected = 5 if bridge is not None else 4
    if result['count'] != expected or len(set(result['cases'])) != expected:
        raise AssertionError('native case census mismatch')
    return result


def load():
    spec = importlib.util.spec_from_file_location('isolated_guest_wire_auth', MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class WireTests(unittest.TestCase):
    def test_WP01_python_node_crypto_vectors(self):
        self.assertTrue(MODULE.is_file(), 'missing new Python pure auth module')
        a = load()
        vector = native_node()
        raw = bytes.fromhex(vector['bodyHex'])
        meta = dict(direction='render-to-wix', destinationOrigin='https://example.test', path='/_functions/guestInvoiceJournal', kid='c1', time='1700000000000', requestId='99' * 32)
        self.assertEqual(a.request_mac(meta, raw, '11' * 32), '8ca96272e54f0b112044c57f775e3840ea10cb4544aee851ea06ca83f14b471a')
        self.assertEqual(a.request_mac(meta, raw, '11' * 32), vector['requestMac'])
        _, kid, encoded, mac = vector['scope'].split('.')
        # Independent stdlib oracle, not the module's scope implementation.
        self.assertEqual(hmac.new(bytes.fromhex('22' * 32), ('wbe.guest-invoice.scope.v1\n' + kid + '\n' + encoded).encode(), hashlib.sha256).hexdigest(), mac)
        claims = json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))
        self.assertEqual(a.wire_json(claims), base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))


    def test_WP02_unicode_codec(self):
        a = load()
        v = native_node()
        raw = bytes.fromhex(v['richHex'])
        decoded = json.loads(raw)
        try:
            encoded = a.wire_json(decoded)
        except UnicodeEncodeError:
            self.fail('missing lone-surrogate preserving response codec')
        self.assertEqual(encoded, raw)
        self.assertEqual(a.wire_json('\ud83d\ude00'), '"😀"'.encode())
        self.assertNotEqual(a.wire_json('é'), a.wire_json('e\u0301'))
        for value in [1.0, -1, 9007199254740992, float('nan')]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                a.wire_json(value)


    def test_WP03_dispatch_outstanding_consume_once(self):
        a = load()
        self.assertTrue(hasattr(a, 'authenticate_dispatch'), 'missing immutable dispatch enrollment')
        v = native_node()
        a._enabled = lambda: True
        a._now = lambda: 1700000000000
        a._read_configuration = lambda: dict(siteOrigin='https://example.test', audience='fixture-site', channel={'activeKid':'c1','keys':[{'kid':'c1','keyHex':'11'*32}]})
        raw = a.wire_json({'protocol':'guest-invoice-dispatch/v1','scope':v['scope']})
        m = dict(direction='wix-to-render', destinationOrigin='https://wanderlust-invoice-service.onrender.com', path='/private/guest-invoice/v1/dispatch', kid='c1', time=str(a._now()), requestId='12'*32)
        headers = [('Content-Type','application/json'),('X-WBE-GI-Kid','c1'),('X-WBE-GI-Time',m['time']),('X-WBE-GI-Request',m['requestId']),('X-WBE-GI-Mac',a.request_mac(m,raw,'11'*32))]
        # Boundary negatives share the admitted pure-auth tracer; no handler loads.
        for bad_raw, bad_headers, method, path in [
            (raw + b' ', headers, 'POST', m['path']),
            (raw, headers + [('x-wbe-gi-kid', 'c1')], 'POST', m['path']),
            (raw, headers, 'GET', m['path']),
            (raw, headers, 'POST', m['path'] + '/'),
        ]:
            with self.subTest(boundary=(method, path, len(bad_raw), len(bad_headers))), self.assertRaises(ValueError):
                a.authenticate_dispatch(bad_raw, bad_headers, method, path)
        binding = a.authenticate_dispatch(raw, headers, 'POST', m['path'])
        payload = dict(artifactDigest='77'*32,invocationNonce='88'*32)
        outstanding, request, request_headers = a.begin_journal(binding, 'tryStart', payload)
        payload['invocationNonce'] = '00'*32
        meta = dict(direction='render-to-wix',destinationOrigin='https://example.test',path='/_functions/guestInvoiceJournal',kid='c1',time=request_headers['X-WBE-GI-Time'],requestId=request_headers['X-WBE-GI-Request'])
        result = dict(won=True,invocationNonce='88'*32,artifactDigest='77'*32)
        response = a.wire_json(dict(protocol='guest-invoice-journal/v1',result=result))
        rh = [('Content-Type','application/json'),('X-WBE-GI-Kid','c1'),('X-WBE-GI-Request',meta['requestId']),('X-WBE-GI-Mac',a.response_mac(meta,a.digest(request),200,response,'11'*32))]
        bridge = native_node(dict(bodyHex=request.hex(), headers=request_headers))['bridgeResponse']
        self.assertEqual(bytes.fromhex(bridge['bodyHex']), response)
        self.assertEqual(bridge['headers']['X-WBE-GI-Mac'], dict(rh)['X-WBE-GI-Mac'])
        self.assertEqual(a.consume_response(outstanding, bridge['status'], bytes.fromhex(bridge['bodyHex']), list(bridge['headers'].items())), result)
        with self.assertRaises(ValueError):
            a.consume_response(outstanding,200,response,rh)
        with self.assertRaises(ValueError):
            a.begin_journal(binding,'tryStart',dict(artifactDigest='77'*32,invocationNonce='88'*32))
        with self.assertRaises(ValueError):
            a.begin_journal(object(),'readIssuance',{})

        # These are post-implementation BASELINE-GREEN controls, not historical RED.
        subcases = []
        for fault in ['expired', 'off', 'site', 'audience', 'retired-kid', 'replaced-key',
                      'wrong-nonce', 'wrong-artifact', 'old-request', 'duplicate-header',
                      'noncanonical', 'malformed-utf8', 'unsigned', 'non-200']:
            a._enabled = lambda: True
            a._now = lambda: 1700000000000
            config = dict(siteOrigin='https://example.test', audience='fixture-site', channel={'activeKid':'c1','keys':[{'kid':'c1','keyHex':'11'*32}]})
            a._read_configuration = lambda: config
            b = a.authenticate_dispatch(raw, headers, 'POST', m['path'])
            handle, sent, sent_headers = a.begin_journal(b, 'tryStart', dict(artifactDigest='77'*32, invocationNonce='88'*32))
            rm = dict(direction='render-to-wix', destinationOrigin='https://example.test', path='/_functions/guestInvoiceJournal', kid='c1', time=sent_headers['X-WBE-GI-Time'], requestId=sent_headers['X-WBE-GI-Request'])
            rr = dict(won=True, invocationNonce='88'*32, artifactDigest='77'*32)
            if fault == 'wrong-nonce': rr['invocationNonce'] = '00'*32
            if fault == 'wrong-artifact': rr['artifactDigest'] = '00'*32
            rb = a.wire_json(dict(protocol='guest-invoice-journal/v1', result=rr))
            if fault == 'noncanonical': rb += b' '
            if fault == 'malformed-utf8': rb = b'\xff'
            rh2 = [('Content-Type','application/json'),('X-WBE-GI-Kid','c1'),('X-WBE-GI-Request',rm['requestId']),('X-WBE-GI-Mac',a.response_mac(rm,a.digest(sent),200,rb,'11'*32))]
            if fault == 'expired': a._now = lambda: 1700000900000
            if fault == 'off': a._enabled = lambda: False
            if fault == 'site': config['siteOrigin'] = 'https://other.test'
            if fault == 'audience': config['audience'] = 'other-site'
            if fault == 'retired-kid': config['channel'] = {'activeKid':'c2','keys':[{'kid':'c2','keyHex':'22'*32}]}
            if fault == 'replaced-key': config['channel']['keys'][0]['keyHex'] = '22'*32
            if fault == 'old-request': rh2[2] = ('X-WBE-GI-Request', meta['requestId'])
            if fault == 'duplicate-header': rh2.append(('x-wbe-gi-kid','c1'))
            if fault == 'unsigned': rh2.pop()
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                a.consume_response(handle, 503 if fault == 'non-200' else 200, rb, rh2)
            with self.subTest(fault=fault, replay=True), self.assertRaises(ValueError):
                a.consume_response(handle,200,rb,rh2)
            with self.subTest(fault=fault, retry=True), self.assertRaises(ValueError):
                a.begin_journal(b,'tryStart',dict(artifactDigest='77'*32,invocationNonce='88'*32))
            subcases.append('WP03-' + fault)
        print(json.dumps(dict(baseline_green_subcases=subcases)))


if __name__ == '__main__':
    unittest.main(verbosity=2)
