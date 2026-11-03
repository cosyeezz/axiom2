# Unit02 independent execution audit

Conclusion: PASS, one controller invocation and one retained direct worker; no rerun.
Working directory: /Volumes/D_Work/axiom2
Actual command: `/usr/bin/python3 -I -B /private/tmp/catalog-xref-unit02-tb64b7v4/controller.py`
Tool: functions.bash, timeout=15 seconds; controller exit 0 (normal tool completion, not timed out). Owner failure: none observed. Worker PID 11837, actual worker exit 0; held-start workerCount=1. stdout/stderr trueEOF=true/true; captureFault=null and report fault=null. Received 917 bytes, retained stdout917/stderr0; raw streams not persisted.

Closed safe result: 14 named cases, 75 assertions; all pass. Tiny FD size10, stable/regular/owned=true; RAM restored=true. Actual worker runtime Python3.9.6, darwin, arm64. Actual worker rlimit soft/hard: CPU2/3, CORE0/0, FSIZE65536/65536, NOFILE32/32. Worker environment expectedSixPresent=true, onlyDocumentedExtras=true, actualKeyCount12, platformExtraCount6. No inherited controller environment enumeration. Prelaunch records only the fixed six-entry launch envelope, not an environment dump.

Controller configured CPU10/10, NOFILE64/64, CORE0/0, FSIZE65536/65536, alarm12; actual controller getrlimit values not exported (unknown). Worker alarm5, pipe deadline5, cleanup wait2; success did not test their failure paths. Held elapsedBeforePublication=0.085161709s: post-import main start through prepublication observation, not interpreter startup or whole-author timing.

Originals and copies matched requested byte counts/SHA256 before execution; copies frozen0400 and root0700. before.audit.json retains own original/copy identity metadata; after.audit.json is identical including device/inode/timestamps/modes/uid. Current originals and copies remain byte-identical. Controller prelaunch and held before/after bindings match own retained copy metadata (uid excluded from controller schema).

Full inspected evidence: report.json, held.json, held-start.json, prelaunch.json, worker.safe.json. No raw worker output, exception text, or environment dumps saved by this audit. All newly generated artifacts are in this owned root; repository files unmodified.

Final owned regular-file bytes including this audit: 41855; below128KiB. This is final file-size accounting, not peak quota or RSS proof. No all-stage/failure-branch, startup, signal, constructor, cap, kill/reap, or storage-failure certification. Synthetic-helper-only: no official artifact/stat, xref main/run_once, network/auth/state/process scan, Node/SDK or old tests accessed. Unit01 not rerun/reclassified. No native request/server parity claim. Leave root intact for independent main-agent consumption.
