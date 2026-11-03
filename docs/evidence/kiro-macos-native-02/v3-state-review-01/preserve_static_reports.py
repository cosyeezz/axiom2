#!/usr/bin/python3
"""Preserve explicit public/static TEMP artifacts. Never reads an installed target."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
    ('/tmp/kiro-engine-choice-ro-8t2mppbc', 'v3-engine-choice-01', r'(xref|review)\.json|(?:saved|setting)\.(?:asm|macho)'),
    ('/tmp/kiro-engine-callee-ro-txu_yhcx', 'v3-engine-callee-01', r'(?:boundary|identity|verification)\.json|REPORT\.md|callee\.(?:asm|macho)|caller-existing-512B\.asm'),
    ('/tmp/kiro-engine-key-default-failure-iujglhu6', 'v3-engine-key-default-01-failure', r'REPORT\.md|verification\.json'),
    ('/tmp/kiro-v3-selector-CzBiwc', 'v3-tui-resource-01', r'REPORT\.md|command\.json|asm\.txt|(?:thin-)?constants\.json|thin-hash\.json|stderr\.txt'),
    ('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kas-transport-static-nob92r2l', 'v3-kas-review-01/transport', r'(?:extra-)?index\.json|(?:evidence|REPORT)\.md|(?:focus|hits)\.txt|window-\d\d\.txt|extra-\d+\.txt'),
]


def identity(s):
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns


def main():
    marker = ROOT / 'v3-state-review-01/STATIC_PRESERVATION_STARTED.json'
    with marker.open('x') as f:
        json.dump({'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, f)
    entries, total = [], 0
    for source, destination, pattern in SOURCES:
        src, dst = Path(source), ROOT / destination
        dst.mkdir(parents=True, exist_ok=True)
        names = sorted(p.name for p in src.iterdir() if re.fullmatch(pattern, p.name))
        if len(names) < 2:
            raise RuntimeError('missing-source-artifacts')
        for name in names:
            p = src / name
            fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                before = os.fstat(fd)
                if not stat.S_ISREG(before.st_mode) or not 0 <= before.st_size <= 512 * 1024:
                    raise RuntimeError('type-or-file-cap')
                b = os.read(fd, before.st_size + 1)
                if len(b) != before.st_size or identity(before) != identity(os.fstat(fd)):
                    raise RuntimeError('source-drift-or-short-read')
            finally:
                os.close(fd)
            total += len(b)
            if total > 2 * 1024 * 1024:
                raise RuntimeError('total-cap')
            target = dst / name
            with target.open('xb') as f:
                if f.write(b) != len(b):
                    raise RuntimeError('short-write')
            target.chmod(0o400)
            digest = hashlib.sha256(b).hexdigest()
            if target.read_bytes() != b or stat.S_IMODE(target.stat().st_mode) != 0o400:
                raise RuntimeError('readback-or-mode')
            entries.append({'source': str(p), 'destination': str(target.relative_to(ROOT)), 'bytes': len(b), 'sha256': digest})
    out = {'status': 'passed_public_static_artifact_preservation_only', 'files': len(entries), 'bytes': total, 'installedTargetReads': 0, 'cliExecutions': 0, 'modelRequests': 0, 'entries': entries, 'boundary': 'Old 2.35.1 frozen evidence; rejected live-offset constants remain explicitly rejected. Not current 2.35.2 evidence or runtime parity.'}
    with (ROOT / 'v3-state-review-01/preserved-static-manifest.json').open('x') as f:
        json.dump(out, f, indent=2)
        f.write('\n')
    print(json.dumps({k: out[k] for k in ('status', 'files', 'bytes', 'installedTargetReads', 'cliExecutions', 'modelRequests')}))


if __name__ == '__main__':
    main()
