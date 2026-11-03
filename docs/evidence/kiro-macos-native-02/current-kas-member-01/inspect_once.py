#!/usr/bin/env python3
"""Current shipped public bytes only. No target/member execution or account IO."""
import ctypes as C
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import resource
import signal
import stat
import struct
import tarfile
import tempfile
import time

HERE = Path(__file__).resolve().parent
TARGET = '/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat'
SIZE = 436339984
SHA = '609480f7c590ea84a53556fdf81e37057594fe8d7ddbec48c0728b3cd73e83a9'
BASE = 'node_modules/@kiro/agent/'
MEMBERS = (BASE + 'package.json', BASE + 'dist/server/acp-server.js', BASE + 'dist/server/acp-server.externals.json')
CAP = 32 * 1024 * 1024
class Refused(Exception):
    pass
class InBuf(C.Structure):
    _fields_ = [('src', C.c_void_p), ('size', C.c_size_t), ('pos', C.c_size_t)]
class OutBuf(C.Structure):
    _fields_ = [('dst', C.c_void_p), ('size', C.c_size_t), ('pos', C.c_size_t)]

def require(value, code):
    if not value:
        raise Refused(code)

def stamp(s):
    return [s.st_dev, s.st_ino, s.st_size, s.st_mode, s.st_uid, s.st_mtime_ns, s.st_ctime_ns]

class Decoder(io.RawIOBase):
    def __init__(self, z, data, deadline, strict=True):
        super().__init__()
        self.z, self.deadline, self.strict = z, deadline, strict
        self.ctx = z.ZSTD_createDStream()
        require(bool(self.ctx), 'decoder-create')
        self.data = C.create_string_buffer(data)
        self.ib = InBuf(C.addressof(self.data), len(data), 0)
        self.out = C.create_string_buffer(65536)
        self.pending = b''
        self.eof = False
        self.decoded = 0
        self.hash = hashlib.sha256()
        try:
            self.check(z.ZSTD_initDStream(self.ctx))
            self.check(z.ZSTD_DCtx_setParameter(self.ctx, 100, 24))
        except BaseException:
            self.close()
            raise
    def check(self, n):
        require(not self.z.ZSTD_isError(n), 'zstd-decode')
        return n
    def readable(self):
        return True
    def pump(self, size=65536):
        require(time.monotonic() < self.deadline, 'deadline')
        old = self.ib.pos
        ob = OutBuf(C.addressof(self.out), size, 0)
        result = self.check(self.z.ZSTD_decompressStream(self.ctx, C.byref(ob), C.byref(self.ib)))
        data = self.out.raw[:ob.pos]
        self.decoded += len(data)
        require(self.decoded <= 256 * 1024 * 1024, 'decoded-cap')
        self.hash.update(data)
        if result == 0:
            require(not self.strict or self.ib.pos == self.ib.size, 'compressed-tail')
            self.eof = True
        else:
            require(bool(data) or old != self.ib.pos, 'decoder-no-progress')
        return data
    def read(self, n=-1):
        require(0 <= n <= 1048576, 'read-bound')
        while len(self.pending) < n and not self.eof:
            self.pending += self.pump()
        out, self.pending = self.pending[:n], self.pending[n:]
        return out
    def close(self):
        if getattr(self, 'ctx', None):
            self.z.ZSTD_freeDStream(self.ctx)
            self.ctx = None
        super().close()

def zstd_api():
    z = C.CDLL('/opt/homebrew/opt/zstd/lib/libzstd.dylib')
    for name, args, ret in [
        ('ZSTD_findFrameCompressedSize', [C.c_void_p, C.c_size_t], C.c_size_t),
        ('ZSTD_createDStream', [], C.c_void_p),
        ('ZSTD_initDStream', [C.c_void_p], C.c_size_t),
        ('ZSTD_DCtx_setParameter', [C.c_void_p, C.c_int, C.c_int], C.c_size_t),
        ('ZSTD_decompressStream', [C.c_void_p, C.POINTER(OutBuf), C.POINTER(InBuf)], C.c_size_t),
        ('ZSTD_isError', [C.c_size_t], C.c_uint),
        ('ZSTD_freeDStream', [C.c_void_p], C.c_size_t),
    ]:
        f = getattr(z, name)
        f.argtypes, f.restype = args, ret
    return z

def extract(reader, directory, deadline):
    selected, seen, total, count = [], set(), 0, 0
    with tarfile.open(fileobj=reader, mode='r|') as tf:
        for member in tf:
            require(time.monotonic() < deadline, 'deadline')
            count += 1
            require(count <= 40000, 'member-cap')
            raw = member.name
            require(len(raw) <= 4096 and '\\' not in raw and '\x00' not in raw, 'member-name')
            path = PurePosixPath(raw)
            require(not path.is_absolute() and '..' not in path.parts, 'member-name')
            name = str(path)
            if name not in MEMBERS:
                continue
            require(member.isfile() and not member.issym() and not member.islnk(), 'member-type')
            require(name not in seen and 0 <= member.size <= 24 * 1024 * 1024, 'member-bound')
            total += member.size
            require(total <= CAP, 'selected-cap')
            seen.add(name)
            output = directory.joinpath(*path.parts)
            output.parent.mkdir(parents=True, exist_ok=True)
            h, size = hashlib.sha256(), 0
            with tf.extractfile(member) as src, output.open('xb') as dst:
                while True:
                    require(time.monotonic() < deadline, 'deadline')
                    data = src.read(65536)
                    if not data:
                        break
                    size += len(data)
                    require(size <= member.size, 'member-length')
                    dst.write(data)
                    h.update(data)
            require(size == member.size, 'member-length')
            output.chmod(0o400)
            selected.append({'path': name, 'bytes': size, 'sha256': h.hexdigest()})
        while reader.read(65536):
            pass
    require(reader.eof, 'frame-eof')
    return {'tarMembers': count, 'selected': selected, 'selectedBytes': total,
            'allThree': set(MEMBERS) == seen, 'decodedBytes': reader.decoded,
            'decodedSha256': reader.hash.hexdigest(), 'frameEOF': reader.eof}

def main():
    with (HERE / 'RUN.lock').open('x') as f:
        f.write('single-known-public-frame-read\n')
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    start = time.monotonic()
    deadline = start + 20
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(Refused('deadline')))
    signal.alarm(22)
    output = Path(tempfile.mkdtemp(prefix='kiro-current-kas-member01-', dir='/private/tmp'))
    result = {'schema': 1, 'status': 'failed', 'fault': 'none', 'output': str(output),
              'targetApplicationBytesRead': 0, 'frameOffset': 302659302, 'frameBytes': 21999416,
              'globalUniquenessProved': False, 'nativeResourceUseProved': False,
              'targetExecutions': 0, 'modelRequests': 0}
    try:
        result['driverSha256Before'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        fd = os.open(TARGET, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as f:
            before = os.fstat(f.fileno())
            require(stat.S_ISREG(before.st_mode) and before.st_size == SIZE, 'target-shape')
            result['beforeStamp'] = stamp(before)
            h = hashlib.sha256()
            remaining = SIZE
            while remaining:
                require(time.monotonic() < deadline, 'deadline')
                data = f.read(min(remaining, 1048576))
                require(bool(data), 'target-short-read')
                remaining -= len(data)
                result['targetApplicationBytesRead'] += len(data)
                h.update(data)
            result['targetSha256'] = h.hexdigest()
            require(h.hexdigest() == SHA, 'target-identity')
            f.seek(result['frameOffset'])
            frame = f.read(result['frameBytes'])
            result['targetApplicationBytesRead'] += len(frame)
            require(len(frame) == result['frameBytes'], 'frame-short-read')
            require(result['targetApplicationBytesRead'] == 458339400, 'read-count')
            z = zstd_api()
            buf = C.create_string_buffer(frame)
            frame_size = z.ZSTD_findFrameCompressedSize(C.addressof(buf), len(frame))
            require(not z.ZSTD_isError(frame_size) and frame_size == len(frame), 'frame-boundary')
            with Decoder(z, frame, deadline) as reader:
                result['archive'] = extract(reader, output, deadline)
            require(result['archive']['allThree'], 'three-members')
            result['compressedSha256'] = hashlib.sha256(frame).hexdigest()
            result['afterStamp'] = stamp(os.fstat(f.fileno()))
            require(result['beforeStamp'] == result['afterStamp'], 'target-changed')
        result['driverSha256After'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        require(result['driverSha256Before'] == result['driverSha256After'], 'driver-changed')
        result['status'] = 'static-public-members'
    except Refused as error:
        result['fault'] = error.args[0]
    except Exception:
        result['fault'] = 'unclassified-static-fault'
    result['elapsedSeconds'] = time.monotonic() - start
    signal.alarm(0)
    with (HERE / 'RESULT.json').open('x') as f:
        json.dump(result, f, indent=2)
        f.write('\n')
    print(json.dumps({'status': result['status'], 'fault': result['fault'], 'result': str(HERE / 'RESULT.json')}))
    return 0 if result['status'] == 'static-public-members' else 1

if __name__ == '__main__':
    raise SystemExit(main())
