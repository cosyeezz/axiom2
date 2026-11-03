#!/usr/bin/env python3
"""CreateNew retention of the completed t11371 audit, including both harness failures."""
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import stat

HERE = Path(__file__).resolve().parent
ORIGIN = Path('/tmp/new15-doc-artifact-audit.KtYynqpE')


def read(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        a = os.fstat(stream.fileno())
        if not stat.S_ISREG(a.st_mode) or a.st_size > 128 * 1024:
            raise ValueError('type/cap')
        raw = stream.read(128 * 1024 + 1)
        b = os.fstat(stream.fileno())
    ident = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if ident(a) != ident(b) or len(raw) != a.st_size:
        raise ValueError('changed input')
    return raw


def main():
    out, manifest = HERE / 'prior-readback', HERE / 'prior-preservation.json'
    if out.exists() or manifest.exists():
        raise ValueError('CreateNew occupied')
    inventory_raw = read(ORIGIN / 'artifact-SHA256.json')
    inventory = json.loads(inventory_raw)
    if len(inventory) != 21 or sum(v['bytes'] for v in inventory.values()) != 193704:
        raise ValueError('inventory binding')
    items = dict(inventory)
    items['artifact-SHA256.json'] = {'bytes': len(inventory_raw), 'sha256': hashlib.sha256(inventory_raw).hexdigest()}
    out.mkdir(mode=0o700)
    copies, total = [], 0
    for name, row in items.items():
        if Path(name).name != name or name in ('.', '..'):
            raise ValueError('artifact path')
        raw = read(ORIGIN / name)
        sha = hashlib.sha256(raw).hexdigest()
        if len(raw) != row['bytes'] or sha != row['sha256']:
            raise ValueError('artifact hash/size')
        total += len(raw)
        if total > 2 * 1024 * 1024:
            raise ValueError('total cap')
        dest = out / name
        with dest.open('xb') as stream:
            stream.write(raw)
            os.fchmod(stream.fileno(), 0o400)
        if read(dest) != raw or stat.S_IMODE(dest.stat().st_mode) != 0o400:
            raise ValueError('copy readback')
        copies.append({'source': str(ORIGIN / name), 'destination': str(dest.relative_to(HERE)), 'bytes': len(raw), 'sha256': sha, 'mode': '0400'})
    checks = json.loads(read(out / 'checks.json'))
    if len(copies) != 22 or total != 196430 or len(checks) != 224 or not all(x['pass'] is True for x in checks):
        raise ValueError('aggregate/result binding')
    for name, expected in [('attempt1-verifier.exit', b'1\n'), ('attempt2-verifier.exit', b'1\n'), ('verifier.exit', b'0\n')]:
        if read(out / name) != expected:
            raise ValueError('original verifier exits')
    result = {'status': 'passed_prior_artifact_preservation_only', 'fileCount': len(copies), 'bytes': total, 'copies': copies, 'priorCheckCount': 224, 'priorPassed': 224, 'priorFailed': 0, 'priorHarnessFailedAttemptsRetained': 2, 'newVerifierRuns': 0, 'newLocatorRuns': 0, 'targetRuns': 0, 'controlCalls': 0, 'modelRequests': 0}
    with manifest.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        os.fchmod(stream.fileno(), 0o400)
    print(json.dumps({'status': result['status'], 'files': len(copies), 'bytes': total, 'checks': len(checks)}))


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (5, 6))
    signal.alarm(15)
    main()
