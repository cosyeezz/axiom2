# Kiro thinking validation

Final focused tests, full/server type checks and production build passed after the ES2023-compatible Unicode check correction. The generic compatibility checks and fresh protocol probe also passed at their recorded execution times; their unchanged scopes did not require a repeat after that correction. No live credentials, official CLI or third-party reference code is executed. Tests use only synthetic credentials and mock/loopback transports. See the [implementation and limitations](../../kiro-thinking.md).

## Scope and sources

Static reference commits, not executed:
- hank9999/kiro.rs: `22f36e692ad387c46581a84daf0d563347e330a3`
- ZyphrZero/kiro.rs: `4cac2a8b887eacf4c8119558d3c1906e43f8cbd4`

The adapter uses explicit backend-ID compatibility profiles. Budget defaults/limits and effort support are Axiom policy informed by these references, not official catalog declarations or promises of real service acceptance. Claude off adds no controls; GPT off explicitly supplied by Agent sends `reasoning.effort: none`; absent SDK reasoning options retain service defaults. Manual capability overrides do not establish support for a native effort protocol.

The existing UI/session path is exercised through native cached models plus `modelOverrides`, `ModelService.read/save`, reopening, selection persistence and new-session default inheritance. Request tests inspect actual SDK fetch payloads for each supported grade, root `additionalModelRequestFields`, prompt budgets/adaptive effort, user/system/history/image preservation and invalid settings rejected before fetch. Response coverage includes split tags, quoted closings, CRLF, 1023/1024/1025 leading whitespace, bounded candidate trailing whitespace, Unicode deltas, native reasoning signatures, tool/EOF boundaries, and damaged streams that must not execute tools. All single-cut splits in named test cases are tested; this is not a mathematical proof of every multi-chunk input.

## Validation records

Commands run from `F:/Axiom/axiom2/app`; each exit JSON records the complete command, cwd and UTC execution times.

| Check | Current record |
| --- | --- |
| Kiro auth/callback/catalog/chat/images/runtime/pooling/thinking and model-default, 9 files | **82/82, exit 0**: [log](kiro-tests.log), [exit metadata](kiro-tests-exit.json), final run after the Unicode correction and 1024-whitespace tool-boundary regression |
| Generic image/model input/catalog/runtime/config validation/overrides/copy/auth/switch, 9 files | **38/38, exit 0**: [log](initial-compatibility-tests.log), [metadata](initial-validation-exit.json). Passed before the Kiro-parser-only correction; unaffected generic checks were not needlessly repeated. |
| Full and server TypeScript | **Exit 0 / 0, no diagnostics**: [full log](typecheck-full.log), [server log](typecheck-server.log), [metadata](typecheck-exit.json) |
| `npm run build` | **Exit 0**: [log](build.log), [metadata](build-exit.json); both standalone type checks passed first. Actual command `npm.cmd run build` executed TypeScript, Vite, then server TypeScript. Vite's >500 kB chunk warning is non-failing. |
| Fresh offline protocol characterization | **8/8, exit 0**: [source](adapter-probe.ts), [results](adapter-probe.json), [log](adapter-probe.log), [metadata](adapter-probe-exit.json) |
| Integrity and production evidence | [checker](check.cjs), [generated report](checks.json): validates final logs, source/output hashes, local links, scoped diff and frozen manifest |

The fresh protocol probe is a copy of the preserved parity probe, run into this new directory. It characterizes protocol/history/image/tool/error behavior, not reasoning acceptance by a remote model. Existing image-version logs and hashes are historical and are not overwritten or relabeled as thinking-version evidence.

## Preserved unsuccessful/intermediate attempts

- The [first focused run](initial-kiro-tests.log), [exit 1](initial-kiro-tests-exit.json), had **80 tests, 78 passed**. Two new fixtures were invalid: the catalog response omitted required `defaultModel`, and the initial save fixture configured custom models without the SDK-required base URL. The corrected fixtures include `defaultModel` and use same-scope native cache + overrides; configuration/endpoint protections were not weakened.
- The first parser correction passed [82/82](pre-es2023-fix-kiro-tests.log), [exit 0](pre-es2023-fix-kiro-tests-exit.json), but its use of `String.isWellFormed` was not represented in the configured ES2023 type library: [full diagnostics](es2023-failed-typecheck-full.log), [server diagnostics](es2023-failed-typecheck-server.log), [both exit 2](es2023-failed-typecheck-exit.json). Build was correctly not started. The correction uses an explicit unpaired-surrogate check and independent UTF-8 round-trip assertions, without changing tsconfig or dependencies.
- The initial pre-correction full/server type checks passed; their results remain in [initial metadata](initial-validation-exit.json), not substituted for final checks.

## Integrity and boundaries

The checker verifies the frozen official static evidence: **79 files, 3,141,440 bytes**, every recorded SHA256 unchanged. It records current provider/test/document/production-output/evidence hashes, validates local documentation links, scoped diff whitespace and actual test/type/build/probe records. The image serialization protocol remains at SHA256 `667a5696d879f50dd5ce9ae62900465ec63561e25188f1862f80fd7d04809508`; the stream adapter/catalog have changed and require their own current results.

No claim is made about real model/region/account authorization, cost, actual service enforcement of token budgets/effort, current official CLI caller parity or a same-account live comparison. The public SDK's provider-before-entry pre-abort behavior is unchanged. Full signed reasoning-history replay, official retry/cache/control policy and other parity-audit gaps remain out of scope. Trusted `onPayload` extensions may alter controls; the configured level is not a guarantee against such deliberate extension changes.
