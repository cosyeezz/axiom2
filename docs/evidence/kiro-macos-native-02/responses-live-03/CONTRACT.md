# Responses live tool loop 03

Follows responses-live-02, which observed the real cause: Kiro tool turns end `response.completed` with `response.status="requires_action"`; local validator required `completed` (protocolCode response-terminal-mismatch). Fix: accept requires_action only when output contains a function_call. Offline 173/173 pass; deployed via restart axiom-backend-restart-faszd3bk.

One fresh session, kiro/deepseek-3.2/off, one user prompt asking a single read of /tmp/axiom-kiro-responses-live-03.txt and reply with its exact text. Expect 2 main /v1/responses requests (tool turn + continuation with function_call_output). No explicit retry; stop at 150s. Observation: mitm flows diff vs fresh baseline, in-browser whitelist projection (event types, statuses, call_id equality, function_call_output presence); transcript projection (toolCall/toolResult ids, isError, final exact marker, diagnostics). No raw persisted. Then restore Kiro proxy to {mode:builtin, profileId:71e33e85-237e-43f2-83ae-a0dc887525e8} and verify.

Pass needs: tool executed once with expected path, toolResult contains fixture, continuation request carries matching call_id output, final text exactly equals marker, kiro-responses-completed diagnostic on both assistant turns.
