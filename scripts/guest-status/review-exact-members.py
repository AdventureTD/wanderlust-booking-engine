"""Offline exact inventory. Execute only externally authenticated support bytes.
No runtime imports, generators, Git writes, or network activity.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys

MANIFEST_PIN = 'f7125b5024324b49ec6be227b7e8145d765325fdfa336ff2d2dda48d1b9864c1'
MANIFEST = 'scripts/guest-status/package-manifest.json'
HELPER = 'scripts/guest-status/review-exact-members.py'
RECORD = 'scripts/guest-status/exact-members-support.json'
DOC = 'scripts/guest-status/EXACT-MEMBERS.md'
SUPPORT = frozenset((HELPER, RECORD, DOC))
REPARSE = getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)


def canonical(data):
    return data.replace(b'\r\n', b'\n')


def digest(data):
    return hashlib.sha256(canonical(data)).hexdigest()


def reject_link(path):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & REPARSE:
        raise ValueError('link/reparse denied: ' + str(path))
    return info


def lexical_root(supplied):
    # Never resolve() before checking root AND every supplied ancestor.
    path = Path(supplied)
    if '..' in path.parts:
        raise ValueError('parent traversal denied')
    path = path.absolute()
    for part in (*reversed(path.parents), path):
        info = reject_link(part)
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError('ordinary directory required: ' + str(part))
    return path


def regular_bytes(root, name):
    path = root / name
    for parent in reversed(path.relative_to(root).parents):
        info = reject_link(root / parent)
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError('ordinary directory required')
    if not stat.S_ISREG(reject_link(path).st_mode):
        raise ValueError('ordinary file required: ' + name)
    return path.read_bytes()


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key: ' + key)
        result[key] = value
    return result


def parse(data):
    return json.loads(data, object_pairs_hook=object_pairs)


def member_name(name):
    if not isinstance(name, str):
        raise ValueError('member name must be a string')
    p = PurePosixPath(name)
    if (not name or p.is_absolute() or '..' in p.parts or '\\' in name
            or ':' in name or str(p) != name or name == '.'):
        raise ValueError('invalid repository-relative member: ' + name)


def inventory(root):
    files, dirs = set(), set()
    pending = [root]
    while pending:
        directory = pending.pop()
        reject_link(directory)
        with os.scandir(directory) as entries:
            for entry in entries:
                path = Path(entry.path)
                info = reject_link(path)
                name = path.relative_to(root).as_posix()
                if stat.S_ISDIR(info.st_mode):
                    dirs.add(name)
                    pending.append(path)
                elif stat.S_ISREG(info.st_mode):
                    files.add(name)
                else:
                    raise ValueError('special file denied: ' + name)
    return files, dirs


def verify(supplied, support_sha256):
    if not re.fullmatch('[0-9a-f]{64}', support_sha256):
        raise ValueError('external support digest must be 64 lowercase hex characters')
    root = lexical_root(supplied)
    record_bytes = regular_bytes(root, RECORD)
    if digest(record_bytes) != support_sha256:
        raise ValueError('external support anchor mismatch')
    record = parse(record_bytes)
    if (set(record) != {'schema', 'originalManifestSha256', 'recordPath', 'members'}
            or record['schema'] != 'guest-status-exact-support-v1'
            or record['originalManifestSha256'] != MANIFEST_PIN
            or record['recordPath'] != RECORD
            or not isinstance(record['members'], dict)
            or set(record['members']) != SUPPORT - {RECORD}):
        raise ValueError('explicit support admission schema/member mismatch')
    for name, expected_hash in record['members'].items():
        if not isinstance(expected_hash, str) or not re.fullmatch('[0-9a-f]{64}', expected_hash):
            raise ValueError('invalid support hash')
        if digest(regular_bytes(root, name)) != expected_hash:
            raise ValueError('support canonical byte mismatch: ' + name)
    manifest_bytes = regular_bytes(root, MANIFEST)
    if digest(manifest_bytes) != MANIFEST_PIN:
        raise ValueError('immutable original manifest anchor mismatch')
    members = parse(manifest_bytes)['members']
    expected = set(members) | {MANIFEST}
    if len(expected) != 80 or expected & SUPPORT:
        raise ValueError('original membership invariant mismatch')
    expected |= SUPPORT
    for name in expected:
        member_name(name)
    actual, dirs = inventory(root)
    expected_dirs = {str(p) for n in expected for p in PurePosixPath(n).parents if str(p) != '.'}
    if actual != expected or dirs != expected_dirs:
        raise ValueError(json.dumps({'extra': sorted(actual - expected),
                                    'missing': sorted(expected - actual),
                                    'extraDirectories': sorted(dirs - expected_dirs),
                                    'missingDirectories': sorted(expected_dirs - dirs)}))
    for name, entry in members.items():
        if digest(regular_bytes(root, name)) != entry['canonicalSha256']:
            raise ValueError('original canonical byte mismatch: ' + name)
    return {'verdict': 'PASS', 'originalMembers': 80, 'addedSupportMembers': 3,
            'exactMembers': len(expected), 'backendInvocations': 0,
            'scope': 'offline canonical-LF byte inventory, not runtime or independent approval'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', help='lexical candidate root; links/reparse ancestors denied')
    parser.add_argument('--support-sha256', required=True,
                        help='independently approved external canonical-LF record digest')
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.root, args.support_sha256)))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
