# Pre-response retry dependencies — bounded static03

KAS0.66.70 source reverified:15025207B, SHA256 bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1. Twelve windows /41640B across3 extraction rounds, command times well below200s. The window budget is exhausted and this case is CLOSED. No official code execution, whole-file AST, network, credential reads or production changes.

Evidence: [HTTP and dispatch](source-evidence.json), [adaptive/token classes and callers](source-evidence-2.json), [alias chain, counter and dependency metadata](source-evidence-3.json). Prior Qne wrapper is reused from case01/source-evidence-3.json rather than re-extracted.

## HTTP errors

HOo8391322 parses the error body in RAM. It chooses error.message / top-level message / Message, error.type / __type, and error.code / reason; GOo creates SDK-shaped modeled exceptions with httpStatusCode and requestId.

Retry hint precedence: case-insensitive x-amzn-kiro-ratelimit-retry-after (finite nonnegative Number), then finite nonnegative body.retryAfterMilliseconds; only if absent, standard Retry-After. Standard header accepts integer seconds or an HTTP date clamped at zero; signed/decimal numeric strings are rejected. Qne later caps its additional chosen delay at300000ms.

GOo prioritizes429/throttling,402/quota,403/access,404-invalid-model,400/413-validation,503-unavailable and500/server/model/internal exceptions; otherwise a generic KiroRuntimeServiceException. Model error supplies MODEL_TEMPORARILY_UNAVAILABLE when no other reason exists. These modeled errors feed case02's Kce classification; blindly retrying all429/5xx is not equivalent. The complete reason normalization table was not extracted in this case.

## Actual Smithy implementation binding

Qne uses tfs=un(RBe(),1)14272532. RBe3880165 reexports rY; rY3105153 exports AdaptiveRetryStrategy=Ebe, StandardRetryStrategy=vL and DefaultRateLimiter=nY. The deprecated awt/Tbe retry methods are NOT this path. A second same-named RBe in another scope must not be substituted.

Important correction to a one-delay interpretation: vL.refreshRetryTokenForRetry **already sleeps internally**, then Ebe waits for a rate-limit token, and only afterward Qne returns its own delay token for uDo's additional wait. Copying only Qne's250/1000ms jitter would omit real waits.

- vL capacity starts500. It permits only THROTTLING or TRANSIENT, retryCount+1 < dynamic maxAttempts and enough capacity. A granted retry debits capacity; successful Qne token refunds only1 because efs.getRetryCost() returns undefined, not the SDK token's original cost.
- Default nf.v2026=false unless SMITHY_NEW_RETRIES_2026=true; AWS_NEW_RETRIES_2026 can also enable it via the bundled AWS initializer. Default base100ms, throttle base500ms, ordinary cost5 and TRANSIENT cost10.2026 mode uses base50ms, throttle1000ms, ordinary cost14 and THROTTLING cost5. Captured official process environment was not inspected, so its active branch is unknown.
- Internal backoff floor(random * min(base * 2^retryCount,20000)); a Date hint is max(backoff,min(hint-now,backoff+5000)). Token acquisition sleeps this amount before returning a token with delay0. Qne's additional hint/backoff is a separate calculation afterward, potentially with elapsed time affecting a Date hint.
- nY starts disabled; defaults beta.7, minimum capacity1, minimum fill rate.5, cubic scale.4, smoothing.8. THROTTLING (or Smithy's GU(error)) enables its bucket. It measures half-second buckets and rounds rates to8 decimals. Initial and retry acquisitions wait for bucket tokens. It has no AbortSignal; a native adaptation must bound waits and late completion without issuing a later send.
- Embedded dependency metadata only gives ranges @smithy/core ^3.23.2 and @smithy/util-retry ^4.2.8. It does NOT prove exact resolved package versions. The bundled executable implementation is nevertheless bound by the verified KAS file hash.

## callPosition producer

Main WZn85545xx calls Wbo first; Wbo8136204 increments state.agentIterationNumber by1. WZn then passes that field as modelStream2's third argument8555269. modelStream2 passes it to buildModelRequestTarget12296303, which calls client.setCallPosition. The summary node8474300 passes the current same counter without an increment visible in its window. Default graph state8089276 is0; Ede81363xx returns0. Exact reset/resume caller boundaries remain untraced.

Thus this is graph agent-iteration progress, not request ID, transcript length, total session messages or physical HTTP-attempt count. Fresh main invocation begins with1, normal next model invocation increments it; internal pre-response attempts share the position. The case01 budget3+progress bonus applies to this value.

## Next design gates

Follow-up [static04](../responses-retry-ownership-04/REPORT.md) subsequently resolved the default client-cache lifetime and full Responses reason normalization/SDK enum binding. Those were unknown at this case's closure; no extra windows were added here.

No production retry/attempt-header change yet. Design native ownership/lifetime of adaptive state, fresh-run call position, bounded error-body parsing/classification and cancel-safe acquisition before implementing. Keep title's disabled retry path separate, retain fixed DeepSeek and do not replay SSE after progress or tool execution. Exact package semver, official2026 environment branch, all normalization reasons, adaptive-state cache/reset lifetime and cross-run counter resets are not proven here. A synthetic implementation must not be labeled official parity without accounting for those limitations.
