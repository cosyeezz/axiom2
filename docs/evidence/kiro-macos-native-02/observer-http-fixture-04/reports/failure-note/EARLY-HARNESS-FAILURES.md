# Early harness failure preservation addendum

Documentation only. No test was executed for this addendum. None of the three original TEMP directories, tested sources, or repository files was modified.

## Provenance / limitations

This is a newly written report, NOT an original stderr/exit log. The first failure's traceback and both parent/shell exit statuses below are transcribed from the original functions.bash tool responses in this conversation. Those tool calls ended with `MAIN_EXIT=1` and `Command exited with code 1`.

The first TEMP has no preserved stderr/exit file (main.py only, as confirmed by the main agent). No old log is being regenerated. Its traceback was emitted by the parent Python directly into the original tool output; no child was started because the parent assertion failed before its child loop. The earlier final's exit claim relied on that original tool response, not an on-disk exit file.

The second TEMP's original py39.stderr, py314.stderr and summary.json remain the on-disk sources; their verbatim content is appended below. summary.json records child exits, not an independently saved parent exit. The parent/shell exit 1 is sourced from the original tool response. Initial tool-call IDs are not exposed by this tool interface; identify them by the unique TEMP names, command and traceback below. No timestamps beyond existing evidence are inferred.

The shell execution cwd for both original calls was /Volumes/D_Work/axiom2. The displayed commands are the actual execution portions of those calls (TEMP creation and main.py-writing heredocs omitted, NOT a claim to reproduce the entire setup shell).

## First failure: exact execution portion, expanded TEMP

```sh
/usr/bin/env -i HOME="/private/tmp/axiom-depth04-independent-I0zPZDMO/home" TMPDIR="/private/tmp/axiom-depth04-independent-I0zPZDMO/tmp" PATH=/usr/bin:/bin LANG=C LC_ALL=C /usr/bin/python3 -I -B "/private/tmp/axiom-depth04-independent-I0zPZDMO/main.py"; E=$?; echo "MAIN_EXIT=$E"; exit "$E"
```

Parent Python exit: 1. Shell/tool exit: 1. No child exit exists.
Original tool-output traceback, transcribed verbatim:

```text
Traceback (most recent call last):
  File "/private/tmp/axiom-depth04-independent-I0zPZDMO/main.py", line 115, in <module>
    if __name__=='__main__': sys.exit(worker() if len(sys.argv)>1 and sys.argv[1]=='worker' else main())
  File "/private/tmp/axiom-depth04-independent-I0zPZDMO/main.py", line 83, in main
    assert reconstructed==old,'unexpected text delta'
AssertionError: unexpected text delta
MAIN_EXIT=1
```

Cause: harness text reconstruction removed the blank line preceding `def pairs`; not a consumer failure. The subsequent correction retained that blank line in a NEW TEMP, not this original TEMP.

## Second failure: exact execution portion, expanded TEMP

```sh
/usr/bin/env -i HOME="/private/tmp/axiom-depth04-independent-NgbVVhsB/home" TMPDIR="/private/tmp/axiom-depth04-independent-NgbVVhsB/tmp" PATH=/usr/bin:/bin LANG=C LC_ALL=C /usr/bin/python3 -I -B "/private/tmp/axiom-depth04-independent-NgbVVhsB/main.py"; E=$?; echo "MAIN_EXIT=$E"; exit "$E"
```

Parent Python exit: 1; shell/tool exit: 1 (original tool output `MAIN_EXIT=1`, then `Command exited with code 1`). Both child exits: 1, per original summary.json. Exact child argv and cwd are in the original summary appended below. Parent main set a hard CPU limit of 6 seconds; each worker attempted to raise its inherited hard limit to 12 seconds before loading the consumer. Thus these are harness initialization failures, not consumer test results.

Original second TEMP artifact contents follow. They are quoted readbacks in this NEW report, not new executions or replacement original logs. SHA256 and byte sizes bind each readback to its source at report creation.

## Original artifact readback: /private/tmp/axiom-depth04-independent-NgbVVhsB/py39.stderr

Bytes: 412; SHA256: `169a127191c24762bb8842c7443618c97269956d069709153baa6386f4b4e803`

```text
Traceback (most recent call last):
  File "/private/tmp/axiom-depth04-independent-NgbVVhsB/main.py", line 115, in <module>
    if __name__=='__main__': sys.exit(worker() if len(sys.argv)>1 and sys.argv[1]=='worker' else main())
  File "/private/tmp/axiom-depth04-independent-NgbVVhsB/main.py", line 12, in worker
    resource.setrlimit(resource.RLIMIT_CPU,(12,12))
ValueError: not allowed to raise maximum limit

```

## Original artifact readback: /private/tmp/axiom-depth04-independent-NgbVVhsB/py314.stderr

Bytes: 511; SHA256: `7c64da7de08ec49472d62ed0754d404052c02189d7a8356bd6ce04e4a08fb5d7`

```text
Traceback (most recent call last):
  File "/private/tmp/axiom-depth04-independent-NgbVVhsB/main.py", line 115, in <module>
    if __name__=='__main__': sys.exit(worker() if len(sys.argv)>1 and sys.argv[1]=='worker' else main())
                                      ~~~~~~^^
  File "/private/tmp/axiom-depth04-independent-NgbVVhsB/main.py", line 12, in worker
    resource.setrlimit(resource.RLIMIT_CPU,(12,12))
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
ValueError: not allowed to raise maximum limit

```

## Original artifact readback: /private/tmp/axiom-depth04-independent-NgbVVhsB/summary.json

Bytes: 1746; SHA256: `2e1bde77d6f85e06fdb41deb4ca23b31690cc4227c898ec4756e33ed4b4236d8`

```text
{
  "before": [
    "0a4871784b92e07baa43f9ad2395e95d6ac0b5250ec390e548f05a9b61193bdf",
    "4d848742029ed86dd8769a0dc2280312cd92002fc8d44e645e4777692e8def1f"
  ],
  "after": [
    "0a4871784b92e07baa43f9ad2395e95d6ac0b5250ec390e548f05a9b61193bdf",
    "4d848742029ed86dd8769a0dc2280312cd92002fc8d44e645e4777692e8def1f"
  ],
  "runs": [
    {
      "cmd": [
        "/usr/bin/python3",
        "-I",
        "-B",
        "/private/tmp/axiom-depth04-independent-NgbVVhsB/main.py",
        "worker"
      ],
      "cwd": "/private/tmp/axiom-depth04-independent-NgbVVhsB",
      "exit": 1,
      "seconds": 0.14243229100000002
    },
    {
      "cmd": [
        "/Users/dane/.pyenv/versions/3.14.7/bin/python3",
        "-I",
        "-B",
        "/private/tmp/axiom-depth04-independent-NgbVVhsB/main.py",
        "worker"
      ],
      "cwd": "/private/tmp/axiom-depth04-independent-NgbVVhsB",
      "exit": 1,
      "seconds": 0.07642570800000004
    }
  ],
  "env": {
    "HOME": "/private/tmp/axiom-depth04-independent-NgbVVhsB/home",
    "TMPDIR": "/private/tmp/axiom-depth04-independent-NgbVVhsB/tmp",
    "PATH": "/usr/bin:/bin",
    "LANG": "C",
    "LC_ALL": "C",
    "PYTHONDONTWRITEBYTECODE": "1"
  },
  "artifact_bytes": 11179,
  "files": {
    "audit.json": 463,
    "py39.stdout": 0,
    "delta.diff": 1335,
    "py314.stderr": 511,
    "py314.stdout": 0,
    "main.py": 8458,
    "py39.stderr": 412
  },
  "child_cpu_seconds": 0.14825499999999997,
  "limits": {
    "wall": 90,
    "main_cpu": 6,
    "each_child_cpu": 12,
    "child_wall": 20,
    "stream": 1048576,
    "evidence": 4194304
  },
  "scope": "own pure consumer only; no network/Node/official/model; interpreter binary under user installation only, HOME isolated"
}
```

## Scope boundary

This addendum neither reruns nor recounts the accepted test suite. Original failure directories and the successful third TEMP remain untouched. No claim is made that the first traceback was preserved on disk at the time of failure, or that either parent exit has an original on-disk exit file.
