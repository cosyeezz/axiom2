param([ValidateSet('check','node','tailscale','service')][string]$Action)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:PATH
$script:SetupTask = if ($env:AXIOM_SETUP_TASK_DIR) { Get-Content -LiteralPath (Join-Path $env:AXIOM_SETUP_TASK_DIR 'task.json') -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$script:TerminalStatus = $null
function PublishTask {
    if (-not $script:SetupTask) { return }
    $script:SetupTask.updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $target = Join-Path $env:AXIOM_SETUP_TASK_DIR 'task.json'
    $next = Join-Path $env:AXIOM_SETUP_TASK_DIR 'task.ps.next'
    [IO.File]::WriteAllText($next, ($script:SetupTask | ConvertTo-Json -Depth 12 -Compress))
    $backup = Join-Path $env:AXIOM_SETUP_TASK_DIR 'task.ps.previous'
    [IO.File]::Replace($next, $target, $backup)
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
}
function Phase([string]$Message, [string]$Stage = 'checking', [bool]$Controllable = $false) {
    Write-Output "@@phase:$Message"
    if (-not $script:SetupTask) { return }
    $script:SetupTask | Add-Member -Force NoteProperty message $Message
    if ($script:SetupTask.phase -ne $Stage) { $script:SetupTask | Add-Member -Force NoteProperty phaseStartedAt ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) }
    $script:SetupTask.phase = $Stage
    $script:SetupTask.capabilities = @{cancel=$Controllable;extend=$Controllable}
    $script:SetupTask.completedSteps = [Math]::Max($script:SetupTask.completedSteps, [Array]::IndexOf($script:SetupTask.steps, $Stage))
    PublishTask
}
function CheckControl {
    if (-not $script:SetupTask) { return }
    $file = Join-Path $env:AXIOM_SETUP_TASK_DIR 'control.json'
    if (Test-Path -LiteralPath $file) {
        $control = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($control.budgets) { foreach ($key in @('headersMs','idleMs','installMs','totalMs')) { $script:SetupTask.budgets.$key = [Math]::Max($script:SetupTask.budgets.$key, $control.budgets.$key) } }
        if ($control.cancel) { $script:TerminalStatus = 'cancelled'; throw '已取消下载。' }
    }
    if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $script:SetupTask.startedAt -ge $script:SetupTask.budgets.totalMs) { throw '任务达到总时限，请延长时限后重新尝试。' }
}
function Download([string]$Url, [string]$Destination) {
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $http = [Net.Http.HttpClient]::new()
    $http.Timeout = [Threading.Timeout]::InfiniteTimeSpan
    $cancel = [Threading.CancellationTokenSource]::new()
    $response = $null; $inputStream = $null; $outputStream = $null
    $clock = [Diagnostics.Stopwatch]::StartNew(); $last = 0L; $received = 0L; $sample = 0L; $sampleBytes = 0L
    if ($script:SetupTask) {
        $script:SetupTask.capabilities = @{cancel=$true;extend=$true}
        $script:SetupTask | Add-Member -Force NoteProperty transfer @{received=0;connection='connecting';updatedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();source=([uri]$Url).GetLeftPart([UriPartial]::Authority)}
        PublishTask
    }
    try {
        $request = $http.GetAsync($Url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cancel.Token)
        while (-not $request.IsCompleted) {
            CheckControl
            $budget = if ($script:SetupTask) { $script:SetupTask.budgets.headersMs } else { 30000 }
            if ($clock.ElapsedMilliseconds -ge $budget) { throw '等待下载源响应头超时。' }
            Start-Sleep -Milliseconds 100
        }
        $response = $request.GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) { throw "下载失败 (HTTP $([int]$response.StatusCode))。" }
        $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $outputStream = [IO.File]::Create($Destination)
        $buffer = New-Object byte[] 65536
        $last = $clock.ElapsedMilliseconds
        while ($true) {
            $read = $inputStream.ReadAsync($buffer, 0, $buffer.Length, $cancel.Token)
            while (-not $read.IsCompleted) {
                CheckControl
                $budget = if ($script:SetupTask) { $script:SetupTask.budgets.idleMs } else { 60000 }
                if ($clock.ElapsedMilliseconds - $last -ge $budget) { throw '下载源长时间没有返回数据。' }
                Start-Sleep -Milliseconds 100
            }
            CheckControl
            $count = $read.GetAwaiter().GetResult()
            if ($count -eq 0) { break }
            $outputStream.Write($buffer, 0, $count); $received += $count; $last = $clock.ElapsedMilliseconds
            if ($received -gt 536870912) { throw '安装文件超出大小限制。' }
            if ($script:SetupTask -and $last - $sample -ge 500) {
                $transfer = @{received=$received;connection='receiving';updatedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();source=([uri]$Url).GetLeftPart([UriPartial]::Authority);bytesPerSecond=(($received-$sampleBytes)*1000/($last-$sample))}
                if ($response.Content.Headers.ContentLength -gt 0 -and $received -le $response.Content.Headers.ContentLength) { $transfer.total = $response.Content.Headers.ContentLength }
                $script:SetupTask.transfer = $transfer; PublishTask; $sample = $last; $sampleBytes = $received
            }
        }
        if ($script:SetupTask) { $script:SetupTask.transfer.received = $received; $script:SetupTask.transfer.connection = 'finished'; $script:SetupTask.transfer.Remove('bytesPerSecond'); PublishTask }
    } catch {
        $cancel.Cancel()
        if ($outputStream) { $outputStream.Dispose(); $outputStream = $null }
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
        throw
    } finally {
        if ($outputStream) { $outputStream.Dispose() }; if ($inputStream) { $inputStream.Dispose() }; if ($response) { $response.Dispose() }
        $cancel.Cancel(); $cancel.Dispose(); $http.Dispose()
    }
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
            CheckControl
            Phase '正在调用系统安装器；如出现系统授权窗口，请完成授权…' 'installing'
            & $winget.Source install --id $package --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
            if ($LASTEXITCODE -in @(3010,1641)) { $script:TerminalStatus = 'unknown'; throw '系统安装器要求重启电脑；重启后重新验证安装状态。' }
            if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { throw "系统安装未完成 (exit $LASTEXITCODE)，请使用官方下载地址安装后重新验证。" }
        } elseif ($Action -eq 'node') {
            Phase '正在下载 Node.js 官方安装程序…' 'downloading' $true
            $base = 'https://nodejs.org/dist/latest-v22.x/'
            $manifest = Join-Path $env:AXIOM_SETUP_TASK_DIR 'SHASUMS256.txt'
            Download ($base + 'SHASUMS256.txt') $manifest
            $sums = [IO.File]::ReadAllText($manifest)
            $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'x64' }
            $match = [regex]::Match($sums, "(?m)^([a-f0-9]{64})\s+(node-v22\.\d+\.\d+-$arch\.msi)\s*$")
            if (-not $match.Success) { throw '未找到本机架构的 Node.js 安装程序。' }
            $installer = Join-Path $env:AXIOM_DATA_DIR $match.Groups[2].Value
            Download ($base + $match.Groups[2].Value) $installer
            Phase '正在校验 Node.js 安装程序…' 'verifying' $true
            CheckControl
            if ((Get-FileHash $installer -Algorithm SHA256).Hash -ne $match.Groups[1].Value) { throw 'Node.js 安装程序校验失败。' }
            CheckControl
            Phase '等待系统安装向导完成…' 'installing'
            $process = Start-Process (Join-Path $env:SystemRoot 'System32/msiexec.exe') -ArgumentList @('/i', ('"' + $installer + '"'), '/passive', '/norestart') -Wait -PassThru
            if ($process.ExitCode -in @(3010,1641)) { $script:TerminalStatus = 'unknown'; throw 'Node.js 安装器要求重启电脑；重启后重新验证。' }
            if ($process.ExitCode -eq 1602) { $script:TerminalStatus = 'cancelled'; throw '已在系统安装器中取消安装。' }
            if ($process.ExitCode -ne 0) { throw "Node.js 安装未完成 (exit $($process.ExitCode))。" }
        } else { throw '系统未提供 winget，请通过 Tailscale 官方下载地址安装后重新验证。' }
        $env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:PATH
        Phase '正在重新验证安装结果…' 'validating'
        $state = EnvironmentState
        if ($Action -eq 'node' -and -not $state.nodeReady) { throw '尚未检测到 Node.js 22.19.0+ 和 npm，请完成安装后重新验证。' }
        if ($Action -eq 'tailscale' -and -not $state.tailscale) { throw '尚未检测到 Tailscale，请完成系统安装后重新验证。' }
        Phase '环境安装完成，请重新验证；Tailscale 安装后需打开并登录。' 'validating'
        exit 0
    }
    $state = EnvironmentState
    if (-not $state.nodeReady) { throw '请先安装 Node.js 22.19.0+ 和 npm。' }
    if (-not $state.writable) { throw '用户数据目录不可写。' }
    $env:AXIOM_SETUP_NPM = $state.npm
    # Native stdout/stderr already share the install log. Merging stderr into a
    # PowerShell pipeline turns normal npm diagnostics into terminating
    # NativeCommandError records under Windows PowerShell 5.1 + Stop.
    & $state.node $env:AXIOM_SETUP_SERVICE
    $axiomSetupExit = $LASTEXITCODE
    if ($axiomSetupExit -ne 0) { exit $axiomSetupExit }
} catch {
    $axiomSetupExit = 1
    if ($script:SetupTask -and $Action -ne 'service') {
        $script:SetupTask | Add-Member -Force NoteProperty error @{code= $(if ($script:TerminalStatus -eq 'cancelled') { 'cancelled' } else { 'operation' });message=$_.Exception.Message;phase=$script:SetupTask.phase}
    }
    [Console]::Error.WriteLine('@@error:' + $_.Exception.Message); exit 1
}
finally {
    if ($script:SetupTask -and $Action -ne 'check' -and $Action -ne 'service') {
        $script:SetupTask.status = if ($script:TerminalStatus) { $script:TerminalStatus } elseif ($axiomSetupExit -eq 0) { 'succeeded' } else { 'failed' }
        $script:SetupTask.capabilities = @{cancel=$false;extend=$false}
        if ($script:SetupTask.status -eq 'succeeded') { $script:SetupTask.completedSteps = $script:SetupTask.steps.Count }
        $script:SetupTask | Add-Member -Force NoteProperty finishedAt ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
        PublishTask
    }
    if ($Action -ne 'check' -and $env:AXIOM_SETUP_RESULT) { [IO.File]::WriteAllText($env:AXIOM_SETUP_RESULT, [string]$axiomSetupExit) }
}
