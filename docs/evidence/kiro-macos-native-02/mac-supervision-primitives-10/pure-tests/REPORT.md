# Frozen10 independent pure-helper validation
Conclusion: original unchanged oracle suite 128/128 PASS, exit 0; focused suite 57/57 PASS, exit 0. Each ran exactly once; no retry or oracle repair.

Source: /Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-supervision-primitives-10/locate_bootout.py
Source SHA256: d0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608
Source copy and original harness frozen 0400 before execution; SHA verified against source/original harness again after execution. Permissions are not WORM or atomic image-load proof. Old source/harness matched their preserved artifact-manifest hashes. Textual delta equals precisely the rd31 skip/comment and ADD mask 0xff000000 -> 0xff800000. Whole-module AST equality holds after undoing exactly that guard and constant; no other helper or main semantics changed. See source-delta.diff and freeze-before/after.json.

## Execution
Working directory: /Volumes/D_Work/axiom2
Interpreter: /usr/bin/python3 (3.9.6); -B.
Commands and actual process exits, wall/child CPU: commands.json; original128/extra.stdout.log, .stderr.log, .exit.txt preserve output. Full original harness.py is byte-identical, SHA 70251ab4c28f8bba79a6356655b40674e245ff0ec6f3c0ee8bf5f221f633f814. source.py is the full new10 source copy. results.json preserves all 128 old oracle expectations unchanged (including old bit23 case name); extra-harness.py and extra-results.json preserve separate independent expectations and actual words/results.

## Focused coverage
57 cases: 9 ADR (rd0/30/31, signed deltas/zero); 36 ADRP+ADD (rd0/30/31, negative/zero/positive pages, shift0/12, bit23 clear/set); 8 ADD rn31 SP mismatch against rd0/30; 4 ADD destination SP positives. rd31 ADR/ADRP discards results; ADD rn31 is SP, not the discarded register. bit23 exclusion is conservative rejection of a nonordinary ADD-immediate form. No assertion that it is unallocated or independently decoded. Old failed09 report/results remain failed, unchanged, and are not added to new pass counts.

## Scope and limits
AST-selected pure helpers only; source module imports, assignments except selected LITERAL/IMPORT in original harness, main and __main__ guard never execute. Focused extraction only signed/find_xrefs. Binary inputs entirely synthetic. No source snapshot, system/official binary reads, otool, target/main execution, network, credentials, control APIs, models, dependency installs, or repository writes. Python loads standard library normally. Only runner launches these two Python test processes. Main/real input applicability, decoder allocation, exhaustive instruction/metadata coverage, xref completeness, runtime reachability, M3/native/server parity remain untested. Recommend main consume evidence before separately deciding whether to run10 main; this report does not authorize or perform that run.

Driver CPU hard limit15s/alarm29s; tool wall30s; file-size cap2MiB and aggregate artifact bytes checked below2MiB. Original unchanged harness additionally imposes CPU12s/alarm25s. Actual elapsed/CPU are in commands.json and results. No test timed out or was interrupted.
