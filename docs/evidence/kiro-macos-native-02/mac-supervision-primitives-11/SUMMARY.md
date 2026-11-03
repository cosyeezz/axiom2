# 11 — direct termination import caller

One static main exited0 (~0.1s). Same permanent [08 snapshot](../mac-supervision-primitives-08/capture/launchd.snapshot) and [10 tested helper](../mac-supervision-primitives-10/locate_bootout.py) SHA `d0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608`; AST-extracted helpers only, no module imports/main and no repeated unchanged tests. Full aligned B/BL scan of357072B arm64e __text found **one** direct BL to the table-resolved coalition_terminate authstub0x100058988.

- callsite **0x10000f61c**
- metadata interval **[0x10000f60c,0x10000f638),44B/11instructions**
- whole-fileoffset685580; bodySHA `d6d63cca173943ad61e00e3011d84446cd54d7039a3eba777d413e1b45a69f5e`

[Full raw ASM](results/01-caller.stdout) shows saveFP/LR → **mov w1,0; BLstub** → compare return with-1 → on-1 BL0x10005782c → restore/retab. Incomingx0 is not changed: this static wrapper forwards its incoming CID parameter with flags0. Error helper identity/errno handling is not bound. Do not generalize flags0 to all dynamic/indirect calls, infer CID ownership, or call termination kill/drain.

[Manifest](results/manifest.json), [preflight](results/preflight.json), [empty stderr](results/01-caller.stderr), [nonexecuted synthetic carrier](results/01-caller.macho). Original heldotoolPID39799/exit0/no timeout/stderr0; ordinary streams, not pipeEOF/full-tree proof. Carrier228B/SHA7954ca6b98683c6df7131c1507579cd66189c0a8023c9ef6caad12209bb766bb; ASM491B/SHAe17d0a5bd7c993776342e7fa1dabc4fddeaaaca067dfbba57ecbb47e7616439d. Sourcefile snapshot is not loadedPID1; aligned scans do not exclude pointer or other-section callers, runtime code or indirect dispatch.

This was locate-first static data/ASM only: no launchd/launchctl/XPC/service/coalition controls/official KAS/model execution. The [06 hostlibrary prefix](../mac-supervision-primitives-06/SUMMARY.md) and this flags0 wrapper still do not establish hostkernel0ID/gate semantics; zeroID control probes remain prohibited. Follow-up [12 immediate wrapper callers](../mac-supervision-primitives-12/SUMMARY.md) asks a separate bounded predecessor question. Mac M3 and final parity remain unproved.
