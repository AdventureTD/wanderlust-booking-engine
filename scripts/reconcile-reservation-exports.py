#!/usr/bin/env python3
"""Offline diagnosis only. Standard library, no runtime imports or CMS access."""
import argparse
import csv
import io
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

# Explicit vocabulary from pinned roomInventoryRules/roomAssignmentRules source.
STATUSES = {'confirmed', 'hold', 'blocked', 'in-house', 'cancelled', 'canceled',
            'pending', 'pending confirmation', 'checked-out'}
CAPACITY = {'adventure_suite': 3, 'two_bedroom_apartment': 1, 'penthouse_apartment': 1}


def day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def status(value):
    return value.strip().lower() if isinstance(value, str) else None


def identity(value):
    return isinstance(value, str) and bool(value) and value == value.strip()


def reconcile(bookings, summaries):
    issues = []
    def issue(collection, index, code):
        issues.append(dict(collection=collection, row=index, code=code))

    groups = {}
    for collection, rows in [('Bookings', bookings), ('BookingSummary', summaries)]:
        groups[collection] = {}
        if not rows:
            issue(collection, 0, 'EMPTY_EXPORT')
        ids = {}
        for index, row in enumerate(rows, 1):
            key = row.get('bookingNumber')
            for field in ('checkIn', 'checkOut'):
                value = row.get(field)
                if day(value) is None:
                    code = 'DATE_INTERPRETATION_REQUIRED' if isinstance(value, str) and 'T' in value else 'INVALID_DATE'
                    issue(collection, index, code)
            start, end = day(row.get('checkIn')), day(row.get('checkOut'))
            if start and end and end <= start:
                issue(collection, index, 'INVALID_DATE_RANGE')
            if collection == 'Bookings' or 'status' in row:
                if status(row.get('status')) not in STATUSES:
                    issue(collection, index, 'INVALID_STATUS')
            if collection == 'Bookings':
                room = row.get('roomCode')
                capacity = CAPACITY.get(room) if isinstance(room, str) else None
                if capacity is None:
                    issue(collection, index, 'INVALID_ROOM_CLASS')
                quantity = row.get('quantity')
                if (type(quantity) not in (int, Decimal)
                        or (isinstance(quantity, Decimal) and not quantity.is_finite())
                        or not 1 <= quantity <= (capacity or 3)
                        or quantity != int(quantity)):
                    issue(collection, index, 'INVALID_QUANTITY')
                if status(row.get('status')) == 'blocked' and not identity(key):
                    issue(collection, index, 'BLOCK_DATE_LINKAGE_MISSING')
            if not identity(row.get('_id')):
                issue(collection, index, 'INVALID_ROW_ID')
            else:
                ids.setdefault(row['_id'], []).append(index)
            if not identity(key):
                issue(collection, index, 'INVALID_BOOKING_IDENTITY')
            else:
                groups[collection].setdefault(key, []).append((index, row))
        for indices in ids.values():
            if len(indices) > 1:
                for index in indices:
                    issue(collection, index, 'DUPLICATE_ROW_ID')
    bg, sg = groups['Bookings'], groups['BookingSummary']
    for key, rows in sg.items():
        for index, row in rows:
            if key not in bg:
                issue('BookingSummary', index, 'ORPHAN_SUMMARY')
            if len(rows) > 1:
                issue('BookingSummary', index, 'MULTIPLE_SUMMARIES')
    for key, rows in bg.items():
        matches = sg.get(key, [])
        # Internal only: repr also handles exact decimals in invalid/nested dates,
        # without JSON serialization errors or converting them to strings/floats.
        windows = {repr([r.get('checkIn'), r.get('checkOut')]) for _, r in rows}
        for index, row in rows:
            if not matches:
                issue('Bookings', index, 'ORPHAN_BOOKING')
            if len(windows) > 1:
                issue('Bookings', index, 'MULTIPLE_BOOKING_DATE_WINDOWS')
            linked = len(matches) == 1 and all(day(matches[0][1].get(k)) for k in ('checkIn', 'checkOut'))
            if linked:
                linked = day(matches[0][1]['checkIn']) < day(matches[0][1]['checkOut'])
            if status(row.get('status')) == 'blocked' and not linked:
                issue('Bookings', index, 'BLOCK_DATE_LINKAGE_MISSING')
            if len(matches) == 1 and any(row.get(k) != matches[0][1].get(k) for k in ('checkIn', 'checkOut')):
                issue('Bookings', index, 'DATE_MISMATCH')
    return dict(mode='OFFLINE_DIAGNOSTIC_ONLY', migration_performed=False,
                publication_ready=False, issues=issues,
                counts={'Bookings': len(bookings), 'BookingSummary': len(summaries)})


def reject_constant(value):
    raise ValueError('invalid JSON constant')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key')
        result[key] = value
    return result


def read_export(filename):
    path = Path(filename)
    text = path.read_text(encoding='utf-8-sig')
    if path.suffix.lower() == '.json':
        rows = json.loads(text, object_pairs_hook=unique_object,
                          parse_float=Decimal, parse_constant=reject_constant)
    elif path.suffix.lower() == '.csv':
        reader = csv.DictReader(io.StringIO(text, newline=''), strict=True)
        headers = reader.fieldnames
        if not headers or any(not h for h in headers) or len(set(headers)) != len(headers):
            raise ValueError('invalid CSV headers')
        if 'ID' in headers and '_id' in headers:
            raise ValueError('conflicting ID headers')
        rows = list(reader)
        for row in rows:
            if None in row or any(v is None for v in row.values()):
                raise ValueError('invalid CSV width')
            # Only these documented transport conversions; never infer field names.
            if 'ID' in row:
                row['_id'] = row.pop('ID')
            q = row.get('quantity')
            if isinstance(q, str) and re.fullmatch(r'[1-9][0-9]{0,8}', q):
                row['quantity'] = int(q)
    else:
        raise ValueError('unsupported format')
    if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
        raise ValueError('expected array of objects')
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bookings', required=True)
    parser.add_argument('--summaries', required=True)
    args = parser.parse_args()
    try:
        bookings = read_export(args.bookings)
        summaries = read_export(args.summaries)
        report = reconcile(bookings, summaries)
    except (OSError, ValueError, csv.Error, RecursionError, InvalidOperation):
        # Raw exceptions, paths and input values can contain guest information.
        print(json.dumps(dict(error='INVALID_EXPORT', migration_performed=False,
                              publication_ready=False)))
        return 2
    print(json.dumps(report, indent=2))
    return 1 if report['issues'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
