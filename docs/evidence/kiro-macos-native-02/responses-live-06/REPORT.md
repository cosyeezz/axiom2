# live06 — PASS within the new ordinary-run scope

Deployed continuation propagation passed the normal Axiom/Pi SDK path. One fresh session, two prompts, no replay; harness completed in28.7s with exit0. Both exclusive claims are consumed.

- Session `7e492cc2-74c5-46bd-aca4-133ff595477b`.
- First run `eee14cee-b8a5-42c7-8c1b-1d3943032b73`, second `81b7c697-cd99-40fe-bf5e-170f0ec12614`, both completed.
- Exactly one read of the synthetic fixture, matching successful tool result, exact final markers. Three assistant turns: toolUse/stop/stop, all DeepSeek with completed diagnostics. See [TRANSCRIPT.json](TRANSCRIPT.json).

## Captured boundary

Baseline30→34 flows. See [PROJECTION.json](PROJECTION.json); raw bodies/headers were parsed only in mitmweb RAM.

| Flow | Role | Input items | Terminal | Continuation |
|---|---|---:|---|---|
|28e0eba8-f866-416d-8120-72bf1f4d8c71|First main request|1|requires_action|First run UUID|
|da49de42-8bca-4028-b65e-7595ec48c0ea|Tool result continuation|4|completed|Same first run UUID|
|18557fec-e461-4f6c-9ef4-79e85919632f|Next user run|6|completed|Second run UUID|
|ad794468-b9c5-467b-a564-6c94cdceba1f|Auxiliary, tools0|1|completed|Absent|

All three main requests have UUID-v4 continuation different from conversation; conversation/root remain unchanged. The first returned call ID matches the next request's function_call and function_call_output; the next user run still preserves that history and marker. All four flows retain HTTP/1.1, official UA, Connection close, the exact official header-name set, correct byte length, matching profile header/body, status200 and complete SSE/[DONE]. Main event counts13/9/10; no parse failures. Attempt remains1;max=1 and optout remains true.

The tools0 flow has auxiliary/title-generation shape but is not strictly source-bound; its continuation is absent and output equals the second synthetic marker. Do not claim title parity from this result.

## Cleanup and limitations

Provider proxy is restored to builtin profile `71e33e85-237e-43f2-83ae-a0dc887525e8`, confirmed from models.json. UI initially blocked edits through needsReconcile after the earlier save; disabled clicks changed nothing. Normal “重新读取配置” and “放弃并重新读取” reconciled the already-published external config, then builtin was selected and saved once. No disabled-state bypass or direct config edits. Saved-config readback is authoritative; the initial save's receipt failure cause remains uninvestigated.

The150s limit covered the active model controller (28.7s); subsequent UI cleanup and post-processing of already captured RAM took longer and caused no new prompts. Installation4319 untouched. This proves the added new ordinary-run field in this bounded test, not cross-run resume preservation, auxiliary continuation, adaptive retries, OAuth parity, direct TLS or server-side indistinguishability. No official request was reissued.
