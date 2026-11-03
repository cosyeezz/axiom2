# Current-host userspace export observed — no coalition invocation

## Actual bounded observation

[Own C](owned_export_prefix.c) SHA256`0ededab4331a02320e697313d47872ac3cddf88c5afe69c270709ff24f9ba778` only calls ordinary self-metadata/dlsym/dladdr and reads a small prefix from its own loaded system-library mapping. It never calls the resolved coalition function. [Unique run](results/manifest.json) completed0 in0.883s: compile0, collector0, neither timed out, compiler streams empty, collector559Bstdout/0stderr. Original held collectorPID26869 reports uid/euid501/nativearm64 and the previously observed Darwin25.6.0/xnu12377.161.14~5 kernel version.

Resolved exact symbol start `coalition_terminate` in `/usr/lib/system/libsystem_kernel.dylib`, loaded-image UUID **`c6a4a4cb92e63bafaae0e8306259209a`**, ARM64e subtype, image-relative offset111784. Captured64B at that entry without crossing a page; [prefix](results/terminate-prefix.bin) SHA256 **`3fcc3e52e5cfdf741f218f5a33d4208839f4eecc076cf27477100019e85427c6`**. Own compiled Mach-O34192B is retained too. This is the image loaded in this **own process**, not a claim about PID1 or Kiro. UUID/path/prefix are not a full shared-cache or kernel hash.

## Static decoding, not another runtime capture

[Postprocess](POSTPROCESS.md) builds an explicitly **synthetic, non-executed248B Mach-O carrier** solely from those retained64B, preserving image-relative instruction addresses. One otool call exit0/no timeout/stderr0; [raw ASM](postprocess/otool.stdout), [manifest](postprocess/manifest.json).

The observed return-delimited48B path contains12instructions: PACIBSP, stack/frame save, move incoming x1 into x2, store incoming64-bit x0 at child-owned `[sp+8]`, pass its address as x1, put **2** in w0, branch-and-link to image-offset **56468/0xdc94**, restore and RETAB. The remaining16captured bytes begin another prologue; they are not assigned to this function. This establishes these actual register/stack/opcode operations, **not** the downstream helper's identity, errno translation, full exception/unwind/CFG or kernel implementation/zero-ID semantics.

## Safety decision and remaining boundary

[Independent review](authority-review/REPORT.md), t11313/r11316, is preserved unmodified with [numbered excerpts](authority-review/EVIDENCE.md) and its manifest. Main read the full report/manifest/excerpts. It did no build/API/network/test. A future typed `(0,0)` control query remains conditional and **not approved to execute from this evidence**: the public pin's explicit zero-ID rejection is not host-kernel correspondence. An owned child can inherit a coalition that is not exclusively owned by that child. EPERM/ESRCH cannot be turned into root-only/create/full-tree conclusions; hypothetical returns are not observations.

[Exact-host tag metadata attempt](../mac-supervision-primitives-07/SUMMARY.md) returned404, so no host-source binding was gained. No control call, privilege change, official/KAS import/execution, credential inspection or model request occurred. The controller supervised only original owned children and captured **regular files**, not pipe EOF or an inescapable descendant set. Compiler children/full-tree completion are not certified. MacM3 remains unproven and native parity work continues behind that gate.
