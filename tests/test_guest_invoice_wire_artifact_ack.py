"""Pure-wire syntax observations only; no SDK/dispatcher/provider authority.

Reuse unchanged inert rich fixture setup and independent stdlib response oracle,
not its test class discovery. No successful START response is constructed here.
"""
import copy
import json
import unittest
from test_guest_invoice_wire_rich_state import RichTests as _Fixture, encoded, sha, mac, NOW


class ArtifactAckTests(unittest.TestCase):
    setUp = _Fixture.setUp
    response = _Fixture.response
    state = _Fixture.state

    def payload(self, operation):
        full = self.state(3)
        fields = (['encoded','mimeDigest','pdfDigest','rendererVersion'] if operation == 'commitArtifact'
                  else ['artifactDigest','invocationNonce','providerMessageId'])
        stage = full['artifact' if operation == 'commitArtifact' else 'ack']
        return {k: stage[k] for k in fields}

    def begin_op(self, operation, payload=None):
        try:
            return self.a.begin_journal(self.binding, operation,
                                        self.payload(operation) if payload is None else payload)
        except ValueError:
            self.fail('valid operation payload rejected: '+operation)

    def test_WA01_commit_request(self):
        payload = self.payload('commitArtifact')
        pending = self.begin_op('commitArtifact', payload)
        handle, raw, headers = pending
        self.assertEqual(raw, encoded(dict(protocol='guest-invoice-journal/v1', scope=self.scope,
                                           operation='commitArtifact', payload=payload)))
        expected = mac(['wbe.guest-invoice.http.v1','render-to-wix','c1','POST',
                        'https://example.test','/_functions/guestInvoiceJournal',str(NOW),
                        headers['X-WBE-GI-Request'],sha(raw)])
        self.assertEqual(headers['X-WBE-GI-Mac'], expected)
        payload['pdfDigest'] = '99'*32
        self.assertEqual(self.a._outstanding[handle]['payload']['pdfDigest'], '75'*32)
        self.assertEqual(self.a._outstanding[handle]['operation'], 'commitArtifact')
        with self.assertRaises(ValueError):
            self.a.begin_journal(self.binding, 'readIssuance', {})
        args = self.response(pending, dict(status='UNAVAILABLE'))
        self.assertEqual(self.a.consume_response(*args), dict(status='UNAVAILABLE'))
        with self.assertRaises(ValueError): self.a.consume_response(*args)
        self.assertFalse(self.a._bindings[self.binding]['started'])


    def test_WA02_commit_observation(self):
        for stage in (1, 2, 3):
            with self.subTest(stage=stage):
                pending = self.begin_op('commitArtifact')
                state = self.state(stage)
                if stage >= 2:
                    # Actual JS returns advanced current state before comparing
                    # the submitted artifact. This is NOT a commit success claim.
                    state['artifact']['pdfDigest'] = '99'*32
                args = self.response(pending, state)
                try:
                    result = self.a.consume_response(*args)
                except ValueError:
                    self.fail('valid commit observation rejected')
                self.assertEqual(result, state)
                self.assertNotIn('won', result)
                with self.assertRaises(ValueError): self.a.consume_response(*args)
        self.assertFalse(self.a._bindings[self.binding]['started'])


    def test_WA03_commit_requires_submitted_ready_artifact(self):
        cases = [('absent', self.state(0))]
        for field in ('pdfDigest', 'rendererVersion', 'mime'):
            state = self.state(1)
            if field == 'mime':
                state['artifact']['encoded'] = 'eA=='
                state['artifact']['mimeDigest'] = sha(b'x')
            else:
                state['artifact'][field] = '99'*32 if field == 'pdfDigest' else 'reportlab'
            cases.append((field, state))
        for label, state in cases:
            with self.subTest(case=label):
                args = self.response(self.begin_op('commitArtifact'), state)
                with self.assertRaises(ValueError): self.a.consume_response(*args)
                with self.assertRaises(ValueError): self.a.consume_response(*args)


    def test_WA04_ack_request_and_exact_retry(self):
        request_ids = []
        for status in ('UNAVAILABLE', 'OWNER_REVIEW_REQUIRED'):
            payload = self.payload('recordAck')
            pending = self.begin_op('recordAck', payload)
            handle, raw, headers = pending
            self.assertEqual(raw, encoded(dict(protocol='guest-invoice-journal/v1', scope=self.scope,
                                               operation='recordAck', payload=payload)))
            request_ids.append(headers['X-WBE-GI-Request'])
            self.assertNotEqual(request_ids[-1], payload['invocationNonce'])
            self.assertEqual(headers['X-WBE-GI-Mac'], mac(['wbe.guest-invoice.http.v1',
                'render-to-wix','c1','POST','https://example.test','/_functions/guestInvoiceJournal',
                str(NOW),request_ids[-1],sha(raw)]))
            payload['providerMessageId'] = 'detached'
            self.assertEqual(self.a._outstanding[handle]['payload'], self.payload('recordAck'))
            self.assertEqual(self.a._outstanding[handle]['operation'], 'recordAck')
            with self.assertRaises(ValueError):
                self.a.begin_journal(self.binding, 'recordAck', self.payload('recordAck'))
            args = self.response(pending, dict(status=status))
            self.assertEqual(self.a.consume_response(*args), dict(status=status))
            with self.assertRaises(ValueError): self.a.consume_response(*args)
        self.assertEqual(len(set(request_ids)), 2)
        self.assertFalse(self.a._bindings[self.binding]['started'])


    def test_WA05_ack_observation(self):
        for _ in range(2):
            payload = self.payload('recordAck')
            pending = self.begin_op('recordAck', payload)
            payload['providerMessageId'] = 'changed-after-capture'
            state = self.state(3)
            args = self.response(pending, state)
            try:
                observed = self.a.consume_response(*args)
            except ValueError:
                self.fail('valid exact ACK observation rejected')
            self.assertEqual(observed, state)
            self.assertNotIn('won', observed)
            with self.assertRaises(ValueError): self.a.consume_response(*args)
        self.assertFalse(self.a._bindings[self.binding]['started'])


    def test_WA06_ack_requires_exact_captured_binding(self):
        cases = [('absent-'+str(stage), self.state(stage)) for stage in (0, 1, 2)]
        for field in ('artifactDigest', 'invocationNonce', 'providerMessageId'):
            state = self.state(3)
            # Maintain all internal stage links: isolate outstanding binding.
            value = 'other-id' if field == 'providerMessageId' else '99'*32
            for stage in ('artifact', 'start', 'ack'):
                if field in state[stage]: state[stage][field] = value
            cases.append((field, state))
        for label, state in cases:
            with self.subTest(case=label):
                args = self.response(self.begin_op('recordAck'), state)
                with self.assertRaises(ValueError): self.a.consume_response(*args)
                with self.assertRaises(ValueError): self.a.consume_response(*args)


    def test_WA07_request_schema_baseline_green(self):
        count = 0
        for operation in ('commitArtifact', 'recordAck'):
            good = self.payload(operation)
            cases = [('not-object', []), ('reverse', dict(reversed(list(good.items())))),
                     ('extra', dict(good, extra='x'))]
            for field in good:
                p = dict(good); del p[field]
                cases.append(('missing-'+field, p))
                for value in (None, True, 1, [], {}, ''):
                    p = dict(good); p[field] = value
                    cases.append(('type-'+field+'-'+repr(value), p))
            if operation == 'commitArtifact':
                for field, value in [('encoded','eA'), ('encoded','eB=='), ('encoded','eA==\n'),
                        ('encoded','é'), ('encoded','A'*397812), ('mimeDigest','99'*32),
                        ('mimeDigest','AF'*32), ('pdfDigest','AF'*32), ('rendererVersion','other')]:
                    p = dict(good); p[field] = value; cases.append((field+'-invalid-'+str(len(value)),p))
            else:
                for field, value in [('artifactDigest','AF'*32), ('invocationNonce','AF'*32),
                        ('providerMessageId','x'*257), ('providerMessageId','bad.id'),
                        ('providerMessageId','x\n')]:
                    p = dict(good); p[field] = value; cases.append((field+'-invalid-'+str(len(value)),p))
            for case_index, (label, payload) in enumerate(cases):
                with self.subTest(operation=operation, case=label):
                    with self.assertRaises(ValueError):
                        self.a.begin_journal(self.binding, operation, payload)
                    self.assertIsNone(self.a._bindings[self.binding]['pending'])
                    self.assertFalse(self.a._bindings[self.binding]['started'])
                    count += 1
                    print('WA07', operation, case_index, label)
        self.assertEqual(count, 69)

    def test_WA08_signed_operation_subject_schema_baseline_green(self):
        count = 0
        for operation in ('commitArtifact', 'recordAck'):
            good = self.state(1 if operation == 'commitArtifact' else 3)
            cases = [('won', dict(won=True, invocationNonce='88'*32, artifactDigest='77'*32)),
                     ('scalar-ready',dict(status='READY')), ('scalar-accepted',dict(status='PROVIDER_ACCEPTED'))]
            for field in ('audience','acceptanceId','operationId','rootDigest','_id'):
                r = copy.deepcopy(good)
                r['root'][field] = 'other-audience' if field == 'audience' else '99'*32
                cases.append(('subject-'+field,r))
            for stage in ('root','artifact') + (('start','ack') if operation == 'recordAck' else ()):
                for field in good[stage]:
                    for mode in ('missing','type'):
                        r = copy.deepcopy(good)
                        if mode == 'missing': del r[stage][field]
                        else: r[stage][field] = None
                        cases.append((stage+'-'+field+'-'+mode,r))
                r = copy.deepcopy(good); r[stage]['extra'] = 'x'; cases.append((stage+'-extra',r))
                r = copy.deepcopy(good); r[stage] = dict(reversed(list(r[stage].items())))
                cases.append((stage+'-order',r))
            for label, result in cases:
                with self.subTest(operation=operation,case=label):
                    # Every negative independently signed after mutation.
                    args = self.response(self.begin_op(operation), result)
                    with self.assertRaises(ValueError): self.a.consume_response(*args)
                    with self.assertRaises(ValueError): self.a.consume_response(*args)
                    self.assertIsNone(self.a._bindings[self.binding]['pending'])
                    self.assertFalse(self.a._bindings[self.binding]['started'])
                    count += 1
                    print('WA08', operation, label)
        self.assertEqual(count, 154)

    def test_WA09_fences_and_original_bytes_baseline_green(self):
        labels = ('expiry','disabled','site','audience','key','removed-key', 'bad-status',
                  'bad-mac','bad-id','duplicate-header','empty-body','signed-order',
                  'signed-duplicate','stale-normalized-mac','cross-request')
        count = 0
        for operation in ('commitArtifact', 'recordAck'):
            for label in labels:
                with self.subTest(operation=operation,case=label):
                    self.setUp()
                    pending = self.begin_op(operation)
                    result = self.state(1 if operation == 'commitArtifact' else 3)
                    args = list(self.response(pending, result))
                    if label == 'expiry': self.a._now = lambda: NOW+900000
                    elif label == 'disabled': self.a._enabled = lambda: False
                    elif label == 'site': self.config['siteOrigin'] = 'https://other.test'
                    elif label == 'audience': self.config['audience'] = 'other'
                    elif label == 'key': self.config['channel']['keys'][0]['keyHex'] = '99'*32
                    elif label == 'removed-key':
                        self.config['channel'] = dict(activeKid='c2', keys=[dict(kid='c2',keyHex='99'*32)])
                    elif label == 'bad-status': args[1] = True
                    elif label in ('bad-mac','bad-id'):
                        i = 3 if label == 'bad-mac' else 2
                        args[3][i] = (args[3][i][0], '99'*32)
                    elif label == 'duplicate-header': args[3].append(args[3][-1])
                    elif label == 'empty-body': args[2] = b''
                    elif label == 'signed-order':
                        raw = encoded(dict(result=result, protocol='guest-invoice-journal/v1'))
                        args = list(self.response(pending,result,raw=raw))
                    elif label == 'signed-duplicate':
                        raw = args[2].replace(b'{"protocol":', b'{"protocol":"guest-invoice-journal/v1","protocol":',1)
                        args = list(self.response(pending,result,raw=raw))
                    elif label == 'stale-normalized-mac': args[2] += b' '
                    elif label == 'cross-request':
                        self.a.consume_response(*self.response(pending,dict(status='UNAVAILABLE')))
                        newer = self.begin_op(operation)
                        # Same logical payload, new request identity and digest binding.
                        args[0] = newer[0]
                    with self.assertRaises(ValueError): self.a.consume_response(*args)
                    with self.assertRaises(ValueError): self.a.consume_response(*args)
                    self.assertIsNone(self.a._bindings[self.binding]['pending'])
                    self.assertFalse(self.a._bindings[self.binding]['started'])
                    count += 1
                    print('WA09',operation,label)
            for label in ('expiry','disabled','site','audience','key'):
                self.setUp()
                if label == 'expiry': self.a._now = lambda: NOW+900000
                elif label == 'disabled': self.a._enabled = lambda: False
                elif label == 'site': self.config['siteOrigin'] = 'https://other.test'
                elif label == 'audience': self.config['audience'] = 'other'
                else: self.config['channel']['keys'][0]['keyHex'] = '99'*32
                with self.assertRaises(ValueError):
                    self.a.begin_journal(self.binding, operation, self.payload(operation))
                self.assertIsNone(self.a._bindings[self.binding]['pending'])
                count += 1
                print('WA09',operation,'prepare-'+label)
        self.assertEqual(count, 40)

    def test_WA10_valid_boundaries_baseline_green(self):
        import base64
        for renderer in ('word','reportlab','reportlab-fallback'):
            p = self.payload('commitArtifact'); p['rendererVersion'] = renderer
            args = self.response(self.begin_op('commitArtifact',p),dict(status='DENIED'))
            self.assertEqual(self.a.consume_response(*args),dict(status='DENIED'))
        raw = b'x' * (397808 // 4 * 3)
        p = self.payload('commitArtifact')
        p['encoded'] = base64.b64encode(raw).decode(); p['mimeDigest'] = sha(raw)
        self.assertEqual(len(p['encoded']),397808)
        pending = self.begin_op('commitArtifact',p)
        state = self.state(1); state['artifact'].update(p)
        self.assertEqual(self.a.consume_response(*self.response(pending,state)),state)
        for provider_id in ('x','x'*256):
            p = self.payload('recordAck'); p['providerMessageId'] = provider_id
            pending = self.begin_op('recordAck',p)
            state = self.state(3); state['ack']['providerMessageId'] = provider_id
            self.a._now = lambda: NOW+899999
            self.assertEqual(self.a.consume_response(*self.response(pending,state)),state)
        self.assertFalse(self.a._bindings[self.binding]['started'])


if __name__ == '__main__':
    # Imported fixture class must not cause inherited historical suites to run.
    del _Fixture
    unittest.main()
