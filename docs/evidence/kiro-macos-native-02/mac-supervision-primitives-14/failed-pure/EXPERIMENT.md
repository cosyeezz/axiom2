# Bounded chained-pointer reference question

13's system dyld_info shim is unavailable and requested installation; do not repeat it or follow installation. Replacement is pure offline file-format parsing, no new system shim/tool/GUI call.

Question: does the same frozen arm64e launchd contain a chained-rebase pointer to known static wrapper0x10000f60c? No execution/reachability/bootout/hostpermission/kill/drain/M3 claim. Scope only full08 snapshot1236160B/SHA7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09, arm64eUUID3FEC147A-7931-3FCD-BDB9-59C9A814779C. File-format reference is the fully read installed SDK13.3 public mach-o/fixup-chains.h10325B; preserve full licensed header on main, not a kernel semantic source.

New pure helpers parse LC_SEGMENT_64/LC_DYLD_CHAINED_FIXUPS and segment page roots, decode only arm64e formats1/9/12 (8-byte stride), follow bounded single-start-per-page chains. No raw-word search called a fixup. Unsupported format/multi-start/out-of-range/ordinal/cycle/count cap stops, not a 'not found'. Before main, independent synthetic tests of headers, exact bitfield targets/bind/auth/next/PAC metadata and malformed boundaries; freeze source while tests run. No reading real snapshot in pure tests. Unchanged10 parse helper is SHA-bound AST reused, not re-executed main or repeated passed unit suite.

After pure tests are read/verified: one Python main, fresh14/results/CreateNew, parentCPU8/alarm20/outer25. Input<=2MiB, fixup payload<=128KiB, segments<=32/pages<=512 per segment, decoded nodes<=16384, target refs<=16, output<=4MiB. Save metadata preflight before decoding/unsupported stop. Output counts and exact matching raw pointer records plus only3 neighboring slots each side; distinguish confirmed chain entries from other bytes. No recursive analysis. Preserve source/header/SHA/metadata/result/negative or error without rerun; fixes require newcase.

No targets/official/KAS/models/coalition controls/launchctl/XPC/service/process scan/attach/credentials, no developer directory or global changes, no installer follow-up. Static pointer data is not runtime use or authoritative whole-tree terminal evidence.
