#!/usr/bin/env python3
"""Bounded immutable-byte locator. No target code is ever executed."""
from bisect import bisect_right
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import stat
import struct
import subprocess
import uuid

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / 'mac-supervision-primitives-08/capture/launchd.snapshot'
EXPECTED_SHA = '7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09'
EXPECTED_UUID = '3FEC147A-7931-3FCD-BDB9-59C9A814779C'
LITERAL = b'service bootout (%s)\0'
IMPORT = b'_coalition_terminate'


def signed(value, bits):
    return value - (1 << bits) if value & (1 << (bits - 1)) else value


def parse(raw):
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('file cap')
    offset, length = 0, len(raw)
    if raw[:4] in (b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'):
        count = struct.unpack_from('>I', raw, 4)[0]
        if not 1 <= count <= 8:
            raise ValueError('fat count')
        wide = raw[:4] == b'\xca\xfe\xba\xbf'
        choices = []
        for i in range(count):
            values = struct.unpack_from('>IIQQII' if wide else '>IIIII', raw, 8 + i * (32 if wide else 20))
            cpu, subtype, off, size = values[:4]
            if off + size > len(raw):
                raise ValueError('fat range')
            if cpu == 0x100000c and subtype & 0xffffff == 2:
                choices.append((off, size))
        if len(choices) != 1:
            raise ValueError('arm64e slice not unique')
        offset, length = choices[0]
    data = raw[offset:offset + length]
    header = struct.unpack_from('<IiiIIIII', data)
    if header[0] != 0xfeedfacf or header[1] != 0x100000c or header[2] & 0xffffff != 2:
        raise ValueError('expected arm64e Mach-O')
    commands, command_bytes = header[4], header[5]
    if commands > 128 or 32 + command_bytes > len(data):
        raise ValueError('load command cap')
    sections, metadata = [], {}
    cursor = 32
    for unused in range(commands):
        command, size = struct.unpack_from('<II', data, cursor)
        if size < 8 or cursor + size > 32 + command_bytes:
            raise ValueError('load command range')
        if command == 0x19:
            segment = struct.unpack_from('<II16sQQQQiiII', data, cursor)
            if segment[9] > 128 or 72 + segment[9] * 80 > size:
                raise ValueError('section cap')
            if segment[2].rstrip(b'\0') == b'__TEXT':
                metadata['base'] = segment[3]
            for i in range(segment[9]):
                v = struct.unpack_from('<16s16sQQIIIIIIII', data, cursor + 72 + i * 80)
                sections.append({'name': v[0].rstrip(b'\0').decode('ascii'), 'segment': v[1].rstrip(b'\0').decode('ascii'), 'va': v[2], 'size': v[3], 'offset': v[4], 'flags': v[8], 'indirectStart': v[9], 'stubWidth': v[10]})
        elif command == 0x1b:
            metadata['uuid'] = str(uuid.UUID(bytes=data[cursor + 8:cursor + 24])).upper()
        elif command == 0x26:
            metadata['startsOffset'], metadata['startsSize'] = struct.unpack_from('<II', data, cursor + 8)
        elif command == 2:
            metadata['symbolsOffset'], metadata['symbolsCount'], metadata['stringsOffset'], metadata['stringsSize'] = struct.unpack_from('<IIII', data, cursor + 8)
        elif command == 0xb:
            values = struct.unpack_from('<20I', data, cursor)
            metadata['indirectOffset'], metadata['indirectCount'] = values[14:16]
        cursor += size
    if cursor != 32 + command_bytes:
        raise ValueError('load command total')
    def region(off, size):
        if off < 0 or size < 0 or off + size > len(data):
            raise ValueError('metadata region')
        return data[off:off + size]
    text = [s for s in sections if (s['segment'], s['name']) == ('__TEXT', '__text')]
    cstrings = [s for s in sections if (s['segment'], s['name']) == ('__TEXT', '__cstring')]
    if len(text) != 1 or len(cstrings) != 1 or text[0]['size'] > 512 * 1024 or text[0]['size'] % 4:
        raise ValueError('text/string section scope')
    region(text[0]['offset'], text[0]['size'])
    strings = region(cstrings[0]['offset'], cstrings[0]['size'])
    hits, at = [], 0
    while True:
        found = strings.find(LITERAL, at)
        if found < 0:
            break
        hits.append(found)
        at = found + 1
    if len(hits) != 1:
        raise ValueError('literal not unique within arm64e cstrings')
    metadata['literalVA'] = cstrings[0]['va'] + hits[0]
    metadata['literalFileOffset'] = offset + cstrings[0]['offset'] + hits[0]
    starts, accumulated, value, shift = [], 0, 0, 0
    encoded = region(metadata['startsOffset'], metadata['startsSize'])
    if len(encoded) > 64 * 1024:
        raise ValueError('starts byte cap')
    terminated = False
    for byte in encoded:
        value |= (byte & 127) << shift
        if byte & 128:
            shift += 7
            if shift > 63:
                raise ValueError('uleb overflow')
            continue
        if value == 0:
            terminated = True
            break
        accumulated += value
        starts.append(metadata['base'] + accumulated)
        if len(starts) > 10000:
            raise ValueError('starts count cap')
        value, shift = 0, 0
    if not terminated:
        raise ValueError('unterminated starts')
    symbols = region(metadata['symbolsOffset'], metadata['symbolsCount'] * 16)
    symbol_strings = region(metadata['stringsOffset'], metadata['stringsSize'])
    indexes = set()
    for i in range(metadata['symbolsCount']):
        name_index = struct.unpack_from('<I', symbols, i * 16)[0]
        if symbol_strings[name_index:name_index + len(IMPORT) + 1] == IMPORT + b'\0':
            indexes.add(i)
    indirect = region(metadata['indirectOffset'], metadata['indirectCount'] * 4)
    stubs = []
    for section in sections:
        if section['flags'] & 255 != 8:
            continue
        width = section['stubWidth']
        if not width or section['size'] % width:
            raise ValueError('stub width')
        region(section['offset'], section['size'])
        for i in range(section['size'] // width):
            idx = section['indirectStart'] + i
            if idx >= metadata['indirectCount']:
                raise ValueError('indirect range')
            if struct.unpack_from('<I', indirect, idx * 4)[0] in indexes:
                stubs.append({'va': section['va'] + i * width, 'fileOffset': offset + section['offset'] + i * width, 'bytes': width, 'section': section['name']})
    if not stubs:
        raise ValueError('selected import stub unavailable')
    metadata.update({'sliceOffset': offset, 'sliceBytes': length, 'sliceSHA256': hashlib.sha256(data).hexdigest(), 'text': text[0], 'starts': starts, 'selectedImportStubs': stubs, 'data': data})
    return metadata


def find_xrefs(code, base, target):
    refs = []
    for off in range(0, len(code), 4):
        word = struct.unpack_from('<I', code, off)[0]
        pc = base + off
        immediate = signed(((word >> 5) & 0x7ffff) << 2 | (word >> 29) & 3, 21)
        if word & 0x9f000000 == 0x10000000 and pc + immediate == target:
            refs.append({'va': pc, 'kind': 'ADR'})
        elif word & 0x9f000000 == 0x90000000 and off + 8 <= len(code):
            following = struct.unpack_from('<I', code, off + 4)[0]
            if following & 0xff000000 == 0x91000000 and (following >> 5) & 31 == word & 31:
                add = ((following >> 10) & 4095) << (12 if following & (1 << 22) else 0)
                if (pc & ~4095) + (immediate << 12) + add == target:
                    refs.append({'va': pc, 'addVA': pc + 4, 'kind': 'adjacent ADRP+ADD'})
    return refs


def direct_branches(code, base, target_stubs):
    rows = []
    for off in range(0, len(code), 4):
        word = struct.unpack_from('<I', code, off)[0]
        opcode = word & 0xfc000000
        if opcode in (0x94000000, 0x14000000):
            target = base + off + (signed(word & 0x3ffffff, 26) << 2)
            rows.append({'va': base + off, 'kind': 'BL' if opcode == 0x94000000 else 'B', 'target': target, 'selectedImportStub': target in target_stubs})
    return rows


def make_carrier(code, address):
    command_size, file_offset = 152, 184
    header = struct.pack('<IiiIIIII', 0xfeedfacf, 0x100000c, -2147483646, 1, 1, command_size, 0, 0)
    segment = struct.pack('<II16sQQQQiiII', 0x19, command_size, b'__TEXT', address, len(code), file_offset, len(code), 7, 5, 1, 0)
    section = struct.pack('<16s16sQQIIIIIIII', b'__text', b'__TEXT', address, len(code), file_offset, 2, 0, 0, 0x80000400, 0, 0, 0)
    return header + segment + section + code


def main():
    out = HERE / 'results'
    out.mkdir(mode=0o700)
    fd = os.open(str(SOURCE), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > 2 * 1024 * 1024:
            raise ValueError('snapshot type/size')
        raw = stream.read(2 * 1024 * 1024 + 1)
        after = os.fstat(stream.fileno())
    stable_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
    stable_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
    if len(raw) != 1236160 or hashlib.sha256(raw).hexdigest() != EXPECTED_SHA or stable_before != stable_after:
        raise ValueError('snapshot binding')
    parsed = parse(raw)
    if parsed['uuid'] != EXPECTED_UUID:
        raise ValueError('snapshot slice UUID')
    data, text = parsed['data'], parsed['text']
    code = data[text['offset']:text['offset'] + text['size']]
    refs = find_xrefs(code, text['va'], parsed['literalVA'])
    result = {k: v for k, v in parsed.items() if k not in ('data', 'starts')}
    result.update({'sourceSHA256': EXPECTED_SHA, 'functionStartsCount': len(parsed['starts']), 'xrefPatterns': 'ADR and adjacent ADRP+ADD only, not exhaustive', 'xrefs': refs, 'functions': [], 'calls': [], 'targetRuns': 0, 'controlAPICalls': 0, 'officialRuns': 0, 'modelRequests': 0})
    if len(refs) > 16:
        raise ValueError('xref count cap')
    ranges = set()
    for ref in refs:
        idx = bisect_right(parsed['starts'], ref['va']) - 1
        if idx < 0:
            raise ValueError('xref before first function')
        begin = parsed['starts'][idx]
        end = min(parsed['starts'][idx + 1] if idx + 1 < len(parsed['starts']) else text['va'] + text['size'], text['va'] + text['size'])
        if not text['va'] <= begin <= ref['va'] < end or end - begin > 4096:
            raise ValueError('immediate function range/cap')
        ranges.add((begin, end))
    if len(ranges) > 2:
        raise ValueError('function count cap')
    def limits():
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        resource.setrlimit(resource.RLIMIT_FSIZE, (512 * 1024, 512 * 1024))
    for index, (begin, end) in enumerate(sorted(ranges), 1):
        local_offset = text['offset'] + begin - text['va']
        body = data[local_offset:local_offset + end - begin]
        tag = '%02d-function' % index
        carrier = out / (tag + '.macho')
        with carrier.open('xb') as stream:
            stream.write(make_carrier(body, begin))
            os.fchmod(stream.fileno(), 0o400)
        argv = ['/usr/bin/otool', '-arch', 'arm64e', '-tvV', str(carrier)]
        with (out / (tag + '.stdout')).open('xb') as stdout, (out / (tag + '.stderr')).open('xb') as stderr:
            child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, env={'HOME': str(out), 'TMPDIR': str(out) + '/', 'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}, preexec_fn=limits)
            timed_out = False
            try:
                rc = child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                timed_out = True
                child.kill()
                rc = child.wait(timeout=2)
        result['calls'].append({'argv': argv, 'pid': child.pid, 'exit': rc, 'timedOut': timed_out, 'streams': 'regular files, original held child waited; not pipe EOF/full-tree proof'})
        result['functions'].append({'beginVA': begin, 'endVAExclusive': end, 'bytes': len(body), 'fullFileOffset': parsed['sliceOffset'] + local_offset, 'sourceBytesSHA256': hashlib.sha256(body).hexdigest(), 'syntheticCarrierNotOriginalImage': True, 'directBranches': direct_branches(body, begin, {s['va'] for s in parsed['selectedImportStubs']})})
    result['status'] = 'located_bounded_static_function' if refs else 'not_located_by_limited_patterns'
    result['artifacts'] = []
    total = 0
    for path in sorted(out.iterdir()):
        raw = path.read_bytes()
        total += len(raw)
        path.chmod(0o400)
        result['artifacts'].append({'name': path.name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    if total > 4 * 1024 * 1024:
        raise ValueError('output total cap')
    with (out / 'manifest.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    print(json.dumps({'status': result['status'], 'xrefs': refs, 'functions': len(result['functions']), 'selectedStubDirectBranches': [b for f in result['functions'] for b in f['directBranches'] if b['selectedImportStub']], 'calls': result['calls']}))
    if not refs:
        return 0  # Completed a limited negative locator observation, not a positive function result.
    return 0 if result['calls'] and all(c['exit'] == 0 and not c['timedOut'] for c in result['calls']) else 1


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (10, 11))
    signal.alarm(30)
    raise SystemExit(main())
