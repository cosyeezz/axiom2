# Window01: parameter metadata and field construction, not catalog JSON

## Result

The two bounded functions are now useful **parameter-side** evidence. Neither provides the native model-catalog JSON schema or proves the `--list-models` execution/early-exit path. The next relevant gap is a consumer of the constructed parameter object, not the implementation of generic lookup/allocation helpers.

Inputs remain Kiro2.35.2 ARM64, bound by [extraction](EXTRACTION.md). No official program/model request was executed, and no provider was changed.

## Static LLDB evidence and preservation

| Label | Held LLDB PID/exit | EOF/fault | Saved stdout | Word positions | Before-publication seconds |
|---|---|---|---:|---:|---:|
| format |24529/0|both true/null|10695B|162|3.554657833|
| field |24525/0|both true/null|77210B|1229|3.773248334|

stderr0 for both; directive/unknown lines0. Each LLDB was invoked once, with only no-init, no-dependents ARM64 target-create and exact-range disassembly. Both permanent LLDB gates are consumed: **do not rerun**.

Matched results: format t11859/r11862, field t11860/r11861. The controlling tool did not separately expose its numeric process exit in those task reports; owner self-report0 is retained separately from **unknown actual owner tool exit**. Held LLDB exit0 and true EOF are in the original metadata. This is not an independently validated final-owner protocol for real-auth observation.

Main read all eight metadata files, then performed artifact-only audit: frozen runner before/after/current12530B/SHA256 `9aae1885ae8f78c5218a5e394d4721e8aa39db89610df4e00c331705fe37ab18`; input copies equal extraction inputs; independent full address/word roundtrip; exact banners, commands, six configured env keys, counters and consumed gate bindings. No original target reread or LLDB rerun. Sixteen originals were copied exclusively and compared byte-for-byte, regular0400/currentuid. See [format audit](lldb/format/AUDIT.json) and [field audit](lldb/field/AUDIT.json).

Own bytes observed before publication:177213/185743; main observed final totals190034/265083. These are below1MiB, not peak-use or OS-hard-quota evidence. Actual LLDB environment/rlimits were not enumerated. Success/direct-child results do not establish startup, fault, timeout, cleanup or descendant guarantees. [Parser validation](LLDB-GATE-VALIDATION.md) is a separate limited10-case synthetic check, not native semantics.

## Format range `[0x10148f068,0x10148f2f0)`

Main read all162 instructions of [format assembly](lldb/format/assembly.txt).

- `f078` saves entry x0 as x19, the explicit output destination.
- `f07c–f088` selects by w1 low8 bits:0,1,other. It does **not** establish that every other value is valid at runtime.
- The three paths build stack-local data, call `0x1041760ec` with fixed length31/27/40, and copy fixed bytes into the resulting buffer. This external callee's exact symbol/type/side effects are not established.
- Branch0 uses name pointer `0x10482a982` and description pointer `0x10482a987` (31 bytes); their complete bytes are outside the already retained context. Do not infer literal `plain` or its entire description from help order.
- Branch1 copies27 bytes from `0x10482a9a6`: **`Outputs the results as JSON`** (`f0f0–f108`). Its name pointer is `0x1047b14b0`, whose bytes were not read here.
- Other branch references `json-pretty` at `0x10482a9c1` (`f1fc/f200`) and copies40 bytes from `0x10482a9cc`: **`Outputs the results as pretty print JSON`** (`f260–f278`).
- Common `f138–f14c` copies80 bytes to x19; `f150–f15c` restores and returns. This is visible fixed description/option-object construction, **not evidence of serializing model records into JSON**. Exact Rust/clap type and exception-tail reachability remain unknown.

The two complete descriptions and json-pretty name were checked against the existing locator's96B public context only; [FORMAT-CONTEXT.json](FORMAT-CONTEXT.json) records addresses, lengths and missing coverage. No new target bytes were requested.

## Field range `[0x1014c6ee8,0x1014c821c)`

Read-only review t11863/r11864 was consumed; main checked the entry, both references, the result-store block, and the normal/special-path epilogues against [field assembly](lldb/field/assembly.txt). Reviewer input/time budgets were specified, but actual total reads/whole-author time were not independently measured.

- `6f08/6f0c`: x24=entry x1; x23=entry x0, the result destination.
- `75c4/75c8`: x2=`0x104826e78` (`list_models`). `75cc–75d8` calls `0x100ea9ea0` with x0=sp+0x1d0, x1=x24, x2=key, w3=11.
- `75dc/75e0` constructs the same key in x0. `75e4–75ec` calls `0x100ea985c` with x0=key, w1=11, x2=sp+0x1d0. These are two uses in one lookup/conversion-shaped chain, not two catalog outputs. External names and language types remain unproved.
- `75f0/75f4` masks returned w0 to8 bits and saves it to sp+0x48. `75f8/75fc` tests the special value2. Do not name2 as missing/error/Boolean enum without a callee contract.
- On the path passing this and subsequent checks, `7f10` loads w12 from sp+0x48; **`7f18` writes w12's low byte to `[x23+0x131]`**. Adjacent `+0x130` uses the separate value from sp+0x4c. `7f68→7060` restores and reaches `707c ret`.
- The value2 branch calls `0x100ea8a00` at7610, then `76d4/76d8` writes tag `0x8000000000000001` plus returned x0 to the start of x23. Visible cleanup paths lead to the epilogue or a tail branch, rather than the normal +0x131 store. External nonreturn/exception behavior and complete CFG are not proved.

The evidence supports a parameter-field construction candidate and supplies a concrete byte offset to follow. It does not establish CLI dispatch, JSON root/field names, source/cache freshness, `deepseek-3.2` availability, authentication, outgoing requests or server receipt.

## Next boundary

Do not expand generic helpers `0x100ea9ea0`, `0x100ea985c` or allocation/cleanup routines merely to name a Rust type. First locate bounded direct incoming branches to the now-identified field-construction entry, under a **new** experiment with fixed target, cap and single-use gate. Inspect any resulting small caller only after assessing its range; no automatic expansion of the41012B registration function, full call graph or Ghidra analysis. Parent native-catalog investigation remains incomplete.
