# Retry ownership and reason normalization — static04

**CLOSED after answering the scoped questions:** 5/8 windows, 23,337/80,000 bytes, 4/5 extraction rounds; aggregate extraction-command time below 1s. Two codemode syntax errors made no tool calls and consumed no source windows. No target execution, network/model requests, credentials, settings or production changes.

Source: KAS0.66.70, 15,025,207B, SHA256 `bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1`, rechecked before each extraction. [Contract](CONTRACT.md). Static01–03 remain closed.

## Client and adaptive state lifetime

[Window 1](source-evidence.json), `Gx`8090497:

- Module-level `OVn = new Map` caches clients under `${modelId}:${agentMode}:${origin ?? ""}`. The first/provider argument is not part of the key.
- `forceRefresh` deletes that key before lookup; otherwise an existing client is returned. The exact-symbol scan found only three `OVn.` references: this delete/get/set. No per-request/run reset, TTL or LRU is present in the observed cache.
- `PSo` calls the configured factory's `createQDeveloperConverse(modelId, agentMode, origin)` on cache miss. Do not confuse the unrelated same-named Gx at10807410 with this module.

[Window 3](source-evidence-2.json), `Hgr`14276713:

- Each new converse client creates one strategy from `e.retryStrategy ?? Qne.withProgressBonus`. The resulting `xje` retains that strategy via `preResponseRetryStrategy`, `setCallPosition` and budget callbacks.
- `session-title` disables `preResponseRetryStrategy`; an ordinary client reuses the strategy across model invocations and logical runs while cached. Per-HTTP-attempt or per-run fresh adaptive state is not equivalent.
- Auth is obtained through the client's authProvider. AWS KiroRuntimeClient construction receives the shared strategy for non-title requests, but that does not turn Responses into the AWS sender.

Scope: this proves the default factory/cache wiring, not runtime configuration of `e.retryStrategy`, every forceRefresh caller, account-switch behavior or real concurrent execution. Cross-session sharing in official code is not permission to mix Axiom accounts or to persist credentials.

## Complete Responses normalization inputs

[Window 2](source-evidence.json), `l2u`8391080 and `d2u`8394919:

- HTTP413 forces `CONTENT_LENGTH_EXCEEDS_THRESHOLD`.
- Empty/non-string reasons are omitted.
- Explicit mappings: `context_length_exceeded`→`CONTENT_LENGTH_EXCEEDS_THRESHOLD`; `model_not_found`→`INVALID_MODEL_ID`; `invalid_function_parameters`→`TOOL_SCHEMA_INVALID`; `invalid_json`→`REQUEST_BODY_INVALID_JSON`; `kiro:model_requires_user_opt_in`→`MODEL_REQUIRES_USER_OPT_IN`; `server_is_overloaded`→`MODEL_TEMPORARILY_UNAVAILABLE`; `rate_limit_exceeded`→`USER_REQUEST_RATE_EXCEEDED`.
- Otherwise remove the case-sensitive `kiro:` prefix and uppercase; use that normalized value only when it is in the union of six SDK reason enums. Unknown strings are preserved, not converted into known reasons.
- `GOo` first constructs a modeled exception from status/type, then case02's `Kce` translates it. For403 + model opt-in it deliberately constructs ValidationException, not a retryable throttle.

[Window 4](source-evidence-3.json) contains all six reason enums in `GNi`; [window 5](source-evidence-4.json) proves `Ay`3929728 reexports `GNi`. Both Responses `Qs` and classifier `Ho` import this `Ay` scope. The other same-named Ay at11127762 is not substituted.

Retry-significant reasons include:

- Throttle: CREDIT_CONSUMPTION_RATE_EXCEEDED, DAILY_REQUEST_COUNT, INSUFFICIENT_MODEL_CAPACITY, MONTHLY_REQUEST_COUNT, SERVICE_REQUEST_RATE_EXCEEDED, USER_REQUEST_RATE_EXCEEDED.
- Quota: CONVERSATION_LIMIT_EXCEEDED, MONTHLY_REQUEST_COUNT, OVERAGE_REQUEST_LIMIT_EXCEEDED.
- Access: FEATURE_NOT_SUPPORTED, TEMPORARILY_SUSPENDED, UNAUTHORIZED_CUSTOMIZATION_RESOURCE_ACCESS, UNAUTHORIZED_WORKSPACE_CONTEXT_FEATURE_ACCESS.
- Internal/unavailable: MODEL_TEMPORARILY_UNAVAILABLE. All26 validation enum values are retained in window4; do not recreate the set from a partial summary.

Reused [case02 classifier](../responses-metadata-retry-02/source-evidence.json) and [class tail](../responses-metadata-retry-02/source-tail.json): hourly/daily/weekly/monthly/USAGE_LIMIT_REACHED are CLIENT_ERROR even when the status is429; overage and newly paused users are terminal. Client/model/service throttle is THROTTLING. InternalServerError is TRANSIENT. A generic unknown exception is not made retryable merely because its status is5xx. The existing Axiom diagnostic classifier is therefore not an equivalent retry classifier.

## HTTP error-body boundary

The same window includes `qOo`: it reads chunks until EOF or cumulative size reaches/exceeds1MiB (`u2u`), races a supplied timer, and then awaits iterator.return. It is not a strict byte cap because the last chunk can overshoot. The module defines15s `c2u`; this window alone does not prove every caller passes that value. Axiom's16KiB/1s bounded reader and cancellation safety are stricter, intentional limits; do not claim exact parity for oversized/stalled bodies or weaken them without an explicit design.

## Implementation consequence

Investigation is sufficient to stop expanding these dependencies. Build the native controller around a caller-owned, account-isolated reusable client scope, separate from logical-run callPosition. Keep the actual single-attempt header until the complete controller is connected and verified. Preserve fixed model, no partial-SSE replay, no global timer/config mutation, abort-safe late acquisition, and RAM-only unknown errors.

Unproven boundaries remain official2026 retry flag, exact resolved Smithy version, runtime factory overrides, cross-run graph counter preservation and source-bound title/summary identity. These are not answered by static cache wiring or the existing live text successes. See [native retry design](../../../kiro-native-retry-design.md).
