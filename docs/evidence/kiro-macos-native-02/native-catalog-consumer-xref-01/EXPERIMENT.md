# Consumer xref01 — single-entry immediate branches

## Question and prior evidence

[Window01 semantics](../native-catalog-window-01/SEMANTICS.md) identified parameter construction at `0x1014c6ee8`, with the normal `list_models` result stored as one byte at output+0x131. The next missing link is a consumer/entry caller, not the generic lookup or allocation helper type. Find only direct ARM64 B/BL immediate references to **that single function entry**. A hit is a static branch candidate, not runtime reachability, CLI dispatch or native catalog grammar.

This is a new predicate/experiment, not a replay of the consumed ADRP+ADD xref, extraction, parser or LLDB cases. No old script main/scan is run. Do not widen to indirect targets, other entries, full call graphs, std/helpers, the41012B registration function, Ghidra, official program execution, accounts or requests. No new function body is exported in this case. Decide any later small-window analysis separately from actual returned ranges.

## Frozen input and limits

- Public frozen Kiro2.35.2 fat MachO:413051920B, historical whole-file SHA256 `7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f`; ARM slice offset215023616.
- One same-FD read: header4352 at slice+0; table194104 at slice+197396912; text69216304 at slice+4352. Total **69414760B**. Match complete known header/table/text SHA from xref01; before/after fstat stable, regular/currentuid/mode0400. No fresh whole-file hash or atomically loaded image claim.
- Reuse only `read_at(fd, offset, length)`, `stable(stat)`, `function_starts(raw, image, lower, upper)` from frozen xref.py8114B/SHA `bb5c054173e3aaf6574a1a8db190be415e1bceb08a1728386420e953e5f53e2f`, after bounded same-FD identity validation; non-main load of this own Python helper only. These interfaces were read and confirmed. Do not invoke its run_once/scan.
- Linear word scan of this known text only. Exact B/BL opcode, signed26-bit immediate shifted2, PC-relative target must equal0x1014c6ee8. Keep at most16 matches; count capped at17 and incomplete if over16. Map retained PCs to already validated function-start boundaries. No negative claim about indirect/metadata references.
- One tool-managed Python worker, no subprocesses. CPU10/12, CORE0, FSIZE64KiB, NOFILE32, alarm14; tool timeout18. Read cap as above, own metadata≤64KiB, each JSON≤8192B. Planned RAM<256MiB, not an OS RSS cap or measured peak. No normal application state is used; these FSIZE limits are forbidden for normalSTATE.
- Own0700 `/private/tmp/kiro-native-consumer-xref01-*`. Repo `LAUNCH_ONCE.json` and own RUN_ONCE created exclusively before target access. Success and failure consume the case. Own/static files only; source/helper read cap16KiB each.

## Limited pre-read decoder cases

Exactly8 main-authored calls/assertions in RAM before target access, inside the same one-shot worker: BL+4, BL-4, B-self, maximum positive B displacement, minimum negative BL displacement, rejection of NOP, B.cond, and BR. Expected constants are independently literal; no target data or fixture imports. These are limited decoder examples, not an independent test matrix or CFG validation. Reused helper matrices are not rerun. Any failure stops before target access and consumes the marker.

## Publication and terminal distinction

All imported/processed bytes are public program artifacts, never account/request context. Persist only fixed report keys, public addresses/instruction words, bound source SHA and counts. Do not print/persist unknown exception strings, traceback, environment values or arbitrary raw output. Failure records fixed phase and known counters where possible; import, signal/storage and publication failure coverage is not independently proved.

Use `/usr/bin/python3 -I -B <new worker.py>` through codemode `tools.bash`, explicitly retain its numeric exit_code. Tool-managed terminal status plus worker self-reported PID must not be called an independent held-PID owner/EOF protocol; no extra owner, process tree, actual environment or real-auth safety proof is claimed. Inherited environment is not enumerated. Source/helper before/after are recorded; this is not atomic loaded-code identity.

Success requires8 decoder assertions, target identity/hashes/read count, valid function-start table, completed scan and source stability, successful closed report publication, and tool actual exit0. After consuming the result, main checks reports and retained words without rerunning the producer or rereading the target. A cap/unknown/failed stage is retained as such; do not raise limits or retry. Exact command/source digest and result locations are recorded at launch/consumption.
