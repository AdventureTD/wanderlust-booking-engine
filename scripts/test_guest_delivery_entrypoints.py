"""Backend-free scanner controls; never loads the guest runtime or verifier."""
from pathlib import Path
import tempfile
import unittest
import guest_delivery_entrypoints as scan


class EntrypointTests(unittest.TestCase):
    def test_extension_positive_and_incoming_controls(self):
        benign = "import { observe } from 'backend/completion'; export const read = observe;"
        forbidden = "import { guestBookingInvoiceDeliveryOperation as op } from 'backend/guestBookingInvoiceDelivery'; export const recover = op;"
        for extension in ('js', 'web.js', 'jsw'):
            with self.subTest(extension=extension):
                name = 'velo/backend/recovery.' + extension
                expected = {name: ['backend/completion']}
                scan.check_sources({name: benign}, expected)
                self.assertEqual(scan.import_inventory({name: forbidden})[name], ['backend/guestBookingInvoiceDelivery'])
                with self.assertRaisesRegex(ValueError, 'incoming'):
                    scan.check_sources({name: forbidden}, expected)
                for extra in ("\nimport 'backend/extra';", "\nexport * from 'backend/extra';"):
                    with self.assertRaisesRegex(ValueError, 'import edges'):
                        scan.check_sources({name: benign + extra}, expected)
                for source in ("import('backend/guestBookingInvoiceDelivery');", "const x=require('backend/guestBookingInvoiceIssuance');"):
                    with self.assertRaisesRegex(ValueError, 'incoming'):
                        scan.check_sources({name: source}, expected)
                scan.check_sources({name: benign.replace('; ', ';\r\n')}, expected)

    def test_python_HTTP_and_recovery(self):
        for name in ('invoice_service.py', 'booking_engine/invoice_email_recovery.py'):
            benign = 'from booking_engine.invoice_email_dispatch import dispatch\n'
            expected = scan.import_inventory({name: benign})
            scan.check_sources({name: benign}, expected)
            for source in ('from booking_engine.guest_invoice_delivery import dispatch_initial_guest_invoice as dispatch',
                           'from booking_engine import guest_invoice_delivery',
                           "import importlib\nx=importlib.import_module('booking_engine.guest_invoice_delivery')"):
                with self.assertRaisesRegex(ValueError, 'incoming'):
                    scan.check_sources({name: source}, expected)
            with self.assertRaisesRegex(ValueError, 'import edges'):
                scan.check_sources({name: benign+'import socket\n'}, expected)

    def test_own_module_extra_import_rejected(self):
        name = 'velo/backend/guestBookingInvoiceDelivery.js'
        source = "import 'wix-data';"
        expected = scan.import_inventory({name: source})
        with self.assertRaisesRegex(ValueError, 'import edges'):
            scan.check_sources({name: source+"\nimport 'backend/extra';"}, expected)

    def test_scope_includes_legacy_and_rejects_new_entrypoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'velo/backend').mkdir(parents=True)
            (root/'booking_engine').mkdir()
            name = 'velo/backend/legacy.jsw'
            (root/name).write_text('export const read = 1;', encoding='utf-8')
            self.assertIn(name, scan.paths(root))
            self.assertFalse(name.endswith(('.js', '.html')), 'old extension filter misses jsw')
            expected = {name: []}
            scan.verify(root, expected)
            (root/'invoice_service.py').write_text('import os\n', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'scope changed'):
                scan.verify(root, expected)

    def test_html_literal_activation(self):
        scan.check_sources({'velo/public/probe.html': '<p>inert</p>'}, {'velo/public/probe.html': []})
        with self.assertRaisesRegex(ValueError, 'incoming'):
            scan.check_sources({'velo/public/probe.html': '<script>import("backend/guestBookingInvoiceDelivery")</script>'}, {'velo/public/probe.html': []})


class RecoveryHookTests(unittest.TestCase):
    def test_exact_recovery_and_extra_edges(self):
        name = 'velo/backend/guestBookingCompletionRecovery.js'
        source = (Path(__file__).resolve().parents[1] / name).read_text(encoding='utf-8')
        edges = ['backend/guestBookingAcceptanceDiscovery', 'backend/guestBookingPhysicalAcquisition',
                 'backend/guestBookingRecoveryProgressStore', 'backend/guestBookingInvoiceIssuance',
                 'backend/guestBookingIssuerAuthority']
        expected = {name: sorted(edges)}
        self.assertNotIn(name, scan.OWN)
        for text in (source, source.replace(chr(10), chr(13) + chr(10))):
            scan.check_sources({name: text}, expected)
            scan.check_absence(name.replace('/', chr(92)), text)
        for extra in (' ', "import 'backend/extra';", "import 'backend/guestBookingInvoiceDelivery';",
                      "import('backend/guestBookingInvoiceIssuance');",
                      "export * from 'backend/guestBookingInvoiceIssuance';",
                      "require('backend/guestBookingInvoiceIssuance');"):
            with self.subTest(extra=extra), self.assertRaisesRegex(ValueError, 'altered recovery source'):
                scan.check_sources({name: source + chr(10) + extra}, expected)
        for caller in ('velo/backend/status.web.js', 'velo/backend/access.jsw',
                       'velo/backend/other.js', 'velo/public/probe.html'):
            with self.subTest(caller=caller), self.assertRaisesRegex(ValueError, 'incoming'):
                scan.check_absence(caller, source)
        with self.assertRaisesRegex(ValueError, 'import edges'):
            scan.check_sources({name: source}, {name: sorted(edges[:-1])})


if __name__ == '__main__':
    unittest.main()
