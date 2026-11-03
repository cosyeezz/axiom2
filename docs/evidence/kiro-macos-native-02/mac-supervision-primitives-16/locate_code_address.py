#!/usr/bin/env python3
"""Reuse case10's tested byte locator for one exact code address; no target execution."""
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
FULL_SHA = '7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09'
SLICE_SHA = 'fe9a1562d360e15c86937153586ca8778ee72bd95de423415ec780ebde9c0102'
HELPER_SHA = 'd0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608'
UUID = '3FEC147A-7931-3FCD-BDB9-59C9A814779C'
TARGET = 0x10000f60c


def read_regular(path, cap):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > cap:
            raise ValueError('input type/cap')
        raw = stream.read(cap + 1)
        after = os.fstat(stream.fileno())
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if identity(before) != identity(after) or len(raw) != before.st_size:
        raise ValueError('input changed')
    return raw


def save(path, value):
    raw = (json.dumps(value, indent=2) + '\n').encode()
    if len(raw) > 512 * 1024:
        raise ValueError('JSON cap')
    with path.open('xb') as stream:
        stream.write(raw)
        os.fchmod(stream.fileno(), 0o400)


def main():
    out = HERE / 'results'
    out.mkdir(mode=0o700)
    helper = read_regular(HELPER, 32 * 1024)
    if hashlib.sha256(helper).hexdigest() != HELPER_SHA:
        raise ValueError('helper identity')
    tree = ast.parse(helper, filename=str(HELPER))
    functions = {'signed', 'parse', 'find_xrefs'}
    constants = {'LITERAL', 'IMPORT'}
    nodes = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in functions) or (isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and n.targets[0].id in constants)]
    if len(nodes) != 5 or {n.name for n in nodes if isinstance(n, ast.FunctionDef)} != functions or {n.targets[0].id for n in nodes if isinstance(n, ast.Assign)} != constants:
        raise ValueError('AST helper scope')
    namespace = {'struct': struct, 'hashlib': hashlib, 'uuid': uuid}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(HELPER) + ':selected-AST-only', 'exec'), namespace)
    raw = read_regular(SOURCE, 2 * 1024 * 1024)
    if len(raw) != 1236160 or hashlib.sha256(raw).hexdigest() != FULL_SHA:
        raise ValueError('snapshot identity')
    parsed = namespace['parse'](raw)
    if parsed['uuid'] != UUID or parsed['sliceSHA256'] != SLICE_SHA or parsed['sliceOffset'] != 622592 or parsed['sliceBytes'] != 613568 or TARGET not in parsed['starts']:
        raise ValueError('slice/wrapper identity')
    text = parsed['text']
    code = parsed['data'][text['offset']:text['offset'] + text['size']]
    if len(code) != 357072 or len(code) % 4 or text['va'] != 0x1000010e8:
        raise ValueError('text identity')
    refs = namespace['find_xrefs'](code, text['va'], TARGET)
    preflight = {
        'driverSHA256': hashlib.sha256(read_regular(Path(__file__), 32 * 1024)).hexdigest(),
        'sourceSHA256': FULL_SHA, 'sourceBytes': len(raw), 'helperSHA256': HELPER_SHA,
        'uuid': UUID, 'sliceOffset': parsed['sliceOffset'], 'sliceBytes': parsed['sliceBytes'], 'sliceSHA256': SLICE_SHA,
        'text': text, 'scannedBytes': len(code), 'scannedAlignedWords': len(code) // 4,
        'startsCount': len(parsed['starts']), 'targetWrapperVA': TARGET,
        'helperIdentityLiteralVA': parsed['literalVA'], 'realSelectedImportStubs': parsed['selectedImportStubs'],
        'candidateCount': len(refs), 'candidateCap': 16, 'contextBytesCap': 40,
        'targetRuns': 0, 'subprocesses': 0, 'networkCalls': 0, 'controlCalls': 0, 'modelRequests': 0,
        'scope': 'ADR or adjacent ordinary64bit ADRP+ADD exact address formation only, not reachability/call/ownership/authority/M3',
    }
    save(out / 'preflight.json', preflight)
    if len(refs) > 16:
        raise ValueError('candidate cap; not a negative result')
    for ref in refs:
        off = ref['va'] - text['va']
        width = 8 if 'addVA' in ref else 4
        lo, hi = max(0, off - 16), min(len(code), off + width + 16)
        ref.update({'targetVA': TARGET, 'fileOffset': parsed['sliceOffset'] + text['offset'] + off,
                    'contextVA': text['va'] + lo, 'contextFileOffset': parsed['sliceOffset'] + text['offset'] + lo,
                    'contextBytes': hi - lo, 'contextHex': code[lo:hi].hex()})
    result = dict(preflight, status='ADR_or_adjacent_ADRP_ADD_candidates' if refs else 'no_ADR_or_adjacent_ADRP_ADD_candidates', candidates=refs)
    save(out / 'manifest.json', result)
    print(json.dumps({'status': result['status'], 'candidateCount': len(refs), 'candidates': refs}))


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (5, 6))
    signal.alarm(15)
    main()
