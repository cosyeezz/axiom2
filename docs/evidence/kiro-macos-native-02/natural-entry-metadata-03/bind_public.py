#!/usr/bin/env python3
"""One public2.36.0 identity/signature pass. No official app invocation."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import resource
import signal
import stat
import subprocess
import sys

ROOT = Path(__file__).absolute().parent
APP = Path('/Applications/Kiro CLI.app/Contents')
FILES = [('kiro-cli', 73449216), ('kiro-cli-chat', 436339984)]


def stamp(s):
    return [s.st_dev, s.st_ino, s.st_size, s.st_mode, s.st_uid, s.st_mtime_ns, s.st_ctime_ns]


def save(path, value):
    data = (json.dumps(value, indent=2, allow_nan=False) + '\n').encode('ascii')
    if len(data) > 16384:
        raise ValueError()
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    with os.fdopen(fd, 'wb') as f:
        if f.write(data) != len(data):
            raise ValueError()


def expired(_sig, _frame):
    raise TimeoutError()


def main():
    phase = 'setup'
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        signal.signal(signal.SIGALRM, expired)
        signal.alarm(15)
        save(ROOT / 'PUBLIC_IDENTITY_ONCE', {'schema': 'public-identity-once-1'})
        rows = []
        for name, size in FILES:
            phase = 'public-hash'
            path = APP / 'MacOS' / name
            fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
            try:
                before = os.fstat(fd)
                if not stat.S_ISREG(before.st_mode) or before.st_size != size:
                    raise ValueError()
                h = hashlib.sha256()
                count = 0
                while count < size:
                    chunk = os.read(fd, min(4194304, size - count))
                    if not chunk:
                        raise ValueError()
                    h.update(chunk)
                    count += len(chunk)
                if stamp(before) != stamp(os.fstat(fd)):
                    raise ValueError()
            finally:
                os.close(fd)
            phase = 'signature'
            result = subprocess.run(['/usr/bin/codesign', '--verify', '--strict', '-R',
                '=anchor apple generic and certificate leaf[subject.OU] = "94KV3E626L"', str(path)],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=5, check=False)
            save(ROOT / (name + '-signature.json'), {'publicFile': name, 'exit': result.returncode})
            if result.returncode != 0 or stamp(before) != stamp(path.lstat()):
                raise ValueError()
            rows.append({'path': str(path), 'bytes': count, 'sha256': h.hexdigest(),
                         'stamp': stamp(before), 'signatureExit': result.returncode})
        phase = 'public-plist'
        path = APP / 'Info.plist'
        fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
        try:
            s = os.fstat(fd)
            if not stat.S_ISREG(s.st_mode) or not 0 < s.st_size <= 65536:
                raise ValueError()
            data = os.read(fd, s.st_size + 1)
            if len(data) != s.st_size or stamp(s) != stamp(os.fstat(fd)):
                raise ValueError()
        finally:
            os.close(fd)
        v = plistlib.loads(data)
        if v.get('CFBundleShortVersionString') != '2.36.0' or v.get('CFBundleVersion') != '20261029.233307':
            raise ValueError()
        phase = 'publication'
        save(ROOT / 'PUBLIC-IDENTITY.json', {'schema': 'public-identity-236-1',
             'files': rows, 'version': '2.36.0', 'build': '20261029.233307',
             'plist': {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'stamp': stamp(s)},
             'binaryBytesRead': sum(r['bytes'] for r in rows), 'requiredTeam': '94KV3E626L',
             'officialAppInvocations': 0, 'atomicLoadedImageProved': False})
        signal.alarm(0)
        print('{"status":"public-identity-bound","binaryBytes":509789200,"signatureExits":[0,0]}')
        return 0
    except BaseException:
        signal.alarm(0)
        print(json.dumps({'status': 'public-identity-failed', 'phase': phase}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
