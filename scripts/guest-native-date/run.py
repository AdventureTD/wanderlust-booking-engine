"""One fresh two-booking run. Real Word; approved inert invoice/Calendar transports only."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='new exclusive evidence directory, outside the source tree')
    args = parser.parse_args()
    subprocess.run(['node', str(HERE / 'custody.cjs')], cwd=ROOT, check=True)
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError('keep generated history outside the source tree')
    output.mkdir(parents=True, exist_ok=False)
    subprocess.run([sys.executable, '-B', str(ROOT / 'scripts/guest-calendar-caller/run.py'), 'happy', 'fresh'], cwd=ROOT,
                   env=dict(os.environ, GI_OUTPUT=str(output)), check=True)
    subprocess.run([sys.executable, '-B', str(HERE / 'audit.py'), '--run', str(output / 'fresh'), '--output', str(output / 'audit.json')], cwd=ROOT, check=True)

if __name__ == '__main__':
    main()
