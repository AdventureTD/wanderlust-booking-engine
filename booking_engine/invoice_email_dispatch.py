"""Owner-document dispatch: durable exclusion, never automatic uncertain resend."""
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import uuid
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
from .invoice_owner_issuance import invoice_from_owner_issuance
from .invoice_renderer import render_invoice_pdf_for_service
from . import gmail_sender

BOOT_ID = str(uuid.uuid4())
MAX_MIME = 8388608


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def key(namespace, *parts):
    return digest(canonical([namespace, *parts]).encode('utf-8'))


def validate_state(state, issuance_id):
    if type(state) is not dict or set(state) != {'root', 'artifact', 'encoded', 'artifactDigest', 'start', 'ack'}:
        raise ValueError('journal_integrity')
    root = state['root']
    invoice = invoice_from_owner_issuance(root)
    if root['_id'] != issuance_id:
        raise ValueError('journal_integrity')
    artifact, start, ack = state['artifact'], state['start'], state['ack']
    raw = None
    if artifact is not None:
        expected = {'_id', 'kind', 'issuanceId', 'documentDigest', 'to', 'cc', 'from', 'chunkIds', 'mimeDigest', 'byteLength', 'pdfDigest', 'rendererVersion'}
        if type(artifact) is not dict or set(artifact) != expected:
            raise ValueError('artifact_integrity')
        if (artifact['_id'] != key('invoice-artifact/v1', issuance_id) or artifact['kind'] != 'ARTIFACT' or
                artifact['issuanceId'] != issuance_id or artifact['documentDigest'] != root['documentDigest'] or
                any(artifact[n] != root[n] for n in ('to', 'cc', 'from')) or
                digest(canonical(artifact).encode()) != state['artifactDigest']):
            raise ValueError('artifact_integrity')
        encoded = state['encoded']
        if type(encoded) is not str or len(encoded) > 11184812:
            raise ValueError('artifact_bounds')
        raw = base64.b64decode(encoded, validate=True)
        if (not 0 < len(raw) <= MAX_MIME or type(artifact['byteLength']) is not int or
                len(raw) != artifact['byteLength'] or digest(raw) != artifact['mimeDigest'] or
                base64.b64encode(raw).decode() != encoded):
            raise ValueError('artifact_integrity')
        msg = BytesParser(policy=policy.default).parsebytes(raw)
        if msg.defects or any(part.defects for part in msg.walk()):
            raise ValueError('mime_integrity')
        for field, value in [('To', root['to']), ('Cc', root['cc']), ('From', root['from'])]:
            fields = msg.get_all(field, [])
            addresses = [address for _, address in getaddresses(fields)]
            if len(fields) != (1 if value else 0) or addresses != ([value] if value else []):
                raise ValueError('mime_recipient_integrity')
        if msg.get_all('Bcc') or msg.get_all('Resent-To') or msg.get_all('Resent-Cc') or msg.get_all('Resent-Bcc'):
            raise ValueError('mime_recipient_integrity')
        attachments = list(msg.iter_attachments())
        if len(attachments) != 1 or attachments[0].get_content_type() != 'application/pdf' or digest(attachments[0].get_payload(decode=True)) != artifact['pdfDigest']:
            raise ValueError('pdf_integrity')
    elif state['artifactDigest'] != '' or state['encoded'] != '':
        raise ValueError('artifact_integrity')
    if start is not None:
        if not artifact or type(start) is not dict:
            raise ValueError('start_integrity')
        expected = {'_id': key('invoice-send-start/v1', issuance_id), 'kind': 'START', 'issuanceId': issuance_id,
                    'documentDigest': root['documentDigest'], 'artifactDigest': state['artifactDigest'],
                    'workerBootId': start.get('workerBootId'), 'invocationNonce': start.get('invocationNonce')}
        if start != expected or any(type(start[n]) is not str or not start[n] or len(start[n]) > 256 for n in ('workerBootId', 'invocationNonce')):
            raise ValueError('start_integrity')
    if ack is not None:
        import re
        if not start or type(ack) is not dict or type(ack.get('providerMessageId')) is not str or not re.fullmatch('[A-Za-z0-9_-]{1,256}', ack['providerMessageId']):
            raise ValueError('ack_integrity')
        expected = {'_id': key('invoice-send-ack/v1', issuance_id), 'kind': 'ACK', 'issuanceId': issuance_id,
                    'documentDigest': root['documentDigest'], 'artifactDigest': state['artifactDigest'],
                    'invocationNonce': start['invocationNonce'], 'to': root['to'], 'cc': root['cc'], 'from': root['from'],
                    'providerMessageId': ack['providerMessageId'], 'status': 'provider_accepted'}
        if ack != expected:
            raise ValueError('ack_integrity')
    return invoice, raw


def outcome(state, issuance_id):
    result = {'issuanceId': issuance_id, 'revision': json.loads(state['root']['document'])['revision']}
    if state['ack'] is not None:
        return dict(result, status='provider_accepted', providerMessageId=state['ack']['providerMessageId'])
    if state['start'] is not None:
        return dict(result, status='owner_review_required')
    return dict(result, status='preparation_retryable')


def dispatch_issuance(issuance_id, journal):
    # Authentication is performed by the endpoint and fixed bridge, never by caller flags.
    try:
        state = journal.call('readIssuance', issuance_id)
        invoice, raw = validate_state(state, issuance_id)
    except Exception:
        return {'issuanceId': issuance_id, 'status': 'journal_unavailable'}
    if state['start'] is not None or state['ack'] is not None:
        return outcome(state, issuance_id)
    try:
        token = gmail_sender.prepare_journal_token()
        if raw is None:
            with tempfile.TemporaryDirectory(prefix='owner-invoice-' + issuance_id + '-') as directory:
                pdf = Path(directory) / 'invoice.pdf'
                renderer = render_invoice_pdf_for_service(invoice, str(pdf))
                root = state['root']
                facts = json.loads(root['document'])
                raw = gmail_sender.build_invoice_email(root['to'], facts['guest']['name'], facts['invoiceNumber'],
                    str(pdf), f'${invoice.total:,.2f} {invoice.currency}', owner_only=root['purpose'] == 'owner_copy').as_bytes()
                pdf_digest = digest(pdf.read_bytes())
            if not 0 < len(raw) <= MAX_MIME:
                raise ValueError('mime_bounds')
            encoded = base64.b64encode(raw).decode('ascii')
            chunk_ids = []
            for offset in range(0, len(encoded), 100000):
                data = encoded[offset:offset + 100000]
                chunk_digest = digest(base64.b64decode(data, validate=True))
                chunk_id = key('invoice-artifact-chunk/v1', chunk_digest)
                chunk = {'_id': chunk_id, 'kind': 'ARTIFACT_CHUNK', 'data': data, 'digest': chunk_digest}
                if journal.call('putChunk', issuance_id, chunk) != {'stored': chunk_id}:
                    raise ValueError('chunk_readback')
                chunk_ids.append(chunk_id)
            artifact = {'_id': key('invoice-artifact/v1', issuance_id), 'kind': 'ARTIFACT', 'issuanceId': issuance_id,
                        'documentDigest': root['documentDigest'], 'to': root['to'], 'cc': root['cc'], 'from': root['from'],
                        'chunkIds': chunk_ids, 'mimeDigest': digest(raw), 'byteLength': len(raw), 'pdfDigest': pdf_digest,
                        'rendererVersion': 'owner-invoice-v1/' + str(renderer)}
            state = journal.call('commitArtifact', issuance_id, artifact)
            invoice, raw = validate_state(state, issuance_id)
            if raw is None:
                raise ValueError('artifact_missing')
        if state['start'] is not None or state['ack'] is not None:
            return outcome(state, issuance_id)
    except Exception:
        # A concurrent START/ACK dominates any preparation failure.
        try:
            state = journal.call('readIssuance', issuance_id)
            validate_state(state, issuance_id)
            return outcome(state, issuance_id)
        except Exception:
            return {'issuanceId': issuance_id, 'status': 'journal_unavailable'}
    nonce = str(uuid.uuid4())
    try:
        grant = journal.call('tryStart', issuance_id, {'artifactDigest': state['artifactDigest'],
                             'workerBootId': BOOT_ID, 'invocationNonce': nonce})
        if grant != {'won': True, 'invocationNonce': nonce, 'artifactDigest': state['artifactDigest']} or grant.get('won') is not True:
            return {'issuanceId': issuance_id, 'status': 'owner_review_required'}
    except Exception:
        return {'issuanceId': issuance_id, 'status': 'owner_review_required'}
    # Only this just-returned, nonce-bound grant authorizes entry. Spend before IO.
    grant = None
    try:
        message_id = gmail_sender.send_journal_mime(raw, token)
    except Exception:
        return {'issuanceId': issuance_id, 'status': 'owner_review_required'}
    ack = {'artifactDigest': state['artifactDigest'], 'invocationNonce': nonce, 'providerMessageId': message_id}
    for _ in range(2):
        try:
            retained = journal.call('recordAck', issuance_id, ack)
            validate_state(retained, issuance_id)
            if retained['ack'] is not None and retained['ack']['providerMessageId'] == message_id and retained['ack']['invocationNonce'] == nonce:
                return outcome(retained, issuance_id)
        except Exception:
            pass  # Retry only exact ACK; never tryStart or Gmail.
    return {'issuanceId': issuance_id, 'status': 'owner_review_required'}
