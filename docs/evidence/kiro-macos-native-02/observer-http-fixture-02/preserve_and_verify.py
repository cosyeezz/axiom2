#!/usr/bin/env python3
"""One CreateNew artifact-only readback; no child, official code or network."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
ROOTS = {
    'pure': Path('/private/tmp/axiom-pure02-independent-wm_fd6td'),
    'network': Path('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-http-independent02-tsxdc8h6'),
}
DEST = HERE / 'success-reports'
SOURCE_SHA = 'f21dbb781ae4d106763ef327defd0c47f7100cc358a1343fd30d6997de2fc77a'
SUITE_SHA = '9f2caff4e549613fed1b10a7bb8381d4f3ff4d4773f7e58920c424652aa9eed5'
PER_FILE = 2 * 1024 * 1024
TOTAL = 4 * 1024 * 1024


def check(value, message):
    if not value:
        raise RuntimeError(message)


def read_regular(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        check(stat.S_ISREG(before.st_mode) and before.st_size <= PER_FILE, 'source type/cap')
        data = stream.read(PER_FILE + 1)
        after = os.fstat(stream.fileno())
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)
        check(identity(before) == identity(after) and len(data) == before.st_size, 'unstable source')
    return data


def digest(path):
    return hashlib.sha256(read_regular(path)).hexdigest()


def load(path):
    return json.loads(read_regular(path))


def named(directory, name, suffix):
    check(type(name) is str and Path(name).name == name and name.endswith(suffix), 'capture name')
    return read_regular(directory / name)


def main():
    DEST.mkdir(mode=0o700)
    rows, skipped = [], []
    total = 0
    for group, root in ROOTS.items():
        for directory, dirs, names in os.walk(str(root), followlinks=False):
            for name in list(dirs):
                check(not (Path(directory) / name).is_symlink(), 'symlink directory')
                if name in ['home', 'owner-home', '__pycache__']:
                    skipped.append({'group': group, 'path': str((Path(directory) / name).relative_to(root)),
                                    'reason': 'own HOME/cache directory; not test evidence'})
                    dirs.remove(name)
            for name in sorted(names):
                source = Path(directory) / name
                relative = source.relative_to(root)
                if name.endswith('.pyc') or name == '.rnd' or relative.as_posix() == 'certificate/key.pem':
                    skipped.append({'group': group, 'path': str(relative),
                                    'reason': 'cache or generated fake private material; not needed'})
                    continue
                data = read_regular(source)
                total += len(data)
                check(total <= TOTAL, 'total cap')
                target = DEST / group / relative
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fchmod(stream.fileno(), 0o400)
                check(read_regular(target) == data, 'copied bytes differ')
                rows.append({'source': str(source), 'path': str(target.relative_to(HERE)),
                             'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    pure, network = DEST / 'pure', DEST / 'network'
    check(digest(HERE / 'fake-http-tap.cjs') == SOURCE_SHA, 'current source SHA')
    check(digest(network / 'source-02-archive.cjs') == SOURCE_SHA, 'network source snapshot SHA')
    check(digest(pure / 'suite.cjs') == SUITE_SHA, 'copied original suite SHA')
    check(digest(HERE.parent / 'observer-http-fixture-01/failed-reports/pure/suite.cjs') == SUITE_SHA,
          'original 17 oracles not identical')
    pure_result = load(pure / 'results.json')
    check(pure_result['exit'] == 0 and pure_result['sourceSHABefore'] == SOURCE_SHA
          and pure_result['sourceSHAAfter'] == SOURCE_SHA, 'pure result/source')
    check(len(pure_result['results']) == 6 and all(r['exit'] == 0 and r['truePipeEOF']
          and r['failure'] is None for r in pure_result['results']), 'pure child results/EOF')
    groups = {}
    for group in ['core', 'chunks', 'caps', 'audit', 'extra']:
        last = read_regular(pure / (group + '.stdout')).decode().splitlines()[-1]
        summary = json.loads(last)
        check(summary['failed'] == 0 and summary['version'] == 'v22.23.2', 'pure group')
        groups[group] = summary['passed']
    check(groups == {'core': 7, 'chunks': 3, 'caps': 4, 'audit': 3, 'extra': 13}, 'pure counts')
    report = load(network / 'report.json')
    check(report['ok'] is True and report['errors'] == [], 'network main outcome')
    check(len(report['children']) == 3 and all(r['exit'] == 0 and r['eof']
          and r['reason'] is None for r in report['children']), 'network child outcome/EOF')
    check(report['sha_before'] == report['sha_after'] == SOURCE_SHA, 'network source')
    spec = importlib.util.spec_from_file_location('fake_terminal_consumer', HERE / 'terminal_consumer.py')
    consumer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(consumer)
    result = consumer.validate_capture(read_regular(network / 'preload/tap.ndjson.status.json'),
                                      read_regular(network / 'preload/tap.ndjson'),
                                      scope=consumer.SCOPE, expected_requests=10)
    control = [r for r in report['captures'] if r['phase'] == 'control']
    preload = [r for r in report['captures'] if r['phase'] == 'preload']
    check(len(control) == len(preload) == len(result['requests']) == 10, 'nonempty capture sets')
    immutable, mutable, headers = 0, 0, 0
    for a, b, request in zip(control, preload, result['requests'].values()):
        check(named(network, a['raw'], '.raw') == named(network, b['raw'], '.raw'), 'raw mismatch')
        body = named(network, b['body'], '.body')
        check(named(network, a['body'], '.body') == body, 'received body mismatch')
        head = b['head'].encode('latin1')
        check(request['header'].encode('latin1') == head, 'header cache mismatch')
        check(named(network, b['raw'], '.raw').startswith(head), 'raw header prefix')
        headers += 1
        check(request['path'] == b['head'].split(' ')[1], 'request mapping')
        if request['path'] == '/mutable':
            check(bytes(request['body']) == b'BEFORE' and body == b'ZZZZZZ', 'negative API boundary')
            mutable += 1
        else:
            check(bytes(request['body']) == body, 'immutable API body mismatch')
            immutable += 1
    check((immutable, mutable, headers) == (8, 2, 10), 'boundary counts')
    status = result['status']
    check((status['events'], status['bodyBytes'], status['logBytes'], status['requests']) ==
          (54, 196636, 268465, 10), 'tap exact totals')
    verification = {'status': 'passed_owned_fake_artifact_preservation_and_readback_only',
                    'officialRuns': 0, 'newNetworkRuns': 0, 'modelRequests': 0,
                    'files': rows, 'totalBytes': total, 'skipped': skipped,
                    'sourceSHA': SOURCE_SHA, 'pureOriginal': 17, 'pureNew': 13,
                    'rawPairs': 10, 'immutableAPIMatches': immutable,
                    'mutableNegativeBoundaries': mutable, 'headerCacheMatches': headers,
                    'tapStatus': status,
                    'limits': 'Not M3/full tree/SDK lifecycle/TLS wire/server parity; 03 strict depth failure remains'}
    path = HERE / 'preservation-readback.json'
    with path.open('x', encoding='utf-8') as stream:
        json.dump(verification, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    check(load(path) == verification, 'manifest readback')
    print(json.dumps({k: verification[k] for k in ['status', 'totalBytes', 'rawPairs',
                      'immutableAPIMatches', 'mutableNegativeBoundaries', 'headerCacheMatches']}))
    print(json.dumps({'files': len(rows), 'skipped': len(skipped)}))


if __name__ == '__main__':
    main()
