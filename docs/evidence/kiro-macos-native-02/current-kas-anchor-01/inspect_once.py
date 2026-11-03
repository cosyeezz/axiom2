#!/usr/bin/env python3
"""Current public anchor-adjacent resource only; not native-use or runtime proof."""
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
        f.write('single-current-artifact-static-read\n')
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    start = time.monotonic()
    deadline = start + 20
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(Refused('deadline')))
    signal.alarm(22)
    output = Path(tempfile.mkdtemp(prefix='kiro-current-kas-anchor01-', dir='/private/tmp'))
    result = {'schema': 1, 'status': 'failed', 'fault': 'none', 'output': str(output),
              'targetApplicationBytesRead': 0, 'candidates': [], 'matches': [],
              'targetExecutions': 0, 'modelRequests': 0, 'nativeResourceUseProved': False}
    def read_at(f, offset, size):
        require(time.monotonic() < deadline, 'deadline')
        require(0 <= offset <= SIZE and 0 <= size <= SIZE - offset, 'file-range')
        f.seek(offset)
        b = f.read(size)
        result['targetApplicationBytesRead'] += len(b)
        require(result['targetApplicationBytesRead'] <= 600 * 1024 * 1024, 'read-cap')
        require(len(b) == size, 'short-read')
        return b
    try:
        fd = os.open(TARGET, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as f:
            before = os.fstat(f.fileno())
            require(stat.S_ISREG(before.st_mode) and before.st_size == SIZE, 'target-shape')
            result['beforeStamp'] = stamp(before)
            header = read_at(f, 0, 4096)
            magic, count = struct.unpack_from('>II', header)
            require(magic == 0xcafebabe and 1 <= count <= 8, 'fat-header')
            arms = [struct.unpack_from('>IIIII', header, 8 + 20 * i) for i in range(count)]
            arms = [a for a in arms if a[0] == 0x0100000c]
            require(len(arms) == 1, 'arm-slice')
            _, _, offset, size, _ = arms[0]
            require(offset <= SIZE and size <= SIZE - offset, 'slice-range')
            thin = read_at(f, offset, 32)
            magic, cpu, _, _, ncmds, commands_size, _, _ = struct.unpack('<8I', thin)
            require(magic == 0xfeedfacf and cpu == 0x0100000c and ncmds <= 256 and commands_size <= 65504, 'thin-header')
            commands = read_at(f, offset + 32, commands_size)
            cursor, consts = 0, []
            for _ in range(ncmds):
                require(cursor + 8 <= len(commands), 'load-command')
                cmd, length = struct.unpack_from('<II', commands, cursor)
                require(length >= 8 and cursor + length <= len(commands), 'load-command')
                if cmd == 0x19:
                    require(length >= 72, 'segment-command')
                    sections = struct.unpack_from('<I', commands, cursor + 64)[0]
                    require(sections <= 128 and 72 + 80 * sections <= length, 'section-table')
                    for j in range(sections):
                        pos = cursor + 72 + 80 * j
                        name = commands[pos:pos+16].split(b'\0', 1)[0]
                        segment = commands[pos+16:pos+32].split(b'\0', 1)[0]
                        if name == b'__const' and segment == b'__TEXT':
                            address, size_const, off_const = struct.unpack_from('<QQI', commands, pos + 32)
                            require(off_const <= size and size_const <= size - off_const, 'const-range')
                            consts.append((offset + off_const, size_const, address))
                cursor += length
            require(cursor == len(commands) and len(consts) == 1, 'const-section')
            begin, length, address = consts[0]
            result['layout'] = {'armOffset': offset, 'armBytes': size, 'constOffset': begin, 'constBytes': length, 'constVA': hex(address)}
            h, tail, hits = hashlib.sha256(), b'', []
            needle = b'KIRO_KAS_NODE_PATH'
            for pos in range(0, SIZE, 1048576):
                b = read_at(f, pos, min(1048576, SIZE - pos))
                h.update(b)
                lo, hi = max(pos, begin), min(pos + len(b), begin + length)
                if lo < hi:
                    scan = tail + b[lo-pos:hi-pos]
                    at = 0
                    while True:
                        hit = scan.find(needle, at)
                        if hit < 0:
                            break
                        hits.append(lo - len(tail) + hit)
                        require(len(hits) <= 4, 'anchor-cap')
                        at = hit + 1
                    tail = scan[-(len(needle) - 1):]
            result['targetSha256'] = h.hexdigest()
            require(h.hexdigest() == SHA, 'target-identity')
            result['anchorOffsets'] = hits
            require(bool(hits), 'anchor-absent')
            z, adjacent = zstd_api(), []
            for anchor_index, anchor in enumerate(hits):
                window_start = max(begin, anchor - CAP)
                data = read_at(f, window_start, anchor - window_start)
                magic_offsets, at = [], 0
                while True:
                    hit = data.find(b'\x28\xb5\x2f\xfd', at)
                    if hit < 0:
                        break
                    magic_offsets.append(hit)
                    require(len(magic_offsets) <= 8, 'window-candidate-cap')
                    at = hit + 1
                for relative in magic_offsets:
                    suffix = data[relative:]
                    buf = C.create_string_buffer(suffix)
                    frame_size = z.ZSTD_findFrameCompressedSize(C.addressof(buf), len(suffix))
                    record = {'anchorIndex': anchor_index, 'anchorOffset': anchor,
                              'fileOffset': window_start + relative, 'frameBytes': None,
                              'endsAtAnchor': False, 'prefixKind': 'invalid-or-over-window'}
                    result['candidates'].append(record)
                    if z.ZSTD_isError(frame_size):
                        continue
                    require(0 < frame_size <= len(suffix), 'frame-size')
                    record['frameBytes'] = frame_size
                    record['endsAtAnchor'] = frame_size == len(suffix)
                    record['prefixKind'] = 'not-inspected'
                    if not record['endsAtAnchor']:
                        continue
                    with Decoder(z, suffix, deadline) as reader:
                        prefix = reader.pump(512)
                    record['prefixKind'] = 'ustar' if len(prefix) == 512 and prefix[257:262] == b'ustar' else 'other'
                    if record['prefixKind'] == 'ustar':
                        adjacent.append((len(result['candidates']) - 1, suffix))
            require(len(adjacent) == 1, 'unique-adjacent-tar')
            index, frame = adjacent[0]
            dest = output / ('candidate-' + str(index))
            dest.mkdir(mode=0o700)
            with Decoder(z, frame, deadline) as reader:
                extracted = extract(reader, dest, deadline)
            result['candidates'][index].update(extracted)
            result['candidates'][index]['compressedSha256'] = hashlib.sha256(frame).hexdigest()
            require(extracted['allThree'], 'three-members')
            result['matches'].append({'index': index, 'directory': str(dest)})
            after = os.fstat(f.fileno())
            result['afterStamp'] = stamp(after)
            require(stamp(before) == stamp(after), 'target-changed')
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
