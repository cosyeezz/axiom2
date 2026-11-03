# Catalog xref unit02 — corrected fixture contract, not a scan

## Hypothesis and distinction

Unit01 (t11808/r11817) ended failed: controller exit 1, zero verified passing cases, actual completed counts/PID/worker exit/EOF unknown. Its unchanged original eight artifacts remain in `failed-unit01/` and `/private/tmp/catalog-xref-unit01-aj8x1d4y/`. Do not repair or rerun that namespace. Static inspection identifies two contract defects: it used the wrong expected/optional environment key sets, and discarded held metadata on worker or output-gate failure. Neither is established as its actual runtime failure cause.

New hypothesis: the unchanged xref helpers satisfy the original finite 14-case / 75-assertion oracle under the intended documented environment envelope; a new one-shot owner can retain a closed, useful outcome even if the worker fails. Only the successful or actually exercised branches will be credited. This is a new fixture condition, not a changed xref implementation or reclassification of unit01. Existing request-level authorization suffices; this adds no target, state, credential, network or model access.

## Inputs and fixed oracle

- `xref.py`: 8114 bytes, SHA256 `bb5c054173e3aaf6574a1a8db190be415e1bceb08a1728386420e953e5f53e2f`, copied byte-for-byte as `source.py`; import-only, never `run_once/main`.
- Main-authored `unit02_harness.py` and `unit02_controller.py`: freeze after AST-only/source-identity checks, then delegate copying/execution, not implementation changes.
- The fourteen functional case functions remain byte-semantically unchanged by AST comparison to failed-unit01/harness.py. Counts in order: 7,5,5,7,3,6,4,3,6,4,7,9,3,6 = 75. ADRP, ADD, ULEB and tiny own-FD cases; synthetic small scan with four temporary RAM anchors, cross-function bounds, +8/+9 instruction window and 17-count/16-retained/64-total cap. Restore RAM constants; do not monkeypatch shared os or alter source files.
- Popen exactly HOME/TMPDIR/TMP/TEMP/PATH/LANG; HOME/TMP values owned, PATH `/usr/bin:/bin`, LANG `C`. Worker requires those keys and permits only CPATH/LC_CTYPE/LIBRARY_PATH/MANPATH/SDKROOT/__CF_USER_TEXT_ENCODING as optional platform extras. Persist only booleans/counts, no actual environment dump. Controller environment inherited and not enumerated.
- New harness additionally emits fixed failure phase/completedNamedCases/assertionsAttempted, or bounded success runtime/actual rlimit pairs. Failed attempted assertions are not passing assertions.

## Single execution and budgets

Working directory `/Volumes/D_Work/axiom2`; delegate creates one 0700 `/private/tmp/catalog-xref-unit02-*` directory, copies three fixed files as source.py/harness.py/controller.py, freezes mode0400, records original/copy identities, and invokes `/usr/bin/python3 -I -B <owned-root>/controller.py` once. Controller creates exclusive RUN_ONCE and exclusive result files; root is never reused. One worker only; no automatic repair, second worker, rerun or cap increase after failure.

Worker preexec and script-start: CPU soft2/hard3, alarm5, NOFILE32, core0, own-static FSIZE65536. Controller CPU10/10, NOFILE64, core0, own-static FSIZE65536, alarm12, pipe deadline5, direct-child cleanup wait2, tool outer15. Combined stdout/stderr cap8192 (received can exceed cap by at most one read of1024), each JSON artifact8192, owned total128KiB. Only this tiny synthetic namespace uses FSIZE; no normal DB/state process. Save no raw streams, exception text/repr/traceback/unknown hashes. Report wall measured from post-import controller main start through publication boundary, not whole-author or interpreter startup. No whole-author120 requirement. Final own-size is not peak quota or RSS proof.

## Acceptance and failure handling

Require actual held PID/worker exit0/two observed true EOF/no capture fault, exact closed success schema with all 14 named cases/75 assertions, expected six keys/only allowed extras, actual runtime and four rlimit pairs, tiny FD identity, RAM restoration, and source/harness/controller before-after-copy identities. Preserve original actual tool controller exit separately.

Owner writes held-start immediately after Popen and held.json before requiring exit0 or parsing worker JSON; held persists even for nonzero child/output rejection where owner reaches publication. A fixed failure object is accepted only for actual child exit1 with whitelisted phase and bounded counters; unknown streams remain withheld. Both before/after binding and true EOF reflect observations, not simulated success after close/kill. Capture faults and output-gate faults remain distinct in report versus held. If initialization/publication itself fails, report missing metadata as unknown, not complete. Startup, signal, constructor, cap, kill/reap and storage-failure branches are not independently tested by a success run.

No official binary/snapshot stat/read, archive/Node/SDK/HTTP/auth/state/network/OS process scan, production modification or xref target scan. Xref main remains unlaunched until independent result consumption and main artifact audit. On failure retain this case and reason scope; do not pursue environment mechanism research or broaden execution permissions.
