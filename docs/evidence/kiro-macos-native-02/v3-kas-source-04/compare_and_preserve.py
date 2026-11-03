#!/usr/bin/python3
"""Verify exact public-member identity and reference the already-safe archive."""
import hashlib
import io
import json
from pathlib import Path
import stat
import struct
import tarfile

R = Path(__file__).resolve().parent
ALLOWED = {'node_modules/@kiro/agent/package.json', 'node_modules/@kiro/agent/dist/server/acp-server.js', 'node_modules/@kiro/agent/dist/server/acp-server.externals.json'}


def main():
    out = R / 'member-comparison.json'
    if out.exists():
        raise SystemExit('CreateNew gate')
    current = json.loads((R / 'verification.json').read_text())
    old = json.loads((R.parent / 'v3-kas-source-02/verification.json').read_text())
    assert current['status'] == 'extracted_public_source_only' and current['frameEof'] and current['targetFileStable']
    assert current['assetBytes'] == current['compressedBytesRead'] == current['compressedBytesConsumed'] == 22000545
    assert current['compressedSha256'] == 'a5e411f1eb7fb0924e441b5076f3dde33137aaa226b8ec6399de34b84db923aa'
    records = {x['path']: x for x in current['selectedFiles']}
    prior = {x['path']: x for x in old['selectedFiles']}
    assert set(records) == set(prior) == ALLOWED
    archive = R.parent / 'v3-kas-source-02/selected-public-source.tar.gz'
    assert archive.is_file() and not archive.is_symlink() and stat.S_IMODE(archive.stat().st_mode) == 0o400
    blob = archive.read_bytes()
    assert len(blob) == 4097039 and hashlib.sha256(blob).hexdigest() == '0ab5cb92dae244ffb20577d7767baee9706c5f4605b615c279300f4b01cae267'
    compared = []
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as tar:
        members = tar.getmembers()
        assert len(members) == 3 and {m.name for m in members} == ALLOWED
        for member in members:
            rec = records[member.name]
            assert rec == prior[member.name] and member.isfile() and member.mode == 0o400 and member.size == rec['bytes'] <= 64 * 1024 * 1024
            path = Path(current['outputDirectory']) / member.name
            assert path.is_file() and not path.is_symlink() and stat.S_IMODE(path.stat().st_mode) == 0o400
            actual = path.read_bytes()
            with tar.extractfile(member) as f:
                saved = f.read(64 * 1024 * 1024 + 1)
            assert actual == saved and len(actual) == rec['bytes'] and hashlib.sha256(actual).hexdigest() == rec['sha256']
            compared.append({**rec, 'newSelectedEqualsOldArchiveBytes': True, 'newEqualsOldSelectedMetadata': True})
    code = (R / 'native-resource/resolver.bytes').read_bytes()
    def word(pc):
        return struct.unpack_from('<I', code, pc - 0x101631f3c)[0]
    low = (word(0x101632ff4) >> 5) & 0xffff
    high = (word(0x101632ff8) >> 5) & 0xffff
    assert low == 0xb3a1 and high == 0x14f and (high << 16 | low) == current['assetBytes']
    copies = []
    src = Path('/tmp/kiro-kas-static-new-VWWbOv')
    for p in sorted((R / 'native-resource').iterdir()):
        if p.is_file():
            b = p.read_bytes()
            assert b == (src / p.name).read_bytes()
            copies.append({'path': str(p.relative_to(R)), 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()})
    report = {'status': 'passed_three_public_members_identical_and_safely_retrievable', 'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'currentNativeTargetSha256': current['targetSha256'], 'currentCompressedSha256': current['compressedSha256'], 'archiveRelativePath': '../v3-kas-source-02/selected-public-source.tar.gz', 'archiveBytes': len(blob), 'archiveSha256': hashlib.sha256(blob).hexdigest(), 'members': compared, 'nativeCopiesReadBack': copies, 'nativeLengthFromMovMovk': high << 16 | low, 'officialExecutions': 0, 'modelRequests': 0, 'authStorageReads': 0, 'boundary': 'Only these three public member bytes are equal; native CLI/runtime/full tar differ. Static audit reuse is not current effective engine/API/runtime sender/parity proof.'}
    with out.open('x') as f:
        json.dump(report, f, indent=2)
        f.write('\n')
    print(json.dumps({'status': report['status'], 'members': len(compared), 'archiveBytes': len(blob), 'nativeCopies': len(copies), 'nativeLength': report['nativeLengthFromMovMovk']}))


if __name__ == '__main__':
    main()
