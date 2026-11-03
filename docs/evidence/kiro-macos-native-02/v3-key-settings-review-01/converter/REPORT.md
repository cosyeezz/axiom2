# Kiro Mac 2.35.2 frozen converter — static proof

Conclusion: key 0x73 maps to `chat.agentEngine` (pointer 0x108c58e00, length 16); key 0x35 maps to `chat.ui` (pointer 0x10482f5e3, length 7). This proves setting-name conversion only, not current execution, UI semantics, effective values, maps, or flags.

Source SHA256: 7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f. ARM64 slice offset 215023616. Full source SHA and LC_FUNCTION_STARTS SHA independently checked.

Actual getter word at 0x101a0f81c is 0x97ee4fc4: signed BL immediate resolves to 0x1015a372c. Consecutive LC_FUNCTION_STARTS delimit [0x1015a372c,0x1015a375c), 48 bytes. All 12 LLDB ASM addresses and words match raw bytes.

Converter computes index=((key XOR 0x80)&0xff)*8. ADRP/ADD decoded directly from words gives length table 0x108c55b00 and pointer table 0x10b8cf9d0. Key 0x73: index 243, byte offset 0x798, length entry 0x108c56298=16, pointer entry 0x10b8d0168=0x108c58e00. Key 0x35: index 181, byte offset 0x5a8, length entry 0x108c560a8=7, pointer entry 0x10b8cff78=0x10482f5e3. Length entries and strings are in new snapshot __TEXT,__const; pointer entries in __DATA_CONST,__const. Raw pointers directly fit sections: no pointer normalization or assumed fixups. Returned registers x0=pointer, x1=length.

Analysis code/data windows total 343 bytes (getter 240 + converter 48 + four entries 32 + strings 23); code <=16KiB and combined windows <=32KiB. Header/function-start metadata and full-file hashing are not disassembly windows. No jump table or further callee expansion.

CWD /Volumes/D_Work/axiom2. Acquisition Python, offline LLDB, and verify.py each exited 0; commands.log records commands. verify.py preserves independent source/hash/boundary/word/table/string verification. synthesize.py preserves synthetic image generation. Initial acquisition inline script was not separately saved; manifest and reproduction/verification scripts retain evidence. No official binary execution, launch/attach, network, HOME/credential reads, model calls, or repository edits. LLDB used no-init, no dependents, and a new empty HOME. No dynamic tests run.
