# CodeBuddy cross-model continuation — bounded native acceptance

Scope: one **DeepSeek-V4.1-Flash/high** generation through the production Pi 1.4.0 `createModelRuntime` and the newly built native CodeBuddy provider. Reuse Axiom's normal configured authentication via its SDK loader; never read/copy CLI credentials or emit credential/header/body values. No CLI relay, generic compatibility proxy, TLS override or global proxy/trust changes.

Prerequisites: offline regression and build pass; independent implementation review resolved; restart of formal 4317 verified, and changed provider build fingerprints frozen. Native acceptance uses the same frozen production modules in a dedicated SDK process; it is **not a browser/UI test**. The other service on 4319 is out of scope.

## One-shot case

`03-native-foreign-history`: a synthetic foreign `openai-responses` assistant contains visible reasoning, an explicitly synthetic opaque signature, and a tool call whose ID is `call_synthetic|fc_synthetic`. Its matching historical result comes from the harness's own synthetic fixture (read by the harness, not model tool execution). Preserve the exact composite ID and readable reasoning/answers. The target user asks only to recall the synthetic marker/number, calculate plus31, and recall the fixture value. It forbids new tools; declare no available tools, and never execute any returned tool call.

Admission: create `03-native-foreign-history.claim` with `wx` immediately before the one SDK stream invocation. Exactly one logical invocation; `maxRetries: 0`, a 90-second absolute abort signal and native provider zero-replay policy. This is a cancellation cutoff, not a forced process-kill guarantee; record actual completion duration. Failure, timeout or cancellation exhausts the claim. Do not rerun or resume it; a further live experiment requires a new documented case and claim. Runtime initialization uses `allowModelNetwork: false`; any authentication refresh needed by ordinary SDK authorization is outside the chat-generation count and must not be copied or logged.

Accept only native stream completion with stopReason `stop`, correct marker/original number/computed number/fixture value, no emitted tool calls, at least one text delta, one observed payload callback and an HTTP 2xx response. Report only booleans, counts, bounded duration, status, and fixed error classifications. Raw context/reasoning/signature/request/response stay in RAM. Source synthetic fixtures are safe text; never store live payload/response. No settings/default-selection mutation, no formal-session prompt, no original failed-session send, no `agent.resume`, and no tool execution.

The actual failed user's historical context is tested separately **offline only** with a synthetic sender: canonical Pi `buildSessionContext` at the failure's parent entry plus normal `convertToLlm`, preserving recorded system/tools/history/security. Its verified projection is 116 messages, 25 signed-thinking blocks and 61 composite tool calls. Earlier raw JSONL inventory counts are not the model-visible context and must not be used as a full-context acceptance claim.

## Pre-admission gate history

Two native harness gates stopped before creating any fixture/claim or invoking a model. Their reports remain `native-live-report.json` and `native-live-02-report.json`, each with 0 payloads/responses/model generations. The first guessed a missing `<dataRoot>/pi/models.json`; the second followed `AXIOM_PI_DIR` correctly but treated the SDK's aggregate `getError()` as a definition gate. Further offline inspection found only a one-line `Availability refresh:` advisory, not a selected-definition error.

The active case-03 runner now follows the production worker: normal `ModelService` config lookup, `executionModelsRaw` selected-provider isolation into an owned temporary 0600 runtime snapshot, and `invalidModelDefinition` credential-blind validation. The real request uses normal auth routing and does not gate on advisory availability. The temporary snapshot is removed in `finally` and is not debug evidence; no configuration or credential values are logged. Earlier reports are not overwritten, and no exhausted claim is reused.

## Deliberately unexecuted UI plan

[The earlier two-turn UI plan](UI-PLAN-NOT-EXECUTED.md) and its runner were never admitted and have zero claims/prompts. Independent review found non-atomic global-default restoration, prompt-only tool restrictions and source-model retry/deadline gaps. The runner is now explicitly disabled. The bounded native case avoids those side effects instead of changing production settings or broadening authorization merely for a test.

Limits: successful synthetic live history proves server acceptance of this compound-ID/signed-state projection, not live replay of the user's whole 116-message context, the exact source GPT model/UI transition, cross-provider images, all foreign models, full CLI restore lifecycle, or transport/TLS parity. The preceding repair's 16 own-model UI cases remain separate evidence, not cross-model acceptance.
