# Self-owned HTTP calibration 02 — reentrant quota fix

## Why a new case

The immutable 01 observer (`dbe252b5219077352a1a36f45f1939178f53e812fdc6b125d715776437a026ad`) has a real defect: with a 4-byte body cap, original `write` reentry records two 4-byte chunks, reports `bodyBytes=8, ok=true`. Independent pure tests: 16 pass / 1 fail, runner exit1. Exact evidence: `/private/tmp/axiom-pure-audit.kHr4ztJX/` (t11232/r11235).

Independent network 01 never reached preload: control HTTPS failed `ERR_TLS_CERT_ALTNAME_INVALID`, because the fake certificate has only IP 127.0.0.1 while Node checks `Host: owned.invalid`. Certificate process exit0, control exit1 and true EOF, owner exit1; five HTTP control records only. This is a separate fixture defect, not proof of a tap network defect. Evidence: `/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-http-independent-l5oxb1b0/` (t11233/r11234). Do not disable TLS identity verification or edit either failed result.

## Change and hypothesis

02 reserves body quota before calling the original write/end, includes pending quota in the available amount, and releases reservations on both return and original throw. Accepted bytes are committed only after return; all original calls/arguments/returns/throw objects remain unchanged. Snapshot exposes pending quota, and auto exit rejects unfinished nonzero reservations. This bounds committed+pending quota during tested original-method reentry; it is not a claim about arbitrary patched intrinsics, exotic proxies or all peak process memory.

Test the original 17 pure oracles unchanged against the new source, plus nested return/throw/rollback and pending-quota cases. Each independent task gets new CreateNew TEMP and one main invocation; no edits to tested source while tasks run. For network, retain the original raw request/body comparison oracle, fix only the certificate SAN to include the deliberate fake host, and bind the new source. Record the test-only fixture delta explicitly.

## Bounds and acceptance

All [01 experiment](../observer-http-fixture-01/EXPERIMENT.md) safety boundaries remain. Pure task: total60s, child10s, CPU30s. Network task: total90s, child10s, parentCPU30s. Node stdout/stderr each <=1MiB, total test output<=4MiB; tap<=128events/256KiB body/1MiB NDJSON plus small terminal status; largest body<=128KiB. Minimal env, own HOME/TMPDIR, no official code/models/auth/real HOME/proxy inheritance or external network. Use explicit fake CA with validation enabled; do not change system trust. Host Node is the fixed public binary; record actual runtime version.

Require held original child identity, true pipe EOF, exit0, terminal observer ok/pending=0 and independent server bytes. Control/preload HTTP plaintext framing/headers/body must match for the declared fixtures. API chunks must match only the known immutable input cases; demonstrate the mutable Buffer negative as API != server receipt, not a failed wire-equivalence oracle. Sink/cap/deadline/late-status failures cannot produce a consumable pass. Missing coverage stays explicit. No official/M3/full-tree/server-parity claim follows.
