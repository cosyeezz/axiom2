/**
 * Canonicalize a shell command string into a stable key for the sandbox
 * approval cache (SandboxApprovalStore).
 *
 * The goal is to recognise "the same user intent" across superficial syntax
 * differences introduced by shell wrappers, so that a session-level approval
 * granted for `rm x` through one invocation path is also honoured when the
 * model later invokes the same command through a different wrapper.
 *
 * Design reference: Codex's `canonicalize_command_for_approval`
 * (codex-rs/core/src/command_canonicalization.rs).
 *
 * Our version is deliberately lighter-weight:
 *
 *   1. Identify common shell wrappers (`bash -c 'script'`, `/bin/bash -lc ...`,
 *      `zsh -c ...`, `pwsh -Command ...`, `powershell -Command ...`) and extract
 *      the inner script body as the key. Shell path and login/interactive flags
 *      are normalised away.
 *   2. Otherwise fall back to the trimmed original command as-is.
 *
 * Returning a plain string keeps the key hashable and cheap to log. Callers
 * combine this with the cwd to form the full approval key.
 */
/**
 * Normalise a command string into an approval-cache key.
 *
 * The output is a plain string prefixed with a tag that identifies how the
 * command was recognised, keeping keys human-readable in logs.
 */
export declare function canonicalizeCommand(command: string): string;
