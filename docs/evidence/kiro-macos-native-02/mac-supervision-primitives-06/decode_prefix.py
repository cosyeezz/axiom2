#!/usr/bin/env python3
"""Static disassembly of a retained bounded prefix in a synthetic Mach-O."""
import hashlib
import json
import os
from pathlib import Path
import resource
import struct
import subprocess

HERE = Path(__file__).resolve().parent


def main():
    out = HERE / 'postprocess'
    out.mkdir(mode=0o700)
    manifest = json.loads((HERE / 'results/manifest.json').read_text())
    values = manifest['values']
    prefix = (HERE / 'results/terminate-prefix.bin').read_bytes()
    if len(prefix) != 64 or prefix.hex() != values['prefix_hex']:
        raise RuntimeError('retained prefix mismatch')
    address = int(values['image_offset'])
    commands_size = 72 + 80
    file_offset = 32 + commands_size
    header = struct.pack('<IiiIIIII', 0xfeedfacf, int(values['image_cputype']), int(values['image_cpusubtype']), 1, 1, commands_size, 0, 0)
    segment = struct.pack('<II16sQQQQiiII', 0x19, commands_size, b'__TEXT', address, len(prefix), file_offset, len(prefix), 7, 5, 1, 0)
    section = struct.pack('<16s16sQQIIIIIIII', b'__text', b'__TEXT', address, len(prefix), file_offset, 2, 0, 0, 0x80000400, 0, 0, 0)
    carrier = out / 'synthetic-prefix.macho'
    with carrier.open('xb') as stream:
        stream.write(header + segment + section + prefix)
        os.fchmod(stream.fileno(), 0o400)
    argv = ['/usr/bin/otool', '-arch', 'arm64e', '-tvV', str(carrier)]
    def limits():
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024 * 1024, 2 * 1024 * 1024))
    with (out / 'otool.stdout').open('xb') as stdout, (out / 'otool.stderr').open('xb') as stderr:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                 env={'HOME': str(out), 'TMPDIR': str(out) + '/', 'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}, preexec_fn=limits)
        timed_out = False
        try:
            code = child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            timed_out = True
            child.kill()
            code = child.wait(timeout=2)
    # Decode only the retained BL immediate: no target memory lookup or call.
    instruction = struct.unpack_from('<I', prefix, 32)[0]
    if instruction >> 26 != 0b100101:
        raise RuntimeError('expected BL not present at recorded offset')
    immediate = instruction & ((1 << 26) - 1)
    if immediate & (1 << 25):
        immediate -= 1 << 26
    branch_target = address + 32 + immediate * 4
    result = {'argv': argv, 'pid': child.pid, 'exit': code, 'timedOut': timed_out,
              'sourceImageUUID': values['image_uuid'], 'sourceOffset': address,
              'sourcePrefixSHA256': hashlib.sha256(prefix).hexdigest(), 'prefixBytes': len(prefix),
              'blAtPrefixOffset32TargetImageOffset': branch_target, 'coalitionAPICalls': 0,
              'syntheticCarrierNotOSImage': True, 'artifacts': []}
    for path in sorted(out.iterdir()):
        raw = path.read_bytes()
        path.chmod(0o400)
        result['artifacts'].append({'name': path.name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    with (out / 'manifest.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    print(json.dumps(result))
    return 0 if code == 0 and not timed_out else 1


if __name__ == '__main__':
    raise SystemExit(main())
