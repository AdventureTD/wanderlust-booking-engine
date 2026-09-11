"""Private original-byte invocation behind the default-OFF raw HTTP route.

Ingress must preserve raw body and observable header pairs. The configured
channel authenticates the subject; Wix independently validates the scope seal
and retained completion on journal operations. Neither admission nor the
channel alone grants START. Deployment remains OFF unless explicitly enabled.
"""
from .guest_invoice_wire_auth import authenticate_dispatch
from .guest_invoice_bound_journal import BoundGuestInvoiceJournal
from .guest_invoice_delivery import dispatch_initial_guest_invoice


def dispatch_authenticated_guest_invoice(original_bytes, headers, method, path,
                                         journal_transport=None):
    """Authenticate once and dispatch the binding's own issuance, without retry."""
    try:
        binding = authenticate_dispatch(original_bytes, headers, method, path)
        journal = BoundGuestInvoiceJournal.from_dispatch(binding, journal_transport)
    except Exception:
        # Do not echo an unauthenticated issuance or invoke journal/provider IO.
        return {'status': 'UNAVAILABLE'}
    return dispatch_initial_guest_invoice(journal.expectation['issuanceId'], journal)
