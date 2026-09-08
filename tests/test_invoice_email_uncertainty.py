"""Actual endpoint tests. All external IO must remain inert."""
import pytest
from fastapi.testclient import TestClient
import invoice_service as service


@pytest.fixture(autouse=True)
def endpoint_only_lifecycle(monkeypatch):
    # This suite isolates explicit endpoint invocations. Actual startup discovery
    # and lifespan ownership are exercised in test_invoice_email_recovery.py.
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def endpoint_lifespan(app):
        yield

    # monkeypatch restores the production lifespan after each endpoint-only test.
    monkeypatch.setattr(service.app.router, 'lifespan_context', endpoint_lifespan)


@pytest.mark.parametrize('operation', ['REQUEST', 'ISSUANCE', 'insert', 'update', 'remove', 'save', 'prepareOwnerIssuance'])
def test_n2_python_adapter_forbidden_operations_zero_transport(monkeypatch, operation):
    import requests
    from booking_engine.invoice_email_journal import InvoiceEmailJournal
    def forbidden(*args, **kwargs):
        pytest.fail('forbidden operation reached transport')
    monkeypatch.setattr(requests.Session, 'send', forbidden)
    with pytest.raises(ValueError, match='invalid_journal_operation'):
        InvoiceEmailJournal('https://fixture.invalid', 'fixture-only').call(operation, 'a' * 64)


def test_actual_admin_bridge_and_incoming_exclusion_gate():
    import subprocess, os
    env = {key: value for key, value in os.environ.items() if not key.startswith(('ENDPOINT_', 'N3_ROOT_FIXTURE'))}
    run = subprocess.run(['node', '--experimental-vm-modules', 'scripts/verify-essential-email-dispatch.js'],
        capture_output=True, text=True, env=env, timeout=30)
    assert run.returncode == 0, run.stderr
    assert 'PASS N2 incoming exclusions' in run.stdout
    assert 'PASS N2 actual HTTP bridge' in run.stdout
    assert 'PASS Admin dispatch/status actual callbacks' in run.stdout


def test_journal_variant_default_off(monkeypatch):
    monkeypatch.setattr(service, 'SHARED_SECRET', 'fixture-only')
    with TestClient(service.app) as client:
        response = client.post('/issue-invoice', headers={'X-WBE-Secret': 'fixture-only'},
                               json={'protocol': 'owner-invoice-journal-v1', 'issuance_id': 'a' * 64})
    assert response.status_code == 503
    assert response.json()['detail'] == 'owner_invoice_journal_disabled'


@pytest.mark.parametrize('mode', ['accepted', 'timeout', 'reset', '401', 'redirect', 'bad_status',
                                  'missing_id', 'non_json', 'start_response_loss', 'ack_response_loss', 'ack_never_written',
                                  'start_insert_ack_loss', 'start_readback_loss', 'prestart_retry', 'paused_late_ack', 'artifact_winner'])
def test_actual_endpoint_writer_bridge_sender_restart(tmp_path, monkeypatch, mode):
    import os, json, subprocess, base64
    import requests
    from booking_engine import gmail_sender
    database = tmp_path / 'journal.json'
    env = dict(os.environ, ENDPOINT_FIXTURE=str(database), ENDPOINT_FAULT=mode)
    def bridge_call(payload):
        run = subprocess.run(['node', '--experimental-vm-modules',
                              'scripts/verify-essential-email-dispatch.js'],
                             input=json.dumps(payload), text=True, capture_output=True, env=env, timeout=20)
        assert run.returncode == 0, run.stderr
        return json.loads(run.stdout)
    admission = bridge_call({'fixture': 'prepare'})
    issuance_id = admission['issuanceId']
    calls = []
    paused_observations = []
    artifact_candidates = []
    def inert_send(self, request, **kwargs):
        calls.append((request.url, json.loads(request.body), kwargs))
        response = requests.Response()
        response.status_code = 200
        if request.url.endswith('/_functions/invoiceEmailJournal'):
            payload = json.loads(request.body)
            if mode == 'artifact_winner' and payload['operation'] == 'commitArtifact':
                artifact_candidates.append(payload['payload'])
                if len(artifact_candidates) == 1:
                    # Suspend first complete renderer before manifest insertion.
                    # Competing actual endpoint publishes different MIME and sends.
                    with TestClient(service.app) as competitor:
                        won = competitor.post('/issue-invoice', headers={'X-WBE-Secret': 'fixture-only'},
                            json={'protocol': 'owner-invoice-journal-v1', 'issuance_id': issuance_id})
                    assert won.status_code == 200
                    assert won.json()['status'] == 'provider_accepted'
            if mode == 'ack_never_written' and payload['operation'] == 'recordAck':
                raise requests.Timeout('inert ACK failure before bridge')
            response._content = json.dumps(bridge_call(payload)).encode()
            response.status_code = int(env.get('ENDPOINT_EXPECT_STATUS', '200'))
            if ((mode == 'start_response_loss' and payload['operation'] == 'tryStart') or
                    (mode == 'ack_response_loss' and payload['operation'] == 'recordAck')):
                raise requests.Timeout('inert lost bridge response after persistence')
        else:
            assert request.url == 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
            if mode == 'paused_late_ack':
                # A second real endpoint worker observes the durable START while
                # the live winner is suspended inside provider transport.
                from booking_engine import invoice_email_dispatch
                monkeypatch.setattr(invoice_email_dispatch, 'BOOT_ID', 'reconstructed-worker')
                with TestClient(service.app) as observer:
                    observed = observer.post('/issue-invoice', headers={'X-WBE-Secret': 'fixture-only'},
                        json={'protocol': 'owner-invoice-journal-v1', 'issuance_id': issuance_id})
                assert observed.status_code == 200
                assert observed.json()['status'] == 'owner_review_required'
                paused_observations.append(observed.json())
            if mode == 'timeout':
                raise requests.Timeout('inert lost Gmail response')
            if mode == 'reset':
                raise requests.ConnectionError('inert reset')
            response.status_code = {'401': 401, 'redirect': 302, 'bad_status': 503}.get(mode, 200)
            response._content = b'{"id":"fixture-gmail-exact-123"}'
            if mode == 'missing_id':
                response._content = b'{}'
            if mode == 'non_json':
                response._content = b'inert malformed response'
        return response
    monkeypatch.setattr(requests.Session, 'send', inert_send)
    preparations = []
    def token():
        preparations.append(True)
        if mode == 'prestart_retry' and len(preparations) == 1:
            raise ValueError('inert credentials unavailable before START')
        return 'inert-token'
    monkeypatch.setattr(gmail_sender, 'prepare_journal_token', token)
    from booking_engine import invoice_email_dispatch
    rendered_paths = []
    actual_renderer = invoice_email_dispatch.render_invoice_pdf_for_service
    def observed_renderer(invoice, filename):
        from pathlib import Path
        assert preparations, 'credentials prepared before rendering and START'
        assert issuance_id in Path(filename).parent.name
        rendered_paths.append(Path(filename))
        return actual_renderer(invoice, filename)
    monkeypatch.setattr(invoice_email_dispatch, 'render_invoice_pdf_for_service', observed_renderer)
    def forbidden_side_effect(*args, **kwargs):
        pytest.fail('journal endpoint reached legacy email/calendar side effect')
    monkeypatch.setattr(service, '_bg_send_email', forbidden_side_effect)
    monkeypatch.setattr(service, '_bg_calendar_event', forbidden_side_effect)
    monkeypatch.setenv('WBE_INVOICE_JOURNAL_SITE', 'https://fixture.invalid')
    monkeypatch.setenv('WBE_SHARED_SECRET', 'fixture-only')
    monkeypatch.setenv('WBE_INVOICE_RENDERER', 'reportlab')
    monkeypatch.setattr(service, 'SHARED_SECRET', 'fixture-only')
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    with TestClient(service.app, raise_server_exceptions=False) as client:
        for invocation in range(3):
            response = client.post('/issue-invoice', headers={'X-WBE-Secret': 'fixture-only'},
                                   json={'protocol': 'owner-invoice-journal-v1', 'issuance_id': issuance_id})
            assert response.status_code == 200, response.text
            accepted = mode in ('accepted', 'paused_late_ack', 'artifact_winner') or (mode in ('ack_response_loss', 'prestart_retry') and invocation > 0)
            expected = 'preparation_retryable' if mode == 'prestart_retry' and invocation == 0 else ('provider_accepted' if accepted else 'owner_review_required')
            assert response.json()['status'] == expected
            if mode == 'prestart_retry' and invocation == 0:
                assert not any(x[1].get('operation') == 'tryStart' or 'gmail.googleapis.com' in x[0] for x in calls)
            if accepted:
                assert response.json()['providerMessageId'] == 'fixture-gmail-exact-123'
    assert rendered_paths
    assert len(set(rendered_paths)) == len(rendered_paths)
    assert all(not path.parent.exists() for path in rendered_paths)
    sends = [x for x in calls if 'gmail.googleapis.com' in x[0]]
    assert len(sends) == (0 if mode in ('start_response_loss', 'start_insert_ack_loss', 'start_readback_loss') else 1)
    if sends:
        assert sends[0][2]['allow_redirects'] is False
        assert base64.urlsafe_b64decode(sends[0][1]['raw'])
    saved = json.loads(database.read_text())
    rows = saved['rows']
    assert sum(r['kind'] == 'START' for r in rows) == 1
    acks = [r for r in rows if r['kind'] == 'ACK']
    assert len(acks) == (1 if mode in ('accepted', 'ack_response_loss', 'prestart_retry', 'paused_late_ack', 'artifact_winner') else 0)
    if acks:
        assert acks[0]['providerMessageId'] == 'fixture-gmail-exact-123'
        root_row = next(row for row in rows if row['kind'] == 'ISSUANCE')
        start_row = next(row for row in rows if row['kind'] == 'START')
        assert acks[0]['invocationNonce'] == start_row['invocationNonce']
        assert acks[0]['artifactDigest'] == start_row['artifactDigest']
        assert all(acks[0][field] == root_row[field] for field in ('documentDigest', 'to', 'cc', 'from'))
    operations = [x[1]['operation'] for x in calls if 'operation' in x[1]]
    assert operations.count('tryStart') == 1
    assert operations.count('recordAck') == (1 if mode in ('accepted', 'prestart_retry', 'paused_late_ack', 'artifact_winner') else 2 if mode in ('ack_response_loss', 'ack_never_written') else 0)
    assert all(t[1] == 'InvoiceEmailJournal' for t in saved['trace'])
    assert len(paused_observations) == (1 if mode == 'paused_late_ack' else 0)
    assert all(t[0] in ('get', 'insert') for t in saved['trace'])
    if mode == 'artifact_winner':
        assert len(artifact_candidates) == 2
        assert artifact_candidates[0]['mimeDigest'] != artifact_candidates[1]['mimeDigest']
        manifest = next(row for row in rows if row['kind'] == 'ARTIFACT')
        assert manifest == artifact_candidates[1]
        import hashlib
        assert hashlib.sha256(base64.urlsafe_b64decode(sends[0][1]['raw'])).hexdigest() == manifest['mimeDigest']
    if mode == 'accepted':
        start = next(row for row in rows if row['kind'] == 'START')
        duplicate = bridge_call({'operation': 'tryStart', 'issuanceId': issuance_id,
            'payload': {k: start[k] for k in ('artifactDigest', 'workerBootId', 'invocationNonce')}})
        assert duplicate == {'won': False}
        exact_ack = {k: acks[0][k] for k in ('artifactDigest', 'invocationNonce', 'providerMessageId')}
        assert bridge_call({'operation': 'recordAck', 'issuanceId': issuance_id, 'payload': exact_ack})['ack'] == acks[0]
        for field, changed in [('invocationNonce', 'wrong-nonce'), ('providerMessageId', 'changed-ID')]:
            env['ENDPOINT_EXPECT_STATUS'] = '409'
            denied = bridge_call({'operation': 'recordAck', 'issuanceId': issuance_id,
                                 'payload': dict(exact_ack, **{field: changed})})
            assert denied == {'error': 'journal_unavailable_or_conflict'}
        assert json.loads(database.read_text())['rows'] == rows
        assert len([x for x in calls if 'gmail.googleapis.com' in x[0]]) == 1
        # Fault copies of actual writer/renderer history before START, never
        # synthetic authority. Restore original immutable history after each case.
        original = database.read_text()
        for corruption in ('missing_chunk', 'tampered_chunk', 'oversize_manifest'):
            broken = json.loads(original)
            broken['rows'] = [row for row in broken['rows'] if row['kind'] not in ('START', 'ACK')]
            if corruption == 'missing_chunk':
                broken['rows'] = [row for row in broken['rows'] if row['kind'] != 'ARTIFACT_CHUNK']
            elif corruption == 'tampered_chunk':
                next(row for row in broken['rows'] if row['kind'] == 'ARTIFACT_CHUNK')['data'] = 'YmFk'
            else:
                next(row for row in broken['rows'] if row['kind'] == 'ARTIFACT')['byteLength'] = 8388609
            database.write_text(json.dumps(broken))
            before_calls, before_render, before_token = len(calls), len(rendered_paths), len(preparations)
            with TestClient(service.app) as invalid_artifact_client:
                denied = invalid_artifact_client.post('/issue-invoice', headers={'X-WBE-Secret': 'fixture-only'},
                    json={'protocol': 'owner-invoice-journal-v1', 'issuance_id': issuance_id})
            assert denied.status_code == 200
            assert denied.json()['status'] == 'journal_unavailable'
            assert [call[1]['operation'] for call in calls[before_calls:]] == ['readIssuance']
            assert len(rendered_paths) == before_render and len(preparations) == before_token
            assert json.loads(database.read_text())['rows'] == broken['rows']
            database.write_text(original)
    # N8: fresh module objects and code, not a changed BOOT_ID on the old worker.
    # Retain the actual JS writer's START/ACK database and trap all restart IO.
    if mode in ('accepted', 'timeout'):
        env.pop('ENDPOINT_EXPECT_STATUS', None)
        import importlib, sys, booking_engine
        old_dispatch = invoice_email_dispatch
        old_journal = sys.modules['booking_engine.invoice_email_journal']
        with monkeypatch.context() as restart_patch:
            for name in ('invoice_email_dispatch', 'invoice_email_journal'):
                restart_patch.delitem(sys.modules, 'booking_engine.' + name)
                restart_patch.delattr(booking_engine, name)
            fresh_dispatch = importlib.import_module('booking_engine.invoice_email_dispatch')
            fresh_journal = importlib.import_module('booking_engine.invoice_email_journal')
            assert fresh_dispatch is not old_dispatch
            assert fresh_dispatch.dispatch_issuance is not old_dispatch.dispatch_issuance
            assert fresh_dispatch.BOOT_ID != old_dispatch.BOOT_ID
            assert fresh_journal is not old_journal
            before_calls = len(calls)
            before_history = json.loads(database.read_text())
            with TestClient(service.app) as restarted_client:
                restarted = restarted_client.post('/issue-invoice', headers={'X-WBE-Secret': 'fixture-only'},
                    json={'protocol': 'owner-invoice-journal-v1', 'issuance_id': issuance_id})
            assert restarted.status_code == 200
            assert restarted.json()['status'] == ('provider_accepted' if mode == 'accepted' else 'owner_review_required')
            assert [call[1].get('operation') for call in calls[before_calls:]] == ['readIssuance']
            after_history = json.loads(database.read_text())
            assert after_history['rows'] == before_history['rows']
            assert all(call[0] == 'get' for call in after_history['trace'][len(before_history['trace']):])
            if mode == 'accepted':
                assert restarted.json()['providerMessageId'] == 'fixture-gmail-exact-123'
            for fixture in ('status', 'dispatch-retained'):
                detail = bridge_call({'fixture': fixture, 'issuanceId': issuance_id})
                assert {k: detail[k] for k in restarted.json()} == restarted.json()
                assert detail['classification'] == ('ack_provider_accepted' if mode == 'accepted' else 'start_uncertain')
    (tmp_path / 'http-trace.json').write_text(json.dumps(calls, default=str))


@pytest.mark.parametrize('command', [
    {'protocol': 'wrong', 'issuance_id': 'a' * 64},
    {'protocol': 'owner-invoice-journal-v1', 'issuance_id': ['a' * 64]},
    {'protocol': 'owner-invoice-journal-v1', 'issuance_id': 'A' * 64},
    {'protocol': 'owner-invoice-journal-v1', 'issuance_id': 'a' * 64, 'callbackUrl': 'https://forbidden.invalid'},
    {'protocol': 'owner-invoice-journal-v1'},
])
def test_n1_malformed_actual_endpoint_zero_io(monkeypatch, command):
    import requests
    from booking_engine import invoice_email_dispatch
    def denied(*args, **kwargs):
        pytest.fail('malformed command reached rendering or HTTP')
    monkeypatch.setattr(requests.Session, 'send', denied)
    monkeypatch.setattr(invoice_email_dispatch, 'render_invoice_pdf_for_service', denied)
    monkeypatch.setattr(service, 'SHARED_SECRET', 'fixture-only')
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    with TestClient(service.app) as client:
        assert client.post('/issue-invoice', headers={'X-WBE-Secret': 'fixture-only'}, json=command).status_code == 422
        assert client.post('/issue-invoice', headers={'X-WBE-Secret': 'wrong'}, json=command).status_code == 401


@pytest.mark.parametrize('root_mode', ['missing', 'tampered'])
def test_n1_shared_secret_without_valid_root_zero_render_send(tmp_path, monkeypatch, root_mode):
    import os, json, subprocess, requests
    from booking_engine import invoice_email_dispatch
    database = tmp_path / 'journal.json'
    env = dict(os.environ, ENDPOINT_FIXTURE=str(database))
    def bridge(payload):
        run = subprocess.run(['node', '--experimental-vm-modules', 'scripts/verify-essential-email-dispatch.js'],
            input=json.dumps(payload), text=True, capture_output=True, env=env, timeout=20)
        assert run.returncode == 0, run.stderr
        return json.loads(run.stdout)
    admission = bridge({'fixture': 'prepare'})
    saved = json.loads(database.read_text())
    if root_mode == 'missing':
        saved['rows'] = [row for row in saved['rows'] if row['kind'] != 'ISSUANCE']
    else:
        next(row for row in saved['rows'] if row['kind'] == 'ISSUANCE')['documentDigest'] = '0' * 64
    database.write_text(json.dumps(saved))
    env['ENDPOINT_EXPECT_STATUS'] = '409'
    calls = []
    def inert(self, request, **kwargs):
        assert request.url == 'https://fixture.invalid/_functions/invoiceEmailJournal'
        calls.append(json.loads(request.body))
        response = requests.Response()
        response.status_code = 409
        response._content = json.dumps(bridge(calls[-1])).encode()
        return response
    def denied(*args, **kwargs):
        pytest.fail('invalid authority rendered or prepared provider token')
    monkeypatch.setattr(requests.Session, 'send', inert)
    monkeypatch.setattr(invoice_email_dispatch, 'render_invoice_pdf_for_service', denied)
    monkeypatch.setattr(invoice_email_dispatch.gmail_sender, 'prepare_journal_token', denied)
    monkeypatch.setenv('WBE_INVOICE_JOURNAL_SITE', 'https://fixture.invalid')
    monkeypatch.setenv('WBE_SHARED_SECRET', 'fixture-only')
    monkeypatch.setattr(service, 'SHARED_SECRET', 'fixture-only')
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    with TestClient(service.app) as client:
        response = client.post('/issue-invoice', headers={'X-WBE-Secret': 'fixture-only'},
            json={'protocol': 'owner-invoice-journal-v1', 'issuance_id': admission['issuanceId']})
    assert response.status_code == 200
    assert response.json()['status'] == 'journal_unavailable'
    assert [call['operation'] for call in calls] == ['readIssuance']
    assert json.loads(database.read_text())['rows'] == saved['rows']
