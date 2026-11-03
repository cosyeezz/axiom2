# Owned strict consumer 04 — explicit JSON depth

## Prior result and new contract

03's270-case suite: Python3.9.6 all270/exit0, Python3.14.7 269/exit1 because raw `strict_json` accepts2000nested arrays on3.14. The old helper did not specify a numeric maximum. This is a cross-version behavior/contract gap, not evidence of a full capture-schema bypass. Original source/results remain unchanged and permanently preserved in [03](../observer-http-fixture-03/SUMMARY.md).

For this new helper, explicitly require **JSON structural depth<=16**, counting containers only outside quoted/escaped strings. The supported capture schemas are flat objects, so this adds no useful-input restriction there. A bounded linear ASCII preflight runs before the existing strict JSON parser; the parser still owns actual JSON grammar, UTF-8, duplicate keys and numeric rejection. No API/counter/schema logic changes.

## Acceptance

Keep the original270oracles unchanged against the new source on both interpreters; bind only source path/SHA and new independent TEMP. Add independent depth16/17 boundary, mixed containers, huge nesting, brackets in strings, escaped quotes/backslashes/unicode, invalid/incomplete containers and UTF-8 cases. Exacttext delta must be limited to MAX_JSON_DEPTH and preflight. Do not execute03controller or change its original exit1. Positive02network, f21tap and30pure cases remain valid and are not rerun. Existing frozen02trace/status may be revalidated artifact-only.

## Resources and safety

One main in new CreateNew TEMP, total90s/CPU30s, child<=20s (increased from10s to allow repeated bounded bytewise preflight over mutation inputs), per-stream1MiB/total4MiB. Pure only, no network/Node/official/model/real HOME/auth/TLSkeys. Own HOME/TMPDIR/minimalenv/-I/-B; no repo bytecode. Freeze source before delegation and never modify it during tests. Preserve true failures/new namespace for any fix. No sandbox/fulltree/owner deadline/SDK/M3/server-parity claim.
