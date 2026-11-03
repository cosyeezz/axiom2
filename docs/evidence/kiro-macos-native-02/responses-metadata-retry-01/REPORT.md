# Bounded static continuation / retry findings

Source: existing /private/tmp/kiro-current-kas-member01-k5vna1mo/node_modules/@kiro/agent/dist/server/acp-server.js; 15,025,207 bytes, SHA256 bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1 reverified. This is the same KAS0.66.70 public code bound by prior reports. The older source04 temporary path no longer exists. No application execution/network/credentials/settings access. Initial budget exhausted normally at ten windows, final extraction at119s; do not extend this case.

Evidence: [uDo/factory](source-evidence.json), [message metadata](source-evidence-2.json), [strategy and callers](source-evidence-3.json). Offsets are zero-based original byte offsets. These are bounded static snippets, not complete program/AST or live behavior evidence.

## Retry layers

- 8440394: outer xje streaming recovery has separate attempt budgets and feature gates for empty/truncated/error/auth/stalled responses, rebuildInput and modelFallback. This must not be confused with an HTTP retry, and must not be copied as silent model fallback.
- 8451632: raw Responses branch calls uDo(preResponseRetryStrategy, BOo callback, signal) before JOo SSE conversion. The callback throws HOo for HTTP status>=400 after reading the bounded error body.
- 8410431: uDo acquires initial retry token, emits x-kiro-attempt from token retryCount+1 and strategy.attemptBudget, records success, or asks strategy.refreshRetryTokenForRetry then waits cancellably and repeats. No strategy: one e({}) call. It does not itself retry a subsequently consumed SSE stream.
- 14276800: factory normally uses Qne.withProgressBonus, but s===Det suppresses preResponseRetryStrategy. The exact Det mode remains unexamined.
- 14272997: Qne wraps Smithy AdaptiveRetryStrategy. Budget starts3 and increases by callPosition: <=2 bonus0, <=6 bonus1, <=11 bonus2, otherwise3. Initial adaptive acquisition can delay before sending. Error type is overridden only when Kce(error) is an instance of yo.
- Retry delay: modeled retryAfterMilliseconds, then Smithy retryAfterHint, clamped0..300000ms. Otherwise eve exponential/backoff helper with transient base250ms or THROTTLING base1000ms, jitter.2, maximum20000ms. Exact eve formula and Kce/yo classifier are not yet established. Therefore merely changing the header to1;max=3 would misrepresent behavior.

## Continuation metadata

- 8466514: convertToGenerateAssistantMessages gets conversationId/rootConversationId/continuationId/taskType from WVn(original messages); mints only missing conversationId and defaults root to conversation. continuation is passed unchanged to agentContinuationId.
- 8101697: WVn/MDt search backward for last nonempty string in message.additional_kwargs. ete around81012xx copies graph-context continuationId onto a message. This is not automatically a server response ID.
- 8089576: graph state declares continuationId. 12239413 shows a **nested memory-extraction** graph using preservedContinuationId??L1(); this is not proof of the main user-turn lifecycle.
- 14573444: title generation explicitly receives continuationId and rootConversationId. Consequently auxiliary calls also have identity semantics; do not assume independent random IDs everywhere.

## Next missing evidence

Locate the main user-turn builder and preservedContinuationId producer, callPosition updates, Kce/yo classification, Det and eve. Only after these are known can safe native/Pi adaptation be designed. Current code remains optout true, no automatic retry/header1max1 and no invented continuation. The already completed live05 inference HTTP result remains unchanged.
