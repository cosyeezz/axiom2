"""Bounded readonly public Mach-O anchor locator. Never executes the target.

Import exposes helpers only. Main requires a separately created private namespace.
Strings are navigation, not native dispatch, catalog grammar or runtime evidence.
"""
import base64
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
FILE_BYTES = 413051920
SLICE_OFFSET = 215023616
SLICE_BYTES = 198028304
UUID = '850598ce04bb35bc8a877bb30f91bd0e'
CONST_SHA = 'ea141e9638c904d2bcb79a00a3b022810da094b2d8f757229081e6539202550d'
SECTION_META = {
    '__cstring': (69237024, 1271569, 0x104207920),
    '__const': (73916416, 112409560, 0x10467e000),
}
NEEDLES = (
    b'list-models', b'list_models', b'json-pretty',
    b'List available models and exit', b'Failed to list models',
    b'No models available', b'Available models:',
)
MAX_HEADER = 4352
CHUNK = 512 * 1024
MAX_MATCHES = 16
MAX_REPORT = 48 * 1024


def parse_header(data):
    """Bounded thin ARM64 header/commands only; returns selected public metadata."""
    if type(data) is not bytes or not 32 <= len(data) <= MAX_HEADER:
        raise ValueError()
    magic, cpu, subtype, filetype, ncmds, sizeofcmds, flags, reserved = struct.unpack_from('<8I', data)
    if (magic != 0xfeedfacf or cpu != 0x100000c or filetype != 2
            or not 1 <= ncmds <= 64 or sizeofcmds > MAX_HEADER - 32
            or sizeofcmds + 32 > len(data)):
        raise ValueError()
    position = 32
    limit = 32 + sizeofcmds
    selected = {}
    uuid = None
    for _ in range(ncmds):
        if position + 8 > limit:
            raise ValueError()
        command, size = struct.unpack_from('<II', data, position)
        if size < 8 or size % 8 or position + size > limit:
            raise ValueError()
        if command == 0x1b:
            if size != 24 or uuid is not None:
                raise ValueError()
            uuid = data[position + 8:position + 24].hex()
        elif command == 0x19:
            if size < 72:
                raise ValueError()
            fields = struct.unpack_from('<II16sQQQQiiII', data, position)
            segment, vmaddr, vmsize, fileoff, filesize = fields[2:7]
            nsects = fields[9]
            if nsects > 32 or size != 72 + 80 * nsects:
                raise ValueError()
            for i in range(nsects):
                s = struct.unpack_from('<16s16sQQ8I', data, position + 72 + 80 * i)
                name, owner, address, length, offset = s[:5]
                if segment == b'__TEXT' + b'\0' * 10 and owner == segment:
                    label = name.rstrip(b'\0')
                    if label in (b'__cstring', b'__const'):
                        key = label.decode('ascii')
                        if (key in selected or length <= 0 or offset < fileoff
                                or offset + length > fileoff + filesize
                                or address < vmaddr or address + length > vmaddr + vmsize
                                or address - vmaddr != offset - fileoff):
                            raise ValueError()
                        selected[key] = (offset, length, address)
        position += size
    if position != limit:
        raise ValueError()
    return {'uuid': uuid, 'ncmds': ncmds, 'sizeofcmds': sizeofcmds, 'sections': selected}


def match_block(block, base, prior_end, needles, counts, records):
    """Scan one chunk+overlap. Count 17 means lower bound, not exact total."""
    for index, needle in enumerate(needles):
        if counts[index] > MAX_MATCHES:
            continue
        start = 0
        while True:
            found = block.find(needle, start)
            if found < 0:
                break
            start = found + 1
            absolute = base + found
            if absolute + len(needle) <= prior_end:
                continue  # Previously complete occurrence in carried overlap.
            counts[index] += 1
            if counts[index] > MAX_MATCHES:
                break
            left = max(0, found - 32)
            context = block[left:min(len(block), left + 96)]
            records.append({'needle': index, 'offset': absolute,
                'contextOffset': base + left,
                'contextBase64': base64.b64encode(context).decode('ascii')})


def scan_section(fd, slice_offset, metadata, counts):
    offset, length, address = metadata
    os.lseek(fd, slice_offset + offset, os.SEEK_SET)
    digest = hashlib.sha256()
    records = []
    position = 0
    carry = b''
    overlap = max(96, max(map(len, NEEDLES)) - 1)
    while position < length:
        part = os.read(fd, min(CHUNK, length - position))
        if not part:
            raise ValueError()
        digest.update(part)
        block = carry + part
        match_block(block, position - len(carry), position, NEEDLES, counts, records)
        position += len(part)
        carry = block[-overlap:]
    for record in records:
        record['sliceOffset'] = offset + record['offset']
        record['VA'] = hex(address + record['offset'])
    return {'bytesRead': position, 'sha256': digest.hexdigest(),
        'cumulativeCountsCappedAt17': list(counts), 'countsComplete': all(n <= MAX_MATCHES for n in counts),
        'matches': records}


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
        info.st_ctime_ns, info.st_mode, info.st_uid)


def expired(_signal, _frame):
    raise TimeoutError()


def run_once(root):
    # This static worker never launches a normal-state process.
    started = time.monotonic()
    resource.setrlimit(resource.RLIMIT_CPU, (5, 6))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    resource.setrlimit(resource.RLIMIT_FSIZE, (65536, 65536))
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(10)
    root = Path(root)
    info = root.lstat()
    if (not root.is_absolute() or root.parent != Path('/private/tmp')
            or not root.name.startswith('kiro-native-catalog-locate01-')
            or not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700
            or info.st_uid != os.getuid()):
        raise ValueError()
    with (root / 'RUN_ONCE').open('xb') as marker:
        marker.write(b'native-catalog-locate-1\n')
    fd = os.open(SOURCE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_size != FILE_BYTES
                or before.st_uid != os.getuid() or stat.S_IMODE(before.st_mode) != 0o400):
            raise ValueError()
        os.lseek(fd, SLICE_OFFSET, os.SEEK_SET)
        header = os.read(fd, MAX_HEADER)
        parsed = parse_header(header)
        if (parsed['uuid'] != UUID or parsed['ncmds'] != 32
                or parsed['sizeofcmds'] != 4072 or parsed['sections'] != SECTION_META):
            raise ValueError()
        counts = [0] * len(NEEDLES)
        scans = {key: scan_section(fd, SLICE_OFFSET, meta, counts)
            for key, meta in SECTION_META.items()}
        if scans['__const']['sha256'] != CONST_SHA or identity(before) != identity(os.fstat(fd)):
            raise ValueError()
    finally:
        os.close(fd)
    complete = all(v['countsComplete'] for v in scans.values())
    report = {'schema': 'native-catalog-locate-1', 'status': 'bounded-locations' if complete else 'match-cap',
        'boundary': 'frozen-public-static-only', 'sourceBytes': FILE_BYTES,
        'historicalSourceSHA': '7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f',
        'freshWholeFileHash': False, 'headerSHA': hashlib.sha256(header).hexdigest(),
        'UUID': UUID, 'sliceOffset': SLICE_OFFSET, 'headerBytesRead': len(header),
        'readBytes': len(header) + sum(s['bytesRead'] for s in scans.values()),
        'sourceFDStable': True, 'knownConstHashMatches': True,
        'needles': [x.decode('ascii') for x in NEEDLES], 'sections': scans,
        'nativeDispatchProved': False, 'catalogGrammarProved': False,
        'modelAvailabilityProved': False, 'modelRequests': 0,
        'elapsedSecondsBeforePublication': time.monotonic() - started}
    encoded = (json.dumps(report, sort_keys=True, indent=2) + '\n').encode()
    if len(encoded) > MAX_REPORT:
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
        # Fixed public diagnostic only; never repr/traceback arbitrary data.
        try:
            signal.alarm(0)
            os.write(1, b'{"status":"static-locator-failed","modelRequests":0}\n')
        except BaseException:
            pass
        code = 1
    raise SystemExit(code)
