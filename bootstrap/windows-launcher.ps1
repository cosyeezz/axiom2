param([Parameter(Mandatory=$true)][string]$Request, [ValidateSet('owner', 'parent')][string]$Kind = 'owner')
$ErrorActionPreference = 'Stop'
function Quote-Argument([string]$Value) {
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
# Windows PowerShell 5.1 exits without executing under DETACHED_PROCESS.
# Start-Process creates a separate console; waiting here preserves the host's
# child-close contract while the real supervisor survives a terminated host.
if (!$BootstrapDirectory) { $BootstrapDirectory = $PSScriptRoot }
$owner = Join-Path $BootstrapDirectory $(if ($Kind -eq 'parent') { 'windows-parent-witness.ps1' } else { 'windows-owner.ps1' })
if ($BootstrapPrelude) {
    $script = $BootstrapPrelude + "`nInvoke-AxiomBootstrap '" + $owner.Replace("'", "''") + "' @{ Request = '" + $Request.Replace("'", "''") + "' }"
    $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script)))
} else {
    $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $owner, '-Request', $Request)
}
$line = ($arguments | ForEach-Object { Quote-Argument $_ }) -join ' '
# Business stdout/stderr is drained by the worker into bounded output.json.
# Console redirection here would leave handles or temporary files behind when
# this waiting launcher dies before the independent supervisor finishes.
$process = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $line -WindowStyle Hidden -PassThru
try {
    $null = $process.Handle
    $process.WaitForExit()
    exit $process.ExitCode
} finally { $process.Dispose() }
