# 13 — unavailable dyld_info shim; no fixup query

One usage-only invocation `/usr/bin/dyld_info -help` exited **72**, PID42156, no timeout, stdout0B/stderr101B. Driver exit0 means command evidence was recorded, not usable help or target analysis. Full [manifest](tool-help/manifest.json) and [original stderr](tool-help/stderr) are permanent. Shipped toolfile118640B/SHA `b8763cf250e607a778bb4603cecb5b90338814d0a3dfcba0d57b1de242f610e9` existed, but existence did not establish a usable utility:

> xcode-select: Failed to locate 'dyld_info', requesting installation of command line developer tools.

**The shim requested installation; whether an installer UI was opened is not observed.** No installation was approved or followed, no developer-directory/global setting was queried or changed, and no target/fixup command ran. Do not claim zero UI side effects. Do not retry the shim, accept an installer, or make full Xcode a prerequisite for this task. This route failed before obtaining an option schema; planned stage2 is not run.

Replacement is bounded offline metadata parsing with the installed public `mach-o/fixup-chains.h` definitions and synthetic tests, in a **new14** case. Both explicit SDK13.3 and MacOSX.sdk header paths were located; header10325B was read fully, not executed. Header is a file-format schema reference, not host kernel permission evidence. Runtime reachability/kill/drain/M3/parity remain unproved; model and coalition control calls remain0.
