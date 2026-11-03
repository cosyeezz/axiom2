# Read-only callee investigation (2.35.1 arm64)
Target: official kiro-cli-chat; identity inherited from repository static-locate-01/locations.json. No new full-file hash. Function-start table SHA256 verified.

## Proven machine-level observations
Function [0x1018951d4,0x101895fc8), 3572 bytes. Full-file range [240800212,240803784). Entry matches LC_FUNCTION_STARTS. See identity/verification.json for SHA256 and decoding equality.
Entry x0 is output pointer, preserved in x19; x1 input record in x22; x2 context in x24. These are instruction-level roles, not recovered Rust source types.
Selection order, after preliminary work and context lookup:
* 0x101895354 reads input+0x136 bit0. Set => w26=2, w24=0, jumps 0x1018958e8.
* Otherwise 0x10189539c reads input+0x137 bit0. Set => w26=0,w24=0, same join.
* Otherwise 0x1018953b0 reads input+0x13e. If !=3: selects that byte, w24=0, joins. If ==3: selects 2 only if earlier-computed w27 bit0 is set, else proceeds to later context-string/fallback paths. Meaning of w27 and fields not recovered.
* Context lookup at 0x10189531c-324: x0=context+0x10,w1=0x73, BL 0x101a0f800. Returned payload is copied if accepted. This is NOT proved chat.agentEngine; numeric key identity/helper body unexamined.
* If later context string is absent, BL 0x101894f90 at 0x101895728; use x0 as w26 and x1 as w24. Invalid context string calls same fallback at 0x1018958dc, then w24=1. No inspection of this additional function.
* Case-insensitive context parsing: v3 or kas => w26=2 at 0x101895840; v1=>1 at 0x1018957cc; v2 or rust=>0 at 0x101895cdc. These mappings follow byte compares and assignments, NOT guessed source enum declarations. Context provenance remains unknown.
* Validation can emit error. Normal stores 0x101895c04-c0c: output[1]=w26, output[2]=w24, output[0]=0. Error stores include 0x101895bc4-bcc: output pointer at +8, output[0]=1. Meaning of output[2] not assigned.

## Existing caller connection (no re-disassembly)
512-byte assembly-address window [0x1019aab00,0x1019aad00) extracted from frozen saved.asm, no target caller bytes reread.
0x1019aab6c x0=sp+0x5a0; 0x1019aab70 x1=sp+0x1a0; 0x1019aab74 x2=[sp+0xd0]; call 0x1018951d4 at 0x1019aab78.
0x1019aab7c-84 checks output[0]==1, error path bypasses interpreting output[1]. Non-error reads output[1] at 0x1019aaba4, cmp 2 at 0x1019aabb0. Equality skips saved-V3/other-engine warning (branch 0x1019aabc0 to 0x1019aac18). Otherwise warning uses exact previously verified literal.
Caller 0x1019aab5c-68 conditionally writes 3 to sp+0x2de, exactly input+0x13e; upstream condition source not recovered.

## Limits
No source type/flag-name binding for offsets 0x136/137/13e; no identity for context key 0x73; no stored/default fallback implementation inspected. Thus flags vs stored/default precedence and this user's effective session engine remain unknown. No engine-enum declarations guessed. Mappings above are bounded parser/output dataflow facts.

## Commands/results and budgets
cwd /Volumes/D_Work/axiom2.
/usr/bin/python3 - <<'PY' (boundary parser): exit 0; table 194096 bytes, SHA verified, no source edits.
/usr/bin/python3 - <<'PY' (single 3572-byte function read, unchanged bytes/original-VA synthetic Mach-O creation and frozen caller ASM extraction): exit 0.
HOME=/var/empty /usr/bin/lldb --no-lldbinit --batch -o 'target create --no-dependents --arch arm64 /tmp/kiro-engine-callee-ro-txu_yhcx/callee.macho' -o 'disassemble --bytes --start-address 0x1018951d4 --end-address 0x101895fc8': exit 0, output callee.asm.
Final verification Python: exit 0 if reported by tool; checks all 893 instruction addresses contiguous and instruction words equal original window bytes. No prior saved/setting windows re-disassembled; one new function only. No launch/attach, original target loaded into LLDB, model/network/HOME/credentials access. LLDB target was synthetic TEMP only. Per Python resource CPU hard limit 30s for acquisition. This is static analysis, not a test run or runtime effective-engine evidence.
