# Request sender probe01: official command interface only

## Question

Does the currently installed, byte-bound Mac Kiro CLI expose a non-interactive/model/engine command interface suitable for a later request-only comparison? Capture one official `chat --help`; do not infer an actual sender/API, model availability, authentication success or request parity from help.

## Inputs and scope

Only the public installed launcher/chat Mach-O files are read and hashed. Expected frozen2.35.2 identities: launcher73432992B/SHA8e242d795f93a70bc4497907d9aaf2d1552a07ee8a7a86e0276af6cf55672fd2; chat413051920B/SHA7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f. A mismatch stops before execution; never apply old offsets or guess the new version. No signature/extraction/old-suite reruns.

The single child command is `/usr/bin/sandbox-exec -f <own profile> /Applications/Kiro CLI.app/Contents/MacOS/kiro-cli chat --help`. Own HOME/TMPDIR/CWD and a minimal environment; no token/proxy/NODE_OPTIONS inherited. Sandbox denies network, real HOME reads, global writes and mach-lookup; exec is restricted to the official launcher/chat paths. No model prompt, real settings/credential read, Keychain export, extracted JS execution or global modification. Existing fake-only observers are not used.

## Budget and lifecycle

New `results` directory and files use CreateNew. One new own TEMP namespace; one held child, stdin DEVNULL. Parent CPU10s/wall30s/NOFILE64; child CPU2s/wall5s, per-stream64KiB (combined128KiB); result files total <=2MiB. A timeout kills/reaps the held direct child, without claiming whole-tree containment or absolute hard-real-time cleanup. Ordinary files are not pipe EOF evidence. No automatic retry or optional follow-up execution.

## Acceptance and failure

Save preflight before execution. Capture actual command, held PID, exit/timeout, unchanged raw help streams, input hashes and post-path/stat checks. Successful help must exit0 without timeout and return UTF8 usage text. Immediately read all saved main/preflight/manifest/raw streams. This is only a command-interface result; actual sender, credentials, API/feature selection, real requests and parity remain unknown. Failure is retained under this case; any recovery requires a new hypothesis/case, not an unchanged retry.

The original model target remains exactly `deepseek-3.2`; this help probe makes zero model requests. No coalition, launchd, service or abandoned-branch work.
