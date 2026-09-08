"""Standalone stdlib tests: no package/conftest or native producer execution."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'booking_engine/calendar_event_contract.py'
GOLDEN = 'bcal14059678688f0da976db70c0a4512a3da46d64de0c13334a078771d29130c264b'
ARGS = dict(audience='wbe:fixture', calendar_id='fixture-calendar@example.test',
            acceptance_id='66980e76af0c65173f79d74aef1fdf777bcead806d6b1a27e179e7f6fc38c3f8',
            guest_name='Fixture Guest', check_in='2027-01-01', check_out='2027-01-03')


def mapper():
    if not SOURCE.exists():
        raise AssertionError('Missing pure Calendar mapper implementation')
    spec = importlib.util.spec_from_file_location('isolated_calendar_contract', SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.build_calendar_event_proposal


class CalendarContractTests(unittest.TestCase):
    def test_R6_02_independent_golden(self):
        p = mapper()(**ARGS)
        self.assertEqual(p['eventId'], GOLDEN)
        self.assertEqual(set(p), {'kind', 'v', 'audience', 'acceptanceId', 'calendarId', 'eventId', 'event'})
        self.assertEqual(p['event'], dict(id=GOLDEN, summary='Wanderlust Caribbean Booking: Fixture Guest',
            description='Wanderlust Booking: Fixture Guest', start={'date': '2027-01-01'},
            end={'date': '2027-01-03'}, status='confirmed'))

    def test_R6_03_invalid_primitives_dates_unicode(self):
        build = mapper()
        class Box(str):
            pass
        invalid = {key: [None, [], {}, 1, True, Box(value)] for key, value in ARGS.items()}
        invalid['acceptance_id'] += ['A' * 64, 'a' * 63, 'a' * 64 + '\n']
        invalid['audience'] += ['', ' wbe:x', 'x' * 129, 'x\n']
        invalid['calendar_id'] += ['', 'primary', '\ud800']
        invalid['guest_name'] += ['', '\udfff']
        invalid['check_in'] += ['2027-02-29', '2027-1-01', '2027-01-01T00:00:00Z', '0000-01-01']
        invalid['check_out'] += ['2027-01-01', '2026-12-31', '2027-04-31']
        for key, values in invalid.items():
            for value in values:
                with self.subTest(key=key, value=repr(value)):
                    with self.assertRaises(ValueError):
                        build(**dict(ARGS, **{key: value}))

    def test_R6_01_native_mapping_inert_only(self):
        import hashlib
        raw = (ROOT / 'scripts/fixtures/completion-projection-native-multigroup.json').read_bytes()
        # Pin committed bytes allowing only checkout CRLF -> LF conversion.
        canonical = raw.replace(b'\r\n', b'\n')
        self.assertEqual(hashlib.sha256(canonical).hexdigest(), '8bfaca390bfada2941396ee39e2797898517f31f0141dc4723f8d6eb424eae7b')
        fixture = json.loads(raw)
        self.assertEqual([c['id'] for c in fixture['cases']], ['NM03-native-producer', 'NM04-native-producer'])
        before = json.dumps(fixture, sort_keys=True)
        for case in fixture['cases']:
            self.assertEqual(case['status'], 'CAPTURED')
            self.assertEqual(case['projection']['kind'], 'PARTIAL_PROJECTION_PROPOSAL')
            root, summary = case['envelope']['acceptanceRoot'], case['projection']['summary']
            self.assertEqual(root['_id'], summary['acceptanceId'])
            p = mapper()(audience=root['audience'], calendar_id=ARGS['calendar_id'],
                acceptance_id=summary['acceptanceId'], guest_name=summary['guestName'],
                check_in=summary['checkIn'], check_out=summary['checkOut'])
            self.assertEqual(p['event']['summary'], 'Wanderlust Caribbean Booking: ' + summary['guestName'])
            self.assertEqual(p['event']['description'], 'Wanderlust Booking: ' + summary['guestName'])
            self.assertEqual(p['event']['start'], {'date': summary['checkIn']})
            self.assertEqual(p['event']['end'], {'date': summary['checkOut']})
            self.assertEqual(set(p['event']), {'id', 'summary', 'description', 'start', 'end', 'status'})
        self.assertEqual(json.dumps(fixture, sort_keys=True), before)

    def test_R6_02_03_12_stability_unicode_detachment(self):
        build = mapper()
        original = dict(ARGS)
        p = build(**ARGS)
        for change in [dict(guest_name=' Zoë e\u0301 😀\u2028\u2029\n'), dict(check_in='2024-02-29', check_out='2024-03-01')]:
            q = build(**dict(ARGS, **change))
            self.assertEqual(q['eventId'], p['eventId'])
        for change in [dict(audience='other'), dict(acceptance_id='a' * 64), dict(calendar_id='日😀@example.test')]:
            self.assertNotEqual(build(**dict(ARGS, **change))['eventId'], p['eventId'])
        p['event']['start']['date'] = 'changed'
        self.assertEqual(build(**ARGS)['event']['start']['date'], ARGS['check_in'])
        self.assertEqual(ARGS, original)


if __name__ == '__main__':
    unittest.main(verbosity=2)
