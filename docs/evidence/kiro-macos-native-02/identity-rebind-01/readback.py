#!/usr/bin/python3
"""Offline document/artifact integrity; does not rerun official tools or inputs."""
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent


def main():
    dest = ROOT / 'readback.json'
    if dest.exists():
        raise SystemExit('CreateNew gate')
    snapshot = json.loads((ROOT / 'verification.json').read_text())
    sig = json.loads((ROOT / 'signatures-01/verification.json').read_text())
    fix = json.loads((ROOT / 'synthetic-02/post-check.json').read_text())
    ast = json.loads((ROOT / 'synthetic-02/ast-check.json').read_text())
    system = json.loads((ROOT / 'synthetic-03-system-python/results.json').read_text())
    old = json.loads((ROOT / 'synthetic-01/results.json').read_text())
    candidate = json.loads((ROOT / 'resource-candidate-01/verification.json').read_text())
    engine = json.loads((ROOT / 'engine-choice-02/verification.json').read_text())
    checks = {
        'snapshotPassed': snapshot['status'] == 'passed_static_snapshot_identity_only',
        'sourceAndMetadataStable': snapshot['metadataAndPathStable'] is True,
        'twoCopyReadbacks': len(snapshot['inputs']) == 2 and all(x['snapshotReadbackMatches'] for x in snapshot['inputs']),
        'metadata2352': snapshot['publicBundleMetadata']['plist']['CFBundleShortVersionString'] == '2.35.2',
        'sourceHash': hashlib.sha256((ROOT / 'rebind_identity.py').read_bytes()).hexdigest() == '9e6f4935cc44c2ff5d1afd5828445df8d63ed96ff4b3feaff85fee7ed7ffa232',
        'failedTestsPreserved': old['passed'] == 62 and old['failed'] == 3,
        'onlyCleanupChanged': ast['changedTopLevelNodes'] == ['open_regular'] and ast['exactExpectedCleanupAST'] and ast['otherTopLevelNodesUnchanged'],
        'fixedCasesReexecuted': fix['original65Reexecuted'] == 65 and fix['newControlledRaceCases'] == 1 and fix['testExit'] == 0,
        'systemInterpreter66': system['python'].startswith('3.9.6 ') and system['passed'] == 66 and system['failed'] == 0,
        'fourLocalSignatureCommands': sig['status'] == 'passed_local_signature_snapshot_only' and len(sig['results']) == 4 and all(x['passed'] and x['exitCode'] == 0 and not x['timedOut'] and x['snapshotStatStable'] for x in sig['results']),
        'negativeResourceResultPreserved': candidate['status'] == 'candidate_hash_mismatch_no_scan_or_unpack' and candidate['exitCode'] == 2 and candidate['candidate']['matchesOldCompressed'] is False,
        'engineEvidenceBounded': engine['prompt']['bytes'] == 10928 and engine['callee']['bytes'] == 3572 and all(engine[k]['contiguous'] and engine[k]['originalBytesMatch'] for k in ('prompt', 'callee')),
    }
    copied = []
    source_dirs = [(ROOT / 'resource-candidate-01', Path('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-kas-rebind-static-yK3LKo')), (ROOT / 'engine-choice-02', Path('/private/tmp/kiro-rebind-engine-NSagx2'))]
    for local, original in source_dirs:
        for path in sorted(local.iterdir()):
            if path.is_file():
                before = (original / path.name).read_bytes()
                after = path.read_bytes()
                copied.append({'path': str(path.relative_to(ROOT)), 'bytes': len(after), 'sha256': hashlib.sha256(after).hexdigest(), 'matchesOriginal': before == after})
    checks['allDelegatedCopiesMatch'] = bool(copied) and all(x['matchesOriginal'] for x in copied)
    for item in sig['results']:
        label = Path(item['argv'][-1]).name + '-' + item['kind']
        for stream in ('stdout', 'stderr'):
            data = (ROOT / 'signatures-01' / (label + '.' + stream)).read_bytes()
            checks[label + '-' + stream] = len(data) == item[stream + 'Bytes'] and hashlib.sha256(data).hexdigest() == item[stream + 'Sha256']
    links = []
    for path in sorted(ROOT.rglob('*.md')):
        content = path.read_text()
        checks[str(path.relative_to(ROOT)) + '-whitespace'] = content.endswith('\n') and all(line == line.rstrip() for line in content.splitlines())
        for target in re.findall(r'\]\(([^)]+)\)', content):
            if '://' not in target and not target.startswith('#'):
                target_path = path.parent / unquote(target.split('#', 1)[0])
                links.append({'from': str(path.relative_to(ROOT)), 'to': target, 'exists': target_path.exists()})
    checks['localLinksExist'] = all(x['exists'] for x in links)
    files = []
    for path in sorted(ROOT.rglob('*')):
        if path.is_file() and path != dest:
            data = path.read_bytes()
            if len(data) > 2 * 1024 * 1024:
                raise RuntimeError('artifact-cap')
            files.append({'path': str(path.relative_to(ROOT)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    passed = all(checks.values())
    report = {'status': 'passed_document_integrity_only' if passed else 'failed_document_integrity', 'checks': checks, 'copiedArtifacts': copied, 'localLinks': links, 'files': files, 'officialExecutions': 0, 'modelRequests': 0, 'boundary': 'No new snapshot/signature/M3/loaded-image/wire/server verification; preserves negative results.'}
    with dest.open('x') as f:
        json.dump(report, f, indent=2)
        f.write('\n')
    print(json.dumps({'status': report['status'], 'checks': len(checks), 'failed': [k for k,v in checks.items() if not v], 'files': len(files), 'links': len(links), 'copied': len(copied)}))
    raise SystemExit(0 if passed else 1)


if __name__ == '__main__':
    main()
