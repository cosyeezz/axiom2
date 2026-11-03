# Kiro deepseek-3.2 Responses adaptation

## Scope and status

Implemented in `app/src/server/providers/kiro-responses.ts` and integrated in `kiro-chat.ts`. Only exact model ID `deepseek-3.2` switches to `/v1/responses` plus SSE; other model IDs retain the existing AWS eventstream route. Deployed on the 4317 development build and live-tested for text and one read-tool loop (see Live acceptance). This is not proof of server equivalence.

Evidence: [manual official comparison](evidence/kiro-macos-native-02/mitm-manual-official-chat-01/SUMMARY.md). That capture establishes the official main request route, basic payload and text SSE shape. It does not establish live tool/image/reasoning compatibility.

## Preserved boundaries

- Axiom's independent OAuth/profile, caller context, policy, tool definitions, aliases and strict argument validation remain in place.
- Existing history/interrupted-call safety checks run before conversion. Existing reasoning-history omission diagnostics remain; no claim of new reasoning-history parity.
- Input is mapped to messages, function calls, function outputs and image data URLs. Tool error status and text blocks are preserved in the JSON output string.
- Current implementation: privacy opt-out is true; credentials are independently obtained; Responses UA exactly matches the captured macOS CLI 2.36.0 / KAS 0.66.70. Retry header is `1;max=1`, matching the actual no-retry implementation (official capture: `1;max=3`; that header alone does not establish retry policy). Opt-out stays true pending an explicit privacy decision. The former no-CLI-UA policy was an implementation choice incorrectly attributed to the user; UA alignment is explicitly required.
- Payload hooks see the actual request; model/profile/origin/stream substitution is rejected. Stream hooks see raw SSE events exactly once and remain cancellation-bound.
- SSE has UTF-8 validation, byte/event limits, scheduling fairness and reader cancellation. Completion requires validated `response.completed` whose `response.status` is `completed`, or `requires_action` only when the response contains a `function_call` item (the observed live tool-turn shape). A text-only `requires_action`, or `in_progress`/`failed`/`incomplete`, is rejected. Malformed, truncated or model-mismatched streams fail rather than executing tools. Each stream failure records a fixed local `protocolCode` in kiro-failure details; provider text is never copied into it.
- Credits-only usage remains unavailable as token usage. Explicit standard token counters are mapped only with cache-read details, then validated by existing usage checks.

## Native SDK boundary

This is an in-process native Kiro Provider, not an OpenAI-compatible HTTP reverse proxy. Users do not provide a baseURL or API key. The Pi adapter retains context normalization, tool dispatch, history, cancellation and configured agent behavior; Kiro owns OAuth/profile, protocol construction and sending. The SDK's internal `apiKey` slot carries only a short-lived, single-use process-local credential ticket, not an API key sent to Kiro.

[kiro-native-protocol.ts](../app/src/server/providers/kiro-native-protocol.ts) provides domain inputs, serialization and validation without Pi. [kiro-native.ts](../app/src/server/providers/kiro-native.ts) prepares fixed destinations/auth/UA and exposes the native sender/parsers. [kiro-native-http.ts](../app/src/server/providers/kiro-native-http.ts) uses Node HTTP/1.1, explicit byte length, isolated proxy agents, cancellation and no redirects/retries. Responses avoids Fetch supplement headers and the global keep-alive pool. The legacy AWS route and OAuth/catalog requests are not claimed to have migrated.

Axiom request statistics now wraps the registered Kiro transport rather than injecting generic Fetch. This matters: live-04 caught exactly that override. Explicit trusted custom transports remain supported; replacing them can change wire behavior. Native sending independence does not mean the whole authentication store or agent lifecycle is Pi-free.

## Continuation identity (deployed; new ordinary runs live-verified)

Frozen KAS0.66.70 static evidence now establishes graph-created UUID v4 continuation metadata, separate pre-response adaptive retry and outer streaming recovery. Reports: [structure](evidence/kiro-macos-native-02/responses-metadata-retry-01/REPORT.md), [lifecycle and classification](evidence/kiro-macos-native-02/responses-metadata-retry-02/REPORT.md). The initial attempt budget is3 with an agent-iteration bonus; title requests disable this strategy. [Dependency closure](evidence/kiro-macos-native-02/responses-metadata-retry-03/REPORT.md) binds the actual Smithy classes and establishes internal acquisition waits in addition to Qne's delay. [Ownership and error normalization](evidence/kiro-macos-native-02/responses-retry-ownership-04/REPORT.md) establish one strategy per cached client across runs and the complete reason-enum binding. [Retry design](kiro-native-retry-design.md) is finalized, with [five offline design probes](evidence/kiro-macos-native-02/responses-retry-design-05/REPORT.md) and final typecheck passing. It separates account/client state from host-run progress, retains ownership through cancelled SDK acquisitions, and requires coordination with Pi's session retry to avoid multiplying attempts. These are design/fixture results, not an implemented retry controller; our actual transport remains single-attempt.

Native callers may supply `createKiroNativeRequest(..., sessionId, { continuationId })`; Pi callers use `options.metadata["kiro:agent_continuation_id"]`. UUIDs are validated before serialization and after payload hooks. Axiom supplies its durable run UUID only for fresh ordinary runs on the matching main session and DeepSeek native API. It remains stable through that run's tools and SDK retries; new runs use their new UUID. Missing caller identity stays omitted; no prompt hashing or per-request random ID is introduced. Resume, memory continuation, notifications, reload and compression preparation do **not** guess cross-run preservation. Legacy AWS requests are unchanged.

New offline verification: focused7 files45/45 + other11 Kiro files207/207 (252 nonduplicate tests). The new6-test fixture was rerun after a type-only correction: its credential literal initially triggered TypeScript weak-type errors, fixed by annotating KiroNativeAccount, not changing production behavior. Final tsc and root build passed. Development restart5u2nwa8y verified at2026-10-31 01:05:42 (17719→35319, HTTP200/WS connected); installation4319 untouched. Logs: `/tmp/kiro-continuation-{focused,regression,fixture,tsc,final-tsc}.log`. Standalone local HTTP verifies the same continuation across a tool loop; actual ModelRuntime/observer local HTTP verifies the metadata handoff. These local checks are distinct from the subsequent bounded upstream verification in live-06.

## Verification

After native transport and observer integration: `tsc --noEmit`, root `npm run build` and changed-file `git diff --check` passed. Focused native/observer/Responses/native-compat coverage: 39 tests; other Kiro regressions: 207; unchanged callback coverage: 3 retained. The focused batch initially passed 38 with one invalid new fixture (missing model config); that fixture was corrected and passed separately. No duplicate counts. Logs: `/tmp/kiro-observer-tests.log`, `/tmp/kiro-observer-fixture.log`, `/tmp/kiro-observer-regression.log`, `/tmp/kiro-observer-final-tsc.log`, `/tmp/kiro-observer-build.log`.

[Standalone test](../app/tests/kiro-native.test.ts) bundles without Pi and runs plain Node against a local HTTP two-round tool loop. [Observer integration test](../app/tests/kiro-native-observer.test.ts) uses actual ModelRuntime registration/stream and Axiom statistics, forbids generic Fetch and verifies local HTTP/1.1/UA/no supplement headers/Connection close plus caller policy, response hook and statistics. These are synthetic local proofs, not live server equivalence.

Earlier checks after the `requires_action` fix (historical baseline):

- `cd app && npx tsc --noEmit`: exit 0.
- `cd app && npx tsx --test tests/kiro-responses.test.ts tests/kiro-chat.test.ts tests/kiro-callback.test.ts tests/kiro-tool-input.test.ts tests/kiro-images.test.ts tests/kiro-interrupted-history.test.ts tests/kiro-thinking.test.ts tests/kiro-usage.test.ts tests/kiro-failure.test.ts`: exit 0, **173 tests passed**.
- `git diff --check -- app/src/server/providers/kiro-chat.ts`: exit 0.

New tests cover one-byte Unicode SSE, multiple text parts, request headers/privacy/context, raw hooks, tool aliases/schema/result round trip, malformed lifecycle, error sanitization/no retry, hook cancellation, silent-body timeout, identity guards, images, usage and a real Pi Agent tool loop using mocked transport. The Agent executes one validated call then returns its result on the next request; missing completion executes no tool and makes no second request.

Local logs: `/tmp/kiro-responses-final-tests.log`, `/tmp/kiro-responses-typecheck.log` (ephemeral). Durable test evidence is reproducible from `app/tests/kiro-responses.test.ts` and the commands above. All fixtures are synthetic; no captured credentials or raw live conversations were written into these files.

## Live acceptance (development build 4317)

- Text, live-01: passed with an exact marker match.
- Tool, live-01/live-02: failed. The live-02 mitm capture showed a complete stream ending in `response.completed` and `[DONE]`, with `response.status="requires_action"` and output `message,function_call`. The old check accepted only `completed`, so this complete stream was rejected and the tool never ran. Diagnostic: `protocolCode=response-terminal-mismatch`.
- Tool, live-03, after the fix: passed. [Contract](evidence/kiro-macos-native-02/responses-live-03/CONTRACT.md). The model called `read` once with the correct path, and the tool result contained the fixture marker. The second `/v1/responses` request carried `function_call` and `function_call_output` with the same `call_id`. The final text equaled the marker exactly, and both assistant turns recorded `kiro-responses-completed`. One further tools-free request (392-byte input) ran after the turn; its shape matches session title generation.

- UA/native transport, live-04: **failed transport acceptance** despite exact UA and text. [Report](evidence/kiro-macos-native-02/responses-live-04/REPORT.md). Actual requests still used HTTP/2 and Fetch supplement headers because Axiom's statistics wrapper injected generic Fetch. The wrapper was fixed; this does not retroactively pass live-04.
- Corrected SDK native sender, live-05: **passed its bounded HTTP acceptance**. [Report](evidence/kiro-macos-native-02/responses-live-05/REPORT.md). Main and auxiliary inference requests used HTTP/1.1, exact official UA, Connection close, identical header-name sets, no Fetch supplements, and correct byte length. Both completed SSE; main final marker was exact. Temporary proxy was restored to builtin and read back.

- Logical-run continuation, live-06: **passed the new ordinary-run scope**. [Report](evidence/kiro-macos-native-02/responses-live-06/REPORT.md). Two prompts, one read tool, three main requests. The two tool-loop requests carried the first run UUID; the next user run carried its different UUID. Conversation/root and matching call/output history remained intact. HTTP/1.1, official UA, exact header-name sets and complete SSE were retained. Both markers were exact. All4 new flows accounted for; tools0 auxiliary continuation remained absent and was not strictly source-bound. Provider builtin restoration was read back after normal UI reconciliation. Claims consumed; no replay.

## Remaining verification boundary

Remaining differences must not be treated as accepted parity: optout=true vs official false, attempt `1;max=1` vs the official adaptive policy, cross-run resume preservation and auxiliary continuation (new ordinary runs passed live-06), independent authentication registration/scopes/refresh transport, and unverified direct TLS/server view. The user explicitly prioritizes UA and request fidelity; only using Axiom's own tool set is expressly accepted. Native core independence is locally verified; corrected SDK inference sending was observed in live-05, without claiming whole-auth or server-view equivalence. Images, reasoning variants and cancellation mid-tool on live traffic remain unverified. No claim of complete server indistinguishability.
