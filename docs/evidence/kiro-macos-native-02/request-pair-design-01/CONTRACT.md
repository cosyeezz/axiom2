# One-pair request observation — design, not execution readiness

Goal: collect one official/Axiom comparison under exact deepseek-3.2 and controlled input, preserving all system/custom/history/tools/security content. No CLI/ACP bridge for Axiom, CLI credential extraction, real TLS keys, global trust/proxy/SIP/signature or real agent-config changes. The failed no-input runtime01 is closed; this is not permission to substitute a prompt into that discovery probe.

## Concrete source findings

Axiom normal route is `configureModelNetwork(root, modelsFile, 'kiro')` followed by `createModelRuntime` and `runtime.streamSimple`, with application's normal models/auth/catalog paths and selected-account routing. No custom credential store, API key or hand-made opaque ticket. Require exact nonvirtual kiro/deepseek-3.2 with api=kiro-chat; absence ends the experiment, never fallback. The normal network binding must preserve selected provider proxy, not silently change to direct. Independent OAuth refresh/profile discovery may add HTTP operations; one inference is not one total network request.

Current source: [runtime](../../../../app/src/server/model-runtime.ts), [provider](../../../../app/src/server/providers/kiro.ts), [chat](../../../../app/src/server/providers/kiro-chat.ts), [network](../../../../app/src/server/integrations/model-proxy-env.ts), [normal worker](../../../../app/src/server/agent-worker.ts). These links refer to current mutable working-tree source, not frozen runtime identities. Production sources have not been changed in this investigation.

`kiro-chat.ts:142–159` invokes onPayload, guards model/profile/origin, serializes the complete request, constructs bearer and service headers, then uses options.fetch / injected fetch / globalfetch. The normal network setup imports **Undici8.10.2**, installs its fetch/global dispatcher, uses Kiro keepalive60s/max120s and does not force HTTP1. `model-network-worker` has no chat operation; it must not be repurposed or invoked through its login branch. Existing provider-request-observer only collects request counts/timing, not payload or final wire headers, and installs only inside a worker instance.

Therefore the earlier Node ClientRequest end observer does **not** cover the Axiom transport. It also retains no payload, so cannot by itself implement RAM pairing. Do not count its own HTTP tests as a new dual-transport validation.

## Observation boundaries, not inferred wire

Installed Undici8.10.2 source provides diagnostics channels `undici:client:sendHeaders`, `undici:request:bodyChunkSent`, `undici:request:bodySent` and response metadata correlated by the Request object. These can avoid wrapping fetch promises, consuming body iterators twice or replacing original API arguments.

Important limits from current source:
- H1 `client-h1.js:1345` publishes a header prefix **before** the write path appends Content-Length/Transfer-Encoding and closing CRLF. It is not complete wire-header evidence. `writeBuffer` and `AsyncWriter.write` call onBodySent after socket.write; bodyChunkSent observes supplied chunk values, not necessarily consumed kernel/server bytes if mutable data is subsequently changed.
- H2 `client-h2.js:1221` serializes a diagnostic text view of the headers object, then may add Expect for expectContinue before openStream. This is not HTTP1 header syntax, HPACK or HTTP2-frame evidence. Do not pass it through an HTTP1 parser and fabricate equality.
- `core/connect.js:70,92` defaults allowH2=true and offers both http/1.1 and h2 unless configured otherwise. Do not force HTTP1 to fit an observer; actual negotiated protocol must be observed or unknown.
- `web/fetch/index.js:1933–2002` reads request.body.stream via an async generator. The public diagnostics Request.body is not guaranteed to be the original serialized string. Do not inspect by iterating or consuming it.

Official2.36.0 actual sender/prototype/preload installation remains unknown. A future actual-pair case needs a reviewed observation installation and conservative missing-hook result. It cannot certify natural installation merely from a passed host-Node fixture, nor certify complete lifecycle from a closed in-process snapshot. No finished snapshot/complete-process-tree work is being reopened.

## Smallest useful comparison contract

Only bounded RAM may hold the two original serialized bodies and observed header values. No raw body/header/token/path/query/arbitrary keys/claims/errors/stacks or input hashes/HMAC tags in reports. Public program identities and own fixed invocation provenance are separate from captured account/request context. Retain both original values unmodified; do not remove context, sort fields or normalize differences into equality.

Initial comparison should report original UTF8-body equality, fixed known field presence/value equality, explicit dynamic-field differences/format checks, and each observation boundary. Unknown or unsupported data stays unknown. A canonical-JSON check may reject a body for structured inspection; it must not rewrite the input or claim normalized equality. Byte comparison remains separate from structured comparison, and neither alone proves complete-request/wire/server equality. All unknown fields remain in whole-body comparison, never silently omitted from an overall pass.

Headers require format-specific handling. Incomplete H1 diagnostic prefixes and H2 textual projections must retain their limitations; no final framing field may be invented from an expected length. Response success is a correlated functional observation, not parity proof. Opaque token scope cannot be declared equal from matching bearer shapes; any unproved auth rules remain explicitly unknown.

## Remaining implementation and acceptance gates

No new observer, IPC transport, runner or model launch gate is created by this document. Required before a real-pair attempt:
1. Bounded RAM comparator with fixed, secret-safe output, no mutation/normalization of either original input.
2. Actual transport adapters for the two different paths, preserving API parameters/return/throw/callback behavior. Reuse unchanged validated pure helpers where applicable; do not retag fake-only tap.
3. Narrow own non-model tests for new behavior, including server-body checks and fail/limit behavior. No rerun of unchanged passed matrices and no repeated official discovery probes.
4. A one-shot execution contract defining normal account/network selection, same controlled inputs, exact model, total budgets, aborts, response handling and missing/incomplete observation outcome. At most the authorized one paired experiment; no retries to recover discarded data or find a hook.

Only actual comparable observations can motivate production-provider changes. Preparation, a diagnostic prefix, same answers or HTTP200 cannot close the parity goal.
