"""One bounded pass over durable Admin roots, not a scheduler or send grant."""
from .invoice_email_dispatch import dispatch_issuance
from .invoice_email_journal import validate_cursor, validate_review_page


class _BudgetedJournal:
    def __init__(self, journal):
        self._journal = journal
        self.used = 0
        self.exhausted = False

    def _charge(self):
        if self.used >= 128:
            self.exhausted = True
            raise ValueError('recovery_budget_exhausted')
        self.used += 1

    def scan_pending(self, cursor):
        self._charge()
        return validate_review_page(self._journal.scan_pending(cursor), cursor)

    def call(self, operation, issuance_id, payload=None):
        self._charge()
        return self._journal.call(operation, issuance_id, payload)


def recover_pending_once(journal, cursor=None):
    validate_cursor(cursor)
    budget = _BudgetedJournal(journal)
    result = {'status': 'ok', 'pages': 0, 'examined': 0, 'attempts': 0,
              'nextCursor': cursor, 'cycleEndObserved': False, 'snapshot': False,
              'outcomes': [], 'issues': [], 'deferred': []}
    for _ in range(2):
        try:
            page = budget.scan_pending(cursor)
        except Exception:
            result['status'] = 'unavailable'
            result['issues'].append('scan_unavailable')
            break
        result['pages'] += 1
        if page['scanStatus'] == 'unavailable':
            result['status'] = 'unavailable'
            result['issues'].append('scan_unavailable')
            break
        result['examined'] += len(page['items'])
        for item in page['items']:
            if page['scanStatus'] != 'ok':
                result['status'] = 'partial'
                result['deferred'].append(item['issuanceId'])
            elif item['classification'] == 'pending_prestart':
                if result['attempts']:
                    result['deferred'].append(item['issuanceId'])
                else:
                    result['attempts'] = 1
                    outcome = dispatch_issuance(item['issuanceId'], budget)
                    result['outcomes'].append({'issuanceId': item['issuanceId'], 'status': outcome['status']})
            else:
                result['outcomes'].append({'issuanceId': item['issuanceId'], 'status': item['status']})
        cursor = page['nextCursor']
        result['nextCursor'] = cursor
        result['cycleEndObserved'] = page['cycleEndObserved']
        if budget.exhausted:
            result['status'] = 'deferred'
            result['issues'].append('bridge_budget_exhausted')
            break
        if page['cycleEndObserved']:
            break
    result['bridgeOperations'] = budget.used
    return result
