"""Fixed authenticated bridge. No creation operation or transport retries."""
import os
import re
from urllib.parse import urlsplit
import requests
from requests.adapters import HTTPAdapter

OPERATIONS = frozenset({'readIssuance', 'putChunk', 'commitArtifact', 'tryStart', 'recordAck'})


class InvoiceEmailJournal:
    def __init__(self, site, secret):
        parsed = urlsplit(site)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or
                parsed.password or parsed.port or parsed.path not in ('', '/') or
                parsed.query or parsed.fragment or not secret):
            raise ValueError('journal_configuration_unavailable')
        self._url = site.rstrip('/') + '/_functions/invoiceEmailJournal'
        self._secret = secret

    @classmethod
    def from_environment(cls):
        return cls(os.environ.get('WBE_INVOICE_JOURNAL_SITE', ''),
                   os.environ.get('WBE_SHARED_SECRET', ''))

    def scan_pending(self, cursor):
        validate_cursor(cursor)
        with requests.Session() as session:
            session.trust_env = False
            session.mount('https://', HTTPAdapter(max_retries=0))
            response = session.post(self._url,
                headers={'X-WBE-Secret': self._secret, 'Content-Type': 'application/json'},
                json={'operation': 'scanPending', 'cursor': cursor},
                allow_redirects=False, timeout=(5, 30))
            if response.status_code != 200 or len(response.content) > 16000:
                raise ValueError('journal_unavailable')
            return validate_review_page(response.json(), cursor)

    def call(self, operation, issuance_id, payload=None):
        if operation not in OPERATIONS or type(issuance_id) is not str or not re.fullmatch('[a-f0-9]{64}', issuance_id):
            raise ValueError('invalid_journal_operation')
        # In particular tryStart is never retried, even after a lost response.
        with requests.Session() as session:
            session.trust_env = False
            session.mount('https://', HTTPAdapter(max_retries=0))
            response = session.post(self._url,
                headers={'X-WBE-Secret': self._secret, 'Content-Type': 'application/json'},
                json={'operation': operation, 'issuanceId': issuance_id, 'payload': payload or {}},
                allow_redirects=False, timeout=(5, 30))
            if response.status_code != 200 or len(response.content) > 16000000:
                raise ValueError('journal_unavailable')
            result = response.json()
            if type(result) is not dict:
                raise ValueError('journal_integrity')
            return result

def validate_cursor(cursor):
    if cursor is not None and (type(cursor) is not str or not re.fullmatch('[a-f0-9]{64}', cursor)):
        raise ValueError('invalid_review_cursor')


def validate_review_page(page, cursor):
    validate_cursor(cursor)
    def deny():
        raise ValueError('journal_review_unavailable')
    if type(page) is not dict or set(page) != {'protocol', 'items', 'nextCursor', 'cycleEndObserved', 'scanStatus', 'snapshot'}:
        deny()
    if (page['protocol'] != 'owner-invoice-review-page/v1' or page['snapshot'] is not False or
            type(page['cycleEndObserved']) is not bool or type(page['items']) is not list or len(page['items']) > 2 or
            page['scanStatus'] not in ('ok', 'partial', 'unavailable')):
        deny()
    validate_cursor(page['nextCursor'])
    last = cursor
    unresolved = False
    classes = {'pending_prestart': ('preparation_retryable', False),
               'start_uncertain': ('owner_review_required', True),
               'ack_provider_accepted': ('provider_accepted', False)}
    for item in page['items']:
        if type(item) is not dict or type(item.get('issuanceId')) is not str:
            deny()
        validate_cursor(item['issuanceId'])
        if last is not None and item['issuanceId'] <= last:
            deny()
        last = item['issuanceId']
        if item.get('classification') == 'unresolved':
            unresolved = True
            if (set(item) != {'issuanceId', 'classification', 'status', 'needsOwnerReview', 'reason'} or
                    item['status'] not in ('journal_unavailable', 'integrity_review_required') or
                    item['needsOwnerReview'] is not True or item['reason'] != 'state_unverified'):
                deny()
        else:
            if set(item) != {'issuanceId','invoiceNumber','revision','purpose','status','classification','needsOwnerReview'}:
                deny()
            pair = classes.get(item['classification'])
            if not pair or item['status'] != pair[0] or item['needsOwnerReview'] is not pair[1]:
                deny()
            if (type(item['invoiceNumber']) is not str or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,99}', item['invoiceNumber']) or
                    type(item['revision']) is not str or not re.fullmatch('[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}', item['revision']) or
                    item['purpose'] not in ('guest_invoice','owner_copy')):
                deny()
    if page['scanStatus'] == 'unavailable':
        if page['items'] or page['cycleEndObserved'] or page['nextCursor'] is not None:
            deny()
    else:
        if (page['scanStatus'] == 'partial') != unresolved:
            deny()
        if page['cycleEndObserved']:
            if page['nextCursor'] is not None:
                deny()
        elif not page['items'] or page['nextCursor'] != last:
            deny()
    return page
