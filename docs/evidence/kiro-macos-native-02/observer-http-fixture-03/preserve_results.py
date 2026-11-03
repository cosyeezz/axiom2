#!/usr/bin/env python3
"""Preserve completed fake-only 03 tests, including both real failures."""
import hashlib
import json
import os
from pathlib import Path
import stat

HERE = Path(__file__).resolve().parent
TEMP = Path('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T')
SOURCES = {
    'consumer': TEMP / 'axiom-http-consumer03-independent-whgrmibk',
    'runtime-failed': TEMP / 'axiom-http03-runtime-mt4hqtn7',
    'runtime-fixed': TEMP / 'axiom-http03-runtime-fixed-x0r2w6my',
}
DEST = HERE / 'reports'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def read_regular(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= 2 * 1024 * 1024, 'file type/cap')
        data = stream.read(2 * 1024 * 1024 + 1)
        after = os.fstat(stream.fileno())
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)
        require(identity(before) == identity(after) and len(data) == before.st_size, 'unstable file')
    return data


def load(path):
    return json.loads(read_regular(path))


def main():
    DEST.mkdir(mode=0o700)
    rows, skipped = [], []
    total = 0
    for group, source in SOURCES.items():
        for directory, dirs, names in os.walk(str(source), followlinks=False):
            for name in list(dirs):
                path = Path(directory) / name
                require(not path.is_symlink(), 'symlink directory')
                if name in ['home', 'owner-home', '__pycache__']:
                    dirs.remove(name)
                    skipped.append({'group': group, 'path': str(path.relative_to(source)), 'reason': 'own cache'})
            for name in sorted(names):
                path = Path(directory) / name
                if name.endswith('.pyc') or name in ['key.pem', '.rnd']:
                    skipped.append({'group': group, 'path': str(path.relative_to(source)), 'reason': 'cache/private fake'})
                    continue
                data = read_regular(path)
                total += len(data)
                require(total <= 4 * 1024 * 1024, 'total cap')
                target = DEST / group / path.relative_to(source)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fchmod(stream.fileno(), 0o400)
                require(read_regular(target) == data, 'copy readback')
                rows.append({'source': str(path), 'path': str(target.relative_to(HERE)),
                             'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    summary = load(DEST / 'consumer/summary.json')
    require(summary['unchanged'] is True and summary['before'] == summary['after'], 'consumer identities')
    require([(r['label'], r['total'], r['passed'], r['failed'], r['exit_code']) for r in summary['results']] ==
            [('py39', 270, 270, 0, 0), ('host314', 270, 269, 1, 1)], 'retain depth difference')
    require(summary['results'][1]['failures'] == [{'name': 'json_depth', 'pass': False, 'outcome': 'accepted'}],
            'original consumer failure changed')
    startup = load(DEST / 'runtime-failed/progress.json')
    require([r['case'] for r in startup] == ['missingguard', 'existingtrace'], 'startup cases')
    require(all(r['pass'] is True and r['exit'] == 1 and r['terminalPresent'] is False
                and all(v is True for v in r['EOF'].values()) for r in startup), 'startup rejection')
    require(b'JSONDecodeError' in read_regular(DEST / 'runtime-failed/main.log'), 'original injection failure')
    fixed = load(DEST / 'runtime-fixed/report.json')
    require(fixed['pass'] is True and fixed['sourceBefore'] == fixed['sourceAfter'], 'fixed report/source')
    require([r['case'] for r in fixed['results']] ==
            ['writerfault', 'bodycap', 'eventcap', 'logcap', 'childhang', 'earlylate'], 'fixed cases')
    require(all(r['pass'] is True and r['checks'] and all(v is True for v in r['checks'])
                and all(v is True for v in r['EOF'].values()) for r in fixed['results']), 'fixed checks/EOF')
    for record in fixed['results'][:4]:
        require(record['exit'] == 0 and record['terminal']['ok'] is False
                and record['terminal']['pendingBodyBytes'] == 0
                and record['consumer'] == 'rejected: observer failure', 'failed capture consumed')
        api = record['API']
        require(api['N'] == api['received'] == api['callbacks'] == api['responses'] == api['returns']
                and api['errors'] == [], 'original API completion')
    for record in fixed['results'][4:]:
        require(record['exit'] == -9 and record['killed'] is True
                and 'parent-deadline' in record['ownerReasons'], 'deadline candidate consumed')
    result = {'status': 'passed_completed_fake_report_preservation_only', 'files': rows,
              'totalBytes': total, 'skipped': skipped, 'officialRuns': 0, 'newNetworkRuns': 0,
              'consumer270': 'py39 exit0, host314 exit1 json_depth; not full-schema bypass',
              'runtime': '2 startup rejections + 6 new branches; original FD-reuse injection failure retained',
              'limitations': 'No sandbox/full tree/M3; synthetic early/late checked after reap, not live-window proof'}
    path = HERE / 'preservation.json'
    with path.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    require(load(path) == result, 'manifest readback')
    print(json.dumps({'status': result['status'], 'files': len(rows), 'bytes': total, 'skipped': len(skipped)}))


if __name__ == '__main__':
    main()
