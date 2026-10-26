param(
    [Parameter(Mandatory=$true)][string]$Node,
    [Parameter(Mandatory=$true)][string]$Helper,
    [Parameter(Mandatory=$true)][string]$TaskDirectory,
    [Parameter(Mandatory=$true)][string]$DataRoot,
    [Parameter(Mandatory=$true)][string]$Npm
)
# Native stderr is output. In Windows PowerShell 5.1 it must not become a
# terminating NativeCommandError before the actual native exit code is read.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$env:AXIOM_DATA_DIR = $DataRoot
$env:AXIOM_SETUP_TASK_DIR = $TaskDirectory
$env:AXIOM_SETUP_NPM = $Npm
$log = Join-Path $TaskDirectory 'install.log'
try {
    if (-not (Test-Path -LiteralPath $Node -PathType Leaf)) { throw 'Node.js executable is missing.' }
    Set-Location -LiteralPath $DataRoot -ErrorAction Stop
    Write-Host 'Axiom2 - foreground install / repair. Your projects, sessions and credentials are retained.'
    & $Node $Helper 2>&1 | ForEach-Object {
        $line = $_.ToString()
        [IO.File]::AppendAllText($log, ($line + [Environment]::NewLine), $utf8)
        Write-Host $line
    }
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 1 }
    exit $code
} catch {
    $line = '@@error:' + $_.Exception.Message
    [IO.File]::AppendAllText($log, ($line + [Environment]::NewLine), $utf8)
    Write-Host $line -ForegroundColor Red
    exit 1
}
