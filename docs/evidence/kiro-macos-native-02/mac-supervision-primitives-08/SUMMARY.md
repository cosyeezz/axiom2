# Shipped launchd: supervision candidates located, not exercised

Independent read-only task **t11327/r11330** captured only `/sbin/launchd`. Main consumed its exact result and read full REPORT/manifest/inventory/commands. [Preserved report](capture/REPORT.md), [manifest](capture/manifest.json), [inventory](capture/inventory.json) retain actual commands and scope.

## Artifact identity

Regular/non-final-symlink1236160B source, held-FD pre/post stat and final path check stable, SHA256 **`7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09`**. Same-byte mode0400snapshot. Universal x86_64/arm64e; UUIDs respectively`40C18703-52FF-337F-9BBC-16880FDE88B4` / **`3FEC147A-7931-3FCD-BDB9-59C9A814779C`**. This binds the static file, not PID1's loaded image. Codesign was not run.

Six static commands (file, lipo info, otool header/load commands/all-slice load commands, nm undefined imports) exited0 without timeouts/stderr. Both slices import `_coalition_create`, `_coalition_reap`, `_coalition_terminate`, `_kill`, `_killpg`, `_posix_spawnattr_setcoalition_np`, `_proc_terminate` and `_proc_terminate_delegate`.

One printable-string scan found286keyword matches; selected256/31958B, **30omitted/cap=true**. Do not call that an exhaustive saved string set. Useful **whole-file offsets, not VAs** in arm64e: `service bootout (%s)`0xffa3b, `AbandonProcessGroup`0xf4db6, `_AbandonCoalition`0xf3e83, `WAITING_ON_COALITIONS`0xf9f43. Raw [selected strings](capture/selected-strings.tsv) and full report preserve the exact boundary.

## Next decision, not a capability claim

These locate a plausible OS-owner path after direct unprivileged coalition control remained unproven. **No xref, function, bootout behavior, supported caller option/default, complete membership, kill/drain or deadline was verified.** The single next static question supersedes an earlier broader report suggestion: in the frozen arm64e slice, does the immediate function referencing `service bootout (%s)` directly call `_coalition_terminate`? Main can plan that bounded xref/function analysis; not a global decompilation or authorization to execute service operations.

No launchd/launchctl execution, service creation/bootout/XPC/control call, target attach, process scan, privilege/global changes, credential inspection or official/model request. MacM3/native parity remain unproven.
