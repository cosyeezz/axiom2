#!/usr/bin/env python3
"""One ordinary official list invocation; fixed direct-child metadata only."""
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import signal
import stat
import sys
import tempfile
import types

ROOT = Path(__file__).absolute().parent
HELPER = ROOT.parent / 'request-sender-probe-03/protected_streams.py'
HELPER_SHA = 'b1f8f3e26e380d907016add782266f952e1359d4ac7e51bb137c3b76381da655'
LAUNCHER = Path('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli')
CHAT = LAUNCHER.with_name('kiro-cli-chat')
EXPECTED = ((LAUNCHER, 73432992, '8e242d795f93a70bc4497907d9aaf2d1552a07ee8a7a86e0276af6cf55672fd2'),
            (CHAT, 413051920, '7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f'))
ARGV = [str(LAUNCHER), 'chat', '--v3', '--list-models', '--format', 'json',
        '--no-interactive', '--model', 'deepseek-3.2']


def stamp(s):
    return [s.st_dev, s.st_ino, s.st_size, s.st_mode, s.st_uid, s.st_mtime_ns, s.st_ctime_ns]


def own_read(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or not 0 < before.st_size <= 16384:
            raise ValueError()
        raw = b''
        while len(raw) <= before.st_size:
            chunk = os.read(fd, before.st_size + 1 - len(raw))
            if not chunk:
                break
            raw += chunk
        if len(raw) != before.st_size or stamp(before) != stamp(os.fstat(fd)):
            raise ValueError()
        return raw, {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'stamp': stamp(before)}
    finally:
        os.close(fd)


def public_identity(path, size, expected):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size != size:
            raise ValueError()
        hashed = hashlib.sha256()
        count = 0
        while count < size:
            chunk = os.read(fd, min(4194304, size - count))
            if not chunk:
                raise ValueError()
            count += len(chunk)
            hashed.update(chunk)
        if hashed.hexdigest() != expected or stamp(before) != stamp(os.fstat(fd)):
            raise ValueError()
        return {'path': str(path), 'bytes': count, 'sha256': expected, 'stamp': stamp(before)}
    finally:
        os.close(fd)


def save(path, value):
    raw = (json.dumps(value, ensure_ascii=True, allow_nan=False, indent=2) + '\n').encode('ascii')
    if len(raw) > 16384:
        raise ValueError()
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    with os.fdopen(fd, 'wb') as output:
        if output.write(raw) != len(raw):
            raise ValueError()


def expired(_signum, _frame):
    raise TimeoutError()


def main():
    root = None
    phase = 'setup'
    held = None
    attempted = False
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
        signal.signal(signal.SIGALRM, expired)
        signal.alarm(24)
        if (sys.platform != 'darwin' or platform.machine() != 'arm64'
                or resource.getrlimit(resource.RLIMIT_FSIZE) != (resource.RLIM_INFINITY, resource.RLIM_INFINITY)):
            raise ValueError()
        root = Path(tempfile.mkdtemp(prefix='kiro-natural-metadata01-', dir='/private/tmp'))
        save(ROOT / 'LAUNCH_ONCE.json', {'schema': 'natural-metadata-once-1', 'namespace': str(root)})
        save(root / 'RUN_ONCE', {'schema': 'natural-metadata-once-1'})
        phase = 'source-binding'
        _, own_before = own_read(Path(__file__))
        helper_raw, helper_before = own_read(HELPER)
        if len(helper_raw) != 6231 or helper_before['sha256'] != HELPER_SHA:
            raise ValueError()
        helper = types.ModuleType('natural_metadata_frozen_streams')
        exec(compile(helper_raw, str(HELPER), 'exec'), helper.__dict__)
        helper_raw = None
        phase = 'public-binding'
        public = [public_identity(*entry) for entry in EXPECTED]
        (root / 'tmp').mkdir(mode=0o700)
        (root / 'cwd').mkdir(mode=0o700)
        env = {'HOME': '/Users/dane', 'TMPDIR': str(root / 'tmp'),
               'TMP': str(root / 'tmp'), 'TEMP': str(root / 'tmp'),
               'PATH': '/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Kiro CLI.app/Contents/MacOS', 'LANG': 'C'}
        save(root / 'preflight.json', {'schema': 'natural-metadata-preflight-1',
             'ownerSelfPID': os.getpid(), 'argv': ARGV, 'environmentPassed': env,
             'fsizeSoftHardInfinity': True, 'publicFiles': public,
             'source': own_before, 'helper': helper_before,
             'scope': 'direct-child-metadata-only', 'opaqueCredentialUseUnknown': True})
        phase = 'official-capture'
        attempted = True
        held = helper.capture(ARGV, env=env, cwd=str(root / 'cwd'), wall_seconds=10,
                              stream_cap=65536, stop_on_interactive=True)
        # The unchanged helper returns only its fixed metadata, never raw output.
        save(root / 'held.json', held)
        phase = 'post-binding'
        _, own_after = own_read(Path(__file__))
        _, helper_after = own_read(HELPER)
        unchanged = (own_before == own_after and helper_before == helper_after
                     and all(row['stamp'] == stamp(Path(row['path']).lstat()) for row in public))
        success = (unchanged and held['complete'] is True and held['exit'] == 0
                   and held['fault'] is None and held['stdoutEOF'] and held['stderrEOF'])
        phase = 'publication'
        save(root / 'result.json', {'schema': 'natural-metadata-result-1',
             'status': 'metadata-complete' if success else 'metadata-not-successful',
             'officialLaunchAttempted': attempted, 'bindingsUnchanged': unchanged,
             'held': held, 'catalogSchema': 'unknown', 'catalogSource': 'unknown',
             'targetModelAvailability': 'unknown', 'actualSender': 'unknown',
             'httpRequestCount': None, 'modelGenerationRequestCount': None,
             'wholeApplicationCompletionProved': False, 'requestParityProved': False,
             'sourceAfter': own_after, 'helperAfter': helper_after})
        signal.alarm(0)
        print(json.dumps({'status': 'metadata-complete' if success else 'metadata-not-successful',
                          'namespace': str(root), 'officialExit': held['exit'], 'fault': held['fault']}))
        return 0 if success else 1
    except BaseException:
        signal.alarm(0)
        # No exception text/repr/context/trace or capture buffers are exported.
        if root is not None:
            try:
                save(root / 'failure.json', {'schema': 'natural-metadata-failure-1', 'phase': phase,
                     'officialLaunchAttempted': attempted, 'heldMetadataAvailable': held is not None,
                     'requestParityProved': False})
            except BaseException:
                pass
        print(json.dumps({'status': 'driver-failed', 'phase': phase,
                          'namespace': str(root) if root is not None else None}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
