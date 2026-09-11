"""Private synchronous signed journal adapter; transport is not delivery authority.

The trusted in-process adapter reads the Auth-owned binding, never response
claims. Rich tryStart remains rejected by the unchanged wire parser. Downstream
semantic _state verification is mandatory; this adapter does not prepare/send.
"""
from types import MappingProxyType
from . import guest_invoice_wire_auth as _auth


class BoundGuestInvoiceJournal:
    __slots__ = ('_binding', '_transport', '_expectation')

    def __init__(self):
        raise TypeError('use from_dispatch')

    @classmethod
    def from_dispatch(cls, authenticated_binding, inert_transport=None):
        _auth._need(type(authenticated_binding) is _auth._Handle
                    and authenticated_binding in _auth._bindings
                    and (inert_transport is None or callable(inert_transport)))
        entry = _auth._bindings[authenticated_binding]
        _auth._fence(entry)
        if inert_transport is None:
            from functools import partial
            from .guest_invoice_journal_http import exchange_guest_invoice_journal
            # Fixed authenticated destination, never request payload or new config.
            inert_transport = partial(exchange_guest_invoice_journal, entry['siteOrigin'])
        journal = object.__new__(cls)
        journal._binding = authenticated_binding
        journal._transport = inert_transport
        journal._expectation = MappingProxyType(dict(zip(
            ('siteOrigin', 'audience', 'acceptanceId', 'operationId',
             'rootDigest', 'issuanceId'), entry['claims'][3:9])))
        return journal

    @property
    def expectation(self):
        return self._expectation

    def call(self, operation, issuance_id, payload=None):
        _auth._need(type(issuance_id) is str
                    and issuance_id == self._expectation['issuanceId'])
        outstanding, raw, headers = _auth.begin_journal(
            self._binding, operation, {} if payload is None else payload)
        try:
            status, response_bytes, response_headers = self._transport(
                raw, tuple(headers.items()))
        except BaseException as exc:
            # The parser retires before inspecting status/body. Do not mutate its
            # private maps or release this invocation's START latch.
            try:
                _auth.consume_response(outstanding, 0, b'', ())
            except ValueError:
                pass
            if not isinstance(exc, Exception):
                raise
            raise NonRetryableJournalError() from exc
        try:
            return _auth.consume_response(outstanding, status, response_bytes, response_headers)
        except Exception as exc:
            # Includes authentic rich tryStart observations, including ACK.
            # They are not a grant, and the outstanding request is already spent.
            raise NonRetryableJournalError() from exc


class NonRetryableJournalError(ValueError):
    retryable = False
    consumed = True

    def __init__(self):
        super().__init__('guest_invoice_journal_consumed_nonretryable')
