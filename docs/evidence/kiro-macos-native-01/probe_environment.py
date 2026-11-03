#!/usr/bin/env python3
"""Read-only, non-model Mac identity probe. Never opens credential storage."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'environment.json'
if OUT.exists():
    raise SystemExit('CreateNew gate: environment.json already exists')
REPORT = {'schema': 'kiro-macos-environment-1', 'startedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
          'boundary': 'Offline identity/tool probe; zero model requests; no credential/Keychain/TLS-key reads; no official binary mutation',
          'commands': [], 'artifacts': []}


def run(argv, timeout=30, env=None):
    started = time.monotonic()
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, env=env)
        rec = {'argv': argv, 'exitCode': p.returncode, 'stdout': p.stdout.decode('utf-8', 'replace'),
               'stderr': p.stderr.decode('utf-8', 'replace')}
    except subprocess.TimeoutExpired as e:
        rec = {'argv': argv, 'exitCode': None, 'timeout': True,
               'stdout': (e.stdout or b'').decode('utf-8', 'replace'), 'stderr': (e.stderr or b'').decode('utf-8', 'replace')}
    rec['elapsedSeconds'] = round(time.monotonic() - started, 3)
    REPORT['commands'].append(rec)
    print(json.dumps({'command': argv, 'exitCode': rec['exitCode'], 'elapsedSeconds': rec['elapsedSeconds']}), flush=True)
    return rec


def digest(path, offset=0, length=None):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        f.seek(offset)
        remaining = os.fstat(f.fileno()).st_size - offset if length is None else length
        while remaining:
            b = f.read(min(4 * 1024 * 1024, remaining))
            if not b:
                raise RuntimeError('unexpected EOF')
            h.update(b)
            remaining -= len(b)
    return h.hexdigest()


for argv in [['git', 'status', '--porcelain=v1', '-uall'], ['git', 'rev-parse', 'HEAD'],
             ['git', 'show', '-s', '--format=%H%n%s', '033775d8fae20785ddd52c1e1cf6ba308b6908e6'],
             ['/usr/bin/sw_vers'], ['/usr/bin/uname', '-m'], ['/usr/bin/arch'],
             ['/usr/sbin/sysctl', '-n', 'hw.optional.arm64'], ['/usr/sbin/sysctl', '-n', 'sysctl.proc_translated'],
             ['/usr/bin/id', '-u'], ['/usr/bin/clang', '--version'], ['/usr/bin/xcrun', '--show-sdk-path'],
             ['/usr/bin/lldb', '--version'], ['/usr/sbin/tcpdump', '--version']]:
    run(argv)
REPORT['tools'] = {t: shutil.which(t) for t in ['file', 'otool', 'nm', 'lipo', 'codesign', 'clang', 'lldb', 'python3',
                                                       'java', 'javac', 'ghidra', 'analyzeHeadless', 'brew', 'rea',
                                                       'frida', 'frida-ps', 'tshark', 'dumpcap', 'tcpdump', 'node']}
app = Path('/Applications/Kiro CLI.app')
plist = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
REPORT['bundle'] = {k: plist.get(k) for k in ['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion', 'CFBundleExecutable', 'LSMinimumSystemVersion']}
REPORT['bundle']['downloadOrigin'] = 'unknown unless whitelisted metadata below is present'
for key in ['com.apple.metadata:kMDItemWhereFroms']:
    try:
        urls = plistlib.loads(os.getxattr(app, key))
        REPORT['bundle']['downloadOriginMetadata'] = [{'scheme': urlsplit(u).scheme, 'host': urlsplit(u).hostname,
                                                       'path': urlsplit(u).path, 'queryAndFragmentOmitted': True} for u in urls]
    except OSError as e:
        REPORT['bundle']['downloadOriginMetadataError'] = {'errno': e.errno, 'reason': e.strerror}

for name in ['kiro-cli', 'kiro-cli-chat']:
    launcher = Path('/Users/dane/.local/bin') / name
    path = launcher.resolve(strict=True)
    size = path.stat().st_size
    artifact = {'name': name, 'entryPath': str(launcher), 'entrySymlink': os.readlink(launcher) if launcher.is_symlink() else None,
                'resolvedPath': str(path), 'bytes': size, 'sha256': digest(path), 'slices': []}
    with path.open('rb') as f:
        magic, count = struct.unpack('>II', f.read(8))
        if magic != 0xcafebabe:
            raise RuntimeError('expected FAT_MAGIC; record actual format before extending parser')
        entries = [struct.unpack('>IIIII', f.read(20)) for _ in range(count)]
    for cpu, subtype, offset, length, alignment in entries:
        if offset + length > size:
            raise RuntimeError('slice outside file')
        artifact['slices'].append({'cpuType': hex(cpu), 'cpuSubtype': subtype, 'architecture': {0x01000007: 'x86_64', 0x0100000c: 'arm64'}.get(cpu, 'unknown'),
                                   'fileOffset': offset, 'bytes': length, 'alignmentExponent': alignment,
                                   'sha256': digest(path, offset, length)})
    REPORT['artifacts'].append(artifact)
    for argv in [['/usr/bin/file', str(path)], ['/usr/bin/lipo', '-detailed_info', str(path)],
                 ['/usr/bin/codesign', '-d', '--verbose=4', str(path)],
                 ['/usr/bin/codesign', '-d', '--entitlements', ':-', str(path)],
                 ['/usr/bin/codesign', '--verify', '--strict', '--verbose=2', str(path)],
                 ['/usr/bin/otool', '-arch', 'arm64', '-L', str(path)],
                 ['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)', '/usr/bin/arch', '-arm64', str(path), '--version']]:
        run(argv, timeout=45)
    artifact['afterSha256'] = digest(path)
    artifact['unchangedDuringProbe'] = artifact['afterSha256'] == artifact['sha256']
run(['/usr/bin/codesign', '-d', '--verbose=4', str(app)])
java_home = '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'
REPORT['selectedJavaHome'] = java_home
for argv in [[java_home + '/bin/java', '-version'], [java_home + '/bin/javac', '-version'],
             ['/usr/bin/file', java_home + '/bin/java'],
             ['node', '/Volumes/D_Work/axiom2/app/skills/pi-development/scripts/documentation-paths.mjs']]:
    run(argv)
props = Path('/opt/homebrew/opt/ghidra/libexec/Ghidra/application.properties')
REPORT['ghidra'] = {'root': str(props.parent.parent), 'propertiesSha256': digest(props),
                    'properties': props.read_text(), 'headless': '/opt/homebrew/opt/ghidra/libexec/support/analyzeHeadless',
                    'headlessSha256': digest('/opt/homebrew/opt/ghidra/libexec/support/analyzeHeadless')}
REPORT['finishedUtc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
with OUT.open('x') as f:
    json.dump(REPORT, f, indent=2, ensure_ascii=False)
    f.write('\n')
print('REPORT=' + str(OUT))
print('REPORT_SHA256=' + digest(OUT))
