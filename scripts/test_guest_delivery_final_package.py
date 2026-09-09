"""Byte-only packaging controls. No application or producer imports/subprocesses."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import guest_delivery_final_package as package

ROOT = Path(__file__).resolve().parents[1]


class FinalPackageTests(unittest.TestCase):
    def test_complete_export_and_mutations(self):
        layer = json.loads(package.MANIFEST.read_bytes())
        base = json.loads((ROOT / package.BASE).read_bytes())
        records = {**base['files'], **layer['additions'], package.BASE: layer['base_manifest']}
        files = package.verify(ROOT)
        self.assertEqual(set(files), set(records) | {'scripts/guest-delivery-final-package.json'})
        for name, record in records.items():
            with self.subTest(path=name):
                raw = (ROOT / name).read_bytes()
                expected = files[name]
                self.assertEqual(package.restore(raw, record), expected)
                if record['eol'] != 'binary':
                    lf = raw.replace(b'\r\n', b'\n')
                    self.assertEqual(package.restore(lf, record), expected)
                    self.assertEqual(package.restore(lf.replace(b'\n', b'\r\n'), record), expected)
                with self.assertRaisesRegex(ValueError, 'custody'):
                    package.restore(raw + b'\n# extra-content control\n', record)
        # Inject each exact path through the real verify reader, not only restore.
        original = Path.read_bytes
        for name in records:
            target = (ROOT / name).resolve()
            def mutated(path, target=target):
                raw = original(path)
                return raw + b'\n# extra-content control\n' if path.resolve() == target else raw
            with self.subTest(reader_path=name), patch.object(Path, 'read_bytes', mutated):
                with self.assertRaisesRegex(ValueError, 'custody'):
                    package.verify(ROOT)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'export'
            package.materialize(ROOT, output)
            actual = {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}
            self.assertEqual(actual, set(files) | {'frozen-hashes.json', 'pytest-guest-delivery.ini'})
            for name, raw in files.items():
                self.assertEqual((output / name).read_bytes(), raw, name)
            self.assertEqual(json.loads((output / 'frozen-hashes.json').read_bytes()),
                             {n: package.sha(b) for n, b in files.items()})
            with self.assertRaises(FileExistsError):
                package.materialize(ROOT, output)
            for name in layer['additions']:
                target = output / name
                raw = target.read_bytes()
                target.unlink()
                with self.assertRaises(FileNotFoundError):
                    package.verify(output)
                target.write_bytes(raw)
            trust = output / 'scripts/guest-delivery-final-package.json'
            trust.write_bytes(trust.read_bytes() + b' ')
            with self.assertRaisesRegex(ValueError, 'trust root'):
                package.verify(output)
        for name in ('../escape', '/escape', 'C:/escape', 'scripts/../../escape', 'scripts\\escape'):
            with self.assertRaisesRegex(ValueError, 'path'):
                package.safe_path(ROOT, name)
        with self.assertRaisesRegex(ValueError, 'disjoint'):
            package.materialize(ROOT, ROOT / 'forbidden-output')


if __name__ == '__main__':
    unittest.main()
