# live-05 — native SDK inference HTTP acceptance passed

One prompt, fresh session `b5553c55-9c9d-47df-bfd3-5687e29bb36b`, run `67aa99cb-d91e-4850-9c04-3d59ce2722d1`; completed within approximately 23 seconds. Development restart xw_uske8 verified at 2026-10-31 00:40:25, PID17719, HTTP200 and WebSocket connected. Installation4319 untouched. Claim is consumed.

[Safe projection](PROJECTION.json), against [baseline28](baseline.json): two new `/v1/responses` flows. Main `77532a94-cc18-4779-93ba-354badebd785` has nine tool definitions but zero executed tools; auxiliary `eda2447f-24bd-4e1b-af2b-dac8acd55fbc` has no tools, shape consistent with title generation (not strictly source-bound).

Both actual inference requests: POST, deepseek-3.2, HTTP/1.1, Connection close, exact official CLI2.36.0/KAS0.66.70 UA, same header-name set as existing official flow98122d02, no extra or missing headers, correct content-length, and profile header consistent with body. Both responses: 200, nine parsed SSE events, completed, final [DONE]. Main output is the exact controlled marker. Normal transcript read-only projection confirms provider kiro/model deepseek-3.2, stop, zero tool calls and diagnostics kiro-usage-unavailable/kiro-responses-completed.

Temporary external proxy was restored through normal UI. Readback confirms builtin profile `71e33e85-237e-43f2-83ae-a0dc887525e8`. No credentials, raw bodies/context, unknown provider errors or sensitive hashes were persisted in these evidence files.

This passes only this contract's observed inference HTTP boundary. Values still differ for privacy optout (true vs official false), attempt (1;max=1 vs1;max=3), and continuation metadata is absent. Independent OAuth registration/scopes/refresh sending and direct TLS/server view remain outside this pass. Header-name equality is not full header/body equality. Earlier failed live-04 remains failed; no repeated old case was used to obtain this pass.
