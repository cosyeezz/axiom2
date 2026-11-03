# Main-turn continuation and retry dependencies

Same verified KAS0.66.70 bundle identity as case01. Source windows retained in [source-evidence.json](source-evidence.json) and [source-tail.json](source-tail.json). Ten windows completed by108s; this case is closed, no further extraction. No target execution/network/credential reads or code changes.

## Established static facts

- L1 at8098614 calls crypto.randomUUID; its log names creation of a new vibe session.
- Base fP.build around8139158 creates continuationId = preservedContinuationId ?? L1(). The constructor accepts preservedContinuationId from its caller.
- Main chat oCe.finalizeBuildState12325724 and custom/plan/spec graph builders use the same assignment. This establishes graph-state creation, not a UUID per physical HTTP request. Serializer only carries the graph metadata forward (case01). Exact upstream preservation/resume producer remains untraced.
- buildModelRequestTarget(e)12293525 forwards e to client.setCallPosition. Producer/semantic count of e remains untraced; do not derive it from total message count without evidence.
- Det374498 is session-title. Factory case01 disables its pre-response retry strategy; main/title retries cannot be treated identically.
- eve2140299 computes base*2^(retryCount-1), clamps to maxMs **before** applying multiplicative +/-jitter, rounds and clamps at0. Thus jitter can exceed nominal maxMs. lK resolves on abort; uDo explicitly checks cancellation afterward.
- Kce3933082 classifies service errors by name/reason/status and network errors by known messages/codes; yo subclasses declare retry type. Examples: usage/overage/new-user pause/validation/invalid model/unsupported client/TLS certificate -> CLIENT_ERROR; model/user/service rate throttle -> THROTTLING; InternalServerError/network/reset/TLS protocol/407 -> TRANSIENT. Model temporary unavailability/high load maps to THROTTLING. Some mappings inspect provider error body fields/messages, so status-only retry is not equivalent.

## Design implications and gaps

A caller-owned graph/run continuation UUID is supported by the static evidence. A new random ID on every SDK call would incorrectly split a tool loop; tying it permanently to session ID would merge separate turns. Native core should receive identity from its caller; Pi/Axiom adapter must supply a stable logical-run ID and preserve it on the intended resume boundaries. That application lifecycle needs examination before implementation.

Do not change attempt header alone. Full retry equivalence still needs HOo HTTP-error construction, Smithy adaptive token behavior/version and callPosition provenance. Outer partial-stream replay/fallback is separate and must not silently switch away from the user-selected DeepSeek model. Current sender stays one attempt until a safe, tested implementation can honestly support another policy.

These are version-bound static conclusions, not live multi-turn/retry/server equivalence. live05 HTTP/UA acceptance stays valid and limited. Next actionable work is examining Axiom's existing logical-run identity handoff; no additional official model capture is needed for that source task.
