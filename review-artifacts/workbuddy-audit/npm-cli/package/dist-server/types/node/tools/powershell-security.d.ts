/**
 * PowerShell command security checker.
 *
 * Aligned with Claude Code's 24 security validators using regex-based
 * pattern matching + CLM type whitelist + git safety + destructive warnings.
 *
 * Multi-layer security:
 *   Layer 1: BLOCK/ASK pattern matching (24/24 Claude Code validators)
 *   Layer 2: CLM type whitelist (~90 types, inverted check)
 *   Layer 3: Git safety (compound command git-write detection)
 *   Layer 4: CMD syntax compatibility checks (avoid cmd.exe semantics in PowerShell)
 *   Layer 5: Read-only validation (explicit whitelist, no dangerous Get-*)
 *   Layer 6: Destructive command warnings (informational UI hints)
 *
 * Enhancements:
 *   - Unicode dash support (en-dash U+2013, em-dash U+2014, horizontal-bar U+2015)
 *   - Full CLM type whitelist (~90 types) replacing 6 hardcoded type checks
 *   - Alias resolution via COMMON_ALIASES before read-only checks
 *   - Explicit Get-* whitelist (excludes Get-Command, Get-Help, Get-WmiObject, Get-CimInstance)
 *   - External command flag validation (git, docker, dotnet, node, python)
 *   - Git safety checks for compound commands
 *   - Destructive command warnings in SecurityCheckResult
 *   - bitsadmin /transfer detection (Claude Code #6 completeness)
 *
 * Claude Code validator mapping (24/24 covered):
 *   1.  checkInvokeExpression         -> BLOCK: Invoke-Expression / iex
 *   2.  checkDynamicCommandName       -> BLOCK: $() as command name
 *   3.  checkEncodedCommand           -> BLOCK: -EncodedCommand / -enc (+ Unicode dashes)
 *   4.  checkPwshCommandOrFile        -> ASK:   pwsh/powershell as command or Start-Process target
 *   5.  checkDownloadCradles          -> BLOCK: IWR|IEX, IRM|IEX, WebClient
 *   6.  checkDownloadUtilities        -> BLOCK: certutil, Start-BitsTransfer, bitsadmin
 *   7.  checkAddType                  -> BLOCK: Add-Type
 *   8.  checkComObject                -> BLOCK: New-Object -ComObject (+ Unicode dashes)
 *   9.  checkDangerousFilePathExecution -> BLOCK: -FilePath/-LiteralPath (+ Unicode dashes)
 *   10. checkForEachMemberName        -> ASK:   ForEach-Object -MemberName (+ positional + aliases)
 *   11. checkStartProcess             -> ASK:   Start-Process -Verb RunAs (+ Unicode dashes + colon-bound)
 *   12. checkScriptBlockInjection     -> BLOCK: Invoke-Command {, Start-Job {
 *   13. checkSubExpressions           -> ASK:   $() sub-expressions
 *   14. checkExpandableStrings        -> ASK:   "$($expr)" expandable strings
 *   15. checkSplatting                -> ASK:   @variable splatting
 *   16. checkStopParsing              -> ASK:   --% stop-parsing token
 *   17. checkMemberInvocations        -> ASK:   .Method() / ::StaticMethod()
 *   18. checkTypeLiterals             -> ASK:   CLM whitelist check (~90 types)
 *   19. checkInvokeItem               -> ASK:   Invoke-Item / ii
 *   20. checkScheduledTask            -> ASK:   Register-ScheduledTask / schtasks (+ New-ScheduledTask*)
 *   21. checkEnvVarManipulation       -> ASK:   [Environment]::SetEnvironmentVariable Machine
 *   22. checkModuleLoading            -> ASK:   Install-Module / Import-Module (+ Update/Save-Script)
 *   23. checkRuntimeStateManipulation -> ASK:   Set-Alias / Set-Variable / New-Variable (hijacking)
 *   24. checkWmiProcessSpawn          -> BLOCK: Invoke-WmiMethod Win32_Process
 *
 *   Issue #42604 hardening (Windows-only):
 *     - BLOCK Start-Process when target is a shell/interpreter/LOLBin/system-tool
 *       (covers `Start-Process powershell -File` child-process escape)
 *     - BLOCK Windows native LOLBins:
 *         csc / InstallUtil / regsvr32 / rundll32 / mshta / wscript / cscript / msbuild
 *       (wmic/sc/reg/schtasks 直接执行由 SystemToolPolicy 管控，
 *        但 Start-Process 创建的子进程脱离沙箱，仍需 block)
 *     - BLOCK non-PowerShell shells at line start: bash / sh / zsh / busybox
 *       (wsl 直接执行由 SystemToolPolicy 管控)
 *     - BLOCK .NET runtime APIs equivalent to existing BLOCKs:
 *         [Diagnostics.Process]::Start            (== Start-Process)
 *         New-Object Diagnostics.Process          (== Start-Process)
 *         [Reflection.Assembly]::Load*            (== Add-Type)
 *         [AppDomain]::*ExecuteAssembly           (== Add-Type)
 *         [PowerShell]::Create()...AddScript      (== IEX)
 *         $ExecutionContext.InvokeCommand.*       (== IEX)
 *     - ASK reg export/save (registry hive dump for offline cred extraction)
 *
 *   Known limitations tracked separately:
 *     - Sandbox path bypasses checkPowerShellSecurity entirely
 *     - `-File <script>` content is not recursively scanned
 */
export type SecurityBehavior = 'allow' | 'ask' | 'block';
export interface SecurityCheckResult {
    /** Whether the command is safe to run */
    behavior: SecurityBehavior;
    /** Human-readable reason for the decision */
    reason?: string;
    /** Informational warning for display in permission dialog (does not affect behavior) */
    warning?: string;
}
/**
 * Check if a PowerShell command is safe to run.
 *
 * Returns:
 *   - { behavior: 'block' } for dangerous commands
 *   - { behavior: 'ask' }   for commands needing confirmation
 *   - { behavior: 'allow' } for safe read-only commands
 *   - { behavior: 'ask' }   as default for unknown commands
 *
 * The `warning` field is populated for destructive commands regardless of behavior.
 */
export declare function checkPowerShellSecurity(command: string): SecurityCheckResult;
