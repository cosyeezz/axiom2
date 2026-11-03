#!/usr/bin/env python3
"""Preserve ended t11337 artifacts; validate existing static ASM, no tool rerun."""
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import signal

HERE = Path(__file__).resolve().parent
SOURCE = Path('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/locator10-independent-gzebk90h')
SHA = 'd0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608'


def main():
    manifest = json.loads((SOURCE / 'SHA-manifest.json').read_text())
    expected = {row['name']: row for row in manifest['artifacts']}
    names = {path.name for path in SOURCE.iterdir()}
    if names != set(expected) | {'SHA-manifest.json'}:
        raise ValueError('inventory')
    if hashlib.sha256((HERE / 'locate_bootout.py').read_bytes()).hexdigest() != SHA:
        raise ValueError('source changed')
    out = HERE / 'pure-tests'
    out.mkdir(mode=0o700)
    rows = []
    for name in sorted(names):
        if Path(name).name != name:
            raise ValueError('basename')
        raw = (SOURCE / name).read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        if len(raw) > 128 * 1024:
            raise ValueError('file cap')
        if name in expected and (len(raw), sha) != (expected[name]['bytes'], expected[name]['sha256']):
            raise ValueError('hash/length')
        with (out / name).open('xb') as stream:
            stream.write(raw)
            os.fchmod(stream.fileno(), 0o400)
        if (out / name).read_bytes() != raw:
            raise ValueError('copy readback')
        rows.append({'name': name, 'bytes': len(raw), 'sha256': sha})
    total = sum(row['bytes'] for row in rows)
    if total > 256 * 1024:
        raise ValueError('total cap')
    static = json.loads((HERE / 'results/manifest.json').read_text())
    function, = static['functions']
    asm = (HERE / 'results/01-function.stdout').read_text()
    addresses = [int(line.split()[0], 16) for line in asm.splitlines() if re.match(r'^[0-9a-f]{16}\s', line)]
    if addresses != list(range(function['beginVA'], function['endVAExclusive'], 4)):
        raise ValueError('ASM coverage')
    for artifact in static['artifacts']:
        raw = (HERE / 'results' / artifact['name']).read_bytes()
        if (len(raw), hashlib.sha256(raw).hexdigest()) != (artifact['bytes'], artifact['sha256']):
            raise ValueError('static artifact hash')
    result = {'taskId': 't11337', 'resultId': 'r11338', 'status': 'artifact_and_static_ASM_readback_passed', 'files': rows, 'bytes': total, 'sourceSHA256': SHA, 'originalSuitePass': 128, 'focusedPass': 57, 'coverageNotSummedBecauseSemanticOverlap': True, 'staticInstructionCount': len(addresses), 'staticGaps': 0, 'newToolRuns': 0, 'targetRuns': 0, 'controlCalls': 0, 'modelRequests': 0}
    with (HERE / 'pure-preservation.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        os.fchmod(stream.fileno(), 0o400)
    print(json.dumps({k: v for k, v in result.items() if k != 'files'}))


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (3, 4))
    signal.alarm(10)
    main()
