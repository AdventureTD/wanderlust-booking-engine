"""Explicit STATIC-only package custody check; never imports application modules."""
from pathlib import Path
import hashlib, json, sys
assert sys.argv[1:] == ['STATIC'], 'Explicit STATIC selector required'
root = Path(__file__).resolve().parents[2]
support = Path(__file__).resolve().parent
manifest = json.loads((support/'package-manifest.json').read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
for entry in manifest['files']:
    data = (root/entry['path']).read_bytes()
    assert sha(data) in entry['allowedRawSha256'], entry['path']
    assert sha(data.replace(b'\r\n', b'\n')) == entry['canonicalSha256'], entry['path']
for file in support.glob('*'):
    if file.suffix in ['.cjs', '.py']:
        text = file.read_text()
        assert ('C:' + '/Users/') not in text and ('C:' + chr(92) * 2 + 'Users' + chr(92) * 2) not in text, file.name
assert len({e['path'] for e in manifest['files']}) == len(manifest['files'])
print('PASS STATIC exact package custody; backend dispatch=0; COMPLETE 1')
