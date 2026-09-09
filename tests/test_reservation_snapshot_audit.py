"""Offline fixtures only: no live export or migration authority."""
import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'scripts' / 'reservation_snapshot_audit.py'

class SnapshotAuditTests(unittest.TestCase):
    def test_reports_identity_deltas_without_disclosing_guest_fields(self):
        self.assertTrue(MODULE.exists(), 'offline snapshot comparator is missing')
        spec = importlib.util.spec_from_file_location('snapshot_audit', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        before = {'Bookings': [{'_id': 'one', 'email': 'private@example.test'}, {'_id': 'gone'}], 'BookingSummary': []}
        after = {'Bookings': [{'_id': 'one', 'email': 'changed@example.test'}, {'_id': 'new'}], 'BookingSummary': []}
        result = module.compare_snapshots(before, after)
        self.assertEqual(result['collections']['Bookings'], {'unchanged': [], 'changed': [{'id': 'one', 'fields': ['email']}], 'added': ['new'], 'missing': ['gone']})
        self.assertFalse(result['publicationReady'])
        self.assertNotIn('@', str(result))

    def test_rejects_incomplete_or_ambiguous_snapshots(self):
        spec = importlib.util.spec_from_file_location('snapshot_audit', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        valid = {'Bookings': [], 'BookingSummary': []}
        invalid = [
            {}, {'Bookings': []},
            {'Bookings': [{'_id': 'a'}, {'_id': 'a'}], 'BookingSummary': []},
            {'Bookings': [{'_id': ['a']}], 'BookingSummary': []},
            {'Bookings': [{'_id': ''}], 'BookingSummary': []},
            {'Bookings': [{'_id': 'a', 'value': float('nan')}], 'BookingSummary': []},
            {'Bookings': [], 'BookingSummary': None},
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.compare_snapshots(value, valid)

    def test_cli_rejects_duplicate_json_keys(self):
        import subprocess
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'snapshot.json'
            source.write_text('{"Bookings":[],"Bookings":[],"BookingSummary":[]}', encoding='utf-8')
            result = subprocess.run([__import__('sys').executable, '-B', str(MODULE), str(source), str(source)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, '')

    def test_cli_lossless_numeric_tokens(self):
        import json
        import subprocess
        import sys
        import tempfile
        # Raw tokens are intentional: Python floats would destroy the fixtures.
        cases = [
            ('distinct_large_decimals', '9007199254740992.0', '9007199254740993.0', 1),
            ('distinct_small_decimals', '1.0000000000000000', '1.0000000000000001', 1),
            ('nonzero_underflow', '1e-999', '0.0', 1),
            ('numeric_representation', '1e0', '1.0', 1),
            ('identical_large', '9007199254740993.0', '9007199254740993.0', 0),
            ('identical_tiny', '1e-999', '1e-999', 0),
            ('trailing_zero', '1.0', '1.00', 1),
            ('exponent_spelling', '1e0', '1E+0', 1),
            ('signed_integer_zero', '-0', '0', 1),
            ('integer_decimal', '1', '1.0', 1),
            ('boolean_integer', 'true', '1', 1),
            ('number_string', '1e0', '"1e0"', 1),
            ('array_order', '[1,2]', '[2,1]', 1),
            ('object_order', '{"a":1e0,"b":2}', '{"b":2,"a":1e0}', 0),
        ]
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ('before.json', 'after.json')]
            for name, before, after, expected in cases:
                for nested in (False, True):
                    with self.subTest(case=name, nested=nested):
                        for path, token in zip(paths, (before, after)):
                            value = '{"array":[' + token + ']}' if nested else token
                            path.write_text('{"Bookings":[{"_id":"synthetic","value":' + value + '}],"BookingSummary":[]}', encoding='utf-8')
                        original = [path.read_bytes() for path in paths]
                        result = subprocess.run([sys.executable, '-B', str(MODULE), *map(str, paths)], capture_output=True, text=True)
                        self.assertEqual([path.read_bytes() for path in paths], original)
                        self.assertEqual(result.stderr, '')
                        self.assertEqual(result.returncode, expected)
                        self.assertEqual(json.loads(result.stdout), {
                            'publicationReady': False, 'scope': 'OFFLINE_COMPARISON_ONLY',
                            'collections': {
                                'Bookings': {'unchanged': ['synthetic'] if expected == 0 else [],
                                             'changed': [{'id': 'synthetic', 'fields': ['value']}] if expected else [],
                                             'added': [], 'missing': []},
                                'BookingSummary': {'unchanged': [], 'changed': [], 'added': [], 'missing': []},
                            },
                        })

    def test_no_change_does_not_grant_release_and_inputs_stay_unchanged(self):
        import copy
        spec = importlib.util.spec_from_file_location('snapshot_audit', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        before = {'Bookings': [{'_id': 'blocked', 'status': 'Blocked', 'checkIn': '2027-03-06', 'checkOut': '2027-03-14'}], 'BookingSummary': []}
        preserved = copy.deepcopy(before)
        result = module.compare_snapshots(before, copy.deepcopy(before))
        self.assertEqual(result['collections']['Bookings']['unchanged'], ['blocked'])
        self.assertFalse(result['publicationReady'])
        self.assertEqual(before, preserved)
        after = copy.deepcopy(before)
        after['Bookings'][0]['checkIn'] = '2027-03-05'
        self.assertEqual(module.compare_snapshots(before, after)['collections']['Bookings']['changed'], [{'id': 'blocked', 'fields': ['checkIn']}])

if __name__ == '__main__':
    unittest.main()
