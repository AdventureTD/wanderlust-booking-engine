"""GP02 only. Authored NOTRUN; requires separately reviewed actual artifact pin."""
import base64
from decimal import Decimal, ROUND_HALF_UP
from email import policy
from email.parser import BytesParser
import hashlib
import importlib
import json
from pathlib import Path
import queue
import subprocess
import threading

ROOT = Path(__file__).resolve().parents[1]
PDF = b'%PDF-inert-fixture-not-a-real-render'


def independent_vectors():
    """Public input formula, no production calculator/projector or retained totals."""
    D = Decimal
    money = lambda x: x.quantize(D('0.01'), rounding=ROUND_HALF_UP)
    vectors = []
    for fee in (D('0'), D('10.005')):
        gross = money(D('100') * 2 + fee * 2)
        room = money(gross * D('1'))
        discount = money(gross - room)
        prop = money(room * D('0.05'))
        av = money(room * D('0.5') * D('0.1'))
        pv = money(room * D('0.5') * D('0.15'))
        grand = money(room + prop + av + pv)
        vectors.append(tuple(int(x * 100) for x in (gross, discount, room, prop, av, pv, grand)))
    assert vectors == [(20000, 0, 20000, 1000, 1000, 1500, 23500),
                       (22001, 0, 22001, 1100, 1100, 1650, 25851)]
    return vectors


class Bridge:
    def __init__(self):
        self.trace, self.errors = [], []
        self.queue = queue.Queue()
        self.process = subprocess.Popen(['node', '--experimental-vm-modules',
            'scripts/gp02-distinct-consumer.cjs', '--gp02-distinct-bridge'], cwd=ROOT,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8')
        def receive():
            try:
                for line in self.process.stdout:
                    self.queue.put(json.loads(line))
            finally:
                self.queue.put(None)
        self.output_thread = threading.Thread(target=receive, daemon=True)
        self.error_thread = threading.Thread(target=lambda: self.errors.extend(self.process.stderr), daemon=True)
        self.output_thread.start()
        self.error_thread.start()
        try:
            hello = self.read()
            self.issuance_id = hello['issuanceId']
        except BaseException:
            self.process.kill()
            self.process.wait(timeout=5)
            raise

    def read(self):
        value = self.queue.get(timeout=25)
        assert value is not None, ''.join(self.errors)
        self.trace.extend(value['trace'])
        return value

    def call(self, operation, issuance_id, payload=None):
        assert issuance_id == self.issuance_id
        assert operation in ('readIssuance', 'commitArtifact', 'tryStart', 'recordAck', 'snapshot')
        self.process.stdin.write(json.dumps(dict(operation=operation, payload=payload or {})) + '\n')
        self.process.stdin.flush()
        return self.read()['result']

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
            raise
        finally:
            self.output_thread.join(timeout=5)
            self.error_thread.join(timeout=5)
            self.process.stdout.close()
            self.process.stderr.close()
        assert self.process.returncode == 0, ''.join(self.errors)


def test_GP02_distinct_retained_original_group_order(monkeypatch, tmp_path):
    # Authenticate source and future reviewed artifact before application import.
    pins = json.loads((ROOT / 'source-admission-hashes.json').read_text())
    for name, expected in pins.items():
        assert hashlib.sha256((ROOT / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest() == expected, name
    admit = json.loads((ROOT / 'scripts/distinct-artifact-admission.json').read_text())
    assert admit['status'] == 'REVIEWED_ARTIFACT'
    assert admit['path'] == 'scripts/fixtures/completion-authority-distinct-groups.json'
    raw = (ROOT / admit['path']).read_bytes()
    assert hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest() == admit['sha256CanonicalLF']
    retained = json.loads(raw)
    module = importlib.import_module('booking_engine.guest_invoice_delivery')
    assert Path(module.__file__).resolve() == ROOT / 'booking_engine/guest_invoice_delivery.py'
    rendered, sent, tokens = [], [], []
    def render(invoice, output):
        rendered.append(invoice)
        Path(output).write_bytes(PDF)
        return 'word'
    def token():
        tokens.append('token')
        return 'inert-token'
    monkeypatch.setattr(module, 'render_invoice_pdf_for_service', render)
    monkeypatch.setattr(module.gmail_sender, 'prepare_journal_token', token)
    monkeypatch.setattr(module.gmail_sender, 'send_journal_mime', lambda raw, token: sent.append((raw, token)) or 'inert-message')
    bridge = Bridge()
    try:
        state = bridge.call('readIssuance', bridge.issuance_id)
        assert state['status'] == 'READY' and state['artifact'] is None
        before = bridge.call('snapshot', bridge.issuance_id)['rows']
        result = module.dispatch_initial_guest_invoice(bridge.issuance_id, bridge)
        assert result == {'issuanceId': bridge.issuance_id, 'status': 'PROVIDER_ACCEPTED'}
        assert len(rendered) == len(sent) == len(tokens) == 1
        assert_gp02_distinct_retained_mapping(rendered[0], state['root'], retained)
        assert sent[0][1] == 'inert-token'
        mime = BytesParser(policy=policy.default).parsebytes(sent[0][0])
        assert str(mime['To']) == state['root']['to']
        assert 'Total: $493.51 USD' in mime.get_body(preferencelist=('plain',)).get_content()
        attachment, = mime.iter_attachments()
        assert attachment.get_payload(decode=True) == PDF
        accepted = bridge.call('readIssuance', bridge.issuance_id)
        assert accepted['status'] == 'PROVIDER_ACCEPTED'
        assert base64.b64decode(accepted['artifact']['encoded']) == sent[0][0]
        after = bridge.call('snapshot', bridge.issuance_id)['rows']
        for name in set(before) | set(after):
            if name != 'GuestBookingInvoiceIssuances':
                assert before.get(name) == after.get(name)
        assert all(t['collection'] == 'GuestBookingInvoiceIssuances' for t in bridge.trace if t['op'] == 'insert')
    finally:
        try:
            bridge.close()
        finally:
            (tmp_path / 'gp02-native-evidence.json').write_text(json.dumps(dict(
                exit=bridge.process.returncode, trace=bridge.trace, stderr=bridge.errors)), encoding='utf-8')


def assert_gp02_distinct_retained_mapping(invoice, root, retained_fixture):
    import json
    from decimal import Decimal
    from datetime import date
    D = Decimal
    receipt, = retained_fixture['db']['rows']['GuestBookingCompletions']
    acceptance, = retained_fixture['db']['rows']['GuestBookingAcceptances']
    expected_subject = retained_fixture['expected']
    assert receipt['outcome'] == 'CONFIRMED'
    assert receipt['acceptanceId'] == acceptance['_id'] == expected_subject['acceptanceId']
    assert receipt['operationId'] == acceptance['operationId'] == expected_subject['operationId']
    assert receipt['rootDigest'] == acceptance['rootDigest'] == expected_subject['rootDigest']
    assert root['projectionCanonical'] == receipt['projectionCanonical']
    assert root['projectionDigest'] == receipt['projectionDigest']
    summary = json.loads(receipt['projectionCanonical'])['summary']
    calculation = summary['acceptedCalculation']
    assert calculation == json.loads(acceptance['capsule'])['calculation']
    keys = ('grossCents', 'discountCents', 'roomTotalCents', 'propertyFeeCents',
            'accommodationVatCents', 'packageVatCents', 'grandTotalCents')
    vectors = independent_vectors()
    groups = calculation['groups']
    assert [(g['index'], g['roomCode'], g['quantity'], g['guests']) for g in groups] == [
        (0, 'adventure_suite', 1, 2), (1, 'penthouse_apartment', 1, 2)]
    assert [tuple(g[k] for k in keys) for g in groups] == vectors
    components = dict(zip(keys, (sum(column) for column in zip(*vectors))))
    components['totalVatCents'] = components['accommodationVatCents'] + components['packageVatCents']
    assert calculation['totals'] == dict(components, totalRooms=2, totalGuests=4)
    assert dict(invoice._component_cents) == components
    expected_lines = [
        ('Adventure Suite', D('200.00'), D('25.00'), D('225.00')),
        ('Penthouse Apartment', D('220.01'), D('27.50'), D('247.51'))]
    actual_lines = [(line.label, line.net, line.vat, line.gross) for line in invoice.lines]
    assert actual_lines == expected_lines
    assert actual_lines != expected_lines[::-1]
    for line in invoice.lines:
        assert all(type(getattr(line, k)) is D for k in ('net', 'vat', 'gross'))
        assert line.quantity == 2 and line.room_quantity == 1 and line.tax_class == 'mixed'
        assert line.unit_price is None and line.vat_rate is None
    for attr, key in [('subtotal_net', 'roomTotalCents'), ('property_fee', 'propertyFeeCents'),
                      ('total_vat', 'totalVatCents'), ('total', 'grandTotalCents'),
                      ('promo_discount_amount', 'discountCents')]:
        assert type(getattr(invoice, attr)) is D
        assert getattr(invoice, attr) == D(components[key]) / 100
    assert invoice.vat_by_class == {'accommodation': D('21.00'), 'standard': D('31.50')}
    assert all(type(v) is D for v in invoice.vat_by_class.values())
    assert invoice.explicit_vat_amounts() == (D('21.00'), D('31.50'))
    assert invoice.invoice_number == root['_id']
    assert invoice.booking_number == summary['bookingNumber'] == receipt['bookingNumber']
    assert invoice.issue_date == date.fromisoformat(summary['bookingDate'][:10])
    assert invoice.check_in == summary['checkIn'] == '2027-01-01'
    assert invoice.check_out == summary['checkOut'] == '2027-01-03'
    assert invoice.package_title == summary['packageTitle'] == 'Public fixture stay'
    assert invoice.guest.name == summary['guestName'] == 'Fixture Guest'
    assert invoice.guest.email == summary['guestEmail'] == root['to'] == 'fixture@example.test'
    assert invoice.guest.phone == summary['guestPhone'] == '1234567'
    assert invoice.currency == calculation['currency'] == 'USD'
    assert invoice.total_guests == 4 and invoice.promo_code == '' and invoice.payments == []
