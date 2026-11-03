# Secret-safe Node HTTP observer — read-only design review

## Conclusion
Create a NEW observer and schema; never relabel the fake tap. Gate real-auth observation on new isolated synthetic privacy/API tests and separate natural-entry authorization. Preserve system/custom/history/tools/security and unknown fields on transport; redact only the separate output projection. No evidence here establishes real sender/auth/wire/receipt parity.

## Existing evidence: facts
Paths relative to /Volumes/D_Work/axiom2/:
- docs/kiro-macos-request-baseline.md (三项对照/执行和证据边界): real captures zero; construction, authentication and sending are separate checks. Dynamic values need format/scope/association, not literal identity.
- docs/evidence/kiro-macos-native-02/request-sender-probe-03/SUMMARY.md (Actual one-shot result): main exit1; held child -9 after interactive-auth prefix; sender/preload/auth mode unobserved. Not proof of logout/invalid credentials. Consumed case remains closed.
- docs/evidence/kiro-macos-native-02/observer-http-fixture-02/fake-http-tap.cjs: identify() persists req.path; sample() persists reversible bodyBase64; _storeHeader persists raw _header. Its fake-only guard must remain unchanged; these persistence choices cannot be copied.
- Same directory SUMMARY.md: host Node v22.23.2/darwin/arm64 calibration, not official runtime. Two controls observed API BEFORE/server ZZZZZZ after mutable Buffer changes. API-copy != wire/receipt. Pending reservations address reentrant caps only.
- docs/evidence/kiro-macos-native-02/observer-http-fixture-04/SUMMARY.md: strict artifact consumer depth<=16 is not process ownership/provenance. Old tests were not rerun.

## Proposed scope / input boundary
Recommendations below, not implemented facts. Bind public observer source SHA, exact supported Node runtime, ordinary built-in HTTP/1.x descriptors, install point and entrypoints. Cover only tested http.request/https.request and ClientRequest.write/end/_storeHeader. Internal _storeHeader is version-sensitive. No general claims about Proxy, changed intrinsics, captured aliases, H2 or other senders; unobserved paths give unknown coverage.

Use frozen data-only configuration: closed policy/schema IDs, approved method/endpoint enums and bounded caps. No request-derived paths, caller serializer/toJSON/logger/regex callbacks. Do not enumerate options, reread getters, coerce objects, traverse arbitrary shapes, inspect thrown values or open authstore/HOME-state DB/Keychain/TLS-key logs. Response bodies off by default.

Default-secret: URL/path/query/credentials, headers including unknown names/cookies, body, arbitrary JSON keys and errors. Persist no raw_header/bodyBase64/path/URL/token/Authorization/TLS keys/claims/error message/stack/sink exceptions. Unknown endpoint becomes fixed unknown, never substring/raw fallback. Length/shape/count metadata also leaks: release only approved bounded predicates/buckets. Never delete or normalize transport content to match logs.

## Minimal persistent schema
Closed tagged union, reject extra keys:
- manifest: schema=real-node-http-v1, observer_sha256 (public code only), approved runtime_version, policy_id, boundary=node-http-api, random own run_id, caps, entrypoints, install_coverage=verified|unknown.
- request: seq, local request_id, api enum, approved method_class/endpoint_class or unknown. No remote IDs/raw route.
- operation: seq, request_id, call_id, operation=request|write|end|storeHeader, outcome=returned|threw, optional return_class=boolean_true|boolean_false|same_receiver|other, projection=complete|unknown|fault. No actual arguments or thrown values.
- check: seq, request_id, fixed check_id, comparison=exact_bytes|typed_structure|format|scope|correlation, result=equal|different|valid|invalid|unknown|not_applicable, coverage=complete|partial, fixed reason enum. Fixed policy slots only, not arbitrary field paths. Structural equality and byte equality remain distinct.
- terminal: run_id, last_seq, request_count, completed_count, in_flight_count, cap_hit, sticky_fault enum, coverage=complete|incomplete|unknown. No blanket parity_pass. Independent owner verifies held identity/exit/EOF/timely publication; terminal cannot self-attest those.

Strict bounded UTF-8/JSON: duplicates including escaped equivalent keys, nonfinite/float/bool-as-int, extras and truncation reject. Impose bytes/depth<=16/record/string caps before parse. Safe integer counts, monotonic seq, unique declared IDs, resolved references/count reconciliation, nonempty expected set required. Missing terminal/pending calls/partial writes/unknown coverage/exit ambiguity prevent usable success. CreateNew mode0600 files under own mode0700 directory, fixed bounded names; publication failure stays failure. No secret-input hashes by default.

## this / args / arity / return / throw / callback fidelity
1. Save originals on install; Reflect.apply(original, originalThis, originalArgs) exactly once, same count/references including absent vs undefined, overloads/encoding/callbacks. No replacement Buffer/options, header rewrite, callback argument insertion or framing change.
2. Preserve tested function name/length and original descriptors on restore. Rollback unsupported installation before launch. Wrapper identity/toString/stack/timing transparency is NOT promised; no universal JS equivalence claim.
3. Return identical result (false backpressure/end receiver included). Rethrow identical original object or primitive including null. Observer failure handlers must not replace original throws/returns or invoke original twice. Never inspect exception contents.
4. Forward callback unchanged: no wrapping, invoking, suppressing, delaying or adding metadata listeners. Test callback this/args/count/order/reentrancy/throw and error/drain behavior. Argument forwarding alone is not sufficient proof.
5. Extra getters on created request may also interfere: only tested ordinary built-in fields supported; unsupported shape yields unknown without traversal. Bound pre-call string/Buffer/Uint8Array copies for memory analysis, honor encoding; invalid/detached/changing input => unknown while original decides outcome. Copy is not the object sent to Node. Pre-copy may differ from transport; post-copy cannot fix that gap.
6. _storeHeader gives generated header-cache evidence only, not guaranteed wire/TLS/server receipt. No observer-driven HTTP abort/destroy/retry or connection changes.

## Unknown / abnormal / cap handling
Keep original API failure, observer fault, unsupported observation and detected difference separate. Fault is sticky; later good events cannot restore success. Evidence-fail-closed/API-fail-open: stop observing on fault but call original exactly once with original behavior. Any owner timeout/abort requires separate policy.

Reserve BEFORE copying/parsing; count committed+pending+nested work. Bound requests/events/chunks/cumulative and in-flight bytes/header scan/parse depth+tokens/comparison work/output/time. Release reservations on return/throw. Streaming parsers also need limits; content-length alone is insufficient. Cap => incomplete/unknown, never prefix equality/raw fallback. Reserve fixed terminal-fault capacity; missing terminal is failure. Short writes/full disk/closed fd/serialization/reentrant sink failures disable observation without raw diagnostics. Avoid user-code sinks within API calls.

Do not infer full body from partial chunks, or receipt from successful end. Track separate local requests/retries/abort/destroy. Zero observations => unknown, not vacuous parity. Late result/exit arbitration belongs to independent owner.

## Memory comparison / non-secret commitments
Prefer bounded authorized in-memory comparison exporting approved predicates, then release references. JS cannot guarantee physical zeroization; disable dumps/debug/raw-error output and disclose residual memory exposure. Independent runs cannot later be compared after discarding values without a separately authorized secure comparison channel.

Nondynamic fields: complete exact bytes plus separate typed structure, preserving omitted/null/type/order/context/security/unknown fields. Dynamic token/requestID: literal differences allowed only alongside individual format and authorized scope/correlation checks. Bearer syntax or unverified claims do not prove issuer/validity/scope/acceptance. Missing authority => unknown. Link header/retry/request associations in memory with fresh local labels; persist no original ID.

Public unkeyed secret/context hashes permit guessing. Ephemeral-key HMAC may aid authorized paired memory comparison, but durable tags leak equality and are not automatically non-secret; cross-run use requires key handling. Without key/values, later verification is impossible. If approved, domain-bind schema/field/type/length/complete bytes; prohibit ambiguous concatenation/truncation. Default: no real-token tags. Signed predicates attest observer statements, not hidden-input correctness/receipt. Public synthetic commitments are fine. Matching REDACTED markers, shapes, normalized hashes or answers never establish original equality.

## Minimal NEW synthetic matrix — planned, not run
A API: overloads, missing/undefined/encoding/callback variants; this/arg identity/count/exactly-once, false backpressure/end identity, object+primitive throw, callback this/args/order/reentrancy/throw; name/length/descriptors/rollback. Compare control/instrumented.
B Privacy: synthetic canaries in auth/cookie/path/query/header names/body/JSON keys/error/stack/sink failure; inspect all artifacts/stdout/stderr/status for raw/escaped/base64/hex and closed schema. Include unknown metadata/binary/invalid UTF-8. No real credentials.
C Evidence: equal complete bytes vs one-byte change; omitted/null/type/order/chunk segmentation/encoding. Verify system/custom/history/tools/security sentinel bytes reach original API. A new mutable Buffer case must retain API-copy!=received classification, never receipt PASS.
D Dynamic: differing valid synthetic tokens/IDs with correct association; malformed/wrong scope/wrong linkage/missing authority give invalid/different/unknown appropriately. Change nondynamic context to ensure redaction does not hide differences.
E Limits/faults: N/N+1 each cap, nested reservations, huge header/chunk/depth, unsupported input, original-throw rollback, sink short-write/throw, missing/truncated/late terminal. Assert unchanged API and sticky unusable evidence.
F Consumer/coverage: duplicate/numeric/extra/depth/seq/reference/count faults, zero requests/partial/abort/retry, unsupported/double installation/removal, unobserved entrypoint. Bind runtime/source, not official equivalence.
Do not rerun historical PASS or consumed case03; these are new tests for a new observer.

## Actual work / unknowns
Initial cwd /Volumes/D_Work/axiom2. read: skill once + five authorized inputs once; bash wc -c (exit0): inputs 24,238 bytes, including skill total reads <70KiB. No other evidence read, tests/SDK/bundle/CLI/model/network/Mach/UI/process scanning/install/credential or state access. No repo edits.
Two report-writing attempts used own mktemp namespaces, env -i, own HOME/TMPDIR/CWD, /usr/bin/python3 -I -B, CPU5/file64KiB/tool timeout10; both exited1 on PRE-WRITE size assertions (15,719 and 12,852 bytes), leaving only empty own directories. These are report-generation failures, not test failures; preserved here, no evidence reruns. This third shortened report uses CreateNew with same limits. Tool output supplies actual exit/path/bytes. Total generated file content <128KiB. No test exit code exists; no tests claimed passed.
Unverified: implementation/new tests, embedded runtime, natural-entry/preload, real auth authority/scope, sender/model availability, outbound/server receipt and official/Axiom parity. Main should freeze new source, run new isolated synthetic tests, then obtain separate real-auth authorization; old fake labels/failures remain unchanged.
