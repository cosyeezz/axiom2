# Real-auth HTTP observation — contract draft01

**Design and initial pure components only. No real observer is installed or ready for a real request.** Existing user authorization remains unchanged; this document introduces technical readiness checks, not another blanket user-approval requirement.

Scope follows the [request baseline](../../../kiro-macos-request-baseline.md): actual construction, authentication and sending/execution, exact deepseek-3.2, Axiom/Pi native direct access with independent normal login. Do not clone compression/session storage/scheduling. Preserve system/custom/history/tools/security and unknown fields on the original transport. Redaction affects observation artifacts, never request inputs.

## Evidence and entry boundary

[Case03](../request-sender-probe-03/SUMMARY.md) permanently failed its single offline instrumented selection. Normal directory identity was checked18times, but interactive-auth guard killed held8234 before Ctrace. It does not diagnose user logout, credential validity or NODE_OPTIONS stripping. Do not rerun/broaden that case. Network/mach denial can confound normal credential-service/refresh behavior, but the concrete dependency is unknown. Do not investigate credential storage, invent service names or restore M3.

The frozen SDK has a NodeHTTP1.1 candidate; its actual runtime, natural entry and installation coverage remain unproved. No extracted official bundle/dependency may be executed as a substitute sender. A future natural catalog-only case is a proposal, not a ready runner: list syntax does not prove live freshness, KAS provenance, generation permission or parity. No model substitution if deepseek-3.2 is unavailable.

## Adopted persistence policy

Default-secret: URL/path/query/userinfo, arbitrary header names/values, cookies, body, arbitrary JSON keys, remote IDs, claims, exceptions and stacks. **No raw header cache, bodyBase64, raw payload, reversible encoding, token/Authorization/TLSkey, input-derived pathname, secret/context hash or durable token tag.** Public observer-source SHA is permitted. No direct authstore/Keychain/credential DB reads or copies; official normal opaque credential use is distinct from observer reads.

Choose bounded authorized **in-memory comparison with fixed predicates**, not durable HMAC/context commitments in this revision. No cross-run equality claim is possible after discarding inputs without a separately designed secure memory comparison channel. Key handling and such a channel are not implemented. Equal REDACTED markers, shapes or format descriptors never imply equal original values.

Pure helpers may report only closed schema/tag/check/reason enums, approved method/endpoint classes, bounded booleans and equality predicates. Unknown input returns unknown without coercion, raw fallback or dynamic diagnostics. Counts/lengths also leak information: omit exact secret lengths and arbitrary names by default. Bearer-looking syntax is not issuer/signature/scope/acceptance evidence. Token scope/provenance stays unknown without authority. Dynamic ID/token differences are allowed only with explicit format/scope/correlation checks; they are not silently normalized away.

## Initial pure components and limits

The first component will operate on supplied primitive strings only:
- Compare two complete **provided** UTF8 encodings in memory; distinguish code-unit equality from encoded-byte equality (including malformed-surrogate replacement). Cap before allocation. No raw strings/digests in output. It proves neither complete request capture nor receipt.
- Project a bounded generated header-cache string into format-only approved enums. Exact routes only, no raw path/query/host/header name/value. Authorization presence/duplicate/scheme/ASCII or three-segment shape, with scope unknown; never a token value, token digest or parsed claims. No value-equality assertion follows from identical projections.
- No network, filesystem, HTTP patch, callback, body parser, claim parser, logger, preload or automatic installation. This is not yet a real HTTP tap or an API-passivity proof.

Planned initial bounds: provided-payload<=256KiB each/max512KiB copies; header-cache<=16KiB default/hard64KiB, <=64header lines, line<=8KiB/name<=128chars. Refuse invalid types/caps and unsupported text/grammar with fixed unknown status. Boundary/capture-completeness/receipt flags must remain explicit. Input references are released normally; JS cannot guarantee physical heap zeroization.

## Future API wrapper contract — not implemented

Use a new module/schema. Keep fake-http-tap.cjs and its fake-only guard unchanged. Supported boundary limited to tested ordinary built-in HTTP1.x request/ClientRequest methods and an explicitly verified runtime/install point. No universal Proxy/intrinsics/alias/H2 claim.

Original is invoked exactly once via original receiver and original argument count/references, including absent versus undefined, encodings and callbacks. Return the identical value, including false backpressure and end receiver. Rethrow the identical original object or primitive without inspecting it. Do not wrap/invoke/suppress callbacks or add metadata listeners that alter consumption, listener-dependent behavior, errors/drain, cancellation, framing, retries, connection or original headers/body. Function identity/toString/stack/timing equivalence is not promised; name/length/descriptors/rollback require separate tests.

Observation failure is sticky **evidence-fail-closed, original-API-fail-open**: no observer abort/destroy/retry, no changed original throw/return, no unknown exception rendering. Reserve committed+pending+nested memory/work/output before copies and release on return/throw. Caps never become prefix equality. Missing/late/truncated terminal, pending calls, zero observations or unsupported coverage cannot pass. Owner limits and held exit/EOF are independently checked; terminal cannot self-attest them. Complete process-tree/OS-hard-realtime guarantees remain unknown and are not M3 prerequisites.

Do not persist untrusted sink callbacks or invoke user serializers/toJSON/options getters. Future request fields must be taken from tested ordinary data surfaces, not re-enumerated input options. Response bodies are off. A safe emission protocol/secure paired-memory channel and exact terminal schema still require implementation/review.

## Evidence classes

Keep provided-input bytes, request construction, generated header cache, actual send API, wire and server receipt separate. Existing mutable Buffer negative demonstrates API BEFORE/server ZZZZZZ. End returned/HTTP200/same answer/format equality is not full request or server equivalence. Unknown fields and partial capture remain unknown; no blanket parity_pass field.

For actual comparison, full transmitted inputs remain unchanged. Record distinct complete-byte, typed-structure, dynamic-format, scope and correlation outcomes. Omitted/null/type/order/security/context and unknown-field differences must not be discarded. Ordinary payload comparisons may use bounded memory, but a function receiving equal strings cannot attest that they were complete real requests.

## Planned new verification

1. Pure supplied-string equality: empty/nonempty, byte delta, UTF8, lone surrogates, type refusal without getters/coercion, exact caps/N+1 and fixed output schema.
2. Header projection privacy: synthetic secrets in URL/query/userinfo/header names/auth/cookie/body-like invalid cache/errors; duplicate/malformed auth; grammar/text/count caps. Inspect raw/escaped/base64/hex canaries in every output. No real credentials.
3. New future-wrapper tests, after implementation: exact this/args/arity/callback/return/throw/restore/rollback; ordinary error/drain/reentry; sink/cap/fault monotonicity and unchanged original behavior; explicit immutable/mutable/API-versus-receipt cases. No historical suite rerun just to increase counts.
4. Independent strict consumer and coverage/late-terminal tests for the new schema, not inherited wholesale from fake04. Numeric/duplicate/depth/reference/empty-set faults must reject.
5. Only then a separately justified one-shot natural-entry case with reviewed permissions, parser, output privacy, identity/deadline/cleanup and no low FSIZE on real SQLite. No real model until safe observer and entry conditions are satisfied. Actual official/Axiom samples, not component tests, remain the final reference.

## Read-only reviews

- [Secret-safe review](/private/tmp/real-observer-contract-review-8q1wav/REPORT.md), t11635/r11640: recommendations only, no implementation/tests. Two pre-write size assertions failed before the final CreateNew report; no test failure hidden.
- [Natural-entry review](/private/tmp/natural-entry-review-bllUzNbz/REPORT.md), t11636/r11637: catalog-only proposal, exact Mach/egress dependencies unestablished. First report-write quoting error retained in author narrative, fresh CreateNew report followed. No official/auth/network/model execution.

Their wording about separate authorization is interpreted as a new technical case/readiness contract, **not a demand to ask this user again about already-authorized request-level work**. Out-of-scope secret export/global changes remain prohibited. Current real observer implementation, natural installation, actual auth scope/live model catalog/outbound/server parity all remain unverified.
