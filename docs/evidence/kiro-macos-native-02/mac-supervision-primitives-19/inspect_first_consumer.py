#!/usr/bin/env python3
"""One explicitly selected returned-record consumer; one nonexecuted disassembly."""
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
PRIOR_DRIVER = '6ae56ce8795407c4d8870fe7325e0c174e2e3cec7c9ce1c8bd4643f7b0d6c744'
UUID = '3FEC147A-7931-3FCD-BDB9-59C9A814779C'
PRODUCER_DRIVER = '4cb7385b3294a78f4d4e6ab9f780a5704282ae1b146f81f154a0c80811b438d7'
CALLSITE, TARGET, WRAPPER = 0x10001f294, 0x10001ee40, 0x10000f60c


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
    functions, constants = {'signed', 'parse', 'make_carrier', 'direct_branches'}, {'LITERAL', 'IMPORT'}
    nodes = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in functions) or (isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and n.targets[0].id in constants)]
    if len(nodes) != 6 or {n.name for n in nodes if isinstance(n, ast.FunctionDef)} != functions:
        raise ValueError('helper AST scope')
    namespace = {'struct': struct, 'hashlib': hashlib, 'uuid': uuid}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'case10:selected-AST-only', 'exec'), namespace)
    raw = read(ROOT / 'mac-supervision-primitives-08/capture/launchd.snapshot', 2 * 1024 * 1024)
    if len(raw) != 1236160 or hashlib.sha256(raw).hexdigest() != FULL_SHA:
        raise ValueError('snapshot identity')
    parsed = namespace['parse'](raw)
    if parsed['uuid'] != UUID or parsed['sliceSHA256'] != SLICE_SHA or parsed['sliceOffset'] != 622592 or parsed['sliceBytes'] != 613568 or WRAPPER not in parsed['starts']:
        raise ValueError('slice/wrapper identity')
    prior = json.loads(read(ROOT / 'mac-supervision-primitives-17/results/manifest.json', 64 * 1024))
    expected_range = {'startVA': 0x10001f25c, 'endVA': 0x10001f2c4, 'bytes': 104}
    prior_body_sha = 'f1b1bb0c5dc5961f8a72e7d1bf91fd988e4daead652d8b763aca32f77d0fa282'
    if prior['driverSHA256'] != PRIOR_DRIVER or prior['sourceSHA256'] != FULL_SHA or prior['helperSHA256'] != HELPER_SHA or prior['uuid'] != UUID or prior['sliceSHA256'] != SLICE_SHA or prior['range'] != expected_range or prior['bodyFileOffset'] != 750172 or prior['bodySHA256'] != prior_body_sha or prior['targetWrapperVA'] != WRAPPER:
        raise ValueError('prior caller identity')
    prior_body = read(ROOT / 'mac-supervision-primitives-17/results/function.bin', 512)
    if len(prior_body) != 104 or hashlib.sha256(prior_body).hexdigest() != prior_body_sha or raw[750172:750276] != prior_body:
        raise ValueError('prior caller body mismatch')
    branches = namespace['direct_branches'](prior_body, expected_range['startVA'], set())
    matches = [r for r in branches if r['va'] == CALLSITE]
    if len(matches) != 1 or matches[0]['kind'] != 'BL' or matches[0]['target'] != TARGET:
        raise ValueError('prior exact BL target')
    constructors = [r for r in branches if r['va'] == 0x10001f28c]
    if len(constructors) != 1 or constructors[0]['kind'] != 'BL' or constructors[0]['target'] != 0x1000139b8 or struct.unpack_from('<I', prior_body, 0x34)[0] != 0xaa0003f3:
        raise ValueError('unchanged producer return to selected consumer')
    producer = json.loads(read(ROOT / 'mac-supervision-primitives-18/results/manifest.json', 64 * 1024))
    producer_sha = 'a4f93f643d50e8bdd12c53fcfe72a41e478591d64d9dc3932224fda63b336c1c'
    if producer['driverSHA256'] != PRODUCER_DRIVER or producer['sourceSHA256'] != FULL_SHA or producer['helperSHA256'] != HELPER_SHA or producer['uuid'] != UUID or producer['sliceSHA256'] != SLICE_SHA or producer['range'] != {'startVA': 0x1000139b8, 'endVA': 0x100013a6c, 'bytes': 180} or producer['bodyFileOffset'] != 702904 or producer['bodySHA256'] != producer_sha or producer['targetWrapperVA'] != WRAPPER:
        raise ValueError('producer identity')
    producer_body = read(ROOT / 'mac-supervision-primitives-18/results/function.bin', 512)
    if len(producer_body) != 180 or hashlib.sha256(producer_body).hexdigest() != producer_sha or raw[702904:703084] != producer_body:
        raise ValueError('producer body mismatch')
    if any(struct.unpack_from('<I', producer_body, off)[0] != word for off, word in [(0x20, 0xaa0403f3), (0x44, 0xaa0003f5), (0x90, 0xa9044ebf), (0x94, 0xaa1503e0)]):
        raise ValueError('producer local saved-field words')
    callsite = {'va': CALLSITE, 'kind': 'BL', 'targetVA': TARGET, 'argumentRegister': 'x0', 'inputIsUnchangedProducerReturnAtCallsite': True, 'producerEntryVA': 0x1000139b8, 'recordCallbackVA': WRAPPER, 'savedCallbackFieldOffset': 0x48, 'priorCallerBodySHA256': prior_body_sha}
    starts, text = parsed['starts'], parsed['text']
    index = bisect_right(starts, TARGET) - 1
    if index < 0 or index + 1 >= len(starts):
        raise ValueError('containing function boundary unavailable')
    start, end = starts[index:index + 2]
    size = end - start
    preflight = {'driverSHA256': hashlib.sha256(read(Path(__file__), 32 * 1024)).hexdigest(), 'sourceSHA256': FULL_SHA, 'helperSHA256': HELPER_SHA, 'priorDriverSHA256': PRIOR_DRIVER, 'producerDriverSHA256': PRODUCER_DRIVER, 'producerBodySHA256': producer_sha, 'uuid': UUID, 'sliceOffset': parsed['sliceOffset'], 'sliceSHA256': SLICE_SHA, 'text': text, 'startsCount': len(starts), 'callSite': callsite, 'targetCalleeVA': TARGET, 'targetIsFunctionStart': start == TARGET, 'targetWrapperVA': WRAPPER, 'realSelectedImportStubs': parsed['selectedImportStubs'], 'range': {'startVA': start, 'endVA': end, 'bytes': size}, 'functionByteCap': 8192, 'targetRuns': 0, 'controlCalls': 0, 'modelRequests': 0, 'scope': 'one explicit static returned-record consumer; no automatic followups/runtime reachability/ownership/kernel authority/kill/drain/M3'}
    save(out / 'preflight.json', preflight)
    if not 0 < size <= 8192 or size % 4 or not (text['va'] <= start == TARGET and TARGET + 4 <= end <= text['va'] + text['size']):
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
    result = dict(preflight, status='disassembly_captured' if tool_ok and contiguous and not unknown else 'disassembly_failed_or_incomplete', bodyFileOffset=parsed['sliceOffset'] + offset, bodySHA256=hashlib.sha256(body).hexdigest(), decodedWordCount=len(words), contiguousWordAddresses=contiguous, unknownOpcodeRows=unknown, tool={'argv': argv, 'pid': child.pid, 'exit': code, 'timeout': timed_out, 'wallSeconds': elapsed, 'stdoutBytes': len(stdout), 'stderrBytes': len(stderr)}, artifacts=[])
    total = 0
    for name in ['preflight.json', 'function.bin', 'function.macho', 'disassembly.stdout', 'disassembly.stderr']:
        data = read(out / name, 512 * 1024)
        total += len(data)
        result['artifacts'].append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    if total > 2 * 1024 * 1024:
        raise ValueError('aggregate result cap')
    save(out / 'manifest.json', result)
    print(json.dumps({'status': result['status'], 'range': result['range'], 'words': len(words), 'bodySHA256': result['bodySHA256'], 'toolExit': code, 'unknownOpcodes': len(unknown)}))
    if not tool_ok or not contiguous or unknown:
        raise ValueError('disassembly failed/incomplete/unknown; no retry')


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (8, 9))
    signal.alarm(20)
    main()
