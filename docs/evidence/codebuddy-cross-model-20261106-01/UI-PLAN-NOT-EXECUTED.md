# CodeBuddy cross-model continuation — bounded acceptance

Scope: one new formal Axiom session at `http://127.0.0.1:4317`; select configured **OpenAI / GPT-6.1 Sol Fast**, high, then **Workbuddy / DeepSeek-V4.1-Flash**, high. Do not prompt or resume the user's failed session. The separate service on 4319 is out of scope.

Prerequisites: latest source/offline regression and build pass, independent review resolved, separately restarted 4317 runtime verified with changed provider module fingerprints. UI model labels must be observed before choosing them; no guessed protocol source-model ID.

## One-shot cases

Each case admits exactly one user prompt by creating a unique fixed marker with `wx` immediately before Send. A timeout, failed assertion, cancellation or response failure consumes that case. Do not rerun or resume this harness to send either prompt again. No automatic semantic retries. New investigation needs a separate documented case/claim.

1. `01-source`: source model high, one prompt requesting `read` of the owned synthetic text fixture, memorization of a fixed synthetic marker/number, then concise confirmation. Accept only a completed run with at least one source `thinkingSignature`, a `|`-composite tool call and a matching successful tool result. Preserve the exact transcript in normal application history, not in evidence files.
2. `02-target`: switch the same session to Workbuddy DeepSeek/high without clearing or editing history. One prompt asking to recall the source marker/number without restating them, calculate the requested result and `read` the same owned fixture again. Require completed native run, correct recall/calculation, successful newly paired tool call/result and streaming snapshots. This checks actual server acceptance of foreign source history and a subsequent tool continuation, not just a mocked request projection.

Per case: at most 180 seconds, six assistant messages and six tool calls; stop on observed overflow. Tools are allowed only to read the dedicated fixture. No delegates, network research, credentials, project inspection, write/edit/bash, or unrelated files. The script may create its owned fixture outside model execution. No attached images needed: the initial repair separately verified each model's own image flow; that does not imply cross-provider image coverage here.

Read the current default selection when creating this test session. Model selection can change the global default; restore it only if the global selection still equals the harness's last selection. Otherwise record that concurrent changes prevented restoration. Reload is read-only; do not invoke `agent.resume`.

Evidence stores only fixed classifications, booleans, counts, bounded durations, tool-name allowlists and provider/model metadata. Raw prompts/response/reasoning/signatures/transcripts/wire bodies/headers remain in RAM or normal application history. Session/run IDs and local controls remain in uncommitted local control files. Do not read CLI credentials, disable TLS validation, change proxy/global trust, invoke official CLI to relay requests, or reuse the 16 exhausted earlier claims.

A two-turn successful example does not establish live replay of the user's entire 393-message history, all foreign model formats, full CLI restore lifecycle, transport/TLS parity, or cross-provider images. The user's actual historical transcript may additionally be checked in RAM with a synthetic sender, but never sent upstream by this task.
