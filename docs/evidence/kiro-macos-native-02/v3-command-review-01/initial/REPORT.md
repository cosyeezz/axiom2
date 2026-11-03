# Frozen macOS Command construction — static evidence only

Conclusion: two new-version exact ADRP+ADD clusters locate a WS Command candidate in a 65,652-byte async function and a complete 3,828-byte stdio Command candidate. Resolver outputs flow into program and script argument positions. No natural process creation observation, environment-inheritance proof, or preload feasibility proof.

## Identity, method and bounds
Source `/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-mac-identity-rebind01-vni48j5_/kiro-cli-chat.macho`; 413051920 bytes; full SHA256 7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f independently recomputed. Metadata 2.35.2 is delegated background; local UA referent also contains 2.35.2, not a fresh metadata/signature verification.
ARM slice offset 215023616. Function-start table 197396912/194104B SHA256 b501bc1a04fe6296a2d418b4c2b7d558d393d1e5954180a6d31c12cb63d5a82e independently checked. Sections and all exact anchors/xrefs in manifest.json.
One new linear __text scan (69,216,304B), ADRP followed within five instructions by ADD immediate with matching base register and exact target address. This is syntactic paired-instruction evidence, not global dataflow/call reachability. Scan does not establish absence of alternative reference encodings.
New LC_FUNCTION_STARTS boundaries:
* WS: [0x1016779ec,0x101687a60), 65652B (>24KiB). ONLY [0x10167dc00,0x10167fc00), exactly 8192B, exported/disassembled.
* stdio: [0x10168ce28,0x10168dd1c), 3828B, complete function exported/disassembled.
Offline synthetic Mach-O at original VAs, LLDB --no-lldbinit --batch, no launch/attach. Coverage.json checks exact consecutive 4B PCs: 2048 WS-window + 957 stdio instructions, no unknown directives. Bytes hashes and scripts saved. Existing resolver ASM reused by reference, never re-disassembled. No std implementation expanded.

## Exact xrefs
Const anchors: --experimental-wasm-modules VA 0x108ad9ea6; --transport=ws 0x108ad9ec1; --auth=acp-callback 0x108ad9ecf; ACP_WS_PORT 0x108ad9ee2; KIRO_CUSTOM_USER_AGENT 0x108ad9ef2.
WS ADRP/ADD: ea80/ea84, eaa4/eaa8, eab8/eabc, eb24/eb28, eba0/eba4 (prefix 0x10167).
stdio ADRP/ADD: 0x10168d74c/d750, d780/d784, da00/da04, respectively wasm/auth/UA. No exact WS-port or --transport=ws xref in stdio cluster; its separately consumed token is --transport=stdio.

## Program and arguments
Shared direct targets are inferred Command::new-like 0x102d61610, arg-like 0x102d6142c, environment-insert-like 0x102d5f2a4, from consistent pointer/length and object use. These semantic names are analysis annotations, not original symbols or analyzed std bodies.
stdio calls the already-bound resolver at 0x10168d324, output sp+0x80; d350–d358 unpack two three-word path values. d3b8–d3bc retain first at state+0x128 (ptr+0x130,len+0x138); d48c–d490 retain second at +0x140 (ptr+0x148,len+0x150). Based on existing resolver's Node/server roles: d73c–d744 consumes Node ptr/len as program, returns Command candidate at state+0x10. d74c–d790 appends in order: --experimental-wasm-modules (27 bytes), server ptr/len, --transport=stdio (17), --auth=acp-callback (19 bytes). d794–d7c0 additionally loops over a dynamic vector of 24-byte entries, appending ptr/len arguments. Thus not a fixed complete argv. Native strings are adjacent, non-NUL-terminated ptr/len spans; preserve exact lengths.
WS ea6c–ea78 consumes state+0x588/+0x590 as program; ea94–eaa0 appends state+0x5a0/+0x5a8 as server. ea80–eac8 order: wasm (27 bytes), server, --transport=ws (14 bytes), auth (19 bytes). Referent bytes show adjacent non-NUL-terminated literals with lengths matching tokens. This still does not prove successful spawn.

## Environment and I/O
WS eacc loads u16 port from state+0x5d2, eadc formats it (max buffer 5); eb24–eb40 passes ACP_WS_PORT len11 with allocated formatted value to env insertion on state+0x508. eb78 formatter references `KiroCLI/2.35.2 KAS/… os/… md/appVersion-2.35.2 …`; eb9c/ebbc inserts computed KIRO_CUSTOM_USER_AGENT len22. ebcc–ebec inserts KIRO_TELEMETRY_IS_INTERNAL_AMAZON len33 value `unknown` len7. ec84–ed08 looks up NODE_USE_SYSTEM_CA len18 and inserts `1` only on absent-result branch.
stdio d910–d9c0 has same conditional NODE_USE_SYSTEM_CA=1; d9e4–da14 computes/inserts same UA. d7c4 store byte1 into state+0xd8 and d748 zero into that field are visible, but no type proof equating that flag with env_clear. No evidence sufficient to assert env_clear called/not called, NODE_OPTIONS retained/removed, or preload support. Opaque direct helper calls may affect environment; don't equate absence of NODE_OPTIONS literal with inheritance.
WS ebf0–ec2c updates three consecutive I/O descriptors (+0x48/+0x50/+0x58 relative Command candidate), closes prior variant3 descriptors via 0x104204878, sets discriminants zero, then ec58 invokes async helper 0x1019c9064; edac calls 0x102d65dbc and ee00 passes result into 0x102e32b7c. These are creation/result-handling candidates, not decoded syscalls.
stdio d838–d8dc conditionally sets three descriptors relative Command offsets +0x48/+0x50/+0x58: first two variant2, third variant0 on one branch, variant1 on the other; existing variant3 descriptors are released. Numeric variants are not independently typed as piped/null/inherit. d904–d90c calls 0x10134cb2c and next state invokes 0x1019c9064 (d0c8). --transport=stdio vs WS token and port insertion prove distinct assembly intentions, NOT actual pipe()/socket()/bind()/spawn execution. No pipe syscall body analyzed and no actual child observed.

## Evidence and execution
CWD /Volumes/D_Work/axiom2. All artifacts solely in this unique TEMP. commands-exits.txt retains actual exits (all six stages 0); commands.txt lists invocation commands, scripts preserve exact construction. locate.time: real4.04/user3.91/sys0.04 seconds (not aggregate CPU accounting). No timeout/interruption. No official binary/JS execution, models/network/live/HOME/auth access, installations or repo changes. Remaining: downstream helper types, environment merge/clear semantics, actual stdio/WS creation and natural reachability, all intentionally unverified under scope.
