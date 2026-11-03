# Manual official CLI versus Axiom — actual request comparison

## Result

One usable pair of main model requests is now available: Axiom normal UI and the user's manual official CLI, both specifying deepseek-3.2 in the actual HTTP body. They are **not request/protocol equivalent**. Official main response completed successfully with exact output `AXIOM_KIRO_CAPTURE_OK`.

This supersedes only the earlier absence of an official sample. The separate bounded automatic attempt remains failed; it was not retried. No production provider changes were made during this comparison.

## Evidence boundary and identity

- Local mitmweb PID34030, loopback 8080/8081, decrypted HTTP observation. User manually launched/sent the official turn; this agent did not issue another prompt.
- Baseline 7 flows, final readback 13, no later additions at final check. Baseline ordering/time metadata matches the prior safe record. Browser page context had been lost and was reopened; the proxy retained its flows in RAM. Index references below are local review indices, not stable external identifiers.
- Official launcher/chat full file sizes and SHA-256 still match [2.36.0 public identity](../natural-entry-metadata-03/PUBLIC-IDENTITY.json). Request UA reports KiroCLI/2.36.0, KAS/0.66.70, Node22.23.4. File verification and UA do not constitute atomic loaded-image/PID attestation of the user's process.
- All three Axiom public source files still match [source binding](../mitm-axiom-chat-01/SOURCE-BINDING.json). Current kiro-chat.ts lines 143–160 confirm the model/profile guard, legacy target, opt-out true, and fetch path.
- Tokens, raw request/response context and profile values were read/compared only in browser RAM, not exported or hashed. Persisted results are public protocol fields, counts and predicates. Normal CLI storage is outside this extra-capture claim.

## Main requests

| Field | Axiom (index5) | Official CLI (index11) |
|---|---|---|
| Endpoint | POST https://runtime.us-east-1.kiro.dev/ | POST https://runtime.us-east-1.kiro.dev/v1/responses |
| Model field | conversationState.currentMessage.userInputMessage.modelId = deepseek-3.2 | model = deepseek-3.2 |
| Request content type | application/x-amz-json-1.0 | application/json |
| x-amz-target | AmazonCodeWhispererStreamingService.GenerateAssistantResponse | absent |
| Body root fields | conversationState, profileArn | model, input, tools, stream, origin, profileArn, metadata |
| Streaming response | AWS eventstream (prior Axiom capture) | text/event-stream, SSE |
| Tool definitions | 9 | 18 |
| Context representation | system wrapper + user input in currentMessage; history omitted | input array of 3 items: user, assistant, user |
| Content sizes | current message 12,833 JS string characters | input items 21,871 / 33 / 211 JS string characters |
| Controlled input | present in current message, not equal to entire content | present in final user item, not equal to entire content |
| User-Agent | undici | KiroCLI/2.36.0 KAS/0.66.70 os/darwin md/appVersion-2.36.0 app/AmazonQ-For-CLI acp-client/kiro-cli |
| x-amzn-codewhisperer-optout | true | false |
| Origin/profile headers | x-amzn-kiro-origin and x-amzn-kiro-profile absent | both present; profile header equals body profile |
| Bearer format | nonempty (prior capture) | nonempty |
| HTTP status | 200 | 200 |
| Proxy request.http_version | HTTP/2.0 (prior capture) | HTTP/1.1 |

ProfileArn equality between the two bodies is true, without exporting its value. This does **not** establish token equality, OAuth scopes, original registration, or server-side auth equivalence. No credentials were copied.

Official metadata keys: kiro:agent_mode, kiro:conversation_id, kiro:root_conversation_id, kiro:agent_continuation_id. Dynamic values were not exported. stream=true. Official request header names additionally include x-kiro-attempt; Axiom explicitly constructs amz-sdk-request attempt=1; max=1. Header differences are not a proven retry policy comparison.

Official response parsed as 9 SSE JSON data events; response.completed present, completed response model exactly deepseek-3.2, completed output types only message, joined output text trimmed exactly equals the controlled marker. No response.failed or function_call marker observed. This is successful completion evidence, not behavioral equivalence.

The CLI's initial user/assistant items must not automatically be classified as prior user conversation history; they may be generated context/setup. Contents have not been removed or normalized. No model switch is inferred from the separate auxiliary call.

## All six new flows

| Index | Host and operation | Status | Interpretation |
|---|---|---|---|
| 7 | management.us-east-1.kiro.dev /; KiroControlPlaneBearerService.ListAvailableModels | 200 | model catalog |
| 8 | runtime.us-east-1.kiro.dev /; KiroRuntimeService.GetFeatureConfiguration | 200 | feature configuration |
| 9 | runtime.us-east-1.kiro.dev /; KiroRuntimeService.InvokeMCP | 200 | MCP operation; not proof of a model-generated tool call |
| 10 | app.kiro.dev /service/KiroWebBearerService/operation/GetResolvedConfigManifest | 403 | config manifest failure; application/cbor request, not parsed as JSON; not the main inference failure |
| 11 | runtime.us-east-1.kiro.dev /v1/responses | 200 | confirmed deepseek-3.2 main request, completed marker |
| 12 | runtime.us-east-1.kiro.dev /; KiroRuntimeService.GenerateAssistantResponse | 200 | separate simple-task model call, not the deepseek main request |

Index12 body: conversationState, profileArn, agentMode. Conversation state contains currentMessage, chatTriggerType, conversationId, history, agentContinuationId, agentTaskType, rootConversationId. User message modelId exactly simple-task; content 917 JS string characters includes controlled input; history length 0, tool definitions 0. Response application/vnd.amazon.eventstream. Title/summary words are present in its prompt, suggesting an auxiliary title/summary task, but the exact generating source and purpose were not bound: **not yet a proved title request**. It is not labeled a retry. Its opt-out header is absent (not false); profile equals the Axiom/main profiles. Axiom's own second call was separately source-bound to automatic titles and uses deepseek-3.2, not simple-task.

## Consequences and next work

1. The primary production gap is transport/schema selection, not merely changing a UA or x-amz-target: this official V3 deepseek sample uses a Responses-shaped request and SSE, while Axiom constructs conversationState and parses AWS eventstream.
2. A native Kiro-specific implementation must preserve independent Axiom auth/profile, system/custom/history/tools/security, tool results, stream semantics and cancellation. Do not silently switch provider to a generic OpenAI endpoint or copy CLI credentials.
3. Do not set opt-out=false just to match this sample; this is a privacy-impacting difference requiring an explicit policy decision. Keep current true until authorized otherwise.
4. One sample does not establish all model routing, retries, tool-call lifecycle, images, reasoning, resume, feature gating, or registration scopes. Those remain unverified. Title auxiliary source binding also remains open.
5. Any implementation change needs schema/stream/error/tool/cancellation checks and a separately authorized real verification request; this report does not claim parity is implemented.
6. Proxy HTTP versions do not prove native direct TLS fingerprints or the upstream server's view. Same profile/model/output and HTTP200 are insufficient for server equivalence.

Axiom original builtin proxy remains restored and persisted. Local mitmweb retains RAM evidence; do not discard it until needed schema comparison is complete. Do not repeat the user's prompt merely to recreate this sample.
