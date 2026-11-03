# Conclusion
key0x73 is NOT yet proven to be chat.agentEngine. The new actual lookup converts the numeric key using BL 0x1015a372c (not expanded), then queries three maps. Fallback is not a universal constant and is distinct from current effective engine.

## Identity
Source /var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-mac-identity-rebind01-vni48j5_/kiro-cli-chat.macho; 413051920B; full SHA256 7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f; arm64 slice offset215023616.
Rehashed complete source. Reparsed function table sliceoff197396912/194104B, SHA256 b501bc1a04fe6296a2d418b4c2b7d558d393d1e5954180a6d31c12cb63d5a82e. Existing callee 3572B matched source exactly, SHA256 407417503acd0c3559a4f9d0e425292619173bf7c2a0a97429d925f9bb18f650. Its actual BL at 0x101895324 decodes lookup 0x101a0f800; actual BLs at 0x101895728/8dc decode fallback 0x101894f90. New table bounds both exactly (no old-address boundary reuse).

## New ranges
lookup [0x101a0f800,0x101a0f8f0) 240B, sliceoff27326464, SHA256 68635fb98af78513e88599195c055f4dc67eee3820597743123fd5f42b2c0108.
fallback [0x101894f90,0x1018951d4) 580B, sliceoff25776016, SHA256 5e5f529429bafea701fe8b9bad7fc67a91e54a4018f27c9e4b1319c614ce6dc3.
Total820B. LLDB synthetic-only, 60+145 instructions; exact bytes, contiguous, no gap.

## Lookup and fallback
Lookup receives context+0x10/key0x73, calls key-to-(pointer,length) helper 0x1015a372c. Searches object+0x48 first; conditional object+0xa8 second (gated by helper0x101a0f5f0 and sentinel); object+0 last. Returns entry+0x18 for 0x68-byte entries, or NULL. Neither map source names nor key string established here. No enum/flag naming inferred.
Caller accepts value tag 0x8000000000000003 and copies string; missing/wrong type become absent sentinel. Absent invokes fallback at728 and preserves both return values. Unrecognized string invokes fallback at8dc, uses x0 but forces output provenance byte w24=1; therefore absence and invalid string are NOT identical provenance paths.
Fallback (w0,w1): w2==0 or input+0x12c bit0 ->(0,3); else input+0x134 bit0 ->(0,2); else +0x135 bit0 ->(1,2). Otherwise references literal KIRO_CHAT_UI (actual ADRP+ADD ->0x108ad70e8,12B in new section) through unexpanded helper0x102d579ec and parser0x102364d80. Accepted text compares ASCII-case-insensitive tui =>0, other text=>1, second value2. Missing/unsuitable initial read can proceed to context+0x10/key0x35 lookup; missing/wrong type ->(0,3), accepted empty->(1,2), accepted nonempty tui->(0,2), other->(1,2). Negative length is a failure path, not a default. Environment API semantics remain unexpanded, so literal binding does not by itself prove an actual runtime env read.

## Execution/limits
commands.log includes actual commands and exits (all0). No launch/attach/bundle/JS/network/auth/live HOME; repository unchanged. New referent budget12B, section checked. Third helper deliberately not expanded: key0x73->chat.agentEngine remains unresolved; follow converter in a separately authorized bounded task. Flags/map origin, helper semantics and effective engine remain unknown. Static inspection only, not runtime tests.
