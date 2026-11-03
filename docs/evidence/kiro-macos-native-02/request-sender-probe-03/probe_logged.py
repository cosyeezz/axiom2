#!/usr/bin/env python3
"""One guarded offline selection with official opaque cached credentials.

Not a model run or request baseline. No observer credential-content/Keychain access.
Normal state DIRECTORY components get lstat metadata checks, not DB access.
The READINESS gate must exist before the unique main; never run main as a test.
"""
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import stat
import tempfile

ROOT = Path(__file__).resolve().parent
LAUNCHER = Path('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli')
CHAT = LAUNCHER.with_name('kiro-cli-chat')
CLANG = Path('/Library/Developer/CommandLineTools/usr/bin/clang')
SDK = Path('/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk')
REAL_HOME = Path('/Users/dane')
STATE = REAL_HOME / 'Library/Application Support/kiro-cli'
COLLECTOR = ROOT.parent / 'request-sender-probe-02/argv_collector.c'
COLLECTOR_SHA = '099725a827dde48b6a2e16440feec5ca706e9e259ecd97d48f6799fe5480e650'
STREAM_SHA = 'b1f8f3e26e380d907016add782266f952e1359d4ac7e51bb137c3b76381da655'
EXPECTED = {
    LAUNCHER: (73432992, '8e242d795f93a70bc4497907d9aaf2d1552a07ee8a7a86e0276af6cf55672fd2'),
    CHAT: (413051920, '7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f'),
}
ROLES = {'program', 'server-marker', 'experimental-wasm', 'transport-stdio', 'transport-ws',
         'auth-acp-callback', 'auth-user', 'auth-machine', 'unknown'}


class Refused(RuntimeError):
    pass


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def stamp(info):
    return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns]


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Refused('duplicate-json-key')
        result[key] = value
    return result


def reject_constant(value):
    raise Refused('nonfinite-json')


def read_own(path, cap):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or not 0 <= before.st_size <= cap:
            raise Refused('own-input-type-or-cap')
        raw = b''
        while len(raw) <= cap:
            chunk = os.read(fd, min(8192, cap + 1 - len(raw)))
            if not chunk:
                break
            raw += chunk
        if len(raw) > cap or len(raw) != before.st_size or stamp(before) != stamp(os.fstat(fd)):
            raise Refused('own-input-changed')
        return raw
    finally:
        os.close(fd)


def parse_own(raw):
    return json.loads(raw, object_pairs_hook=unique_pairs, parse_constant=reject_constant)


def state_directory_metadata(path):
    # Narrow metadata only: no directory listing, DB stat/open or readlink.
    # Pre/prelaunch/post lstat detects aliases/identity changes, not atomic races.
    if not isinstance(path, Path) or not path.is_absolute() or '..' in path.parts:
        raise Refused('state-path-not-absolute-lexical')
    rows = []
    for component in [*reversed(path.parents), path]:
        info = component.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise Refused('state-component-not-real-directory')
        rows.append({'path': str(component), 'device': info.st_dev, 'inode': info.st_ino,
                     'kind': stat.S_IFMT(info.st_mode), 'owner': info.st_uid})
    if rows[-1]['owner'] != os.getuid():
        raise Refused('state-root-not-owned')
    return rows


def save(path, value):
    raw = (json.dumps(value, ensure_ascii=True, indent=2, allow_nan=False) + '\n').encode('ascii')
    if len(raw) > 65536:
        raise Refused('own-output-cap')
    with path.open('xb') as output:
        output.write(raw)


def validate_projection(value):
    keys = {'schema', 'argc', 'argvRoles', 'nodeOptionsPresent', 'nodeOptionsMatchesControlled',
            'nodeUseSystemCA', 'customUAPresent', 'wsPortPresent', 'complete'}
    if type(value) is not dict or set(value) != keys or value['schema'] != 'own-kas-role-1':
        raise Refused('projection-schema')
    argc = value['argc']
    if type(argc) is not int or not 1 <= argc <= 64 or type(value['argvRoles']) is not list or len(value['argvRoles']) != argc:
        raise Refused('projection-argc')
    for index, row in enumerate(value['argvRoles']):
        if type(row) is not dict or set(row) != {'index', 'role', 'byteLength'}:
            raise Refused('projection-row')
        if type(row['index']) is not int or row['index'] != index or type(row['role']) is not str or row['role'] not in ROLES:
            raise Refused('projection-role')
        if (row['role'] == 'program') != (index == 0):
            raise Refused('projection-program-position')
        if type(row['byteLength']) is not int or not 0 <= row['byteLength'] <= 4096:
            raise Refused('projection-byte-bound')
    for field in ['nodeOptionsPresent', 'nodeOptionsMatchesControlled', 'customUAPresent', 'wsPortPresent', 'complete']:
        if type(value[field]) is not bool:
            raise Refused('projection-boolean')
    if type(value['nodeUseSystemCA']) is not str or value['nodeUseSystemCA'] not in {'absent', '0', '1', 'other'} or value['complete'] is not True:
        raise Refused('projection-terminal')
    if value['nodeOptionsMatchesControlled'] and not value['nodeOptionsPresent']:
        raise Refused('projection-marker-consistency')
    return [row['role'] for row in value['argvRoles']]


def make_policy(namespace, normal_state, executable_paths):
    quote = lambda path: json.dumps(str(path))
    return '\n'.join([
        '(version 1)', '(allow default)', '(deny network*)', '(deny mach-lookup)',
        '(deny file-write*)',
        '(allow file-write* (subpath ' + quote(namespace) + ') (subpath ' + quote(normal_state) + '))',
        '(deny process-exec)',
        '(allow process-exec ' + ' '.join('(literal ' + quote(path) + ')' for path in executable_paths) + ')', '',
    ])


def bind_public(held):
    rows = []
    for path, (size, expected) in EXPECTED.items():
        fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
        held.append(fd)
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size != size:
            raise Refused('public-input-type-or-size')
        hashed = hashlib.sha256()
        remaining = size
        while remaining:
            chunk = os.read(fd, min(1048576, remaining))
            if not chunk:
                raise Refused('public-input-short')
            remaining -= len(chunk)
            hashed.update(chunk)
        if (os.read(fd, 1) or stamp(before) != stamp(os.fstat(fd))
                or stamp(path.lstat()) != stamp(before) or path.is_symlink()
                or hashed.hexdigest() != expected):
            raise Refused('public-input-changed')
        rows.append({'path': str(path), 'bytes': size, 'sha256': expected, 'before': stamp(before)})
    return rows


def alarm_handler(signum, frame):
    raise Refused('parent-deadline')


def main():
    held = []
    out = None
    stage = 'readiness'
    try:
        # This must remain unlimited in BOTH parent and child; don't raise it.
        if resource.getrlimit(resource.RLIMIT_FSIZE) != (resource.RLIM_INFINITY, resource.RLIM_INFINITY):
            raise Refused('inherited-file-limit-refused')
        if os.getuid() != 501 or os.geteuid() != 501 or os.uname().machine != 'arm64':
            raise Refused('host-identity-refused')
        module_raw = read_own(ROOT / 'protected_streams.py', 16384)
        collector_raw = read_own(COLLECTOR, 16384)
        driver_sha = digest(read_own(Path(__file__), 32768))
        if digest(module_raw) != STREAM_SHA or digest(collector_raw) != COLLECTOR_SHA:
            raise Refused('frozen-components-changed')
        expected_ready = {'schema': 'selection03-ready-1', 'scope': 'cached-login-offline-instrumented-only',
                          'driverSHA256': driver_sha, 'streamModuleSHA256': STREAM_SHA,
                          'collectorSourceSHA256': COLLECTOR_SHA, 'reviewedFixtures': True}
        ready = parse_own(read_own(ROOT / 'READINESS.json', 4096))
        if type(ready) is not dict or ready != expected_ready or type(ready.get('reviewedFixtures')) is not bool:
            raise Refused('readiness-not-satisfied')
        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        signal.signal(signal.SIGALRM, alarm_handler)
        signal.alarm(30)
        candidate = ROOT / 'results'
        candidate.mkdir(mode=0o700, exist_ok=False)
        out = candidate
        namespace = Path(tempfile.mkdtemp(prefix='kiro-request-select03-')).resolve()
        home, tmp = namespace / 'compile-home', namespace / 'tmp'
        home.mkdir(mode=0o700)
        tmp.mkdir(mode=0o700)
        module_scope = {'__name__': 'frozen_protected_streams_03', '__file__': str(ROOT / 'protected_streams.py')}
        exec(compile(module_raw, module_scope['__file__'], 'exec'), module_scope)
        capture = module_scope['capture']
        stage = 'normal-state-directory-metadata'
        state_before = state_directory_metadata(STATE)
        stage = 'public-binding'
        identities = bind_public(held)
        if not CLANG.is_file() or not os.access(CLANG, os.X_OK) or not SDK.is_dir():
            raise Refused('installed-compiler-or-sdk-missing')
        helper, server, trace = namespace / 'fake-kas', namespace / 'server-marker.js', namespace / 'projection.json'
        server.open('xb').close()
        preload = namespace / 'preload-marker.cjs'
        with preload.open('x') as output:
            output.write('// Own marker only; fake C never executes JS.\n')
        node_options = '--require=' + str(preload)
        base_env = {'HOME': str(home), 'TMPDIR': str(tmp), 'PATH': '/usr/bin:/bin:' + str(LAUNCHER.parent),
                    'LANG': 'C', 'LC_ALL': 'C', 'TERM': 'dumb'}
        compile_argv = [str(CLANG), '-isysroot', str(SDK), '-std=c11', '-D_DARWIN_C_SOURCE',
                        '-O2', '-Wall', '-Wextra', '-Werror', '-arch', 'arm64',
                        '-DTRACE_PATH=' + json.dumps(str(trace)), '-DSERVER_MARKER=' + json.dumps(str(server)),
                        '-DEXPECTED_NODE_OPTIONS=' + json.dumps(node_options), str(COLLECTOR), '-o', str(helper)]
        stage = 'own-compile'
        compiled = capture(compile_argv, env=base_env, cwd=namespace, wall_seconds=5)
        save(out / 'compile.json', {'controlledArgv': compile_argv, 'capture': compiled})
        if not compiled['complete'] or compiled['exit'] != 0 or not helper.is_file() or helper.is_symlink():
            raise Refused('own-compile-failed')
        helper.chmod(0o500)
        stage = 'policy'
        policy = make_policy(namespace, STATE, [LAUNCHER, CHAT, helper])
        profile = namespace / 'selection.sb'
        with profile.open('x') as output:
            output.write(policy)
        with (out / 'sandbox-profile.sb').open('x') as output:
            output.write(policy)
        env = dict(base_env, HOME=str(REAL_HOME), KIRO_KAS_NODE_PATH=str(helper),
                   KIRO_KAS_SERVER_PATH=str(server), NODE_OPTIONS=node_options)
        argv = ['/usr/bin/sandbox-exec', '-f', str(profile), str(LAUNCHER), 'chat', '--v3', '--no-interactive',
                '--trust-workspace', '--model', 'deepseek-3.2', 'AXIOM_OFFLINE_SENDER_SELECTION_ONLY']
        preflight = {'driverSHA256': driver_sha, 'streamModuleSHA256': STREAM_SHA, 'collectorSourceSHA256': COLLECTOR_SHA,
                     'collectorBinarySHA256': digest(read_own(helper, 1048576)), 'sdkRoot': str(SDK.resolve(strict=True)),
                     'inputs': identities, 'namespace': str(namespace), 'controlledArgv': argv,
                     'controlledEnvironment': env, 'scope': 'cached login offline instrumented selection only',
                     'modelRequests': 0, 'credentialContentReadsByDriver': 0,
                     'normalStateDirectoryMetadata': state_before,
                     'directoryMetadataPathQueriesBeforeOfficial': 2 * len(state_before),
                     'directoryBindingLimit': 'lstat components pre/prelaunch/post; not atomic path-race protection',
                     'officialNormalCredentialAccess': 'opaque, may read normal app state; new mach lookup denied',
                     'officialNormalStateWritesAllowed': True, 'realSettingsAgentWritesDenied': True,
                     'rawOfficialOutputPersistence': False, 'parentCPUSeconds': 10, 'parentWallSeconds': 30,
                     'childCPUSeconds': [2, 3], 'childWallSeconds': 5, 'childDirectReapSeconds': 2,
                     'fileSizeHardLimitSet': False, 'perStreamReaderCap': 65536}
        stage = 'prelaunch-state-directory-metadata'
        if state_directory_metadata(STATE) != state_before:
            raise Refused('state-components-changed-before-launch')
        save(out / 'preflight.json', preflight)
        stage = 'official-capture'
        child = capture(argv, env=env, cwd=namespace, wall_seconds=5)
        save(out / 'official.json', child)
        stage = 'post-state-directory-metadata'
        state_stable = state_directory_metadata(STATE) == state_before
        same = all(stamp(os.fstat(fd)) == row['before'] == stamp(Path(row['path']).lstat())
                   and not Path(row['path']).is_symlink() for row, fd in zip(identities, held))
        stage = 'projection'
        projection, roles = None, []
        if os.path.lexists(trace):
            projection = parse_own(read_own(trace, 16384))
            roles = validate_projection(projection)
            save(out / 'projection.json', projection)
        expected_roles = (roles.count('server-marker') == 1 and roles.count('experimental-wasm') == 1
                          and sum(roles.count(r) for r in ['transport-stdio', 'transport-ws']) == 1
                          and sum(roles.count(r) for r in ['auth-acp-callback', 'auth-user', 'auth-machine']) == 1
                          and roles.count('auth-acp-callback') == 1)
        selected = (same and state_stable and child['complete'] and child['fault'] is None and type(child['exit']) is int
                    and child['exit'] >= 0 and projection is not None and expected_roles)
        manifest = dict(preflight, status='instrumented_selection_observed' if selected else 'selection_not_observed_no_retry',
                        compile=compiled, official=child, inputPostChecksStable=same, projection=projection,
                        stateDirectoryPostIdentityStable=state_stable,
                        directoryMetadataPathQueriesTotal=3 * len(state_before),
                        nodeOptionsInheritanceObserved=bool(projection and projection['nodeOptionsMatchesControlled']),
                        actualSenderAPIProved=False, naturalDefaultEngineProved=False,
                        modelAvailabilityProved=False, requestConsistencyProved=False, atomicLoadedImageBindingProved=False)
        manifest['artifacts'] = [{'path': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())}
                                 for path in sorted(out.iterdir())]
        save(out / 'manifest.json', manifest)
        if sum(path.stat().st_size for path in out.iterdir()) > 2097152:
            raise Refused('own-results-total-cap')
        for path in out.iterdir():
            path.chmod(0o400)
        print(json.dumps({'status': manifest['status'], 'officialExit': child['exit'],
                          'captureFault': child['fault'], 'projectionPresent': projection is not None,
                          'nodeOptionsInheritanceObserved': manifest['nodeOptionsInheritanceObserved'], 'modelRequests': 0}))
        return 0 if selected else 1
    except Exception:
        # Never serialize/render exception objects, context, locals or unknown text.
        failure = {'status': 'refused_or_failed_no_retry', 'stage': stage, 'modelRequests': 0}
        if out is not None:
            save(out / 'failure.json', failure)
        print(json.dumps(failure))
        return 1
    finally:
        signal.alarm(0)
        for fd in held:
            os.close(fd)


if __name__ == '__main__':
    raise SystemExit(main())
