"""Finite MIME budget; actual frozen consumer only, never producer/default suites."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from email import policy
from email.parser import BytesParser
import pytest
from test_guest_invoice_distinct_mapping import Bridge, assert_gp02_distinct_retained_mapping

ROOT = Path(__file__).resolve().parents[1]
MAX_MIME = 298356
MAX_ENCODED = 397808
OUT = Path(os.environ.get('MIME_EVIDENCE', str(ROOT / '.mime-evidence')))


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def save(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(value, indent=2, default=str), encoding='utf-8')


@pytest.fixture
def consumer(monkeypatch):
    from booking_engine import guest_invoice_delivery as module
    monkeypatch.setenv('WBE_INVOICE_RENDERER', 'word')
    monkeypatch.setenv('WBE_INVOICE_REPORTLAB_FALLBACK', '0')
    monkeypatch.setenv('LIBREOFFICE_PATH', 'C:/Program Files/LibreOffice/program/soffice.exe')
    monkeypatch.setattr(module.gmail_sender, 'prepare_journal_token', lambda: 'inert-token')
    return module


def close(bridge, name):
    bridge.close()
    save(name + '-bridge.json', dict(exit=bridge.process.returncode, trace=bridge.trace, stderr=bridge.errors))


def test_real_word_consumer(consumer, monkeypatch):
    sent, rendered, native = [], [], []
    real_render = consumer.render_invoice_pdf_for_service
    from booking_engine import invoice_word
    real_run = subprocess.run
    def observed_run(*args, **kwargs):
        result = real_run(*args, **kwargs)
        native.append(dict(command=args[0], exit=result.returncode))
        return result
    # Do not patch global subprocess (Bridge uses real local Node).
    import types
    monkeypatch.setattr(invoice_word, 'subprocess', types.SimpleNamespace(run=observed_run))
    def render(invoice, output):
        rendered.append(invoice)
        used = real_render(invoice, output)
        OUT.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(output, OUT / 'real-word.pdf')
        assert used == 'word'
        return used
    monkeypatch.setattr(consumer, 'render_invoice_pdf_for_service', render)
    monkeypatch.setattr(consumer.gmail_sender, 'send_journal_mime', lambda raw, token: sent.append(raw) or 'inert-message')
    # Capture original dispatch-built MIME even when precommit denies it.
    build = consumer.gmail_sender.build_invoice_email
    def observed_build(*args, **kwargs):
        msg = build(*args, **kwargs)
        raw = msg.as_bytes()
        (OUT / 'real-mime.eml').write_bytes(raw)
        return msg
    monkeypatch.setattr(consumer.gmail_sender, 'build_invoice_email', observed_build)
    bridge = Bridge()
    try:
        initial = bridge.call('readIssuance', bridge.issuance_id)
        before = bridge.call('snapshot', bridge.issuance_id)['rows']
        result = consumer.dispatch_initial_guest_invoice(bridge.issuance_id, bridge)
        final = bridge.call('readIssuance', bridge.issuance_id)
        after = bridge.call('snapshot', bridge.issuance_id)['rows']
        raw = (OUT / 'real-mime.eml').read_bytes()
        pdf = (OUT / 'real-word.pdf').read_bytes()
        save('real-result.json', dict(result=result, state=final, provider_calls=len(sent), native=native,
             pdf_bytes=len(pdf), pdf_sha256=sha(pdf), mime_bytes=len(raw), mime_sha256=sha(raw),
             base64_chars=len(base64.b64encode(raw))))
        fixture = json.loads((ROOT / 'scripts/fixtures/completion-authority-distinct-groups.json').read_text())
        assert_gp02_distinct_retained_mapping(rendered[0], initial['root'], fixture)
        for key in set(before) | set(after):
            if key != 'GuestBookingInvoiceIssuances':
                assert before.get(key) == after.get(key)
        if result['status'] != 'PROVIDER_ACCEPTED':
            assert after == before and not sent
        assert result['status'] == 'PROVIDER_ACCEPTED'
        assert len(sent) == 1 and sent[0] == raw
        assert base64.b64decode(final['artifact']['encoded']) == raw
        attachment, = BytesParser(policy=policy.default).parsebytes(raw).iter_attachments()
        assert attachment.get_payload(decode=True) == pdf
        assert final['artifact']['rendererVersion'] == 'word'
        assert native and all(row['exit'] == 0 for row in native)
        assert sha((ROOT / 'invoice_template.docx').read_bytes()) == '353ce740e64385227c18391d134e049940c3c3ae60a3a67c58dd1a8370a8854a'
    finally:
        close(bridge, 'real')


@pytest.mark.parametrize('size', [MAX_MIME - 1, MAX_MIME, MAX_MIME + 1, MAX_MIME + 2])
def test_dispatch_mime_boundary(consumer, monkeypatch, size):
    sent = []
    def render(invoice, output):
        Path(output).write_bytes(b'%PDF-synthetic-boundary')
        return 'word'
    build = consumer.gmail_sender.build_invoice_email
    def padded(*args, **kwargs):
        raw = build(*args, **kwargs).as_bytes()
        # Legal multipart epilogue, not a fake provider or journal response.
        raw += b' ' * (size - len(raw))
        assert len(raw) == size
        class Message:
            def as_bytes(self): return raw
        return Message()
    monkeypatch.setattr(consumer, 'render_invoice_pdf_for_service', render)
    monkeypatch.setattr(consumer.gmail_sender, 'build_invoice_email', padded)
    monkeypatch.setattr(consumer.gmail_sender, 'send_journal_mime', lambda raw, token: sent.append(raw) or 'inert-message')
    bridge = Bridge()
    calls = []
    native_call = bridge.call
    def observed_call(operation, *args, **kwargs):
        calls.append(operation)
        return native_call(operation, *args, **kwargs)
    monkeypatch.setattr(bridge, 'call', observed_call)
    try:
        before = bridge.call('snapshot', bridge.issuance_id)['rows']
        offset = len(bridge.trace)
        result = consumer.dispatch_initial_guest_invoice(bridge.issuance_id, bridge)
        after = bridge.call('snapshot', bridge.issuance_id)['rows']
        inserts = [t for t in bridge.trace[offset:] if t['op'] == 'insert']
        save(f'dispatch-{size}.json', dict(result=result, provider_calls=len(sent), inserts=inserts, journal_calls=calls))
        if size <= MAX_MIME:
            assert result['status'] == 'PROVIDER_ACCEPTED'
            assert len(sent) == 1 and len(sent[0]) == size
            assert len(inserts) == 3
        else:
            assert result['status'] == 'UNAVAILABLE'
            assert after == before and inserts == [] and sent == []
            assert 'tryStart' not in calls and 'commitArtifact' not in calls
    finally:
        close(bridge, f'dispatch-{size}')


@pytest.mark.parametrize('pdf_size,expected_mime', [(219969, 298353), (219970, 298357)])
def test_frozen_message_pdf_budget(consumer, tmp_path, pdf_size, expected_mime):
    # Size-only PDF payload, not a claim of rendered/valid PDF at the limit.
    bridge = Bridge()
    try:
        state = bridge.call('readIssuance', bridge.issuance_id)
        root = state['root']
        invoice = consumer._invoice(root, bridge.issuance_id)
        path = tmp_path / 'invoice.pdf'
        path.write_bytes(b'x' * pdf_size)
        msg = consumer.gmail_sender.build_invoice_email(root['to'], invoice.guest.name,
            bridge.issuance_id, str(path), '$493.51 USD', owner_only=False)
        raw = msg.as_bytes()
        assert len(raw) == expected_mime
        assert len(raw) == 1201 + 4 * ((pdf_size + 2) // 3) + (pdf_size + 56) // 57
        assert (len(raw) <= MAX_MIME) == (pdf_size == 219969)
    finally:
        close(bridge, f'pdf-{pdf_size}')


@pytest.mark.parametrize('extra', [1, 2])
def test_oversized_readback_denied_before_start(consumer, monkeypatch, extra):
    bridge = Bridge()
    calls, sent = [], []
    monkeypatch.setattr(consumer.gmail_sender, 'send_journal_mime', lambda *args: sent.append(args))
    try:
        state = bridge.call('readIssuance', bridge.issuance_id)
        before = bridge.call('snapshot', bridge.issuance_id)['rows']
        root = state['root']
        raw = b'x' * (MAX_MIME + extra)
        artifact = dict(_id=consumer._key('wbe.guest-invoice-delivery.v1',[bridge.issuance_id,'PREPARED']),
            kind='PREPARED', issuanceId=bridge.issuance_id, documentDigest=root['projectionDigest'],
            encoded=base64.b64encode(raw).decode(), mimeDigest=sha(raw), pdfDigest='a'*64, rendererVersion='word')
        artifact['artifactDigest'] = consumer._key('wbe.guest-invoice-artifact.v1',
            [bridge.issuance_id,root['projectionDigest'],artifact['mimeDigest'],artifact['pdfDigest'],'word'])
        state['artifact'] = artifact
        class BadRead:
            def call(self, operation, *args):
                calls.append(operation)
                assert operation == 'readIssuance'
                return state
        result = consumer.dispatch_initial_guest_invoice(bridge.issuance_id, BadRead())
        assert result['status'] == 'UNAVAILABLE' and calls == ['readIssuance'] and sent == []
        assert bridge.call('snapshot', bridge.issuance_id)['rows'] == before
    finally:
        close(bridge, f'readback-{extra}')


@pytest.mark.parametrize('size', [MAX_MIME, MAX_MIME + 1, MAX_MIME + 3])
def test_native_artifact_boundary(consumer, size):
    bridge = Bridge()
    try:
        before = bridge.call('snapshot', bridge.issuance_id)['rows']
        offset = len(bridge.trace)
        raw = b'x' * size  # Native persistence contract; MIME semantics checked in Python separately.
        payload = dict(encoded=base64.b64encode(raw).decode(), mimeDigest=sha(raw),
                       pdfDigest='a' * 64, rendererVersion='reportlab-fallback')
        result = bridge.call('commitArtifact', bridge.issuance_id, payload)
        after = bridge.call('snapshot', bridge.issuance_id)['rows']
        inserts = [t for t in bridge.trace[offset:] if t['op'] == 'insert']
        if size <= MAX_MIME:
            assert result['status'] == 'READY' and len(inserts) == 1
            record = dict(result['artifact'])
            record.update(_owner='\x00' * 256, _createdDate='+275760-09-13T00:00:00.000Z',
                          _updatedDate='+275760-09-13T00:00:00.000Z')
            full_bytes = len(json.dumps(record, separators=(',', ':'), ensure_ascii=False).encode())
            assert full_bytes == 399997
            assert len(payload['encoded']) == MAX_ENCODED
            save('max-budget.json', dict(mime_bytes=size, base64_chars=len(payload['encoded']),
                 full_json_bytes=full_bytes, platform_headroom=500000-full_bytes))
        else:
            assert result['status'] == 'UNAVAILABLE'
            assert inserts == [] and after == before
    finally:
        close(bridge, f'native-{size}')
