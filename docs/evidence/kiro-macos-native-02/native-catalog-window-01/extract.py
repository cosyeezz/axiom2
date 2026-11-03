"""Two frozen-public code windows. No target I/O on import; never execute exported code."""
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import stat
import struct
import sys
import time
import types

HERE = Path(__file__).absolute().parent
HELPER = HERE.parent / 'native-catalog-xref-01' / 'xref.py'
HELPER_SHA = 'bb5c054173e3aaf6574a1a8db190be415e1bceb08a1728386420e953e5f53e2f'
RANGES = (
    ('format', 0x10148f068, 0x10148f2f0,
     ((0x10148f1fc, 0xf0019cc8), (0x10148f200, 0x91270508))),
    ('field', 0x1014c6ee8, 0x1014c821c,
     ((0x1014c75c4, 0xf0019ae2), (0x1014c75c8, 0x9139e042),
      (0x1014c75dc, 0xf0019ae0), (0x1014c75e0, 0x9139e000))),
)


def expired(_signal, _frame):
    raise TimeoutError()


def load_helpers():
    fd = os.open(str(HELPER), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size != 8114 or info.st_uid != os.getuid():
            raise ValueError()
        raw = os.read(fd, 8115)
        if len(raw) != 8114 or hashlib.sha256(raw).hexdigest() != HELPER_SHA:
            raise ValueError()
        module = types.ModuleType('window01_frozen_helpers')
        module.__file__ = str(HELPER)
        exec(compile(raw, str(HELPER), 'exec'), module.__dict__)
        if module.stable(info) != module.stable(os.fstat(fd)):
            raise ValueError()
        return module
    finally:
        os.close(fd)


def macho_at(start, body):
    # The previously verified converter's original-VA analysis-only layout.
    header = struct.pack('<8I', 0xfeedfacf, 0x100000c, 0, 2, 1, 152, 0, 0)
    segment = struct.pack('<II16sQQQQiiII', 0x19, 152, b'__TEXT',
        start, len(body), 4096, len(body), 5, 5, 1, 0)
    section = struct.pack('<16s16sQQIIIIIIII', b'__text', b'__TEXT',
        start, len(body), 4096, 2, 0, 0, 0x80000400, 0, 0, 0)
    if len(header + segment + section) != 184:
        raise ValueError()
    return (header + segment + section).ljust(4096, b'\0') + body


def write_new(root, name, data):
    if type(data) is not bytes or not 0 < len(data) <= 16384:
        raise ValueError()
    fd = os.open(str(root / name), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
    return {'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def run_once(root):
    started = time.monotonic()
    resource.setrlimit(resource.RLIMIT_CPU, (10, 12))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    resource.setrlimit(resource.RLIMIT_FSIZE, (65536, 65536))
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(15)
    root = Path(root)
    info = root.lstat()
    if (not root.is_absolute() or root.parent != Path('/private/tmp')
            or not root.name.startswith('kiro-native-catalog-window01-')
            or not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700
            or info.st_uid != os.getuid()):
        raise ValueError()
    write_new(root, 'RUN_ONCE', b'native-catalog-window-1\n')
    helper = load_helpers()
    fd = os.open(helper.SOURCE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_size != 413051920
                or stat.S_IMODE(before.st_mode) != 0o400 or before.st_uid != os.getuid()):
            raise ValueError()
        header = helper.read_at(fd, helper.SLICE, 4352)
        text = helper.read_at(fd, helper.SLICE + helper.TEXT_OFFSET, helper.TEXT_SIZE)
        if (hashlib.sha256(header).hexdigest() != helper.HEADER_SHA
                or hashlib.sha256(text).hexdigest() != helper.TEXT_SHA
                or helper.stable(before) != helper.stable(os.fstat(fd))):
            raise ValueError()
    finally:
        os.close(fd)
    windows = []
    selected = []
    for name, start, end, words in RANGES:
        if not helper.TEXT_VA <= start < end <= helper.TEXT_VA + len(text):
            raise ValueError()
        body = text[start - helper.TEXT_VA:end - helper.TEXT_VA]
        if len(body) != end - start or len(body) % 4:
            raise ValueError()
        for pc, word in words:
            if not start <= pc <= end - 4 or struct.unpack_from('<I', body, pc - start)[0] != word:
                raise ValueError()
        selected.append((name, start, end, len(words), body))
    del header, text
    for name, start, end, checked, body in selected:
        binary = write_new(root, name + '.bin', body)
        macho = write_new(root, name + '.macho', macho_at(start, body))
        windows.append({'name': name, 'start': hex(start), 'upperBound': hex(end),
            'rangeBytes': len(body), 'words': len(body) // 4, 'referenceWordsVerified': checked,
            'binary': binary, 'macho': macho, 'analysisOnlyNeverExecuted': True})
    report = {'schema': 'native-catalog-window-1', 'status': 'bounded-windows',
        'helperIdentity': {'bytes': 8114, 'sha256': HELPER_SHA},
        'headerSHA': helper.HEADER_SHA, 'textSHA': helper.TEXT_SHA,
        'readBytes': 4352 + helper.TEXT_SIZE, 'sourceFDStable': True,
        'knownTextHashMatches': True, 'freshWholeFileHash': False,
        'windows': windows, 'selectedBytes': sum(w['rangeBytes'] for w in windows),
        'referenceWordsVerified': sum(w['referenceWordsVerified'] for w in windows),
        'nativeDispatchProved': False, 'catalogGrammarProved': False,
        'modelAvailabilityProved': False, 'modelRequests': 0,
        'elapsedSecondsBeforePublication': time.monotonic() - started}
    encoded = (json.dumps(report, sort_keys=True, indent=2) + '\n').encode()
    write_new(root, 'windows.json', encoded)
    print(json.dumps({'status': 'bounded-windows', 'readBytes': report['readBytes'],
        'reportBytes': len(encoded), 'modelRequests': 0}))
    return 0


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError()
        code = run_once(sys.argv[1])
    except BaseException:
        try:
            signal.alarm(0)
            os.write(1, b'{"status":"static-window-failed","modelRequests":0}\n')
        except BaseException:
            pass
        code = 1
    raise SystemExit(code)
