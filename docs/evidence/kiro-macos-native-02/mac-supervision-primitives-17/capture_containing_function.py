#!/usr/bin/env python3
"""One immutable containing function and one nonexecuted carrier disassembly."""
import ast
from bisect import bisect_right
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import signal
import stat
import struct
import subprocess
import time
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FULL_SHA = '7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09'
SLICE_SHA = 'fe9a1562d360e15c86937153586ca8778ee72bd95de423415ec780ebde9c0102'
HELPER_SHA = 'd0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608'
PRIOR_DRIVER = '265197505a5a411b6ca3d46bf0db778bb8c31ec037f31efd7303a872832976b7'
UUID = '3FEC147A-7931-3FCD-BDB9-59C9A814779C'
SITE, TARGET = 0x10001f27c, 0x10000f60c


def read(path, cap):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        a = os.fstat(stream.fileno())
        if not stat.S_ISREG(a.st_mode) or a.st_size > cap:
            raise ValueError('input type/cap')
        raw = stream.read(cap + 1)
        b = os.fstat(stream.fileno())
    ident = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if ident(a) != ident(b) or len(raw) != a.st_size:
        raise ValueError('input changed')
    return raw


def write(path, raw):
    if len(raw) > 512 * 1024:
        raise ValueError('output cap')
    with path.open('xb') as stream:
        stream.write(raw)
        os.fchmod(stream.fileno(), 0o400)


def save(path, obj):
    write(path, (json.dumps(obj, indent=2) + '\n').encode())


def child_limits():
    resource.setrlimit(resource.RLIMIT_CPU, (2, 3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (512 * 1024, 512 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


def main():
    out = HERE / 'results'
    out.mkdir(mode=0o700)
    helper = read(ROOT / 'mac-supervision-primitives-10/locate_bootout.py', 32 * 1024)
    if hashlib.sha256(helper).hexdigest() != HELPER_SHA:
        raise ValueError('helper identity')
    tree = ast.parse(helper)
    functions, constants = {'signed', 'parse', 'make_carrier'}, {'LITERAL', 'IMPORT'}
    nodes = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in functions) or (isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and n.targets[0].id in constants)]
    if len(nodes) != 5 or {n.name for n in nodes if isinstance(n, ast.FunctionDef)} != functions:
        raise ValueError('helper AST scope')
    namespace = {'struct': struct, 'hashlib': hashlib, 'uuid': uuid}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'case10:selected-AST-only', 'exec'), namespace)
    raw = read(ROOT / 'mac-supervision-primitives-08/capture/launchd.snapshot', 2 * 1024 * 1024)
    if len(raw) != 1236160 or hashlib.sha256(raw).hexdigest() != FULL_SHA:
        raise ValueError('snapshot identity')
    parsed = namespace['parse'](raw)
    if parsed['uuid'] != UUID or parsed['sliceSHA256'] != SLICE_SHA or parsed['sliceOffset'] != 622592 or parsed['sliceBytes'] != 613568 or TARGET not in parsed['starts']:
        raise ValueError('slice/wrapper identity')
    prior = json.loads(read(ROOT / 'mac-supervision-primitives-16/results/manifest.json', 64 * 1024))
    if prior['driverSHA256'] != PRIOR_DRIVER or prior['sourceSHA256'] != FULL_SHA or prior['helperSHA256'] != HELPER_SHA or prior['uuid'] != UUID or prior['sliceSHA256'] != SLICE_SHA or prior['candidateCount'] != 1 or len(prior['candidates']) != 1 or prior['targetWrapperVA'] != TARGET:
        raise ValueError('prior candidate identity')
    candidate = prior['candidates'][0]
    if (candidate['va'], candidate['addVA'], candidate['kind'], candidate['targetVA'], candidate['fileOffset'], candidate['contextFileOffset'], candidate['contextBytes']) != (SITE, SITE + 4, 'adjacent ADRP+ADD', TARGET, 750204, 750188, 40):
        raise ValueError('prior exact candidate')
    if raw[750188:750228].hex() != candidate['contextHex']:
        raise ValueError('prior raw context mismatch')
    starts, text = parsed['starts'], parsed['text']
    index = bisect_right(starts, SITE) - 1
    if index < 0 or index + 1 >= len(starts):
        raise ValueError('containing function boundary unavailable')
    start, end = starts[index:index + 2]
    size = end - start
    preflight = {'driverSHA256': hashlib.sha256(read(Path(__file__), 32 * 1024)).hexdigest(), 'sourceSHA256': FULL_SHA, 'helperSHA256': HELPER_SHA, 'priorDriverSHA256': PRIOR_DRIVER, 'uuid': UUID, 'sliceOffset': parsed['sliceOffset'], 'sliceSHA256': SLICE_SHA, 'text': text, 'startsCount': len(starts), 'candidate': candidate, 'targetWrapperVA': TARGET, 'realSelectedImportStubs': parsed['selectedImportStubs'], 'range': {'startVA': start, 'endVA': end, 'bytes': size}, 'functionByteCap': 8192, 'targetRuns': 0, 'controlCalls': 0, 'modelRequests': 0, 'scope': 'one static containing function only; no runtime reachability/ownership/kernel authority/kill/drain/M3'}
    save(out / 'preflight.json', preflight)
    if not 0 < size <= 8192 or size % 4 or not (text['va'] <= start <= SITE and SITE + 8 <= end <= text['va'] + text['size']):
        raise ValueError('function boundary/cap')
    offset = text['offset'] + start - text['va']
    body = parsed['data'][offset:offset + size]
    if len(body) != size:
        raise ValueError('function readback')
    write(out / 'function.bin', body)
    carrier = out / 'function.macho'
    write(carrier, namespace['make_carrier'](body, start))
    argv = ['/usr/bin/otool', '-tv', str(carrier)]
    env = {'HOME': os.environ['HOME'], 'TMPDIR': os.environ['TMPDIR'], 'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}
    timed_out = False
    begin = time.monotonic()
    with (out / 'disassembly.stdout').open('xb') as stdout, (out / 'disassembly.stderr').open('xb') as stderr:
        os.fchmod(stdout.fileno(), 0o400)
        os.fchmod(stderr.fileno(), 0o400)
        child = subprocess.Popen(argv, stdout=stdout, stderr=stderr, env=env, cwd=str(out), preexec_fn=child_limits)
        try:
            code = child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            timed_out = True
            child.kill()
            code = child.wait(timeout=2)
    elapsed = time.monotonic() - begin
    stdout = read(out / 'disassembly.stdout', 512 * 1024)
    stderr = read(out / 'disassembly.stderr', 512 * 1024)
    words = [(int(m.group(1), 16), m.group(2)) for line in stdout.decode('utf-8').splitlines() for m in [re.match(r'^([0-9a-fA-F]{16})\s+(.+)$', line)] if m]
    contiguous = [va for va, unused in words] == list(range(start, end, 4))
    unknown = [{'va': va, 'text': instruction} for va, instruction in words if instruction.startswith('.') or 'unknown' in instruction.lower()]
    tool_ok = code == 0 and not timed_out
    result = dict(preflight, status='disassembly_captured' if tool_ok and contiguous else 'disassembly_failed_or_incomplete', bodyFileOffset=parsed['sliceOffset'] + offset, bodySHA256=hashlib.sha256(body).hexdigest(), decodedWordCount=len(words), contiguousWordAddresses=contiguous, unknownOpcodeRows=unknown, tool={'argv': argv, 'pid': child.pid, 'exit': code, 'timeout': timed_out, 'wallSeconds': elapsed, 'stdoutBytes': len(stdout), 'stderrBytes': len(stderr)}, artifacts=[])
    total = 0
    for name in ['preflight.json', 'function.bin', 'function.macho', 'disassembly.stdout', 'disassembly.stderr']:
        data = read(out / name, 512 * 1024)
        total += len(data)
        result['artifacts'].append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    if total > 2 * 1024 * 1024:
        raise ValueError('aggregate result cap')
    save(out / 'manifest.json', result)
    print(json.dumps({'status': result['status'], 'range': result['range'], 'words': len(words), 'bodySHA256': result['bodySHA256'], 'toolExit': code, 'unknownOpcodes': len(unknown)}))
    if not tool_ok or not contiguous:
        raise ValueError('disassembly failed/incomplete; no retry')


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (8, 9))
    signal.alarm(20)
    main()
