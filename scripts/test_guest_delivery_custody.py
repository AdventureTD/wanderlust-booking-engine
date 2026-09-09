"""Backend-free GP11 support controls, not guest lifecycle cases."""
from pathlib import Path
import importlib.util
import unittest

class CustodyTests(unittest.TestCase):
    def test_guard_contract(self):
        path = Path(__file__).with_name('guest_delivery_custody.py')
        self.assertTrue(path.exists(), 'permanent GP11 custody support missing')
        spec = importlib.util.spec_from_file_location('custody', path)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        manifest = m.load_manifest()
        expected = manifest['imports']
        self.assertEqual(m.imports('\n'.join(expected)), expected)
        for edge in ('import socket', 'from .payments import Payment'):
            with self.assertRaisesRegex(ValueError, 'imports'):
                m.check_imports('\n'.join(expected) + '\n' + edge, expected)
        for text in ('from .guest_invoice_delivery import dispatch_initial_guest_invoice',
                     'import booking_engine.guest_invoice_delivery',
                     'from booking_engine import guest_invoice_delivery',
                     "import importlib\nx=importlib.import_module('booking_engine.guest_invoice_delivery')"):
            with self.assertRaisesRegex(ValueError, 'incoming'):
                m.check_incoming(text, 'booking_engine/example.py')
        m.check_incoming('from .invoice import Guest', 'booking_engine/example.py')
        record = {'canonical_sha256': m.sha(b'x\ny\n'), 'raw_sha256': m.sha(b'x\r\ny\r\n'), 'eol': 'CRLF'}
        self.assertEqual(m.restore(b'x\ny\n', record), b'x\r\ny\r\n')
        self.assertEqual(m.restore(b'x\r\ny\r\n', record), b'x\r\ny\r\n')
        with self.assertRaisesRegex(ValueError, 'custody'):
            m.restore(b'x\ny\n# extra', record)
        for unsafe in ('../outside.py', '/outside.py', 'C:/outside.py', 'scripts/../../outside.py'):
            with self.assertRaisesRegex(ValueError, 'path'):
                m.safe_path(Path.cwd(), unsafe)

if __name__ == '__main__':
    unittest.main()
