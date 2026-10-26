/**
 * Shared constants for PowerShell cmdlets that execute arbitrary code.
 *
 * These lists are consumed by the security checker (powershell-security.ts)
 * and future permission UI components. Keeping them here avoids duplicating
 * the lists and prevents sync drift.
 *
 * Aligned with Claude Code's dangerousCmdlets.ts.
 */
/**
 * PowerShell common alias -> canonical cmdlet name mapping.
 * Used for resolving aliases before security checks.
 *
 * Lowercase keys and values for case-insensitive matching.
 */
export declare const COMMON_ALIASES: Readonly<Record<string, string>>;
/**
 * Cmdlets that accept a -FilePath (or positional path) and execute the
 * file's contents as a script.
 */
export declare const FILEPATH_EXECUTION_CMDLETS: Set<string>;
/**
 * Cmdlets where a scriptblock argument executes arbitrary code (not just
 * filtering/transforming pipeline input like Where-Object).
 */
export declare const DANGEROUS_SCRIPT_BLOCK_CMDLETS: Set<string>;
/**
 * Cmdlets that load and execute module/script code. .psm1 files run
 * their top-level body on import — same code-execution risk as iex.
 */
export declare const MODULE_LOADING_CMDLETS: Set<string>;
/**
 * Network cmdlets — wildcard rules for these enable exfil/download without prompt.
 */
export declare const NETWORK_CMDLETS: Set<string>;
/**
 * Alias/variable mutation cmdlets — Set-Alias rebinds command resolution,
 * Set-Variable can poison $PSDefaultParameterValues.
 */
export declare const ALIAS_HIJACK_CMDLETS: Set<string>;
/**
 * WMI/CIM process spawn — Invoke-WmiMethod -Class Win32_Process -Name Create
 * is a Start-Process equivalent that bypasses normal process checks.
 */
export declare const WMI_CIM_CMDLETS: Set<string>;
/**
 * Shells and interpreters whose child processes do NOT go through
 * checkPowerShellSecurity. Spawning any of these means the child runs
 * arbitrary code outside the validation surface (issue #42604).
 */
export declare const SHELLS_AND_INTERPRETERS: readonly ["pwsh", "powershell", "cmd", "wsl", "bash", "sh", "zsh", "busybox"];
/**
 * Windows native binaries that are MITRE-classified LOLBins.
 * They can perform actions equivalent to BLOCKed cmdlets (process creation,
 * persistence, in-memory code compilation/loading) without matching any
 * PowerShell-cmdlet regex (issue #42604).
 *
 * Note: read-only subcommands (e.g. `reg query`, `sc query`, `schtasks /Query`)
 * are deliberately handled by more specific patterns in powershell-security.ts
 * so they are not blanket-blocked here.
 */
export declare const WINDOWS_LOLBINS: readonly ["csc", "installutil", "regsvr32", "rundll32", "mshta", "wscript", "cscript", "msbuild", "bitsadmin", "certutil"];
/**
 * Commands to never suggest as a wildcard prefix in the permission dialog.
 * Derived from the above lists plus shells and interpreters.
 */
export declare const NEVER_SUGGEST: ReadonlySet<string>;
/**
 * Resolve a command name through COMMON_ALIASES to its canonical cmdlet.
 * Returns the canonical lowercase name, or the lowercased input if no alias.
 */
export declare function resolveAlias(name: string): string;
