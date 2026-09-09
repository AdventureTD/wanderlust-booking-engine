"""Exact opt-in tests: actual JS retained reader/journal, inert render/provider IO."""
import base64
from copy import deepcopy
from datetime import date
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
import hashlib
import importlib
import os
import json
from pathlib import Path
import subprocess
from decimal import Decimal
import pytest

ROOT = Path(__file__).resolve().parents[1]

class Bridge:
    def __init__(self):
        # Never execute the concurrently edited shared JS verifier. The caller
        # must supply a separately frozen and declaration-reviewed closure.
        overlay = Path(os.environ['WBE_GUEST_DELIVERY_TEST_OVERLAY']).resolve()
        assert overlay != ROOT or (overlay / 'frozen-hashes.json').exists()
        pins = json.loads((overlay / 'frozen-hashes.json').read_text())
        for name, digest in pins.items():
            if name.startswith(('velo/', 'scripts/')):
                assert hashlib.sha256((overlay / name).read_bytes()).hexdigest() == digest, name
        self.process = subprocess.Popen(['node', '--experimental-vm-modules',
            'scripts/verify-guest-booking-invoice-delivery.js', '--bridge'], cwd=overlay,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8')
        self.issuance_id = json.loads(self.process.stdout.readline())['issuanceId']
        self.trace = []
    def call(self, operation, issuance_id, payload=None):
        assert issuance_id == self.issuance_id
        self.process.stdin.write(json.dumps(dict(operation=operation,payload=payload or {}))+'\n')
        self.process.stdin.flush()
        result = json.loads(self.process.stdout.readline())
        self.trace.extend(result['trace'])
        return result['result']
    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=10)
        error = self.process.stderr.read()
        directory = os.environ.get('WBE_GUEST_DELIVERY_TEST_EVIDENCE')
        if directory:
            with Path(directory, 'bridge-exits.jsonl').open('a', encoding='utf-8') as evidence:
                evidence.write(compact({'native_exit': self.process.returncode, 'stderr': error,
                    'issuanceId': self.issuance_id, 'trace': self.trace}) + '\n')
        assert self.process.returncode == 0, error
        self.process.stdout.close()
        self.process.stderr.close()

@pytest.fixture
def bridge():
    instance = Bridge()
    try:
        yield instance
    finally:
        instance.close()

def test_actual_admission_maps_original_groups_through_existing_adapters(bridge, monkeypatch):
    path = ROOT/'booking_engine/guest_invoice_delivery.py'
    assert path.exists(), 'actual guest renderer/delivery adapter required'
    module = importlib.import_module('booking_engine.guest_invoice_delivery')
    rendered, sent = [], []
    def inert_renderer(invoice, output):
        rendered.append(invoice)
        Path(output).write_bytes(b'%PDF-inert-fixture-not-a-real-render')
        return 'word'
    monkeypatch.setattr(module, 'render_invoice_pdf_for_service', inert_renderer)
    monkeypatch.setattr(module.gmail_sender, 'prepare_journal_token', lambda: 'inert-token')
    monkeypatch.setattr(module.gmail_sender, 'send_journal_mime', lambda raw,token: sent.append((raw,token)) or 'inert-message')
    # Expose mapping failures before the dispatcher's fail-closed classification.
    state = bridge.call('readIssuance', bridge.issuance_id)
    mapped = module._invoice(state['root'], bridge.issuance_id)
    assert mapped.total == Decimal('470.02')
    result = module.dispatch_initial_guest_invoice(bridge.issuance_id, bridge)
    assert result == {'issuanceId':bridge.issuance_id,'status':'PROVIDER_ACCEPTED'}
    assert len(rendered) == len(sent) == 1
    assert rendered[0].total == Decimal('470.02')
    assert len(rendered[0].lines) == 2
    assert [line.net for line in rendered[0].lines] == [Decimal('200.01'),Decimal('200.01')]
    assert rendered[0].invoice_number == bridge.issuance_id
    assert_complete_mapping(rendered[0], state['root'])
    assert sent[0][1] == 'inert-token'
    assert_mime(sent[0][0], state['root'])
    accepted = bridge.call('readIssuance', bridge.issuance_id)
    assert_artifact(accepted['artifact'], sent[0][0], state['root'])
    before = len(bridge.trace)
    assert module.dispatch_initial_guest_invoice(bridge.issuance_id, bridge) == result
    assert len(rendered) == len(sent) == 1
    assert not any(t['op']=='insert' for t in bridge.trace[before:])


# GP01–GP04 only. Negative returned-state seams do not manufacture retained
# booking authority: all positive roots/PREPARED artifacts come from the actual
# admission/delivery bridge over the pinned native retained history.
PDF = b'%PDF-inert-fixture-not-a-real-render'
HOTEL = 'info@wanderlustcaribbean.com'


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def oracle_key(domain, values):
    return sha((domain + '\0' + compact(values)).encode('utf-8'))


def assert_complete_mapping(invoice, root):
    summary = json.loads(root['projectionCanonical'])['summary']
    calculation = summary['acceptedCalculation']
    components = {key: value for key, value in calculation['totals'].items()
                  if key.endswith('Cents')}
    assert dict(invoice._component_cents) == components == {
        'grossCents': 40002, 'discountCents': 0, 'roomTotalCents': 40002,
        'propertyFeeCents': 2000, 'accommodationVatCents': 2000,
        'packageVatCents': 3000, 'totalVatCents': 5000, 'grandTotalCents': 47002}
    fields = {'subtotal_net': 'roomTotalCents', 'property_fee': 'propertyFeeCents',
              'total_vat': 'totalVatCents', 'total': 'grandTotalCents',
              'promo_discount_amount': 'discountCents'}
    for field, key in fields.items():
        assert type(getattr(invoice, field)) is Decimal
        assert getattr(invoice, field) == Decimal(components[key]) / 100
    assert set(invoice.vat_by_class) == {'accommodation', 'standard'}
    for tax_class, key in [('accommodation', 'accommodationVatCents'),
                           ('standard', 'packageVatCents')]:
        assert type(invoice.vat_by_class[tax_class]) is Decimal
        assert invoice.vat_by_class[tax_class] == Decimal(components[key]) / 100
    assert invoice.explicit_vat_amounts() == (Decimal('20'), Decimal('30'))
    nights = (date.fromisoformat(summary['checkOut']) - date.fromisoformat(summary['checkIn'])).days
    assert len(invoice.lines) == len(calculation['groups']) == 2
    for index, (line, group) in enumerate(zip(invoice.lines, calculation['groups'])):
        assert group['index'] == index
        assert line.label == 'Adventure Suite'
        assert line.tax_class == 'mixed'
        assert line.quantity == nights == 2
        assert line.room_quantity == group['quantity'] == 1
        assert line.unit_price is None and line.vat_rate is None
        expected = {'net': group['roomTotalCents'],
                    'vat': group['accommodationVatCents'] + group['packageVatCents'],
                    'gross': group['roomTotalCents'] + group['accommodationVatCents'] + group['packageVatCents']}
        for field, cents in expected.items():
            assert type(getattr(line, field)) is Decimal
            assert getattr(line, field) == Decimal(cents) / 100
    assert invoice.invoice_number == root['_id']
    assert invoice.issue_date == date.fromisoformat(summary['bookingDate'][:10]) == date(2027, 1, 15)
    assert invoice.check_in == summary['checkIn'] == '2027-01-01'
    assert invoice.check_out == summary['checkOut'] == '2027-01-03'
    assert invoice.package_title == summary['packageTitle'] == 'Reader fixture stay'
    assert invoice.guest.name == summary['guestName'] == 'Fixture Guest'
    assert invoice.guest.email == summary['guestEmail'] == root['to'] == 'fixture@example.test'
    assert invoice.guest.phone == summary['guestPhone'] == '1234567'
    assert invoice.booking_number == summary['bookingNumber'] == 'TEST-a44f5fd26f4bf4d940a2c26b82f4d3a92ac44ab0592bc195'
    assert invoice.currency == calculation['currency'] == 'USD'
    assert invoice.total_guests == calculation['totals']['totalGuests'] == 4
    assert invoice.promo_code == '' and invoice.payments == []
    # Rates/allocations are legacy nonmonetary metadata, not accepted amounts.
    # These identical retained groups cannot prove a distinct-valued order case.


def assert_mime(raw, root):
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    for field, expected in [('To', root['to']), ('Cc', HOTEL), ('From', HOTEL)]:
        headers = msg.get_all(field, [])
        assert len(headers) == 1
        assert [address for _, address in getaddresses(headers)] == [expected]
    assert getaddresses(msg.get_all('From')) == [('Wanderlust Caribbean', HOTEL)]
    for field in ('Bcc', 'Resent-To', 'Resent-Cc', 'Resent-Bcc'):
        assert msg.get_all(field) is None
    assert str(msg['Subject']) == 'Your Wanderlust Caribbean Invoice ' + root['_id']
    assert 'Total: $470.02 USD' in msg.get_body(preferencelist=('plain',)).get_content()
    attachments = list(msg.iter_attachments())
    assert len(attachments) == 1
    assert attachments[0].get_content_type() == 'application/pdf'
    assert attachments[0].get_filename() == 'Wanderlust Caribbean Invoice - ' + root['_id'] + '.pdf'
    assert attachments[0].get_payload(decode=True) == PDF


def assert_artifact(artifact, raw, root):
    assert artifact == dict(
        _id=oracle_key('wbe.guest-invoice-delivery.v1', [root['_id'], 'PREPARED']),
        kind='PREPARED', issuanceId=root['_id'], documentDigest=root['projectionDigest'],
        encoded=base64.b64encode(raw).decode(), mimeDigest=sha(raw), pdfDigest=sha(PDF),
        rendererVersion='word', artifactDigest=oracle_key('wbe.guest-invoice-artifact.v1',
            [root['_id'], root['projectionDigest'], sha(raw), sha(PDF), 'word']))


@pytest.fixture(scope='module')
def retained_states(tmp_path_factory):
    """Capture real admitted and committed states; no token/render/provider IO."""
    module = importlib.import_module('booking_engine.guest_invoice_delivery')
    instance = Bridge()
    try:
        initial = instance.call('readIssuance', instance.issuance_id)
        assert initial['status'] == 'READY' and initial['artifact'] is None
        pdf = tmp_path_factory.mktemp('gp01-04') / 'inert.pdf'
        pdf.write_bytes(PDF)
        raw = module.gmail_sender.build_invoice_email(initial['root']['to'], 'Fixture Guest',
            instance.issuance_id, str(pdf), '$470.02 USD', owner_only=False).as_bytes()
        prepared = instance.call('commitArtifact', instance.issuance_id, dict(
            encoded=base64.b64encode(raw).decode(), mimeDigest=sha(raw), pdfDigest=sha(PDF), rendererVersion='word'))
        assert prepared['status'] == 'READY' and prepared['start'] is None
        assert_artifact(prepared['artifact'], raw, initial['root'])
        directory = os.environ.get('WBE_GUEST_DELIVERY_TEST_EVIDENCE')
        if directory:
            Path(directory, 'captured-states.json').write_text(compact(dict(initial=initial, prepared=prepared)), encoding='utf-8')
        return initial, prepared
    finally:
        instance.close()


class ReturnedStateJournal:
    """Negative consumer seam only; never grants START or fabricates writer output."""
    def __init__(self, state, operation=None, response=None, throws=False):
        self.state = deepcopy(state)
        self.operation, self.response, self.throws = operation, response, throws
        self.calls = []

    def call(self, operation, issuance_id, payload=None):
        self.calls.append((operation, issuance_id, deepcopy(payload)))
        assert issuance_id == self.state['root']['_id']
        if operation == self.operation:
            if self.throws:
                raise RuntimeError('inert boundary failure')
            return deepcopy(self.response)
        if operation == 'readIssuance':
            return deepcopy(self.state)
        raise AssertionError('unexpected operation ' + operation)


@pytest.fixture
def inert_io(monkeypatch):
    module = importlib.import_module('booking_engine.guest_invoice_delivery')
    calls = {'token': [], 'render': [], 'provider': []}

    def token():
        calls['token'].append(True)
        return 'inert-token'

    def render(invoice, output):
        calls['render'].append(invoice)
        Path(output).write_bytes(PDF)
        return 'word'

    def provider(raw, token):
        calls['provider'].append((raw, token))
        return 'inert-message'

    monkeypatch.setattr(module.gmail_sender, 'prepare_journal_token', token)
    monkeypatch.setattr(module, 'render_invoice_pdf_for_service', render)
    monkeypatch.setattr(module.gmail_sender, 'send_journal_mime', provider)
    return module, calls


def assert_unavailable(module, journal, calls, *, token=0, render=0, operations=('readIssuance',)):
    issuance_id = journal.state['root']['_id']
    assert module.dispatch_initial_guest_invoice(issuance_id, journal) == {
        'issuanceId': issuance_id, 'status': 'UNAVAILABLE'}
    assert len(calls['token']) == token
    assert len(calls['render']) == render
    assert calls['provider'] == []
    assert [entry[0] for entry in journal.calls] == list(operations)
    assert not any(entry[0] in ('tryStart', 'recordAck') for entry in journal.calls)


def test_GP01_digest_golden_contract(retained_states):
    root = retained_states[0]['root']
    canonical = root['projectionCanonical']
    financial = compact(json.loads(canonical)['summary']['acceptedCalculation'])
    assert sha(('wbe.completion-projection-record.v1\n' + canonical).encode()) == root['projectionDigest'] == '96fb58a35c039faf68a4a0d9bc8f292f329e8797a21405e7fb9e75561dcb4aef'
    assert sha(('wbe.completion-financial.v1\n' + financial).encode()) == root['financialDigest'] == '111bc4090e51b1a01c8298bc5e7dd9ba838188dae6eee268a4da2af7f7015a6d'
    assert sha(('wbe.acceptance-id.v2\0' + root['operationId']).encode()) == root['acceptanceId'] == 'ceceb38dd2740f5523dc2fbce06cb50fc05df9dd30b85562d0a6f4d9ccf0b3f7'
    assert oracle_key('wbe.guest-initial-invoice.v1', [root['audience'], root['receiptId'], 'initial', root['recipientBindingDigest']]) == root['_id'] == '245a2671cbf56e7cb6e760a74848c2750678ed996f64f4ba0bb6c7cd9b94180c'
    assert sha(('wbe.acceptance-id.v2\n' + root['operationId']).encode()) != root['acceptanceId']
    assert sha(('wbe.guest-initial-invoice.v1\n' + compact([root['audience'], root['receiptId'], 'initial', root['recipientBindingDigest']])).encode()) != root['_id']


@pytest.mark.parametrize('field,domain', [
    ('projectionDigest', 'wbe.completion-projection-record.v1'),
    ('financialDigest', 'wbe.completion-financial.v1')], ids=['projection-NUL', 'financial-NUL'])
def test_GP01_completion_NUL_rejected(retained_states, inert_io, field, domain):
    module, calls = inert_io
    state = deepcopy(retained_states[0])
    root = state['root']
    value = root['projectionCanonical'] if field == 'projectionDigest' else compact(json.loads(root['projectionCanonical'])['summary']['acceptedCalculation'])
    root[field] = sha((domain + '\0' + value).encode())
    assert root[field] != retained_states[0]['root'][field]
    if field == 'financialDigest':
        # Keep the two financial digest copies consistent and rebind the
        # projection with its CORRECT newline digest. Otherwise rejection at
        # copy equality would mask the financial domain-separator assertion.
        projection = json.loads(root['projectionCanonical'])
        projection['summary']['financialDigest'] = root[field]
        root['projectionCanonical'] = compact(projection)
        root['projectionDigest'] = sha(('wbe.completion-projection-record.v1\n' + root['projectionCanonical']).encode())
    with pytest.raises(ValueError, match='guest_invoice_integrity'):
        module._invoice(root, root['_id'])
    assert_unavailable(module, ReturnedStateJournal(state), calls)


def test_GP03_actual_prepared_MIME_positive(retained_states, inert_io):
    module, _ = inert_io
    state = retained_states[1]
    invoice, raw = module._state(state, state['root']['_id'])
    assert_complete_mapping(invoice, state['root'])
    assert_mime(raw, state['root'])
    assert_artifact(state['artifact'], raw, state['root'])


def altered_artifact(state, raw):
    """Rebind only outer artifact hashes so semantic MIME checks are reached."""
    artifact = state['artifact']
    artifact['encoded'] = base64.b64encode(raw).decode()
    artifact['mimeDigest'] = sha(raw)
    artifact['artifactDigest'] = oracle_key('wbe.guest-invoice-artifact.v1', [
        state['root']['_id'], state['root']['projectionDigest'], artifact['mimeDigest'],
        artifact['pdfDigest'], artifact['rendererVersion']])


@pytest.mark.parametrize('fault', ['To', 'Cc', 'From', 'duplicate-To', 'Bcc', 'Resent-To',
    'missing-attachment', 'extra-attachment', 'non-PDF', 'PDF-bytes', 'base64', 'mime-digest', 'malformed-MIME'])
def test_GP03_prepared_semantic_rejection(retained_states, inert_io, fault):
    module, calls = inert_io
    state = deepcopy(retained_states[1])
    raw = base64.b64decode(state['artifact']['encoded'])
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    if fault in ('To', 'Cc', 'From'):
        msg.replace_header(fault, 'other@example.test')
    elif fault == 'duplicate-To':
        # EmailMessage's public setter rejects duplicates; inject raw wire bytes.
        raw = b'To: fixture@example.test\n' + raw
    elif fault in ('Bcc', 'Resent-To'):
        msg[fault] = 'other@example.test'
    elif fault == 'missing-attachment':
        msg.set_payload(msg.get_payload()[:1])
    elif fault == 'extra-attachment':
        msg.add_attachment(PDF, maintype='application', subtype='pdf', filename='extra.pdf')
    elif fault == 'non-PDF':
        list(msg.iter_attachments())[0].replace_header('Content-Type', 'application/octet-stream')
    elif fault == 'PDF-bytes':
        attachment = list(msg.iter_attachments())[0]
        attachment.set_payload(base64.b64encode(b'%PDF-changed').decode())
    elif fault == 'malformed-MIME':
        raw = b'not a MIME header\n\nbody'
    if fault not in ('duplicate-To', 'malformed-MIME'):
        raw = msg.as_bytes()
    altered_artifact(state, raw)
    if fault == 'base64':
        state['artifact']['encoded'] = '%%%not-base64%%%'
    elif fault == 'mime-digest':
        state['artifact']['mimeDigest'] = '0' * 64
        state['artifact']['artifactDigest'] = oracle_key('wbe.guest-invoice-artifact.v1', [
            state['root']['_id'], state['root']['projectionDigest'], '0' * 64,
            state['artifact']['pdfDigest'], state['artifact']['rendererVersion']])
    else:
        # Outer hashes are independently consistent, including for changed PDF.
        artifact = state['artifact']
        assert artifact['mimeDigest'] == sha(base64.b64decode(artifact['encoded'], validate=True))
        assert artifact['artifactDigest'] == oracle_key('wbe.guest-invoice-artifact.v1', [
            state['root']['_id'], state['root']['projectionDigest'], artifact['mimeDigest'],
            artifact['pdfDigest'], artifact['rendererVersion']])
    with pytest.raises(ValueError):
        module._state(state, state['root']['_id'])
    assert_unavailable(module, ReturnedStateJournal(state), calls)


@pytest.mark.parametrize('fault', ['read-throws', 'read-unavailable', 'token-throws',
    'render-throws', 'renderer-tag', 'MIME-oversize', 'commit-throws', 'commit-invalid',
    'payments-nonempty', 'payments-absent'])
def test_GP04_preSTART_failures(retained_states, inert_io, monkeypatch, fault):
    module, calls = inert_io
    state = deepcopy(retained_states[0])
    journal = ReturnedStateJournal(state)
    tokens = renders = 0
    oversized_lengths = []
    operations = ('readIssuance',)
    if fault in ('read-throws', 'read-unavailable'):
        journal.operation = 'readIssuance'
        journal.throws = fault == 'read-throws'
        journal.response = {'status': 'UNAVAILABLE'}
    elif fault.startswith('payments-'):
        if fault == 'payments-nonempty':
            journal.state['payments'] = [{'amount': 1}]
        else:
            del journal.state['payments']
    else:
        tokens = 1
        if fault == 'token-throws':
            def broken_token():
                calls['token'].append(True)
                raise RuntimeError('inert token preparation')
            monkeypatch.setattr(module.gmail_sender, 'prepare_journal_token', broken_token)
        else:
            renders = 1
            if fault in ('render-throws', 'renderer-tag'):
                def broken_renderer(invoice, output):
                    calls['render'].append(invoice)
                    if fault == 'render-throws':
                        raise RuntimeError('inert renderer failure')
                    Path(output).write_bytes(PDF)
                    return 'unsupported-renderer'
                monkeypatch.setattr(module, 'render_invoice_pdf_for_service', broken_renderer)
            if fault == 'MIME-oversize':
                builder = module.gmail_sender.build_invoice_email
                def oversized(*args, **kwargs):
                    msg = builder(*args, **kwargs)
                    msg.get_payload()[0].set_content('x' * (module.MAX_MIME + 1))
                    oversized_lengths.append(len(msg.as_bytes()))
                    return msg
                monkeypatch.setattr(module.gmail_sender, 'build_invoice_email', oversized)
            if fault in ('commit-throws', 'commit-invalid', 'renderer-tag'):
                operations += ('commitArtifact',)
                journal.operation = 'commitArtifact'
                journal.throws = fault == 'commit-throws'
                journal.response = {'status': 'UNAVAILABLE'}
                if fault == 'renderer-tag':
                    # A returned-state consumer witness, not JS tag admission.
                    journal.response = deepcopy(retained_states[1])
                    journal.response['artifact']['rendererVersion'] = 'unsupported-renderer'
                    altered_artifact(journal.response, base64.b64decode(journal.response['artifact']['encoded']))
    assert_unavailable(module, journal, calls, token=tokens, render=renders, operations=operations)
    if fault == 'MIME-oversize':
        assert len(oversized_lengths) == 1 and oversized_lengths[0] > module.MAX_MIME
    if fault == 'renderer-tag':
        assert journal.calls[-1][2]['rendererVersion'] == 'unsupported-renderer'


def test_GP04_actual_PREPARED_reuses_exact_bytes(bridge, inert_io, tmp_path):
    module, calls = inert_io
    state = bridge.call('readIssuance', bridge.issuance_id)
    pdf = tmp_path / 'inert.pdf'
    pdf.write_bytes(PDF)
    raw = module.gmail_sender.build_invoice_email(state['root']['to'], 'Fixture Guest',
        bridge.issuance_id, str(pdf), '$470.02 USD', owner_only=False).as_bytes()
    prepared = bridge.call('commitArtifact', bridge.issuance_id, dict(encoded=base64.b64encode(raw).decode(),
        mimeDigest=sha(raw), pdfDigest=sha(PDF), rendererVersion='word'))
    assert_artifact(prepared['artifact'], raw, state['root'])
    operations = []
    class ObservedJournal:
        def call(self, operation, issuance_id, payload=None):
            operations.append(operation)
            return bridge.call(operation, issuance_id, payload)
    before = len(bridge.trace)
    assert module.dispatch_initial_guest_invoice(bridge.issuance_id, ObservedJournal()) == {
        'issuanceId': bridge.issuance_id, 'status': 'PROVIDER_ACCEPTED'}
    assert operations == ['readIssuance', 'tryStart', 'recordAck']
    assert calls['render'] == [] and len(calls['token']) == 1
    assert calls['provider'] == [(raw, 'inert-token')]
    assert [t['id'] for t in bridge.trace[before:] if t['op'] == 'insert'] == [
        oracle_key('wbe.guest-invoice-delivery.v1', [bridge.issuance_id, 'START']),
        oracle_key('wbe.guest-invoice-delivery.v1', [bridge.issuance_id, 'ACK'])]
    final = bridge.call('readIssuance', bridge.issuance_id)
    assert final['artifact'] == prepared['artifact']


# GP05/GP06/GP10: separate frozen native adapter, never shared JS edits.
class MiddleBridge(Bridge):
    def __init__(self):
        overlay = Path(os.environ['WBE_GUEST_DELIVERY_MIDDLE_OVERLAY']).resolve()
        pins = json.loads((overlay / 'frozen-hashes.json').read_text())
        assert 'scripts/python-middle-bridge.cjs' in pins
        for name, digest in pins.items():
            if name.startswith(('velo/', 'scripts/')):
                assert sha((overlay / name).read_bytes()) == digest, name
        self.process = subprocess.Popen(['node', '--experimental-vm-modules',
            'scripts/python-middle-bridge.cjs', '--middle-bridge'], cwd=overlay,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8')
        self.issuance_id = json.loads(self.process.stdout.readline())['issuanceId']
        self.trace, self.calls, self.responses = [], [], []

    def call(self, operation, issuance_id, payload=None, *, schedule=None):
        assert issuance_id == self.issuance_id
        request = dict(operation=operation, payload=payload or {})
        if schedule is not None:
            request['schedule'] = schedule
        self.calls.append(deepcopy(request))
        self.process.stdin.write(compact(request) + '\n')
        self.process.stdin.flush()
        response = json.loads(self.process.stdout.readline())
        self.responses.append(response)
        self.trace.extend(response['trace'])
        return deepcopy(response['result'])

    def close(self):
        try:
            super().close()
        finally:
            directory = os.environ.get('WBE_GUEST_DELIVERY_TEST_EVIDENCE')
            if directory:
                with Path(directory, 'middle-transcripts.jsonl').open('a', encoding='utf-8') as output:
                    output.write(compact(dict(calls=self.calls, responses=self.responses)) + '\n')

    def snapshot(self):
        return self.call('snapshot', self.issuance_id)['rows']


@pytest.fixture
def middle_bridge():
    instance = MiddleBridge()
    try:
        yield instance
    finally:
        instance.close()


class MiddleJournal:
    """Observe/degrade real journal outputs; never synthesize a winning grant."""
    def __init__(self, bridge, transform=None):
        self.bridge, self.transform, self.calls = bridge, transform, []

    def call(self, operation, issuance_id, payload=None):
        self.calls.append((operation, issuance_id, deepcopy(payload)))
        if self.transform:
            return self.transform(operation, issuance_id, payload)
        return self.bridge.call(operation, issuance_id, payload)


def middle_status(module, bridge, journal, status):
    assert module.dispatch_initial_guest_invoice(bridge.issuance_id, journal) == {
        'issuanceId': bridge.issuance_id, 'status': status}


def booking_unchanged(before, after):
    assert before['Bookings'] and before['GuestBookingCompletions']
    for name in set(before) | set(after):
        if name not in ('GuestBookingInvoiceIssuances', 'GuestBookingCompletions'):
            assert after.get(name) == before.get(name), name


@pytest.mark.parametrize('operation', ['commitArtifact', 'tryStart'])
@pytest.mark.parametrize('target', ['receipt', 'admission'])
@pytest.mark.parametrize('dimension', ['recipient', 'amount', 'order'])
@pytest.mark.parametrize('timing', ['initial', 'second'])
def test_GP05_actual_authority_drift(middle_bridge, inert_io, operation, target, dimension, timing):
    module, calls = inert_io
    before = middle_bridge.snapshot()
    def transform(op, issuance_id, payload):
        schedule = dict(kind='drift', target=target, dimension=dimension, timing=timing) if op == operation else None
        return middle_bridge.call(op, issuance_id, payload, schedule=schedule)
    journal = MiddleJournal(middle_bridge, transform)
    middle_status(module, middle_bridge, journal, 'UNAVAILABLE' if operation == 'commitArtifact' else 'OWNER_REVIEW_REQUIRED')
    expected = ['readIssuance', 'commitArtifact'] + (['tryStart'] if operation == 'tryStart' else [])
    assert [op for op, _, _ in journal.calls] == expected
    assert len(calls['token']) == len(calls['render']) == 1
    assert calls['provider'] == []
    evidence = [r['evidence'] for r in middle_bridge.responses if 'evidence' in r]
    assert len(evidence) == 1 and evidence[0]['changed'] == 1
    after = middle_bridge.snapshot()
    assert after == evidence[0]['after']
    booking_unchanged(before, after)
    if target == 'admission':
        assert after['GuestBookingCompletions'] == before['GuestBookingCompletions']
    assert not any(row['kind'] in ('START', 'ACK') for row in after['GuestBookingInvoiceIssuances'])
    assert not any(r['result'].get('status') == 'PROVIDER_ACCEPTED' for r in middle_bridge.responses)


def test_GP05_postcommit_changed_expected_root(middle_bridge, inert_io):
    module, calls = inert_io
    before = middle_bridge.snapshot()
    valid_changed_roots = []
    def transform(op, issuance_id, payload):
        state = middle_bridge.call(op, issuance_id, payload)
        if op == 'commitArtifact':
            state = deepcopy(state)
            projection = json.loads(state['root']['projectionCanonical'])
            projection['summary']['guestPhone'] = '7654321'
            state['root']['projectionCanonical'] = compact(projection)
            state['root']['projectionDigest'] = sha(('wbe.completion-projection-record.v1\n' + compact(projection)).encode())
            state['artifact']['documentDigest'] = state['root']['projectionDigest']
            altered_artifact(state, base64.b64decode(state['artifact']['encoded']))
            # A detached internally valid negative, not retained authority.
            module._state(state, issuance_id)
            valid_changed_roots.append(deepcopy(state['root']))
        return state
    journal = MiddleJournal(middle_bridge, transform)
    middle_status(module, middle_bridge, journal, 'UNAVAILABLE')
    assert len(valid_changed_roots) == 1
    assert [op for op, _, _ in journal.calls] == ['readIssuance', 'commitArtifact']
    assert len(calls['token']) == len(calls['render']) == 1 and calls['provider'] == []
    after = middle_bridge.snapshot()
    booking_unchanged(before, after)
    assert after['GuestBookingCompletions'] == before['GuestBookingCompletions']


@pytest.mark.parametrize('fault', ['before', 'lostAck', 'unreadable', 'mismatch'])
def test_GP06_native_START_consumption(middle_bridge, inert_io, fault):
    module, calls = inert_io
    before = middle_bridge.snapshot()
    def transform(op, issuance_id, payload):
        return middle_bridge.call(op, issuance_id, payload,
            schedule=dict(kind='nativeStart', fault=fault) if op == 'tryStart' else None)
    journal = MiddleJournal(middle_bridge, transform)
    middle_status(module, middle_bridge, journal, 'OWNER_REVIEW_REQUIRED')
    assert [op for op, _, _ in journal.calls] == ['readIssuance', 'commitArtifact', 'tryStart']
    assert len(calls['token']) == len(calls['render']) == 1 and calls['provider'] == []
    response = next(r for r in middle_bridge.responses if 'evidence' in r)
    evidence = response['evidence']
    assert evidence['hits'] == 1 and evidence['applied'] is (fault != 'before')
    native = evidence['native']
    assert len(native) == 1
    assert native[0]['invocationNonce'] == journal.calls[-1][2]['invocationNonce']
    assert native[0]['artifactDigest'] == journal.calls[-1][2]['artifactDigest']
    assert [t for t in response['trace'] if t['op'] == 'insert'] == [
        dict(op='insert', collection='GuestBookingInvoiceIssuances', id=native[0]['_id'])]
    assert len([t for t in response['trace'] if t['op'] == 'insertAck']) == (1 if fault in ('unreadable', 'mismatch') else 0)
    expected = deepcopy(evidence['before'])
    if fault != 'before':
        expected['GuestBookingInvoiceIssuances'].append(native[0])
    assert evidence['after'] == expected == middle_bridge.snapshot()
    booking_unchanged(before, expected)
    assert expected['GuestBookingCompletions'] == before['GuestBookingCompletions']
    index = len(middle_bridge.trace)
    read = middle_bridge.call('readIssuance', middle_bridge.issuance_id)
    assert read['status'] == ('READY' if fault == 'before' else 'OWNER_REVIEW_REQUIRED')
    assert read.get('won') is not True
    if fault != 'before':
        assert read['start'] == native[0]
        retry = middle_bridge.call('tryStart', middle_bridge.issuance_id,
            dict(artifactDigest=native[0]['artifactDigest'], invocationNonce='c' * 64))
        assert retry['status'] == 'OWNER_REVIEW_REQUIRED' and retry.get('won') is not True
    assert not any(t['op'] == 'insert' for t in middle_bridge.trace[index:])
    assert middle_bridge.snapshot() == expected and calls['provider'] == []


@pytest.mark.parametrize('fault', ['won-integer', 'nonce', 'artifact', 'missing', 'extra'])
def test_GP06_invalid_actual_grant(middle_bridge, inert_io, fault):
    module, calls = inert_io
    grants = []
    def transform(op, issuance_id, payload):
        result = middle_bridge.call(op, issuance_id, payload)
        if op == 'tryStart':
            assert result == dict(won=True, **payload) and result['won'] is True
            grants.append(deepcopy(result))
            if fault == 'won-integer':
                result['won'] = 1
            elif fault == 'nonce':
                result['invocationNonce'] = 'c' * 64
            elif fault == 'artifact':
                result['artifactDigest'] = 'd' * 64
            elif fault == 'missing':
                del result['invocationNonce']
            else:
                result['extra'] = True
        return result
    journal = MiddleJournal(middle_bridge, transform)
    middle_status(module, middle_bridge, journal, 'OWNER_REVIEW_REQUIRED')
    assert len(grants) == 1 and calls['provider'] == []
    assert [op for op, _, _ in journal.calls] == ['readIssuance', 'commitArtifact', 'tryStart']
    assert len(calls['token']) == len(calls['render']) == 1
    retained = middle_bridge.snapshot()
    index = len(middle_bridge.trace)
    middle_status(module, middle_bridge, MiddleJournal(middle_bridge), 'OWNER_REVIEW_REQUIRED')
    assert middle_bridge.snapshot() == retained
    assert not any(t['op'] == 'insert' for t in middle_bridge.trace[index:])
    assert calls['provider'] == [] and len(calls['token']) == len(calls['render']) == 1


@pytest.mark.parametrize('fault,recover', [
    ('throw', True), ('throw', False), ('malformed', True), ('malformed', False),
    ('provider', True), ('provider', False), ('nonce', True), ('nonce', False)],
    ids=['throw-success', 'throw-both', 'malformed-success', 'malformed-both',
         'provider-success', 'provider-both', 'nonce-success', 'nonce-both'])
def test_GP10_ACK_only_retries(middle_bridge, inert_io, fault, recover):
    module, calls = inert_io
    ack_payloads, valid_unrelated_states = [], []
    def transform(op, issuance_id, payload):
        if op != 'recordAck':
            return middle_bridge.call(op, issuance_id, payload)
        ack_payloads.append(deepcopy(payload))
        bad = len(ack_payloads) == 1 or not recover
        if bad and fault == 'throw':
            # Failure before forwarding: uncertain retained START, no invented ACK.
            raise RuntimeError('inert ACK transport unavailable')
        state = middle_bridge.call(op, issuance_id, payload)
        assert state['status'] == 'PROVIDER_ACCEPTED'
        if bad:
            state = deepcopy(state)
            if fault == 'malformed':
                state = {'status': 'PROVIDER_ACCEPTED'}
            elif fault == 'provider':
                state['ack']['providerMessageId'] = 'unrelated-message'
                module._state(state, issuance_id)
                valid_unrelated_states.append(deepcopy(state))
            elif fault == 'nonce':
                # Structurally valid unrelated START/ACK, rejected by this invocation.
                state['start']['invocationNonce'] = state['ack']['invocationNonce'] = 'c' * 64
                module._state(state, issuance_id)
                valid_unrelated_states.append(deepcopy(state))
        return state
    journal = MiddleJournal(middle_bridge, transform)
    middle_status(module, middle_bridge, journal, 'PROVIDER_ACCEPTED' if recover else 'OWNER_REVIEW_REQUIRED')
    assert [op for op, _, _ in journal.calls] == ['readIssuance', 'commitArtifact', 'tryStart', 'recordAck', 'recordAck']
    assert len(valid_unrelated_states) == ((1 if recover else 2) if fault in ('provider', 'nonce') else 0)
    assert len(ack_payloads) == 2 and ack_payloads[0] == ack_payloads[1]
    assert ack_payloads[0] == dict(**journal.calls[2][2], providerMessageId='inert-message')
    assert len(calls['provider']) == len(calls['token']) == len(calls['render']) == 1
    retained = middle_bridge.snapshot()
    starts = [r for r in retained['GuestBookingInvoiceIssuances'] if r['kind'] == 'START']
    acks = [r for r in retained['GuestBookingInvoiceIssuances'] if r['kind'] == 'ACK']
    assert len(starts) == 1
    uncertain = fault == 'throw' and not recover
    assert len(acks) == (0 if uncertain else 1)
    if acks:
        assert {k: acks[0][k] for k in ack_payloads[0]} == ack_payloads[0]
    # Fresh journal adapter; each bridge call also reconstructs native JS modules.
    # Not GP08 fresh Python-interpreter lifecycle evidence.
    fresh = MiddleJournal(middle_bridge)
    index = len(middle_bridge.trace)
    middle_status(module, middle_bridge, fresh, 'OWNER_REVIEW_REQUIRED' if uncertain else 'PROVIDER_ACCEPTED')
    assert [op for op, _, _ in fresh.calls] == ['readIssuance']
    assert len(calls['provider']) == len(calls['token']) == len(calls['render']) == 1
    assert not any(t['op'] == 'insert' for t in middle_bridge.trace[index:])
    assert middle_bridge.snapshot() == retained


# GP07-GP09: actual Python dispatchers; frozen dedicated native bridge only.
@pytest.fixture
def lifecycle_bridge():
    from guest_delivery_lifecycle_support import LifecycleBridge
    instance = LifecycleBridge()
    try:
        yield instance
    finally:
        instance.close()


def test_GP07_two_actual_Python_dispatchers(lifecycle_bridge, monkeypatch, tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from guest_delivery_lifecycle_support import Client, fresh_module, prepare, save_case, unchanged_booking
    bridge = lifecycle_bridge
    events = []
    modules = [fresh_module(monkeypatch, 'race' + str(i), c * 64, events) for i, c in enumerate('bc')]
    assert modules[0] is not modules[1]
    assert modules[0].gmail_sender is not modules[1].gmail_sender
    assert modules[0].invoice_from_original_groups is not modules[1].invoice_from_original_groups
    prepared, raw = prepare(bridge, modules[0], tmp_path)
    before = bridge.snapshot()
    assert bridge.call('armRace') == {'armed': True}
    clients = [Client(bridge, 'race' + str(i)) for i in range(2)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(m.dispatch_initial_guest_invoice, bridge.issuance_id, c)
                   for m, c in zip(modules, clients)]
        results = [f.result(timeout=25) for f in futures]
    after = bridge.snapshot()
    starts = [r for r in after['GuestBookingInvoiceIssuances'] if r['kind'] == 'START']
    acks = [r for r in after['GuestBookingInvoiceIssuances'] if r['kind'] == 'ACK']
    save_case('GP07', events=events, results=results, before=before, after=after,
              clients=[c.calls for c in clients])
    winners = [i for i, r in enumerate(results) if r == {'issuanceId': bridge.issuance_id, 'status': 'PROVIDER_ACCEPTED'}]
    assert len(winners) == 1
    winner = winners[0]
    loser = 1 - winner
    assert results[loser] == {'issuanceId': bridge.issuance_id, 'status': 'OWNER_REVIEW_REQUIRED'}
    assert [op for op, _ in clients[winner].calls] == ['readIssuance', 'tryStart', 'recordAck']
    assert [op for op, _ in clients[loser].calls] == ['readIssuance', 'tryStart']
    assert len(starts) == len(acks) == 1
    payload = clients[winner].calls[1][1]
    assert payload == dict(artifactDigest=prepared['artifact']['artifactDigest'], invocationNonce='bc'[winner] * 64)
    assert all(starts[0][k] == v == acks[0][k] for k, v in payload.items())
    assert acks[0]['providerMessageId'] == 'inert-message'
    assert [e for e in events if e['kind'] == 'provider'] == [dict(worker='race' + str(winner),
        kind='provider', raw=base64.b64encode(raw).decode(), token='inert-token')]
    assert len([e for e in events if e['kind'] == 'token']) == 2
    assert not any(e['kind'] == 'render' for e in events)
    runs = [r for r in bridge.responses if r.get('evidence', {}).get('native')]
    assert len(runs) == 2
    assert sum(len([t for t in r['trace'] if t['op'] == 'insertAck']) for r in runs) == 1
    for i, client in enumerate(clients):
        run = next(r for r in runs if r['evidence']['client'] == client.name)
        assert len(run['evidence']['native']) == 1
        native = run['evidence']['native'][0]
        assert native == dict(starts[0], invocationNonce='bc'[i] * 64)
        assert [t for t in run['trace'] if t['op'] == 'insert'] == [dict(op='insert', collection='GuestBookingInvoiceIssuances', id=starts[0]['_id'])]
        assert run['evidence']['race']['arrived'] is True
        assert run['evidence']['race']['before'] == before
        assert len(run['evidence']['race']['attempts']) == 2
    assert after['GuestBookingInvoiceIssuances'] == before['GuestBookingInvoiceIssuances'] + starts + acks
    unchanged_booking(before, after)


@pytest.mark.parametrize('stage', ['PREPARED', 'START', 'ACK'])
def test_GP08_fresh_Python_module_restart(lifecycle_bridge, monkeypatch, tmp_path, stage):
    from guest_delivery_lifecycle_support import Client, fresh_module, prepare, save_case, unchanged_booking
    bridge, events = lifecycle_bridge, []
    old = fresh_module(monkeypatch, 'old_' + stage, 'b' * 64, events)
    prepared, raw = prepare(bridge, old, tmp_path)
    payload = dict(artifactDigest=prepared['artifact']['artifactDigest'], invocationNonce='b' * 64)
    if stage != 'PREPARED':
        assert bridge.call('tryStart', payload=payload) == dict(won=True, **payload)
    if stage == 'ACK':
        assert bridge.call('recordAck', payload=dict(**payload, providerMessageId='inert-message'))['status'] == 'PROVIDER_ACCEPTED'
    before = bridge.snapshot()
    fresh = fresh_module(monkeypatch, 'new_' + stage, 'c' * 64, events)
    assert fresh is not old and fresh.__dict__ is not old.__dict__
    assert fresh.gmail_sender is not old.gmail_sender
    assert fresh._state is not old._state
    assert fresh.invoice_from_original_groups is not old.invoice_from_original_groups
    assert fresh.Guest is not old.Guest
    client = Client(bridge, 'restarted')
    index = len(bridge.responses)
    status = 'OWNER_REVIEW_REQUIRED' if stage == 'START' else 'PROVIDER_ACCEPTED'
    result = fresh.dispatch_initial_guest_invoice(bridge.issuance_id, client)
    after = bridge.snapshot()
    save_case('GP08_' + stage, result=result, events=events, calls=client.calls, before=before, after=after,
              module_names=[old.__name__, fresh.__name__])
    assert result == dict(issuanceId=bridge.issuance_id, status=status)
    unchanged_booking(before, after)
    if stage != 'PREPARED':
        assert client.calls == [('readIssuance', None)]
        assert events == [] and after == before
        assert not any(t['op'] == 'insert' for r in bridge.responses[index:] for t in r['trace'])
    else:
        assert [op for op, _ in client.calls] == ['readIssuance', 'tryStart', 'recordAck']
        assert events == [dict(worker='new_PREPARED', kind='token'), dict(worker='new_PREPARED', kind='provider',
            raw=base64.b64encode(raw).decode(), token='inert-token')]
        assert client.calls[1][1] == dict(artifactDigest=prepared['artifact']['artifactDigest'], invocationNonce='c' * 64)
        grant = next(r['result'] for r in bridge.responses[index:] if r['result'].get('won'))
        assert grant == dict(won=True, **client.calls[1][1])
        rows = after['GuestBookingInvoiceIssuances']
        assert rows[:-2] == before['GuestBookingInvoiceIssuances']
        assert [r['kind'] for r in rows[-2:]] == ['START', 'ACK']
    final = bridge.call('readIssuance')
    assert final['root'] == prepared['root'] and final['artifact'] == prepared['artifact']


@pytest.mark.parametrize('mode', ['accepted', 'reset', 'timeout', '401', 'redirect', 'bad_status', 'bad_id', 'non_json'])
def test_GP09_actual_lower_transport_no_resend(lifecycle_bridge, monkeypatch, tmp_path, mode):
    from guest_delivery_lifecycle_support import Client, fresh_module, prepare, save_case, lower_transport, unchanged_booking
    bridge, events = lifecycle_bridge, []
    module = fresh_module(monkeypatch, 'transport_' + mode, 'b' * 64, events, real_transport=True)
    calls, sessions = lower_transport(monkeypatch, mode, events)
    prepared, raw = prepare(bridge, module, tmp_path)
    before = bridge.snapshot()
    class ObservedClient(Client):
        def call(self, operation, issuance_id, payload=None):
            value = super().call(operation, issuance_id, payload)
            events.append(dict(kind=operation, result=deepcopy(value)))
            return value
    client = ObservedClient(bridge, 'transport')
    result = module.dispatch_initial_guest_invoice(bridge.issuance_id, client)
    retained = bridge.snapshot()
    status = 'PROVIDER_ACCEPTED' if mode == 'accepted' else 'OWNER_REVIEW_REQUIRED'
    fresh = fresh_module(monkeypatch, 'transport_restart_' + mode, 'c' * 64, events, real_transport=True)
    restart = Client(bridge, 'transport_restart')
    index, event_count = len(bridge.responses), len(events)
    replay = fresh.dispatch_initial_guest_invoice(bridge.issuance_id, restart)
    after = bridge.snapshot()
    save_case('GP09_' + mode, result=result, replay=replay, events=events, lower=calls, sessions=sessions,
              client=client.calls, restart=restart.calls, before=before, after=after)
    assert result == replay == dict(issuanceId=bridge.issuance_id, status=status)
    assert len(calls) == len(sessions) == 1
    lower = calls[0]
    assert lower == dict(host='gmail.googleapis.com', method='POST', url='/gmail/v1/users/me/messages/send',
        retries=0, connect=5, read=30, authorization='Bearer inert-token', body=lower['body'])
    assert json.loads(lower['body']) == {'raw': base64.urlsafe_b64encode(raw).decode()}
    assert sessions[0] == dict(trust_env=False, redirects=False, timeout=[5, 30], retries=0,
        url='https://gmail.googleapis.com/gmail/v1/users/me/messages/send', method='POST', body=lower['body'])
    assert [op for op, _ in client.calls] == ['readIssuance', 'tryStart'] + (['recordAck'] if mode == 'accepted' else [])
    assert [e['kind'] for e in events] == ['readIssuance', 'token', 'tryStart', 'lower_POST'] + (['recordAck'] if mode == 'accepted' else [])
    assert events[2]['result'] == dict(won=True, **client.calls[1][1])
    assert len(events) == event_count
    assert restart.calls == [('readIssuance', None)] and after == retained
    assert not any(t['op'] == 'insert' for r in bridge.responses[index:] for t in r['trace'])
    starts = [r for r in retained['GuestBookingInvoiceIssuances'] if r['kind'] == 'START']
    acks = [r for r in retained['GuestBookingInvoiceIssuances'] if r['kind'] == 'ACK']
    assert len(starts) == 1 and len(acks) == (1 if mode == 'accepted' else 0)
    assert starts[0]['invocationNonce'] == 'b' * 64
    assert starts[0]['artifactDigest'] == prepared['artifact']['artifactDigest']
    if acks:
        expected = dict(**client.calls[1][1], providerMessageId='fixture-exact-lower-ID')
        assert client.calls[2][1] == expected and all(acks[0][k] == v for k, v in expected.items())
    assert after['GuestBookingInvoiceIssuances'] == before['GuestBookingInvoiceIssuances'] + starts + acks
    unchanged_booking(before, after)
