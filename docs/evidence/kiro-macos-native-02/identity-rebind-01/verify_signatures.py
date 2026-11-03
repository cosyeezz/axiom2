#!/usr/bin/python3
"""Four bounded local codesign operations; never runs an official executable."""
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import stat
import subprocess
import time

HERE = Path(__file__).resolve().parent
CAP = 65536
POLICY = '(version 1)(allow default)(deny network*)(deny file-write*)(deny file-read* (subpath "/Users/dane"))(deny mach-lookup (global-name "com.apple.securityd"))'


def identity(s):
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns


def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_FSIZE, (CAP, CAP))


def main():
    out = HERE / 'signatures-01'
    out.mkdir()  # CreateNew; no rerun over prior evidence.
    meta = json.loads((HERE / 'verification.json').read_text())
    if meta['status'] != 'passed_static_snapshot_identity_only':
        raise RuntimeError('snapshot-not-verified')
    (out / 'RUN_STARTED.json').write_text(json.dumps({'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'policy': POLICY}) + '\n')
    results = []
    for target in meta['inputs']:
        path = Path(target['snapshot'])
        before = os.stat(path, follow_symlinks=False)
        if not stat.S_ISREG(before.st_mode) or stat.S_IMODE(before.st_mode) != 0o400 or before.st_size != target['bytes']:
            raise RuntimeError('snapshot-state')
        for kind, args in [('verify', ['--verify', '--strict', '--verbose=2']), ('display-arm64', ['--display', '--verbose=4', '--architecture', 'arm64'])]:
            label = path.name + '-' + kind
            stdout, stderr = out / (label + '.stdout'), out / (label + '.stderr')
            policy = POLICY + '(allow file-write-data (literal ' + json.dumps(str(stdout)) + ') (literal ' + json.dumps(str(stderr)) + '))'
            argv = ['/usr/bin/sandbox-exec', '-p', policy, '/usr/bin/codesign', *args, str(path)]
            start = time.monotonic()
            timed_out, code = False, None
            with stdout.open('xb') as so, stderr.open('xb') as se:
                process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=so, stderr=se, cwd=str(path.parent), env={'HOME': '/var/empty', 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL': 'C'}, preexec_fn=limits)
                try:
                    code = process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    timed_out = True
                    process.kill()
                    code = process.wait()
            stdout.chmod(0o400)
            stderr.chmod(0o400)
            b1, b2 = stdout.read_bytes(), stderr.read_bytes()
            text = (b1 + b'\n' + b2).decode('utf8', 'replace')
            stable = identity(os.stat(path, follow_symlinks=False)) == identity(before)
            cdhash = re.search(r'^CDHash=([0-9a-f]{40})$', text, re.M)
            team = re.search(r'^TeamIdentifier=(\S+)$', text, re.M)
            identifier = re.search(r'^Identifier=(\S+)$', text, re.M)
            entry = {'kind': kind, 'argv': argv, 'targetSha256': target['sha256'], 'exitCode': code, 'timedOut': timed_out, 'wallSeconds': time.monotonic() - start, 'snapshotStatStable': stable, 'stdoutBytes': len(b1), 'stderrBytes': len(b2), 'stdoutSha256': hashlib.sha256(b1).hexdigest(), 'stderrSha256': hashlib.sha256(b2).hexdigest(), 'CDHash': cdhash.group(1) if cdhash else None, 'TeamIdentifier': team.group(1) if team else None, 'Identifier': identifier.group(1) if identifier else None}
            entry['passed'] = code == 0 and not timed_out and stable and len(b1) < CAP and len(b2) < CAP
            if kind == 'display-arm64':
                entry['passed'] = entry['passed'] and entry['TeamIdentifier'] == '94KV3E626L' and entry['Identifier'] == Path(target['source']).name and entry['CDHash'] is not None
            results.append(entry)
    passed = len(results) == 4 and all(r['passed'] for r in results)
    report = {'status': 'passed_local_signature_snapshot_only' if passed else 'failed_or_unverified_local_signature', 'results': results, 'officialCliExecutions': 0, 'modelRequests': 0, 'authStorageReads': 0, 'networkPolicy': 'deny network*', 'boundary': 'Local static signatures, not Gatekeeper/notarization, origin URL, loaded-image identity, effective engine, runtime sender or parity.'}
    (out / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    if not passed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
