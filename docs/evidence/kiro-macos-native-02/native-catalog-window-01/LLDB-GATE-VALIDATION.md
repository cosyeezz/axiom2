# LLDB output gate: limited synthetic validation

The one planned main-authored parser check ran exactly once:

`/usr/bin/python3 -I -B /Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/native-catalog-window-01/check_lldb_parser.py`

Tool returned normally with timeout10; its numeric process exit was not separately retained. Fixed stdout `synthetic-parser-pass`, **10 named parser calls / 10 case assertions**. Source/setup guards are excluded from that assertion count. This is one Python process, not10 processes or any native-code execution. Permanent LLDB_PARSER_ONCE consumed; do not rerun.

[Result](LLDB-PARSER-RESULT.json) was fully read. It records Python3.9.6/darwin, actual CPU2/3, CORE0/0, FSIZE65536/65536, NOFILE32/32. Inherited environment was not enumerated; no independent held PID/EOF record or whole-author/worker-wall measurement. No actual target/input binary or LLDB access occurred in this check.

## Bound sources and cases

- Frozen runner `disassemble_once.py`:12530B/SHA256 `9aae1885ae8f78c5218a5e394d4721e8aa39db89610df4e00c331705fe37ab18`.
- Checker `check_lldb_parser.py`:5037B/SHA256 `76fa428c650f0f63de145505a41fd888aa4d298d0b1fe0909c3d48a26a5dd2a8`.
- [Readiness](LLDB-READINESS.json) records prior AST/binding-only0, both hard-coded input bindings matching extraction metadata, extraction gate already consumed, and the parser/two LLDB markers absent at that pre-execution point. That old absence is not permission to replay any subsequently consumed marker.

The checker AST-extracted only `validate_assembly`; it did not import the owner. Positive162-word and1229-word cases are RAM-only repeated NOP bytes and synthetic LLDB-shaped lines. Negatives: wrong word, wrong address, missing line, extra line, changed banner, non-ASCII,193-char argument,262145B output. Source unchanged before/after. The result supports these exact format checks, not all ARM64 renderings or every invalid schema.

The actual runner separately requires held LLDB exit0, two observed EOF, no capture fault, empty stderr, exact command/path banners, and all addresses/words matching the verified binary before any assembly is saved. Directive/unknown mnemonic lines are counted separately; complete word roundtrip is not executable reachability or CFG proof. Output is public program evidence, never real-auth capture.

## Current execution boundary

Both independent single-use LLDB tasks have now completed and their matched results were consumed: format `t11859/r11862`, field `t11860/r11861`. Main checked the original metadata, independently verified every address/word, and preserved16 originals byte-for-byte. Held LLDB processes24529/24525 both have actual exit0, two true EOF and no capture fault; their controlling tool's numeric exit was not separately exposed (owner self-report0 is not a replacement). See [SEMANTICS.md](SEMANTICS.md) and the two artifact audits for results and limitations. Both permanent markers are consumed; neither command may be rerun. No LLDB task remains active.

No Ghidra, larger function, official-client launch, auth/state access or model request is justified by this validation. Constructor, startup, signals, real stream faults, timeout/kill/reap failures and publication failures are not newly independently tested. Own static FSIZE limits must not be used with normal application state. The native catalog grammar and request parity remain unproved.
