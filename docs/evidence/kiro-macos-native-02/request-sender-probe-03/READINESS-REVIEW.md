# selection03 prelaunch review

This reviews bounded prerequisites, **not official execution, authentication or request parity**. Current contract: [EXPERIMENT](EXPERIMENT.md), [runner design](RUNNER-DESIGN.md). Original failures stay failed.

## Frozen implementation

- Driver revision02,16345B: `6b9a4894620e1b58ab7180caa43bfb2901226ed13193edcc48d223b89745d1dd`.
- Stream module,6231B: `b1f8f3e26e380d907016add782266f952e1359d4ac7e51bb137c3b76381da655`.
- Original KAS role collector: `099725a827dde48b6a2e16440feec5ca706e9e259ecd97d48f6799fe5480e650`.
- Separate synthetic policy producer,2645B: `6d191a9a2afdd7cf3020b3da96787201cd818e708444bbc13dab226c849c314a`. It is never used as the official KAS collector.

## Reviewed evidence

[Stream validation](STREAM-VALIDATION.md) retains privacy25producers+4exceptions, original fault42calls=41PASS/1harnessFAIL/possible unheld-child unknown, and two additional isolated read-loop cases. Not an all-green fault suite or whole-tree guarantee.

[Revision01 parser/static report](/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/selection03-static-orriudy2/REPORT.md):40parser vectors pass, but B1 state-path prerequisite absent. Full074bed source archived locally; six old definition ASTs unchanged in current6b9a. Worker96399 actual0/no-timeout/.0468041670974344s verified from worker-outcome, not inferred from report prose. Original40 not rerun.

[State02 report](/private/tmp/selection03-state02-Ba1u0B/REPORT.md):12metadata cases+2finalPython3.9.6 parser smoke pass; held1349 actual0/no-timeout/.137029083s. Full report/harness/held-worker/outcome/stdout/stderr read. Preparation/prelaunch/post integration and identity-based selection inspected. B1 addressed within **non-atomic** lstat scope; replacement between checks or replacement-and-restoration remains outside its guarantee. No real state queried in these tests.

[Policy01](/private/tmp/selection03-policy-nIirMI/ANALYSIS.md) and [policy02](/private/tmp/selection03-policy02-3uDKbh/ANALYSIS.md) retained startup failures:9children71, then new single child1303/1. Neither entered Python producer; no runtime permission conclusions. No additional Python paths added.

[Policy03 native report](/private/tmp/selection03-policy03-evljE3/REPORT.md):1compile4355/0 and10sandbox children4358,4360–4368/0; worker4354/0/no-timeout. Namespace/state exact writes; settings/sibling/outside/intermediate-symlink writes denied at open(errno1), loopback bind denied at bind(errno1), native self-exec allowed, true-exec denied(errno1). Full REPORT/LAUNCH/harness read; main data-only verifier exit0 checked11distinct held records, all22raw files' lengths, raw JSON records and per-child JSON, current driver/C hashes against frozen before/after. No new producers/compiles in that verification. Not11total OS processes or request calls. Supervisor+children wall.941497583s/CPU.391187s, not whole-agent usage. Real official allowlist unchanged.

## Decision and limits

Synthetic prerequisites are sufficient for **one** guarded cached-login offline instrumented selection, with CreateNew readiness/launch/results. No existing main/lock/results. Final runner still checks infinite inherited FSIZE, normal state-directory metadata and frozen public hashes before compilation/official launch. Never apply synthetic256KiB FSIZE to real state; main/child set no FSIZE limit. Official normal state writes and opaque credential access may occur; observer directory lstat is counted separately and does not inspect DB contents. No real-home state-directory metadata has yet been queried at this review point.

Network/mach denial, exact exec/write exceptions and interactive-marker abort remain. These tests do not establish zero UI, Keychain viability, natural default engine, actual Node preload execution, real sender/API, model availability or request/server equivalence. Normal state-path evidence still comes from old synthetic getter until the main's checks. On refusal/failure retain the consumed case, do not retry/broaden/trigger login. Exact model remains deepseek-3.2. Real model requests still0; provider unchanged.
