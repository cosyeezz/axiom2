#!/usr/bin/env python3
"""One sandboxed public help invocation; never opens real settings or credentials."""
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import signal
import stat
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent
LIMIT = 64 * 1024
LAUNCHER = Path('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli')
CHAT = Path('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat')
EXPECTED = {
    LAUNCHER: (73432992, '8e242d795f93a70bc4497907d9aaf2d1552a07ee8a7a86e0276af6cf55672fd2'),
    CHAT: (413051920, '7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f'),
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def stamp(s):
    return [s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns]


def save(path, value):
    raw = (json.dumps(value, indent=2, ensure_ascii=True) + '\n').encode()
    with path.open('xb') as f:
        f.write(raw)
    return raw


def child_bounds():
    resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
    resource.setrlimit(resource.RLIMIT_FSIZE, (LIMIT, LIMIT))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


def sb_string(value):
    return json.dumps(str(value), ensure_ascii=True)


def main():
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024 * 1024, 2 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    signal.alarm(30)
    out = ROOT / 'results'
    out.mkdir(mode=0o700, exist_ok=False)
    held = []
    child = None
    try:
        identities = []
        for path, (size, expected_sha) in EXPECTED.items():
            fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
            held.append(fd)
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_size != size:
                raise ValueError('public binary type/size changed: ' + path.name)
            h = hashlib.sha256()
            count = 0
            while count < size:
                chunk = os.read(fd, min(1024 * 1024, size - count))
                if not chunk:
                    raise ValueError('public binary short read')
                count += len(chunk)
                h.update(chunk)
            if os.read(fd, 1) or stamp(before) != stamp(os.fstat(fd)):
                raise ValueError('public binary changed during hash')
            if stamp(path.stat()) != stamp(before) or path.is_symlink():
                raise ValueError('public binary path changed')
            actual_sha = h.hexdigest()
            if actual_sha != expected_sha:
                raise ValueError('public binary SHA changed: ' + path.name)
            identities.append({'path': str(path), 'bytes': size, 'sha256': actual_sha,
                               'before': stamp(before)})

        namespace = Path(tempfile.mkdtemp(prefix='kiro-request-help01-')).resolve()
        home, tmp = namespace / 'home', namespace / 'tmp'
        home.mkdir(mode=0o700)
        tmp.mkdir(mode=0o700)
        profile = namespace / 'help.sb'
        policy = '\n'.join([
            '(version 1)',
            '(allow default)',
            '(deny network*)',
            '(deny mach-lookup)',
            '(deny file-read* (subpath "/Users/dane"))',
            '(deny file-write*)',
            '(allow file-write* (subpath ' + sb_string(namespace) + '))',
            '(deny process-exec)',
            '(allow process-exec (literal ' + sb_string(LAUNCHER) + ') (literal ' + sb_string(CHAT) + '))',
            '',
        ])
        with profile.open('x') as f:
            f.write(policy)
        with (out / 'sandbox-profile.sb').open('x') as f:
            f.write(policy)
        env = {'HOME': str(home), 'TMPDIR': str(tmp), 'PATH': '/usr/bin:/bin:' + str(LAUNCHER.parent),
               'LANG': 'C', 'LC_ALL': 'C', 'TERM': 'dumb'}
        argv = ['/usr/bin/sandbox-exec', '-f', str(profile), str(LAUNCHER), 'chat', '--help']
        preflight = {
            'driverSHA256': digest(Path(__file__).read_bytes()),
            'inputs': identities, 'namespace': str(namespace), 'cwd': str(namespace),
            'argv': argv, 'environment': env, 'sandboxSHA256': digest(policy.encode()),
            'scope': 'one offline official chat-help; no request/engine/auth/parity inference',
            'expectedModelForFutureComparison': 'deepseek-3.2',
            'modelPrompts': 0, 'modelRequests': 0, 'credentialStoreReadsByDriver': 0,
            'budget': {'parentCPUSeconds': 10, 'parentWallSeconds': 30,
                       'childCPUSeconds': 2, 'childWallSeconds': 5,
                       'perStreamBytes': LIMIT, 'combinedStreamBytes': 2 * LIMIT,
                       'resultTotalBytes': 2 * 1024 * 1024},
        }
        save(out / 'preflight.json', preflight)
        started = time.monotonic()
        timed_out = False
        with (out / 'help.stdout').open('xb') as stdout, (out / 'help.stderr').open('xb') as stderr:
            child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                     cwd=namespace, env=env, preexec_fn=child_bounds, close_fds=True)
            pid = child.pid
            try:
                exit_code = child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                timed_out = True
                child.kill()
                exit_code = child.wait(timeout=2)
        wall = time.monotonic() - started
        streams = {}
        for name in ['help.stdout', 'help.stderr']:
            with (out / name).open('rb') as f:
                raw = f.read(LIMIT + 1)
            if len(raw) > LIMIT:
                raise ValueError('help stream exceeded byte cap')
            streams[name] = raw
        after = []
        unchanged = True
        for row, fd in zip(identities, held):
            path = Path(row['path'])
            same = stamp(os.fstat(fd)) == row['before'] == stamp(path.stat()) and not path.is_symlink()
            unchanged = unchanged and same
            after.append({'path': str(path), 'sameHeldFDAndPathStat': same})
        text = streams['help.stdout'].decode('utf-8')
        flags = sorted(set(re.findall(r'--[A-Za-z][A-Za-z0-9-]*', text)))
        usage = 'usage:' in text.lower()
        okay = exit_code == 0 and not timed_out and unchanged and usage
        manifest = dict(preflight)
        manifest.update({
            'status': 'help_captured_command_interface_only' if okay else 'help_probe_failed_no_retry',
            'child': {'pid': pid, 'exit': exit_code, 'timeout': timed_out, 'wallSeconds': wall,
                      'stdoutBytes': len(streams['help.stdout']), 'stderrBytes': len(streams['help.stderr'])},
            'inputPostChecks': after, 'usageText': usage, 'listedLongOptions': flags,
            'ordinaryFilesNotPipeEOF': True, 'atomicLoadedImageBindingProved': False,
            'actualSenderAPIProved': False, 'modelAvailabilityProved': False,
            'requestConsistencyProved': False,
        })
        artifacts = []
        for path in sorted(out.iterdir()):
            raw = path.read_bytes()
            artifacts.append({'path': path.name, 'bytes': len(raw), 'sha256': digest(raw)})
        manifest['artifacts'] = artifacts
        save(out / 'manifest.json', manifest)
        if sum(p.stat().st_size for p in out.iterdir()) > 2 * 1024 * 1024:
            raise ValueError('result total byte cap')
        for path in out.iterdir():
            path.chmod(0o400)
        print(json.dumps({'status': manifest['status'], 'exit': exit_code,
                          'timeout': timed_out, 'stdoutBytes': len(streams['help.stdout']),
                          'stderrBytes': len(streams['help.stderr']), 'listedLongOptions': flags}))
        return 0 if okay else 1
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=2)
        for fd in held:
            os.close(fd)


if __name__ == '__main__':
    raise SystemExit(main())
