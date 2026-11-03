#!/usr/bin/env python3
"""One fresh own compile/metadata-only run; never call coalition functions."""
import hashlib
import json
import os
from pathlib import Path
import resource
import shutil
import signal
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
OUT = HERE / 'results'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    OUT.mkdir(mode=0o700)
    work = Path(tempfile.mkdtemp(prefix='axiom-own-export06-'))
    (work / 'home').mkdir(mode=0o700)
    source = (HERE / 'owned_export_prefix.c').read_bytes()
    copied_source = work / 'owned_export_prefix.c'
    copied_source.write_bytes(source)
    copied_source.chmod(0o400)
    binary = work / 'owned_export_prefix'
    env = {'HOME': str(work / 'home'), 'TMPDIR': str(work) + '/', 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'C', 'LC_ALL': 'C'}
    records = []
    started = time.monotonic()
    active = None

    def alarm_handler(_number, _frame):
        raise TimeoutError('independent parent outer deadline')

    signal.signal(signal.SIGALRM, alarm_handler)
    signal.alarm(30)

    def run(label, argv, seconds, cpu):
        nonlocal active
        def limits():
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
            resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024 * 1024, 2 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
        began = time.monotonic()
        row = {'label': label, 'argv': argv, 'timeoutSeconds': seconds, 'timedOut': False}
        records.append(row)
        with (OUT / (label + '.stdout')).open('xb') as stdout, (OUT / (label + '.stderr')).open('xb') as stderr:
            active = subprocess.Popen(argv, cwd=work, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, preexec_fn=limits)
            row['pid'] = active.pid
            try:
                row['exit'] = active.wait(timeout=seconds)
            except (subprocess.TimeoutExpired, TimeoutError):
                row['timedOut'] = True
                active.kill()
                row['exit'] = active.wait(timeout=2)
            finally:
                if active.poll() is not None:
                    active = None
            row['seconds'] = time.monotonic() - began
        for suffix in ('stdout', 'stderr'):
            path = OUT / (label + '.' + suffix)
            raw = path.read_bytes()
            if len(raw) > 2 * 1024 * 1024:
                raise RuntimeError('output cap')
            path.chmod(0o400)
            row[suffix] = {'bytes': len(raw), 'sha256': sha(raw)}
        return row

    error, values = None, None
    try:
        if os.uname().machine != 'arm64':
            raise RuntimeError('unsupported host architecture')
        compiler = ['/usr/bin/clang', '-arch', 'arm64', '-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX13.3.sdk', '-std=c11', '-O0', '-Wall', '-Wextra', '-Werror', str(copied_source), '-o', str(binary)]
        row = run('00-compile', compiler, 20, 10)
        if row['exit'] != 0 or row['timedOut']:
            raise RuntimeError('compiler failed; no execution')
        binary.chmod(0o400 | 0o100)
        binary_bytes = binary.read_bytes()
        with (OUT / 'owned_export_prefix.macho').open('xb') as stream:
            stream.write(binary_bytes)
            os.fchmod(stream.fileno(), 0o400)
        row = run('01-collector', [str(binary)], 5, 2)
        if row['exit'] != 0 or row['timedOut']:
            raise RuntimeError('collector incomplete/unavailable')
        values = {}
        for line in (OUT / '01-collector.stdout').read_text().splitlines():
            key, value = line.split('=', 1)
            if key in values:
                raise RuntimeError('duplicate output key')
            values[key] = value
        if int(values['pid']) != row['pid'] or int(values['uid']) != os.getuid() or int(values['euid']) != os.geteuid() or values['coalition_api_calls'] != '0':
            raise RuntimeError('self identity/scope')
        prefix = bytes.fromhex(values['prefix_hex'])
        if len(prefix) != int(values['prefix_length']) or not 0 < len(prefix) <= 64:
            raise RuntimeError('prefix bound')
        with (OUT / 'terminate-prefix.bin').open('xb') as stream:
            stream.write(prefix)
            os.fchmod(stream.fileno(), 0o400)
        if copied_source.read_bytes() != source or (HERE / 'owned_export_prefix.c').read_bytes() != source or binary.read_bytes() != binary_bytes:
            raise RuntimeError('source/binary drift')
    except BaseException as exc:
        error = type(exc).__name__ + ': ' + str(exc)
    finally:
        signal.alarm(0)
        if active is not None and active.poll() is None:
            active.kill()
            try:
                active.wait(timeout=2)
            except subprocess.TimeoutExpired:
                error = (error or '') + '; original child cleanup unresolved'
    result = {'error': error, 'seconds': time.monotonic() - started, 'workdir': str(work), 'sourceSHA256': sha(source),
              'calls': records, 'values': values, 'coalitionAPICalls': 0, 'officialRuns': 0, 'modelRequests': 0,
              'limitations': 'Own-child regular files, not pipe EOF/full-tree proof; prefix only; loaded OS UUID/path not full image hash or host kernel source binding'}
    artifacts = []
    for path in sorted(OUT.iterdir()):
        raw = path.read_bytes()
        artifacts.append({'name': path.name, 'bytes': len(raw), 'sha256': sha(raw)})
    result['artifacts'] = artifacts
    with (OUT / 'manifest.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    if json.loads((OUT / 'manifest.json').read_text()) != result:
        raise RuntimeError('manifest readback')
    print(json.dumps(result))
    return 0 if error is None else 1


if __name__ == '__main__':
    raise SystemExit(main())
