param([ValidateSet('check','node','tailscale','service')][string]$Action)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:PATH
function Phase([string]$Message) { Write-Output "@@phase:$Message" }
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
            $sums = (Invoke-WebRequest -UseBasicParsing ($base + 'SHASUMS256.txt')).Content
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
    $prefix = Join-Path $env:AXIOM_DATA_DIR 'service'
    $cli = Join-Path $prefix 'node_modules/@cosyeezz/axiom2/bin/axiom2.mjs'
    if (Test-Path (Join-Path $env:AXIOM_DATA_DIR 'installation.json')) { throw '已有服务安装记录，请使用服务与更新中的更新或手动修复入口。' }
    Phase '正在读取正式发布版本…'
    $release = Invoke-RestMethod 'https://api.github.com/repos/cosyeezz/axiom2/releases/latest'
    if ($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^v?\d+\.\d+\.\d+$') { throw '发布版本无效。' }
    $asset = @($release.assets | Where-Object name -eq 'axiom2.tgz')
    $checksums = @($release.assets | Where-Object name -eq 'SHA256SUMS')
    if ($asset.Count -ne 1 -or $checksums.Count -ne 1) { throw '发布缺少唯一的服务包或校验清单。' }
    $base = 'https://github.com/cosyeezz/axiom2/releases/download/' + $release.tag_name + '/'
    if ($asset[0].browser_download_url -cne ($base + 'axiom2.tgz') -or $checksums[0].browser_download_url -cne ($base + 'SHA256SUMS')) { throw '发布附件地址不可信。' }
    $cache = Join-Path $env:AXIOM_DATA_DIR 'setup'
    New-Item -ItemType Directory -Force $cache | Out-Null
    $archive = Join-Path $cache 'axiom2.tgz'
    Phase '正在下载服务安装包…'
    Invoke-WebRequest -UseBasicParsing ($base + 'axiom2.tgz') -OutFile $archive
    $sums = (Invoke-WebRequest -UseBasicParsing ($base + 'SHA256SUMS')).Content
    $match = [regex]::Match($sums, '(?m)^([a-fA-F0-9]{64})\s+\*?axiom2\.tgz\s*$')
    Phase '正在校验安装包…'
    if (-not $match.Success -or (Get-Item $archive).Length -ne $asset[0].size -or (Get-FileHash $archive -Algorithm SHA256).Hash -ne $match.Groups[1].Value) { throw '服务安装包校验失败。' }
    Phase '正在安装后台及运行依赖…'
    $env:PATH = (Split-Path $state.node) + ';' + $env:PATH
    & $state.node $state.npm install --prefix $prefix --install-strategy=shallow --ignore-scripts --omit=dev --no-audit --no-fund --save=false --registry=https://registry.npmjs.org $archive
    CheckedExit '后台安装失败'
    Phase '正在启动并验证后台服务…'
    $result = & $state.node $cli start --json
    CheckedExit '后台启动失败'
    $service = $result | ConvertFrom-Json
    if ($service.state -ne 'running') { throw ('后台尚未就绪：' + $result) }
    Phase '安装完成，后台服务已就绪。'
} catch { $axiomSetupExit = 1; [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
finally {
    if ($Action -ne 'check' -and $env:AXIOM_SETUP_RESULT) { [IO.File]::WriteAllText($env:AXIOM_SETUP_RESULT, [string]$axiomSetupExit) }
}
