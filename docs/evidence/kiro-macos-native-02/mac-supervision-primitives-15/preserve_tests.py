#!/usr/bin/env python3
"""Preserve completed independent reports; never rerun a test or locator."""
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import stat

HERE = Path(__file__).resolve().parent
EXPECTED = 'ef7b3d8bebf172b1363f8cea0217cc0e799b590ad9e75f3ba330061514934b68'


def read(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        a = os.fstat(stream.fileno())
        if not stat.S_ISREG(a.st_mode) or a.st_size > 2 * 1024 * 1024:
            raise ValueError('input type/cap')
        raw = stream.read(2 * 1024 * 1024 + 1)
        b = os.fstat(stream.fileno())
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if identity(a) != identity(b) or len(raw) != a.st_size:
        raise ValueError('input changed')
    return raw


def main():
    out = HERE / 'test-reports'
    result_path = HERE / 'tests-preservation.json'
    if out.exists() or result_path.exists():
        raise ValueError('CreateNew occupied')
    if hashlib.sha256(read(HERE / 'locate_fixups.py')).hexdigest() != EXPECTED:
        raise ValueError('source changed since tests')
    sources = [
        (Path('/private/tmp/new15-independent-dd3vapff'), 'SHA256SUMS.json', 'original325', 19, 194369),
        (Path('/tmp/new15-independent-guards.87WKS3WO'), 'inventory.json', 'focused-guards', 71, 184313),
    ]
    out.mkdir(mode=0o700)
    copies, total = [], 0
    for origin, inventory_name, group, count, byte_count in sources:
        inventory_raw = read(origin / inventory_name)
        rows = json.loads(inventory_raw)['files']
        if len(rows) != count or sum(r['bytes'] for r in rows) != byte_count or len({r['path'] for r in rows}) != count:
            raise ValueError('inventory binding')
        dest_root = out / group
        dest_root.mkdir(mode=0o700)
        items = rows + [{'path': inventory_name, 'bytes': len(inventory_raw), 'sha256': hashlib.sha256(inventory_raw).hexdigest()}]
        for item in items:
            rel = Path(item['path'])
            if rel.is_absolute() or any(p in ('', '.', '..') for p in rel.parts) or len(rel.parts) > 2 or (len(rel.parts) == 2 and rel.parts[0] != 'fixtures'):
                raise ValueError('artifact path scope')
            raw = read(origin / rel)
            digest = hashlib.sha256(raw).hexdigest()
            if len(raw) != item['bytes'] or digest != item['sha256']:
                raise ValueError('artifact hash/size')
            total += len(raw)
            if total > 4 * 1024 * 1024:
                raise ValueError('total cap')
            dest = dest_root / rel
            dest.parent.mkdir(mode=0o700, exist_ok=True)
            with dest.open('xb') as stream:
                stream.write(raw)
                os.fchmod(stream.fileno(), 0o400)
            if read(dest) != raw or stat.S_IMODE(dest.stat().st_mode) != 0o400:
                raise ValueError('copy readback')
            copies.append({'source': str(origin / rel), 'destination': str(dest.relative_to(HERE)), 'bytes': len(raw), 'sha256': digest, 'mode': '0400'})
    a = json.loads(read(out / 'original325/results.json'))
    b = json.loads(read(out / 'focused-guards/results.json'))
    if (a['cases'], a['passed'], a['failed']) != (325, 325, 0) or (b['total'], b['passed'], b['failed']) != (63, 63, 0):
        raise ValueError('test result counts')
    if a['sourceSHA256'] != EXPECTED or b['sourceSHA256'] != EXPECTED or len(copies) != 92 or total != 395360:
        raise ValueError('source/aggregate binding')
    m = json.loads(read(HERE / 'results/manifest.json'))
    pre = json.loads(read(HERE / 'results/preflight.json'))
    if not all(m[k] == v for k, v in pre.items()) or (m['entryCount'], m['bindCount'], m['rebaseCount']) != (2396, 936, 1460) or m['targetReferences'] != [] or m['localContext'] != []:
        raise ValueError('locator readback')
    expected_stdout = json.dumps({'status': m['status'], 'entries': m['entryCount'], 'targetReferences': []}) + '\n'
    if read(HERE / 'main.exit') != b'0\n' or read(HERE / 'main.stderr') != b'' or read(HERE / 'main.stdout') != expected_stdout.encode():
        raise ValueError('original main streams')
    sealed = []
    for name in ['locate_fixups.py', 'EXPERIMENT.md', 'main.exit', 'main.stdout', 'main.stderr', 'main-workdir.txt', 'results/preflight.json', 'results/manifest.json', 'results/fixup-chains-sdk13.h', 'preserve_tests.py']:
        raw = read(HERE / name)
        sealed.append({'path': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    result = {'status': 'passed_test_artifact_preservation_and_main_readback_only', 'sourceSHA256': EXPECTED, 'fileCount': len(copies), 'bytes': total, 'copies': copies, 'sealedMainAndSource': sealed, 'original325': {'cases': 325, 'passed': 325, 'failed': 0}, 'focused': {'outcomes': 63, 'fixtureCalls': 51, 'uniqueFixtureInputs': 48, 'passed': 63, 'failed': 0}, 'coverageCountsNotAdditive': True, 'mainReadback': {'status': m['status'], 'entries': 2396, 'binds': 936, 'rebases': 1460, 'targetReferences': []}, 'newTestRuns': 0, 'newLocatorRuns': 0, 'targetRuns': 0, 'controlCalls': 0, 'modelRequests': 0}
    with result_path.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        os.fchmod(stream.fileno(), 0o400)
    print(json.dumps({'status': result['status'], 'files': len(copies), 'bytes': total, 'sealed': len(sealed), 'mainRefs': 0}))


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (5, 6))
    signal.alarm(15)
    main()
