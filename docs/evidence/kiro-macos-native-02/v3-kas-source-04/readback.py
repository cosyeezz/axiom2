#!/usr/bin/python3
"""Document/result readback only; no repeated decoder/official invocation."""
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import unquote

R = Path(__file__).resolve().parent


def main():
    out = R / 'readback.json'
    if out.exists():
        raise SystemExit('CreateNew gate')
    extraction = json.loads((R / 'verification.json').read_text())
    preservation = json.loads((R / 'member-comparison.json').read_text())
    failed = json.loads((R.parent / 'v3-kas-source-03/verification.json').read_text())
    ast = json.loads((R / 'ast-check.json').read_text())
    checks = {
        'newExactFramePassed': extraction['status'] == 'extracted_public_source_only' and extraction['frameEof'] and extraction['targetFileStable'] and extraction['assetBytes'] == extraction['compressedBytesRead'] == extraction['compressedBytesConsumed'] == 22000545,
        'newFrameMatchesIndependentNativeHash': extraction['compressedSha256'] == 'a5e411f1eb7fb0924e441b5076f3dde33137aaa226b8ec6399de34b84db923aa',
        'oldFailedLengthPreserved': failed['status'] == 'failed' and failed['errorCategory'] == 'trailing-compressed-data' and failed['assetBytes'] == 22001675,
        'onlyLengthAndPrefixChanged': ast['status'] == 'passed_only_native_length_and_prefix_changed' and ast['changedConstants'] == {'prefix': 1, 'length': 1} and ast['decoderSelectorBudgetsUnchanged'],
        'sourceShaMatchesRun': hashlib.sha256((R / 'extract_source.py').read_bytes()).hexdigest() == extraction['sourceSha256'],
        'threePublicMembersPreserved': preservation['status'] == 'passed_three_public_members_identical_and_safely_retrievable' and len(preservation['members']) == 3 and all(x['newSelectedEqualsOldArchiveBytes'] for x in preservation['members']),
        'twentyThreeNativeCopiesReadBack': len(preservation['nativeCopiesReadBack']) == 23,
        'noTargetExecutionOrModel': extraction['targetExecutions'] == extraction['modelRequests'] == extraction['authStorageReads'] == 0,
    }
    command_dir = R.parent / 'v3-command-review-01/initial'
    command_original = Path('/tmp/kiro-command-static-iHSt7p')
    command_copies = []
    for p in sorted(command_dir.iterdir()):
        if p.is_file():
            data = p.read_bytes()
            command_copies.append({'path': str(p.relative_to(R.parent)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'matchesOriginal': data == (command_original / p.name).read_bytes()})
    checks['allInitialCommandCopiesMatch'] = bool(command_copies) and all(x['matchesOriginal'] for x in command_copies)
    docs = [R / 'SUMMARY.md', R / 'EXPERIMENT.md', R.parent / 'README.md', R.parent / 'v3-state-review-01/SUMMARY.md', R.parent / 'v3-kas-source-03/FAILURE.md', R.parent / 'v3-key-settings-review-01/SUMMARY.md']
    links = []
    for p in docs:
        text = p.read_text()
        checks[str(p.relative_to(R.parent)) + '-whitespace'] = text.endswith('\n') and all(s == s.rstrip() for s in text.splitlines())
        for target in re.findall(r'\]\(([^)]+)\)', text):
            if '://' not in target and not target.startswith('#'):
                path = p.parent / unquote(target.split('#', 1)[0])
                links.append({'from': str(p.relative_to(R.parent)), 'to': target, 'exists': path.exists()})
    checks['allDocumentLinksExist'] = all(x['exists'] for x in links)
    paths = sorted({p for p in R.rglob('*') if p.is_file() and p != out} | set(docs))
    files = []
    for p in paths:
        data = p.read_bytes()
        assert len(data) <= 2 * 1024 * 1024
        files.append({'path': str(p.relative_to(R.parent)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    passed = all(checks.values())
    result = {'status': 'passed_document_integrity_and_copied_command_only' if passed else 'failed_document_integrity', 'checks': checks, 'files': files, 'localLinks': links, 'initialCommandCopies': command_copies, 'officialExecutions': 0, 'modelRequests': 0, 'boundary': 'No new decoder/signature/official/runtime/M3/wire/server execution; negative source03 retained.'}
    with out.open('x') as f:
        json.dump(result, f, indent=2)
        f.write('\n')
    print(json.dumps({'status': result['status'], 'checks': len(checks), 'failed': [k for k,v in checks.items() if not v], 'files': len(files), 'links': len(links), 'initialCommandCopies': len(command_copies)}))
    raise SystemExit(0 if passed else 1)


if __name__ == '__main__':
    main()
