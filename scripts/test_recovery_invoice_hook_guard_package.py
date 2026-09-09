"""Byte-only hook successor tests. No packaged module/test/producer dispatch."""
import json
from pathlib import Path
import tempfile
import unittest
import recovery_invoice_hook_guard_package as package

ROOT = Path(__file__).resolve().parents[1]


class PackageTests(unittest.TestCase):
    def test_lf_crlf_export_and_declared_hook_members(self):
        files, imports = package.verify(ROOT)
        self.assertEqual(imports[package.RECOVERY], sorted(package.OLD_EDGES + package.NEW_EDGES))
        admission = json.loads(files['scripts/fixtures/recovery-invoice-hook-admission.json'])
        self.assertEqual(len(admission['files']), 37)
        for name, digest in {**admission['files'], **admission['fixtures']}.items():
            self.assertIn(name, files)
            self.assertEqual(package.sha(files[name]), digest, name)
        reachable = set()
        def visit(name):
            if name in reachable:
                return
            reachable.add(name)
            for edge in admission['edges'][name]:
                if edge.startswith('backend/'):
                    visit('velo/' + edge + '.js')
        visit(package.RECOVERY)
        self.assertEqual(len(reachable), 34)
        self.assertEqual(set(admission['files']) - reachable,
                         {'velo/backend/guestBookingAllocationEvidence.js',
                          'velo/backend/guestBookingAllocationHandoff.js',
                          'velo/backend/wholeCartPlanningRules.js'})
        base, layer, m = (json.loads(files[n]) for n in (package.BASE, package.LAYER, package.MANIFEST))
        binary = {n for n, r in {**base['files'], **layer['additions'], **m['additions']}.items() if r['eol'] == 'binary'}
        for crlf in (False, True):
            def read(name):
                raw = files[name]
                return raw.replace(b'\n', b'\r\n') if crlf and name not in binary else raw
            checked, observed = package.verify(ROOT, read)
            self.assertEqual(checked, files)
            self.assertEqual(observed, imports)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'canonical-package'
            exported, _ = package.materialize(ROOT, output)
            self.assertEqual(exported, files)
            self.assertEqual({p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}, set(files))
            for name, raw in files.items():
                self.assertEqual((output / name).read_bytes(), raw)

    def test_each_actual_reader_rejects_appended_content(self):
        files, _ = package.verify(ROOT)
        rejected = []
        for target in files:
            with self.subTest(target=target), self.assertRaises(ValueError):
                package.verify(ROOT, lambda name: files[name] + (b' ' if name == target else b''))
            rejected.append(target)
        self.assertEqual(set(rejected), set(files))
        print(json.dumps({'package_content_controls': len(rejected), 'paths': rejected}))

    def test_historical_recovery_pin_stays_historical(self):
        files, _ = package.verify(ROOT)
        base, m = json.loads(files[package.BASE]), json.loads(files[package.MANIFEST])
        before = base['files'][package.RECOVERY]
        self.assertEqual(before, m['overrides'][package.RECOVERY]['before'])
        self.assertEqual(before['canonical_sha256'], '8af55d7a97e02d43e115e86c17496a21ef23891d321d56beb0f37442342795e3')
        with self.assertRaisesRegex(ValueError, 'canonical custody mismatch'):
            package.canonical(files[package.RECOVERY], before)
        after = m['overrides'][package.RECOVERY]['after']
        self.assertEqual(after['eol'], 'CRLF')
        self.assertEqual(after['raw_sha256'], 'da870a2f5dc71688104a48d4c8b8e06118f8f8ec79c6682dcf96d9de697db72c')
        self.assertEqual(package.canonical(files[package.RECOVERY], after), files[package.RECOVERY])
        for n in ('../escape', '/absolute', 'C:/escape', 'scripts\\escape'):
            with self.assertRaises(ValueError):
                package.safe(ROOT, n)


if __name__ == '__main__':
    unittest.main()
