#!/usr/bin/env python3
"""Check new summary links only; do not repeat passed implementation tests."""
import hashlib
import json
from pathlib import Path
import re
import os

HERE = Path(__file__).resolve().parent
EVIDENCE = HERE.parent
REPO = EVIDENCE.parents[2]
DOCS = [EVIDENCE / 'README.md'] + [EVIDENCE / ('observer-http-fixture-0%d' % n) / 'SUMMARY.md' for n in [2, 3, 4]]


def main():
    files, links = [], []
    for path in DOCS:
        raw = path.read_bytes()
        if len(raw) > 128 * 1024:
            raise RuntimeError('document cap')
        files.append({'path': str(path.relative_to(REPO)), 'bytes': len(raw),
                      'sha256': hashlib.sha256(raw).hexdigest()})
        for href in re.findall(r'\]\(([^)]+)\)', raw.decode('utf-8')):
            if href.startswith(('http:', 'https:', '#')):
                continue
            target = (path.parent / href.split('#', 1)[0]).resolve()
            if REPO not in target.parents or not target.exists():
                raise RuntimeError('missing/outside document target: ' + href)
            links.append({'document': str(path.relative_to(REPO)), 'target': str(target.relative_to(REPO))})
    result = {'status': 'passed_new_summary_links_only', 'files': files, 'links': links,
              'implementationTestsRepeated': 0, 'officialRuns': 0, 'modelRequests': 0}
    output = HERE / 'document-readback.json'
    with output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    if json.loads(output.read_bytes()) != result:
        raise RuntimeError('document manifest readback')
    print(json.dumps({'status': result['status'], 'files': len(files), 'links': len(links)}))


if __name__ == '__main__':
    main()
