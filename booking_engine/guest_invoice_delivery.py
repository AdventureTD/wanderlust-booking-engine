"""Disconnected initial-guest dispatch; no HTTP route, discovery or capability.

The supplied private journal transport must bind server-discovered A/O/D to the
actual guestBookingInvoiceDeliveryOperation. InvoiceEmailJournal's owner endpoint
is NOT that transport. No caller-supplied root is authenticated by this module.
"""
import base64
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import secrets
import tempfile
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses

from .invoice import Guest
from .invoice_original_groups import invoice_from_original_groups
from .invoice_renderer import render_invoice_pdf_for_service
from . import gmail_sender

HOTEL = 'info@wanderlustcaribbean.com'
HEX = r'[a-f0-9]{64}'
MAX_MIME = 90000  # finite single-record tranche; larger artifacts defer before START


def _require(condition):
    if not condition:
        raise ValueError('guest_invoice_integrity')


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def _digest(raw):
    return hashlib.sha256(raw).hexdigest()


def _key(domain, values):
    return _digest((domain+'\0'+_json(values)).encode())


def _parse(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result)
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs)


def _invoice(root, issuance_id):
    fields = {'_id','schemaVersion','kind','revision','audience','acceptanceId','operationId',
              'rootDigest','receiptId','projectionDigest','financialDigest','recipientBindingDigest',
              'projectionCanonical','to','cc','from'}
    _require(type(root) is dict and set(root) == fields)
    _require(type(root['schemaVersion']) is int and root['schemaVersion'] == 1)
    _require(root['_id'] == issuance_id and root['kind'] == 'INITIAL_ISSUANCE' and root['revision'] == 'initial')
    _require(all(type(root[k]) is str and re.fullmatch(HEX, root[k]) for k in
                 ('_id','acceptanceId','operationId','rootDigest','projectionDigest','financialDigest','recipientBindingDigest')))
    _require(root['_id'] == _key('wbe.guest-initial-invoice.v1',
        [root['audience'],root['receiptId'],'initial',root['recipientBindingDigest']]))
    _require(root['acceptanceId'] == _digest(('wbe.acceptance-id.v2\0'+root['operationId']).encode()))
    _require(root['receiptId'] == 'gbc1-'+root['acceptanceId'])
    raw = root['projectionCanonical']
    _require(type(raw) is str and len(raw.encode()) <= 160000)
    # Completion digests use newline separators, unlike issuance/delivery keys.
    _require(root['projectionDigest'] == _digest(('wbe.completion-projection-record.v1\n'+raw).encode()))
    projection = _parse(raw)
    _require(_json(projection) == raw)
    summary = projection['summary']
    _require(summary['guestEmail'] == root['to'] and root['cc'] == root['from'] == HOTEL)
    _require(summary['financialDigest'] == root['financialDigest'] ==
        _digest(('wbe.completion-financial.v1\n'+_json(summary['acceptedCalculation'])).encode()))
    _require(summary['acceptanceId'] == root['acceptanceId'] and summary['rootDigest'] == root['rootDigest'])
    check_in, check_out = date.fromisoformat(summary['checkIn']), date.fromisoformat(summary['checkOut'])
    invoice = invoice_from_original_groups(summary['acceptedCalculation'], invoice_number=issuance_id,
        issue_date=date.fromisoformat(summary['bookingDate'][:10]),
        guest=Guest(summary['guestName'],root['to'],summary['guestPhone']),
        display=dict(nights=(check_out-check_in).days,check_in=summary['checkIn'],check_out=summary['checkOut'],
                     package_title=summary['packageTitle'],promo_code=''))
    # No current pricing, regrouping, counter or payment defaults. The actual
    # private journal positively verifies empty BookingPayments in this tranche.
    invoice.payments = []
    invoice.booking_number = summary['bookingNumber']
    return invoice


def _state(state, issuance_id, expected_root=None):
    _require(type(state) is dict and set(state) == {'status','root','payments','artifact','start','ack'})
    root = state['root']
    invoice = _invoice(root, issuance_id)
    _require(type(state['payments']) is list and state['payments'] == [])
    if expected_root is not None:
        _require(root == expected_root)
    artifact, start, ack = state['artifact'], state['start'], state['ack']
    raw = None
    stage = lambda kind: _key('wbe.guest-invoice-delivery.v1',[issuance_id,kind])
    if artifact is not None:
        _require(type(artifact) is dict and set(artifact) == {'_id','kind','issuanceId','documentDigest',
                 'encoded','mimeDigest','pdfDigest','rendererVersion','artifactDigest'})
        _require(artifact['_id'] == stage('PREPARED') and artifact['kind'] == 'PREPARED' and
                 artifact['issuanceId'] == issuance_id and artifact['documentDigest'] == root['projectionDigest'])
        _require(type(artifact['encoded']) is str and 0 < len(artifact['encoded']) <= 120000)
        raw = base64.b64decode(artifact['encoded'], validate=True)
        _require(0 < len(raw) <= MAX_MIME and base64.b64encode(raw).decode() == artifact['encoded'])
        _require(_digest(raw) == artifact['mimeDigest'] and artifact['rendererVersion'] in ('word','reportlab','reportlab-fallback'))
        _require(artifact['artifactDigest'] == _key('wbe.guest-invoice-artifact.v1',
            [issuance_id,root['projectionDigest'],artifact['mimeDigest'],artifact['pdfDigest'],artifact['rendererVersion']]))
        msg = BytesParser(policy=policy.default).parsebytes(raw)
        _require(not msg.defects and not any(part.defects for part in msg.walk()))
        for name, expected in [('To',root['to']),('Cc',HOTEL),('From',HOTEL)]:
            headers = msg.get_all(name,[])
            _require(len(headers) == 1 and [addr for _,addr in getaddresses(headers)] == [expected])
        _require(not any(msg.get_all(name) for name in ('Bcc','Resent-To','Resent-Cc','Resent-Bcc')))
        attachments = list(msg.iter_attachments())
        _require(len(attachments) == 1 and attachments[0].get_content_type() == 'application/pdf')
        _require(_digest(attachments[0].get_payload(decode=True)) == artifact['pdfDigest'])
    if start is not None:
        _require(artifact is not None and type(start) is dict)
        _require(type(start.get('invocationNonce')) is str and re.fullmatch(HEX,start['invocationNonce']))
        _require(start == dict(_id=stage('START'),kind='START',issuanceId=issuance_id,
            documentDigest=root['projectionDigest'],artifactDigest=artifact['artifactDigest'],invocationNonce=start['invocationNonce']))
    if ack is not None:
        _require(start is not None and type(ack) is dict)
        _require(type(ack.get('providerMessageId')) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,256}',ack['providerMessageId']))
        _require(ack == dict(_id=stage('ACK'),kind='ACK',issuanceId=issuance_id,
            documentDigest=root['projectionDigest'],artifactDigest=start['artifactDigest'],
            invocationNonce=start['invocationNonce'],providerMessageId=ack['providerMessageId']))
    _require(state['status'] == ('PROVIDER_ACCEPTED' if ack else 'OWNER_REVIEW_REQUIRED' if start else 'READY'))
    return invoice, raw


def dispatch_initial_guest_invoice(issuance_id, journal):
    """One bounded private dispatch; START is never retried after uncertainty."""
    result = lambda status: {'issuanceId':issuance_id,'status':status}
    if type(issuance_id) is not str or not re.fullmatch(HEX,issuance_id):
        return result('DENIED')
    try:
        state = journal.call('readIssuance',issuance_id)
        invoice, raw = _state(state,issuance_id)
        if state['status'] != 'READY':
            return result(state['status'])
        root = dict(state['root'])
        token = gmail_sender.prepare_journal_token()
        if raw is None:
            with tempfile.TemporaryDirectory(prefix='guest-invoice-') as directory:
                pdf = Path(directory)/'invoice.pdf'
                renderer = render_invoice_pdf_for_service(invoice,str(pdf))
                raw = gmail_sender.build_invoice_email(root['to'],invoice.guest.name,issuance_id,
                    str(pdf),f'${invoice.total:,.2f} {invoice.currency}',owner_only=False).as_bytes()
                payload = dict(encoded=base64.b64encode(raw).decode(),mimeDigest=_digest(raw),
                    pdfDigest=_digest(pdf.read_bytes()),rendererVersion=renderer)
            _require(0 < len(raw) <= MAX_MIME)
            state = journal.call('commitArtifact',issuance_id,payload)
            invoice, raw = _state(state,issuance_id,root)
            _require(raw is not None)
            if state['status'] != 'READY':
                return result(state['status'])
        nonce = secrets.token_hex(32)
        artifact_digest = state['artifact']['artifactDigest']
    except Exception:
        return result('UNAVAILABLE')
    try:
        grant = journal.call('tryStart',issuance_id,dict(artifactDigest=artifact_digest,invocationNonce=nonce))
        _require(type(grant) is dict and grant == dict(won=True,invocationNonce=nonce,artifactDigest=artifact_digest) and grant['won'] is True)
    except Exception:
        return result('OWNER_REVIEW_REQUIRED')
    # Spend the live nonce-bound grant before provider IO; no send retry loop.
    grant = None
    try:
        message_id = gmail_sender.send_journal_mime(raw,token)
        _require(type(message_id) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,256}',message_id))
    except Exception:
        return result('OWNER_REVIEW_REQUIRED')
    for _ in range(2):
        try:
            state = journal.call('recordAck',issuance_id,dict(artifactDigest=artifact_digest,
                invocationNonce=nonce,providerMessageId=message_id))
            _state(state,issuance_id,root)
            _require(state['ack']['invocationNonce'] == nonce and state['ack']['providerMessageId'] == message_id)
            return result('PROVIDER_ACCEPTED')
        except Exception:
            pass  # exact ACK only; never retry START, renderer or provider
    return result('OWNER_REVIEW_REQUIRED')
