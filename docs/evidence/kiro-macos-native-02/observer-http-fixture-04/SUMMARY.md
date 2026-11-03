# Owned strict terminal consumer 04 — bounded parsing verified

The new [consumer](terminal_consumer.py), SHA`4d848742029ed86dd8769a0dc2280312cd92002fc8d44e645e4777692e8def1f`, defines **JSON structural depth<=16** before parsing, counting containers only outside quoted/escaped strings. Existing strict duplicate/numeric/schema/count/ID/base64/completeness logic is unchanged. This closes the raw-helper cross-version contract gap in [03](../observer-http-fixture-03/SUMMARY.md); it does not turn that historical gap into a full capture-schema bypass.

## Independent tests and unchanged oracles

- [270-suite summary](reports/parity/summary.json), [binding audit](reports/parity/binding-audit.json): Python3.9.6 and3.14.7 each270/270, exit0/real stdout-stderr EOF; four children including34additional boundary spot checks each exit0. Source and original03reports unchanged. Only suite source path/SHA bindings differ; inverse text and normalized AST match the original270oracles.
- [Focused depth summary](reports/depth/summary.json), [static audit](reports/depth/audit.json): independently authored78cases, both interpreters78/78/exit0. Depth16accepted/17and2000rejected; mixed containers, string brackets, escapes/backslash parity, Unicode/UTF8, malformed/partial inputs, parser-order spy, flat10-request capture and wrong schema/scope covered.
- The34spot checks overlap the78focused cases and are **not added into an inflated coverage total**. Executing the same suite on two interpreters does not double distinct coverage.
- Static inverse reconstruction and AST comparison show only the16constant and bounded linear preflight were added; imports stay json/base64 and no I/O/process/network operations were introduced.

## Failures preserved, not washed green

Three early **harness** failures remain separate from the consumer results: two exact-text blank-line reconstruction assertions before tests, and one inherited CPU hard-limit setup error before loading the consumer.

[Failure note](reports/failure-note/EARLY-HARNESS-FAILURES.md) carefully separates original disk artifacts from later transcription: the first focused-depth attempt originally saved only main.py, so its traceback/parent exit now appear only as a transcription of the original tool output, not as a contemporaneous stderr file. The other artifacts and source from all five test namespaces are preserved. No old test was rerun to regenerate missing logs or change an oracle.

## Main artifact-only verification

[preserve_results.py](preserve_results.py) ran once/exit0; [manifest](preservation.json): **50files/487681B**, read-only copies with per-file SHA and byte-for-byte readback, excluding6own-cache entries. Main revalidated270/34exit/EOF/source identities,78per-case results, exact text/AST audits, retained failure statuses, and the failure-note hash.

With the new04helper, main also consumed the **existing**03real writer/body/event/log fault artifacts: all four still reject specifically with `ValueError('observer failure')`. No Node, network, original30pure, official or model test was repeated during preservation.

## Boundary

This is an artifact consumer, **not a process owner or provenance proof**. The caller must independently establish original held child identity, real exit0/EOF and timely final publication. Known API body snapshots are not server receipt. No sandbox, official natural spawn/preload inheritance, complete descendants, generic SDK deadline/late-resource arbitration, uninstrumented TLS wire or server equivalence was proved. Mac M3 and the exact`deepseek-3.2`model gate remain uncleared.
