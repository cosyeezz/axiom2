#!/usr/bin/env python3
"""Preserve completed independent reports; seal new own-artifact/docs only."""
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
REVIEW = Path('/tmp/axiom-coalition-review.basESx')
CAPTURE = Path('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9')


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
    copied = []
    def copy(source, target, expected=None):
        raw = read_regular(source)
        digest = hashlib.sha256(raw).hexdigest()
        if expected is not None and digest != expected:
            raise RuntimeError('source report hash drift')
        if sum(x['bytes'] for x in copied) + len(raw) > 8 * 1024 * 1024:
            raise RuntimeError('copy total cap')
        with target.open('xb') as stream:
            stream.write(raw)
            stream.flush()
            os.fchmod(stream.fileno(), 0o400)
        if read_regular(target) != raw:
            raise RuntimeError('copy readback')
        copied.append({'source': str(source), 'path': str(target.relative_to(ROOT)), 'bytes': len(raw), 'sha256': digest, 'mode': '0400'})

    review_target = ROOT / 'mac-supervision-primitives-06/authority-review'
    review_target.mkdir(mode=0o700)
    review_manifest = json.loads(read_regular(REVIEW / 'manifest.json'))
    review_hashes = {Path(x['path']).name: x['sha256'] for x in review_manifest['artifacts']}
    if set(review_hashes) != {'REPORT.md', 'EVIDENCE.md', 'inputs.json'}:
        raise RuntimeError('unexpected review inventory')
    for name in ['REPORT.md', 'EVIDENCE.md', 'inputs.json', 'manifest.json']:
        copy(REVIEW / name, review_target / name, review_hashes.get(name))
    capture_target = HERE / 'capture'
    capture_target.mkdir(mode=0o700)
    inventory = json.loads(read_regular(CAPTURE / 'inventory.json'))
    expected = {x['name']: x['sha256'] for x in inventory['files']}
    actual_names = {p.name for p in CAPTURE.iterdir()}
    if actual_names != set(expected) | {'inventory.json'}:
        raise RuntimeError('unexpected capture inventory')
    for name in sorted(actual_names):
        if Path(name).name != name:
            raise RuntimeError('inventory basename')
        copy(CAPTURE / name, capture_target / name, expected.get(name))
    docs = [ROOT / 'README.md'] + [ROOT / ('mac-supervision-primitives-%02d/SUMMARY.md' % i) for i in range(5, 9)]
    links = []
    for document in docs:
        for href in re.findall(r'\[[^\]]*\]\(([^)]+)\)', read_regular(document).decode('utf-8')):
            parsed = urlsplit(href)
            if parsed.scheme or parsed.netloc:
                continue
            target = (document.parent / unquote(parsed.path)).resolve(strict=True) if parsed.path else document
            target.relative_to(ROOT)
            if not target.is_file():
                raise RuntimeError('document target is not file')
            with target.open('rb') as stream:
                stream.read(1)
            links.append({'document': str(document.relative_to(ROOT)), 'href': href, 'target': str(target.relative_to(ROOT))})
    sealed = []
    paths = [ROOT / 'README.md', ROOT / 'mac-supervision-primitives-05/SUMMARY.md']
    for i in range(6, 9):
        paths.extend(p for p in (ROOT / ('mac-supervision-primitives-%02d' % i)).rglob('*') if p.is_file())
    for path in sorted(paths):
        raw = read_regular(path)
        sealed.append({'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    if sum(x['bytes'] for x in sealed) > 8 * 1024 * 1024:
        raise RuntimeError('seal total cap')
    result = {'status': 'passed_artifact_copy_and_document_links_only', 'copies': copied,
              'files': sealed, 'sealedBytes': sum(x['bytes'] for x in sealed), 'documents': len(docs), 'links': links,
              'tasks': [{'taskId': 't11313', 'resultId': 'r11316'}, {'taskId': 't11327', 'resultId': 'r11330'}],
              'newNetworkRequests': 0, 'controlAPICalls': 0, 'officialRuns': 0, 'modelRequests': 0,
              'limitations': 'Artifact/doc verification is not runtime authority, full-tree supervision or native parity'}
    target = HERE / 'preservation.json'
    with target.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    if json.loads(read_regular(target)) != result:
        raise RuntimeError('manifest readback')
    print(json.dumps({'status': result['status'], 'copies': len(copied), 'files': len(sealed), 'sealedBytes': result['sealedBytes'], 'documents': len(docs), 'localLinks': len(links)}))


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (5, 6))
    signal.alarm(15)
    main()
