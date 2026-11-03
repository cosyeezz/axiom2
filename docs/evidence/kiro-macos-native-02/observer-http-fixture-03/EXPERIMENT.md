# Self-owned HTTP calibration 03 — fail-closed consumption

Positive 02 is frozen: 30 pure cases (original17 + new13), 10 raw HTTP/HTTPS control/preload pairs, 8 immutable API-body matches, 10 header-cache matches and 2 mutable-Buffer negatives. Do not repeat them. New component `../observer-http-fixture-02/terminal_consumer.py` strictly validates only known fake artifacts, after the original owning caller has real exit0/EOF within its independent deadline. It is not itself a process owner or an official-run permit.

## Two independent tasks

1. Artifact-only strict consumer test: consume existing 02 data once, then independent mutations for duplicate/escaped-duplicate keys, nonfinite/float/bool-as-int, wrong types/extra/missing keys, byte/count/cap/ID/schema/base64 inconsistencies, unfinished calls/requests, empty sets and partial tails. Preserve all true failures. No new network required.
2. Owned runtime negatives using unchanged 02 tap: absent preload guard, existing CreateNew trace, targeted fake trace-writer exception, body/event/log caps, timeout/early candidate/late candidate. Actual request behavior remains unchanged and known loopback data may still arrive despite observer failure; the owner must reject consumption. A candidate or a good late file never overrides a recorded cap/logger/deadline/exit/EOF failure. This tests that caller harness only, not all SDK lifecycle implementations.

## Limits

New CreateNew TEMP per task; one main per namespace. Total90s, parentCPU30s, child10s (hang negative shorter), stdout/stderr each<=1MiB, aggregate persisted evidence/output<=4MiB per task. Individual body<=128KiB; multiple body-cap requests allowed. Event/log cap runs may use small HTTP headers repeated, but never unbounded input. Default tap limits remain128events/256KiB body/1MiB NDJSON. All data is self-owned literal fake content; no official code/model/auth/real HOME/external network/proxy inheritance/TLS-key access. Trace-writer fault may use an explicit *test-only* earlier preload that targets only the fake trace FD; document this artificial setup and do not call it natural official preload. No global security/trust settings changed. If no sandbox, explicitly say so.

Freeze both component hashes before delegation, do not modify during tests. Require actual commands/exit codes, original owner-held PID/true EOF when reachable, sticky reasons, bounded counters, terminal-file presence/absence, source before/after hashes and evidence paths. Timeout/kill/absent EOF is a failed candidate even if files say ok. Positive calibration need not be re-executed and no partial pass clears Mac M3/full-tree or model gates.
