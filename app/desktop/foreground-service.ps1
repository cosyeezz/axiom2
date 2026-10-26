param(
    [Parameter(Mandatory=$true)][string]$Node,
    [Parameter(Mandatory=$true)][string]$Cli,
    [Parameter(Mandatory=$true)][string]$Helper,
    [Parameter(Mandatory=$true)][string]$DataRoot
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$env:AXIOM_DATA_DIR = $DataRoot
Set-Location -LiteralPath $DataRoot -ErrorAction Stop
Write-Host 'Axiom2 - foreground service. Keep this terminal open; Ctrl+C stops the service.'
# Run the reviewed foreground controller against the verified installed backend.
# The installed legacy launcher is not executed; it may register before reserving.
# The parent URL in import.meta.resolve must resolve the installed package's
# ESM import exports rather than the desktop bundle's dependencies.
& $Node --experimental-import-meta-resolve $Helper $Cli
$code = $LASTEXITCODE
if ($null -eq $code) { $code = 1 }
if ($code -ne 0) {
    Write-Host ('Service exited with code ' + $code + '. Read the error above; no hidden retry was made.') -ForegroundColor Red
    [void](Read-Host 'Press Enter to close')
}
exit $code
