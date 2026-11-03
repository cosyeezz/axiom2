# Official CLI comparison attempt 01 — no sample

**Result: failed to obtain an official request within the one-attempt budget. Paired official/Axiom main-request samples: 0. No provider changes based on an inferred difference.**

## Execution and boundary

- Artifacts: official macOS launcher and chat files both rechecked by full bytes/SHA-256 against [existing public identity](../natural-entry-metadata-03/PUBLIC-IDENTITY.json), matching 2.36.0. File checks do not attest atomic loaded images.
- One normal launcher invocation, repository CWD and existing HOME/login/context; explicit `chat --v3 --no-interactive --model deepseek-3.2` and same controlled positional input as Axiom. No tool preapproval, context deletion, copied credentials, resume, fallback or retry.
- Syntax from the [official current CLI reference](https://kiro.dev/docs/reference/cli-commands.md), HTTP 200, read in full. It documents positional INPUT and non-interactive first response. Generic current documentation, not a separate 2.36.0 specification; existing same-artifact metadata supports the explicit flags.
- Process-local HTTP(S) proxy at 127.0.0.1:8080; public CA via NODE_EXTRA_CA_CERTS. No system trust changes or disabled TLS verification. Rust-side use of these settings remains unverified.
- [Execution projection](EXECUTION.json): 60.078 seconds, deadline, direct child exit -15 after owned process-group SIGTERM. Received stdout 36,387 bytes, stderr 0; raw streams stayed bounded in RAM and were discarded, never exported. Pipes did **not** reach EOF; this is received-only, not drain.
- Known-marker predicates for certificate, login-required and unknown-argument text were false. This does not exclude those faults or establish the failure cause. No response marker appeared in stdout.
- Recorded direct PID/process group: 49694. Post-cleanup `ps -g 49694 -o pid=,ppid=,pgid=,comm=` returned status 1 with zero rows. Only this group was checked; detached descendants and exhaustive termination are not proved.

## Proxy observation

The mitm browser RAM baseline contained 7 flows. Readback immediately after the bounded official attempt found **0 new flows**. The previously captured Axiom main body remained in browser RAM.

This proves no new flow was observed at the intended proxy in that window, **not** that the CLI made no direct/bypassing request, and not that TLS, login, model selection or the service caused the stall. Exact official on-wire model, auth scope, request body/headers, retries and server view remain unknown. Command-line model intent is not actual-request evidence.

Axiom evidence remains [main + automatic title capture](../mitm-axiom-chat-01/SUMMARY.md); do not repeat its request. Matching answers and native/server transport parity are not claimed.

## Cleanup and next prerequisite

Axiom Kiro proxy was restored through normal UI to the original builtin profile `71e33e85-237e-43f2-83ae-a0dc887525e8`. Save, reload configuration, and selected-option readback confirmed builtin=true, originalProfileSelected=true, dirty=false. No additional chat/model-list request was sent. The development backend still has its process-local extra CA from the authorized restart; global CA remains unchanged. Local mitmweb remains running to retain RAM evidence; it is no longer the configured Kiro provider route.

The execution.claim is consumed; this case cannot run again. Further real official execution needs a new, explicitly authorized diagnostic attempt with a materially different startup/proxy observation plan, or an existing usable official sample. Do not automatically repeat the same prompt or old help/list experiments. The current evidence does not justify requesting a new login or editing the production provider.

See [contract](CONTRACT.md) and [runner source](run_once.py). No raw request bodies, tokens, unknown stdout/errors or hashes of sensitive content were persisted.
