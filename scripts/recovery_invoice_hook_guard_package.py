"""Hook-only successor byte layer. No historical audit, source imports or dispatch.

Original custody/final-package JSON files remain immutable historical roots.
Only the hardcoded hook-induced record/path sets may override their membership.
Hashes are a candidate freeze requiring separate independent byte approval.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath

BASE = 'scripts/guest-delivery-custody.json'
LAYER = 'scripts/guest-delivery-final-package.json'
MANIFEST = 'scripts/recovery-invoice-hook-guard-package.json'
RECOVERY = 'velo/backend/guestBookingCompletionRecovery.js'
OVERRIDES = {RECOVERY, 'scripts/guest_delivery_entrypoints.py',
             'scripts/test_guest_delivery_entrypoints.py',
             'scripts/verify-guest-booking-invoice-delivery.js'}
ADDITIONS = {'docs/booking-recovery-invoice-hook.md',
             'scripts/fixtures/recovery-invoice-hook-admission.json',
             'scripts/verify-guest-booking-recovery-invoice-hook.js',
             'scripts/verify-guest-booking-invoice-issuance.js',
             'scripts/verify-guest-booking-completion-recovery.js',
             'scripts/verify-recovery-invoice-hook-guards.cjs',
             'scripts/recovery_invoice_hook_guard_package.py',
             'scripts/test_recovery_invoice_hook_guard_package.py'}
OLD_EDGES = ['backend/guestBookingAcceptanceDiscovery',
             'backend/guestBookingPhysicalAcquisition',
             'backend/guestBookingRecoveryProgressStore']
NEW_EDGES = ['backend/guestBookingInvoiceIssuance', 'backend/guestBookingIssuerAuthority']


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe(root, name):
    p = PurePosixPath(name)
    if not name or p.as_posix() != name or p.is_absolute() or '..' in p.parts or ':' in name or chr(92) in name:
        raise ValueError('unsafe path')
    target = (root / name).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('escaping path')
    return target


def canonical(raw, record):
    if record['eol'] not in ('LF', 'CRLF', 'binary'):
        raise ValueError('unsupported EOL')
    content = raw if record['eol'] == 'binary' else raw.replace(b'\r\n', b'\n')
    if sha(content) != record['canonical_sha256']:
        raise ValueError('canonical custody mismatch')
    restored = content.replace(b'\n', b'\r\n') if record['eol'] == 'CRLF' else content
    if sha(restored) != record['raw_sha256']:
        raise ValueError('raw restoration mismatch')
    return content  # Git LF output; raw restoration validated, not written.


def verify(source, read=None):
    source = source.resolve()
    reader = read or (lambda name: safe(source, name).read_bytes())
    manifest_raw = reader(MANIFEST).replace(b'\r\n', b'\n')
    # This separately reviewed trust root cannot be replaced by a source overlay.
    if manifest_raw != Path(__file__).with_name(Path(MANIFEST).name).read_bytes().replace(b'\r\n', b'\n'):
        raise ValueError('successor trust root mismatch')
    m = json.loads(manifest_raw)
    if set(m['roots']) != {BASE, LAYER} or set(m['overrides']) != OVERRIDES or set(m['additions']) != ADDITIONS:
        raise ValueError('finite successor scope changed')
    roots = {n: canonical(reader(n), record) for n, record in m['roots'].items()}
    base, layer = json.loads(roots[BASE]), json.loads(roots[LAYER])
    canonical(roots[BASE], layer['base_manifest'])
    if set(base['files']) & set(layer['additions']):
        raise ValueError('historical overlap')
    records = {**base['files'], **layer['additions']}
    if ADDITIONS & set(records) or not OVERRIDES <= set(records):
        raise ValueError('successor membership collision')
    for name, change in m['overrides'].items():
        if records[name] != change['before']:
            raise ValueError('historical record mismatch: ' + name)
        records[name] = change['after']
    records.update(m['additions'])
    expected = m['recovery_application_imports']
    if expected != {'before': OLD_EDGES, 'after': sorted(OLD_EDGES + NEW_EDGES)}:
        raise ValueError('exact recovery edge delta changed')
    if base['application_imports'][RECOVERY] != expected['before']:
        raise ValueError('historical recovery edges changed')
    imports = dict(base['application_imports'])
    imports[RECOVERY] = expected['after']
    files = {n: canonical(reader(n), record) for n, record in records.items()}
    files.update(roots)
    files[MANIFEST] = manifest_raw
    return files, imports


def materialize(source, output):
    source, output = source.resolve(), output.resolve()
    if output == source or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('output must be disjoint')
    files, imports = verify(source)
    output.mkdir(parents=True, exist_ok=False)
    for name, raw in files.items():
        target = safe(output, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    for name, raw in files.items():
        if safe(output, name).read_bytes() != raw:
            raise ValueError('export readback mismatch: ' + name)
    return files, imports


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--output', type=Path)
    a = p.parse_args()
    files, imports = materialize(a.source, a.output) if a.output else verify(a.source)
    print(json.dumps({'status': 'HOOK_SUCCESSOR_BYTE_ONLY_PASS', 'files': len(files),
                      'application_import_records': len(imports), 'output_eol': 'Git canonical LF',
                      'runtime_execution': 'NOTRUN', 'historical_audit': 'NOTRUN',
                      'producer_dispatch': 'NOTRUN', 'independent_review': 'PENDING'}))


if __name__ == '__main__':
    main()
