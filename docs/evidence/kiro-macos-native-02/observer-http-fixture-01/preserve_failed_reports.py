#!/usr/bin/env python3
"""One CreateNew preservation of completed, self-owned failed test reports."""
import hashlib
import json
import os
from pathlib import Path
import stat

HERE = Path(__file__).resolve().parent
SOURCES = {
    'pure': Path('/private/tmp/axiom-pure-audit.kHr4ztJX'),
    'network': Path('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-http-independent-l5oxb1b0'),
}
DEST = HERE / 'failed-reports'
PER_FILE = 2 * 1024 * 1024
TOTAL = 4 * 1024 * 1024


def read_regular(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > PER_FILE:
            raise RuntimeError('unexpected file: ' + str(path))
        data = stream.read(PER_FILE + 1)
        after = os.fstat(stream.fileno())
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)
        if identity(before) != identity(after) or len(data) != before.st_size:
            raise RuntimeError('unstable source: ' + str(path))
    return data


def main():
    DEST.mkdir(mode=0o700)
    rows = []
    skipped = []
    total = 0
    for label, root in SOURCES.items():
        for directory, dirs, names in os.walk(str(root), followlinks=False):
            for name in dirs:
                if (Path(directory) / name).is_symlink():
                    raise RuntimeError('symlink directory')
            for name in sorted(names):
                source = Path(directory) / name
                relative = source.relative_to(root)
                if str(relative) == 'certificate/key.pem' or name == '.rnd':
                    skipped.append({'group': label, 'path': str(relative),
                                    'reason': 'self-generated fake private material not needed for public proof'})
                    continue
                data = read_regular(source)
                total += len(data)
                if total > TOTAL:
                    raise RuntimeError('total cap')
                target = DEST / label / relative
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fchmod(stream.fileno(), 0o400)
                if read_regular(target) != data:
                    raise RuntimeError('copy readback mismatch')
                rows.append({'group': label, 'source': str(source),
                             'path': str(target.relative_to(HERE)), 'bytes': len(data),
                             'sha256': hashlib.sha256(data).hexdigest()})
    manifest = {'status': 'passed_failed_fake_report_preservation_only',
                'officialRuns': 0, 'modelRequests': 0,
                'pureOriginalResult': '16 pass, 1 fail, runner exit1; reentrant body quota defect',
                'networkOriginalResult': 'control exit1 TLS SAN mismatch; preload not started; owner exit1',
                'files': rows, 'totalBytes': total, 'skipped': skipped}
    path = HERE / 'failed-report-preservation.json'
    with path.open('x', encoding='utf-8') as stream:
        json.dump(manifest, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    if json.loads(path.read_text()) != manifest:
        raise RuntimeError('manifest readback')
    print(json.dumps({'status': manifest['status'], 'files': len(rows), 'bytes': total,
                      'skipped': len(skipped)}))


if __name__ == '__main__':
    main()
