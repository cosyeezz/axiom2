# Requires Node.js 24+. Works in Windows PowerShell 5.1 and PowerShell 7.
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 24+ from https://nodejs.org/ and reopen PowerShell, then retry.'
}
$axiomNodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or [int]($axiomNodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Axiom2 requires Node.js 24+.' }
& npm.cmd install --global 'https://github.com/cosyeezz/axiom2/releases/latest/download/axiom2.tgz'
if ($LASTEXITCODE -ne 0) { throw 'Axiom2 installation failed. Service was not started.' }
$axiomPrefix = (& npm.cmd prefix --global).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate the npm global installation.' }
& (Join-Path $axiomPrefix 'axiom2.cmd')
if ($LASTEXITCODE -ne 0) { throw 'Axiom2 exited with an error.' }
