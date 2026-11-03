#!/usr/bin/env python3
"""CreateNew main artifact readback of completed04pure tests; no test rerun."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
SOURCE_SHA = '4d848742029ed86dd8769a0dc2280312cd92002fc8d44e645e4777692e8def1f'
OLD_SHA = '0a4871784b92e07baa43f9ad2395e95d6ac0b5250ec390e548f05a9b61193bdf'
SOURCES = {
    'parity': Path('/tmp/axiom-consumer04-parity-Hntnujbs'),
    'parity-harness-failed': Path('/tmp/axiom-consumer04-parity-PFlE3qlE'),
    'depth': Path('/private/tmp/axiom-depth04-independent-5MpRhX70'),
    'depth-harness-failed01': Path('/private/tmp/axiom-depth04-independent-I0zPZDMO'),
    'depth-harness-failed02': Path('/private/tmp/axiom-depth04-independent-NgbVVhsB'),
    'failure-note': Path('/private/tmp/axiom-depth04-failure-note-Ab9w8NKu'),
}
DEST = HERE / 'reports'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def read_regular(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= 2 * 1024 * 1024, 'file type/cap')
        data = stream.read(2 * 1024 * 1024 + 1)
        after = os.fstat(stream.fileno())
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)
        require(identity(before) == identity(after) and len(data) == before.st_size, 'unstable file')
    return data


def load(path):
    return json.loads(read_regular(path))


def sha(path):
    return hashlib.sha256(read_regular(path)).hexdigest()


def main():
    DEST.mkdir(mode=0o700)
    rows, skipped = [], []
    total = 0
    for group, source in SOURCES.items():
        for directory, dirs, names in os.walk(str(source), followlinks=False):
            for name in list(dirs):
                path = Path(directory) / name
                require(not path.is_symlink(), 'symlink directory')
                if name in ['home', 'owner-home', '__pycache__']:
                    dirs.remove(name)
                    skipped.append({'group': group, 'path': str(path.relative_to(source)), 'reason': 'own cache'})
            for name in sorted(names):
                path = Path(directory) / name
                if name.endswith('.pyc') or name in ['key.pem', '.rnd']:
                    skipped.append({'group': group, 'path': str(path.relative_to(source)), 'reason': 'cache/private fake'})
                    continue
                data = read_regular(path)
                total += len(data)
                require(total <= 4 * 1024 * 1024, 'total cap')
                target = DEST / group / path.relative_to(source)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fchmod(stream.fileno(), 0o400)
                require(read_regular(target) == data, 'copy readback')
                rows.append({'source': str(path), 'path': str(target.relative_to(HERE)),
                             'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    require(sha(HERE / 'terminal_consumer.py') == SOURCE_SHA, '04 source')
    require(sha(HERE.parent / 'observer-http-fixture-02/terminal_consumer.py') == OLD_SHA, 'old source')
    parity = load(DEST / 'parity/summary.json')
    require(parity['passed'] is True and parity['before'] == parity['after']
            and parity['unchanged'] is True, 'parity source/original03')
    require([(r['label'], r['total'], r['passed']) for r in parity['results']] ==
            [('py39', 270, 270), ('py39-boundary', 34, 34), ('py314', 270, 270), ('py314-boundary', 34, 34)],
            'parity counts')
    require(all(r['exit_code'] == 0 and r['failed'] == 0 and not r['timed_out']
                and r['eof'] == {'stdout': True, 'stderr': True}
                and r['source_sha_before'] == r['source_sha_after'] == SOURCE_SHA
                for r in parity['results']), 'parity actual exit/EOF')
    binding = load(DEST / 'parity/binding-audit.json')
    require(binding['text_inverse_exact'] is True and binding['normalized_ast_identical'] is True,
            'suite oracles changed')
    require(len(read_regular(DEST / 'parity-harness-failed/main.stderr.log')) > 0, 'first parity failure missing')
    depth = load(DEST / 'depth/summary.json')
    require(depth['before'] == depth['after'] == [OLD_SHA, SOURCE_SHA]
            and [r['exit'] for r in depth['runs']] == [0, 0], 'depth exits/identities')
    for name in ['py39.stdout', 'py314.stdout']:
        output = load(DEST / 'depth' / name)
        require(output['source_sha'] == SOURCE_SHA and output['unique_cases'] == output['passed'] == 78
                and len(output['results']) == 78 and all(r['pass'] is True for r in output['results']), '78 cases')
    audit = load(DEST / 'depth/audit.json')
    require(audit['exact_reconstruction'] is True and audit['remaining_ast_identical'] is True
            and audit['before_json_loads'] is True and audit['preflight_for_loops'] == 1, 'implementation delta')
    failed = load(DEST / 'depth-harness-failed02/summary.json')
    require([r['exit'] for r in failed['runs']] == [1, 1], 'CPU failure history')
    note = DEST / 'failure-note/EARLY-HARNESS-FAILURES.md'
    require(sha(note) == '14c1a3978ca1ba23eb1aaf45b0f5ee62df96a73eae56a6da5e4ce4584e63d17b', 'failure-note identity')
    spec = importlib.util.spec_from_file_location('owned_consumer04', HERE / 'terminal_consumer.py')
    consumer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(consumer)
    rejected = []
    for case in ['writerfault', 'bodycap', 'eventcap', 'logcap']:
        directory = HERE.parent / 'observer-http-fixture-03/reports/runtime-fixed' / case
        status = read_regular(directory / 'trace.ndjson.status.json')
        trace = read_regular(directory / 'trace.ndjson')
        count = load(directory / 'trace.ndjson.status.json')['requests']
        try:
            consumer.validate_capture(status, trace, scope=consumer.SCOPE, expected_requests=count)
        except ValueError as error:
            require(str(error) == 'observer failure', 'unexpected rejection reason')
            rejected.append(case)
        else:
            raise RuntimeError('failed capture accepted')
    result = {'status': 'passed_owned_consumer04_artifact_preservation_and_readback_only',
              'files': rows, 'totalBytes': total, 'skipped': skipped, 'sourceSHA': SOURCE_SHA,
              'originalOracleCases': 270, 'focusedDepthCases': 78,
              'additionalSpotChecks': '34 per version, overlapping focused tests; not summed',
              'real03FailedArtifactsRejectedBy04': rejected,
              'newChildRuns': 0, 'newNetworkRuns': 0, 'officialRuns': 0, 'modelRequests': 0,
              'history': '3 harness failures retained; first depth stderr is later original-tool transcription, not original disk log',
              'limitations': 'No sandbox/fulltree/natural official spawn/SDK-owner/TLS-wire/parity or model-gate claim'}
    path = HERE / 'preservation.json'
    with path.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    require(load(path) == result, 'manifest readback')
    print(json.dumps({'status': result['status'], 'files': len(rows), 'bytes': total,
                      'skipped': len(skipped), 'realFailedArtifactsRejected': rejected}))


if __name__ == '__main__':
    main()
