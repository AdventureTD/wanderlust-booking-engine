"""Synthetic exports only; subprocess exercises the disconnected CLI."""
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/reconcile-reservation-exports.py'


def booking(**changes):
    return dict(_id='synthetic-row', bookingNumber='SYN-1', checkIn='2027-03-06',
                checkOut='2027-03-14', status='confirmed', quantity=1,
                roomCode='adventure_suite', **changes)


def summary():
    return dict(_id='synthetic-summary', bookingNumber='SYN-1',
                checkIn='2027-03-06', checkOut='2027-03-14')


class OfflineReconciliation(unittest.TestCase):
    def run_export(self, bookings, summaries, fmt='json'):
        with tempfile.TemporaryDirectory() as temp:
            paths = []
            for name, rows in [('Bookings', bookings), ('BookingSummary', summaries)]:
                path = Path(temp) / (name + '.' + fmt)
                if fmt == 'json':
                    path.write_text(json.dumps(rows), encoding='utf-8')
                else:
                    keys = list(dict.fromkeys(k for row in rows for k in row))
                    with path.open('w', newline='', encoding='utf-8') as stream:
                        writer = csv.DictWriter(stream, fieldnames=keys)
                        writer.writeheader()
                        writer.writerows(rows)
                paths.append(path)
            before = [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
            result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--bookings', str(paths[0]),
                                     '--summaries', str(paths[1])], capture_output=True, text=True)
            self.assertEqual(before, [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths])
            return result

    def run_raw_json(self, token, field='quantity', collection='Bookings'):
        # Inject the source token directly: json.dumps(float(token)) erases R1.
        rows = {'Bookings': booking(), 'BookingSummary': summary()}
        rows[collection][field] = '__RAW_NUMBER__'
        with tempfile.TemporaryDirectory() as temp:
            paths = []
            for name, row in rows.items():
                path = Path(temp) / (name + '.json')
                text = json.dumps([row]).replace('"__RAW_NUMBER__"', token)
                path.write_text(text, encoding='utf-8')
                paths.append(path)
            before = [p.read_bytes() for p in paths]
            result = subprocess.run(
                [sys.executable, '-B', str(SCRIPT), '--bookings', str(paths[0]),
                 '--summaries', str(paths[1])], capture_output=True, text=True)
            self.assertEqual(before, [p.read_bytes() for p in paths])
            self.assertEqual(result.stderr, '')
            for secret in ['SYN-1', 'synthetic-row', 'synthetic-summary', temp,
                           '__RAW_NUMBER__', 'Traceback']:
                self.assertNotIn(secret, result.stdout + result.stderr)
            report = json.loads(result.stdout)
            self.assertIs(report['migration_performed'], False)
            self.assertIs(report['publication_ready'], False)
            return result, report

    def test_raw_json_quantity_precision(self):
        for token in ['1.0000000000000001', '0.99999999999999999',
                      '3.0000000000000001',
                      '1.0000000000000000000000000000000000000001',
                      '1e-9999', '1e9999']:
            with self.subTest(token=token):
                result, report = self.run_raw_json(token)
                self.assertEqual(result.returncode, 1, result.stdout)
                self.assertEqual(report['issues'], [
                    {'collection': 'Bookings', 'row': 1, 'code': 'INVALID_QUANTITY'}])

    def test_raw_json_integral_quantity_controls(self):
        for token in ['1', '2', '3', '1.0', '3.0000000000000000', '1e0',
                      '30e-1', '0.1e1', '100000000000000000000000000000e-29']:
            with self.subTest(token=token):
                result, report = self.run_raw_json(token)
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertEqual(report['issues'], [])

    def test_raw_json_nonfinite_rejection(self):
        for token in ['NaN', 'Infinity', '-Infinity']:
            with self.subTest(token=token):
                result, report = self.run_raw_json(token)
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertEqual(report, {'error': 'INVALID_EXPORT',
                                         'migration_performed': False,
                                         'publication_ready': False})

    def test_raw_json_decimal_dates_and_metadata(self):
        for collection in ['Bookings', 'BookingSummary']:
            for token in ['1.25', '[1.25]', '{"nested": 1.25}']:
                with self.subTest(collection=collection, token=token):
                    result, report = self.run_raw_json(token, 'checkIn', collection)
                    self.assertEqual(result.returncode, 1, result.stdout)
                    self.assertIn({'collection': collection, 'row': 1,
                                   'code': 'INVALID_DATE'}, report['issues'])
                    self.assertIn({'collection': 'Bookings', 'row': 1,
                                   'code': 'DATE_MISMATCH'}, report['issues'])
                    result, report = self.run_raw_json(token, 'ignored', collection)
                    self.assertEqual(result.returncode, 0, result.stdout)
                    self.assertEqual(report['issues'], [])

    def test_identity_linkage(self):
        cases = [
            ([booking()], [], 'ORPHAN_BOOKING'),
            ([], [summary()], 'ORPHAN_SUMMARY'),
            ([booking()], [summary(), summary()], 'MULTIPLE_SUMMARIES'),
            ([booking(), booking()], [summary()], 'DUPLICATE_ROW_ID'),
            ([dict(booking(), _id='')], [summary()], 'INVALID_ROW_ID'),
            ([dict(booking(), bookingNumber=['bad'])], [summary()], 'INVALID_BOOKING_IDENTITY'),
            ([dict(booking(), status='Blocked')], [], 'BLOCK_DATE_LINKAGE_MISSING'),
            ([dict(booking(), status='blocked')], [dict(summary(), checkOut='')], 'BLOCK_DATE_LINKAGE_MISSING'),
            ([booking(), dict(booking(), _id='other', checkIn='2027-03-07')], [summary()], 'MULTIPLE_BOOKING_DATE_WINDOWS'),
        ]
        for b, s, expected in cases:
            with self.subTest(expected=expected):
                result = self.run_export(b, s)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn(expected, [i['code'] for i in json.loads(result.stdout)['issues']])
        # Multiple distinct room rows per booking are legitimate, not duplicate bookings.
        result = self.run_export([booking(), dict(booking(), _id='other')], [summary()])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_business_validation(self):
        cases = [
            ({'quantity': q}, 'INVALID_QUANTITY') for q in [0, -1, 1.5, True, '1', None, {}, 4]
        ] + [
            ({'status': 'mystery'}, 'INVALID_STATUS'),
            ({'roomCode': 'suite'}, 'INVALID_ROOM_CLASS'),
            ({'checkIn': '2027-02-29'}, 'INVALID_DATE'),
            ({'checkOut': '2027-03-06'}, 'INVALID_DATE_RANGE'),
            ({'checkIn': 1800000000}, 'INVALID_DATE'),
            ({'checkIn': '2027-03-06T12:00:00Z'}, 'DATE_INTERPRETATION_REQUIRED'),
            ({'status': 'blocked', 'bookingNumber': None}, 'BLOCK_DATE_LINKAGE_MISSING'),
        ]
        for changes, expected in cases:
            with self.subTest(changes=changes):
                result = self.run_export([dict(booking(), **changes)], [summary()])
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn(expected, [i['code'] for i in json.loads(result.stdout)['issues']])
        for status in ['confirmed', 'Confirmed', 'hold', 'blocked', 'in-house', 'cancelled',
                       'canceled', 'pending', 'pending confirmation', 'checked-out']:
            result = self.run_export([dict(booking(), status=status)], [summary()])
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        result = self.run_export([booking()], [dict(summary(), status='mystery', checkIn='bad')])
        self.assertIn('INVALID_STATUS', [i['code'] for i in json.loads(result.stdout)['issues']])
        self.assertIn('INVALID_DATE', [i['code'] for i in json.loads(result.stdout)['issues']])

    def test_invalid_block_summary_range_is_not_date_linkage(self):
        result = self.run_export([dict(booking(), status='blocked')],
                                 [dict(summary(), checkOut='2027-03-05')])
        self.assertIn('BLOCK_DATE_LINKAGE_MISSING',
                      [i['code'] for i in json.loads(result.stdout)['issues']])

    def test_csv_matches_json_and_explicit_id_header(self):
        b, s = booking(), summary()
        b['quantity'] = 2
        expected = json.loads(self.run_export([b], [s]).stdout)
        actual = self.run_export([b], [s], 'csv')
        self.assertEqual(actual.returncode, 0, actual.stderr)
        self.assertEqual(json.loads(actual.stdout)['issues'], expected['issues'])
        b['ID'] = b.pop('_id')
        s['ID'] = s.pop('_id')
        self.assertEqual(self.run_export([b], [s], 'csv').returncode, 0)
        for q in ['1.5', '01', 'true', '=1', ' 1']:
            result = self.run_export([dict(b, quantity=q)], [s], 'csv')
            self.assertEqual(result.returncode, 1)
            self.assertIn('INVALID_QUANTITY', [i['code'] for i in json.loads(result.stdout)['issues']])

    def test_malformed_exports_fail_without_data_or_traceback(self):
        for content, suffix in [
            ('{"PRIVATE":', 'json'), ('{}', 'json'), ('[null]', 'json'),
            ('[{"_id":"a","_id":"b"}]', 'json'), ('[NaN]', 'json'),
            ('_id,_id\na,b\n', 'csv'), ('_id,bookingNumber\na,b,PRIVATE\n', 'csv'),
            ('ID,_id\na,b\n', 'csv'), ('PRIVATE', 'txt')
        ]:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / ('export.' + suffix)
                path.write_text(content, encoding='utf-8')
                result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--bookings', str(path),
                                         '--summaries', str(path)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                report = json.loads(result.stdout)
                self.assertEqual(report['error'], 'INVALID_EXPORT')
                self.assertNotIn('PRIVATE', result.stdout + result.stderr)
                self.assertNotIn('Traceback', result.stderr)
        result = self.run_export([], [])
        self.assertEqual(result.returncode, 1)
        self.assertIn('EMPTY_EXPORT', [i['code'] for i in json.loads(result.stdout)['issues']])

    def test_date_mismatch_reports_no_guest_values_and_no_write(self):
        b, s = booking(), summary()
        b.update(guestName='DO_NOT_OUTPUT_GUEST', email='PRIVATE@example.invalid')
        s.update(checkIn='2027-03-05', checkOut='2027-03-13')
        result = self.run_export([b], [s])
        self.assertEqual(result.returncode, 1, result.stderr)
        report = json.loads(result.stdout)
        self.assertIn('DATE_MISMATCH', [x['code'] for x in report['issues']])
        for secret in ['DO_NOT_OUTPUT_GUEST', 'PRIVATE@example.invalid', 'SYN-1', 'synthetic-row']:
            self.assertNotIn(secret, result.stdout + result.stderr)
        self.assertFalse(report['migration_performed'])


if __name__ == '__main__':
    unittest.main()
