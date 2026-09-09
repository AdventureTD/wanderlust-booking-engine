"""Finite offline custody/materializer. Never imports application code or runs it."""
import argparse
import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import guest_delivery_entrypoints

MANIFEST = Path(__file__).with_name('guest-delivery-custody.json')

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def load_manifest():
    return json.loads(MANIFEST.read_text(encoding='utf-8'))

def imports(source):
    return sorted(ast.unparse(n) for n in ast.walk(ast.parse(source))
                  if isinstance(n, (ast.Import, ast.ImportFrom)))

def check_imports(source, expected):
    if imports(source) != expected:
        raise ValueError('guest adapter exact imports changed')

def check_incoming(source, name):
    # Conservative source fence also catches literal dynamic imports. It is not
    # dataflow analysis; computed strings and files outside the finite set remain
    # outside this preparation gate. JS activation remains GDR08-owned.
    ast.parse(source, filename=name)
    if 'guest_invoice_delivery' in source or 'dispatch_initial_guest_invoice' in source:
        raise ValueError('incoming guest delivery activation: ' + name)

def safe_path(root, relative):
    p = PurePosixPath(relative)
    if p.is_absolute() or '..' in p.parts or ':' in relative or '\\' in relative:
        raise ValueError('unsafe custody path: ' + relative)
    target = (root / relative).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('escaping custody path: ' + relative)
    return target

def restore(raw, record):
    canonical = raw if record['eol'] == 'binary' else raw.replace(b'\r\n', b'\n')
    if sha(canonical) != record['canonical_sha256']:
        raise ValueError('canonical custody mismatch')
    restored = canonical.replace(b'\n', b'\r\n') if record['eol'] == 'CRLF' else canonical
    if sha(restored) != record['raw_sha256']:
        raise ValueError('raw custody mismatch')
    return restored

def verify(source):
    manifest = load_manifest()
    guest_delivery_entrypoints.verify(source, manifest['application_imports'])
    result = {}
    for relative, record in manifest['files'].items():
        result[relative] = restore(safe_path(source, relative).read_bytes(), record)
    target = 'booking_engine/guest_invoice_delivery.py'
    check_imports(result[target].decode('utf-8'), manifest['imports'])
    for relative in manifest['incoming_scope']:
        check_incoming(result[relative].decode('utf-8'), relative)
    # Manifest is the trust root, pinned separately by the external proposal.
    result['scripts/guest-delivery-custody.json'] = MANIFEST.read_bytes()
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, help='new external directory only; no application execution')
    args = parser.parse_args()
    files = verify(args.source)
    if args.output:
        source, output = args.source.resolve(), args.output.resolve()
        if output == source or output.is_relative_to(source) or source.is_relative_to(output):
            raise ValueError('output must be disjoint from source')
        output.mkdir(parents=True, exist_ok=False)
        for name, raw in files.items():
            target = safe_path(output, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        (output / 'frozen-hashes.json').write_text(json.dumps({k:sha(v) for k,v in files.items()}, indent=2)+'\n', encoding='utf-8')
        (output / 'pytest-guest-delivery.ini').write_text('[pytest]\n', encoding='utf-8')
    print(json.dumps({'status':'FINITE_CUSTODY_PASS', 'files':len(files),
                      'behavioral_execution':'NOTRUN', 'application_scope':'EXACT_IMPORTS_AND_LITERAL_ABSENCE_PASS',
                      'outside_declared_application_roots_and_computed_imports':'UNVERIFIED'}))

if __name__ == '__main__':
    main()
