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
