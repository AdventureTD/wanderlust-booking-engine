"""Standalone stdlib custody controls, no application import or execution."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
manifest = json.loads((HERE / 'pins-v1.json').read_text())
results = []
with tempfile.TemporaryDirectory(prefix='gi-custody-') as directory:
    root = Path(directory)
    for member in manifest['files']:
        target = root / member
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / member, target)
    dest = root / 'scripts/guest-invoice-portable'
    shutil.copytree(HERE, dest)
    source = root / 'velo/backend/guestBookingCompletionRecovery.js'
    original = source.read_bytes()
    def check(name, expected):
        result = subprocess.run(['node', str(dest / 'custody.cjs')], capture_output=True, text=True)
        assert (result.returncode == 0) == expected, (name, result.stdout, result.stderr)
        if not expected:
            assert 'CUSTODY PASS' not in result.stdout
        results.append(dict(case=name, exit=result.returncode, stdout=result.stdout, stderr=result.stderr))
    check('clean', True)
    source.write_bytes(original.replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'))
    check('CRLF-equivalent', True)
    source.unlink()
    check('missing-source-before-runtime', False)
    for name, data in [('tampered-source',original+b' '),('BOM',b'\xef\xbb\xbf'+original),('lone-CR',original+b'\r')]:
        source.write_bytes(data)
        check(name, False)
    source.write_bytes(original)
    pinfile = dest / 'pins-v1.json'
    pins = json.loads(pinfile.read_text())
    del pins['files']['velo/backend/guestBookingCompletionRecovery.js']
    pinfile.write_text(json.dumps(pins))
    check('missing-pin-before-runtime', False)
    pins = json.loads((HERE / 'pins-v1.json').read_text())
    pins['files']['velo/backend/guestBookingCompletionRecovery.js']['sha256'] = '0' * 64
    pinfile.write_text(json.dumps(pins))
    check('tampered-pin-before-runtime', False)
    pinfile.unlink()
    check('missing-manifest-before-runtime', False)
assert len(results) == 9
print(json.dumps({'status':'PASS','runtimeEvaluated':0,'results':results},indent=2))
