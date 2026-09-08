"""Bounded discovery through actual startup/bridge; external IO inert."""
import importlib
import pytest
import invoice_service as service


@pytest.fixture(autouse=True)
def fresh_local_positions(monkeypatch):
    monkeypatch.setattr(service, '_owner_invoice_recovery_state', service._OwnerInvoiceRecoveryState())


@pytest.mark.parametrize('purpose', ['guest_invoice', 'owner_copy'])
def test_PR01_actual_startup_request_only(recovery_io, monkeypatch, purpose):
    from fastapi.testclient import TestClient
    io = recovery_io
    io.bridge({'fixture': 'prepare-request-only', 'purpose': purpose})
    before = io.saved()
    assert [r['kind'] for r in before['rows']] == ['REQUEST']
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    with TestClient(service.app): pass
    assert io.calls[0][1] == {'operation': 'recoverRequests', 'cursor': None}
    operations = [b.get('operation', 'provider') for u, b in io.calls]
    assert operations.index('recoverRequests') < operations.index('scanPending') < operations.index('tryStart')
    after = io.saved()
    request = before['rows'][0]
    root = next(r for r in after['rows'] if r['kind'] == 'ISSUANCE')
    assert root['_id'] == request['issuanceId']
    assert root['document'] == request['document'] and root['actorId'] == request['actorId']
    assert root['purpose'] == purpose
    assert sum(r['kind'] == 'START' for r in after['rows']) == 1
    assert sum(r['kind'] == 'ACK' for r in after['rows']) == 1
    assert all(t[1] == 'InvoiceEmailJournal' for t in after['trace'])


@pytest.mark.parametrize('status', ['partial', 'unavailable'])
@pytest.mark.parametrize('topology', ['forward', 'nonobserved', 'first_page', 'null', 'valid_hold', 'valid_prior'])
def test_PR04_C1_cursor_topology_actual_adapter(monkeypatch, status, topology):
    import json, requests
    from booking_engine import invoice_email_recovery as recovery
    report = _pr04_report('prior_partial' if status == 'partial' else 'prior_unavailable')
    report.update(insertAttempts=0, attemptedRequestId=None)
    report['outcomes'][0]['result'] = 'already_present'
    if topology == 'forward': report['nextCursor'] = 'f'*64
    elif topology == 'nonobserved': report['nextCursor'] = '1f'*32
    elif topology in ('first_page', 'valid_hold'):
        report.update(pages=1, examined=2, outcomes=[dict(requestId='1'*64, result='unresolved')],
                      deferred=[dict(requestId='2'*64, issuanceId='a'*64, result='deferred')],
                      nextCursor=('2' if topology == 'first_page' else '0')*64)
        if status == 'unavailable':
            report.update(examined=0, outcomes=[], deferred=[])
    elif topology == 'null': report['nextCursor'] = None
    calls = []
    def inert(session, request, **kwargs):
        body = json.loads(request.body); calls.append(body)
        response = requests.Response(); response.status_code = 200
        data = report if body['operation'] == 'recoverRequests' else dict(
            protocol='owner-invoice-review-page/v1', items=[], nextCursor=None,
            cycleEndObserved=True, scanStatus='ok', snapshot=False)
        response._content = json.dumps(data).encode(); return response
    monkeypatch.setattr(requests.Session, 'send', inert)
    monkeypatch.setenv('WBE_INVOICE_JOURNAL_SITE', 'https://fixture.invalid')
    monkeypatch.setenv('WBE_SHARED_SECRET', 'fixture-only')
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    monkeypatch.setattr(recovery, 'dispatch_issuance', lambda *a: pytest.fail('admission granted dispatch'))
    state = service._owner_invoice_recovery_state
    state.request_cursor = '0'*64; state.issuance_cursor = 'b'*64
    result = service.recover_owner_invoice_periodic_once()
    valid = topology.startswith('valid_')
    assert result['admission']['status'] == (status if valid else 'malformed_response')
    assert state.request_cursor == ('2'*64 if topology == 'valid_prior' else '0'*64)
    assert state.issuance_cursor is None and result['attempts'] == 0
    assert calls == [dict(operation='recoverRequests', cursor='0'*64), dict(operation='scanPending', cursor='b'*64)]


def test_PR04_C2_malformed_after_actual_JS_work(recovery_io, monkeypatch):
    io = recovery_io
    io.bridge({'fixture': 'prepare-request-only'})
    request = io.saved()['rows'][0]
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    state = service._owner_invoice_recovery_state
    state.request_cursor = '0'*64
    state.issuance_cursor = 'f'*64  # independently scanned empty tail, no direct admission dispatch
    def corrupt(op, report):
        if op == 'recoverRequests':
            assert report['attemptedRequestId'] == request['_id']
            assert any(r['kind'] == 'ISSUANCE' for r in io.saved()['rows'])
            report.update(status='partial', cycleEndObserved=False, nextCursor='f'*64)
    io.hook = corrupt
    result = service.recover_owner_invoice_periodic_once()
    assert result['admission'] == {'status': 'malformed_response'}
    assert state.request_cursor == '0'*64 and state.issuance_cursor is None
    assert [b['operation'] for u, b in io.calls] == ['recoverRequests', 'scanPending']
    assert not any(r['kind'] == 'START' for r in io.saved()['rows'])


@pytest.mark.parametrize('lane', ['request', 'root'])
def test_PR05_PR06_F_mixed_failure_rotation(recovery_io, monkeypatch, lane):
    from booking_engine import gmail_sender
    io = recovery_io
    for seed in (3, 4, 5, 6, 7):
        io.bridge({'fixture': 'prepare-request-only' if lane == 'request' else 'prepare'}, seed)
    initial = io.saved()
    ordered = sorted(r['_id'] for r in initial['rows'] if r['kind'] == ('REQUEST' if lane == 'request' else 'ISSUANCE'))
    if lane == 'request': io.mode = 'lowest_request_insert'
    else:
        def token():
            identity = next(b['issuanceId'] for u, b in reversed(io.calls) if b.get('operation') == 'readIssuance')
            if identity == ordered[0]: raise ValueError('inert lowest-only preparation failure')
            return 'inert-token'
        monkeypatch.setattr(gmail_sender, 'prepare_journal_token', token)
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    state = service._owner_invoice_recovery_state
    attempts = []
    for expected in [*ordered, None, ordered[0]]:
        before_request, before_root = state.request_cursor, state.issuance_cursor
        start = len(io.calls)
        result = service.recover_owner_invoice_periodic_once()
        admission = result['admission']
        assert result['status'] in ('ok', 'degraded')
        assert io.calls[start][1] == dict(operation='recoverRequests', cursor=before_request)
        scans = [b for u, b in io.calls[start:] if b.get('operation') == 'scanPending']
        assert 1 <= len(scans) <= 2 and scans[0]['cursor'] == before_root
        assert sum(b.get('operation') == 'recoverRequests' for u, b in io.calls[start:]) == 1
        for report, attempt_key, previous, actual in [
            (admission, 'attemptedRequestId', before_request, state.request_cursor),
            (result, 'attemptedIssuanceId', before_root, state.issuance_cursor)]:
            attempt = report.get(attempt_key)
            assert actual == (attempt if attempt is not None else None if report['cycleEndObserved'] else report['nextCursor'])
        attempt = admission['attemptedRequestId'] if lane == 'request' else result['attemptedIssuanceId']
        attempts.append(attempt)
        assert attempt == expected
        if expected == ordered[0]:
            if lane == 'request':
                assert admission['status'] == 'partial' and admission['insertAttempts'] == 1
                assert admission['outcomes'][0]['result'] == 'unresolved'
            else: assert result['outcomes'][0]['status'] == 'preparation_retryable'
        if expected is None:
            assert (state.request_cursor if lane == 'request' else state.issuance_cursor) is None
            assert len(scans) == 1  # no same-tick reset scan
        assert set(vars(state)) == {'request_cursor', 'issuance_cursor', 'lock'}
    assert attempts == [*ordered, None, ordered[0]]
    saved = io.saved()
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 4
    assert sum(r['kind'] == 'START' for r in saved['rows']) == 4
    assert sum(r['kind'] == 'ACK' for r in saved['rows']) == 4
    if lane == 'request':
        low = next(r for r in initial['rows'] if r['_id'] == ordered[0])
        assert not any(r['_id'] == low['issuanceId'] for r in saved['rows'])
        inserts = [t[2] for t in saved['trace'][len(initial['trace']):] if t[0] == 'insert']
        root_ids = {r['issuanceId'] for r in initial['rows']}
        assert [i for i in inserts if i in root_ids] == [next(r['issuanceId'] for r in initial['rows'] if r['_id'] == rid) for rid in attempts if rid]
    assert all(t[1] == 'InvoiceEmailJournal' for t in saved['trace'])


def test_PR05_PR06_attempt_rotation_and_wrap(recovery_io, monkeypatch):
    from booking_engine import gmail_sender
    io = recovery_io
    for seed in (3, 4, 5, 6, 7):
        io.bridge({'fixture': 'prepare-request-only'}, seed)
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    def fail(): raise ValueError('inert permanent preparation failure')
    monkeypatch.setattr(gmail_sender, 'prepare_journal_token', fail)
    attempts = []
    for _ in range(12):
        start = len(io.calls)
        result = service.recover_owner_invoice_periodic_once()
        if result.get('attemptedIssuanceId'): attempts.append(result['attemptedIssuanceId'])
        assert result['bridgeOperations'] <= 128
        assert io.calls[start][1]['operation'] == 'recoverRequests'
    assert len(set(attempts)) == 5
    assert len(attempts) > 5
    requests = [b['cursor'] for u, b in io.calls if b.get('operation') == 'recoverRequests']
    assert requests[1] == sorted(r['_id'] for r in io.saved()['rows'] if r['kind'] == 'REQUEST')[0]
    assert requests.count(None) > 1
    assert not any('gmail.googleapis.com' in u for u, b in io.calls)


def test_PR02_PR10_OFF_and_nonblocking_overlap(recovery_io, monkeypatch):
    io = recovery_io
    assert service.recover_owner_invoice_periodic_once() == {'status': 'disabled'}
    io.prepare()
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    observed = []
    def paused(op, result):
        if op != 'recoverRequests': return
        io.hook = None
        count = len(io.calls)
        observed.append(service.recover_owner_invoice_periodic_once())
        assert len(io.calls) == count
    io.hook = paused
    service.recover_owner_invoice_periodic_once()
    assert observed == [{'status': 'busy'}]


@pytest.mark.parametrize('failure', [False, True])
def test_PR10_T1_threaded_transport_release(recovery_io, monkeypatch, failure):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from booking_engine.invoice_email_journal import InvoiceEmailJournal
    io = recovery_io; io.prepare()
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    entered, release = Event(), Event()
    configs = []
    original = InvoiceEmailJournal.from_environment
    def configured():
        configs.append(True)
        return original()
    monkeypatch.setattr(InvoiceEmailJournal, 'from_environment', configured)
    def barrier(op, report):
        if op == 'recoverRequests':
            entered.set()
            assert release.wait(15), 'transport barrier watchdog'
            if failure:
                import requests
                raise requests.Timeout('inert completed transport exception')
    io.hook = barrier
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(service.recover_owner_invoice_periodic_once)
        try:
            assert entered.wait(15)
            state = service._owner_invoice_recovery_state
            before = (len(io.calls), len(configs), state.request_cursor, state.issuance_cursor, io.saved())
            assert service.recover_owner_invoice_periodic_once() == {'status': 'busy'}
            assert not first.done() and state.lock.locked()
            assert before == (len(io.calls), len(configs), state.request_cursor, state.issuance_cursor, io.saved())
        finally: release.set()
        result = first.result(timeout=20)
    assert result['admission']['status'] == ('transport_error' if failure else 'ok')
    assert not state.lock.locked()
    io.hook = None
    assert service.recover_owner_invoice_periodic_once()['status'] != 'busy'
    def config_failure(): raise ValueError('inert configuration completion')
    monkeypatch.setattr(InvoiceEmailJournal, 'from_environment', config_failure)
    assert service.recover_owner_invoice_periodic_once() == {'status': 'unavailable'}
    assert not state.lock.locked()
    monkeypatch.setattr(InvoiceEmailJournal, 'from_environment', configured)
    assert service.recover_owner_invoice_periodic_once()['status'] != 'busy'
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 1


def test_PR10_T2_fresh_worker_preSTART_arbitration(recovery_io, monkeypatch):
    """Two module workers, deterministic overlap; not OS/distributed fairness."""
    import sys, booking_engine
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, current_thread
    from booking_engine import invoice_email_dispatch, invoice_email_journal, invoice_email_recovery
    io = recovery_io; io.bridge({'fixture': 'prepare-request-only'})
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    entered, release = Event(), Event()
    old = {n: sys.modules['booking_engine.' + n] for n in
           ('invoice_email_dispatch', 'invoice_email_journal', 'invoice_email_recovery')}
    def barrier(op, report):
        if op == 'before_tryStart' and current_thread().name.startswith('original'):
            assert not any(r['kind'] == 'START' for r in io.saved()['rows'])
            entered.set(); assert release.wait(20), 'pre-START watchdog'
    io.hook = barrier
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix='original') as pool:
        first = pool.submit(service.recover_owner_invoice_periodic_once)
        try:
            assert entered.wait(15)
            with monkeypatch.context() as fresh:
                fresh.delitem(sys.modules, 'invoice_service')
                for n in old:
                    fresh.delitem(sys.modules, 'booking_engine.' + n); fresh.delattr(booking_engine, n)
                rebuilt = importlib.import_module('invoice_service')
                assert rebuilt is not service
                assert rebuilt._owner_invoice_recovery_state.lock is not service._owner_invoice_recovery_state.lock
                assert rebuilt._owner_invoice_recovery_state.request_cursor is None
                for n in old:
                    assert importlib.import_module('booking_engine.' + n) is not old[n]
                assert sys.modules['booking_engine.invoice_email_dispatch'].BOOT_ID != old['invoice_email_dispatch'].BOOT_ID
                fresh.setattr(rebuilt, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
                second = rebuilt.recover_owner_invoice_periodic_once()
                assert second['attempts'] == 1 and not first.done()
        finally: release.set()
        assert first.result(timeout=20)['attempts'] == 1
    saved = io.saved()
    assert sum(r['kind'] == 'ISSUANCE' for r in saved['rows']) == 1
    start = next(r for r in saved['rows'] if r['kind'] == 'START')
    assert sum(r['kind'] == 'START' for r in saved['rows']) == 1
    assert sum(t[0] == 'insert' and t[2] == start['_id'] for t in saved['trace']) == 2  # winner + rejected duplicate, one stored START
    assert sum(b.get('operation') == 'tryStart' for u, b in io.calls) == 2
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 1
    io.hook = None
    for _ in range(3): service.recover_owner_invoice_periodic_once()
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 1


@pytest.mark.parametrize('lane', ['request', 'root'])
@pytest.mark.parametrize('after_end', [False, True])
def test_PR08_I1_lower_insert_after_progress_or_end(recovery_io, monkeypatch, lane, after_end):
    io = recovery_io
    # Select actual writer-derived IDs in isolated retained stores, not fabricated authority.
    original_db = io.database
    candidates = []
    for seed in (3, 4, 5):
        io.database = original_db.with_name('candidate-' + str(seed) + '.json')
        io.prepare(seed)
        row = next(r for r in io.saved()['rows'] if r['kind'] == ('REQUEST' if lane == 'request' else 'ISSUANCE'))
        candidates.append((row['_id'], seed))
    io.database = original_db
    low, high = sorted(candidates)[0], sorted(candidates)[-1]
    io.bridge({'fixture': 'prepare-request-only' if lane == 'request' else 'prepare'}, high[1])
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    state = service._owner_invoice_recovery_state
    service.recover_owner_invoice_periodic_once()
    assert (state.request_cursor if lane == 'request' else state.issuance_cursor) == high[0]
    if after_end:
        result = service.recover_owner_invoice_periodic_once()
        assert (result['admission'] if lane == 'request' else result)['cycleEndObserved'] is True
        assert (state.request_cursor if lane == 'request' else state.issuance_cursor) is None
    io.bridge({'fixture': 'prepare-request-only' if lane == 'request' else 'prepare'}, low[1])
    retained = io.saved()
    low_request = next(r for r in retained['rows'] if r['kind'] == 'REQUEST' and
                       (r['_id'] if lane == 'request' else r['issuanceId']) == low[0])
    found = []
    for _ in range(4):
        result = service.recover_owner_invoice_periodic_once()
        found.append(result['admission'].get('attemptedRequestId') if lane == 'request' else result['attemptedIssuanceId'])
    assert low[0] in found
    root = next(r for r in io.saved()['rows'] if r['_id'] == low_request['issuanceId'])
    assert root['document'] == low_request['document']
    assert sum(r['kind'] == 'START' and r['issuanceId'] == root['_id'] for r in io.saved()['rows']) == 1


def test_PR08_I2_stage_change_after_absence(recovery_io, monkeypatch):
    io = recovery_io; io.bridge({'fixture': 'prepare-request-only'})
    request = io.saved()['rows'][0]
    io.mode = 'stage_after_absence'
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    service._owner_invoice_recovery_state.issuance_cursor = 'f'*64
    result = service.recover_owner_invoice_periodic_once()
    saved = io.saved()
    assert any(r['kind'] == 'START' for r in saved['rows']), 'actual stage schedule executed'
    assert result['attempts'] == 0
    assert 'grant' not in str(result['admission']).lower()
    assert sum(r['kind'] == 'ISSUANCE' for r in saved['rows']) == 1
    assert next(r for r in saved['rows'] if r['_id'] == request['issuanceId'])['document'] == request['document']
    assert not any('gmail.googleapis.com' in u for u, b in io.calls)
    io.mode = ''
    for _ in range(3): service.recover_owner_invoice_periodic_once()
    assert not any('gmail.googleapis.com' in u for u, b in io.calls)
    assert sum(r['kind'] == 'START' for r in io.saved()['rows']) == 1


def test_PR08_I3_qualified_child_after_parent_START(recovery_io, monkeypatch):
    io = recovery_io; parent = io.prepare()
    io.bridge({'fixture': 'prepare-child-request-only', 'parentIssuanceId': parent['issuanceId']}, 3)
    before = io.saved()
    child = next(r for r in before['rows'] if r['kind'] == 'REQUEST' and r['issuanceId'] != parent['issuanceId'])
    assert not any(r['_id'] == child['issuanceId'] for r in before['rows'])
    # Start parent through actual standalone dispatcher before the composed admission.
    from booking_engine.invoice_email_dispatch import dispatch_issuance
    io.mode = 'ack_never_written'
    dispatch_issuance(parent['issuanceId'], io.adapter())
    started = io.saved()
    assert any(r['kind'] == 'START' and r['issuanceId'] == parent['issuanceId'] for r in started['rows'])
    assert not any(r['kind'] == 'ACK' for r in started['rows'])
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    service._owner_invoice_recovery_state.issuance_cursor = 'f'*64
    result = service.recover_owner_invoice_periodic_once()
    assert any(o.get('issuanceId') == child['issuanceId'] and o['result'] == 'recovered' for o in result['admission']['outcomes'])
    after = io.saved()
    assert next(r for r in after['rows'] if r['_id'] == child['_id']) == child
    root = next(r for r in after['rows'] if r['_id'] == child['issuanceId'])
    assert root['document'] == child['document']
    import json
    assert json.loads(root['document'])['revision'] == json.loads(child['document'])['revision']
    assert len([r for r in after['rows'] if r['kind'] == 'REQUEST']) == 2
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 1
    assert result['attempts'] == 0  # admission is not dispatch authority
    io.mode = ''
    for _ in range(4): service.recover_owner_invoice_periodic_once()
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 2
    assert sum(r['kind'] == 'START' for r in io.saved()['rows']) == 2


@pytest.mark.parametrize('purpose', ['guest_invoice', 'owner_copy'])
def test_PR01_F_fresh_REQUEST_startup(recovery_io, monkeypatch, purpose):
    import sys, booking_engine
    from fastapi.testclient import TestClient
    from booking_engine import invoice_email_dispatch, invoice_email_journal, invoice_email_recovery
    io = recovery_io
    io.bridge({'fixture': 'prepare-request-only', 'purpose': purpose})
    retained = io.saved()
    assert [r['kind'] for r in retained['rows']] == ['REQUEST']
    old = {n: sys.modules['booking_engine.' + n] for n in
           ('invoice_email_dispatch', 'invoice_email_journal', 'invoice_email_recovery')}
    with monkeypatch.context() as fresh:
        fresh.delitem(sys.modules, 'invoice_service')
        for n in old:
            fresh.delitem(sys.modules, 'booking_engine.' + n)
            fresh.delattr(booking_engine, n)
        rebuilt = importlib.import_module('invoice_service')
        assert rebuilt is not service
        for n in old:
            assert importlib.import_module('booking_engine.' + n) is not old[n]
        assert rebuilt._owner_invoice_recovery_state.request_cursor is None
        assert rebuilt._owner_invoice_recovery_state.issuance_cursor is None
        fresh.setattr(rebuilt, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
        with TestClient(rebuilt.app): pass
    operations = [b.get('operation', 'provider') for u, b in io.calls]
    assert operations[0] == 'recoverRequests'
    assert operations.index('recoverRequests') < operations.index('scanPending') < operations.index('tryStart')
    request = retained['rows'][0]
    root = next(r for r in io.saved()['rows'] if r['kind'] == 'ISSUANCE')
    assert root['_id'] == request['issuanceId'] and root['document'] == request['document']
    assert root['actorId'] == request['actorId'] and root['purpose'] == purpose
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 1


def test_PR01_F_causal_admission_order(recovery_io):
    import types
    from pathlib import Path
    from booking_engine import invoice_email_recovery as recovery
    io = recovery_io
    io.bridge({'fixture': 'prepare-request-only'})
    source = Path(recovery.__file__).read_text()
    target = 'admission = budget.recover_requests(request_cursor)'
    assert source.count(target) == 1
    # Omission mutant executes real root discovery, never fabricated authority.
    mutant = types.ModuleType('booking_engine.inert_missing_admission')
    mutant.__package__ = 'booking_engine'
    exec(compile(source.replace(target, "admission = {'status': 'disabled'}"),
                 '<missing-admission>', 'exec'), mutant.__dict__)
    result = mutant.recover_integrated_once(io.adapter())
    assert result['attempts'] == 0
    assert [b['operation'] for u, b in io.calls] == ['scanPending']
    assert not any(r['kind'] == 'ISSUANCE' for r in io.saved()['rows'])
    # The same caller-first assertion reverses for the causal omission.
    with pytest.raises(AssertionError):
        assert io.calls[0][1]['operation'] == 'recoverRequests'
    io.calls.clear()
    assert recovery.recover_integrated_once(io.adapter())['attempts'] == 1
    assert io.calls[0][1]['operation'] == 'recoverRequests'


@pytest.fixture
def lifecycle_inert(monkeypatch):
    import requests
    from booking_engine import invoice_email_journal, gmail_sender
    def deny(*a, **kw):
        pytest.fail('lifecycle reached external effect')
    monkeypatch.setattr(invoice_email_journal.InvoiceEmailJournal, 'from_environment', deny)
    monkeypatch.setattr(requests.Session, 'send', deny)
    monkeypatch.setattr(gmail_sender, 'prepare_journal_token', deny)
    monkeypatch.setattr(service, '_bg_send_email', deny)
    monkeypatch.setattr(service, '_bg_calendar_event', deny)
    monkeypatch.setattr(service, 'render_invoice_pdf_for_service', deny)


@pytest.mark.parametrize('recurring', [False, True])
def test_L02_actual_client_OFF_no_resources(monkeypatch, lifecycle_inert, recurring):
    import ast
    from pathlib import Path
    from fastapi.testclient import TestClient
    source = ast.parse(Path(service.__file__).read_text())
    gates = {n.targets[0].id: n.value.value for n in source.body
             if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
             and isinstance(n.value, ast.Constant)}
    assert gates['OWNER_INVOICE_JOURNAL_ENABLED'] is False
    assert gates['OWNER_INVOICE_RECURRING_ENABLED'] is False
    monkeypatch.setattr(service, 'OWNER_INVOICE_RECURRING_ENABLED', recurring)
    def deny(*a, **kw): pytest.fail('OFF admitted worker')
    monkeypatch.setattr(service, 'recover_owner_invoice_periodic_once', deny)
    monkeypatch.setattr(service, 'Thread', deny)
    state = service._owner_invoice_recovery_state
    before = (state.request_cursor, state.issuance_cursor, tuple(service.app.routes))
    with TestClient(service.app):
        owner = service._owner_invoice_invocation
        assert owner.thread is None and owner.task is None
    assert not owner.active
    assert before == (state.request_cursor, state.issuance_cursor, tuple(service.app.routes))


def test_L03_cadence_statuses_reentry_and_gate_stop(monkeypatch, lifecycle_inert, caplog):
    import asyncio, threading, logging
    caplog.set_level(logging.INFO, logger='uvicorn.error')
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    monkeypatch.setattr(service, 'OWNER_INVOICE_RECURRING_ENABLED', True)
    marker = 'PRIVATE-recipient-token-payload'
    values = [{'status': s} for s in ['busy', 'degraded', 'unavailable']]
    values += [{'status': marker}, ValueError(marker), {'status': 'ok'}]
    trace = []; threads = []; state = service._owner_invoice_recovery_state
    def tick():
        assert service._owner_invoice_recovery_state is state
        assert not any(t.is_alive() for t in threads)
        threads.append(threading.current_thread())
        value = values[len(threads)-1]
        trace.append('complete')
        if isinstance(value, Exception): raise value
        return value
    monkeypatch.setattr(service, 'recover_owner_invoice_periodic_once', tick)
    async def scenario():
        reached = asyncio.Queue(); release = asyncio.Queue()
        async def delay(seconds):
            assert seconds == 60
            trace.append('delay'); reached.put_nowait(True)
            await release.get()
        monkeypatch.setattr(service, '_owner_invoice_delay', delay)
        async with service.app.router.lifespan_context(service.app):
            owner = service._owner_invoice_invocation
            for i in range(len(values)):
                await asyncio.wait_for(reached.get(), 2)
                assert len(threads) == i + 1
                assert trace == ['complete', 'delay'] * (i + 1)
                assert service.recover_owner_invoice_periodic_once is tick
                if i == 0:
                    with pytest.raises(RuntimeError, match='^owner_invoice_lifespan_active$'):
                        async with service.app.router.lifespan_context(service.app): pass
                if i < len(values)-1: release.put_nowait(True)
            monkeypatch.setattr(service, 'OWNER_INVOICE_RECURRING_ENABLED', False)
            release.put_nowait(True)
            await asyncio.wait_for(owner.task, 2)
        assert owner.task.done() and not owner.active
        assert len(threads) == len(values)
    asyncio.run(asyncio.wait_for(scenario(), 8))
    messages = [r.getMessage() for r in caplog.records if r.name == 'uvicorn.error']
    assert marker not in '\n'.join(messages)
    assert [m for m in messages if 'pass_complete' in m] == [
        'owner_invoice_pass_complete ' + s for s in
        ['busy', 'degraded', 'unavailable', 'invalid_result', 'unavailable', 'ok']]
    assert messages.count('owner_invoice_tick_failure') == 1


@pytest.mark.parametrize('mode', ['sleeping', 'drain', 'timeout', 'startup_cancel'])
def test_L04_shutdown_and_responsiveness(monkeypatch, lifecycle_inert, caplog, mode):
    import asyncio, threading, httpx
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    monkeypatch.setattr(service, 'OWNER_INVOICE_RECURRING_ENABLED', True)
    actual_tick = service.recover_owner_invoice_periodic_once
    state = service._owner_invoice_recovery_state
    before = (state.request_cursor, state.issuance_cursor)
    entered = threading.Event(); release = threading.Event(); calls = []
    def tick():
        calls.append(True)
        if mode != 'startup_cancel' and len(calls) == 1: return {'status': 'ok'}
        with state.lock:
            entered.set()
            assert release.wait(3), 'test barrier watchdog'
        return {'status': 'ok'}
    monkeypatch.setattr(service, 'recover_owner_invoice_periodic_once', tick)
    async def scenario():
        delayed = asyncio.Event(); advance = asyncio.Event()
        async def delay(seconds):
            assert seconds == 60
            delayed.set(); await advance.wait()
        monkeypatch.setattr(service, '_owner_invoice_delay', delay)
        cm = service.app.router.lifespan_context(service.app)
        startup = asyncio.create_task(cm.__aenter__())
        if mode != 'startup_cancel':
            await startup
            await asyncio.wait_for(delayed.wait(), 2)
            if mode != 'sleeping': advance.set()
        if mode != 'sleeping':
            while not entered.is_set(): await asyncio.sleep(0)
            assert actual_tick() == {'status': 'busy'}
            assert before == (state.request_cursor, state.issuance_cursor)
            heartbeat = []
            asyncio.get_running_loop().call_soon(heartbeat.append, True)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=service.app),
                                         base_url='http://inert') as client:
                assert (await client.get('/')).json()['status'] == 'ok'
            assert heartbeat == [True]
        owner = service._owner_invoice_invocation
        assert service._OWNER_INVOICE_SHUTDOWN_GRACE == 5
        if mode in ('timeout', 'startup_cancel'):
            # Inject elapsed monotonic grace, never wait five real seconds.
            monkeypatch.setattr(service, '_OWNER_INVOICE_SHUTDOWN_GRACE', 0)
        if mode == 'startup_cancel':
            startup.cancel()
            with pytest.raises(asyncio.CancelledError): await startup
        else:
            closing = asyncio.create_task(cm.__aexit__(None, None, None))
            await asyncio.sleep(0)
            if mode == 'drain':
                assert not closing.done()
                release.set()
            await asyncio.wait_for(closing, 2)
        assert owner.stopping and not owner.active
        assert owner.task is None or owner.task.done()
        count = len(calls)
        if mode in ('timeout', 'startup_cancel'):
            assert owner.thread.is_alive() and state.lock.locked()
            with pytest.raises(RuntimeError, match='^owner_invoice_lifespan_active$'):
                async with service.app.router.lifespan_context(service.app): pass
            assert 'owner_invoice_shutdown_inflight' in caplog.text
        release.set()
        while owner.thread.is_alive(): await asyncio.sleep(0)
        assert owner.done.is_set() and not state.lock.locked()
        assert len(calls) == count
        monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', False)
        async with service.app.router.lifespan_context(service.app):
            assert service._owner_invoice_invocation is not owner
    try:
        asyncio.run(asyncio.wait_for(scenario(), 5))
    finally:
        release.set()
        owner = service._owner_invoice_invocation
        if owner and owner.thread: owner.thread.join(2)  # Test thread only, never ASGI.


@pytest.mark.parametrize('failure', ['thread', 'runner'])
def test_L05_terminal_failure_consumed(monkeypatch, lifecycle_inert, caplog, failure):
    import asyncio
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    monkeypatch.setattr(service, 'OWNER_INVOICE_RECURRING_ENABLED', True)
    calls = []
    def tick():
        calls.append(True)
        if failure == 'thread': raise SystemExit('PRIVATE-terminal-payload')
        return {'status': 'ok'}
    monkeypatch.setattr(service, 'recover_owner_invoice_periodic_once', tick)
    async def delay(seconds): raise ValueError('PRIVATE-terminal-payload')
    monkeypatch.setattr(service, '_owner_invoice_delay', delay)
    async def scenario():
        async with service.app.router.lifespan_context(service.app):
            owner = service._owner_invoice_invocation
            if owner.task: await asyncio.wait_for(owner.task, 2)
            else: assert owner.terminal
        assert len(calls) == 1
    asyncio.run(asyncio.wait_for(scenario(), 3))
    assert 'PRIVATE-terminal-payload' not in caplog.text
    assert sum(r.getMessage() == 'owner_invoice_terminal_failure' for r in caplog.records) == 1


def test_L01_actual_lifespan_startup_offloop(monkeypatch, lifecycle_inert):
    import asyncio, threading
    from fastapi.testclient import TestClient
    calls = []
    def tick():
        try:
            asyncio.get_running_loop()
            on_loop = True
        except RuntimeError:
            on_loop = False
        calls.append((on_loop, threading.current_thread().daemon))
        return {'status': 'ok'}
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    monkeypatch.setattr(service, 'recover_owner_invoice_periodic_once', tick)
    with TestClient(service.app) as client:
        assert calls == [(False, True)]
        assert client.get('/').json()['status'] == 'ok'
        assert service.app.router.on_startup == []
    assert calls == [(False, True)]


def test_PR02_O_OFF_all_entry_counters(monkeypatch):
    import requests
    from fastapi.testclient import TestClient
    from booking_engine import invoice_email_journal, invoice_email_dispatch, gmail_sender
    counts = dict(configuration=0, transport=0, renderer=0, provider=0)
    def deny(key):
        def called(*a, **kw):
            counts[key] += 1
            raise AssertionError('OFF reached ' + key)
        return called
    monkeypatch.setattr(invoice_email_journal.InvoiceEmailJournal, 'from_environment', deny('configuration'))
    monkeypatch.setattr(requests.Session, 'send', deny('transport'))
    monkeypatch.setattr(invoice_email_dispatch, 'render_invoice_pdf_for_service', deny('renderer'))
    monkeypatch.setattr(gmail_sender, 'prepare_journal_token', deny('provider'))
    state = service._owner_invoice_recovery_state
    state.request_cursor = 'a'*64; state.issuance_cursor = 'b'*64
    assert service.OWNER_INVOICE_JOURNAL_ENABLED is False
    registrations = (tuple(service.app.routes), tuple(service.app.router.on_startup))
    assert service.app.router.lifespan_context is service._owner_invoice_lifespan
    with TestClient(service.app): pass
    assert service.recover_owner_invoice_startup() == {'status': 'disabled'}
    assert service.recover_owner_invoice_periodic_once() == {'status': 'disabled'}
    assert counts == dict(configuration=0, transport=0, renderer=0, provider=0)
    assert (state.request_cursor, state.issuance_cursor) == ('a'*64, 'b'*64)
    assert not state.lock.locked()
    assert registrations == (tuple(service.app.routes), tuple(service.app.router.on_startup))


@pytest.mark.parametrize('case', ['boundary', 'over_cap', 'http', 'timeout'])
def test_PR03_T_actual_transport_properties_caps(monkeypatch, case):
    """Real requests preparation; inert adapter socket boundary, not live timeout timing."""
    import json, requests
    from requests.adapters import HTTPAdapter
    from booking_engine.invoice_email_journal import InvoiceEmailJournal
    calls = []
    def inert(adapter, request, **kwargs):
        calls.append((request, kwargs))
        assert request.url == 'https://fixture.invalid/_functions/invoiceEmailJournal'
        assert request.headers['X-WBE-Secret'] == 'fixture-only'
        assert request.headers['Content-Type'] == 'application/json'
        assert json.loads(request.body) == dict(operation='recoverRequests', cursor=None)
        assert kwargs['timeout'] == (5, 30) and kwargs['proxies'] == {}
        assert adapter.max_retries.total == 0
        if case == 'timeout': raise requests.Timeout('inert socket timeout')
        response = requests.Response()
        response.status_code = 302 if case == 'http' else 200
        response.headers['Location'] = 'https://forbidden.invalid/'
        data = json.dumps(_pr04_report()).encode()
        response._content = data + b' ' * (16000 - len(data) + (case == 'over_cap'))
        response.request = request
        return response
    original = requests.Session.send
    observed = []
    def send(session, request, **kwargs):
        assert session.trust_env is False
        assert kwargs['allow_redirects'] is False
        observed.append(True)
        return original(session, request, **kwargs)
    monkeypatch.setattr(HTTPAdapter, 'send', inert)
    monkeypatch.setattr(requests.Session, 'send', send)
    monkeypatch.setenv('HTTPS_PROXY', 'http://forbidden.invalid:9999')
    journal = InvoiceEmailJournal('https://fixture.invalid', 'fixture-only')
    if case == 'boundary': assert journal.recover_requests(None) == _pr04_report()
    else:
        with pytest.raises(requests.Timeout if case == 'timeout' else ValueError):
            journal.recover_requests(None)
    assert len(calls) == len(observed) == 1  # no redirect, timeout retry or response retry
    for bad in ([], {}, True, 1, 'A'*64, '', 'a'*63):
        with pytest.raises(ValueError, match='invalid_review_cursor'): journal.recover_requests(bad)
    assert len(calls) == 1


@pytest.mark.parametrize('mode', ['unavailable', 'uncertain'])
def test_PR12_S_repeated_composed_booking_separation(recovery_io, independent_booking_states, monkeypatch, mode):
    """Independent confirmed model + actual accepted-pending writer, not Wix completion."""
    import requests
    from fastapi.testclient import TestClient
    from booking_engine import gmail_sender
    io = recovery_io
    io.bridge({'fixture': 'prepare-request-only'})
    request = io.saved()['rows'][0]
    transport = io.transport; providers = []
    def inert(session, prepared, **kwargs):
        if 'gmail.googleapis.com' in prepared.url:
            providers.append(prepared.url)
            raise requests.Timeout('inert uncertain acceptance')
        return transport(session, prepared, **kwargs)
    monkeypatch.setattr(io, 'transport', inert)
    if mode == 'unavailable':
        def unavailable(): raise ValueError('inert preparation unavailable')
        monkeypatch.setattr(gmail_sender, 'prepare_journal_token', unavailable)
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    with TestClient(service.app): pass
    independent_booking_states()
    for _ in range(3):
        service.recover_owner_invoice_periodic_once()
        independent_booking_states()
    saved = io.saved()
    assert next(r for r in saved['rows'] if r['_id'] == request['_id']) == request
    root = next(r for r in saved['rows'] if r['kind'] == 'ISSUANCE')
    assert root['_id'] == request['issuanceId'] and root['document'] == request['document']
    assert sum(r['kind'] == 'START' for r in saved['rows']) == (mode == 'uncertain')
    assert not any(r['kind'] == 'ACK' for r in saved['rows'])
    assert len(providers) == (mode == 'uncertain')
    assert all(t[1] == 'InvoiceEmailJournal' and t[0] in ('get', 'query', 'insert') for t in saved['trace'])
    assert io.calls[0][1]['operation'] == 'recoverRequests'


def test_PR12_S_exact_legacy_and_jobs():
    import ast, subprocess
    from pathlib import Path
    baseline = '7a26303ba4ad82565072b4fb171c4ee710a354dd'
    def committed(path): return subprocess.check_output(['git', 'show', baseline + ':' + path])
    for path in ('velo/backend/jobs.config', 'velo/backend/issueInvoice.web.js',
                 'booking_engine/gmail_sender.py', 'booking_engine/invoice_email_dispatch.py'):
        assert Path(path).read_bytes().replace(b'\r\n', b'\n') == committed(path).replace(b'\r\n', b'\n')
    def bodies(source):
        tree = ast.parse(source)
        return {n.name: ast.get_source_segment(source, n) for n in tree.body
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                and n.name != 'recover_owner_invoice_startup'}
    before = bodies(committed('invoice_service.py').decode().replace('\r\n', '\n'))
    after = bodies(Path('invoice_service.py').read_text())
    assert all(after[name] == body for name, body in before.items())
    assert set(after) - set(before) == {
        'recover_owner_invoice_periodic_once', '_owner_invoice_delay', '_owner_invoice_lifespan'}


def _pr04_report(case='empty'):
    """Protocol fixtures only, not substituted durable admission authority."""
    r = dict(protocol='owner-invoice-request-recovery/v2', status='ok', pages=1,
             examined=0, insertAttempts=0, sdkOperations=1, outcomes=[], deferred=[],
             attemptedRequestId=None, nextCursor=None, cycleEndObserved=True, snapshot=False)
    def item(n, result):
        return dict(requestId=str(n)*64, issuanceId='a'*64, result=result)
    if case == 'disabled': return {'status': 'disabled'}
    if case == 'unavailable':
        r.update(status='unavailable', pages=0, nextCursor='0'*64, cycleEndObserved=False)
    elif case in ('deferred', 'deferred_end'):
        r.update(status='deferred', examined=2, sdkOperations=11,
                 outcomes=[item(1, 'already_present')], deferred=[item(2, 'deferred')],
                 nextCursor='2'*64 if case == 'deferred' else None,
                 cycleEndObserved=case == 'deferred_end')
    elif case in ('prior_unavailable', 'prior_partial', 'insert_unresolved'):
        r.update(status='partial', examined=2, sdkOperations=13, insertAttempts=1,
                 attemptedRequestId='1'*64, outcomes=[item(1, 'recovered')],
                 deferred=[item(2, 'deferred')], nextCursor='0'*64, cycleEndObserved=False)
        if case == 'insert_unresolved': r['outcomes'][0]['result'] = 'unresolved'
        else:
            r.update(pages=2, nextCursor='2'*64)
            if case == 'prior_unavailable': r.update(status='unavailable')
            else:
                r.update(examined=4, sdkOperations=17)
                r['outcomes'].append(dict(requestId='3'*64, result='unresolved'))
                r['deferred'].append(item(4, 'deferred'))
    return r


@pytest.mark.parametrize('case', ['empty', 'disabled', 'unavailable', 'deferred',
    'deferred_end', 'prior_unavailable', 'prior_partial', 'insert_unresolved'])
def test_PR04_valid_report_table(case):
    from booking_engine.invoice_email_journal import validate_request_report
    report = _pr04_report(case)
    assert validate_request_report(report, '0'*64) == report


_PR04_BAD = ['missing', 'private', 'grant', 'protocol', 'status', 'snapshot', 'end_bool',
    'pages_bool', 'pages_negative', 'pages_over', 'examined_bool', 'examined_over',
    'attempts_bool', 'attempts_over', 'sdk_bool', 'sdk_over', 'combined_over', 'duplicate',
    'order', 'cursor_order', 'id_type', 'variant', 'missing_issuance', 'deferred_variant',
    'attempt_id', 'attempt_count', 'recovered_unbound', 'end_cursor', 'continuation',
    'ok_deferred', 'unresolved_success']


@pytest.mark.parametrize('case', _PR04_BAD)
def test_PR04_reject_report_table(case):
    from booking_engine.invoice_email_journal import validate_request_report
    r = _pr04_report('deferred')
    changes = {'private': ('document', 'private'), 'grant': ('sendGrant', True),
        'protocol': ('protocol', 'v1'), 'status': ('status', 'delivered'),
        'snapshot': ('snapshot', 0), 'end_bool': ('cycleEndObserved', 1),
        'pages_bool': ('pages', True), 'pages_negative': ('pages', -1), 'pages_over': ('pages', 3),
        'examined_bool': ('examined', True), 'examined_over': ('examined', 5),
        'attempts_bool': ('insertAttempts', False), 'attempts_over': ('insertAttempts', 2),
        'sdk_bool': ('sdkOperations', True), 'sdk_over': ('sdkOperations', 25)}
    if case in changes:
        key, value = changes[case]; r[key] = value
    elif case == 'missing': del r['protocol']
    elif case == 'combined_over': r['examined'] = 1
    elif case == 'duplicate': r['deferred'][0]['requestId'] = '1'*64
    elif case == 'order':
        r['outcomes'] = [dict(r['outcomes'][0], requestId='2'*64), r['outcomes'][0]]
        r['deferred'] = []
    elif case == 'cursor_order': r['outcomes'][0]['requestId'] = '0'*64
    elif case == 'id_type': r['outcomes'][0]['requestId'] = ['1'*64]
    elif case == 'variant': r['outcomes'][0]['result'] = 'provider_accepted'
    elif case == 'missing_issuance': del r['outcomes'][0]['issuanceId']
    elif case == 'deferred_variant': r['deferred'][0]['result'] = 'recovered'
    elif case == 'attempt_id': r.update(insertAttempts=1, attemptedRequestId='3'*64)
    elif case == 'attempt_count': r['attemptedRequestId'] = '1'*64
    elif case == 'recovered_unbound': r['outcomes'][0]['result'] = 'recovered'
    elif case == 'end_cursor': r['cycleEndObserved'] = True
    elif case == 'continuation': r['nextCursor'] = None
    elif case == 'ok_deferred': r.update(status='ok', cycleEndObserved=True, nextCursor=None)
    elif case == 'unresolved_success': r['outcomes'][0]['result'] = 'unresolved'
    with pytest.raises(ValueError): validate_request_report(r, '0'*64)


@pytest.mark.parametrize('case,expected', [('transport', 'transport_error'),
    ('parse', 'malformed_response'), ('report', 'malformed_response'),
    ('disabled', 'disabled'), ('prior_partial', 'partial'), ('unavailable', 'unavailable')])
def test_PR04_tick_status_distinctions(monkeypatch, case, expected):
    """Actual tick/adapter, inert response boundary; not JS integration evidence."""
    import json, requests
    from booking_engine import invoice_email_recovery as recovery
    calls = []
    def inert(session, request, **kwargs):
        body = json.loads(request.body); calls.append(body)
        response = requests.Response(); response.status_code = 200
        if body['operation'] == 'recoverRequests':
            if case == 'transport': raise requests.Timeout('private fixture diagnostic')
            data = _pr04_report(case if case in ('disabled', 'prior_partial', 'unavailable') else 'empty')
            if case == 'report': data['sendGrant'] = 'private fixture diagnostic'
            response._content = b'not-json' if case == 'parse' else json.dumps(data).encode()
        else:
            assert body == {'operation': 'scanPending', 'cursor': 'b'*64}
            response._content = json.dumps(dict(protocol='owner-invoice-review-page/v1',
                items=[], nextCursor=None, cycleEndObserved=True, scanStatus='ok', snapshot=False)).encode()
        return response
    monkeypatch.setattr(requests.Session, 'send', inert)
    monkeypatch.setenv('WBE_INVOICE_JOURNAL_SITE', 'https://fixture.invalid')
    monkeypatch.setenv('WBE_SHARED_SECRET', 'fixture-only')
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    monkeypatch.setattr(recovery, 'dispatch_issuance', lambda *a: pytest.fail('report granted dispatch'))
    state = service._owner_invoice_recovery_state
    state.request_cursor = '0'*64; state.issuance_cursor = 'b'*64
    result = service.recover_owner_invoice_periodic_once()
    assert result['admission']['status'] == expected
    assert result['status'] == 'degraded'
    assert state.request_cursor == ('1'*64 if case == 'prior_partial' else '0'*64)
    assert state.issuance_cursor is None
    assert [c['operation'] for c in calls] == ['recoverRequests', 'scanPending']
    assert result['bridgeOperations'] == 2 and result['attempts'] == 0
    assert 'private fixture diagnostic' not in json.dumps(result)


@pytest.mark.parametrize('mode,status', [('request_unknown', 'partial'), ('request_bad_page', 'unavailable')])
def test_PR07_admission_unknown_holds_cursor_independent_roots(recovery_io, monkeypatch, mode, status):
    io = recovery_io
    identity = io.prepare()
    io.bridge({'fixture': 'prepare-request-only'}, 3)
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    state = service._owner_invoice_recovery_state
    state.request_cursor = '0'*64
    io.mode = mode
    admission_boundaries = []
    def inspect(op, report):
        if op == 'recoverRequests':
            saved = io.saved()
            assert report['status'] == status and report['insertAttempts'] == 0
            assert report['attemptedRequestId'] is None
            assert report['nextCursor'] == '0'*64 and report['cycleEndObserved'] is False
            assert all(t[0] in ('get', 'query') for t in saved['trace'][admission_boundaries[-1]:])
    io.hook = inspect
    for n in range(2):
        admission_boundaries.append(len(io.saved()['trace']))
        count = len(io.calls)
        result = service.recover_owner_invoice_periodic_once()
        assert result['status'] == 'degraded' and state.request_cursor == '0'*64
        assert result['admission']['status'] == status
        assert io.calls[count][1] == {'operation': 'recoverRequests', 'cursor': '0'*64}
        if n == 0:
            assert result['attemptedIssuanceId'] == identity['issuanceId']
            assert result['outcomes'][0]['status'] == 'provider_accepted'
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 1
    assert sum(r['kind'] == 'ISSUANCE' for r in io.saved()['rows']) == 1


def test_PR07_bad_root_companion_denied_later_page_progress(recovery_io, monkeypatch):
    import json
    io = recovery_io
    for seed in (3, 4, 5, 6, 7): io.prepare(seed)
    saved = io.saved()
    roots = sorted((r for r in saved['rows'] if r['kind'] == 'ISSUANCE'), key=lambda r: r['_id'])
    roots[0]['documentDigest'] = '0'*64  # corrupt copied actual writer history, no new authority
    io.database.write_text(json.dumps(saved))
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    result = service.recover_owner_invoice_periodic_once()
    assert result['status'] == 'degraded'
    assert roots[0]['_id'] in result['deferred'] and roots[1]['_id'] in result['deferred']
    assert result['attemptedIssuanceId'] == roots[2]['_id']
    assert service._owner_invoice_recovery_state.issuance_cursor == roots[2]['_id']
    assert [b['issuanceId'] for u, b in io.calls if b.get('operation') == 'tryStart'] == [roots[2]['_id']]
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 1


def test_PR09_L_actual_request_response_loss(recovery_io, monkeypatch):
    import requests
    io = recovery_io
    io.bridge({'fixture': 'prepare-request-only'})
    request = io.saved()['rows'][0]
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    def lost(op, report):
        if op == 'recoverRequests':
            io.hook = None
            assert report['attemptedRequestId'] == request['_id']
            assert report['outcomes'][0]['result'] == 'recovered'
            raise requests.Timeout('inert lost admission response after insertion')
    io.hook = lost
    result = service.recover_owner_invoice_periodic_once()
    assert result['admission'] == {'status': 'transport_error'}
    assert result['status'] == 'degraded' and result['requestCursor'] is None
    operations = [b.get('operation', 'provider') for u, b in io.calls]
    assert operations.count('recoverRequests') == 1
    assert operations.index('recoverRequests') < operations.index('scanPending') < operations.index('tryStart')
    before = io.saved(); count = len(io.calls)
    again = service.recover_owner_invoice_periodic_once()
    assert again['admission']['outcomes'] == [dict(requestId=request['_id'],
        issuanceId=request['issuanceId'], result='already_present')]
    assert again['admission']['insertAttempts'] == 0 and again['attempts'] == 0
    assert io.saved()['rows'] == before['rows']
    assert all(t[0] in ('get', 'query') for t in io.saved()['trace'][len(before['trace']):])
    assert [b['operation'] for u, b in io.calls[count:]] == ['recoverRequests', 'scanPending']
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 1


@pytest.mark.parametrize('mode', ['ack_never_written', 'accepted', 'paused_original'])
def test_PR09_R_fresh_service_retained_history(recovery_io, monkeypatch, mode):
    """Fresh module contexts, not an OS-process or persistent fairness claim."""
    import sys, booking_engine
    from booking_engine import invoice_email_dispatch, invoice_email_journal, invoice_email_recovery
    io = recovery_io
    io.bridge({'fixture': 'prepare-request-only'})
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    old = {name: sys.modules['booking_engine.' + name] for name in
           ('invoice_email_dispatch', 'invoice_email_journal', 'invoice_email_recovery')}
    observed = []
    def rebuilt_tick():
        before = io.saved(); count = len(io.calls)
        with monkeypatch.context() as fresh:
            fresh.delitem(sys.modules, 'invoice_service')
            for name in old:
                fresh.delitem(sys.modules, 'booking_engine.' + name)
                fresh.delattr(booking_engine, name)
            rebuilt = importlib.import_module('invoice_service')
            assert rebuilt is not service
            assert rebuilt._owner_invoice_recovery_state.request_cursor is None
            assert rebuilt._owner_invoice_recovery_state.issuance_cursor is None
            fresh.setattr(rebuilt, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
            result = rebuilt.recover_owner_invoice_periodic_once()
            for name, previous in old.items():
                assert sys.modules['booking_engine.' + name] is not previous
            assert sys.modules['booking_engine.invoice_email_dispatch'].BOOT_ID != old['invoice_email_dispatch'].BOOT_ID
        assert result['attempts'] == 0
        assert result['outcomes'][0]['status'] == ('provider_accepted' if mode == 'accepted' else 'owner_review_required')
        assert [b['operation'] for u, b in io.calls[count:]] == ['recoverRequests', 'scanPending']
        assert io.saved()['rows'] == before['rows']
        assert all(t[0] in ('get', 'query') for t in io.saved()['trace'][len(before['trace']):])
        observed.append(result)
    def paused(op, report):
        if op == 'provider':
            io.hook = None
            rebuilt_tick()
    io.mode = mode
    if mode == 'paused_original': io.hook = paused
    first = service.recover_owner_invoice_periodic_once()
    assert first['attempts'] == 1
    if mode != 'paused_original': rebuilt_tick()
    assert len(observed) == 1
    after = io.saved()
    assert sum(r['kind'] == 'START' for r in after['rows']) == 1
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 1
    if mode == 'paused_original':
        start = next(r for r in after['rows'] if r['kind'] == 'START')
        ack = next(r for r in after['rows'] if r['kind'] == 'ACK')
        assert ack['invocationNonce'] == start['invocationNonce']
        assert ack['artifactDigest'] == start['artifactDigest']
        assert ack['providerMessageId'] == 'recovery-closure-123'


@pytest.mark.parametrize('pressure,expected_sends', [(125, 0), (124, 1)])
def test_PR11_B_composed_budget_and_next_tick(recovery_io, monkeypatch, pressure, expected_sends):
    """Real adapter reads inject synthetic pressure; not natural cost reachability."""
    from booking_engine import invoice_email_recovery as recovery
    io = recovery_io; identity = io.prepare(); io.mode = 'prepared'
    io.pass_once(); io.mode = ''
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    original = recovery._BudgetedJournal.recover_requests
    def pressured(self, cursor):
        report = original(self, cursor)
        for _ in range(pressure): self.call('readIssuance', identity['issuanceId'])
        return report
    count = len(io.calls)
    with monkeypatch.context() as inject:
        inject.setattr(recovery._BudgetedJournal, 'recover_requests', pressured)
        result = service.recover_owner_invoice_periodic_once()
    operations = [b.get('operation', 'provider') for u, b in io.calls[count:]]
    assert operations[0] == 'recoverRequests'
    assert operations.count('recoverRequests') == operations.count('scanPending') == 1
    assert result['bridgeOperations'] == 128
    assert result['requestBridgeOperations'] + result['issuanceBridgeOperations'] == 128
    assert len([o for o in operations if o != 'provider']) == 128
    assert operations.count('provider') == operations.count('tryStart') == expected_sends
    assert operations.count('recordAck') == 0
    assert result['issues'] == ['bridge_budget_exhausted']
    assert result['status'] == 'degraded'
    assert result['admission']['sdkOperations'] <= 24
    assert result['attempts'] == 1 and result['admission']['insertAttempts'] == 0
    before = io.saved(); count = len(io.calls)
    # Attempted final item does NOT immediately reset: the next empty tail wraps.
    tail = service.recover_owner_invoice_periodic_once()
    assert tail['attempts'] == 0 and tail['issuanceCursor'] is None
    again = service.recover_owner_invoice_periodic_once()
    if expected_sends:
        assert again['attempts'] == 0
        assert again['outcomes'][0]['status'] == 'owner_review_required'
        assert io.saved()['rows'] == before['rows']
        assert all(t[0] in ('get', 'query') for t in io.saved()['trace'][len(before['trace']):])
        assert not any('gmail.googleapis.com' in u for u, b in io.calls[count:])
    else:
        assert again['attempts'] == 1 and again['outcomes'][0]['status'] == 'provider_accepted'
    assert sum('gmail.googleapis.com' in u for u, b in io.calls) == 1


def test_R7_actual_startup_exists_and_off():
    assert callable(getattr(service, 'recover_owner_invoice_startup', None)), 'R7 missing actual startup recovery consumer'
    assert service.recover_owner_invoice_startup() == {'status': 'disabled'}


@pytest.mark.parametrize('mode', ['accepted', 'start_insert_ack_loss', 'timeout', 'prestart_retry', 'race'])
def test_R7_discovery_actual_bridge_startup_restart(tmp_path, monkeypatch, mode):
    import os, json, subprocess, requests, sys, booking_engine
    from booking_engine import gmail_sender
    database = tmp_path / 'journal.json'
    env = dict(os.environ, ENDPOINT_FIXTURE=str(database), ENDPOINT_FAULT=mode)
    def bridge(payload):
        run = subprocess.run(['node', '--experimental-vm-modules', 'scripts/verify-essential-email-dispatch.js'], input=json.dumps(payload), text=True, capture_output=True, env=env, timeout=20)
        assert run.returncode == 0, run.stderr
        return json.loads(run.stdout)
    bridge({'fixture': 'prepare'})  # caller deliberately retains no issuance ID
    calls = []
    def inert(self, request, **kwargs):
        body = json.loads(request.body)
        calls.append((request.url, body))
        response = requests.Response(); response.status_code = 200
        if request.url == 'https://fixture.invalid/_functions/invoiceEmailJournal':
            observed = bridge(body)
            if mode == 'race' and body['operation'] == 'scanPending' and len(calls) == 2:
                from booking_engine.invoice_email_dispatch import dispatch_issuance
                from booking_engine.invoice_email_journal import InvoiceEmailJournal
                dispatch_issuance(observed['items'][0]['issuanceId'], InvoiceEmailJournal.from_environment())
            response._content = json.dumps(observed).encode()
        else:
            assert request.url == 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
            if mode == 'timeout':
                raise requests.Timeout('inert acceptance unknown')
            response._content = b'{"id":"fixture-recovery-123"}'
        return response
    monkeypatch.setattr(requests.Session, 'send', inert)
    tokens = []
    def token():
        tokens.append(True)
        if mode == 'prestart_retry' and len(tokens) == 1:
            raise ValueError('inert preparation unavailable')
        return 'inert-token'
    monkeypatch.setattr(gmail_sender, 'prepare_journal_token', token)
    monkeypatch.setenv('WBE_INVOICE_JOURNAL_SITE', 'https://fixture.invalid')
    monkeypatch.setenv('WBE_SHARED_SECRET', 'fixture-only')
    monkeypatch.setenv('WBE_INVOICE_RENDERER', 'reportlab')
    monkeypatch.setattr(service, 'OWNER_INVOICE_JOURNAL_ENABLED', True)
    assert callable(getattr(service, 'recover_owner_invoice_startup', None)), 'R7 missing actual consumer'
    result = service.recover_owner_invoice_startup()
    assert result['attempts'] == 1
    if mode == 'prestart_retry':
        assert result['outcomes'][0]['status'] == 'preparation_retryable'
        assert not any('gmail.googleapis.com' in u for u,b in calls)
        result = service.recover_owner_invoice_startup()
        assert result['attempts'] == 0 and result['cycleEndObserved']
        result = service.recover_owner_invoice_startup()
    assert result['outcomes'][0]['status'] == ('owner_review_required' if mode in ('timeout','start_insert_ack_loss') else 'provider_accepted')
    assert calls[0][1] == {'operation': 'recoverRequests', 'cursor': None}
    assert sum('gmail.googleapis.com' in u for u,b in calls) == (0 if mode == 'start_insert_ack_loss' else 1)
    before = json.loads(database.read_text()); count = len(calls)
    from booking_engine import invoice_email_dispatch, invoice_email_journal, invoice_email_recovery
    old = invoice_email_dispatch
    with monkeypatch.context() as fresh:
        for name in ('invoice_email_dispatch', 'invoice_email_journal', 'invoice_email_recovery'):
            fresh.delitem(sys.modules, 'booking_engine.' + name)
            fresh.delattr(booking_engine, name)
        rebuilt = importlib.import_module('booking_engine.invoice_email_dispatch')
        assert rebuilt is not old and rebuilt.BOOT_ID != old.BOOT_ID
        assert service.recover_owner_invoice_startup()['attempts'] == 0
    assert [b['operation'] for u,b in calls[count:]] == ['recoverRequests', 'scanPending']
    after = json.loads(database.read_text())
    assert after['rows'] == before['rows']
    assert all(t[0] in ('get', 'query') for t in after['trace'][len(before['trace']):])


def test_R10_shared_facade_budget_and_finite_pages():
    from booking_engine.invoice_email_recovery import _BudgetedJournal, recover_pending_once
    class Inert:
        def __init__(self): self.calls = 0
        def call(self, *args): self.calls += 1
        def scan_pending(self, cursor):
            self.calls += 1
            ids = ['1'*64,'2'*64] if cursor is None else ['3'*64,'4'*64]
            return {'protocol':'owner-invoice-review-page/v1', 'snapshot':False,
                'items':[dict(issuanceId=i, invoiceNumber='TEST', revision='22345678-1234-4234-8234-123456789abc', purpose='guest_invoice', classification='start_uncertain', status='owner_review_required', needsOwnerReview=True) for i in ids],
                'nextCursor':ids[-1], 'cycleEndObserved':False, 'scanStatus':'ok'}
    source = Inert(); budget = _BudgetedJournal(source)
    budget.scan_pending(None)
    for _ in range(127): budget.call('readIssuance', 'a'*64)
    with pytest.raises(ValueError, match='budget'): budget.call('recordAck', 'a'*64)
    assert source.calls == budget.used == 128
    result = recover_pending_once(Inert())
    assert (result['pages'],result['examined'],result['attempts'],result['bridgeOperations']) == (2,4,0,2)
    assert result['nextCursor'] == '4'*64 and result['cycleEndObserved'] is False


def test_R2_adapter_strict_page_protocol_zero_transport(monkeypatch):
    import requests
    from booking_engine.invoice_email_journal import InvoiceEmailJournal, validate_review_page
    def denied(*args, **kwargs): pytest.fail('invalid cursor reached transport')
    monkeypatch.setattr(requests.Session, 'send', denied)
    for bad in ([], {}, True, 'A'*64, ''):
        with pytest.raises(ValueError): InvoiceEmailJournal('https://fixture.invalid','fixture-only').scan_pending(bad)
    clean = dict(protocol='owner-invoice-review-page/v1',items=[],nextCursor=None,cycleEndObserved=True,scanStatus='ok',snapshot=False)
    assert validate_review_page(clean,None) == clean
    for changed in ({'extra':'private'}, {'cycleEndObserved':1}, {'snapshot':True}, {'nextCursor':'a'*64}, {'items':None}, {'scanStatus':'partial'}):
        with pytest.raises(ValueError): validate_review_page(dict(clean, **changed),None)



@pytest.fixture
def recovery_io(tmp_path, monkeypatch):
    """Actual JS writer/HTTP adapter with an inert requests transport only."""
    import json, os, subprocess, requests
    from booking_engine import gmail_sender
    from booking_engine.invoice_email_journal import InvoiceEmailJournal
    class IO:
        mode = ''
        hook = None
        sequence = 0
        calls = []
        database = tmp_path / 'retained.json'
        def saved(self): return json.loads(self.database.read_text())
        def bridge(self, payload, seed=0):
            env = dict(os.environ, ENDPOINT_FIXTURE=str(self.database), ENDPOINT_FAULT=self.mode)
            # Change fixture command values only; actual module bytes stay intact.
            runner = "const fs=require('fs'),Module=require('module'),p=require('path').resolve('scripts/verify-essential-email-dispatch.js');let s=fs.readFileSync(p,'utf8');const n=process.argv[1];if(n!=='0')s=s.replace(\"requestId: '12345678\",\"requestId: '\"+n+\"2345678\").replace(\"revision: '22345678\",\"revision: '\"+n+\"2345678\").replace('TEST-OWNER-1','TEST-OWNER-'+n);const m=new Module(p,module);m.filename=p;m.paths=Module._nodeModulePaths(require('path').dirname(p));m._compile(s,p);"
            run = subprocess.run(['node','--experimental-vm-modules','-e',runner,str(seed)],input=json.dumps(payload),text=True,capture_output=True,env=env,timeout=20)
            assert run.returncode == 0, run.stderr
            return json.loads(run.stdout)
        def prepare(self, seed=0): return self.bridge({'fixture':'prepare'},seed)
        def adapter(self): return InvoiceEmailJournal.from_environment()
        def pass_once(self):
            from booking_engine.invoice_email_recovery import recover_pending_once
            return recover_pending_once(self.adapter())
        def transport(self, session, request, **kwargs):
            body = json.loads(request.body)
            self.calls.append((request.url,body))
            response = requests.Response(); response.status_code = 200
            if request.url == 'https://fixture.invalid/_functions/invoiceEmailJournal':
                op = body['operation']
                if op == 'tryStart' and self.mode == 'prepared':
                    raise requests.Timeout('inert crash before START')
                if op == 'recordAck' and self.mode == 'ack_never_written':
                    raise requests.Timeout('inert ACK unavailable')
                if op == 'tryStart' and self.hook: self.hook('before_tryStart', None)
                observed = self.bridge({'fixturePayload': body, 'fixtureSecret': request.headers.get('X-WBE-Secret')})
                if self.hook: self.hook(op, observed)
                if (op,self.mode) in [('tryStart','start_response_loss'),('recordAck','ack_response_loss')]:
                    raise requests.Timeout('inert persisted response loss')
                response._content = json.dumps(observed).encode()
            else:
                assert request.url == 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', 'forbidden external effect'
                if self.hook: self.hook('provider',None)
                response._content = b'{"id":"recovery-closure-123"}'
            return response
    io = IO(); io.calls = []
    monkeypatch.setattr(requests.Session,'send',lambda session,request,**kw: io.transport(session,request,**kw))
    monkeypatch.setattr(gmail_sender,'prepare_journal_token',lambda: 'inert-token')
    monkeypatch.setenv('WBE_INVOICE_JOURNAL_SITE','https://fixture.invalid')
    monkeypatch.setenv('WBE_SHARED_SECRET','fixture-only')
    monkeypatch.setenv('WBE_INVOICE_RENDERER','reportlab')
    def forbidden(*args,**kwargs): pytest.fail('forbidden legacy/calendar effect')
    monkeypatch.setattr(service,'_bg_send_email',forbidden)
    monkeypatch.setattr(service,'_bg_calendar_event',forbidden)
    return io


def test_R7_retained_prepared_actual_TestClient_fresh_startup(recovery_io, monkeypatch):
    import sys, booking_engine
    from fastapi.testclient import TestClient
    from booking_engine import invoice_email_dispatch as old
    io = recovery_io
    identity = io.prepare()
    io.mode = 'prepared'
    assert io.pass_once()['attempts'] == 1
    before = io.saved()
    assert any(r['kind'] == 'ARTIFACT' for r in before['rows'])
    assert not any(r['kind'] in ('START','ACK') for r in before['rows'])
    io.mode = ''; count = len(io.calls)
    with monkeypatch.context() as fresh:
        for name in ('invoice_email_dispatch','invoice_email_journal','invoice_email_recovery'):
            fresh.delitem(sys.modules,'booking_engine.'+name)
            fresh.delattr(booking_engine,name)
        rebuilt = importlib.import_module('booking_engine.invoice_email_dispatch')
        assert rebuilt is not old and rebuilt.BOOT_ID != old.BOOT_ID
        fresh.setattr(rebuilt,'render_invoice_pdf_for_service',lambda *a: pytest.fail('prepared history rerendered'))
        fresh.setattr(service,'OWNER_INVOICE_JOURNAL_ENABLED',True)
        assert service.app.router.lifespan_context is service._owner_invoice_lifespan
        with TestClient(service.app): pass
    operations = [b.get('operation','provider') for u,b in io.calls[count:]]
    assert operations == ['recoverRequests','scanPending','readIssuance','tryStart','provider','recordAck']
    after = io.saved()
    assert [r for r in after['rows'] if r['kind'] not in ('START','ACK')] == before['rows']
    assert next(r for r in after['rows'] if r['kind']=='START')['issuanceId'] == identity['issuanceId']


@pytest.fixture
def independent_booking_states(tmp_path, monkeypatch):
    """Committed boundaries, not a new booking/email integration.

    Confirmed uses the committed availability.Booking dataclass witness only.
    Pending is created by the actual issuer/acceptance writer from the committed
    acceptance harness, never by seeding an authoritative acceptance record.
    These independent stores are witnesses, not inputs authorizing owner email.
    """
    import ast, json, subprocess
    from dataclasses import asdict, dataclass
    from datetime import date, timedelta
    from pathlib import Path
    from typing import List

    # availability's unrelated rooms dependency is absent from this baseline.
    # Execute the exact existing dataclass AST, not a fake Calendar/room catalog.
    # This proves an independent model-state witness, NOT booking persistence.
    source = Path('booking_engine/availability.py').read_text(encoding='utf-8')
    classes = [n for n in ast.parse(source).body
               if isinstance(n, ast.ClassDef) and n.name == 'Booking']
    assert len(classes) == 1
    namespace = dict(dataclass=dataclass, date=date, timedelta=timedelta, List=List)
    exec(compile(ast.Module(body=classes, type_ignores=[]),
                 'booking_engine/availability.py', 'exec'), namespace)
    Booking = namespace['Booking']
    booking = Booking('WBE-00001', 'adventure_suite', date(2026, 1, 10),
                      date(2026, 1, 15), guests=2)
    assert booking.status == 'confirmed' and booking.is_active()
    confirmed = asdict(booking)
    forbidden_writes = []

    def forbidden(*args, **kwargs):
        forbidden_writes.append((args, kwargs))
        pytest.fail('email attempted booking mutation')

    monkeypatch.setattr(Booking, '__setattr__', forbidden)
    database = tmp_path / 'independent-accepted-work.json'
    runner = r"""
const fs=require('node:fs'), Module=require('node:module'), path=require('node:path');
const p=path.resolve('scripts/verify-guest-booking-acceptance.js');
const source=fs.readFileSync(p,'utf8'), marker="test('real issuer";
if(source.indexOf(marker)<1000)throw Error('acceptance fixture boundary missing');
const body=source.slice(0,source.indexOf(marker))+`
(async()=>{
 const file=process.argv[1], phase=process.argv[2];
 const deny=()=>{throw Error('email/network unavailable');};
 require('http').request=deny;require('https').request=deny;
 require('net').connect=deny;global.fetch=deny;
 let s,o,result;
 if(phase==='prepare'){
  s=subject();o=await prepared(s);
  result=await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(o.token,o.capsule);
  assert.equal(result.status,'ACCEPTED_PENDING');
  assert.equal(s.state.db.rows.GuestBookingAcceptances.length,1);
  assert.ok(s.state.trace.filter(t=>t.op==='insert').every(t=>t.collection==='GuestBookingAcceptances'));
  fs.writeFileSync(file,JSON.stringify({db:s.state.db,offer:o}));
 }else{
  const retained=JSON.parse(fs.readFileSync(file,'utf8'));
  s=subject(retained.db);o=retained.offer;
  s.wix.insert=async()=>{throw Error('forbidden booking write');};
  result=await s.load('backend/guestBookingAcceptance').readOwnGuestBookingAcceptance(o.token,o.capsule);
  assert.equal(result.status,'ACCEPTED_PENDING');
  assert.ok(s.state.trace.every(t=>t.op==='secret'||(t.op==='find'&&t.collection==='GuestBookingAcceptances')));
 }
 console.log(JSON.stringify({status:result.status,rows:s.state.db.rows.GuestBookingAcceptances,
  mutations:s.state.trace.filter(t=>['insert','update','save','remove'].includes(t.op))}));
})().catch(e=>{console.error(e);process.exitCode=1;});`;
const m=new Module(p,module);m.filename=p;m.paths=Module._nodeModulePaths(path.dirname(p));m._compile(body,p);
"""

    def pending(phase):
        run = subprocess.run(['node', '-e', runner, str(database), phase],
                             text=True, capture_output=True, timeout=20)
        assert run.returncode == 0, run.stderr
        return json.loads(run.stdout)

    accepted = pending('prepare')
    retained_bytes = database.read_bytes()
    assert accepted['status'] == 'ACCEPTED_PENDING'
    assert len(accepted['mutations']) == 1

    def unchanged():
        assert booking.status == 'confirmed' and booking.is_active()
        assert asdict(booking) == confirmed
        assert forbidden_writes == []
        observed = pending('read')
        assert observed['status'] == 'ACCEPTED_PENDING'
        assert observed['rows'] == accepted['rows']
        assert observed['mutations'] == []
        assert database.read_bytes() == retained_bytes

    unchanged()
    return unchanged


@pytest.mark.parametrize('mode', ['unavailable', 'uncertain'])
def test_R11_independent_booking_states_survive_email_recovery(
        recovery_io, independent_booking_states, monkeypatch, mode):
    """Finite pair: real consumer + independent confirmed/pending witnesses.

    Local separation only; no full booking completion, persisted confirmed Wix
    row, allocation/keyless recovery, or booking-to-issuance linkage is claimed.
    """
    import requests
    from booking_engine import gmail_sender
    io = recovery_io
    identity = io.prepare()
    before = io.saved()['rows']
    provider_calls = []
    transport = io.transport

    def inert(session, request, **kwargs):
        if request.url == 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send':
            provider_calls.append(request.url)
            raise requests.Timeout('inert provider acceptance unknown')
        return transport(session, request, **kwargs)

    monkeypatch.setattr(io, 'transport', inert)
    if mode == 'unavailable':
        def unavailable():
            raise ValueError('inert email preparation unavailable')
        monkeypatch.setattr(gmail_sender, 'prepare_journal_token', unavailable)
    result = io.pass_once()
    assert result['attempts'] == 1
    expected = 'preparation_retryable' if mode == 'unavailable' else 'owner_review_required'
    assert result['outcomes'] == [{'issuanceId': identity['issuanceId'], 'status': expected}]
    independent_booking_states()
    after = io.saved()
    assert all(t[0] in ('get', 'query', 'insert') and t[1] == 'InvoiceEmailJournal'
               for t in after['trace'])
    assert [r for r in after['rows'] if r['kind'] in ('REQUEST', 'ISSUANCE')] == before
    assert not any(r['kind'] == 'ACK' for r in after['rows'])
    assert len(provider_calls) == (0 if mode == 'unavailable' else 1)
    if mode == 'unavailable':
        assert after['rows'] == before
    else:
        assert sum(r['kind'] == 'START' for r in after['rows']) == 1
        count = len(io.calls)
        again = io.pass_once()
        assert again['attempts'] == 0
        assert again['outcomes'] == result['outcomes']
        assert [b['operation'] for u, b in io.calls[count:]] == ['scanPending']
        assert io.saved()['rows'] == after['rows']
        assert all(t[0] in ('get', 'query')
                   for t in io.saved()['trace'][len(after['trace']):])
        assert len(provider_calls) == 1
        independent_booking_states()


@pytest.mark.parametrize('mode',['start_response_loss','start_insert_ack_loss','start_readback_loss','ack_response_loss','ack_never_written','paused_original'])
def test_R8_recovery_lost_responses_and_original_late_ACK(recovery_io, monkeypatch, mode):
    from booking_engine import invoice_email_recovery as recovery
    io = recovery_io; io.prepare(); io.mode = mode
    observed = []
    def paused(op, result):
        if op != 'provider': return
        io.hook = None
        before = io.saved(); count = len(io.calls)
        with monkeypatch.context() as guard:
            guard.setattr(recovery,'dispatch_issuance',lambda *a: pytest.fail('retained START dispatched'))
            during = io.pass_once()
        assert during['attempts'] == 0
        assert during['outcomes'][0]['status'] == 'owner_review_required'
        assert [b['operation'] for u,b in io.calls[count:]] == ['scanPending']
        assert io.saved()['rows'] == before['rows']
        observed.append(during)
    if mode == 'paused_original': io.hook = paused
    first = io.pass_once()
    assert first['attempts'] == 1
    assert len(observed) == (1 if mode == 'paused_original' else 0)
    before = io.saved(); count = len(io.calls); io.mode = ''
    with monkeypatch.context() as guard:
        guard.setattr(recovery,'dispatch_issuance',lambda *a: pytest.fail('retained outcome dispatched'))
        final = io.pass_once()
    assert final['attempts'] == 0
    assert final['outcomes'][0]['status'] == ('provider_accepted' if mode in ('ack_response_loss','paused_original') else 'owner_review_required')
    assert [b['operation'] for u,b in io.calls[count:]] == ['scanPending']
    after = io.saved()
    assert after['rows'] == before['rows']
    assert all(t[0] in ('query','get') for t in after['trace'][len(before['trace']):])
    assert sum('gmail.googleapis.com' in u for u,b in io.calls) == (0 if mode.startswith('start_') else 1)
    if mode == 'paused_original':
        start = next(r for r in after['rows'] if r['kind']=='START')
        ack = next(r for r in after['rows'] if r['kind']=='ACK')
        assert ack['invocationNonce'] == start['invocationNonce']
        assert ack['artifactDigest'] == start['artifactDigest']
        assert ack['providerMessageId'] == 'recovery-closure-123'


def test_R9_prestart_retry_keeps_exact_identity(recovery_io, monkeypatch):
    from booking_engine import gmail_sender
    io = recovery_io; identity = io.prepare(); before = io.saved()['rows']
    with monkeypatch.context() as fail:
        def unavailable(): raise ValueError('private preparation failure')
        fail.setattr(gmail_sender,'prepare_journal_token',unavailable)
        denied = io.pass_once()
    assert denied['outcomes'] == [{'issuanceId':identity['issuanceId'],'status':'preparation_retryable'}]
    assert io.saved()['rows'] == before
    accepted = io.pass_once()
    assert accepted['outcomes'] == [{'issuanceId':identity['issuanceId'],'status':'provider_accepted'}]
    assert [r for r in io.saved()['rows'] if r['kind'] in ('REQUEST','ISSUANCE')] == before


def test_R10_multiple_pending_partial_deferral_reset(recovery_io):
    import json
    io = recovery_io
    for seed in (3,4,5,6,7): io.prepare(seed)
    before = io.saved()
    first = io.pass_once()
    assert (first['pages'],first['examined'],first['attempts']) == (2,4,1)
    assert len(first['deferred']) == 3 and not first['cycleEndObserved']
    assert first['nextCursor'] is not None and first['snapshot'] is False
    from booking_engine.invoice_email_recovery import recover_pending_once
    second = recover_pending_once(io.adapter(),first['nextCursor'])
    assert (second['pages'],second['examined'],second['attempts']) == (1,1,1)
    assert second['cycleEndObserved'] and second['nextCursor'] is None
    assert io.pass_once()['attempts'] == 1
    # Corrupt a copied actual root, not fabricated authority. Whole partial page defers.
    io.database.write_text(json.dumps(before))
    saved = io.saved(); roots = sorted((r for r in saved['rows'] if r['kind']=='ISSUANCE'),key=lambda r:r['_id'])
    roots[0]['documentDigest'] = '0'*64
    io.database.write_text(json.dumps(saved)); count = len(io.calls)
    partial = io.pass_once()
    assert partial['status'] == 'partial' and partial['attempts'] == 1
    assert roots[0]['_id'] in partial['deferred'] and roots[1]['_id'] in partial['deferred']
    attempted = [b['issuanceId'] for u,b in io.calls[count:] if b.get('operation')=='tryStart']
    assert attempted == [roots[2]['_id']]


def test_R10_concurrent_consumers_unique_actual_START(recovery_io):
    io = recovery_io; io.prepare(); observations = []
    def interleave(op,result):
        if op != 'tryStart': return
        io.hook = None
        observations.append(io.pass_once())
    io.hook = interleave
    result = io.pass_once()
    assert result['outcomes'][0]['status'] == 'provider_accepted'
    assert len(observations) == 1 and observations[0]['attempts'] == 0
    assert observations[0]['outcomes'][0]['status'] == 'owner_review_required'
    assert sum(b.get('operation')=='tryStart' for u,b in io.calls) == 1
    assert sum('gmail.googleapis.com' in u for u,b in io.calls) == 1
    assert sum(r['kind']=='START' for r in io.saved()['rows']) == 1


def test_R12_OFF_startup_causal_runtime_enable_witness(monkeypatch):
    from fastapi.testclient import TestClient
    from booking_engine.invoice_email_journal import InvoiceEmailJournal
    observed = []
    def unavailable(): observed.append('configuration'); raise ValueError('inert unavailable')
    monkeypatch.setattr(InvoiceEmailJournal,'from_environment',unavailable)
    assert service.OWNER_INVOICE_JOURNAL_ENABLED is False
    with TestClient(service.app): pass
    assert observed == []
    # Causal runtime-enable mutant in isolated memory; no settings changed.
    monkeypatch.setattr(service,'OWNER_INVOICE_JOURNAL_ENABLED',True)
    with TestClient(service.app): pass
    assert observed == ['configuration'], 'runtime-enable mutation must reverse zero-config witness'




@pytest.mark.parametrize('precharge,expected_sends',[(126,0),(125,1)])
def test_R10_nested_actual_128_budget_pressure(recovery_io,monkeypatch,precharge,expected_sends):
    """Injected real-read pressure, NOT natural 128-operation reachability.

    Keep the production limit 128. Charge real adapter/bridge reads in the same
    private facade before scan; actual nested dispatcher crosses the boundary.
    """
    from booking_engine import invoice_email_recovery as recovery
    io = recovery_io; identity = io.prepare(); io.mode = 'prepared'
    io.pass_once(); io.mode = ''; count = len(io.calls)
    initialize = recovery._BudgetedJournal.__init__
    def pressure(self,journal):
        initialize(self,journal)
        for _ in range(precharge): self.call('readIssuance',identity['issuanceId'])
    monkeypatch.setattr(recovery._BudgetedJournal,'__init__',pressure)
    result = io.pass_once()
    assert result['status'] == 'deferred'
    assert result['issues'] == ['bridge_budget_exhausted']
    assert result['bridgeOperations'] == 128
    operations = [b.get('operation','provider') for u,b in io.calls[count:]]
    assert len([o for o in operations if o != 'provider']) == 128
    assert operations.count('provider') == expected_sends
    assert operations.count('tryStart') == expected_sends
    assert operations.count('recordAck') == 0
    assert result['outcomes'][0]['status'] == 'owner_review_required'
    assert sum(r['kind']=='START' for r in io.saved()['rows']) == expected_sends
    assert not any(r['kind']=='ACK' for r in io.saved()['rows'])


def test_R12_force_dispatch_retained_mutant_causal(recovery_io,monkeypatch):
    import types
    from pathlib import Path
    from booking_engine import invoice_email_recovery as recovery
    io = recovery_io; io.prepare(); io.mode = 'ack_never_written'
    io.pass_once(); io.mode = ''
    actual = recovery.dispatch_issuance
    invoked = []
    def observe(*args): invoked.append(args[0]); return actual(*args)
    monkeypatch.setattr(recovery,'dispatch_issuance',observe)
    assert io.pass_once()['attempts'] == 0 and invoked == []
    source = Path(recovery.__file__).read_text()
    target = "elif item['classification'] == 'pending_prestart':"
    assert source.count(target) == 1
    mutant = types.ModuleType('booking_engine.inert_recovery_mutant')
    mutant.__package__ = 'booking_engine'
    exec(compile(source.replace(target,"elif item['classification'] in ('pending_prestart', 'start_uncertain'):"),'<inert-force-dispatch-mutant>','exec'),mutant.__dict__)
    mutant.dispatch_issuance = observe
    changed = mutant.recover_pending_once(io.adapter())
    assert changed['attempts'] == 1 and len(invoked) == 1, 'force-dispatch mutation reverses zero-dispatch assertion'
    assert sum('gmail.googleapis.com' in u for u,b in io.calls) == 1, 'actual dispatcher still independently excludes resend'
