"""Exactly one static LLDB invocation per selected, owned public-code window."""
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import selectors
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).absolute().parent
INPUTS = {
    'format': (0x10148f068, 648,
        'f97f757f69869089461834a3dd8a374acd10489240db4f5bce9595a3a41b81e7',
        '8af3ccf18289ad0ee499a7d09e5bf013bfbc9746c2b134eccadfaafa25bbee14'),
    'field': (0x1014c6ee8, 4916,
        '009506ded94a112cecdbcec063e7f6de11b7334b8841c30c1f2e8786a44435ba',
        '6ef27bf158d8d8d637107b1f40a13df88dfc68e845a8a224caafed645c40e583'),
}


def validate_assembly(raw, file_path, start, body):
    if (type(raw) is not bytes or not 0 < len(raw) <= 262144
            or type(file_path) is not str or not 0 < len(file_path) <= 512
            or type(start) is not int or not 0 <= start < 2**64
            or type(body) is not bytes or not 0 < len(body) <= 4916 or len(body) % 4
            or start + len(body) > 2**64):
        raise ValueError()
    name = file_path.rsplit('/', 1)[-1]
    if name not in ('format.macho', 'field.macho'):
        raise ValueError()
    text = raw.decode('ascii')
    if not text.endswith('\n') or any(ord(c) < 32 and c not in '\n\t' or ord(c) > 126 for c in text):
        raise ValueError()
    lines = text.split('\n')[:-1]
    prefix = ['(lldb) target create --no-dependents --arch arm64 ' + file_path,
        "Current executable set to '" + file_path + "' (arm64).",
        '(lldb) disassemble --bytes --start-address ' + hex(start)
        + ' --end-address ' + hex(start + len(body))]
    if len(lines) != 3 + len(body) // 4 or lines[:3] != prefix:
        raise ValueError()
    pattern = re.compile(re.escape(name) + r'\[0x([0-9a-f]{1,16})\]:[ \t]+0x([0-9a-f]{8})[ \t]+([A-Za-z.][A-Za-z0-9_.]{0,31})(?:[ \t]+([^\n]{0,192}))?')
    directives = 0
    for index, line in enumerate(lines[3:]):
        match = pattern.fullmatch(line)
        if (match is None or int(match.group(1), 16) != start + index * 4
                or int(match.group(2), 16) != struct.unpack_from('<I', body, index * 4)[0]):
            raise ValueError()
        directives += int(match.group(3).startswith('.') or match.group(3) == 'unknown')
    return {'wordLines': len(body) // 4, 'directiveOrUnknownLines': directives,
        'completeWordRoundtrip': True, 'cfgProved': False}


def expired(_signal, _frame):
    raise TimeoutError()


def identity(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def read_owned(path, cap):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or not 0 < before.st_size <= cap):
            raise ValueError()
        data = bytearray()
        while len(data) <= cap:
            part = os.read(fd, min(4096, cap + 1 - len(data)))
            if not part:
                break
            data.extend(part)
        if len(data) != before.st_size or identity(before) != identity(os.fstat(fd)):
            raise ValueError()
        return bytes(data)
    finally:
        os.close(fd)


def digest(data):
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def save_bytes(path, data, cap=65536):
    if type(data) is not bytes or not 0 < len(data) <= cap:
        raise ValueError()
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)


def save(path, value):
    save_bytes(path, (json.dumps(value, sort_keys=True, indent=2) + '\n').encode())


def child_limits():
    resource.setrlimit(resource.RLIMIT_CPU, (6, 8))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (524288, 524288))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


def run_once(label):
    root = child = selector = None
    fault = None
    phase = 'preflight'
    eof = {'stdout': False, 'stderr': False}
    received = {'stdout': 0, 'stderr': 0}
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    before = after = result = None
    source_before = source_after = None
    owned_bytes = None
    code = 1
    started = time.monotonic()
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (524288, 524288))
        resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
        signal.signal(signal.SIGALRM, expired)
        signal.alarm(13)
        if label not in INPUTS:
            raise ValueError()
        start, length, binary_sha, macho_sha = INPUTS[label]
        root = Path(tempfile.mkdtemp(prefix='kiro-window01-lldb-' + label + '-', dir='/private/tmp'))
        os.chmod(root, 0o700)
        for n in ('home', 'tmp', 'cwd'):
            (root / n).mkdir(mode=0o700)
        save(HERE / ('LLDB_' + label.upper() + '_ONCE.json'),
            {'schema': 'catalog-window-lldb-launch-1', 'label': label, 'root': str(root)})
        save_bytes(root / 'RUN_ONCE', b'catalog-window-lldb-1\n')
        source_before = digest(read_owned(Path(__file__), 24576))
        body = read_owned(HERE / 'main' / (label + '.bin'), 8192)
        macho = read_owned(HERE / 'main' / (label + '.macho'), 16384)
        before = {'binary': digest(body), 'macho': digest(macho)}
        if (before['binary'] != {'bytes': length, 'sha256': binary_sha}
                or before['macho'] != {'bytes': 4096 + length, 'sha256': macho_sha}
                or macho[4096:] != body):
            raise ValueError()
        input_path = root / (label + '.macho')
        save_bytes(input_path, macho)
        save_bytes(root / (label + '.bin'), body)
        command = ['/usr/bin/lldb', '--no-lldbinit', '--batch', '-o',
            'target create --no-dependents --arch arm64 ' + str(input_path), '-o',
            'disassemble --bytes --start-address ' + hex(start)
            + ' --end-address ' + hex(start + length)]
        env = {'HOME': str(root / 'home'), 'TMPDIR': str(root / 'tmp'),
            'TMP': str(root / 'tmp'), 'TEMP': str(root / 'tmp'), 'PATH': '/usr/bin:/bin', 'LANG': 'C'}
        save(root / 'launch.json', {'command': command, 'env': env, 'cwd': str(root / 'cwd'),
            'before': before, 'sourceBefore': source_before,
            'environmentBoundary': 'explicit-six-keys-actual-not-enumerated',
            'scope': 'owned-static-lldb-no-process-launch-or-attach'})
        phase = 'spawn'
        child = subprocess.Popen(command, cwd=str(root / 'cwd'), env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True, preexec_fn=child_limits)
        save(root / 'held-start.json', {'pid': child.pid, 'lldbInvocations': 1})
        phase = 'collect'
        selector = selectors.DefaultSelector()
        for stream, name in ((child.stdout, 'stdout'), (child.stderr, 'stderr')):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, name)
        deadline = started + 10
        while selector.get_map():
            left = deadline - time.monotonic()
            if left <= 0:
                fault = 'deadline'
                break
            for key, _ in selector.select(min(0.05, left)):
                try:
                    part = os.read(key.fd, 1024)
                except BlockingIOError:
                    continue
                if not part:
                    eof[key.data] = True
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                else:
                    received[key.data] += len(part)
                    if sum(received.values()) > 262144:
                        fault = 'stream-cap'
                        break
                    buffers[key.data].extend(part)
            if fault:
                break
        if not fault:
            child.wait(timeout=max(0.001, deadline - time.monotonic()))
            if child.returncode != 0 or buffers['stderr'] or not all(eof.values()):
                fault = 'lldb-failed'
            else:
                phase = 'output-gate'
                result = validate_assembly(bytes(buffers['stdout']), str(input_path), start, body)
                after = {'binary': digest(read_owned(root / (label + '.bin'), 8192)),
                    'macho': digest(read_owned(input_path, 16384))}
                if before != after:
                    fault = 'input-changed'
                else:
                    owned_bytes = 0
                    entries = 0
                    for path in root.rglob('*'):
                        entries += 1
                        info = path.lstat()
                        if entries > 256 or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                            raise ValueError()
                        if stat.S_ISREG(info.st_mode):
                            owned_bytes += info.st_size
                        if owned_bytes + len(buffers['stdout']) + 16384 > 1048576:
                            raise ValueError()
                    code = 0
    except BaseException:
        fault = fault or 'owner-error'
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
            source_after = digest(read_owned(Path(__file__), 24576))
            if source_before != source_after:
                fault = fault or 'source-changed'
        except BaseException:
            fault = fault or 'source-check-failed'
        if fault or not all(eof.values()) or child is None or child.returncode != 0:
            code = 1
        if root is not None:
            try:
                if code == 0:
                    phase = 'publish'
                    # Only closed, fully word-matched public disassembly is persisted.
                    save_bytes(root / 'assembly.txt', bytes(buffers['stdout']), 262144)
                    save(root / 'report.json', {'schema': 'catalog-window-lldb-1', 'label': label,
                        'status': 'complete-word-roundtrip', 'result': result,
                        'inputBefore': before, 'inputAfter': after, 'modelRequests': 0,
                        'officialCodeExecuted': False, 'naturalCatalogGrammarProved': False})
                save(root / 'held.json', {'schema': 'catalog-window-lldb-held-1',
                    'pid': child.pid if child is not None else None,
                    'exit': child.returncode if child is not None else None, 'fault': fault,
                    'phase': phase, 'trueEOF': eof, 'receivedBytes': received,
                    'storedStreamBytes': {k: len(v) for k, v in buffers.items()},
                    'sourceBefore': source_before, 'sourceAfter': source_after,
                    'inputBefore': before, 'inputAfter': after,
                    'directChildOnly': True, 'unvalidatedRawPersisted': False,
                    'ownedBytesBeforePublication': owned_bytes,
                    'elapsedBeforePublication': time.monotonic() - started})
            except BaseException:
                code = 1
        print(json.dumps({'status': 'lldb-owner-finished' if code == 0 else 'lldb-owner-failed',
            'ownerExit': code, 'root': str(root) if root is not None else None,
            'lldbExit': child.returncode if child is not None else None}))
    return code


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError()
        answer = run_once(sys.argv[1])
    except BaseException:
        try:
            os.write(1, b'{"status":"lldb-owner-startup-failed"}\n')
        except BaseException:
            pass
        answer = 1
    raise SystemExit(answer)
