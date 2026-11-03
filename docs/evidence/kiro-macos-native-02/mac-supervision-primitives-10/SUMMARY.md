# 10 — bootout literal's direct function

## Result and binding

One static main exited0 (~0.1s), using only the permanent [08 shipped launchd snapshot](../mac-supervision-primitives-08/capture/launchd.snapshot): full1236160B/SHA `7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09`, arm64eUUID `3FEC147A-7931-3FCD-BDB9-59C9A814779C`, slice622592/613568B/SHA `fe9a1562d360e15c86937153586ca8778ee72bd95de423415ec780ebde9c0102`.

Two limited adjacent ADRP+ADD xrefs at `0x100030e20/0x100030f1c` refer to `service bootout (%s)` VA `0x100067a3b`. Both lie in one LC_FUNCTION_STARTS interval **[0x100030d84,0x100030fb8),564B/141instructions/0gap**, bodySHA `6e81374bc1eaf31361c840c4e3c39f1776ac33aa067ed6888dfdfe136696c976`. That direct function has **no B/BL to the resolved coalition_terminate stub0x100058988**. It does have indirect branching and other callees. This is not absence of transitive/indirect calls, runtime bootout, kill/drain, permissions or Mac M3.

[Manifest](results/manifest.json), [full raw ASM](results/01-function.stdout), [stderr](results/01-function.stderr), [nonexecuted synthetic carrier](results/01-function.macho). One otool -arch arm64e -tvV, original heldPID38399/exit0/no timeout/stderr0. Streams are regular files, not pipe EOF/full-tree proof. Carrier748B/SHAfa483fb9ac1403cb8c6b1fa1ef3ef88846d5ff357b5c371bb0ae2ddaff5883eb, ASM4863B/SHAd605b10dd59ae9d99ab74b30e6638ff5ab12fa80c1d5b492195fc7c42bb466bb. Main did not execute launchd or any target/control/model.

## Why this replaces failed09 without washing it green

[09 failure](../mac-supervision-primitives-09/SUMMARY.md) remains 126/128PASS+2FAIL, no09main. New [source](locate_bootout.py) SHA `d0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608` fixes only discarded ADR/ADRP rd31 vs SP dependency and ordinary64-bit ADD mask0xff800000. Bit23 rejection does not assert a particular instruction's allocation/extension.

Independent t11337/r11338 SystemPython3.9.6: unchanged original128 oracle **128/128PASS**, focused57 **57/57PASS**, each once/exit0; source frozen, reverse-delta module AST unchanged. These overlap: **not185 independent coverage**, not added to old09 passes. [Full independent report](pure-tests/REPORT.md), [inventory](pure-tests/SHA-manifest.json), [permanent17file preservation](pure-preservation.json), [failed09 preservation](failure-preservation.json). 17files75247B and failed09's10files44072B were byte/SHA/readback checked and made0400; no TEMP-only originals. Preservation also checked this raw ASM141-address extent and result hashes, without rerunning unit/otool.

This direct-function question is answered. Follow-up [11 exact import caller](../mac-supervision-primitives-11/SUMMARY.md) is a distinct bounded question, not automatic bootout callee expansion. Zero coalition control/official KAS/model calls remain; full M3 and final native parity unproved.
