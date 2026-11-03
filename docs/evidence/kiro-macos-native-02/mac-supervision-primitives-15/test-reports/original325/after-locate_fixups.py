#!/usr/bin/env python3
"""Bounded pure file-format decoding, never executes image code."""
import ast
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import stat
import struct
import uuid

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / 'mac-supervision-primitives-08/capture/launchd.snapshot'
HELPER = HERE.parent / 'mac-supervision-primitives-10/locate_bootout.py'
HELPER_SHA = 'd0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608'
SOURCE_SHA = '7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09'
EXPECTED_UUID = '3FEC147A-7931-3FCD-BDB9-59C9A814779C'
SCHEMA = Path('/Library/Developer/CommandLineTools/SDKs/MacOSX13.3.sdk/usr/include/mach-o/fixup-chains.h')
WRAPPER = 0x10000f60c


def unpack_at(data, fmt, offset):
    size = struct.calcsize(fmt)
    if type(offset) is not int or offset < 0 or offset + size > len(data):
        raise ValueError('field range')
    return struct.unpack_from(fmt, data, offset)


def metadata(data):
    header = unpack_at(data, '<IiiIIIII', 0)
    if header[0] != 0xfeedfacf or header[1] != 0x100000c or header[2] & 0xffffff != 2:
        raise ValueError('arm64e header')
    count, command_bytes = header[4:6]
    if not 1 <= count <= 128 or 32 + command_bytes > len(data):
        raise ValueError('load command cap')
    cursor, segments, fixups = 32, [], []
    for unused in range(count):
        command, size = unpack_at(data, '<II', cursor)
        if size < 8 or size % 8 or cursor + size > 32 + command_bytes:
            raise ValueError('load command range')
        if command == 0x19:
            if size < 72:
                raise ValueError('segment command')
            nsects = unpack_at(data, '<I', cursor + 64)[0]
            if nsects > 128 or 72 + 80 * nsects > size:
                raise ValueError('section table storage')
            name, va, vsize, off, fsize = unpack_at(data, '<16sQQQQ', cursor + 8)
            if off + fsize > len(data) or fsize > vsize or va + vsize >= 1 << 64:
                raise ValueError('segment range')
            segments.append({'name': name.rstrip(b'\0').decode('ascii'), 'va': va, 'vsize': vsize, 'offset': off, 'bytes': fsize})
        elif command == 0x80000034:
            if size != 16:
                raise ValueError('fixups command')
            fixups.append(unpack_at(data, '<II', cursor + 8))
        cursor += size
    if cursor != 32 + command_bytes or len(fixups) != 1 or not 1 <= len(segments) <= 32:
        raise ValueError('metadata cardinality')
    texts = [s for s in segments if s['name'] == '__TEXT' and s['offset'] == 0 and s['bytes'] >= 32 + command_bytes]
    if len(texts) != 1:
        raise ValueError('image base')
    base = texts[0]['va']
    off, size = fixups[0]
    if not 28 <= size <= 128 * 1024 or off + size > len(data):
        raise ValueError('fixups payload range')
    payload = data[off:off + size]
    version, starts, imports, symbols, imports_count, imports_format, symbols_format = unpack_at(payload, '<7I', 0)
    if version != 0 or imports_count > 65536 or imports_format not in (1, 2, 3) or symbols_format not in (0, 1):
        raise ValueError('fixups header format')
    import_width = {1: 4, 2: 8, 3: 16}[imports_format]
    if not 28 <= starts < len(payload) or imports < 28 or imports + imports_count * import_width > len(payload) or not 28 <= symbols <= len(payload):
        raise ValueError('fixups header offsets')
    seg_count = unpack_at(payload, '<I', starts)[0]
    if seg_count != len(segments):
        raise ValueError('fixups segment count')
    offsets = unpack_at(payload, '<%dI' % seg_count, starts + 4)
    records = []
    occupied = [(0, 28), (starts, starts + 4 + 4 * seg_count), (imports, imports + imports_count * import_width), (symbols, len(payload))]
    occupied = sorted((a, b) for a, b in occupied if a < b)
    if any(a[1] > b[0] for a, b in zip(occupied, occupied[1:])):
        raise ValueError('overlapping payload regions outside supported contract')
    for index, relative in enumerate(offsets):
        if relative == 0:
            continue
        if relative < 4 + 4 * seg_count:
            raise ValueError('segment info overlaps index')
        at = starts + relative
        length, page_size, fmt, segment_offset, max_valid, pages = unpack_at(payload, '<IHHQIH', at)
        if pages > 512 or length < 22 + 2 * pages or at + length > len(payload) or page_size not in (4096, 16384):
            raise ValueError('page root range')
        if any(not (at + length <= a or at >= b) for a, b in occupied):
            raise ValueError('overlapping segment info')
        occupied.append((at, at + length))
        segment = segments[index]
        if segment_offset != segment['va'] - base or pages > (segment['vsize'] + page_size - 1) // page_size:
            raise ValueError('segment root mapping')
        roots = unpack_at(payload, '<%dH' % pages, at + 22)
        records.append({'segmentIndex': index, 'size': length, 'pageSize': page_size, 'pointerFormat': fmt, 'segmentOffset': segment_offset, 'maxValidPointer': max_valid, 'pageStarts': list(roots)})
    return {'base': base, 'segments': segments, 'fixupsOffset': off, 'fixupsBytes': size, 'importsCount': imports_count, 'importsFormat': imports_format, 'symbolsFormat': symbols_format, 'records': records}


def decode_pointer(word, fmt, base):
    if type(word) is not int or not 0 <= word < 1 << 64 or type(base) is not int or not 0 <= base < 1 << 64:
        raise ValueError('pointer scalar')
    if fmt not in (1, 9, 12):
        raise ValueError('unsupported pointer format')
    bind, auth, following = (word >> 62) & 1, (word >> 63) & 1, (word >> 51) & 2047
    row = {'rawHex': '%016x' % word, 'format': fmt, 'bind': bool(bind), 'auth': bool(auth), 'nextCount': following, 'targetVA': None}
    if auth:
        row.update({'diversity': (word >> 32) & 65535, 'addrDiv': bool((word >> 48) & 1), 'key': (word >> 49) & 3})
    if bind:
        width = 24 if fmt == 12 else 16
        if (word >> width) & ((1 << (32 - width)) - 1):
            raise ValueError('bind reserved bits')
        row['ordinal'] = word & ((1 << width) - 1)
    elif auth:
        target = base + (word & 0xffffffff)
        if target >= 1 << 64:
            raise ValueError('auth target overflow')
        row['targetVA'] = target
    else:
        low, high8 = word & ((1 << 43) - 1), (word >> 43) & 255
        low = low if fmt == 1 else base + low
        if low >= 1 << 56:
            raise ValueError('rebase target overflow')
        row['targetVA'] = low | (high8 << 56)
    return row


def walk_chains(data, meta):
    rows, seen = [], set()
    for record in meta['records']:
        fmt = record['pointerFormat']
        if fmt not in (1, 9, 12):
            raise ValueError('unsupported pointer format')
        segment = meta['segments'][record['segmentIndex']]
        page_size = record['pageSize']
        for page, root in enumerate(record['pageStarts']):
            if root == 65535:
                continue
            if root & 32768:
                raise ValueError('multi-start outside scope')
            if root % 8 or root + 8 > page_size:
                raise ValueError('page start alignment/range')
            local = page * page_size + root
            while True:
                if local < page * page_size or local + 8 > (page + 1) * page_size or local + 8 > segment['bytes']:
                    raise ValueError('chain escapes page/file segment')
                off = segment['offset'] + local
                if off in seen or len(seen) >= 16384:
                    raise ValueError('duplicate node/count cap')
                seen.add(off)
                word = unpack_at(data, '<Q', off)[0]
                row = decode_pointer(word, fmt, meta['base'])
                if row['bind'] and row['ordinal'] >= meta['importsCount']:
                    raise ValueError('bind ordinal range')
                row.update({'pointerVA': segment['va'] + local, 'sliceFileOffset': off, 'segmentIndex': record['segmentIndex']})
                rows.append(row)
                if row['nextCount'] == 0:
                    break
                local += row['nextCount'] * 8
    return rows


def read_stable(path, cap):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > cap:
            raise ValueError('input type/cap')
        raw = stream.read(cap + 1)
        after = os.fstat(stream.fileno())
    fields = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if len(raw) > cap or fields(before) != fields(after):
        raise ValueError('input changed')
    return raw


def save_json(path, value):
    raw = (json.dumps(value, indent=2) + '\n').encode()
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('output cap')
    with path.open('xb') as stream:
        stream.write(raw)
        os.fchmod(stream.fileno(), 0o400)


def main():
    out = HERE / 'results'
    out.mkdir(mode=0o700)
    raw = read_stable(SOURCE, 2 * 1024 * 1024)
    helper = read_stable(HELPER, 32 * 1024)
    schema = read_stable(SCHEMA, 16 * 1024)
    if len(raw) != 1236160 or hashlib.sha256(raw).hexdigest() != SOURCE_SHA or hashlib.sha256(helper).hexdigest() != HELPER_SHA or len(schema) != 10325:
        raise ValueError('input binding')
    with (out / 'fixup-chains-sdk13.h').open('xb') as stream:
        stream.write(schema)
        os.fchmod(stream.fileno(), 0o400)
    tree = ast.parse(helper)
    selected = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'parse' or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ('LITERAL', 'IMPORT') for t in n.targets)]
    namespace = {'struct': struct, 'uuid': uuid, 'hashlib': hashlib}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(HELPER), 'exec'), namespace)
    parsed = namespace['parse'](raw)
    if parsed['uuid'] != EXPECTED_UUID or WRAPPER not in parsed['starts']:
        raise ValueError('slice/wrapper binding')
    data = parsed['data']
    meta = metadata(data)
    result = {'sourceSHA256': SOURCE_SHA, 'helperSHA256': HELPER_SHA, 'schemaSource': str(SCHEMA), 'schemaSHA256': hashlib.sha256(schema).hexdigest(), 'uuid': parsed['uuid'], 'sliceOffset': parsed['sliceOffset'], 'sliceSHA256': parsed['sliceSHA256'], 'targetWrapperVA': WRAPPER, 'metadata': meta, 'targetRuns': 0, 'controlCalls': 0, 'modelRequests': 0, 'scope': 'file-format metadata only, no reachability/bootout/kernel/kill/drain proof'}
    save_json(out / 'preflight.json', result)
    rows = walk_chains(data, meta)
    hits = [r for r in rows if r['targetVA'] == WRAPPER]
    if len(hits) > 16:
        raise ValueError('target count cap')
    by_offset = {r['sliceFileOffset']: r for r in rows}
    context = []
    for hit in hits:
        segment = meta['segments'][hit['segmentIndex']]
        slots = []
        for delta in range(-3, 4):
            off = hit['sliceFileOffset'] + delta * 8
            if segment['offset'] <= off and off + 8 <= segment['offset'] + segment['bytes']:
                if off in by_offset:
                    slots.append({'deltaSlots': delta, 'confirmedChainedEntry': True, 'entry': by_offset[off]})
                else:
                    slots.append({'deltaSlots': delta, 'confirmedChainedEntry': False, 'sliceFileOffset': off, 'rawHex': '%016x' % unpack_at(data, '<Q', off)[0]})
        context.append({'pointerVA': hit['pointerVA'], 'slots': slots})
    result.update({'status': 'located_chained_pointer_reference' if hits else 'no_target_among_supported_chained_entries', 'entryCount': len(rows), 'bindCount': sum(r['bind'] for r in rows), 'rebaseCount': sum(not r['bind'] for r in rows), 'targetReferences': hits, 'localContext': context})
    save_json(out / 'manifest.json', result)
    print(json.dumps({'status': result['status'], 'entries': len(rows), 'targetReferences': hits}))


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (8, 9))
    signal.alarm(20)
    main()
