/**
 * Windows-specific process management utilities.
 *
 * Provides reliable process tree termination and inspection on Windows,
 * where POSIX signals (SIGTERM, SIGKILL) and process groups are not available.
 */
export declare class WindowsProcessUtils {
    /**
     * Forcefully terminate a process and all its descendants.
     *
     * Uses `taskkill /F /T` which:
     *   /F = Force termination
     *   /T = Terminate child processes (tree kill)
     *
     * windowsHide: true prevents a visible console window flash.
     */
    static killProcessTree(pid: number): Promise<void>;
    /**
     * Synchronously kill a process tree. Best-effort — does not throw.
     */
    static killProcessTreeSync(pid: number): void;
    /**
     * Check if a process with the given PID is still running.
     *
     * Uses `tasklist /FI "PID eq <pid>"` and checks if the output
     * contains the PID. This is more reliable than `process.kill(pid, 0)`
     * on Windows.
     */
    static isProcessAlive(pid: number): boolean;
    /**
     * Get the list of child process PIDs for a given parent PID.
     *
     * Uses `wmic process where "ParentProcessId=<pid>" get ProcessId`.
     * Note: wmic is deprecated in modern Windows but still available.
     * For Windows 10+, could use PowerShell Get-CimInstance instead.
     */
    static getChildProcesses(parentPid: number): number[];
    /**
     * Recursively collect all descendant PIDs (children, grandchildren, etc.)
     */
    static getDescendantProcesses(pid: number): number[];
}
