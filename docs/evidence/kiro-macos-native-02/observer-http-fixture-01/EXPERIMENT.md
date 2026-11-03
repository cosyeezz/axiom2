# Owned HTTP observer experiment 01 — no official execution

Question: can a fake-only early Node preload observe the established HTTP/1.1 API boundary without changing ordinary API this/args/return/throw/callbacks or known loopback request bytes? This is one component, **not** current official engine/Node runtime, complete process-tree M3, TLS fingerprint, wire or server parity.

## Scope and budgets

- Only new self-owned CJS modules, fake loopback HTTP/HTTPS server, fake deterministic data. No official bundle/import/CLI/auth/callback/settings/HOME read or model. No real credentials or TLS session keys. Fake HTTPS may use a newly generated test-only certificate/key, never a global CA change.
- Host Node exact executable `/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node`; runner must record actual `process.version/platform/arch`, not assume official runtime equivalence.
- One CreateNew main per test namespace, own TEMP/cwd/HOME and minimal env, no inherited token/proxy variables. Do not change observed sources while tests run. Independent tests may add scripts/results only in their own TEMP.
- Overall90s, independent owner per-child10s, parent CPU30s; Node process output<=1MiB each, observer events<=128, API-body total<=256KiB, NDJSON<=1MiB plus tiny terminal status, total test output<=4MiB, maximum test body128KiB. Use new namespace for fixes/negative failures, retain original actual exit.
- Only loopback network; no package/dependency installs. Where supported, fake client sandbox must deny forks/remote networking/real HOME reads and writes outside TEMP, with an exact read/exec exception for the public host Node binary. Such a constrained fake is **not** ordinary official creation or full-tree containment proof.

## Required independent checks

1. Pure injected fake API: original this and exact argument objects/arity, one call, identical return and thrown object, rejected calls, logger failure and cap produce sticky bad status without altering original calls. Uninstall restores original descriptors.
2. Real control versus preload: same raw loopback server ports, known header/body/framing bytes, HTTP and explicit-own-CA HTTPS, options/URL overloads, GET lexical aliases, aliases acquired after preload, utf8/latin1/Buffer/Uint8Array view, empty writes, invalid chunk errors, large-write backpressure, callback counts and keepalive/multiple requests.
3. True EOF and output cap, Node PID equals original owner child, child exit and terminal status checked before consuming output. Independent deadline kills only original held direct child; no descendant-completeness claim.
4. Negative boundary: mutating a Buffer after API call can make API bytes differ from later socket bytes; must label this as expected API-boundary limitation, **never** call API-chunk capture wire/server receipt. HTTP request is not socket/CONNECT evidence. Log/cap/timeout failure must not generate a consumable pass.

Success: all executed in-scope checks pass with frozen source SHA, actual commands/exits/resources and limitations. Failure: preserve exact failing output/exit and inspect; no changing oracle to green. Do not run real official code or any model regardless of this local result. Overall Mac M3 still requires identity/natural creation/ownership/complete cleanup/late-object/deadline arbitration proofs.
