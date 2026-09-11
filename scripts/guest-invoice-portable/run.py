"""Finite offline selector; outputs never belong in the repository."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('selector', choices=['check', 'suite', 'happy'])
parser.add_argument('--output', type=Path)
args = parser.parse_args()
subprocess.run(['node', str(HERE / 'custody.cjs')], check=True)
if args.selector == 'check':
    sys.exit(0)
output = args.output.resolve() if args.output else Path(tempfile.mkdtemp(prefix='guest-invoice-inert-'))
if output == ROOT or ROOT in output.parents:
    raise ValueError('Output must be outside repository')
output.mkdir(parents=True, exist_ok=True)
env = os.environ.copy()
# Never inherit active production settings/credentials into test processes.
for key in list(env):
    if key.startswith(('WBE_', 'GMAIL_', 'GOOGLE_', 'MICROSOFT_')):
        del env[key]
env.update(GI_OUTPUT=str(output), PYTHONDONTWRITEBYTECODE='1')
results = []
def run(name, command):
    env['GI_CASE'] = name
    result = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True, timeout=300)
    record = dict(case=name, command=command, exit=result.returncode, stdout=result.stdout, stderr=result.stderr)
    (output / (name + '-native.json')).write_text(json.dumps(record, indent=2), encoding='utf-8')
    results.append(record)
    (output / 'commands.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(name, result.returncode, result.stdout, flush=True)
    if result.returncode:
        print(result.stderr, file=sys.stderr)
        raise SystemExit(result.returncode)

modes = ['happy'] if args.selector == 'happy' else ['happy','start-loss','provider-loss','ingress-loss','journal-start-loss']
for mode in modes:
    run(mode, [sys.executable, '-B', str(HERE / 'test-guest-invoice-retained-runtime.py'), mode, mode+'-final'])
if args.selector == 'suite':
    for file, extra in [('test-guest-invoice-retained-sender.cjs',['negatives']),('test-guest-invoice-status-ui.cjs',[]),('test-guest-invoice-status-page.cjs',[])]:
        run(file, ['node','--experimental-vm-modules',str(HERE / file),*extra])
print('PASS; local artifacts:', output)
