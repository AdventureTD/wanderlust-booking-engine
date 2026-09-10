"""Byte inspection ONLY: never import, compile, evaluate or execute candidate code.
External caller MUST supply the independently trusted manifest digest. This new
helper and implementation-generated digest still require independent review.
No race-free hostile concurrent-filesystem protection is claimed.
"""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import stat
import sys

def sha(b):
    return hashlib.sha256(b).hexdigest()

def canonical(b):
    return b.replace(b'\r\n', b'\n')

def deny_links(p):
    # Inspect lexical root and ancestors BEFORE any resolve operation.
    for q in [p, *p.parents]:
        s = q.lstat()
        if stat.S_ISLNK(s.st_mode) or getattr(s, 'st_file_attributes', 0) & 0x400:
            raise ValueError('link/reparse: '+str(q))

def inspect(root, manifest_path, expected_manifest_sha):
    root = Path(os.path.abspath(root))
    deny_links(root)
    manifest_bytes = Path(manifest_path).read_bytes()
    if sha(manifest_bytes) != expected_manifest_sha:
        raise ValueError('external manifest digest mismatch')
    manifest = json.loads(manifest_bytes)
    if manifest['schema'] != 'private-invoice-wire-byte-package/v1':
        raise ValueError('schema')
    members = manifest['members']
    for name in members:
        p = PurePosixPath(name)
        if p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name or str(p) != name:
            raise ValueError('unsafe manifest path')
    actual = set()
    for current, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            p = Path(current) / name
            deny_links(p)
            if p.is_file():
                actual.add(p.relative_to(root).as_posix())
            elif not p.is_dir():
                raise ValueError('nonregular member')
    if actual != set(members):
        raise ValueError('membership missing='+repr(sorted(set(members)-actual))+' extra='+repr(sorted(actual-set(members))))
    for name, pin in members.items():
        b = (root/name).read_bytes()
        if sha(canonical(b)) != pin['canonicalLF']:
            raise ValueError('member digest: '+name)
    # Exercise precisely the pre-import source-custody read used by relocated
    # mapping/init harnesses, as DATA; do not load those executable harnesses.
    pins = json.loads((root/'scripts/private-invoice-wire/source-pins.json').read_bytes())
    expected = {n for n,p in members.items() if p['role'] != 'owned-new-support'}
    if set(pins) != expected:
        raise ValueError('source-pin membership')
    for name,pin in pins.items():
        if pin['raw'] != members[name]['raw'] or pin['canonicalLF'] != members[name]['canonicalLF']:
            raise ValueError('source-pin rewrite')
        if sha(canonical((root/name).read_bytes())) != pin['canonicalLF']:
            raise ValueError('source-pin digest')
    edges = json.loads((root/'scripts/private-invoice-wire/import-edges.json').read_bytes())
    backend = {n for n in pins if n.startswith('velo/backend/')}
    if set(edges) != backend:
        raise ValueError('edge inventory')
    for consumer, imports in edges.items():
        for dep in imports:
            if dep.startswith('backend/') and 'velo/'+dep+'.js' not in backend:
                raise ValueError('unclosed dependency')
    return {'classification':'BYTE_INSPECTION_ONLY','members':len(actual),'sourceMembers':len(pins),'backendImportMembers':len(backend),'manifestSHA256':expected_manifest_sha,'runtimeExecutions':0}

if __name__ == '__main__':
    try:
        if len(sys.argv) != 4:
            raise ValueError('usage: inspect_package.py ROOT EXTERNAL_MANIFEST TRUSTED_SHA256')
        print(json.dumps(inspect(*sys.argv[1:]),sort_keys=True))
    except Exception as exc:
        print(type(exc).__name__+': '+str(exc),file=sys.stderr)
        sys.exit(1)
