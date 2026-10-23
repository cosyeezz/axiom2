param([ValidateSet('check','node','tailscale','service')][string]$Action)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:PATH
function Phase([string]$Message) { Write-Output "@@phase:$Message" }
function ResponseText($Response) {
    if ($Response.Content -is [byte[]]) { return [Text.Encoding]::UTF8.GetString($Response.Content) }
    return [string]$Response.Content
}
function NodePath {
    $candidates = @()
    $registration = Join-Path $env:AXIOM_DATA_DIR 'installation.json'
    if (Test-Path $registration) { try { $candidates += (Get-Content $registration -Raw | ConvertFrom-Json).node } catch {} }
    $found = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($found) { $candidates += $found.Source }
    $candidates += (Join-Path $env:ProgramFiles 'nodejs/node.exe')
    foreach ($candidate in $candidates) { if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate } }
    return $null
}
function EnvironmentState {
    $node = NodePath
    $version = ''; $ready = $false; $npm = $null
    if ($node) {
        $version = (& $node --version).Trim()
        $ready = $version -match '^v(\d+)\.(\d+)\.' -and ([int]$Matches[1] -gt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 19))
        $candidate = Join-Path (Split-Path $node) 'node_modules/npm/bin/npm-cli.js'
        if (Test-Path $candidate) { $npm = $candidate }
    }
    $writable = $false
    try { $probe = Join-Path $env:AXIOM_DATA_DIR ([Guid]::NewGuid().ToString() + '.probe'); [IO.File]::WriteAllText($probe,''); Remove-Item $probe; $writable = $true } catch {}
    return @{nodeReady=([bool]$ready -and [bool]$npm);nodeVersion=$version;node=$node;npm=$npm;writable=$writable;tailscale=(Test-Path (Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'));platform='windows'}
}
function CheckedExit([string]$Message) { if ($LASTEXITCODE -ne 0) { throw "$Message (exit $LASTEXITCODE)" } }
$axiomSetupExit = 0
try {
    New-Item -ItemType Directory -Force -Path $env:AXIOM_DATA_DIR | Out-Null
    if ($Action -eq 'check') { EnvironmentState | ConvertTo-Json -Compress; exit 0 }
    if ($Action -eq 'node' -or $Action -eq 'tailscale') {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if ($winget) {
            $package = if ($Action -eq 'node') { 'OpenJS.NodeJS.LTS' } else { 'Tailscale.Tailscale' }
            Phase '正在调用系统安装器；如出现系统授权窗口，请完成授权…'
            & $winget.Source install --id $package --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
            if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { throw "系统安装未完成 (exit $LASTEXITCODE)，请使用官方下载地址安装后重新验证。" }
        } elseif ($Action -eq 'node') {
            Phase '正在下载 Node.js 官方安装程序…'
            $base = 'https://nodejs.org/dist/latest-v22.x/'
            $sums = ResponseText (Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 ($base + 'SHASUMS256.txt'))
            $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'x64' }
            $match = [regex]::Match($sums, "(?m)^([a-f0-9]{64})\s+(node-v22\.\d+\.\d+-$arch\.msi)\s*$")
            if (-not $match.Success) { throw '未找到本机架构的 Node.js 安装程序。' }
            $installer = Join-Path $env:AXIOM_DATA_DIR $match.Groups[2].Value
            Invoke-WebRequest -UseBasicParsing ($base + $match.Groups[2].Value) -OutFile $installer
            if ((Get-FileHash $installer -Algorithm SHA256).Hash -ne $match.Groups[1].Value) { throw 'Node.js 安装程序校验失败。' }
            Phase '等待系统安装向导完成…'
            $process = Start-Process (Join-Path $env:SystemRoot 'System32/msiexec.exe') -ArgumentList @('/i', ('"' + $installer + '"'), '/passive', '/norestart') -Wait -PassThru
            if ($process.ExitCode -notin @(0,3010)) { throw "Node.js 安装未完成 (exit $($process.ExitCode))。" }
        } else { throw '系统未提供 winget，请通过 Tailscale 官方下载地址安装后重新验证。' }
        $env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:PATH
        Phase '正在重新验证安装结果…'
        $state = EnvironmentState
        if ($Action -eq 'node' -and -not $state.nodeReady) { throw '尚未检测到 Node.js 22.19.0+ 和 npm，请完成安装后重新验证。' }
        if ($Action -eq 'tailscale' -and -not $state.tailscale) { throw '尚未检测到 Tailscale，请完成系统安装后重新验证。' }
        Phase '环境安装完成，请重新验证；Tailscale 安装后需打开并登录。'
        exit 0
    }
    $state = EnvironmentState
    if (-not $state.nodeReady) { throw '请先安装 Node.js 22.19.0+ 和 npm。' }
    if (-not $state.writable) { throw '用户数据目录不可写。' }
    # One downloader/validator on both platforms; GitHub binary MIME cannot turn
    # SHA256SUMS into a PowerShell byte[] string and falsely fail the regex.
    $env:AXIOM_SETUP_NPM = $state.npm
    & $state.node $env:AXIOM_SETUP_SERVICE 2>&1 | ForEach-Object { [Console]::Out.WriteLine([string]$_) }
    $axiomSetupExit = $LASTEXITCODE
    if ($axiomSetupExit -ne 0) { exit $axiomSetupExit }
} catch { $axiomSetupExit = 1; [Console]::Error.WriteLine('@@error:' + $_.Exception.Message); exit 1 }
finally {
    if ($Action -ne 'check' -and $env:AXIOM_SETUP_RESULT) { [IO.File]::WriteAllText($env:AXIOM_SETUP_RESULT, [string]$axiomSetupExit) }
}
