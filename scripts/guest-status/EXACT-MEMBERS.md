# Exact-membership support overlay (candidate; independent review required)

This separate support overlay adds exactly these three repository-relative files:

- `scripts/guest-status/review-exact-members.py`
- `scripts/guest-status/exact-members-support.json`
- `scripts/guest-status/EXACT-MEMBERS.md`

The original 80 members and original manifest remain unchanged. The explicit union
has 83 files. Original ownership remains 48 owned plus 32 inherited; the proposed
new owned list is the programmatic union of those 48 paths and these three paths,
not a whole-branch import. The original 13 evidence IDs remain historical evidence,
not new execution. No runtime suite, backend, default/restricted guard, producer,
public UI, live system, index or commit is activated by this byte-only checker.

## Trust root and admission

The original manifest canonical-LF SHA-256 is immutable:
`f7125b5024324b49ec6be227b7e8145d765325fdfa336ff2d2dda48d1b9864c1`.
The helper authenticates the candidate manifest before parsing it; there is no
checkpoint-relative runtime dependency.

The separate support record enumerates hashes for exactly the helper and this
document. Its `recordPath` names the third member (the record itself). The record
is authenticated by an independently approved, externally supplied canonical-LF
SHA-256. This avoids a self-hash cycle: the external digest covers the entire
record, including its explicit path and the two other support hashes. The record
cannot authorize extra support names, even if a caller supplies a digest for a
rewritten record. Original membership cannot be extended by editing either table.

**Do not execute a candidate helper to authenticate its own arbitrary replacement.**
The final independent reviewer must approve the exact code, document, record,
external digest and explicit member union. A digest calculated from an unreviewed
candidate is only a candidate identity, never approval. Obtain the approved record
digest through the review/operator channel, not a package field or a candidate
command. Implementation controls use a provisional fixed external digest; they
are not independent approval.

Before running candidate code, use a separately trusted standard-library bootstrap
(such as the following code, reviewed and copied to an external trusted location).
Authenticate the record and helper first, then execute the already-authenticated
in-memory helper bytes, not a second read from a mutable candidate. Do not copy a
bootstrap from an unverified replacement document and call it trusted. The final
review should approve this bootstrap text together with the documentation; it is
not a fourth shipped member or a checkpoint dependency of the helper.

```python
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

root_arg, approved_digest = sys.argv[1:]
if not re.fullmatch('[0-9a-f]{64}', approved_digest):
    raise SystemExit('invalid external digest')
root = Path(root_arg)
if '..' in root.parts:
    raise SystemExit('parent traversal denied')
root = root.absolute()  # lexical absolute, never resolve links

def ordinary(path, directory=False):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
        raise SystemExit('link/reparse denied before support execution')
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise SystemExit('ordinary path required')

for ancestor in (*reversed(root.parents), root):
    ordinary(ancestor, True)
for suffix in ('scripts', 'scripts/guest-status'):
    ordinary(root / suffix, True)
record_name = 'scripts/guest-status/exact-members-support.json'
helper_name = 'scripts/guest-status/review-exact-members.py'
doc_name = 'scripts/guest-status/EXACT-MEMBERS.md'
def read_member(name):
    ordinary(root / name)
    return (root / name).read_bytes().replace(b'\r\n', b'\n')
def sha(data):
    return hashlib.sha256(data).hexdigest()
record_bytes = read_member(record_name)
if sha(record_bytes) != approved_digest:
    raise SystemExit('external support anchor mismatch before execution')
record = json.loads(record_bytes)
if (set(record) != {'schema', 'originalManifestSha256', 'recordPath', 'members'}
        or record['schema'] != 'guest-status-exact-support-v1'
        or record['originalManifestSha256'] != 'f7125b5024324b49ec6be227b7e8145d765325fdfa336ff2d2dda48d1b9864c1'
        or record['recordPath'] != record_name
        or set(record['members']) != {helper_name, doc_name}):
    raise SystemExit('explicit support admission mismatch before execution')
code = read_member(helper_name)
if sha(code) != record['members'][helper_name]:
    raise SystemExit('helper hash mismatch before execution')
if sha(read_member(doc_name)) != record['members'][doc_name]:
    raise SystemExit('document hash mismatch before execution')
sys.argv = [helper_name, root_arg, '--support-sha256', approved_digest]
exec(compile(code, helper_name, 'exec'), {'__name__': '__main__', '__file__': str(root / helper_name)})
```

Invocation of that independently reviewed external bootstrap:

```text
python -B /trusted/bootstrap.py /detached/candidate EXTERNALLY_APPROVED_RECORD_SHA256
```

After authenticating the helper bytes in a protected immutable staging directory,
a trusted operator may alternatively invoke the reviewed helper directly:

```text
python -B /detached/candidate/scripts/guest-status/review-exact-members.py /detached/candidate --support-sha256 EXTERNALLY_APPROVED_RECORD_SHA256
```

The helper accepts no default digest and derives no authority from its own file
location. Relocation requires only Python standard library, the detached candidate
and the independently approved external digest. Neither invocation makes a full
repository an admissible sparse export; unrelated files (including `.git`), extra
empty directories, missing members and changed bytes fail exact inventory.

## Filesystem and representation boundary

Use a detached offline directory protected against concurrent mutation. Root and
all lexical ancestors are checked with `lstat` before any manifest/support reads
or resolution. Parent traversal (`..`) is denied. Root/member/ancestor symlinks,
Windows junctions and any reparse point are rejected, as are special files.
Traversal does not follow discovered directory links. These checks are not a
race-free sandbox against a hostile concurrent filesystem writer; no such claim
is made. A trusted execution environment and immutable candidate custody are
prerequisites. Hard links do not evade byte comparison, but must not be concurrently
mutated through another name.

The only admitted representation change is CRLF to LF. Nothing strips whitespace,
rewrites JSON, trims EOF, normalizes Unicode or ignores arbitrary file prefixes.
All original and support files are compared by canonical-LF SHA-256; raw original
ZIP/export hashes remain separate custody evidence. LF and CRLF controls exercise
byte admission only, never behavioral suites.

## Historical provenance and report anchors

Original ZIP SHA-256:
`85be3cb5c88da8d5e26d02b311786f36f34eb73303af755e867b6c46d63d12bc`.
Parent: `bdb4093bb4332594001436b50eb47b9c4e693761`.
Historical `PACKAGE.md` documents the old selected-member inspector, **not** this
strict gate; its historical missing-report reference is not repaired here.
The external reports `booking-guest-status-package-recovery.md` and
`booking-guest-status-delivery.md` supply historical recovery/delivery custody;
`booking-guest-status-exact-members-proposal.md` freezes this scoped design and
`booking-guest-status-exact-members-fix.md` identifies new candidate evidence.
These are human review anchors, not files the helper reads or new shipped members.

The historical raw vector oracle passes the frozen raw export, but fails on fully
canonical-LF evidence at `independent-python-oracle.json`. Retain its authenticated
original result as **raw provenance only**. This overlay neither revises that oracle
nor claims a fabricated LF pass. S01-S10 remain earlier-source evidence; the retained
13-ID ledger is not a fresh final-byte regression. All new support bytes and the
external admission record remain subject to final independent review before any
later staging, commit or push. This proposal authorizes none of those operations.
