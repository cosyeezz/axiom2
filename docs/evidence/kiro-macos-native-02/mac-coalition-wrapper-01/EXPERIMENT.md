# Mac containment: locate the actual coalition syscall wrapper

## New decision, not a retry of the exhausted six-download case

Previous `mac-containment-review-01` fetched the wrong `bsd/kern/kern_coalition.c` path (404), and public mutable `osfmk/kern/coalition.c` explicitly referred to wrappers in **bsd/kern/kern_proc.c**. It did not answer syscall authorization. This new bounded case asks only: does that actual wrapper authorize coalition creation/control using membership in a privileged coalition, UID/root, another capability, or some combination? Distinguish `requestTerminate` from killing members. No conclusion is upgraded from a symbol or header.

Hypothesis to resolve: an unprivileged UID is not necessarily unable to create its own nonprivileged coalition; permission depends on the actual wrapper and the caller's coalition state. A source result still will not prove this host's permission, inheritance, no-escape, enumeration, atomic signaling, notification or final empty-state semantics.

## Exact scope and budget

At most **three anonymous HTTPS GETs**, each <=512KiB response, connect<=5s/wall<=10s, total<=45s/CPU10s, new CreateNew TEMP:
1. Correct file at exact observed kernel tag `xnu-12377.161.14`: raw GitHub `apple-oss-distributions/xnu/.../bsd/kern/kern_proc.c`.
2. Only if exact response is unavailable: GitHub public commits/main endpoint to obtain one immutable40-hex commit.
3. Only then: correct wrapper file at that pinned commit.

Do not retry failed URLs, fetch the old wrong path, guess nearby tags, fall back to another mutable-main copy, traverse dependencies or use credentials. Stop when the wrapper question is answered or budget is exhausted. Preserve HTTP status, curl exit/headers, complete response/hash, error bodies, and exact URLs; 404 does not prove the tag is absent. If a200file exceeds the cap, retain failure and do not claim complete coverage.

Minimal env/ownHOME/TMPDIR/curl -q, no cookies/token/proxy inheritance, standard TLS verification, no install. Public static text only. Locate exact enclosing syscall functions/permission checks and quote lines; no kernel calls, coalition/process mutation, process scan, official execution, credentials or model/network baseline. Never treat a public source commit as matching current kernel unless exact tag is actually bound. No Mac M3 claim.
