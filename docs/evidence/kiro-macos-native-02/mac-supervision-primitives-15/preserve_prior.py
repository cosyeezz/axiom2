#!/usr/bin/env python3
"""Artifact-only, single CreateNew preservation; no tests or target reads."""
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import stat

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def read_stable(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > 2 * 1024 * 1024:
            raise ValueError('type/cap')
        raw = stream.read(2 * 1024 * 1024 + 1)
        after = os.fstat(stream.fileno())
    stable = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if stable(before) != stable(after) or len(raw) != before.st_size:
        raise ValueError('input changed')
    return raw


def main():
    a = Path('/tmp/new14-pure-independent.ZC1MrWVl')
    b = Path('/tmp/axiom-readback-p0t82s')
    ai, bi = a / 'SHA256SUMS.json', b / 'artifact-inventory.json'
    ar, br = read_stable(ai), read_stable(bi)
    am, bm = json.loads(ar), json.loads(br)
    a_names = {'EXPERIMENT.md', 'REPORT.md', 'after-locate_fixups.py', 'after.json', 'before.json', 'commands.txt', 'exit-status.txt', 'fixup-chains.h', 'frozen-locate_fixups.py', 'results.json', 'stderr.log', 'stdout.log', 'tests.py'}
    b_names = {'REPORT.md', 'command.txt', 'exit-code', 'input-inventory.json', 'results.json', 'stderr', 'stdout', 'verify.py'}
    if {r['path'] for r in am['files']} != a_names or len(am['files']) != 13 or am['totalBytesExcludingInventory'] != 191005:
        raise ValueError('pure inventory scope')
    if {Path(r['path']).name for r in bm['artifacts']} != b_names or len(bm['artifacts']) != 8 or any(Path(r['path']).parent != b for r in bm['artifacts']):
        raise ValueError('readback inventory scope')
    da, db = ROOT / 'mac-supervision-primitives-14/failed-pure', HERE / 'static-readback'
    if da.exists() or db.exists() or (HERE / 'prior-preservation.json').exists():
        raise ValueError('CreateNew occupied')
    da.mkdir(mode=0o700)
    db.mkdir(mode=0o700)
    copies, total = [], 0
    def copy(source, dest, expected=None):
        nonlocal total
        raw = read_stable(source)
        digest = hashlib.sha256(raw).hexdigest()
        if expected is not None and (len(raw) != expected['bytes'] or digest != expected['sha256']):
            raise ValueError('manifest mismatch')
        total += len(raw)
        if total > 4 * 1024 * 1024:
            raise ValueError('aggregate cap')
        with dest.open('xb') as stream:
            stream.write(raw)
            os.fchmod(stream.fileno(), 0o400)
        if read_stable(dest) != raw or stat.S_IMODE(dest.stat().st_mode) != 0o400:
            raise ValueError('copy readback')
        copies.append({'source': str(source), 'destination': str(dest.relative_to(ROOT)), 'bytes': len(raw), 'sha256': digest, 'mode': '0400'})
    for row in am['files']:
        copy(a / row['path'], da / row['path'], row)
    copy(ai, da / ai.name)
    for row in bm['artifacts']:
        copy(Path(row['path']), db / Path(row['path']).name, row)
    copy(bi, db / bi.name)
    p = json.loads(read_stable(da / 'results.json'))
    r = json.loads(read_stable(db / 'results.json'))
    if (p['cases'], p['passed'], p['failed']) != (325, 321, 4) or p['sourceSHA256'] != '4a2ae5b37edebb2b626bbadb354150d613476273f0ffa0b7e1b27f2fc4ec8ebc':
        raise ValueError('pure result binding')
    if r['summary']['checks'] != 119 or r['summary']['failed'] != 0 or len(r['checks']) != 119 or not all(x['pass'] is True for x in r['checks']):
        raise ValueError('readback binding')
    result = {'status': 'passed_artifact_preservation_only', 'copies': copies, 'fileCount': len(copies), 'bytes': total, 'pureFailureRetained': {'cases': 325, 'passed': 321, 'failed': 4, 'main14Ran': False}, 'readbackScope': r['summary'], 'newTestRuns': 0, 'targetRuns': 0, 'controlCalls': 0, 'modelRequests': 0}
    with (HERE / 'prior-preservation.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        os.fchmod(stream.fileno(), 0o400)
    print(json.dumps({'status': result['status'], 'files': len(copies), 'bytes': total, 'pureFailed': 4, 'readbackChecks': 119}))


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (5, 6))
    signal.alarm(15)
    main()
