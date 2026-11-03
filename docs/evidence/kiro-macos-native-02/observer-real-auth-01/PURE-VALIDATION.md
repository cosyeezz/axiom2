# Pure value helper validation — limited PASS plus retained failed launch

Module: [safe_value_checks.cjs](safe_value_checks.cjs), 6639B/SHA256 `f357a0bf5c04308eae7eade520a30240c7350cc6d8e1f8880b716bb83790f802`. Main did not modify it. These are supplied-value tests, **not HTTP observation, authentication, send/receipt or parity tests**. No actual HTTP or model request was used.

## UTF801

Matched t11675/r11682. [Full report](/private/tmp/real-value-utf801-io815tlo/REPORT.txt), [harness](/private/tmp/real-value-utf801-io815tlo/harness.cjs), [command](/private/tmp/real-value-utf801-io815tlo/COMMAND.json), [held](/private/tmp/real-value-utf801-io815tlo/held.json), [stdout](/private/tmp/real-value-utf801-io815tlo/stdout.log), [stderr](/private/tmp/real-value-utf801-io815tlo/stderr.log). All read in full by main.

One Node26352, actual0, bothEOF, no timeout/cap; v22.23.2/darwin/arm64, .039s recorded supervisor execution interval (not whole-agent elapsed/CPU). 85 distinct passing cases, 904 recorded assertions, zero coercion hooks. **85 includes3header smoke and1hook-counter case**, not85HTTP calls. TextEncoder+elementwise byte oracle is independent of module Buffer.compare. Covers supplied UTF8/code-unit differences, malformed-surrogate replacement, hard/exact caps, wrong types and noncoercion; every value result checks closed schema and false completeness/receipt flags. Source before/after/current match. Public host Node under HOME is program access, not credential-data access. Command describes inline `/usr/bin/python3 -`; do not invent -I/-B or a retained full controller source for that run.

Main data-only audit checked case identities/statuses/counts, held/runtime linkage, SHA and canary absence in worker streams/report/command/held. Its final unrelated assertion wrongly expected double-escaped CRLF in privacy01's harness and exited1. Native character inspection corrected that mistake: the harness contains correct single-escaped CRLF. Earlier reached assertions are not an overall exit0; no Node rerun occurred and no implementation change was made.

## Privacy01 — failed controller, no test execution

Matched t11674/r11683. [Full report](/private/tmp/real-value-privacy01-hlPooh4h/REPORT.md), [exact failed supervisor](/private/tmp/real-value-privacy01-hlPooh4h/supervisor.py), [unexecuted harness](/private/tmp/real-value-privacy01-hlPooh4h/harness.cjs), [final record](/private/tmp/real-value-privacy01-hlPooh4h/held-final.json). Main read all.

Supervisor actual1 at mkdir(existing ownHOME), before rlimits/hash/canary/Popen. **0workers/0cases/0assertions**, no runtime/EOF/before-after execution evidence. Automatic Python traceback violated fixed-diagnostic policy; only public ownTEMP paths were present and no canary had been generated. Why the directory already existed was not investigated. Keep failed controller unchanged; do not count its intended tests or rerun it.

## Privacy02 — new controller conditions, unchanged vectors

[Predeclared experiment](PRIVACY02-EXPERIMENT.md). Matched t11690/r11695. [Report](/private/tmp/real-value-privacy02-1kt0xdwh/REPORT.md), [controller](/private/tmp/real-value-privacy02-1kt0xdwh/controller.py), [harness](/private/tmp/real-value-privacy02-1kt0xdwh/harness.cjs), [held](/private/tmp/real-value-privacy02-1kt0xdwh/held.json), [launch](/private/tmp/real-value-privacy02-1kt0xdwh/LAUNCH.json), [stdout](/private/tmp/real-value-privacy02-1kt0xdwh/stdout.raw), [stderr](/private/tmp/real-value-privacy02-1kt0xdwh/stderr.raw). Main read report/controller/held including tail/launch/complete streams and byte-compared harness to the previously read original.

New startup verifies precreated owned0700 directories, uses systemPython-I-B, fixed error diagnostics and CreateNew marker. One Node35877 actual0; trueEOF both, no timeout/cap/fault; worker .035299s/controller .036496208s. 75 distinct cases PASS, 1809 recorded assertions, including import identity and coercion-unaccessed. Exact reused Node harness9815B/SHA `9b9dbb262c05612545cc4c49b7d7016b8ad500db2361ad8f340465b5bf722281`, old/new before/after unchanged. No old case or UTF801 rerun. Header case IDs provide grammar/auth/closed schema/privacy/cap/type bounds, not HTTP requests or generic SDK coverage.

Main separate data-only Python-I-B audit exit0 verified actual stored held/terminal agreement,75uniquePASS/1809,empty stderr,trueEOF,source/harness identities and raw/JSON/Unicode/hex-escaped/base64/lower+upper hex canary absence in streams/held/report/launch. Exact worker env contains only HOME/TMPDIR/TMP/TEMP/PATH/LANG. **Controller actual LAUNCH also contains CPATH,LC_CTYPE,LIBRARY_PATH,MANPATH,SDKROOT,__CF_USER_TEXT_ENCODING**, so controller minimal-env requirement was not strictly met; mechanism not separately diagnosed. No NODE_OPTIONS/proxy/CA keys were recorded. This deviation does not erase supported pure-worker results, but is not all-layer isolation PASS.

Controller cleanup code uses own new session/process group on failure; successful path did not exercise timeout/group kill. It is not complete-descendant containment, hard-realtime cleanup or tested failure-path robustness. Whole-agent wall/CPU was not measured. Resource settings are recorded, not a proof of all unexercised enforcement branches. None of these synthetic FSIZE limits may be used on real normal state/SQLite.

## Remaining work

No header original-value equality, auth scope authority, complete real payload capture, HTTP API passivity, natural preload, embedded-runtime applicability, actual sender, live deepseek-3.2 catalog, outbound or server receipt proof. Equal descriptors never prove equal values. Initial pure helper is usable within the tested scope; [wrapper design](WRAPPER-DESIGN.md), real wrapper/new output consumer/paired RAM channel and natural-entry readiness remain separate work. Privacy01 remains failed; the distinct case counts are not combined into a request count.
