"""Bounded discovery through actual startup/bridge; external IO inert."""
import importlib
import pytest
import invoice_service as service


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
            if mode == 'race' and body['operation'] == 'scanPending' and len(calls) == 1:
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
    assert result['outcomes'][0]['status'] == ('owner_review_required' if mode in ('timeout','start_insert_ack_loss') else 'provider_accepted')
    assert calls[0][1] == {'operation': 'scanPending', 'cursor': None}
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
    assert [b['operation'] for u,b in calls[count:]] == ['scanPending']
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
                observed = self.bridge(body)
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
        assert service.recover_owner_invoice_startup in service.app.router.on_startup
        with TestClient(service.app): pass
    operations = [b.get('operation','provider') for u,b in io.calls[count:]]
    assert operations == ['scanPending','readIssuance','tryStart','provider','recordAck']
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
