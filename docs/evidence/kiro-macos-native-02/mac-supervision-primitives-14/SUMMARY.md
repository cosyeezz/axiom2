# Case14 pure gate failed; main never run

The source [locate_fixups.py](locate_fixups.py), SHA256 `4a2ae5b37edebb2b626bbadb354150d613476273f0ffa0b7e1b27f2fc4ec8ebc`, remains unchanged. Its independent AST-only test ran once: **325 outcomes, 321 PASS / 4 FAIL, exit1**. Supported cases were 320/320 PASS; five additional whole-format hardening checks included four failures. The 240 seeded pointer vectors belong to one existing test, not extra coverage. **Case14 main was never executed.**

## What failed, and what did not follow

1. A nonempty imports table could alias a segment-start record.
2. A nonempty imports table could alias the starts index.
3. `symbols_offset=28` could alias the starts index. The historical test name says “header”; that label is imprecise: it did not point into the 0–27 fixed header.
4. Standalone `metadata` did not check section storage for a segment command claiming `nsects=1` with only its 72-byte fixed command. The main's upstream case10 `parse` already validates section storage, so this is not evidence that a real case14 main accepted that malformed image.

The SDK header does not explicitly require every named table to be disjoint. The first three failures therefore expose a stricter hardening requirement, not a demonstrated wrong pointer decode or proof that every aliased Mach-O layout is invalid. The full gate still failed; it was not relabeled green.

[Case15's explicit narrower contract](../mac-supervision-primitives-15/EXPERIMENT.md) adds two metadata guard regions only: section-command storage/cap, and nonempty payload-region disjointness. The original decoder/walker and the original325 oracle are retained, rather than changing failed assertions.

## Permanent original evidence

All **14 files / 193,063 bytes**, including inventory itself, source before/after, raw stdout/stderr, exit1, original harness, all results and the full licensed SDK header, were copied byte-for-byte, hash checked, set0400 and read back:

- [Full independent report](failed-pure/REPORT.md)
- [Original unchanged tests](failed-pure/tests.py)
- [All325 outcomes](failed-pure/results.json)
- [Raw stdout](failed-pure/stdout.log), [stderr](failed-pure/stderr.log), [exit](failed-pure/exit-status.txt), [command](failed-pure/commands.txt)
- [Source/SHA inventory](failed-pure/SHA256SUMS.json)
- [Complete format schema](failed-pure/fixup-chains.h)
- [Artifact-only preservation record](../mac-supervision-primitives-15/prior-preservation.json)

The preservation run also retained nine files from the separate case11–13/document readback, for **23 copies / 270,757 bytes** in that run, not 23 new tests. No test/main/target/network/control/model was rerun by preservation. Neither these pure tests nor the SDK schema establish host kernel authority, runtime reachability, whole-descendant supervision, Mac M3 or native request parity.
