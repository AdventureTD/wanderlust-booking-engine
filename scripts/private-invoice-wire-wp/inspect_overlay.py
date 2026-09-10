"""Inspection ONLY; no candidate imports, compilation, VM or backend execution.
Externally authenticate this helper SHA and support-record SHA before use.
Immutable-directory custody required; no concurrent-mutation guarantee.
"""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import re
import stat
import sys

ORIGINAL = '48af8adb41c891d7e3992ca02e4ce869b201355004341b76ad22816d15e7e103'
ADDED = {'scripts/private-invoice-wire-wp/verify-auth.cjs', 'scripts/private-invoice-wire-wp/test_auth.py', 'scripts/private-invoice-wire-wp/inspect_overlay.py'}
PARENT = 'ea64f542ad9f62a9adcd94a946cd6887a7de8ef5'

def sha(b):
    return hashlib.sha256(b).hexdigest()

def canonical(b):
    return b.replace(b'\r\n', b'\n')

def deny_links(p):
    for q in [p, *p.parents]:
        s = q.lstat()
        if stat.S_ISLNK(s.st_mode) or getattr(s, 'st_file_attributes', 0) & 0x400:
            raise ValueError('link/reparse: '+str(q))

def safe(name):
    p = PurePosixPath(name)
    if not name or p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name or str(p) != name:
        raise ValueError('unsafe member path')

def imports(b):
    # Authenticated source grammar, not a general JS parser or reachability proof.
    return [x.decode('utf-8') for x in re.findall(rb'^(?:import|export)\s+[^;]+?\s+from\s+[\'"]([^\'"]+)[\'"];', canonical(b), re.M)]

def inspect(root, manifest_file, record_file, anchor, shape):
    root = Path(os.path.abspath(root))
    deny_links(root)  # Deliberately BEFORE resolve/walk/read.
    mb = Path(manifest_file).read_bytes()
    if sha(mb) != ORIGINAL:
        raise ValueError('original manifest anchor')
    rb = Path(record_file).read_bytes()
    if not re.fullmatch('[0-9a-f]{64}', anchor) or sha(rb) != anchor:
        raise ValueError('support record external anchor')
    m, r = json.loads(mb), json.loads(rb)
    if r['schema'] != 'private-wire-wp-overlay/v1' or r['parent'] != PARENT or m['parent'] != PARENT:
        raise ValueError('schema/parent')
    if set(r['support']) != ADDED or set(r['parentExtras']) & (set(m['members']) | ADDED):
        raise ValueError('fixed support/extra inventory')
    if len(m['members']) != 45 or len(r['parentExtras']) != 264:
        raise ValueError('frozen member census')
    expected = dict(m['members'])
    expected.update(r['support'])
    if shape == 'full-parent':
        expected.update(r['parentExtras'])
    elif shape != 'sparse':
        raise ValueError('explicit shape required')
    for name in expected:
        safe(name)
    actual = set()
    for current, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            p = Path(current)/name
            deny_links(p)
            if p.is_file():
                actual.add(p.relative_to(root).as_posix())
            elif not p.is_dir():
                raise ValueError('nonregular member')
    if actual != set(expected):
        raise ValueError('membership missing='+repr(sorted(set(expected)-actual))+' extra='+repr(sorted(actual-set(expected))))
    data = {}
    for name, pin in expected.items():
        b = (root/name).read_bytes()
        raw_only = pin.get('representation') == 'raw'
        if sha(b if raw_only else canonical(b)) != pin['raw' if raw_only else 'canonicalLF']:
            raise ValueError('member digest: '+name)
        data[name] = b
    pins = json.loads(data['scripts/private-invoice-wire/source-pins.json'])
    selected = {n for n,p in m['members'].items() if p['role'] != 'owned-new-support'}
    if set(pins) != selected:
        raise ValueError('original source-pin membership')
    for n,p in pins.items():
        if any(p[k] != m['members'][n][k] for k in ('raw','canonicalLF')):
            raise ValueError('original source-pin rewrite')
    edges = json.loads(data['scripts/private-invoice-wire/import-edges.json'])
    backend = {n for n in pins if n.startswith('velo/backend/')}
    if set(edges) != backend or len(backend) != 32:
        raise ValueError('edge inventory')
    for n, deps in edges.items():
        if imports(data[n]) != deps:
            raise ValueError('unknown/changed source import: '+n)
        for dep in deps:
            if dep.startswith('backend/') and 'velo/'+dep+'.js' not in backend:
                raise ValueError('unclosed import')
    # This record is provenance only: only these TWO actual JS modules may load.
    if r['actualJSModules'] != ['velo/backend/guestBookingInvoiceTransportAuth.js','velo/backend/guestBookingInvoiceAuthorityConfig.js']:
        raise ValueError('pure-auth actual module boundary')
    return {'classification':'BYTE_INSPECTION_ONLY_NOT_BEHAVIOR','shape':shape,'members':len(actual),'backendImportRecords':len(edges),'runtimeExecutions':0,'recordSHA256':anchor}

if __name__ == '__main__':
    try:
        if len(sys.argv) != 6:
            raise ValueError('usage: inspect_overlay.py ROOT ORIGINAL_MANIFEST SUPPORT_RECORD EXTERNAL_SHA sparse|full-parent')
        print(json.dumps(inspect(*sys.argv[1:]), sort_keys=True))
    except Exception as exc:
        print(type(exc).__name__+': '+str(exc), file=sys.stderr)
        sys.exit(1)
