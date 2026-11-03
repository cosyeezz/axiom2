# Bounded ABI and permission-internal source closure

At the already acquired public commit **f6217f891ac0bb64f3d375211650a4c1ff8ca1ea**, the real `bsd/kern/sys_coalition.c` checks privileged-coalition membership before CREATE/REAP/TERMINATE. Need exact user ABI/constants and the limited permission/ID/termination internal semantics before even considering a no-side-effect self-owned capability query.

Fetch exactly these known same-pin paths (no search/recursion/other dependencies):
1. bsd/sys/coalition.h;
2. bsd/sys/coalition_private.h — both actual includes of acquired wrapper;
3. osfmk/kern/coalition.c — already known prior mutable-main file, now independently bind same pin and compare existing bytes; inspect only relevant named routines, not allocator/std/kernel closure.

At most3anonymousGETs, body<=1MiB each,8s browser timeout; own UUID background blank tab via documented URL-omitted creation, exact returned pageID/blankcheck/evaltarget, credentialsomit/no-referrer/no redirects. Same45s fetch+10cleanup/60alarm/CPU15/CLI12s/streams2MiB/24MiB evidence limits and [03nonexecution constraints](../mac-supervision-primitives-03/EXPERIMENT.md). Stop at observed failure without retry or alternate path. Preserve exact command/scripts/HTTP/complete/cap/bodyhash/cleanup.

**Static only:** no coalition/audit/control syscall, no creation/migration/termination/reap, no scan of unrelated processes, no credentials/Keychain/TLSkey inspection or global changes, no official/KAS/import/model. Reserved-ID/invalid-operation ideas are not authorization to call an unbound ABI: only assess whether a later safe typed self-owned query can even be specified. NULL create output is specifically unsuitable: acquired wrapper allocates before copyout, so EFAULT may leave a reference. Public pin is not hostkernel12377.161.14; do not silently transfer permissions/ABI/empty/full-tree guarantees to the host.
