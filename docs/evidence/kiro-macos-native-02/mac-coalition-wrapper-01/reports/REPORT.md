# Coalition syscall wrapper: blocked by connection timeouts

## Conclusion
No source was obtained. This experiment establishes no authorization or termination semantics. In particular, it cannot distinguish privileged-coalition membership from UID/root authorization, locate the enclosing wrapper/line numbers/call arguments/return codes, or determine whether create/terminate/reap differ from killall. No host UID 501 permission or Mac M3 full-tree containment claim is supported.

## Scope and version
Working directory: /Volumes/D_Work/axiom2. Formal scope: docs/evidence/kiro-macos-native-02/mac-coalition-wrapper-01/EXPERIMENT.md (read before execution).
Target: apple-oss-distributions/xnu tag xnu-12377.161.14, bsd/kern/kern_proc.c.
The exact-tag request failed before receiving any HTTP response. This does not show that the tag or file is absent. The allowed commits/main fallback also failed; no 40-hex commit was obtained and the conditional pinned-file request was NOT attempted. No source version was bound to the running kernel.

## Actual execution and preserved evidence
Two curl GET attempts; zero observed HTTP responses. Each ended with curl exit 28, reported http_code 000 (not an HTTP status), and a connection timeout after approximately 5.01 seconds. Each response body and headers file is empty (0 bytes), not a 14-byte 404 body. Full stderr, exact command, body, headers and per-request JSON are retained. Body SHA-256 for each empty file:
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

1. 01-exact-tag: https://raw.githubusercontent.com/apple-oss-distributions/xnu/xnu-12377.161.14/bsd/kern/kern_proc.c
2. 02-main-commit: https://api.github.com/repos/apple-oss-distributions/xnu/commits/main

Network harness: fetch.py; actual invocation was python3 "$CASE_DIR/fetch.py" from the working directory. The enclosing bash invocation and harness exited 0 because evidence recording completed; this is NOT download success. Actual curl exit codes remain 28, 28. Full curl argument vectors rendered with the exact minimal environment are in *.command.txt. Child stdout was the bounded body pipe; stderr was redirected to *.stderr. Headers were written to *.headers. manifest.json records durations, exact URLs, limits, outputs and hashes. Total fetch harness elapsed: 10.044581 seconds.

Controls: fresh mktemp CreateNew directory under /private/tmp; exclusively created artifacts; own HOME and TMPDIR; curl -q; env containing only HOME/TMPDIR/PATH/LC_ALL; no inherited proxy/cookie/auth settings; --noproxy '*'; standard TLS verification; HTTPS only; no redirect following; 5s connect / 10s wall / 512KiB response cap; CPU soft/hard limit 10 seconds inherited by curl; no retries. No third request without a valid pin. No repository modifications, dependency installs, kernel or official program execution, coalition/proc control, process scans, credentials, or real HOME reads.

## Stop and recommendation
Stopped after fallback failure, without retry, alternate tag/path, dependency traversal, or any additional network request. The wrapper permission and terminate-versus-kill question remains UNVERIFIED. A subsequent task would require separately authorized access to the exact source; do not treat this failed run as a reason to reopen the exhausted old case or infer any source semantics.
