#!/usr/bin/env python3
"""Seal completed public/browser evidence and preserve two local-only reports."""
import hashlib
import json
import os
from pathlib import Path
import stat

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TEMP = Path('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T')
REPORTS = {'sessioncreate': TEMP / 'sessioncreate-local01-9frpd3u9',
           'path-audit': TEMP / 'coalition-path-audit01-m86v4yqc'}


def read_regular(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        a = os.fstat(stream.fileno())
        if not stat.S_ISREG(a.st_mode) or a.st_size > 2 * 1024 * 1024:
            raise RuntimeError('regular-file cap')
        raw = stream.read(2 * 1024 * 1024 + 1)
        b = os.fstat(stream.fileno())
        if (a.st_dev, a.st_ino, a.st_size, a.st_mtime_ns) != (b.st_dev, b.st_ino, b.st_size, b.st_mtime_ns) or len(raw) != a.st_size:
            raise RuntimeError('unstable input')
    return raw


def main():
    destination = HERE / 'local-reports'
    destination.mkdir(mode=0o700)
    rows, copied = [], []

    def record(path, source=None):
        raw = read_regular(path)
        if sum(r['bytes'] for r in rows) + len(raw) > 24 * 1024 * 1024:
            raise RuntimeError('total cap')
        row = {'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
        if source:
            row['source'] = str(source)
            copied.append(row)
        rows.append(row)
        return raw

    def copy(source, target):
        raw = read_regular(source)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with target.open('xb') as stream:
            stream.write(raw)
            stream.flush()
            os.fchmod(stream.fileno(), 0o400)
        if record(target, source) != raw:
            raise RuntimeError('copy mismatch')

    for group, source in REPORTS.items():
        for path in sorted(source.iterdir()):
            if not path.is_file() or path.is_symlink():
                raise RuntimeError('unexpected report entry')
            copy(path, destination / group / path.name)
    inputs = [Path('/usr/share/man/man5/launchd.plist.5'),
              Path('/Library/Developer/CommandLineTools/SDKs/MacOSX13.3.sdk/System/Library/Frameworks/Security.framework/Versions/A/Headers/AuthSession.h')]
    expected = ['1c5f5041c1d3492988bfa6f9dc6d969dfd072d20af2703c28d9a8f6ed6aaadcb',
                'bae3953b5834e4966939d97a37f856dc4c291ff15b643dba718a724343ee9bc8']
    for path, digest in zip(inputs, expected):
        if hashlib.sha256(read_regular(path)).hexdigest() != digest:
            raise RuntimeError('local public document drift')
        copy(path, destination / 'installed-public-docs' / path.name)
    outcomes = []
    for number in range(1, 6):
        case = ROOT / ('mac-supervision-primitives-%02d' % number)
        for path in [case / 'EXPERIMENT.md', case / 'fetch_public_source.py'] + sorted((case / 'browser-results').iterdir()):
            record(path)
        manifest = json.loads(read_regular(case / 'browser-results/manifest.json'))
        if manifest['cleanup'].get('ok') is not True or manifest['modelRequests'] != 0 or manifest['officialRuns'] != 0:
            raise RuntimeError('cleanup or scope')
        outcomes.append({'case': number, 'requests': manifest['requests'], 'calls':
                         [{'label': r['label'], 'exit': r['exit'], 'timedOut': r['timedOut']} for r in manifest['calls']],
                         'error': manifest['error'], 'cleanup': manifest['cleanup']})
    if sum(len(x['requests']) for x in outcomes) != 9:
        raise RuntimeError('public request accounting')
    result = {'status': 'passed_completed_public_research_artifact_seal_only', 'files': rows,
              'totalBytes': sum(r['bytes'] for r in rows), 'newCopies': len(copied), 'outcomes': outcomes,
              'tasks': [{'taskId': 't11298', 'resultId': 'r11300'}, {'taskId': 't11305', 'resultId': 'r11306'}],
              'newNetworkRequests': 0, 'controlAPICalls': 0, 'modelRequests': 0,
              'limitations': 'Public pin is not host kernel; lease release is not stronger tab closure proof; no runtime authority/M3/parity claim'}
    output = HERE / 'preservation.json'
    with output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    if json.loads(read_regular(output)) != result:
        raise RuntimeError('manifest readback')
    print(json.dumps({'status': result['status'], 'files': len(rows), 'bytes': result['totalBytes'], 'newCopies': len(copied)}))


if __name__ == '__main__':
    main()
