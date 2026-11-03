# Case19 first consumer delegates, then returns a lazy global

**One main exit0 /one otool exit0**, exact function **`[0x10001ee40,0x10001ee74)`**, 52B /13 contiguous instruction addresses /no unknown rows. Case17's constructor-return x0 is unchanged when entering this first selected consumer. It immediately passes that value to a fixed callee, then returns a lazily initialized global value. No local record+0x48 load or callback-style BR/BLR appears; neither fixed callee was expanded. This does not establish what either callee does or whether the stored callback eventually runs.

[Experiment](EXPERIMENT.md) · [source](inspect_first_consumer.py) · [preflight](results/preflight.json) · [full manifest](results/manifest.json) · [original52B](results/function.bin) · [nonexecuted carrier](results/function.macho) · [original ASM](results/disassembly.stdout) · [empty tool stderr](results/disassembly.stderr) · [main stdout](main.stdout) · [main stderr](main.stderr) · [exit0](main.exit) · [namespace](main-workdir.txt).

## Local facts and limits

- Original case17: `BL139b8@1f28c; MOVx19,x0@1f290; BL1ee40@1f294`. x0 has no intervening write, so on the normal return path the input to this consumer is the constructor's returned pointer.
- **`BL0x1000155ac@0x10001ee50`** occurs before any local x0 change. Record interpretation and that fixed callee's effects remain unknown.
- `ADRPx19` forms `0x100082000`; `LDRx0,[x19,#0x388]` reads the global at **`0x100082388`**. If nonzero it goes to the epilogue; if zero, `BL0x10001c1e4` supplies a value stored there. The global's live contents and type were not observed.
- No local +0x48 field read or callback-style BR/BLR in13 rows. This is not proof that fixed callees or later consumers never invoke the callback. No permission/CID-ownership meaning, original-descendant closure, kill/drain, runtime reachability or Mac M3 follows.

## Binding, original artifacts and resource limits

DriverSHA **`47f46763c533ff63d5d728f888207ff07a8153a0d69112735538b5976a78a494`**. Case10 helperSHA `d0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608`, AST-only four already-tested functions plus two constants,6nodes, no helper import/main or old tests. Bound case17 driver `6ae56ce8795407c4d8870fe7325e0c174e2e3cec7c9ce1c8bd4643f7b0d6c744`/104B body and case18 driver `4cb7385b3294a78f4d4e6ab9f780a5704282ae1b146f81f154a0c80811b438d7`/180B producer body and its four saved-field words, both compared to frozen snapshot bytes. New consumer, producer139b8, wrapperf60c and importstub58988 remain distinct.

Same08 snapshotSHA `7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09`, ARM64eUUID `3FEC147A-7931-3FCD-BDB9-59C9A814779C`, slice622592/SHA `fe9a1562d360e15c86937153586ca8778ee72bd95de423415ec780ebde9c0102`. Preflight saved before exact-entry/8192B gate. Body whole offset749120/SHA **`3329b6b3b52f5f2e84483110fe291950ce9b91cda575e0cfa8b1e152fd0effd6`**; carrier236B/SHA `f038391f0ec81be2c401d23cda3745feba30c98e72a794e90d4caefd5ee4c4d4`; ASM619B/SHA `73c00cf022d1ecc688e2424bdd91360d57a4511e957112a5f61b675ba5ae8ddb`.

Held otool PID64226 /exit0 /timeoutfalse /wall0.024918s /stderr0B. Own namespace `/tmp/new19-main.PE4jP1rf`, env-i ownHOME/TMP/PATH/LC_ALL, Python-I-B. ParentCPU8/9/alarm20/outer30; childCPU2/3/wall5/NOFILE64/FSIZE512KiB per ordinary stream. Nonexecuted carrier, direct-child exit and syntax completeness do not prove pipe EOF, full-tool-tree cleanup, complete CFG/LSDA, live PID1 identity or hard-realtime/M3. No dyld_info shim/install/repair, official/KAS runtime, auth/config/credential files, service/coalition controls, network or real model request.

## Independent case18 audit retained without rerun

[Full final report](prior-readback/FINAL-REPORT.md) · [untouched initial failed report](prior-readback/REPORT.md) · [all final130 checks](prior-readback/final-checks.json) · [original132 checks](prior-readback/checks.json) · [two corrections](prior-readback/correction-checks.json) · [commands](prior-readback/commands.txt) · [input hashes](prior-readback/input-SHA256.json) · [artifact inventory](prior-readback/artifact-SHA256.json) · [preservation](prior-preservation.json).

20 files /63,356B retained byte/SHA/0400/readback. Initial verifier1:128 PASS/4 own-oracle failures (three Python namespace calls mistaken for Markdown links and a historical header-expression shape assumption). A separate correction0 replaces those four failed checks with two targeted checks; **130/130=128 unchanged PASS reused+2**, not130 new runtime or format tests. Original source/report/raw streams/exits remain intact. Main verified the exact aggregate and all statuses before retention; old verifier/main/otool were not rerun. The old audit covered five case18 texts, selected180B/LC-start windows and its24 new copies; it did not cover newly created case19. Its unused sibling-link exception is not a generally validated allowlist; actual authored links in this scope stayed inside evidence02. **Control calls0 /real model requests0 /M3 and final server parity remain unproved.**
