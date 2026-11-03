# Locator09 synthetic pure-helper review

Conclusion: 126/128 cases pass; two genuine instruction-validity false positives in find_xrefs. Test exit 1 (not a passing suite). Both are limitations of the opcode prefilter; no claim they occur in the real input. No source repair or repository writes.

Source: /Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-supervision-primitives-09/locate_bootout.py
SHA256: df44a752188034485fbcd712d650915d62396ceb29903f5640d2ff72ea9a98d4
Original equals read-only frozen source before and after tests. Frozen copy: source.py (0400; permission protection, not WORM).
Helper definitions at source lines: {'signed': 23, 'parse': 27, 'find_xrefs': 152, 'direct_branches': 169, 'make_carrier': 180, 'main': 188}.
AST extraction selected only signed, parse, find_xrefs, direct_branches, make_carrier, LITERAL, IMPORT. No module main/import/top-level statements executed. Injected stdlib struct/hashlib/uuid only.

## Findings
1. find_xrefs ADRP+ADD register check conflates ADRP destination 31 (XZR: result discarded) with ADD source 31 (SP). Fixture ADRP XZR,+1 page; ADD X4,SP,#7 reports an xref at base 0x100008ffc to 0x100009007 although no data dependency exists. Treat this as candidate-only evidence, not a decoded xref.
2. ADD match masks only 0xff000000 and ignores fixed bit 23. Setting bit23 in otherwise matching ADD immediate produces an unallocated encoding yet still reports an xref. Both failures have the same returned row recorded in results.json.
Recommendation: main agent should account for both candidate false positives in manual opcode/disassembly validation; any implementation fix needs a newly frozen source and new focused tests. This report does not expand the deliberately incomplete search patterns.

## Coverage
Signed 21/26-bit min/max/zero/negative boundaries; ADR positive/negative and mismatched targets; adjacent ADRP+ADD page signed extrema, shift0/shift12, differing destination, source mismatch, wrong page/sign, W ADD/SUB/ADDS negatives; intentionally missed nonadjacent pair; BL/B signed extrema, selected/nonselected targets, PC offset and register/conditional branch exclusion. Carrier header, segment, section, high/original VA, lengths and exact bytes, including empty and non-word input. Fully synthetic thin arm64e and fat32/fat64, capability subtype, UUID, function-start delta decoding, symbols/string table and indirect selected stub. Explicit malformed file/fat/load/section/region/ULEB/literal/import/stub metadata rejected. Permissive zero starts and trailing bytes documented, not deemed bugs.

## Execution and limits
Working directory: /Volumes/D_Work/axiom2
Actual test command: python3 -B /var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/locator09-pure-memhbuni/harness.py
Actual exit: 1. Results: 126 PASS, 2 FAIL, 128 total; one test execution, no retry.
Helper suite CPU 0.005157s / wall 0.005181s (not whole interpreter startup). Runner CPU hard limit 12s, alarm25s, outer tool timeout30s. stdout.log/stderr.log, commands.txt and exit.txt preserve evidence. Harness generation and final archive commands exited 0.

Not tested: main, real snapshot/system/official binaries, otool, real disassembly acceptance, real09 applicability, runtime supervision/M3/parity, arbitrary Mach-O completeness, every 10k-function/64KiB cap boundary or exhaustive malformed schemas. No target/official/model calls, credentials, network, control APIs, or subprocesses from the harness. No files read except specified source/EXPERIMENT, required skill instructions and own TEMP; stdlib imports handled by Python normally.
