#!/usr/bin/env python3
"""One-shot owned, offline Mach-O/Ghidra capability test."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import struct
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent
RECEIPT = ROOT / 'verification.json'
GATE = ROOT / '.started'
with GATE.open('x') as f:
    f.write(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + '\n')
WORK = Path(tempfile.mkdtemp(prefix='kiro-mac-ghidra-fixture01-'))
REPORT = {'schema': 'owned-macho-capability-1', 'status': 'failed_unless_verified', 'workdir': str(WORK),
          'boundary': 'Owned C fixture only; zero model requests; headless -noanalysis plus one bounded function',
          'commands': [], 'checks': {}, 'sourceHashesBefore': {}}


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def run(argv, timeout=30, env=None, check=True):
    start = time.monotonic()
    p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, start_new_session=True)
    timeout_hit = False
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timeout_hit = True
        os.killpg(p.pid, signal.SIGKILL)
        out, err = p.communicate()
    record = {'argv': argv, 'exitCode': p.returncode, 'timeout': timeout_hit, 'elapsedSeconds': round(time.monotonic()-start, 3),
              'stdout': out.decode('utf-8', 'replace'), 'stderr': err.decode('utf-8', 'replace')}
    REPORT['commands'].append(record)
    print(json.dumps({'argv': argv, 'exitCode': p.returncode, 'timeout': timeout_hit}), flush=True)
    if check and (p.returncode or timeout_hit):
        raise RuntimeError('command failed: ' + repr(argv))
    return out


sources = [ROOT / 'fixture.c', ROOT.parent / 'FocusedMachO.java', Path(__file__)]
REPORT['sourceHashesBefore'] = {str(p): sha(p) for p in sources}
try:
    binary = WORK / 'fixture'
    run(['/usr/bin/clang', '-arch', 'arm64', '-O0', '-fno-stack-protector', '-g0', str(ROOT/'fixture.c'), '-o', str(binary)])
    REPORT['binary'] = {'path': str(binary), 'bytes': binary.stat().st_size, 'sha256': sha(binary)}
    run(['/usr/bin/file', str(binary)])
    symbols = run(['/usr/bin/nm', '-n', str(binary)]).decode()
    locations = {}
    for line in symbols.splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[-1] in ['_parity_select', '_main']:
            locations[parts[-1]] = int(parts[0], 16)
    start, stop = locations['_parity_select'], locations['_main']
    if not 0 < stop-start <= 4096:
        raise RuntimeError('fixture function range invalid')
    REPORT['functionRange'] = {'start': hex(start), 'endInclusive': hex(stop-1), 'basis': 'nm ordered text symbols parity_select and immediately following main'}
    observed = run(['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)', str(binary)])
    REPORT['checks']['fixtureExactStdout'] = observed == b'fixture:38,2,81\n'
    asm = run(['/usr/bin/otool', '-arch', 'arm64', '-tvV', str(binary)]).decode()
    (ROOT/'otool-asm.txt').write_text(asm)
    env = os.environ.copy()
    java = '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'
    env.update({'JAVA_HOME': java, 'PATH': java+'/bin:'+env['PATH'], 'GHIDRA_HEADLESS_MAXMEM': '2G',
                'XDG_CONFIG_HOME': str(WORK/'config'), 'XDG_CACHE_HOME': str(WORK/'cache'),
                'GHIDRA_HEADLESS_JAVA_OPTIONS': '-Dapplication.tempdir='+str(WORK/'temp')})
    (WORK/'project').mkdir()
    REPORT['ghidraEnvOverrides'] = {k: env[k] for k in ['JAVA_HOME', 'PATH', 'GHIDRA_HEADLESS_MAXMEM', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'GHIDRA_HEADLESS_JAVA_OPTIONS']}
    argv = ['/opt/homebrew/opt/ghidra/libexec/support/analyzeHeadless', str(WORK/'project'), 'fixture01',
            '-import', str(binary), '-noanalysis', '-max-cpu', '2', '-scriptPath', str(ROOT.parent),
            '-postScript', 'FocusedMachO.java', str(ROOT/'focused.json'), hex(start), hex(stop-1), 'parity_select',
            '-log', str(WORK/'ghidra.log'), '-scriptlog', str(WORK/'script.log'), '-deleteProject']
    run(argv, timeout=180, env=env)
    focused = json.loads((ROOT/'focused.json').read_text())
    REPORT['checks'].update({'decompileCompleted': focused['decompileCompleted'],
                             'noUndecodedGaps': len(focused['undecodedGaps']) == 0,
                             'fullByteCoverage': focused['decodedBytes'] == stop-start,
                             'cfgNonempty': len(focused['cfg']) > 0,
                             'oneFunctionCreatedAtMost': focused['functionsAfter'] - focused['functionsBefore'] <= 1,
                             'expectedLanguage': focused['language'] == 'AARCH64:LE:64:v8A'})
    # Map target addresses back to raw Mach-O bytes without involving a second decoder.
    raw = binary.read_bytes()
    magic, cpu, subtype, kind, ncmds, sizecmds, flags, reserved = struct.unpack_from('<8I', raw)
    if magic != 0xfeedfacf:
        raise RuntimeError('unexpected Mach-O format')
    cursor = 32
    file_start = None
    for _ in range(ncmds):
        cmd, length = struct.unpack_from('<II', raw, cursor)
        if cmd == 0x19:
            vmaddr, vmsize, fileoff, filesize = struct.unpack_from('<QQQQ', raw, cursor+24)
            if vmaddr <= start and stop <= vmaddr+filesize:
                file_start = fileoff + start-vmaddr
        cursor += length
    if file_start is None:
        raise RuntimeError('no segment maps fixture range')
    expected = raw[file_start:file_start+stop-start]
    REPORT['checks']['bytesMatchRawFile'] = expected.hex() == focused['bytesHex']
    ghidra_addrs = [int(x['address'],16) for x in focused['instructions']]
    otool_addrs = [int(m.group(1),16) for m in re.finditer(r'^([0-9a-fA-F]{16})\s', asm, re.M) if start <= int(m.group(1),16) < stop]
    REPORT['checks']['instructionAddressesMatchOtool'] = ghidra_addrs == otool_addrs and len(ghidra_addrs)>0
    REPORT['checks']['binaryUnchanged'] = REPORT['binary']['sha256'] == sha(binary)
    REPORT['sourceHashesAfter'] = {str(p): sha(p) for p in sources}
    REPORT['checks']['sourcesUnchanged'] = REPORT['sourceHashesAfter'] == REPORT['sourceHashesBefore']
    REPORT['checks']['allChecksNonempty'] = len(REPORT['checks']) >= 10
    REPORT['status'] = 'passed_local_capability_only' if all(REPORT['checks'].values()) else 'failed_checks'
except Exception as e:
    REPORT['error'] = {'type': type(e).__name__, 'message': str(e)}
finally:
    REPORT['finishedUtc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    with RECEIPT.open('x') as f:
        json.dump(REPORT, f, indent=2)
        f.write('\n')
    print('RECEIPT='+str(RECEIPT))
    print('STATUS='+REPORT['status'])
raise SystemExit(0 if REPORT['status'] == 'passed_local_capability_only' else 1)
