"""Bounded, single-attempt HTTP exchange; bytes confer no journal authority.

Destination comes only from the Auth-owned bound journal expectation. No owner
secret, scope-seal key, ambient proxy/netrc credentials, redirects or retries.
Response header pairs remain observable, including duplicates for Auth to deny.
"""
import re

import requests


def exchange_guest_invoice_journal(site_origin, original_bytes, header_pairs):
    if (type(site_origin) is not str
            or re.fullmatch(r'https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', site_origin) is None
            or type(original_bytes) is not bytes or not 0 < len(original_bytes) <= 450000):
        raise ValueError('guest_invoice_journal_transport')
    headers = dict(header_pairs)
    if len(headers) != len(header_pairs):
        raise ValueError('guest_invoice_journal_transport')
    headers['Accept-Encoding'] = 'identity'
    def admit_response(response, *args, **kwargs):
        # requests prepares a redirect successor (and eagerly reads its body)
        # even with allow_redirects=False. Reject before that internal branch.
        try:
            pairs = tuple(response.raw.headers.items())
            if response.status_code != 200 or any(name.lower() == 'content-encoding' for name, _ in pairs):
                raise ValueError('guest_invoice_journal_transport')
        except BaseException:
            response.close()
            raise
        return response

    with requests.Session() as session:
        session.trust_env = False
        with session.post(site_origin + '/_functions/guestInvoiceJournal',
                          data=original_bytes, headers=headers, timeout=(5, 60),
                          allow_redirects=False, proxies={}, stream=True,
                          hooks={'response': admit_response}) as response:
            pairs = tuple(response.raw.headers.items())
            if any(name.lower() == 'content-encoding' for name, _ in pairs):
                raise ValueError('guest_invoice_journal_transport')
            size, parts = 0, []
            for chunk in response.iter_content(chunk_size=16384):
                size += len(chunk)
                if size > 900000:
                    raise ValueError('guest_invoice_journal_transport')
                parts.append(chunk)
            return response.status_code, b''.join(parts), pairs
