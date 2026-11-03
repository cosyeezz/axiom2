#!/usr/bin/env python3
"""Copy only ended t11335 synthetic test artifacts and clone failed source."""
import hashlib
import json
import os
from pathlib import Path
import resource
import signal

HERE = Path(__file__).resolve().parent
OLD = HERE.parent / 'mac-supervision-primitives-09'
SOURCE = Path('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/locator09-pure-memhbuni')
EXPECTED = 'df44a752188034485fbcd712d650915d62396ceb29903f5640d2ff72ea9a98d4'


def main():
    out = OLD / 'failed-reports'
    out.mkdir(mode=0o700)
    manifest = json.loads((SOURCE / 'artifact-manifest.json').read_text())
    expected = {r['name']: r['sha256'] for r in manifest['artifacts']}
    names = {p.name for p in SOURCE.iterdir()}
    if names != set(expected) | {'artifact-manifest.json'}:
        raise ValueError('inventory mismatch')
    rows = []
    for name in sorted(names):
        if Path(name).name != name:
            raise ValueError('basename')
        raw = (SOURCE / name).read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        if len(raw) > 128 * 1024 or (name in expected and sha != expected[name]):
            raise ValueError('artifact cap/hash')
        target = out / name
        with target.open('xb') as stream:
            stream.write(raw)
            os.fchmod(stream.fileno(), 0o400)
        if target.read_bytes() != raw:
            raise ValueError('copy readback')
        rows.append({'name': name, 'bytes': len(raw), 'sha256': sha, 'mode': '0400'})
    old = (OLD / 'locate_bootout.py').read_bytes()
    if hashlib.sha256(old).hexdigest() != EXPECTED or (out / 'source.py').read_bytes() != old:
        raise ValueError('failed source not retained exactly')
    with (HERE / 'locate_bootout.py').open('xb') as stream:
        stream.write(old)
    if sum(r['bytes'] for r in rows) > 256 * 1024:
        raise ValueError('total cap')
    result = {'taskId': 't11335', 'resultId': 'r11336', 'status': 'artifact_copy_passed_original_tests_failed', 'originalCases': 128, 'originalPassed': 126, 'originalFailed': 2, 'originalExit': 1, 'files': rows, 'bytes': sum(r['bytes'] for r in rows), 'originalSourceSHA256': EXPECTED, 'clonedSourceRequiresMainFixBeforeUse': True, 'targetRuns': 0, 'modelRequests': 0}
    with (HERE / 'failure-preservation.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        os.fchmod(stream.fileno(), 0o400)
    print(json.dumps({'status': result['status'], 'files': len(rows), 'bytes': result['bytes']}))


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (3, 4))
    signal.alarm(10)
    main()
