"""Selected package byte custody plus actual loader inspection; no backend invocation.
The manifest must itself be anchored by the external review report.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'scripts/guest-status/package-manifest.json'

def main():
    manifest = json.loads(MANIFEST.read_bytes())
    for name, entry in manifest['members'].items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or '\\' in name or ':' in name:
            raise ValueError('nonrelative member')
        data = (ROOT / name).read_bytes()
        actual = hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()
        if actual != entry['canonicalSha256']:
            raise ValueError('byte mismatch: ' + name)
    # preflight compiles functions but never invokes them. fixture parses inert JSON.
    code = "const l=require('./scripts/guest-status/loader.cjs'); const n=l.preflight().size; for(const f of Object.keys(l.admission.fixtures))l.fixture(f); console.log(JSON.stringify({kind:'INSPECTION_ONLY',modules:n,fixtures:Object.keys(l.admission.fixtures).length,backendInvocations:0}));"
    result = subprocess.run(['node', '-e', code], cwd=ROOT, capture_output=True, text=True, timeout=30)
    print(json.dumps({'members': len(manifest['members']), 'actualLoaderExit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr, 'scope': 'enumerated package only, not full incoming/default/restricted guard'}))
    return result.returncode

if __name__ == '__main__':
    sys.exit(main())
