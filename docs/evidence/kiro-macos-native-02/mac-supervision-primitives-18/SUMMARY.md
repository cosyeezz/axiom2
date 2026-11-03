# Case18 the pointer is stored locally, not locally dispatched

**One main exit0 /one otool exit0**, exact function **`[0x1000139b8,0x100013a6c)`**, 180B /45 contiguous instruction addresses /no unknown rows. This closes only the explicit case18 question about case17's immediate BL target. On its normal return path, the incoming x4 value is saved in x19 and stored at **returned pointer +0x48**. No local callback-style BLR/BR through it appears. Later consumption, other callees, runtime reachability and authorization remain unproved.

[Experiment](EXPERIMENT.md) · [driver](inspect_callback_callee.py) · [preflight](results/preflight.json) · [full manifest](results/manifest.json) · [original180B](results/function.bin) · [nonexecuted carrier](results/function.macho) · [original ASM](results/disassembly.stdout) · [empty tool stderr](results/disassembly.stderr) · [main stdout](main.stdout) · [main stderr](main.stderr) · [main exit0](main.exit) · [namespace](main-workdir.txt).

## Local register and memory facts

- `0x1000139d4 cbz x0,0x100013a68`; that target is a direct BL to unknown `0x100057718`. This is a null-value branch, not an established permission or ownership gate; the target is not assumed noreturn.
- `0x1000139d8 mov x19,x4`. The incoming value is the case17 signed wrapper argument, not the coalition import stub itself.
- `BL 0x10001be84` followed by `mov x21,x0` supplies an as-yet untyped pointer. Other fixed callees `0x1000157d8`, `0x10005a5d8` and `0x100057718` were not expanded. Incoming x1/x2 control two optional branches; no source-language types or security meaning assigned.
- **`0x100013a48 stp xzr,x19,[x21,#0x40]`** writes zero at +0x40 and the saved incoming x4 at **+0x48**; `mov x0,x21` returns that pointer before the epilogue.

No claim that callbacks can never run: absence of a local callback-style BLR/BR does not establish what the fixed callees do (including registers they may observe) or how later consumers use the saved field. No CID identity, caller authority, live PID1 image, host kernel semantics, kill/drain, original-descendant terminal state or Mac M3 is inferred. A later separate question may inspect the first consumer in case17, but no automatic callee closure was performed.

## Identity, caps and original output

DriverSHA **`4cb7385b3294a78f4d4e6ab9f780a5704282ae1b146f81f154a0c80811b438d7`**. SHA-bound case10 helper `d0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608`, AST-only `signed/parse/make_carrier/direct_branches` +`LITERAL/IMPORT`, exactly6 nodes. No helper module import/main or old tests. Case17 driver `6ae56ce8795407c4d8870fe7325e0c174e2e3cec7c9ce1c8bd4643f7b0d6c744` and original104B body were bound and compared to the frozen snapshot; tested direct-branch decoding confirms `BL@0x10001f28c -> 0x1000139b8`. Wrapper `0x10000f60c`, new callee `0x1000139b8` and real imported stub `0x100058988` remain separate.

Same frozen08 wholeSHA `7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09`, ARM64eUUID `3FEC147A-7931-3FCD-BDB9-59C9A814779C`, slice offset622592 /SHA `fe9a1562d360e15c86937153586ca8778ee72bd95de423415ec780ebde9c0102`. LC starts exact entry and8192B cap checked after saved preflight; selected body whole offset702904 /SHA **`a4f93f643d50e8bdd12c53fcfe72a41e478591d64d9dc3932224fda63b336c1c`**. Carrier364B /SHA `d7f1233ce5b0b123f525771723f3c3fd756f44017f42b8cd346e49f5b38d5edd`; tool stdout1717B /SHA `52884e53ff278973868aedcbfae7c075c60df3285830cc25f8a4fa08128b8e84`.

Held otool PID61691 /exit0 /timeoutfalse /wall0.048930084s /stderr0B. Own namespace `/tmp/new18-main.r7eWvl3G`, env-i ownHOME/TMP/PATH/LC_ALL, Python-I-B. ParentCPU8/9/alarm20/outer30; childCPU2/3/wall5/NOFILE64/FSIZE512KiB. Ordinary streams after direct-child exit, nonexecuted carrier and syntax completeness are not pipe EOF, full-tool-tree ownership, complete CFG/LSDA or hard-realtime/M3 evidence. No dyld_info shim/install/repair, runtime target execution, service/coalition controls, credentials, network or real model request.

## Prior independent delivery evidence

[Full final report](prior-readback/REPORT.md) · [final171 checks](prior-readback/final-checks.json) · [original169 checks](prior-readback/checks.json) · [three targeted corrections](prior-readback/header-correction-checks.json) · [commands](prior-readback/commands.txt) · [inventory](prior-readback/artifact-SHA256.json) · [preservation](prior-preservation.json) · [important provenance limits](PRIOR-READBACK-NOTE.md).

24 files /79,087B retained byte/SHA/0400/readback, including the initial failed oracle and raw streams, targeted correction and final report. Aggregate171/171 is **168 original PASS reused +3 targeted header checks**, not171 new runtime or format vectors. This historical case17 audit does not cover subsequently created case18 files. **Control calls0 /real model requests0 /final parity and M3 still unproved.**
