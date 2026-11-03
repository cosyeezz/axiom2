# One-step callers of the zero-flags termination wrapper

11 found exactly one aligned direct B/BL to coalition_terminate's import stub in frozen arm64e __text: BL0x10000f61c in [0x10000f60c,0x10000f638),44B. The wrapper sets w1=0, forwards incoming x0 unchanged, calls terminate, and handles -1 via a different helper. This alone says nothing about its callers, CID source or kill/drain.

New single question: **which immediate direct callers reach this exact wrapper and what local cleanup context surrounds those calls?** Scan same frozen357072B __text once for direct B/BL to0x10000f60c; preserve locators, then at most two complete metadata-delimited functions <=8192B each/16KiB total. At most16hits. No recursive caller/callee expansion. This is one necessary predecessor step, not an unbounded closure.

Retain11input identity, exact tested10AST-helper binding and limits: snapshot1236160B/SHA7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09/UUID3FEC147A-7931-3FCD-BDB9-59C9A814779C; helperSHA d0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608. New12/results CreateNew; parentCPU10/alarm30/outer40/output4MiB, <=two nonexecutedcarriers+otool5s/CPU2/512KiB eachstream. Stop on any cap with preflight saved; no retry. No repetition of unchanged128+57helper checks.

No controls, launchctl/XPC/services, liveOS/process capture, official/KAS/model execution, credentials, elevation or global changes. Static branch/dataflow does not establish runtime reachability, full descendant kill/drain, bootout binding, host kernel semantics or M3. Read actual result before deciding another experiment.
