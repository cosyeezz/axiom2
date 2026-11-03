#!/usr/bin/env python3
"""Compare the three public members to an already retained archive; never execute."""
from pathlib import Path
import hashlib, io, json, os, stat, tarfile
P = Path(__file__).resolve().parent
r = json.loads((P / 'RESULT.json').read_text())
assert r['status'] == 'static-public-members' and r['fault'] == 'none'
assert r['beforeStamp'] == r['afterStamp']
assert r['driverSha256Before'] == r['driverSha256After'] == hashlib.sha256((P / 'inspect_once.py').read_bytes()).hexdigest()
archive = P.parent / 'v3-kas-source-02/selected-public-source.tar.gz'
with archive.open('rb') as f:
    data = f.read(4097040)
assert len(data) == 4097039
sha = hashlib.sha256(data).hexdigest()
assert sha == '0ab5cb92dae244ffb20577d7767baee9706c5f4605b615c279300f4b01cae267'
expected = {x['path']: x for x in r['archive']['selected']}
seen, members = set(), []
with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tf:
    for entry in tf:
        assert entry.name in expected and entry.name not in seen and entry.isfile()
        item = expected[entry.name]
        assert entry.size == item['bytes'] and entry.size <= 24 * 1024 * 1024
        with tf.extractfile(entry) as src:
            old = src.read(entry.size + 1)
        path = Path(r['output']) / entry.name
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as f:
            s = os.fstat(f.fileno())
            assert stat.S_ISREG(s.st_mode) and s.st_size == entry.size
            new = f.read(entry.size + 1)
        assert old == new and len(new) == item['bytes'] and hashlib.sha256(new).hexdigest() == item['sha256']
        members.append({**item, 'currentBytesEqualRetainedArchive': True})
        seen.add(entry.name)
assert seen == set(expected) and len(seen) == 3
result = {'status': 'three-public-members-byte-identical-and-retrievable',
          'currentTargetSha256': r['targetSha256'], 'currentFrameSha256': r['compressedSha256'],
          'retainedArchive': '../v3-kas-source-02/selected-public-source.tar.gz',
          'archiveBytes': len(data), 'archiveSha256': sha, 'members': members,
          'compareScriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'wholeArchivesEqualClaim': False, 'globalUniquenessClaim': False, 'nativeUseClaim': False,
          'targetExecutions': 0, 'modelRequests': 0}
with (P / 'SOURCE-REFERENCE.json').open('x') as f:
    json.dump(result, f, indent=2)
    f.write('\n')
print(json.dumps({'status': result['status'], 'members': len(members)}))
