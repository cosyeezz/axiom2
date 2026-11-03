#!/usr/bin/env python3
"""New corrective aggregate, reusing the original attempt's completed copies."""
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import signal
import stat
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SIBLING = ROOT.parent / 'kiro-macos-native-01/FAILURE.md'


def read_regular(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        a = os.fstat(stream.fileno())
        if not stat.S_ISREG(a.st_mode) or a.st_size > 2 * 1024 * 1024:
            raise RuntimeError('input type/cap')
        raw = stream.read(2 * 1024 * 1024 + 1)
        b = os.fstat(stream.fileno())
        if len(raw) != a.st_size or (a.st_dev, a.st_ino, a.st_size, a.st_mtime_ns) != (b.st_dev, b.st_ino, b.st_size, b.st_mtime_ns):
            raise RuntimeError('unstable input')
    return raw


def main():
    recovered = []
    groups = [ROOT / 'mac-supervision-primitives-06/authority-review', ROOT / 'mac-supervision-primitives-08/capture']
    for group in groups:
        if group.name == 'authority-review':
            manifest = json.loads(read_regular(group / 'manifest.json'))
            expected = {Path(x['path']).name: x['sha256'] for x in manifest['artifacts']}
            if set(expected) != {'REPORT.md', 'EVIDENCE.md', 'inputs.json'}:
                raise RuntimeError('unexpected review inventory')
            self_name = 'manifest.json'
        else:
            inventory = json.loads(read_regular(group / 'inventory.json'))
            expected = {x['name']: x['sha256'] for x in inventory['files']}
            self_name = 'inventory.json'
        if {p.name for p in group.iterdir()} != set(expected) | {self_name}:
            raise RuntimeError('copied inventory drift')
        for name in sorted(set(expected) | {self_name}):
            if Path(name).name != name:
                raise RuntimeError('inventory basename')
            path = group / name
            raw = read_regular(path)
            digest = hashlib.sha256(raw).hexdigest()
            if name in expected and digest != expected[name]:
                raise RuntimeError('preserved file differs from task inventory')
            if stat.S_IMODE(path.stat().st_mode) != 0o400:
                raise RuntimeError('preserved file not0400')
            recovered.append({'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': digest, 'mode': '0400', 'method': 'verify existing completed copy; no recopy'})
    docs = [ROOT / 'README.md'] + [ROOT / ('mac-supervision-primitives-%02d/SUMMARY.md' % i) for i in range(5, 9)]
    links = []
    for document in docs:
        for href in re.findall(r'\[[^\]]*\]\(([^)]+)\)', read_regular(document).decode('utf-8')):
            parsed = urlsplit(href)
            if parsed.scheme or parsed.netloc:
                continue
            target = (document.parent / unquote(parsed.path)).resolve(strict=True) if parsed.path else document
            try:
                displayed = str(target.relative_to(ROOT))
            except ValueError:
                if target != SIBLING:
                    raise RuntimeError('unapproved outside evidence link')
                displayed = '../kiro-macos-native-01/FAILURE.md'
            if not target.is_file():
                raise RuntimeError('document target is not file')
            with target.open('rb') as stream:
                stream.read(1)
            links.append({'document': str(document.relative_to(ROOT)), 'href': href, 'target': displayed})
    paths = [ROOT / 'README.md', ROOT / 'mac-supervision-primitives-05/SUMMARY.md']
    for group in [ROOT / ('mac-supervision-primitives-%02d' % i) for i in range(6, 9)] + [HERE]:
        paths.extend(p for p in group.rglob('*') if p.is_file())
    sealed = []
    for path in sorted(paths):
        raw = read_regular(path)
        sealed.append({'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        if sum(x['bytes'] for x in sealed) > 8 * 1024 * 1024:
            raise RuntimeError('seal total cap')
    result = {'status': 'passed_corrective_artifact_and_document_verification_only',
              'recoveredCopies': recovered, 'files': sealed, 'sealedBytes': sum(x['bytes'] for x in sealed),
              'documents': len(docs), 'links': links, 'knownSiblingException': str(SIBLING),
              'resumesFailed': 'mac-supervision-primitives-08/preserve_results.py exit1; copies completed, doc scope bug',
              'newCopies': 0, 'newNetworkRequests': 0, 'controlAPICalls': 0, 'officialRuns': 0, 'modelRequests': 0,
              'limitations': 'No runtime/authority/full-tree/native parity claim'}
    target = HERE / 'verification.json'
    with target.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    if json.loads(read_regular(target)) != result:
        raise RuntimeError('manifest readback')
    print(json.dumps({'status': result['status'], 'recoveredCopies': len(recovered), 'files': len(sealed), 'sealedBytes': result['sealedBytes'], 'documents': len(docs), 'localLinks': len(links)}))


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (5, 6))
    signal.alarm(15)
    main()
