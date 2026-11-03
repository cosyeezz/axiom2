# 12 — no direct wrapper caller in the scanned text

One main exited0 (~0.1s), zero tool calls. It scanned the same frozen arm64e __text357072B for aligned B/BL target **0x10000f60c**, the [11 decoded44B wrapper](../mac-supervision-primitives-11/SUMMARY.md), verified as a LC_FUNCTION_STARTS entry.

**Direct candidates0, selected function ranges0, otool calls0.** This is only a bounded negative for B/BL in that section, not evidence the wrapper is unused: address-of/data pointers, indirect calls, other sections and runtime dispatch were not queried here. No bootout, CID source/ownership, hostkernel permissions or kill/drain conclusion follows.

Permanent [preflight](results/preflight.json)1005B/SHA `0f751b1e341218ac0ddc83f040211bff5401b8ed8c10411c0e66828e41be65ec` and [manifest](results/manifest.json). Full snapshotSHA7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09; arm64eUUID3FEC147A-7931-3FCD-BDB9-59C9A814779C, sliceSHAfe9a1562d360e15c86937153586ca8778ee72bd95de423415ec780ebde9c0102. Reuses only frozen10 tested helper AST/SHA, not module main. Source was explicitly changed from11 clone **before** this run: separate selectedWrapperVA and hitprojection prevent wrongly calling wrapper an importstub; real coalition_terminate import metadata remains distinct.

No target/service/API/official KAS/model execution. [13 tool lookup](../mac-supervision-primitives-13/SUMMARY.md) is a new data-reference approach, not a rerun; unavailable systemshim is not followed with installation. Unsupported chain decoding cannot later be relabeled this scan's proof. M3/full parity remain unproved.
