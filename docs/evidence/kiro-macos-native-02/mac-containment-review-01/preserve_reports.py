#!/usr/bin/python3
"""Preserve public-only static research, not a process-containment test."""
import hashlib
import json
from pathlib import Path
import stat

R = Path(__file__).resolve().parent


def main():
    out = R / 'preservation.json'
    if out.exists():
        raise SystemExit('CreateNew gate')
    inputs = [
        (Path('/tmp/axiom-coalition-public.UVw7tz'), R / 'sdk'),
        (Path('/tmp/axiom-coalition-oss.CYpBRH'), R / 'oss'),
        (Path('/tmp/kiro-env-static-HV1Fnl'), R.parent / 'v3-command-review-01/environment'),
    ]
    records = []
    for source, dest in inputs:
        assert source.is_dir() and not source.is_symlink()
        for p in sorted(source.rglob('*')):
            assert not p.is_symlink()
            if not p.is_file():
                continue
            data = p.read_bytes()
            assert len(data) <= 2 * 1024 * 1024
            to = dest / p.relative_to(source)
            if not to.exists():
                to.parent.mkdir(parents=True, exist_ok=True)
                with to.open('xb') as f:
                    f.write(data)
                to.chmod(0o400)
            assert to.is_file() and not to.is_symlink() and stat.S_IMODE(to.stat().st_mode) == 0o400 and to.read_bytes() == data
            records.append({'path': str(to.relative_to(R.parent)), 'source': str(p), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'copiedReadBack': True})
    result = {'status': 'passed_public_static_report_preservation_only', 'files': records, 'bytes': sum(x['bytes'] for x in records), 'officialExecutions': 0, 'modelRequests': 0, 'processApiTests': 0, 'networkRequests': 0, 'boundary': 'Saved research is not current-kernel version binding or runtime containment proof. No original investigation rerun.'}
    with out.open('x') as f:
        json.dump(result, f, indent=2)
        f.write('\n')
    print(json.dumps({'status': result['status'], 'files': len(records), 'bytes': result['bytes']}))


if __name__ == '__main__':
    main()
