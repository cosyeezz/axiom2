#!/usr/bin/env python3
"""One system static-tool usage call; no target argument or API control."""
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import subprocess

HERE = Path(__file__).resolve().parent


def main():
    out = HERE / 'tool-help'
    out.mkdir(mode=0o700)
    tool = Path('/usr/bin/dyld_info')
    raw = tool.read_bytes()
    if len(raw) > 1024 * 1024:
        raise ValueError('tool size cap')
    def limits():
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        resource.setrlimit(resource.RLIMIT_FSIZE, (65536, 65536))
    argv = [str(tool), '-help']
    with (out / 'stdout').open('xb') as stdout, (out / 'stderr').open('xb') as stderr:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, env={'HOME': str(out), 'TMPDIR': str(out) + '/', 'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}, preexec_fn=limits)
        timed_out = False
        try:
            rc = child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            timed_out = True
            child.kill()
            rc = child.wait(timeout=2)
    artifacts = []
    for path in sorted(out.iterdir()):
        contents = path.read_bytes()
        path.chmod(0o400)
        artifacts.append({'name': path.name, 'bytes': len(contents), 'sha256': hashlib.sha256(contents).hexdigest()})
    result = {'stage': 'usage_only_no_target', 'argv': argv, 'pid': child.pid, 'exit': rc, 'timedOut': timed_out, 'toolFileBytes': len(raw), 'toolFileSHA256': hashlib.sha256(raw).hexdigest(), 'toolHashNotAtomicLoadedImageProof': True, 'streams': 'regular files, original child waited, not EOF/full-tree proof', 'artifacts': artifacts, 'targetRuns': 0, 'controlCalls': 0, 'officialRuns': 0, 'modelRequests': 0}
    with (out / 'manifest.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        os.fchmod(stream.fileno(), 0o400)
    print(json.dumps(result))
    return 1 if timed_out else 0


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CPU, (5, 6))
    signal.alarm(10)
    raise SystemExit(main())
