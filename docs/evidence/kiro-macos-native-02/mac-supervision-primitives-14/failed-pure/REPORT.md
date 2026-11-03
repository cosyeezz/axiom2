# New14 independent pure test report

## Conclusion and release gate
The supported locator checks passed **320/320**. The complete deliberately stricter suite exited **1**: **325 cases, 321 PASS, 4 FAIL**, plus 240 seeded pointer vectors inside one passing case. No test was retried. The four failures are retained as whole-format validation/hardening findings, not demonstrated wrong pointer decoding. Main/module was never executed. Do not interpret this report as an unconditional release gate PASS; resolve the desired overlap/whole-image validation contract first.

## Binding and isolation
- Working directory: `/Volumes/D_Work/axiom2`.
- Original and after SHA256: `4a2ae5b37edebb2b626bbadb354150d613476273f0ffa0b7e1b27f2fc4ec8ebc`; after `4a2ae5b37edebb2b626bbadb354150d613476273f0ffa0b7e1b27f2fc4ec8ebc`. Byte-for-byte unchanged: **True**.
- Frozen source: `frozen-locate_fixups.py`; after copy: `after-locate_fixups.py`; manifests: `before.json`, `after.json`.
- Inputs read: requested EXPERIMENT.md, locate_fixups.py, public SDK13.3 fixup-chains.h (full licensed copy retained), plus mandatory safety skill and own artifacts. No real binary/snapshot/settings/credential access. No repo changes, network, target, API, tool shim, or dependency installation.
- AST compiled exactly four FunctionDefs: unpack_at, metadata, decode_pointer, walk_chains. Namespace starts with struct only (Python supplies builtins). No module imports/top-level/main execution. Harness imports standard library only.
- Own mktemp namespace/HOME/TMPDIR, environment cleared except HOME/TMPDIR/PATH. `/usr/bin/python3 -B`; CPU20, alarm60, 4MiB/file. All synthetic images were memory-only; no external fixture ingestion. Exact test command and actual exit in commands.txt and exit-status.txt.

## Evidence and coverage
- `tests.py`: complete independent builders, expected bitfields, assertions.
- `stdout.log`: original unmodified JSON-line test stdout, including failure tracebacks and final summary. `stderr.log`: original empty stderr.
- `results.json`: all 325 named tests, actual/expected fields, rejection messages and preserved failures. Test elapsed 0.068821s; completed, not timed out/interrupted.
- Formats 1/9/12; auth/unauth rebases, absolute versus base-relative low43/high8; 32-bit auth runtime offsets; overflow; all four PAC keys/address discrimination/diversity; next11 boundaries; 16/24-bit ordinals; every reserved bind bit; signed addend bit patterns accepted (bind address/addend resolution deliberately outside locator output).
- Complete synthetic LC_SEGMENT_64 + LC_DYLD_CHAINED_FIXUPS images; payload/import/symbol offsets; valid absent roots and empty arrays; mixed rebase/bind/auth chains; starts 0/8/page-8; 4KiB/16KiB pages; multiple pages/segments; ordinal endpoints; truncated fields/images; command/cardinality/range, version/formats, import cap, segment mapping, record overlap, unsupported formats even without roots, multi-start, alignment, page and partial-file escape. Duplicate guard and 16384 exact/16385 over-cap exercised directly with independent metadata.
- Seeded oracle: seed140029, 240 mixed independently encoded words; not a server/native-runtime comparison.

## Four retained failures and interpretation
1. Imports table pointed into segment-start record: accepted; no disjointness validation.
2. Imports table pointed into starts index: accepted; no disjointness validation.
3. Test named "symbols overlap fixups header" actually sets symbols_offset=28, the STARTS index (not 0..27 header). Accepted. The test label is inaccurate; original test/results are preserved. This is a stricter section separation assumption, not evidence of header-byte exposure.
4. LC_SEGMENT_64 nsects=1 with only 72-byte command storage: accepted. metadata ignores section-table structure; this is incomplete general Mach-O validation, not wrong chain bit decoding.

The public fixup header defines structures and offsets but does not explicitly mandate all section-disjointness assumptions. Thus failures 1–3 demonstrate absent hardening under the harness's stronger oracle; they do **not**, using the permitted reference alone, establish invalidity of every aliased table arrangement. Failure4 is outside the section-insensitive locator's declared narrow task. No proven false positive/negative was found for supported, structurally well-formed chain decoding. Do not claim whole-format validation from the 320 supported passes; 1 additional whole-format negative (unaligned starts mutation rejected) also passed. Do not relabel these four preserved FAILs as passes.

## Recommendations and unverified limits
Main should decide explicitly whether overlapping payload tables and section-command validity are reject requirements. If yes, fix in a NEW source version/case and independently retest impacted tests; this report's overall exit remains1. If scope excludes those checks, document that before consuming supported-scope evidence. No production main, input-binding/read_stable helpers, real source image, target-reference cap/output logic, host/runtime control, launchd behavior, PAC execution, service lifecycle, or native/API parity was tested. No whole-format import-name/symbol/zlib/section validation claim. No source mutation was needed.

## Inventory
`SHA256SUMS.json` enumerates every evidence file except itself (self-hash is mathematically recursive). The inventory includes this report and commands, byte counts, per-file SHA256, and total byte size. There are no hidden generated artifacts; HOME/TMPDIR remain empty. Per-file <=4MiB and total <=16MiB are checked at finalization.
