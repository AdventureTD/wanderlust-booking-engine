"""Compare local JSON exports; never access Wix, migrate or approve a release."""
import argparse
import json
import math


class JsonNumber(str):
    """Original JSON number token, distinct from an ordinary JSON string."""


def parse_decimal(token):
    # Preserve the existing overflow rejection, but never compare this float.
    # In particular, underflow must retain its original nonzero token.
    if not math.isfinite(float(token)):
        raise ValueError('Invalid JSON number')
    return JsonNumber(token)


def canonical_value(value):
    """Canonical object ordering without normalizing numeric token spelling."""
    if type(value) is JsonNumber:
        return str(value)
    if type(value) is dict:
        return '{' + ','.join(json.dumps(key) + ':' + canonical_value(value[key])
                              for key in sorted(value)) + '}'
    if type(value) is list:
        return '[' + ','.join(canonical_value(item) for item in value) + ']'
    return json.dumps(value, sort_keys=True, allow_nan=False)


def validate_snapshot(snapshot):
    if type(snapshot) is not dict or not {'Bookings', 'BookingSummary'} <= snapshot.keys():
        raise ValueError('Required collection missing')
    for name, rows in snapshot.items():
        if type(name) is not str or not name or type(rows) is not list:
            raise ValueError('Invalid collection')
        seen = set()
        for row in rows:
            if type(row) is not dict or type(row.get('_id')) is not str or not row['_id']:
                raise ValueError('Invalid stable identity')
            if row['_id'] in seen:
                raise ValueError('Duplicate stable identity')
            seen.add(row['_id'])
            try:
                json.dumps(row, allow_nan=False, sort_keys=True)
            except (TypeError, ValueError):
                raise ValueError('Invalid JSON record') from None


def compare_snapshots(before, after):
    validate_snapshot(before)
    validate_snapshot(after)
    if before.keys() != after.keys():
        raise ValueError('Collection coverage differs')
    collections = {}
    for name in sorted(set(before) | set(after)):
        old = {row['_id']: row for row in before.get(name, [])}
        new = {row['_id']: row for row in after.get(name, [])}
        changed = []
        unchanged = []
        for identity in sorted(old.keys() & new.keys()):
            fields = sorted(key for key in old[identity].keys() | new[identity].keys()
                            if key not in old[identity] or key not in new[identity]
                            or canonical_value(old[identity][key]) != canonical_value(new[identity][key]))
            if fields:
                changed.append({'id': identity, 'fields': fields})
            else:
                unchanged.append(identity)
        collections[name] = {'unchanged': unchanged, 'changed': changed,
                             'added': sorted(new.keys() - old.keys()),
                             'missing': sorted(old.keys() - new.keys())}
    return {'publicationReady': False, 'scope': 'OFFLINE_COMPARISON_ONLY', 'collections': collections}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key')
        result[key] = value
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before')
    parser.add_argument('after')
    args = parser.parse_args()
    try:
        with open(args.before, encoding='utf-8') as source:
            before = json.load(source, object_pairs_hook=unique_object,
                               parse_int=JsonNumber, parse_float=parse_decimal)
        with open(args.after, encoding='utf-8') as source:
            after = json.load(source, object_pairs_hook=unique_object,
                               parse_int=JsonNumber, parse_float=parse_decimal)
        result = compare_snapshots(before, after)
    except (OSError, ValueError, UnicodeError, RecursionError):
        parser.exit(2, 'Invalid or unreadable offline snapshot; no comparison established.\n')
    print(json.dumps(result, sort_keys=True, indent=2))
    return 1 if any(row['changed'] or row['added'] or row['missing'] for row in result['collections'].values()) else 0


if __name__ == '__main__':
    raise SystemExit(main())
