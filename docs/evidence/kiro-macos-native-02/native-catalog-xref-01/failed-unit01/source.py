"""Frozen-public ARM64 syntactic catalog references. Import performs no I/O."""
import bisect
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

SOURCE = '/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-mac-identity-rebind01-vni48j5_/kiro-cli-chat.macho'
SLICE = 215023616
TEXT_OFFSET = 4352
TEXT_SIZE = 69216304
TEXT_VA = 0x100001100
IMAGE = 0x100000000
TABLE_OFFSET = 197396912
TABLE_SIZE = 194104
HEADER_SHA = '35a67ed702261a287c55dd94d3b6e5a1b13b782694ad2fa9ff75abafb7a0361d'
TEXT_SHA = '7637a1d526d191ee8775602fd29587adab45f667eed8a9752946246b34c030f8'
TABLE_SHA = 'b501bc1a04fe6296a2d418b4c2b7d558d393d1e5954180a6d31c12cb63d5a82e'
ANCHORS = {'field': 0x104826e78, 'required': 0x10482dba3,
    'flag': 0x1048273a4, 'format': 0x10482a9c1}


def adrp(word, pc):
    if word & 0x9f000000 != 0x90000000 or word & 31 == 31:
        return None
    immediate = ((word >> 5) & 0x7ffff) * 4 + ((word >> 29) & 3)
    if immediate & (1 << 20):
        immediate -= 1 << 21
    return ((pc & ~4095) + (immediate << 12), word & 31)


def add_address(word, page, register):
    if (word & 0xff800000 != 0x91000000 or register == 31
            or (word >> 5) & 31 != register or word & 31 == 31):
        return None
    return page + (((word >> 10) & 4095) << (12 if word & (1 << 22) else 0))


def function_starts(raw, image, lower, upper):
    if type(raw) is not bytes or not 0 < len(raw) <= TABLE_SIZE or not image <= lower < upper:
        raise ValueError()
    starts = []
    address = image
    value = shift = 0
    for position, byte in enumerate(raw):
        if shift >= 64 or (shift == 63 and byte & 127 > 1):
            raise ValueError()
        value |= (byte & 127) << shift
        if byte & 128:
            shift += 7
            continue
        if shift and byte == 0:
            raise ValueError()
        if value == 0:
            if not starts or any(raw[position + 1:]):
                raise ValueError()
            return starts
        address += value
        if not lower <= address < upper:
            raise ValueError()
        starts.append(address)
        value = shift = 0
    raise ValueError()


def read_at(fd, offset, length):
    if type(offset) is not int or type(length) is not int or offset < 0 or not 0 < length <= TEXT_SIZE:
        raise ValueError()
    os.lseek(fd, offset, os.SEEK_SET)
    parts = []
    remaining = length
    while remaining:
        part = os.read(fd, min(4 * 1024 * 1024, remaining))
        if not part:
            raise ValueError()
        parts.append(part)
        remaining -= len(part)
    return b''.join(parts)


def stable(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mode,
        info.st_uid, info.st_mtime_ns, info.st_ctime_ns)


def expired(_signal, _frame):
    raise TimeoutError()


def scan(text, starts):
    names = {value: key for key, value in ANCHORS.items()}
    pages = {address & ~4095 for address in names}
    counts = {key: 0 for key in ANCHORS}
    hits = []
    page_hits = 0
    for index, (word,) in enumerate(struct.iter_unpack('<I', text)):
        # Avoid function-call overhead for all ordinary instruction words.
        if word & 0x9f000000 != 0x90000000:
            continue
        pc = TEXT_VA + index * 4
        decoded = adrp(word, pc)
        if decoded is None or decoded[0] not in pages:
            continue
        page, register = decoded
        page_hits += 1
        function_index = bisect.bisect_right(starts, pc) - 1
        if function_index < 0:
            continue
        end = starts[function_index + 1] if function_index + 1 < len(starts) else TEXT_VA + len(text)
        for delta in range(1, 9):
            at = (index + delta) * 4
            if at + 4 > len(text) or pc + delta * 4 >= end:
                break
            following = struct.unpack_from('<I', text, at)[0]
            target = add_address(following, page, register)
            if target not in names:
                continue
            name = names[target]
            if counts[name] >= 17:
                continue
            counts[name] += 1
            if counts[name] > 16:
                continue
            hits.append({'anchor': name, 'target': hex(target), 'adrpPc': hex(pc),
                'adrpWord': hex(word), 'addPc': hex(pc + delta * 4), 'addWord': hex(following),
                'register': register, 'syntacticOnly': True,
                'functionStart': hex(starts[function_index]), 'upperBound': hex(end),
                'boundIsNextStart': function_index + 1 < len(starts),
                'rangeBytes': end - starts[function_index]})
    return counts, hits, page_hits


def run_once(root):
    begin = time.monotonic()
    resource.setrlimit(resource.RLIMIT_CPU, (20, 25))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    resource.setrlimit(resource.RLIMIT_FSIZE, (65536, 65536))
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(30)
    root = Path(root)
    info = root.lstat()
    if (not root.is_absolute() or root.parent != Path('/private/tmp')
            or not root.name.startswith('kiro-native-catalog-xref01-')
            or not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700
            or info.st_uid != os.getuid()):
        raise ValueError()
    with (root / 'RUN_ONCE').open('xb') as marker:
        marker.write(b'native-catalog-xref-1\n')
    fd = os.open(SOURCE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_size != 413051920
                or stat.S_IMODE(before.st_mode) != 0o400 or before.st_uid != os.getuid()):
            raise ValueError()
        header = read_at(fd, SLICE, 4352)
        table = read_at(fd, SLICE + TABLE_OFFSET, TABLE_SIZE)
        text = read_at(fd, SLICE + TEXT_OFFSET, TEXT_SIZE)
        if (hashlib.sha256(header).hexdigest() != HEADER_SHA
                or hashlib.sha256(table).hexdigest() != TABLE_SHA
                or hashlib.sha256(text).hexdigest() != TEXT_SHA
                or stable(before) != stable(os.fstat(fd))):
            raise ValueError()
    finally:
        os.close(fd)
    starts = function_starts(table, IMAGE, TEXT_VA, TEXT_VA + TEXT_SIZE)
    counts, hits, page_hits = scan(text, starts)
    complete = all(value <= 16 for value in counts.values())
    report = {'schema': 'native-catalog-xref-1', 'status': 'bounded-locations' if complete else 'match-cap',
        'readBytes': 4352 + TABLE_SIZE + TEXT_SIZE, 'sourceFDStable': True,
        'freshWholeFileHash': False, 'knownTextHashMatches': True, 'knownTableHashMatches': True,
        'headerSHA': HEADER_SHA, 'textSHA': TEXT_SHA, 'tableSHA': TABLE_SHA,
        'anchors': {key: hex(value) for key, value in ANCHORS.items()},
        'functionStarts': len(starts), 'countsCappedAt17': counts, 'countsComplete': complete,
        'selectedPagesAdrpCount': page_hits, 'hits': hits,
        'nativeDispatchProved': False, 'catalogGrammarProved': False,
        'modelAvailabilityProved': False, 'modelRequests': 0,
        'boundary': 'ADRP-nearbyADD-syntactic-only-no-clobber-CFG-indirect-coverage',
        'elapsedSecondsBeforePublication': time.monotonic() - begin}
    encoded = (json.dumps(report, sort_keys=True, indent=2) + '\n').encode()
    if len(encoded) > 48 * 1024:
        raise ValueError()
    with (root / 'locations.json').open('xb') as output:
        output.write(encoded)
    print(json.dumps({'status': report['status'], 'readBytes': report['readBytes'],
        'reportBytes': len(encoded), 'modelRequests': 0}))
    return 0 if complete else 2


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError()
        code = run_once(sys.argv[1])
    except BaseException:
        try:
            signal.alarm(0)
            os.write(1, b'{"status":"static-xref-failed","modelRequests":0}\n')
        except BaseException:
            pass
        code = 1
    raise SystemExit(code)
