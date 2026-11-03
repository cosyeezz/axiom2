# Mac owner contract — proposed, not executed

The HTTP tap tests calibrate only a self-owned program. This note is independent of the frozen tap source; no whole-tree M3 pass follows from it.

## Useful implementable next fixture

A tiny independent native owner should itself create the fake Node child, retain its waitable identity without other reapers, and own its deadline, pipes and terminal decision. It must not merely receive a PID created by a controller that may reap/die. The higher-level SDK/test driver may stall or exit without stopping the original owner's deadline loop.

- Before spawning: explicitly establish SIGCHLD disposition/no SA_NOCLDWAIT; one wait authority; CreateNew case/output files; minimal env/known executable; descriptor cleanup ownership fixed before fallible work.
- Spawn ordinary fake child with declared unmodified flags and args. Record original create return and PID; child must report same PID. Do not introduce child gating or artificial suspend/resume and call it natural official creation.
- Retain direct child until cleanup decisions finish. Exit-before-registration can still be waitable, unlike unowned PID lookup. A kqueue registration is notification, not a process handle, full tree or descendant inheritance mechanism.
- Close stdin for real EOF; nonblocking output with separate byte totals and bounded buffers; wait for actual pipe EOF, not a release byte or snapshot. Never persist unrecognized output as public evidence.
- Use monotonic deadlines in the independent owner, not a target JS timer, SDK callback, or main driver RPC. Test busy target, blocked driver, early exit, oversized output, late data and interrupted waits.
- Cleanup only original held direct children. Sticky failure survives all late success/callbacks. Require nonempty complete **declared fixture** set, signal/termination results, actual wait status and EOF before considering a candidate.
- Candidate is not authority: the final consumer must retain/wait the owner, require its real exit0, validate its complete artifact/counters and recheck deadline before acceptance. Test final-result/deadline races and owner death; absent/incomplete terminal data is failure, not pass.

## Limits that remain non-negotiable

The original owner protects only its declared direct child. A PID string or previous path/hash does not protect arbitrary grandchildren after their parent reaps or dies. Do not signal an unowned potentially recycled PID based on a prior check. A sibling watchdog is not automatically an original owner.

kqueue fork notifications, PGID cleanup and launchd group behavior do not provide Job-style containment. A fake client with forks denied has a deliberately constrained process set, not a demonstrated solution for ordinary official CLI → Node → MCP/daemon descendants. Coalitions/audit sessions still lack a permitted complete-membership/kill/terminal contract in this investigation.

Owner crash, descheduling or uninterruptible kernel blocking is not a hard real-time guarantee. Record actual observed deadlines and terminal linearization; do not claim an OS-level absolute wall-clock bound from user-space tests. No official/model run is authorized by these partial fixtures.
