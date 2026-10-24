# Linux process ownership helper

`axiom-owner.c` provides the process lifetime used by application-owned command and package operations. It runs as a native launcher, creates a PID namespace with a native PID 1, and starts the Node worker only after the application authorizes it. The user's numeric UID/GID are preserved. The worker sees a private `/proc`; Node's business IPC remains separate from the supervision channel.

## Build and distribution

Run `node scripts/build-native.mjs` on Linux x64 or arm64 with a local C compiler and static libc development files. The build writes `bin/native/linux-<arch>/axiom-owner` and `manifest.json`. The manifest records the protocol, architecture, binary SHA-256 and source SHA-256. The application verifies the binary before launching it.

The release workflow builds and tests each architecture, combines both artifacts into the npm package, and restores executable permissions. Package checks require both architectures for a release artifact. Application startup never downloads a compiler or builds the helper. A missing helper, unavailable namespace capability or incompatible platform produces an explicit operation failure.

`node --test native/owner.test.mjs` exercises normal and exceptional exit, STOP, native deadlines, deadline extension, startup without GO, and a stopped worker. The worker creates detached descendants so the tests verify ownership beyond an ordinary process group. Linux CI configures its temporary runner to allow user namespaces where AppArmor otherwise restricts them; the product does not change this system policy.

## Protocol

The parent forks the helper with the Node executable as its first argument, followed by the worker arguments. `AXIOM_OWNER_PARENT`, `AXIOM_OWNER_NONCE` and `AXIOM_OWNER_DEADLINE` identify the parent, operation and initial absolute monotonic deadline in milliseconds. File descriptor 4 carries newline-delimited control messages. Node chooses its separate IPC descriptor through `NODE_CHANNEL_FD`.

- Helper → parent: `READY <nonce> <init-pid> <start-time>` after the native PID 1 has initialized.
- Parent → helper: `GO` permits worker startup; `STOP` requests cleanup; `DEADLINE <milliseconds>` changes the absolute deadline.
- Parent → helper: `ACK <nonce>` acknowledges a verified `CLEANED` receipt. After reaping the tree the helper consumes late control frames and waits at most two seconds for this ACK before closing; missing ACK never permits additional work. Legacy hosts without ACK remain supported with this bounded exit delay.
- Helper → parent: `CLEANED <nonce> <reason> <wait-status>` only after `waitpid` has confirmed native PID 1 exited. Reasons are normal exit (0), STOP (1), deadline (2), lost parent/control channel (3), or protocol/internal failure (4).
- Helper → parent: `ERROR <nonce> <errno> 0` reports initialization failure.

The launcher and PID 1 both establish parent-death handling with pidfd checks around registration. The native deadline continues to run when the Node host or worker is stopped. If all supervisors are frozen, or the kernel cannot complete termination, bounded cleanup cannot be guaranteed.

The application treats a missing trusted CLEANED receipt as an unconfirmed stop. A launcher exit or an IPC disconnect alone is not a cleanup receipt. Persisted uncertainty must not be discarded merely because a PID no longer belongs to the launcher.

## Recovery evidence

Linux's `zap_pid_ns_processes` waits for namespace tasks, including nested namespace descendants, before allowing PID 1 to be reaped. The application wrapper supports conservative recovery from persisted Linux ownership records: the original host must be gone, and an armed record also requires proof that its native PID 1 instance is gone. Both checks require the same kernel boot, a matching outer PID namespace and an unhidden, non-overlaid `/proc` observation scope. The record's file identity and bytes are checked again before removal. A zombie, inaccessible process, changed observation scope, bare PID, namespace inode or elapsed timeout is insufficient; uncertainty leaves the record intact.

Windows uses Job Objects instead of this helper. A named Job disappearing is not itself proof that all associated processes have exited. `SystemBootEnvironmentInformation.BootIdentifier` identifies the BCD boot entry and must not be treated as a unique identifier for each kernel boot.

This helper establishes process ownership for trusted application execution. It does not isolate filesystem access, network access or mutually hostile programs running as the same user.
