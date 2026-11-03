# Header/privacy02 — new controller, unchanged module and vectors

## Why a new case

privacy01 (t11674/r11683) did not create a Node worker: its supervisor exited1 at mkdir of an already-existing ownHOME, before resource setup/source hash/canary generation/Popen. That failed case and its exact controller remain at `/private/tmp/real-value-privacy01-hlPooh4h/`. It is not a module finding and must not be rerun or edited. No runtime coverage follows from its unexecuted harness. Main has read that harness; its JavaScript CRLF literals are correctly single-escaped. A main data audit misread JSON escaping and failed its final assertion; source-character inspection corrected that mistake without Node execution.

New hypothesis: with ownership of precreated own directories checked instead of blindly creating them again, the previously unexecuted header vectors can run once and establish their limited pure-function/privacy behavior. This changes the test controller, not the implementation or expected header semantics. Do not rerun the independent passed UTF801 worker (85 cases including3header smoke, held26352/exit0).

## Frozen inputs

- [Module](safe_value_checks.cjs): 6639B, SHA256 `f357a0bf5c04308eae7eade520a30240c7350cc6d8e1f8880b716bb83790f802`.
- [Contract](CONTRACT.md) and [original scope](EXPERIMENT.md).
- Node harness: exact bytes of `/private/tmp/real-value-privacy01-hlPooh4h/harness.cjs`, never previously executed. Copy to new own namespace; record before/after SHA. Do not silently edit vectors/oracles. If a vector fails, preserve the failure and identify implementation versus oracle separately; no second worker.

## New startup conditions

One CreateNew `/private/tmp/real-value-privacy02-…` root, mode0700/current UID, and own home/tmp/cwd. Controller runs `/usr/bin/python3 -I -B`; explicit minimal env with ownHOME/TMP and PATH=/usr/bin:/bin/LANG=C/stdinDEVNULL. Establish all directories once before launch. Controller verifies existing root/home/tmp/cwd are ordinary owned directories via lstat, not symlinks, without querying realHOME state. Resolve precreated directories by verification, not exist_ok on untrusted paths. Establish CPU/core/file limits before fixture work. Verify source and harness SHA before the one worker. CreateNew launch marker prevents accidental reuse. Startup errors must use fixed stage/reason only, no unknown exception rendering or traceback; retain held ownership and bounded cleanup if Popen succeeded. Do not patch the old supervisor.

Worker command: fixed public Node `/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node` plus new harness path; cwd contains explicit synthetic INPUT.json. Own HOME/TMP/CWD, no NODE_OPTIONS/proxy/CA inheritance. Reading this public HOME-located program is not credential data access. Record actual version/platform/arch/execPath. Scope is ordinary host Node only, not official embedded Node.

## Predicate matrix and privacy

Use original unrun harness's closed-schema expected values and synthetic canary in auth/cookie/host/path/query/userinfo/arbitrary names and values/invalid cache. Cover exact routes/method classes, absent/duplicate/empty/other/malformed Bearer, ASCII/grammar/folding/bareCRLF, header count64/65, line8192/8193, name128/129, default/hard/custom cap boundaries, invalid inputs/bounds, hostile/revoked Proxy/coercion hooks, import function identity, and identical descriptors with both proof flags false. No actual HTTP calls. Return schema includes format-only/unknown and scope always unknown.

Inspect all projected values (harness), complete bounded worker streams, held/report artifacts for canary raw/JSON escaped/Unicode escaped/hex escaped/base64/lower-and-upper hex forms. Use the newly generated canary solely as explicit synthetic input. INPUT and source files are fixture inputs, not observation outputs. Do not persist a leaking observation stream: retain a fixed failure and case identity. No actual secrets used.

## Budgets and acceptance

One Node worker, no repair-and-rerun; at most100vectors, controllerCPU10s, workerCPU4/5s/wall8s+cleanup2s, core0, file64KiB, eachpipe32KiB, own total256KiB, Node harness16KiB/report12KiB. Outer execution deadline<=30s; author task budget90s. FSIZE applies only to these synthetic fixtures, never real normal state/SQLite. Report measured scope; do not claim unmeasured whole-agent wall/CPU compliance.

Require actual heldPID/exit0/trueEOF of both streams, no timeout/cap/fault, all cases pass with nonempty exact counts, zero coercion hooks, no output leakage, frozen source and copied harness unchanged, and exact executed argv/env/cwd/limits. Preserve full controller, harness, held, stdout/stderr (unless fixed withheld leak failure), report and launch record in own namespace. An absent worker is NOT RUN; failed vectors remain failures. Main reviews evidence before using results. No production/repository edits by test author.

Forbidden: official CLI/SDK/bundle/model/auth/network/Mach/UI/state/DB/Keychain access, credential export, installation, process scans, historical suite reruns, modification of tested source or prior case. No HTTP passivity, natural injection, scope authority, sender, wire/receipt or parity conclusion follows even from PASS.
