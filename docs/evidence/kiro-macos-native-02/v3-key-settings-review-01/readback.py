#!/usr/bin/python3
"""Local copied-evidence readback; no official input execution or reanalysis."""
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parent


def main():
    out = ROOT / 'readback.json'
    if out.exists():
        raise SystemExit('CreateNew gate')
    copies = []
    for name, source in [('lookup-fallback', '/private/tmp/kiro-key73-UnZj18'), ('converter', '/private/tmp/kiro-converter-ieGHRE')]:
        for path in sorted((ROOT / name).iterdir()):
            if path.is_file():
                data = path.read_bytes()
                original = (Path(source) / path.name).read_bytes()
                copies.append({'path': str(path.relative_to(ROOT)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'matchesOriginal': data == original})
    checks = {'allCopiedArtifactsMatch': bool(copies) and all(x['matchesOriginal'] for x in copies)}
    converter = ROOT / 'converter'
    for key, text in [(0x73, b'chat.agentEngine'), (0x35, b'chat.ui')]:
        label = 'key%02x' % key
        length = struct.unpack('<Q', (converter / (label + '-length.bin')).read_bytes())[0]
        pointer = struct.unpack('<Q', (converter / (label + '-pointer.bin')).read_bytes())[0]
        value = (converter / (label + '-string.bin')).read_bytes()
        checks[label + '-lenAndBytes'] = length == len(text) and value == text
        expected = 0x108c58e00 if key == 0x73 else 0x10482f5e3
        checks[label + '-pointer'] = pointer == expected
    checks['converterIs48Bytes'] = len((converter / 'converter.bin').read_bytes()) == 48
    checks['lookup240Bytes'] = len((ROOT / 'lookup-fallback/lookup.bin').read_bytes()) == 240
    checks['fallback580Bytes'] = len((ROOT / 'lookup-fallback/fallback.bin').read_bytes()) == 580
    content = (ROOT / 'SUMMARY.md').read_text()
    checks['summaryWhitespace'] = content.endswith('\n') and all(x == x.rstrip() for x in content.splitlines())
    files = []
    for path in sorted(ROOT.rglob('*')):
        if path.is_file() and path != out:
            b = path.read_bytes()
            files.append({'path': str(path.relative_to(ROOT)), 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()})
    passed = all(checks.values())
    r = {'status': 'passed_copied_evidence_integrity_only' if passed else 'failed_integrity', 'checks': checks, 'copied': copies, 'files': files, 'officialExecutions': 0, 'modelRequests': 0, 'boundary': 'Only offline copied evidence/numeric words/string integrity; not runtime settings, maps, flags, effective engine or parity.'}
    with out.open('x') as f:
        json.dump(r, f, indent=2)
        f.write('\n')
    print(json.dumps({'status': r['status'], 'checks': len(checks), 'files': len(files), 'copied': len(copies)}))
    raise SystemExit(0 if passed else 1)


if __name__ == '__main__':
    main()
