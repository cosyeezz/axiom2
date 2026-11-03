#!/usr/bin/env python3
"""One offline, instrumented V3 command-selection attempt, never a model baseline."""
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import stat
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent
LIMIT = 65536
LAUNCHER = Path('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli')
CHAT = LAUNCHER.with_name('kiro-cli-chat')
CLANG = Path('/Library/Developer/CommandLineTools/usr/bin/clang')
SDK = Path('/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk')
EXPECTED = {
    LAUNCHER: (73432992, '8e242d795f93a70bc4497907d9aaf2d1552a07ee8a7a86e0276af6cf55672fd2'),
    CHAT: (413051920, '7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f'),
}
ROLES = {'program', 'server-marker', 'experimental-wasm', 'transport-stdio', 'transport-ws',
         'auth-acp-callback', 'auth-user', 'auth-machine', 'unknown'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def stamp(s):
    return [s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns]


def save(path, value):
    with path.open('x') as f:
        json.dump(value, f, ensure_ascii=True, indent=2)
        f.write('\n')


def alarm_handler(signum, frame):
    raise TimeoutError('parent wall deadline')


def bounds(cpu):
    def apply():
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
        resource.setrlimit(resource.RLIMIT_FSIZE, (LIMIT, LIMIT))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return apply


def run(out, prefix, argv, env, cwd, cpu, wall):
    p = None
    started = time.monotonic()
    timed_out = False
    try:
        with (out / (prefix + '.stdout')).open('xb') as stdout, (out / (prefix + '.stderr')).open('xb') as stderr:
            p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                 env=env, cwd=cwd, close_fds=True, preexec_fn=bounds(cpu))
            try:
                code = p.wait(timeout=wall)
            except subprocess.TimeoutExpired:
                timed_out = True
                p.kill()
                code = p.wait(timeout=2)
        sizes = []
        for suffix in ['stdout', 'stderr']:
            size = (out / (prefix + '.' + suffix)).stat().st_size
            if size > LIMIT:
                raise ValueError('stream cap')
            sizes.append(size)
        record = {'argv': argv, 'pid': p.pid, 'exit': code, 'timeout': timed_out,
                  'wallSeconds': time.monotonic() - started,
                  'stdoutBytes': sizes[0], 'stderrBytes': sizes[1]}
        save(out / (prefix + '.json'), record)
        return record
    finally:
        if p is not None and p.poll() is None:
            p.kill()
            p.wait(timeout=2)


def validate_projection(value):
    keys = {'schema', 'argc', 'argvRoles', 'nodeOptionsPresent', 'nodeOptionsMatchesControlled',
            'nodeUseSystemCA', 'customUAPresent', 'wsPortPresent', 'complete'}
    if type(value) is not dict or set(value) != keys or value['schema'] != 'own-kas-role-1':
        raise ValueError('projection schema')
    argc = value['argc']
    if type(argc) is not int or not 1 <= argc <= 64 or type(value['argvRoles']) is not list or len(value['argvRoles']) != argc:
        raise ValueError('projection argc')
    for i, row in enumerate(value['argvRoles']):
        if type(row) is not dict or set(row) != {'index', 'role', 'byteLength'}:
            raise ValueError('projection row')
        if type(row['index']) is not int or row['index'] != i or row['role'] not in ROLES:
            raise ValueError('projection row index/role')
        if type(row['byteLength']) is not int or not 0 <= row['byteLength'] <= 4096:
            raise ValueError('projection argument bound')
    if value['argvRoles'][0]['role'] != 'program':
        raise ValueError('projection program')
    for field in ['nodeOptionsPresent', 'nodeOptionsMatchesControlled', 'customUAPresent', 'wsPortPresent', 'complete']:
        if type(value[field]) is not bool:
            raise ValueError('projection boolean')
    if value['nodeUseSystemCA'] not in ['absent', '0', '1', 'other'] or value['complete'] is not True:
        raise ValueError('projection terminal')
    return {row['role'] for row in value['argvRoles']}


def main():
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2097152, 2097152))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    signal.signal(signal.SIGALRM, alarm_handler)
    signal.alarm(30)
    out = ROOT / 'results'
    out.mkdir(mode=0o700, exist_ok=False)
    held = []
    try:
        identities = []
        for path, (size, expected_sha) in EXPECTED.items():
            fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
            held.append(fd)
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_size != size:
                raise ValueError('public binary type/size changed')
            h = hashlib.sha256()
            count = 0
            while count < size:
                chunk = os.read(fd, min(1048576, size - count))
                if not chunk:
                    raise ValueError('public binary short read')
                count += len(chunk)
                h.update(chunk)
            if os.read(fd, 1) or stamp(before) != stamp(os.fstat(fd)) or stamp(path.stat()) != stamp(before) or path.is_symlink():
                raise ValueError('public binary changed during binding')
            if h.hexdigest() != expected_sha:
                raise ValueError('public binary SHA changed')
            identities.append({'path': str(path), 'bytes': size, 'sha256': h.hexdigest(), 'before': stamp(before)})
        if not CLANG.is_file() or not os.access(CLANG, os.X_OK) or not SDK.is_dir():
            raise ValueError('direct installed clang/SDK unavailable; do not install')
        namespace = Path(tempfile.mkdtemp(prefix='kiro-request-select02-')).resolve()
        home, tmp = namespace / 'home', namespace / 'tmp'
        home.mkdir(mode=0o700)
        tmp.mkdir(mode=0o700)
        source = ROOT / 'argv_collector.c'
        if sha(source.read_bytes()) != '099725a827dde48b6a2e16440feec5ca706e9e259ecd97d48f6799fe5480e650':
            raise ValueError('collector differs from independently tested frozen source')
        helper, server, trace = namespace / 'fake-kas', namespace / 'server-marker.js', namespace / 'projection.json'
        server.open('xb').close()
        preload = namespace / 'preload-marker.cjs'
        with preload.open('x') as f:
            f.write('// Own marker, not an HTTP observer; fake C executable never loads this.\n')
        node_options = '--require=' + str(preload)
        base_env = {'HOME': str(home), 'TMPDIR': str(tmp), 'PATH': '/usr/bin:/bin:' + str(LAUNCHER.parent),
                    'LANG': 'C', 'LC_ALL': 'C', 'TERM': 'dumb'}
        compile_argv = [str(CLANG), '-isysroot', str(SDK), '-std=c11', '-D_DARWIN_C_SOURCE',
                        '-O2', '-Wall', '-Wextra', '-Werror', '-arch', 'arm64',
                        '-DTRACE_PATH=' + json.dumps(str(trace)),
                        '-DSERVER_MARKER=' + json.dumps(str(server)),
                        '-DEXPECTED_NODE_OPTIONS=' + json.dumps(node_options),
                        str(source), '-o', str(helper)]
        compiled = run(out, 'compile', compile_argv, base_env, namespace, 5, 10)
        if compiled['exit'] != 0 or compiled['timeout'] or not helper.is_file():
            raise ValueError('own collector compile failed; official not executed')
        helper.chmod(0o500)
        policy = '\n'.join([
            '(version 1)', '(allow default)', '(deny network*)', '(deny mach-lookup)',
            '(deny file-read* (subpath "/Users/dane"))', '(deny file-write*)',
            '(allow file-write* (subpath ' + json.dumps(str(namespace)) + '))',
            '(deny process-exec)',
            '(allow process-exec ' + ' '.join('(literal ' + json.dumps(str(p)) + ')' for p in [LAUNCHER, CHAT, helper]) + ')', '',
        ])
        profile = namespace / 'selection.sb'
        with profile.open('x') as f:
            f.write(policy)
        with (out / 'sandbox-profile.sb').open('x') as f:
            f.write(policy)
        env = dict(base_env, KIRO_KAS_NODE_PATH=str(helper), KIRO_KAS_SERVER_PATH=str(server), NODE_OPTIONS=node_options)
        argv = ['/usr/bin/sandbox-exec', '-f', str(profile), str(LAUNCHER), 'chat', '--v3', '--no-interactive',
                '--trust-workspace', '--model', 'deepseek-3.2', 'AXIOM_OFFLINE_SENDER_SELECTION_ONLY']
        preflight = {'driverSHA256': sha(Path(__file__).read_bytes()), 'collectorSourceSHA256': sha(source.read_bytes()),
                     'collectorBinarySHA256': sha(helper.read_bytes()), 'sdkRoot': str(SDK.resolve(strict=True)), 'inputs': identities,
                     'namespace': str(namespace), 'argv': argv, 'environment': env, 'compile': compiled,
                     'scope': 'instrumented V3 selection only, own fake executable, network denied',
                     'modelRequests': 0, 'credentialStoreReadsByDriver': 0,
                     'parentCPUSeconds': 10, 'parentWallSeconds': 30, 'childCPUSeconds': 2, 'childWallSeconds': 5}
        save(out / 'preflight.json', preflight)
        child = run(out, 'official', argv, env, namespace, 2, 5)
        same = all(stamp(os.fstat(fd)) == row['before'] == stamp(Path(row['path']).stat())
                   and not Path(row['path']).is_symlink() for row, fd in zip(identities, held))
        projection = None
        roles = set()
        if trace.exists():
            if trace.is_symlink() or not trace.is_file() or trace.stat().st_size > 16384:
                raise ValueError('own projection file type/cap')
            raw = trace.read_bytes()
            projection = json.loads(raw)
            roles = validate_projection(projection)
            with (out / 'projection.json').open('xb') as f:
                f.write(raw)
        selected = (same and not child['timeout'] and projection is not None
                    and {'server-marker', 'experimental-wasm', 'auth-acp-callback'} <= roles
                    and len(roles & {'transport-stdio', 'transport-ws'}) == 1)
        manifest = dict(preflight)
        manifest.update({'status': 'instrumented_selection_observed' if selected else 'selection_not_observed_no_retry',
                         'official': child, 'inputPostChecksStable': same, 'projectionPresent': projection is not None,
                         'projection': projection, 'actualSenderAPIProved': False, 'naturalDefaultEngineProved': False,
                         'modelAvailabilityProved': False, 'requestConsistencyProved': False,
                         'ordinaryFilesNotPipeEOF': True, 'atomicLoadedImageBindingProved': False})
        manifest['artifacts'] = [{'path': p.name, 'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())}
                                 for p in sorted(out.iterdir())]
        save(out / 'manifest.json', manifest)
        if sum(p.stat().st_size for p in out.iterdir()) > 2097152:
            raise ValueError('result total cap')
        for path in out.iterdir():
            path.chmod(0o400)
        print(json.dumps({'status': manifest['status'], 'officialExit': child['exit'], 'timeout': child['timeout'],
                          'projection': projection, 'modelRequests': 0}))
        return 0 if selected else 1
    finally:
        signal.alarm(0)
        for fd in held:
            os.close(fd)


if __name__ == '__main__':
    raise SystemExit(main())
