"""One-shot owner for the two-window public-code extractor, not for real auth or model processes."""
import hashlib
import json
import os
from pathlib import Path
import resource
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).absolute().parent
WORKER = HERE / 'extract.py'
EXPECTED = '3e528ad36b1c4a45a39b98718b2d9190ff81f7ee4fdd30450cda153456b07d88'
TARGET_BYTES = 69220656
HELPER = HERE.parent / 'native-catalog-xref-01' / 'xref.py'
HELPER_ID = {'bytes': 8114, 'sha256': 'bb5c054173e3aaf6574a1a8db190be415e1bceb08a1728386420e953e5f53e2f'}


def expired(_signal, _frame):
    raise TimeoutError()


def save(path, value):
    data = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
    if len(data) > 65536:
        raise ValueError()
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(data)
    finally:
        os.close(fd)


def digest(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or not 0 < before.st_size <= 24 * 1024):
            raise ValueError()
        data = bytearray()
        while len(data) <= 24 * 1024:
            part = os.read(fd, min(4096, 24 * 1024 + 1 - len(data)))
            if not part:
                break
            data.extend(part)
        if len(data) != before.st_size or stable_id(before) != stable_id(os.fstat(fd)):
            raise ValueError()
        return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    finally:
        os.close(fd)


def stable_id(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_size,
        info.st_mtime_ns, info.st_ctime_ns)


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def invalid_number(_value):
    raise ValueError()


def own_report(root):
    fd = os.open(str(root / 'windows.json'), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or not 0 < before.st_size <= 16 * 1024):
            raise ValueError()
        raw = b''
        while len(raw) <= 16 * 1024:
            chunk = os.read(fd, min(4096, 16 * 1024 + 1 - len(raw)))
            if not chunk:
                break
            raw += chunk
        after = os.fstat(fd)
        if len(raw) != before.st_size or stable_id(before) != stable_id(after):
            raise ValueError()
        value = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_number)
        if (type(value) is not dict or value.get('schema') != 'native-catalog-window-1'
                or type(value.get('readBytes')) is not int or value['readBytes'] != TARGET_BYTES
                or value.get('knownTextHashMatches') is not True
                or type(value.get('selectedBytes')) is not int or value['selectedBytes'] != 5564
                or type(value.get('referenceWordsVerified')) is not int or value['referenceWordsVerified'] != 6
                or value.get('sourceFDStable') is not True
                or any(value.get(k) is not False for k in ('freshWholeFileHash',
                    'nativeDispatchProved', 'catalogGrammarProved', 'modelAvailabilityProved'))
                or type(value.get('modelRequests')) is not int or value['modelRequests'] != 0):
            raise ValueError()
        return len(raw), value.get('status')
    finally:
        os.close(fd)


def main():
    root = None
    child = None
    selector = None
    fault = None
    eof = {'stdout': False, 'stderr': False}
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    before = None
    after = None
    terminal = None
    started = time.monotonic()
    code = 1
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (16, 16))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_FSIZE, (65536, 65536))
        signal.signal(signal.SIGALRM, expired)
        signal.alarm(18)
        before = {'worker': digest(WORKER), 'owner': digest(Path(__file__)), 'helper': digest(HELPER)}
        if before['worker'] != {'bytes': 6296, 'sha256': EXPECTED} or before['helper'] != HELPER_ID:
            raise ValueError()
        root = Path(tempfile.mkdtemp(prefix='kiro-native-catalog-window01-', dir='/private/tmp'))
        os.chmod(root, 0o700)
        for name in ('home', 'tmp', 'cwd'):
            (root / name).mkdir(mode=0o700)
        # Permanent case gate; an existing gate stops before any target scan.
        save(HERE / 'LAUNCH_ONCE.json', {'schema': 'native-catalog-window-launch-1',
            'root': str(root), 'before': before})
        env = {'HOME': str(root / 'home'), 'TMPDIR': str(root / 'tmp'),
            'TMP': str(root / 'tmp'), 'TEMP': str(root / 'tmp'),
            'PATH': '/usr/bin:/bin', 'LANG': 'C'}
        command = ['/usr/bin/python3', '-I', '-B', str(WORKER), str(root)]
        save(root / 'launch.json', {'command': command, 'env': env,
            'cwd': str(root / 'cwd'), 'stdin': 'DEVNULL', 'before': before,
            'controllerEnvironment': 'inherited-not-enumerated',
            'workerEnvironment': 'explicit-six-key-mapping-platform-additions-not-asserted',
            'scope': 'own-static-worker-only'})
        child = subprocess.Popen(command, cwd=str(root / 'cwd'), env=env,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            close_fds=True)
        save(root / 'held-start.json', {'pid': child.pid, 'workerCount': 1})
        selector = selectors.DefaultSelector()
        for stream, label in ((child.stdout, 'stdout'), (child.stderr, 'stderr')):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, label)
        deadline = started + 16
        while selector.get_map():
            left = deadline - time.monotonic()
            if left <= 0:
                fault = 'deadline'
                break
            for key, _ in selector.select(min(left, 0.05)):
                try:
                    part = os.read(key.fd, 1024)
                except BlockingIOError:
                    continue
                if not part:
                    eof[key.data] = True
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                elif sum(map(len, buffers.values())) + len(part) > 8192:
                    fault = 'stream-cap'
                    break
                else:
                    buffers[key.data].extend(part)
            if fault:
                break
        if not fault:
            child.wait(timeout=max(0.001, deadline - time.monotonic()))
            if child.returncode != 0 or buffers['stderr']:
                fault = 'worker-failed'
            else:
                # Nothing from the pipes is persisted before this closed check.
                terminal = json.loads(buffers['stdout'], object_pairs_hook=pairs,
                    parse_constant=invalid_number, parse_float=invalid_number)
                keys = {'status', 'readBytes', 'reportBytes', 'modelRequests'}
                expected_status = 'bounded-windows'
                if (type(terminal) is not dict or set(terminal) != keys
                        or terminal['status'] != expected_status
                        or type(terminal['readBytes']) is not int or terminal['readBytes'] != TARGET_BYTES
                        or type(terminal['reportBytes']) is not int or not 0 < terminal['reportBytes'] <= 16 * 1024
                        or type(terminal['modelRequests']) is not int or terminal['modelRequests'] != 0):
                    raise ValueError()
                report_bytes, report_status = own_report(root)
                if (report_bytes, report_status) != (terminal['reportBytes'], expected_status):
                    raise ValueError()
                code = child.returncode
    except BaseException:
        fault = fault or 'owner-error'
        code = 1
    finally:
        signal.alarm(0)
        if selector is not None:
            try:
                selector.close()
            except BaseException:
                fault = fault or 'owner-error'
        if child is not None:
            try:
                if child.poll() is None:
                    child.kill()
                child.wait(timeout=2)
            except BaseException:
                fault = fault or 'cleanup-unknown'
            for stream in (child.stdout, child.stderr):
                try:
                    stream.close()
                except BaseException:
                    fault = fault or 'owner-error'
        try:
            after = {'worker': digest(WORKER), 'owner': digest(Path(__file__)), 'helper': digest(HELPER)}
            if before != after:
                fault = fault or 'source-changed'
        except BaseException:
            fault = fault or 'source-check-failed'
        if not all(eof.values()) or fault:
            code = 1
        if root is not None:
            try:
                save(root / 'held.json', {'schema': 'native-catalog-window-held-1',
                    'pid': child.pid if child is not None else None,
                    'exit': child.returncode if child is not None else None,
                    'trueEOF': eof, 'fault': fault, 'sourceBefore': before,
                    'sourceAfter': after, 'stdoutBytes': len(buffers['stdout']),
                    'stderrBytes': len(buffers['stderr']),
                    'elapsedBeforePublication': time.monotonic() - started,
                    'terminal': terminal if fault is None else None,
                    'rawStreamsPersisted': False, 'directChildOnly': True})
            except BaseException:
                code = 1
        print(json.dumps({'status': 'static-owner-finished' if code == 0 else 'static-owner-not-successful',
            'ownerExit': code, 'root': str(root) if root is not None else None,
            'workerExit': child.returncode if child is not None else None}))
    return code


if __name__ == '__main__':
    try:
        result = main()
    except BaseException:
        try:
            os.write(1, b'{"status":"static-owner-failed"}\n')
        except BaseException:
            pass
        result = 1
    raise SystemExit(result)
