/**
 * PowerShell edition information
 */
export type PowerShellEdition = 'core' | 'desktop';
/**
 * Detected PowerShell information
 */
export interface PowerShellInfo {
    /** Full path to the PowerShell executable */
    path: string;
    /** PowerShell version string (e.g. "7.4.1"), or null if detection failed */
    version: string | null;
    /** Whether this is PowerShell 7+ (pwsh) */
    isPwsh7: boolean;
    /** Edition: 'core' (pwsh 7+) or 'desktop' (powershell 5.1) */
    edition: PowerShellEdition;
}
/**
 * Find and cache PowerShell installation.
 *
 * Discovery order:
 *   1. Environment variable CODEBUDDY_POWERSHELL_PATH (user override)
 *   2. pwsh in PATH (PowerShell 7+, cross-platform)
 *   3. powershell in PATH (Windows PowerShell 5.1)
 *   4. Well-known default paths on Windows
 *
 * Returns null if PowerShell is not found.
 */
export declare function findPowerShell(): PowerShellInfo | null;
/**
 * Get the cached PowerShell path, or null if not available.
 */
export declare function getCachedPowerShellPath(): string | null;
export declare function findPowerShellSandboxSafe(): PowerShellInfo | null;
/**
 * Get the PowerShell edition, or null if not available.
 */
export declare function getPowerShellEdition(): PowerShellEdition | null;
/**
 * Check if PowerShell tool should be enabled.
 *
 * Enabled when:
 *   - Running on Windows AND
 *   - PowerShell is available AND
 *   - Not explicitly disabled via CODEBUDDY_USE_POWERSHELL_TOOL=0
 */
export declare function isPowerShellToolEnabled(): boolean;
/**
 * Clear cached detection result (for testing).
 */
export declare function clearPowerShellCache(): void;
