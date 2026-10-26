/**
 * Windows-specific security checker for the Bash tool.
 *
 * On Windows, the Bash tool runs inside Git Bash (MSYS2) which can invoke
 * any Windows executable directly. This creates a cross-tool bypass:
 * commands that would be BLOCKed by checkPowerShellSecurity() if sent
 * through the PowerShell tool execute unimpeded through the Bash tool.
 *
 * This module applies a focused set of BLOCK rules that detect the
 * PowerShell / cmd / LOLBin invocation patterns described in issue #42605.
 *
 * Design principles:
 *   - Only active on Windows (process.platform === 'win32')
 *   - Does NOT duplicate all of checkPowerShellSecurity (different syntax)
 *   - Targets the "cross-chain" escape: Bash → Windows executable
 *   - Read-only subcommands (reg query, sc query, schtasks /Query) are
 *     not blocked — only write/create/execute actions
 *   - wsl.exe 已移至 SystemToolPolicy 统一管控（见 sandbox-orchestrator.ts）
 *   - Normal Unix commands (ls, git, grep, etc.) are unaffected
 */
export type SecurityBehavior = 'allow' | 'ask' | 'block';
export interface SecurityCheckResult {
    /** Whether the command is safe to run */
    behavior: SecurityBehavior;
    /** Human-readable reason for the decision */
    reason?: string;
}
/**
 * Check whether a command submitted to the Bash tool on Windows invokes
 * dangerous Windows executables that would bypass PowerShell security.
 *
 * On non-Windows platforms, always returns `{ behavior: 'allow' }`.
 */
export declare function checkBashSecurityWindows(command: string): SecurityCheckResult;
