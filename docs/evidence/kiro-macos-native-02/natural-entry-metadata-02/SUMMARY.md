# Metadata02 — public binder argument defect; no official invocation

The unique bind_public.py call returned tool exit1/0.2s at fixed phase signature. PUBLIC_IDENTITY_ONCE is consumed; no PUBLIC-IDENTITY.json was published, no help/list/model invocation occurred. The signature child numeric exit was not preserved, so do not invent it or call this a failed signature of the application.

Cause found by inspecting the local system manual `/usr/share/man/man1/codesign.1` lines599–610: -R treats a plain argument as a file path; literal source must start with `=`. This binder omitted the `=` and therefore did not perform the intended requirement check. This is an agent-authored preflight defect, not evidence of a broken/untrusted CLI. The consumed source is retained unchanged.

A distinct public `codesign --display --verbose=4` observation (not repeat verify) returned display exit0 for each executable, Team94KV3E626L and authority-present. CDHashes launcher5d7fcb9f14eb1b2198155109ebc23542ee3ae50d / chat885ec8d6eeabf6c39cefa7bb34603a471edfd529. Tool exit0/0.1s; unknown display lines were not persisted. This display does not replace verification. RAM output was postchecked≤8192B, not a hard receive cap; it contained public signature metadata only, not application/request output.

Replacement metadata03 changes the requirement argument to an explicit literal per the manual, records signature child exits even on failure, and keeps the same limited2.36.0 scope. No old gate/main is retried and no account/store/global policy access or change is introduced.
