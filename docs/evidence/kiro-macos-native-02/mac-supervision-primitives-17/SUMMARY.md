# Case17 one static callback-argument site

**One main exit0 and one otool exit0** captured the containing function **`[0x10001f25c,0x10001f2c4)`**, 104 bytes /26 contiguous word addresses, no unknown-opcode rows. The local evidence shows the case11 wrapper address is signed with `PACIZA` and passed in **x4 to `0x1000139b8`**. It does not establish that the callee invokes it, that this path runs, or that the caller owns/controls any coalition.

[Experiment](EXPERIMENT.md) · [source](capture_containing_function.py) · [preflight](results/preflight.json) · [full manifest](results/manifest.json) · [original function bytes](results/function.bin) · [nonexecuted carrier](results/function.macho) · [original disassembly stdout](results/disassembly.stdout) · [empty tool stderr](results/disassembly.stderr) · [main stdout](main.stdout) · [main stderr](main.stderr) · [exit0](main.exit) · [own namespace](main-workdir.txt).

## Local instruction facts

- x19 saves incoming x0; `BL 0x10000f50c` supplies an as-yet unidentified x0 result.
- x1/x2 load from `[x19+8]`/`[x19+16]`; w3 loads from `[x19]`. No source-language type, CID ownership or security meaning is assigned to those fields.
- At `0x10001f27c/0x10001f280`, ADRP+ADD forms **`0x10000f60c`** in x16.
- At `0x10001f284/0x10001f288`, `paciza x16; mov x4,x16`; the next instruction **`BL @0x10001f28c -> 0x1000139b8`** passes that signed address as x4.
- Other direct callees `0x10000f50c`, `0x10001ee40`, `0x10001184c`, `0x10001c034` were not expanded. No automatic callback/caller/callee closure.

This is a static function-pointer argument site, not proof of callback invocation or runtime reachability. A separate future bounded question could distinguish whether `0x1000139b8` calls or merely stores x4 and what conditions guard it. No conclusion about caller authorization, host zeroID behavior, coalition create/root-only gates, bootout permission, full-descendant kill/drain or M3 follows.

## Binding and verification limits

Driver SHA256 `6ae56ce8795407c4d8870fe7325e0c174e2e3cec7c9ce1c8bd4643f7b0d6c744`. It selected AST-only case10 `signed/parse/make_carrier` plus identity constants from helperSHA `d0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608`, without module import/main or old128/57 test reruns. The original [case16 manifest](../mac-supervision-primitives-16/results/manifest.json) and40B raw context were checked against the frozen snapshot before selection. Function starts bound both address-forming words; the8192B size gate preceded the single disassembly.

Same08 snapshotSHA `7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09`, ARM64eUUID `3FEC147A-7931-3FCD-BDB9-59C9A814779C`, slice offset622592 / SHA `fe9a1562d360e15c86937153586ca8778ee72bd95de423415ec780ebde9c0102`. Whole body offset750172 / SHA **`f1b1bb0c5dc5961f8a72e7d1bf91fd988e4daead652d8b763aca32f77d0fa282`**. Synthetic MH_OBJECT is288B / SHA `b9a28ca315a0304000fb73bd6ad61b6b4a61f92c64d736c6c39a0dc5e27d4e99`; it was not executed. Tool stdout997B / SHA `8c1fbaea524c4c97499b048b6c8cfd2cf02bfa6426e5b1ba5003cffec3d1c2e0`.

Held otool PID55396, exit0, timeoutfalse, wall0.024860375s, stderr0B. ParentCPU8/9/alarm20/outer30; childCPU2/3/wall5/NOFILE64/FSIZE512KiB. Minimal own HOME/TMP/PATH, no token/proxy/DYLD inheritance. Ordinary streams after held-child exit do not prove pipe EOF, all tool descendants or OS hard-realtime deadlines. Contiguous addresses/no unknown opcodes are not complete CFG/LSDA, callee semantics, live PID1 identity or runtime proof. The dyld_info shim was not called or repaired; installation UI state remains unknown.

## Case16 independent evidence retained

[Full93-check report](prior-readback/REPORT.md) · [all checks](prior-readback/checks.json) · [commands](prior-readback/commands.txt) · [independent decoder](prior-readback/decode.json) · [input hashes](prior-readback/input-SHA256.json) · [artifact inventory](prior-readback/artifact-SHA256.json) · [preservation](prior-preservation.json).

The matched independent task verified actual frozen whole/slice/UUID, the complete limited-mode text scan and exact x16 decode, original case16 streams, and22 new copies of the earlier document audit. **93/93 final checks /exit0**, not93 new format vectors. The initial TEMP verifier mistook two Python expressions for Markdown links (93 PASS/2 FAIL/exit1); only that verifier was corrected. All original failures and final artifacts were preserved: **22 files /67,083B**, byte/SHA/0400/readback; no old verifier/main/otool/tests rerun by retention. This historical audit does not cover subsequently created case17 files. **Coalition control calls0; real model requests0; native/server parity and Mac M3 remain unproved.**
