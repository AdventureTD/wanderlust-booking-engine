"""Finite application source scan. No application import/execution or test discovery."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess

ROOTS = {'velo': ('.js', '.jsw', '.html'), 'booking_engine': ('.py',)}
OWN = {'booking_engine/guest_invoice_delivery.py',
       'velo/backend/guestBookingInvoiceDelivery.js',
       'velo/backend/guestBookingInvoiceIssuance.js'}
TOKENS = ('guest_invoice_delivery', 'dispatch_initial_guest_invoice',
          'guestBookingInvoiceDelivery', 'guestBookingInvoiceIssuance')


def paths(root):
    """Only these application trees and root Python entrypoints; no test inventory."""
    result = set()
    for directory, suffixes in ROOTS.items():
        for file in (root / directory).rglob('*'):
            if file.is_file() and file.suffix.lower() in suffixes:
                if file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
                    raise ValueError('escaping application path')
                result.add(file.relative_to(root).as_posix())
    result.update(file.name for file in root.glob('*.py') if file.is_file())
    return sorted(result)


def check_absence(name, source):
    # Conservative literal fence includes require/dynamic import, aliases and
    # reexports, including HTML. Computed-string dataflow is not claimed.
    name = name.replace(chr(92), '/')
    if name == 'velo/backend/guestBookingCompletionRecovery.js':
        canonical = source.replace(chr(13) + chr(10), chr(10))
        if hashlib.sha256(canonical.encode('utf-8')).hexdigest() != '03717d326e5ead7ac6b44674bc9b09b072a2cefb7b2038d67ef545e2b64ea098':
            raise ValueError('incoming guest activation: altered recovery source')
        # Full canonical source pin binds exact five static imports and their bindings.
        # Do not add recovery to OWN or grant delivery/dynamic/reexport permission.
        return
    if name not in OWN and any(token in source for token in TOKENS):
        raise ValueError('incoming guest activation: ' + name)


def import_inventory(sources):
    result, javascript = {}, {}
    for name, source in sources.items():
        if name.endswith('.py'):
            tree = ast.parse(source, filename=name)
            result[name] = sorted(ast.unparse(n) for n in ast.walk(tree)
                                  if isinstance(n, (ast.Import, ast.ImportFrom)))
        elif name.endswith(('.js', '.jsw')):
            javascript[name] = source
        else:
            result[name] = []  # HTML: lexical absence + complete source pin only.
    if javascript:
        completed = subprocess.run(
            ['node', '--experimental-vm-modules', str(Path(__file__).with_name('guest-delivery-static-imports.cjs'))],
            input=json.dumps(javascript), capture_output=True, text=True, encoding='utf-8', timeout=30)
        if completed.returncode:
            raise ValueError('static JS parser failed: ' + completed.stderr)
        result.update(json.loads(completed.stdout))
    return result


def check_sources(sources, expected):
    if sorted(sources) != sorted(expected):
        raise ValueError('finite application scope changed')
    for name, source in sources.items():
        check_absence(name, source)
    actual = import_inventory(sources)
    if actual != expected:
        raise ValueError('exact application import edges changed')
    return actual


def verify(root, expected):
    if paths(root) != sorted(expected):
        raise ValueError('finite application scope changed')
    sources = {name: (root / name).read_text(encoding='utf-8') for name in expected}
    check_sources(sources, expected)
    return {'files': len(sources), 'imports': sum(map(len, expected.values())),
            'incoming': 'ABSENT_EXCEPT_EXACT_OWN_MODULES',
            'computed_import_dataflow': 'UNVERIFIED', 'execution': 'PARSE_ONLY'}
