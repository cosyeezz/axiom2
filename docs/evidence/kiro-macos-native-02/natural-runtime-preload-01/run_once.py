#!/usr/bin/env python3
"""One no-input official V3 startup; public preload marker only, no HTTP hooks."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import resource
import signal
import stat
import sys
import tempfile
import types

ROOT = Path(__file__).absolute().parent
HELPER = ROOT.parent / 'request-sender-probe-03/protected_streams.py'
HELPER_SHA = 'b1f8f3e26e380d907016add782266f952e1359d4ac7e51bb137c3b76381da655'
PROBE = ROOT / 'runtime_probe.cjs'
PROBE_SHA = '77a06504eed95f343ddc5906142e153a0493ab29d1827152311e11dc264fa31c'
LAUNCHER = Path('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli')
EXPECTED = ((LAUNCHER, 73449216, '6eef360431dbca69e850d37562569b055e1f5c41aa1cb375b0db286336abefc4'),
            (LAUNCHER.with_name('kiro-cli-chat'), 436339984, '609480f7c590ea84a53556fdf81e37057594fe8d7ddbec48c0728b3cd73e83a9'))
ARGV = [str(LAUNCHER), 'chat', '--v3', '--no-interactive', '--model', 'deepseek-3.2']
REPORT_BYTES = 0


def stamp(s):
    return [s.st_dev, s.st_ino, s.st_size, s.st_mode, s.st_uid, s.st_mtime_ns, s.st_ctime_ns]


def own_read(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
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
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
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
    global REPORT_BYTES
    raw = (json.dumps(value, ensure_ascii=True, allow_nan=False, indent=2) + '\n').encode('ascii')
    if len(raw) > 16384 or REPORT_BYTES + len(raw) > 65536:
        raise ValueError()
    REPORT_BYTES += len(raw)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    with os.fdopen(fd, 'wb') as output:
        if output.write(raw) != len(raw):
            raise ValueError()


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError()
        value[key] = item
    return value


def marker(path):
    # A bounded, stable, closed public marker; never hash or publish unknown input.
    fd = None
    try:
        fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or stat.S_IMODE(before.st_mode) != 0o400 or not 0 < before.st_size <= 2048):
            raise ValueError()
        raw = b''
        while len(raw) < 2049:
            chunk = os.read(fd, 2049 - len(raw))
            if not chunk:
                break
            raw += chunk
        if len(raw) != before.st_size or stamp(before) != stamp(os.fstat(fd)):
            raise ValueError()
        value = json.loads(raw.decode('ascii'), object_pairs_hook=unique_object)
        raw = None
        keys = {'schema', 'selfPID', 'selfParentPID', 'nodeVersion', 'platform', 'architecture',
                'scriptLeafMatches', 'stdio', 'ws', 'acpCallback', 'roleCandidate',
                'httpPatched', 'rawArgumentsPersisted', 'senderProved'}
        if type(value) is not dict or set(value) != keys or value['schema'] != 'startup-public-marker-1':
            raise ValueError()
        for key in ('selfPID', 'selfParentPID'):
            if type(value[key]) is not int or not 1 <= value[key] <= 2147483647:
                raise ValueError()
        if type(value['nodeVersion']) is not str or re.fullmatch(r'v[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,2}', value['nodeVersion']) is None:
            raise ValueError()
        if value['platform'] not in ('darwin', 'other') or value['architecture'] not in ('arm64', 'x64', 'other'):
            raise ValueError()
        for key in ('scriptLeafMatches', 'stdio', 'ws', 'acpCallback', 'httpPatched', 'rawArgumentsPersisted', 'senderProved'):
            if type(value[key]) is not bool:
                raise ValueError()
        if any(value[key] for key in ('httpPatched', 'rawArgumentsPersisted', 'senderProved')):
            raise ValueError()
        role = 'unknown'
        if value['scriptLeafMatches'] and value['acpCallback']:
            if value['stdio'] and not value['ws']:
                role = 'kas-stdio-acp-callback'
            elif value['ws'] and not value['stdio']:
                role = 'kas-ws-acp-callback'
        if value['roleCandidate'] != role:
            raise ValueError()
        return 'valid-public-marker', value
    except FileNotFoundError:
        return 'not-observed-at-read', None
    except Exception:
        return 'unusable-marker', None
    finally:
        if fd is not None:
            os.close(fd)


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
        root = Path(tempfile.mkdtemp(prefix='kiro-natural-runtime01-', dir='/private/tmp'))
        save(ROOT / 'LAUNCH_ONCE.json', {'schema': 'natural-runtime-once-1', 'namespace': str(root)})
        save(root / 'RUN_ONCE', {'schema': 'natural-runtime-once-1'})
        phase = 'source-binding'
        _, own_before = own_read(Path(__file__))
        helper_raw, helper_before = own_read(HELPER)
        probe_raw, probe_before = own_read(PROBE)
        if (len(helper_raw) != 6231 or helper_before['sha256'] != HELPER_SHA
                or len(probe_raw) != 2385 or probe_before['sha256'] != PROBE_SHA):
            raise ValueError()
        helper = types.ModuleType('natural_runtime_frozen_streams')
        exec(compile(helper_raw, str(HELPER), 'exec'), helper.__dict__)
        helper_raw = None
        copied = root / 'runtime_probe.cjs'
        fd = os.open(str(copied), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        with os.fdopen(fd, 'wb') as output:
            if output.write(probe_raw) != len(probe_raw):
                raise ValueError()
        copied_raw, copied_before = own_read(copied)
        if copied_raw != probe_raw:
            raise ValueError()
        copied_raw = probe_raw = None
        phase = 'public-binding'
        public = [public_identity(*entry) for entry in EXPECTED]
        (root / 'tmp').mkdir(mode=0o700)
        (root / 'cwd').mkdir(mode=0o700)
        env = {'HOME': '/Users/dane', 'TMPDIR': str(root / 'tmp'), 'TMP': str(root / 'tmp'),
               'TEMP': str(root / 'tmp'), 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Kiro CLI.app/Contents/MacOS',
               'LANG': 'C', 'NODE_OPTIONS': '--require=' + str(copied)}
        save(root / 'preflight.json', {'schema': 'natural-runtime-preflight-1', 'ownerSelfPID': os.getpid(),
             'argv': ARGV, 'environmentPassed': env, 'fsizeSoftHardInfinity': True, 'publicFiles': public,
             'source': own_before, 'helper': helper_before, 'probe': probe_before, 'copiedProbe': copied_before,
             'scope': 'direct-child-and-public-startup-marker-only', 'opaqueCredentialUseUnknown': True})
        phase = 'official-startup'
        attempted = True
        held = helper.capture(ARGV, env=env, cwd=str(root / 'cwd'), wall_seconds=10,
                              stream_cap=65536, stop_on_interactive=True)
        save(root / 'held.json', held)
        phase = 'post-binding'
        _, own_after = own_read(Path(__file__))
        _, helper_after = own_read(HELPER)
        _, probe_after = own_read(PROBE)
        _, copied_after = own_read(copied)
        unchanged = (own_before == own_after and helper_before == helper_after and probe_before == probe_after
                     and copied_before == copied_after
                     and all(row['stamp'] == stamp(Path(row['path']).lstat()) for row in public))
        phase = 'marker-check'
        marker_status, observed = marker(root / 'runtime-marker.json')
        capture_complete = (held['complete'] is True and held['fault'] is None
                            and held['stdoutEOF'] and held['stderrEOF'] and type(held['exit']) is int)
        observation = unchanged and capture_complete and marker_status == 'valid-public-marker'
        phase = 'publication'
        save(root / 'result.json', {'schema': 'natural-runtime-result-1',
             'status': 'startup-marker-observed' if observation else 'startup-not-established',
             'officialLaunchAttempted': attempted, 'bindingsUnchanged': unchanged, 'held': held,
             'markerStatus': marker_status, 'marker': observed,
             'officialExitZero': held['exit'] == 0, 'captureComplete': capture_complete,
             'heldNodeIdentityProved': False, 'wholeApplicationCompletionProved': False,
             'actualSender': 'unknown', 'targetModelAvailability': 'unknown',
             'httpRequestCount': None, 'modelGenerationRequestCount': None, 'requestParityProved': False,
             'sourceAfter': own_after, 'helperAfter': helper_after, 'probeAfter': probe_after,
             'copiedProbeAfter': copied_after})
        signal.alarm(0)
        print(json.dumps({'status': 'startup-marker-observed' if observation else 'startup-not-established',
                          'namespace': str(root), 'officialExit': held['exit'], 'fault': held['fault'],
                          'markerStatus': marker_status}))
        return 0 if observation else 1
    except BaseException:
        signal.alarm(0)
        if root is not None:
            try:
                save(root / 'failure.json', {'schema': 'natural-runtime-failure-1', 'phase': phase,
                     'officialLaunchAttempted': attempted, 'heldMetadataAvailable': held is not None,
                     'requestParityProved': False})
            except BaseException:
                pass
        print(json.dumps({'status': 'driver-failed', 'phase': phase,
                          'namespace': str(root) if root is not None else None}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
