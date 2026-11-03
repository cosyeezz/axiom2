#!/usr/bin/env python3
"""Preserve the ended timeout experiment without retrying its requests."""
import hashlib
import json
import os
from pathlib import Path
import stat

HERE = Path(__file__).resolve().parent
SOURCE = Path('/private/tmp/mac-coalition-wrapper-01.My9vN0BP')


def read_regular(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > 1024 * 1024:
            raise RuntimeError('file cap/type')
        raw = stream.read(1024 * 1024 + 1)
        after = os.fstat(stream.fileno())
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or len(raw) != before.st_size:
            raise RuntimeError('unstable file')
    return raw


def main():
    target_root = HERE / 'reports'
    target_root.mkdir(mode=0o700)
    rows = []
    for directory, dirs, files in os.walk(str(SOURCE), followlinks=False):
        dirs[:] = [n for n in dirs if n not in ['home', 'tmp', '__pycache__']]
        if any((Path(directory) / n).is_symlink() for n in dirs):
            raise RuntimeError('symlink directory')
        for name in sorted(files):
            source = Path(directory) / name
            data = read_regular(source)
            if sum(r['bytes'] for r in rows) + len(data) > 1024 * 1024:
                raise RuntimeError('total cap')
            target = target_root / source.relative_to(SOURCE)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with target.open('xb') as stream:
                stream.write(data)
                stream.flush()
                os.fchmod(stream.fileno(), 0o400)
            if read_regular(target) != data:
                raise RuntimeError('copy mismatch')
            rows.append({'source': str(source), 'path': str(target.relative_to(HERE)), 'bytes': len(data),
                         'sha256': hashlib.sha256(data).hexdigest()})
    manifest = json.loads(read_regular(target_root / 'manifest.json'))
    if manifest['request_count'] != 2 or len(manifest['requests']) != 2:
        raise RuntimeError('request count')
    for request in manifest['requests']:
        if (request['curl_exit'], request['http_status'], request['body_bytes'], request['complete']) != (28, '000', 0, False):
            raise RuntimeError('request outcome')
        for field in ['body_file', 'headers_file']:
            if read_regular(target_root / request[field]) != b'':
                raise RuntimeError('expected empty body/header')
        if b'curl: (28)' not in read_regular(target_root / request['stderr_file']):
            raise RuntimeError('missing original curl error')
    result = {'status': 'passed_failed_experiment_artifact_readback_only', 'files': rows,
              'bytes': sum(r['bytes'] for r in rows), 'newNetworkRequests': 0,
              'outcome': 'two connection timeouts/no HTTP response/no source; no third request/pin',
              'authorizationSemantics': 'unverified', 'hostControlCalls': 0, 'modelRequests': 0}
    with (HERE / 'preservation.json').open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    if json.loads(read_regular(HERE / 'preservation.json')) != result:
        raise RuntimeError('manifest readback')
    print(json.dumps({'status': result['status'], 'files': len(rows), 'bytes': result['bytes']}))


if __name__ == '__main__':
    main()
