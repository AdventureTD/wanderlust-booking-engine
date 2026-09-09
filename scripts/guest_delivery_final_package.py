"""Finite byte-only combined export; never import or dispatch packaged sources.

The historical custody manifest remains unchanged. This separate layer authenticates
that trust root and adds the exact GP02/support members. It does not run the old
materializer's import/entrypoint audit or claim its result. Inclusion of producer
sources grants no invocation permission. Independent byte approval is required.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath

MANIFEST = Path(__file__).with_name('guest-delivery-final-package.json')
BASE = 'scripts/guest-delivery-custody.json'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_path(root, name):
    p = PurePosixPath(name)
    if not name or p.as_posix() != name or p.is_absolute() or '..' in p.parts or ':' in name or '\\' in name:
        raise ValueError('unsafe package path: ' + name)
    target = (root / name).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('escaping package path: ' + name)
    return target


def restore(raw, record):
    if record['eol'] not in ('LF', 'CRLF', 'binary'):
        raise ValueError('unsupported EOL')
    canonical = raw if record['eol'] == 'binary' else raw.replace(b'\r\n', b'\n')
    if sha(canonical) != record['canonical_sha256']:
        raise ValueError('canonical custody mismatch')
    restored = canonical.replace(b'\n', b'\r\n') if record['eol'] == 'CRLF' else canonical
    if sha(restored) != record['raw_sha256']:
        raise ValueError('raw custody mismatch')
    return restored


def verify(source):
    layer_raw = MANIFEST.read_bytes()
    layer = json.loads(layer_raw)
    base_raw = restore(safe_path(source, BASE).read_bytes(), layer['base_manifest'])
    base = json.loads(base_raw)
    additions = layer['additions']
    layer_name = 'scripts/guest-delivery-final-package.json'
    if set(base['files']) & set(additions) or BASE in additions or layer_name in additions:
        raise ValueError('overlapping package membership')
    records = {**base['files'], **additions}
    files = {name: restore(safe_path(source, name).read_bytes(), record)
             for name, record in records.items()}
    files[BASE] = base_raw
    # The layer itself is a separately reviewed trust root, not a self-hash.
    # Require the source copy to agree, rather than silently substituting it.
    if safe_path(source, layer_name).read_bytes().replace(b'\r\n', b'\n') != layer_raw.replace(b'\r\n', b'\n'):
        raise ValueError('layer trust root mismatch')
    files[layer_name] = layer_raw
    return files


def materialize(source, output):
    source, output = source.resolve(), output.resolve()
    if output == source or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('output must be disjoint from source')
    files = verify(source)
    output.mkdir(parents=True, exist_ok=False)
    for name, raw in files.items():
        target = safe_path(output, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    (output / 'frozen-hashes.json').write_text(json.dumps({n: sha(b) for n, b in files.items()}, indent=2) + '\n', encoding='utf-8')
    (output / 'pytest-guest-delivery.ini').write_text('[pytest]\n', encoding='utf-8')
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    files = materialize(args.source, args.output) if args.output else verify(args.source)
    print(json.dumps({'status': 'FINITE_COMBINED_BYTE_CUSTODY_PASS', 'files': len(files),
                      'application_execution': 'NOTRUN', 'producer_dispatch': 'NOTRUN',
                      'import_or_effective_pin_reconciliation': 'NOTRUN'}))


if __name__ == '__main__':
    main()
