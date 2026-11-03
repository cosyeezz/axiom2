# Observer-preserved native sender — live-05

New hypothesis: after the Axiom statistics-wrapper fix, normal SDK invocation preserves Kiro's registered native transport rather than generic Fetch. This is a new case; live-04 remains failed and exhausted.

- Model kiro/deepseek-3.2/off; fresh session; one user prompt, no tool action requested. Exact marker AXIOM_KIRO_NATIVE_LIVE_05_76f9b2d4.
- Require verified newly compiled development deployment on 4317; leave installation 4319 untouched.
- Before prompt, exclusive-create text.claim; no replay after failure/unknown receipt/timeout. Observation limit 150s.
- Existing provider-scoped mitm proxy 127.0.0.1:8080 with existing extra CA, TLS validation retained. Read /flows baseline first, count every added flow and distinguish auxiliary/auth traffic. Restore builtin profile71e33e85-237e-43f2-83ae-a0dc887525e8 through UI and verify config on every outcome.
- Inference success: actual POST /v1/responses, model deepseek-3.2, HTTP/1.1, UA exactly matching official flow98122d02, Connection close, no Accept/Accept-Language/Accept-Encoding/Sec-Fetch-Mode, official header-name set, correct content-length; 200 SSE completed and [DONE], final exact marker and completion diagnostic.
- Keep all caller system/history/tools/security and independent account/profile; no official credential copying, CLI delegation, user baseURL/APIKey or separate reverse-proxy service.
- Raw bodies/credentials/context/unknown errors stay in RAM. Persist only whitelisted values/booleans/counts/IDs; no sensitive hashes.
- optout=true vs official false, attempt1max1 vs1max3, missing continuation metadata and independent auth remain explicit. This only verifies the observed inference HTTP path, not complete server indistinguishability/direct TLS or OAuth parity.
