#!/usr/bin/env python3
"""Only frozen bytes and own nonexecuted carriers; no coalition API call."""
import ast
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
ROOT = HERE.parent
SNAPSHOT = ROOT / 'mac-supervision-primitives-08/capture/launchd.snapshot'
HELPERS = ROOT / 'mac-supervision-primitives-10/locate_bootout.py'
SOURCE_SHA = '7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09'
HELPER_SHA = 'd0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608'
UUID = '3FEC147A-7931-3FCD-BDB9-59C9A814779C'


def save(path, obj):
    with path.open('x') as stream:
        json.dump(obj, stream, indent=2)
        stream.write('\n')
        os.fchmod(stream.fileno(), 0o400)


def main():
    out = HERE / 'results'
    out.mkdir(mode=0o700)
    helpers = HELPERS.read_bytes()
    if len(helpers) > 16 * 1024 or hashlib.sha256(helpers).hexdigest() != HELPER_SHA:
        raise ValueError('tested helper binding')
    tree = ast.parse(helpers)
    names = {'signed', 'parse', 'direct_branches', 'make_carrier'}
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    nodes += [n for n in tree.body if isinstance(n, ast.Assign) and all(isinstance(t, ast.Name) and t.id in {'LITERAL', 'IMPORT'} for t in n.targets)]
    if len(nodes) != 6:
        raise ValueError('helper selection')
    namespace = {'struct': struct, 'hashlib': hashlib, 'uuid': uuid}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'exact-tested-pure-helpers', 'exec'), namespace)
    fd = os.open(str(SNAPSHOT), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size != 1236160:
            raise ValueError('snapshot type/size')
        raw = stream.read(2 * 1024 * 1024 + 1)
        after = os.fstat(stream.fileno())
    def identity(s):
        return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns
    if identity(before) != identity(after) or len(raw) != 1236160 or hashlib.sha256(raw).hexdigest() != SOURCE_SHA:
        raise ValueError('snapshot binding')
    parsed = namespace['parse'](raw)
    if parsed['uuid'] != UUID:
        raise ValueError('arm64e UUID')
    data, text = parsed['data'], parsed['text']
    code = data[text['offset']:text['offset'] + text['size']]
    stubs = {row['va'] for row in parsed['selectedImportStubs']}
    hits = [row for row in namespace['direct_branches'](code, text['va'], stubs) if row['selectedImportStub']]
    ranges = set()
    for row in hits:
        index = bisect_right(parsed['starts'], row['va']) - 1
        if index < 0:
            raise ValueError('branch before starts')
        begin = parsed['starts'][index]
        end = min(parsed['starts'][index + 1] if index + 1 < len(parsed['starts']) else text['va'] + text['size'], text['va'] + text['size'])
        if not text['va'] <= begin <= row['va'] < end:
            raise ValueError('function range')
        ranges.add((begin, end))
    result = {'sourceSHA256': SOURCE_SHA, 'helperSHA256': HELPER_SHA, 'uuid': UUID, 'sliceOffset': parsed['sliceOffset'], 'sliceBytes': parsed['sliceBytes'], 'sliceSHA256': parsed['sliceSHA256'], 'text': text, 'selectedImportStubs': parsed['selectedImportStubs'], 'directBranchHits': hits, 'functionRanges': [{'beginVA': b, 'endVAExclusive': e, 'bytes': e - b} for b, e in sorted(ranges)], 'scope': 'aligned B/BL candidates only; no indirect/transitive/CFG/runtime claim', 'calls': [], 'functions': [], 'targetRuns': 0, 'controlCalls': 0, 'modelRequests': 0}
    save(out / 'preflight.json', result)
    if len(hits) > 16 or len(ranges) > 2 or any(e - b > 8192 for b, e in ranges) or sum(e - b for b, e in ranges) > 16384:
        raise ValueError('caller/function byte/count cap; preflight retained')
    def limits():
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        resource.setrlimit(resource.RLIMIT_FSIZE, (512 * 1024, 512 * 1024))
    for index, (begin, end) in enumerate(sorted(ranges), 1):
        offset = text['offset'] + begin - text['va']
        body = data[offset:offset + end - begin]
        tag = '%02d-caller' % index
        carrier = out / (tag + '.macho')
        with carrier.open('xb') as stream:
            stream.write(namespace['make_carrier'](body, begin))
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
        result['calls'].append({'argv': argv, 'pid': child.pid, 'exit': rc, 'timedOut': timed_out, 'streams': 'regular files; original child waited, not pipeEOF/full-tree'})
        result['functions'].append({'beginVA': begin, 'endVAExclusive': end, 'bytes': len(body), 'fullFileOffset': parsed['sliceOffset'] + offset, 'sourceBytesSHA256': hashlib.sha256(body).hexdigest(), 'syntheticCarrierNonexecuted': True, 'directBranches': namespace['direct_branches'](body, begin, stubs)})
    result['status'] = 'located_bounded_static_callers' if hits else 'no_direct_B_BL_candidates_in_scanned_text'
    result['artifacts'] = []
    for path in sorted(out.iterdir()):
        raw = path.read_bytes()
        path.chmod(0o400)
        result['artifacts'].append({'name': path.name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    if sum(row['bytes'] for row in result['artifacts']) > 4 * 1024 * 1024:
        raise ValueError('output cap')
    save(out / 'manifest.json', result)
    print(json.dumps({'status': result['status'], 'hits': hits, 'ranges': result['functionRanges'], 'calls': result['calls']}))
    return 0 if not hits or result['calls'] and all(row['exit'] == 0 and not row['timedOut'] for row in result['calls']) else 1


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (10, 11))
    signal.alarm(30)
    raise SystemExit(main())
