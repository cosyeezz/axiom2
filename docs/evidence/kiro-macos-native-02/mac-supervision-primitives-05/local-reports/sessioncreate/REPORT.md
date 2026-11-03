# SessionCreate local documentation review

## Conclusion
Local launchd.plist(5) explicitly documents SessionCreate=true as spawning a job into a new security audit session instead of its context's default. This is a documented configuration candidate for an owned user LaunchAgent, NOT proof that this caller/context is authorized or that the running macOS implements it as described. The entry states no root-only restriction, but absence of a restriction is not affirmative permission evidence.

Neither source establishes a non-escapable descendant container, session-wide automatic kill, complete authoritative membership enumeration, or an empty-set completion barrier. Do not promote this to Job-equivalent M3 supervision.

## Exact local evidence (original source line numbers)
launchd.plist.5:769-773:
.It Sy SessionCreate <boolean>
This key specifies that the job should be spawned into a new security audit
session rather than the default session for the context is belongs to. See
.Xr auditon 2
for details.

AuthSession.h:46-48:
The Security subsystem separates all processes into Security "sessions". Each process is in
exactly one session, and session membership inherits across fork/exec. Sessions form boundaries
for security-related state such as authorizations, keychain lock status, and the like.

AuthSession.h:152-163:
@function SessionCreate
This (very specialized) function creates a security session.
Upon completion, the new session contains the calling process (and none other).
You cannot create a session for someone else, and cannot avoid being placed
into the new session. This is (currently) the only call that changes a process's
session membership.
By default, a new bootstrap subset port is created for the calling process. The process
acquires this new port as its bootstrap port, which all its children will inherit.
If you happen to have created the subset port on your own, you can pass the
sessionKeepCurrentBootstrap flag, and SessionCreate will use it. Note however that
 you cannot supersede a prior SessionCreate call that way; only a single SessionCreate
call is allowed for each Session (however made).

Quotes above remove header comment indentation only; raw rg excerpts preserve formatting.
At 178-180 the header lists invalid attributes, attempted session re-initialization and invalid flags errors. A one-creation-per-session statement must not be reinterpreted as an immutable-membership enforcement contract. The same description explicitly discusses changing membership, but does not establish which already-initialized contexts permit subsequent creation, nor current audit-session migration permission checks.

## Boundaries / known vs unknown
- KNOWN DOCUMENT TEXT: launchd key requests new security audit session; SDK security-session membership inherits fork/exec; SessionCreate initially contains caller only.
- UNKNOWN: equivalence of launchd key implementation to this header API, security-session vs audit-session exact relationship, current kernel enforcement, ordinary user LaunchAgent acceptance/permissions, descendant migration restrictions, completeness/atomic enumeration, bulk kill and empty-set guarantee. Header:56-58 cautions related session concepts are not necessarily completely congruous (graphics example); do not silently conflate names.
- No session-wide kill/empty-set contract appears in the focused SessionCreate passages. This is not a universal absence claim across all Apple documentation.
- PGID cleanup at launchd.plist:609-613 is a different mechanism, not new evidence of session cleanup. Prior audit END findings are background only; no repeated END test or stronger inference.
- AuthSession.h resolves to MacOSX13.3.sdk; not evidence of current kernel/API permissions. launchd man date/OS build not independently queried. SecuritySessionCreate* man3 not found in exact local glob; SDK header names API SessionCreate, not SecuritySessionCreate.

## Collection / reproducibility
Working directory: /Volumes/D_Work/axiom2.
Read-only installed inputs: 2 files, 33172 + 7865 = 41037 bytes; each below 128 KiB. No network, launchctl, Security API, target/model execution, process scan or source/config modifications. Files written only here.
manifest.json records absolute input paths, resolved SDK path, full SHA256, exact rg argv, exit codes and excerpt names. Both rg calls exit 0. Python collection wrapper exit 0; measured collection wall 0.018 seconds; RLIMIT_CPU=10, tool timeout=15 seconds. No tests/builds run. No further installed files read after this bounded collection.
Initial discovery shell: pwd; printf '\nTEMP=%s\n' "${TMPDIR:-/tmp}"; ls -d docs/evidence/kiro-macos-native-02/mac-containment-review-01; ls /usr/share/man/man5/launchd.plist.5* /usr/share/man/man3/SecuritySessionCreate* 2>/dev/null
Exit 1: launchd.plist.5 found, SecuritySessionCreate* missing. Missing name is not universal API absence. Shell ls discovery does not read document contents.

## Prior evidence reused, not a new result
/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-containment-review-01/sdk/RESEARCH.md
SHA256 50bbd675a430419ad1cc7ea3499758bd9ca3f8c246f4857eb5068439b7429f76
This prior report records PGID/audit-END limits. No claim of fresh verification of those older findings.

## Recommendation to main agent
Retain SessionCreate as a documented isolation-context candidate only. The separately planned public-source review must bind version and determine launchd create path, permission/migration checks, and any actual membership/kill/terminal contract; this report supplies none of those implementation conclusions. No request for user authorization or unbounded investigation.
