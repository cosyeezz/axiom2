# Official CLI proxy comparison 01

Hypothesis: the unchanged official 2.36.0 launcher can perform one normal V3 deepseek-3.2 turn via a process-local HTTP(S) proxy and Node extra CA, producing a decrypted request for comparison with the existing Axiom sample.

- CLI artifacts: exact paths, sizes and SHA-256 must match ../natural-entry-metadata-03/PUBLIC-IDENTITY.json; rechecked before this case and again at launch. This is a file check, not atomic loaded-image attestation.
- Official syntax source: https://kiro.dev/docs/reference/cli-commands.md (HTTP 200; read in full). Documents `kiro-cli chat [OPTIONS] [INPUT]`, positional first question, `--no-interactive`, `--v3`. Current general docs, not a separate version-specific specification. Existing same-artifact metadata proves v3/no-interactive/model flags.
- CWD: repository root; ordinary existing HOME/login/context. No credential copying, no system/tools/context deletion, no agent override, no session resume, no trust-tools/all-tools flag.
- Command: official app launcher `chat --v3 --no-interactive --model deepseek-3.2` plus the same controlled positional input as Axiom: 请只回复 AXIOM_KIRO_CAPTURE_OK，不要调用工具。
- Process-local explicit HTTP(S) proxy 127.0.0.1:8080 and NODE_EXTRA_CA_CERTS pointing to the public mitm CA. Rust launcher CA support remains unverified; no global CA or TLS bypass, no SSL_CERT_FILE claim.
- One invocation, single consumed CreateNew execution.claim. 60-second wall deadline; combined stdout/stderr maximum 128 KiB retained (one-byte overflow detection). Raw streams never printed/saved; only fixed booleans, numeric counts and exits. Normal CLI-owned storage unchanged.
- Only the newly owned process group is controlled on deadline/cap. This is not proof of exhaustive descendants. No file-size limit changes.
- Success: proxy shows real official main request, exact model checked in RAM and compared to Axiom; all extra flows accounted for separately. Exit 0 or a matching reply alone is not parity.
- Failure: no automatic retry or changed-model fallback. Save safe failure predicates and observed flows, then report the missing prerequisite.
- Request/token/raw context stay in mitm/browser RAM. Only allowlisted field names, public transport fields, counts, known-value predicates and comparison booleans may persist. No hashes of sensitive content. Proxy HTTP version is not a native TLS fingerprint or server-equivalence claim.
