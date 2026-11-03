# Independent new15 unchanged-oracle regression

Conclusion: 325 cases, 325 PASS, 0 FAIL; actual test exit 0. One launch, no retry; interruption: None. Historical14 remains 325 cases, 321 PASS / 4 FAIL, exit1, as documented in historical14-REPORT.md; those results are not relabeled or rerun.

## Execution and binding
Initial working directory /Volumes/D_Work/axiom2; actual test cwd /private/tmp/new15-independent-dd3vapff.
Exact argv, redirected command and limits: commands.txt and execution.json. /usr/bin/python3 -B under env -i with only own HOME/TMPDIR and PATH=/usr/bin:/bin. CPU20, wall60, file4MiB, monitored total16MiB. Runtime 0.189883s; harness elapsed 0.068515s. Native process exit preserved in exit-status.txt, not replaced by verification status.
Harness byte SHA256 b12c2ef4d7055a32c94e3b55e14b6162083bcb5c9a89cdf68f95e0794e9687de before and after, exactly the prescribed original. New15 before/after/frozen SHA256 ef7b3d8bebf172b1363f8cea0217cc0e799b590ad9e75f3ba330061514934b68. Copied source and harness frozen 0400 before execution. before.json/after.json bind all hashes; after-locate_fixups.py retains post-run source bytes.

## Results and scope
All 325 per-case records are retained in results.json and byte-original stdout.log, verified identical in result-verification.json; stderr.log is 0 bytes. Scopes: {"supported": {"cases": 320, "failed": 0, "passed": 320}, "whole-format-hardening": {"cases": 5, "failed": 0, "passed": 5}}. 240 deterministic vectors belong to one existing case, not extra cases; scope counts and historical/current suite counts overlap and must not be added.
The former four hardening case names now report PASS, PASS, PASS, PASS for NEW15 ONLY. The misleading historical symbols test name still means offset28 into starts index; original assertions and labels untouched.

## Change verification
Whole-module AST equals14 after reversing ONLY nsects command-storage guard and occupied payload-region initialization/disjointness guard. Reversal also produces byte-for-byte14 source. ast-verification.json stores exact reversal strings; source14-to15.diff retains complete diff. No unrelated code change. reference14-locate_fixups.py is evidence only, never executed.
Harness AST-extracts only unpack_at, metadata, decode_pointer, walk_chains, with struct namespace; no source module import/top-level/main execution. Only requested repository files and own TEMP artifacts read. No snapshot, binary, credentials, SDK, network, toolshim, dependencies or repository writes.

## Limits and outstanding gates
Only unchanged original325 regression was run; no additional focused new guard tests were added or run. No old14 rerun. No main, real-target behavior, native parity, pointer execution, general import/symbol/zlib/section validation or server equivalence established. Main must wait for independently matched results/full evidence review; this report does not authorize main. Inventory covers all files except itself and lists empty directories; final size checks include inventory itself.
