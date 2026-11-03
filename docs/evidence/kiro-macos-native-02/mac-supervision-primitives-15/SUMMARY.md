# Case15 bounded chained-pointer negative result

**One locator main, exit0:** the bound shipped launchd ARM64e slice contains **2,396 supported chained entries** (936 binds + 1,460 rebases); none targets the precise case11 wrapper **`0x10000f60c`**. Status: `no_target_among_supported_chained_entries`. This is not a claim that the wrapper is unused or has no indirect callers.

## Pure gate and deliberately narrower contract

[Source](locate_fixups.py): 12,187 bytes, SHA256 `ef7b3d8bebf172b1363f8cea0217cc0e799b590ad9e75f3ba330061514934b68`. [Experiment](EXPERIMENT.md) preserves case14 and modifies only two metadata regions:

- Require `nsects <= 128` and `72 + 80*nsects <= cmdsize`.
- Reject overlap among nonempty fixed-header, starts-index, imports-table, symbol-suffix and segment-start-record intervals; abutting endpoints and empty intervals remain supported.

This is a narrower support contract, not a claim that the SDK makes every aliased layout universally invalid. `decode_pointer` and `walk_chains` are unchanged. Reversing only the two guards restores case14 byte-for-byte and gives the same whole-module AST. [Case14's 321 PASS / 4 FAIL, exit1](../mac-supervision-primitives-14/SUMMARY.md) remains failed and its main never ran.

Independent tasks completed and were matched/read back by the main agent:

- [Original325 report](test-reports/original325/REPORT.md): **325/325 PASS, actual exit0**, one run. The [harness](test-reports/original325/tests.py) is byte-identical (`b12c2ef4d7055a32c94e3b55e14b6162083bcb5c9a89cdf68f95e0794e9687de`), names/scopes unchanged; only the prior four failed statuses change to PASS, with the intended guard errors. Full325 JSON and raw stdout agree. The 240 seeded vectors are inside one case.
- [Independent focused report](test-reports/focused-guards/REPORT.md): **63/63 named outcomes, actual exit0**: 51 synthetic-fixture invocations / 48 unique inputs, five AST/change checks, three decoder smoke checks, four freeze checks. Includes section storage0/1/128/>128, abutting/empty regions, pairwise overlap and truncation. It independently reconstructed issue families, but did not read or prove byte identity with the historical four vectors; the original325 suite covers those exact assertions.

These suites overlap: **do not call this388 independent cases or add240 vectors**. Both only compile four AST-extracted functions with a struct namespace; they do not import the module/main, read real binaries, call controls, run official KAS or establish native parity. Source before/after/frozen hashes agree. CPU20/15s respectively, wall60s, own minimal HOME/TMP/PATH, no retries.

## Unique real-file run

[Preflight](results/preflight.json), [manifest](results/manifest.json), [original exit](main.exit), [stdout](main.stdout), [empty stderr](main.stderr). Own HOME/TMP namespace is recorded in [main-workdir.txt](main-workdir.txt); outer25s, CPU8/9s, alarm20s. Ordinary output files were read after exit, not treated as pipe-EOF or whole-tree evidence. No child tool or target execution.

Bound input identity:

- Frozen shipped snapshot: 1,236,160 bytes / SHA256 `7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09`.
- ARM64e UUID `3FEC147A-7931-3FCD-BDB9-59C9A814779C`, slice offset622592 / SHA256 `fe9a1562d360e15c86937153586ca8778ee72bd95de423415ec780ebde9c0102`.
- Case10 parse helper SHA256 `d0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608`, AST-extracted without executing its main.
- Full [SDK13.3 schema](results/fixup-chains-sdk13.h) SHA256 `6a99a4be90303c12b92a5a397f7ed299a44fe68485208c3b8eb667e48fb2afff`: format reference, not host kernel evidence.

Actual fixups: offset540672 / 16,624 bytes; imports636 / format1; symbolsformat0. Two segment records, both **pointerFormat12 / page16384**: DATA_CONST two roots0/8, DATA one root24. Walk completed below16,384-node cap; target references and local contexts are empty. No unsupported-format or cap error was turned into a negative result.

## Retention and limits

[Tests preservation](tests-preservation.json) copied **92 files / 395,360 bytes** once to `test-reports/`, including both inventories, complete source/harness/raw logs and all51 synthetic fixture files, with byte/SHA/0400/readback verification. It also records ten existing main/source file hashes, without rerunning the locator or tests. The separate [prior preservation](prior-preservation.json) retained case14 failure and the limited 18-author-text/64-link/case11–13 readback; [that complete report](static-readback/REPORT.md) is historical scope, not verification of subsequently added case14/15 documents.

The negative result excludes only an exact target among the walked supported chained entries. It does **not** exclude ADR/ADRP address formation, exports, relative tables, other sections, computed/interior targets or other indirect/runtime paths. Snapshot identity is not PID1 loaded-image identity. No host kernel gate/zeroID semantics, service bootout permission, kill/drain, authoritative empty/full-descendant ownership, Mac M3 or final server equivalence was proved. **Coalition control calls0; real model requests0.** The unavailable dyld_info shim was not retried; no installation was approved or followed up.
