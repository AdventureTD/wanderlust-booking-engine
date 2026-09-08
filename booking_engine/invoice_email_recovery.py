"""One bounded pass over durable Admin roots, not a scheduler or send grant."""
from requests.exceptions import RequestException
from .invoice_email_dispatch import dispatch_issuance
from .invoice_email_journal import validate_cursor, validate_review_page, validate_request_report


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

    def recover_requests(self, cursor):
        self._charge()
        return validate_request_report(self._journal.recover_requests(cursor), cursor)

    def call(self, operation, issuance_id, payload=None):
        self._charge()
        return self._journal.call(operation, issuance_id, payload)


def recover_pending_once(journal, cursor=None):
    validate_cursor(cursor)
    budget = _BudgetedJournal(journal)
    result = _recover_pending_core(budget, cursor)
    result['bridgeOperations'] = budget.used
    return result


def _recover_pending_core(budget, cursor):
    before = budget.used
    result = {'status': 'ok', 'pages': 0, 'examined': 0, 'attempts': 0,
              'nextCursor': cursor, 'cycleEndObserved': False, 'snapshot': False,
              'outcomes': [], 'issues': [], 'deferred': [], 'attemptedIssuanceId': None}
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
                    result['attemptedIssuanceId'] = item['issuanceId']
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
    result['bridgeOperations'] = budget.used - before
    return result


def recover_integrated_once(journal, request_cursor=None, issuance_cursor=None):
    validate_cursor(request_cursor)
    validate_cursor(issuance_cursor)
    budget = _BudgetedJournal(journal)
    try:
        admission = budget.recover_requests(request_cursor)
    except ValueError:
        admission = {'status': 'malformed_response'}
    except RequestException:
        admission = {'status': 'transport_error'}
    except Exception:
        admission = {'status': 'unavailable'}
    request_calls = budget.used
    roots = _recover_pending_core(budget, issuance_cursor)
    return {**roots, 'admission': admission,
            'requestCursor': _next_position(admission, request_cursor, 'attemptedRequestId'),
            'issuanceCursor': _next_position(roots, issuance_cursor, 'attemptedIssuanceId'),
            'status': 'ok' if admission['status'] in ('ok', 'deferred') and roots['status'] == 'ok' else 'degraded',
            'requestBridgeOperations': request_calls,
            'issuanceBridgeOperations': roots['bridgeOperations'],
            'bridgeOperations': budget.used}


def _next_position(report, previous, attempt_field):
    if report.get(attempt_field) is not None:
        return report[attempt_field]
    if report.get('cycleEndObserved'):
        return None
    return report.get('nextCursor', previous)
