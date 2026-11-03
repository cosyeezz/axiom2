"""One official CLI turn; raw streams remain bounded in RAM, never printed/saved."""
import hashlib
import json
import os
from pathlib import Path
import resource
import selectors
import signal
import subprocess
import time

CASE = Path(__file__).resolve().parent
ROOT = CASE.parents[3]
APP = Path('/Applications/Kiro CLI.app/Contents/MacOS')
PROMPT = '请只回复 AXIOM_KIRO_CAPTURE_OK，不要调用工具。'
LIMIT = 131072
SECONDS = 60


def main():
    # A consumed claim is never reused, including preflight failure.
    with (CASE / 'execution.claim').open('x') as claim:
        claim.write('single official prompt attempt\n')
    identity = json.loads((ROOT / 'docs/evidence/kiro-macos-native-02/natural-entry-metadata-03/PUBLIC-IDENTITY.json').read_text())
    for record in identity['files']:
        path = Path(record['path'])
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for chunk in iter(lambda: source.read(1048576), b''):
                digest.update(chunk)
        if path.stat().st_size != record['bytes'] or digest.hexdigest() != record['sha256']:
            raise RuntimeError('public identity changed; no official launch')
    # Keep the existing ordinary large file-size limit; do not restore old low-limit experiments.
    if resource.getrlimit(resource.RLIMIT_FSIZE)[0] < 1_000_000_000:
        raise RuntimeError('unexpected low file-size limit; no official launch')
    env = dict(os.environ)
    ca = str(Path.home() / '.mitmproxy/mitmproxy-ca-cert.pem')
    if env.get('NODE_EXTRA_CA_CERTS') not in (None, '', ca):
        raise RuntimeError('different existing extra CA; no official launch')
    for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'):
        env[key] = 'http://127.0.0.1:8080'
    for key in ('ALL_PROXY', 'all_proxy'):
        env.pop(key, None)
    env['NO_PROXY'] = env['no_proxy'] = 'localhost,127.0.0.1,::1'
    env['NODE_EXTRA_CA_CERTS'] = ca
    env['KIRO_LOG_LEVEL'] = 'error'
    args = [str(APP / 'kiro-cli'), 'chat', '--v3', '--no-interactive', '--model', 'deepseek-3.2', PROMPT]
    start = time.monotonic()
    child = subprocess.Popen(args, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    with (CASE / 'launch.json').open('x') as target:
        json.dump({'directChildPid': child.pid, 'wallSeconds': SECONDS, 'combinedStreamCap': LIMIT,
                   'model': 'deepseek-3.2', 'invocations': 1}, target)
    streams = {'stdout': bytearray(), 'stderr': bytearray()}
    selector = selectors.DefaultSelector()
    for name, pipe in [('stdout', child.stdout), ('stderr', child.stderr)]:
        os.set_blocking(pipe.fileno(), False)
        selector.register(pipe, selectors.EVENT_READ, name)
    fault, exited_at, total = None, None, 0
    try:
        while selector.get_map():
            now = time.monotonic()
            if now - start >= SECONDS:
                fault = 'deadline'; break
            if child.poll() is not None:
                exited_at = exited_at or now
                if now - exited_at >= 2:
                    fault = 'direct_child_exited_pipes_not_eof'; break
            for key, _ in selector.select(0.2):
                chunk = os.read(key.fileobj.fileno(), min(8192, LIMIT - total + 1))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                total += len(chunk)
                if total > LIMIT:
                    fault = 'stream_cap'; break
                streams[key.data].extend(chunk)
            if fault:
                break
        if not fault:
            try:
                child.wait(timeout=max(0.1, SECONDS - (time.monotonic() - start)))
            except subprocess.TimeoutExpired:
                fault = 'deadline_after_eof'
    finally:
        if fault:
            # Only this invocation's new process group; not a complete-descendant claim.
            try: os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try: os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                child.wait(timeout=3)
        selector.close()
        child.stdout.close(); child.stderr.close()
    lower = bytes(streams['stdout'] + streams['stderr']).lower()
    report = {'directChildExit': child.returncode, 'fault': fault,
              'wallSeconds': round(time.monotonic() - start, 3),
              'receivedBytes': {k: len(v) for k, v in streams.items()},
              'pipesReachedEof': fault is None,
              'markerInStdout': b'AXIOM_KIRO_CAPTURE_OK' in streams['stdout'],
              'knownMarkers': {'certificate': b'certificate' in lower,
                               'loginRequired': b'not logged in' in lower or b'please log in' in lower,
                               'unknownArgument': b'unexpected argument' in lower or b'unrecognized option' in lower},
              'invocations': 1, 'actualModelRequests': 'observe_proxy_separately',
              'fullDescendantTerminationProved': False}
    for value in streams.values(): value.clear()
    del lower
    with (CASE / 'EXECUTION.json').open('x') as target:
        json.dump(report, target, indent=2)
    print(json.dumps(report))


if __name__ == '__main__':
    main()
