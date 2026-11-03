# Native sender / UA acceptance — live-04

New hypothesis: the deployed DeepSeek provider now reaches the native Node HTTP sender (not Pi/default Fetch), sends the captured KiroCLI/2.36.0 KAS/0.66.70 UA and no extra Fetch headers, while still returning a complete response.

- Model fixed: kiro / deepseek-3.2 / thinking off. Fresh session; one user prompt. No tools requested.
- Controlled marker: AXIOM_KIRO_NATIVE_LIVE_04_8c62a14f.
- Before the prompt, claim text.claim using exclusive create. No replay/retry after failure or timeout.
- Bound: 150 seconds observation; stop on terminal failure. Count all new proxy flows, separating any auxiliary request rather than hiding it.
- Temporary provider proxy: 127.0.0.1:8080 with existing extra CA, TLS verification stays enabled. Restore builtin profile 71e33e85-237e-43f2-83ae-a0dc887525e8 after observation regardless of result.
- Verify actual request: POST runtime.us-east-1.kiro.dev/v1/responses, model deepseek-3.2, UA exact match to existing official flow98122d02, HTTP/1.1; no Accept/Accept-Language/Accept-Encoding/Sec-Fetch-Mode.
- Verify response: status200, SSE response.completed, final trimmed text exactly marker; native completion diagnostic.
- Current intentional unresolved differences remain visible: optout=true (official false), attempt=1;max=1 (official 1;max=3), missing continuation metadata. These prevent claiming complete parity.
- Preserve all caller policy, history and tools. Do not copy official credentials or use CLI as transport.
- Credentials and raw request/response/context remain in browser/proxy RAM; persist only whitelisted protocol fields, predicates, counts and IDs. No raw hashes.
- This test verifies deployed routing and HTTP evidence at the proxy, not end-server indistinguishability or native direct TLS fingerprint equality.
