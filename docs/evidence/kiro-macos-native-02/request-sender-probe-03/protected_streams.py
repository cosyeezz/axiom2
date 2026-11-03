#!/usr/bin/env python3
"""POSIX held-child metadata capture. No raw output or stream hash is returned.

Only own fake producers may exercise this component until independently checked.
No real credential-store reads, filesystem writing, network, or environment import.
This is not a process-tree containment or request-API transparency mechanism.
"""
import os
import resource
import selectors
import subprocess
import time


class CaptureError(RuntimeError):
    pass


_PATTERNS = {
    'interactiveAuthText': b'Opening browser',
    'authPortalFailureText': b'Failed to initialize auth portal',
    'callbackPortsErrorText': b'All callback ports are in use',
    'permissionFailureText': b'Operation not permitted',
}
_TAIL_BYTES = max(map(len, _PATTERNS.values())) - 1


def _child_limits():
    resource.setrlimit(resource.RLIMIT_CPU, (2, 3))
    _, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    files = 64 if hard == resource.RLIM_INFINITY else min(64, hard)
    resource.setrlimit(resource.RLIMIT_NOFILE, (files, files))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    # Deliberately no FSIZE limit: a normal live SQLite may exceed an own log cap.


def capture(argv, *, env, cwd, wall_seconds=5, stream_cap=65536,
            stop_on_interactive=True):
    """Return fixed metadata; caller must provide explicit minimal env/own cwd.

    Child output is scanned only in transient chunks. No payload, digest, argv,
    env, directory, exception message or unknown text is copied into the result.
    A cap/deadline/interactive marker irreversibly marks capture as incomplete.
    Only this held direct child is killed/reaped; EOF is explicitly separate.
    """
    try:
        valid = (type(argv) is list and 0 < len(argv) <= 64
                 and all(type(v) is str and len(v.encode('utf-8')) <= 4096 for v in argv)
                 and type(env) is dict
                 and all(type(k) is str and type(v) is str for k, v in env.items())
                 and isinstance(cwd, (str, os.PathLike))
                 and type(wall_seconds) in (int, float) and 0 < wall_seconds <= 60
                 and type(stream_cap) is int and 0 < stream_cap <= 65536
                 and type(stop_on_interactive) is bool)
    except Exception:
        valid = False
    if not valid:
        raise CaptureError('invalid-capture-arguments')
    started = time.monotonic()
    deadline = started + wall_seconds
    try:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 cwd=cwd, env=env, close_fds=True,
                                 preexec_fn=_child_limits)
    except Exception:
        raise CaptureError('spawn-failed') from None
    counts = {'stdout': 0, 'stderr': 0}
    eof = {'stdout': False, 'stderr': False}
    tails = {'stdout': b'', 'stderr': b''}
    flags = {k: False for k in _PATTERNS}
    fault = None
    code = None
    selector = None
    try:
        selector = selectors.DefaultSelector()
        for name, stream in (('stdout', child.stdout), ('stderr', child.stderr)):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, name)
        while selector.get_map() and fault is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                fault = 'deadline'
                break
            for key, _ in selector.select(min(remaining, 0.05)):
                name = key.data
                try:
                    chunk = os.read(key.fd, 8192)
                except BlockingIOError:
                    continue
                if not chunk:
                    eof[name] = True
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    tails[name] = b''
                    continue
                counts[name] += len(chunk)
                if counts[name] > stream_cap:
                    fault = name + '-cap'
                    break
                window = tails[name] + chunk
                for tag, pattern in _PATTERNS.items():
                    flags[tag] = flags[tag] or pattern in window
                tails[name] = window[-_TAIL_BYTES:]
                if stop_on_interactive and flags['interactiveAuthText']:
                    fault = 'interactive-auth'
                    break
        if fault is None:
            try:
                code = child.wait(timeout=max(0.001, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                fault = 'deadline'
    except Exception:
        fault = 'capture-error'
    finally:
        if selector is not None:
            try:
                selector.close()
            except Exception:
                fault = fault or 'capture-error'
        for stream in (child.stdout, child.stderr):
            if stream is not None:
                try:
                    stream.close()
                except Exception:
                    fault = fault or 'capture-error'
        tails.clear()
        try:
            alive = child.poll() is None
        except Exception:
            alive = True
            fault = fault or 'capture-error'
        if alive:
            try:
                child.kill()
            except ProcessLookupError:
                pass
            except Exception:
                fault = fault or 'capture-error'
        try:
            code = child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            fault = 'reap-deadline'
        except Exception:
            fault = fault or 'capture-error'
    complete = fault is None and all(eof.values()) and code is not None
    return {
        'schema': 'protected-child-streams-1',
        'pid': child.pid,
        'exit': code,
        'fault': fault,
        'complete': complete,
        'stdoutBytes': counts['stdout'],
        'stderrBytes': counts['stderr'],
        'stdoutEOF': eof['stdout'],
        'stderrEOF': eof['stderr'],
        'signals': flags,
        'wallSeconds': time.monotonic() - started,
        'directChildOnly': True,
        'rawOutputPersistedByComponent': False,
    }
