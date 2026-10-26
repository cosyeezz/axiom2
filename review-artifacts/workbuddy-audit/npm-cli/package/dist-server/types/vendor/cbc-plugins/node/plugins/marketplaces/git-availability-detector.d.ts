import { Logger } from '@genie/telemetry';
/**
 * Probes whether the local `git` executable is invokable.
 *
 * The result is cached for the lifetime of the process; concurrent callers
 * share a single probe promise. Callers that want a fresh answer (for
 * example after an in-app "install git" action) can call
 * {@link invalidateCache}.
 *
 * The probe is guarded by a short timeout. On slow machines this trades a
 * tiny chance of a false negative for a hard upper bound on how long
 * marketplace installation waits before deciding to fall back to Zip.
 *
 * On macOS the probe first checks — WITHOUT executing git — whether the
 * resolved `git` is merely the Apple Command Line Tools shim while the tools
 * are absent. In that case it reports git as unavailable instead of running
 * the shim, which would otherwise trigger the "install developer tools"
 * dialog. `xcode-select -p` is used for the tools-presence check; unlike
 * `git`/`xcode-select --install`, it never triggers the GUI prompt.
 */
export declare class GitAvailabilityDetector {
    protected readonly logger: Logger;
    /**
     * Upper bound on the `git --version` probe. 5s is generous for a
     * process-start benchmark yet short enough that users do not perceive
     * a stall when git is absent but reported by shims that hang.
     */
    private static readonly DETECTION_TIMEOUT_MS;
    private probePromise;
    /** Returns true when `git --version` exits successfully within the timeout. */
    isAvailable(): Promise<boolean>;
    /** Clears the cached probe result so the next {@link isAvailable} call re-probes. */
    invalidateCache(): void;
    private probe;
    /**
     * macOS-only: decide whether executing `git` is safe (i.e. will not trigger
     * the Command Line Tools install dialog).
     *
     * - No `git` anywhere on PATH → not safe (nothing to run anyway).
     * - `git` resolves to a real binary (Homebrew/MacPorts/…, i.e. anything
     *   other than {@link MACOS_GIT_STUB_PATH}) → safe.
     * - `git` resolves to the Apple shim → safe only when the Command Line
     *   Tools / Xcode developer directory is actually configured.
     */
    private isMacGitSafeToExecute;
    /**
     * Resolve the `git` executable the same way the OS would when spawning it:
     * the first executable named `git` across `PATH`. Pure filesystem lookup —
     * it never executes anything, so it cannot trigger the macOS prompt.
     *
     * Returns the absolute candidate path, or undefined when none is found.
     */
    private resolveGitOnPath;
    /**
     * Whether the macOS Command Line Tools (or Xcode) developer directory is
     * configured. Uses `xcode-select -p`, which prints the active developer
     * directory or exits non-zero when the tools are absent — and crucially
     * does NOT trigger the install dialog (only `xcode-select --install` or
     * running a shim binary does).
     */
    private isCommandLineToolsInstalled;
}
//# sourceMappingURL=git-availability-detector.d.ts.map