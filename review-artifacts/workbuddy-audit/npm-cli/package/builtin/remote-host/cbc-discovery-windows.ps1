Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$MaxRequestBytes = 16384
$MaxCandidates = 16
$ProbeTimeoutSeconds = 10

function Read-BoundedRequest {
    $Reader = [System.IO.StreamReader]::new(
        [Console]::OpenStandardInput(),
        [System.Text.Encoding]::UTF8,
        $false,
        16384,
        $false
    )
    $Value = $Reader.ReadToEnd()
    if ([System.Text.Encoding]::UTF8.GetByteCount($Value) -gt $MaxRequestBytes) {
        exit 2
    }
    return $Value
}

function Decode-HexString([string]$Value) {
    if ([string]::IsNullOrEmpty($Value) -or ($Value.Length % 2) -ne 0) {
        throw 'invalid hex'
    }
    if ($Value -notmatch '^[0-9A-Fa-f]+$') {
        throw 'invalid hex'
    }
    $Bytes = New-Object byte[] ($Value.Length / 2)
    for ($Index = 0; $Index -lt $Bytes.Length; $Index += 1) {
        $Bytes[$Index] = [Convert]::ToByte($Value.Substring($Index * 2, 2), 16)
    }
    return [System.Text.Encoding]::UTF8.GetString($Bytes)
}

function Encode-HexString([string]$Value) {
    if ([string]::IsNullOrEmpty($Value)) {
        return $null
    }
    $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return 'hex:' + (($Bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Test-SafeAbsolutePath([string]$Path) {
    if ([string]::IsNullOrEmpty($Path) -or $Path -notmatch '^[A-Za-z]:[\\/]') {
        return $false
    }
    if ($Path.StartsWith('\\') -or $Path -match '[\r\n\x00"&|<>^%]') {
        return $false
    }
    return $true
}


function Add-Candidate([System.Collections.Generic.List[string]]$List, [string]$Path) {
    if (-not (Test-SafeAbsolutePath $Path)) {
        return
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }
    try {
        $Item = Get-Item -LiteralPath $Path -Force
        if (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            return
        }
        $Resolved = $Item.FullName
        if ($List.Contains($Resolved)) {
            return
        }
        $List.Add($Resolved)
    } catch {
        return
    }
}

function Invoke-BoundedCommand([string]$Path, [string[]]$Arguments) {
    try {
        $StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
        if ([System.IO.Path]::GetExtension($Path).ToLowerInvariant() -in @('.cmd', '.bat')) {
            $StartInfo.FileName = $env:ComSpec
            $StartInfo.Arguments = '/d /s /c ""' + $Path + '" ' + ($Arguments -join ' ') + '"'
        } else {
            $StartInfo.FileName = $Path
            $StartInfo.Arguments = $Arguments -join ' '
        }
        $StartInfo.RedirectStandardOutput = $true
        $StartInfo.RedirectStandardError = $true
        $StartInfo.UseShellExecute = $false
        $StartInfo.CreateNoWindow = $true
        $Process = [System.Diagnostics.Process]::new()
        $Process.StartInfo = $StartInfo
        if (-not $Process.Start()) {
            return [ordered]@{ ok = $false; output = $null }
        }
        $OutputTask = $Process.StandardOutput.ReadToEndAsync()
        $ErrorTask = $Process.StandardError.ReadToEndAsync()
        if (-not $Process.WaitForExit($ProbeTimeoutSeconds * 1000)) {
            try { $Process.Kill() } catch {}
            return [ordered]@{ ok = $false; output = $null }
        }
        $Output = $OutputTask.Result
        $null = $ErrorTask.Result
        if ([System.Text.Encoding]::UTF8.GetByteCount($Output) -gt 8192) {
            return [ordered]@{ ok = $false; output = $null }
        }
        return [ordered]@{ ok = ($Process.ExitCode -eq 0); output = $Output }
    } catch {
        return [ordered]@{ ok = $false; output = $null }
    }
}

function Invoke-BoundedVersion([string]$Path) {
    return Invoke-BoundedCommand $Path @('--version')
}

function Invoke-BoundedDiscovery([string]$Path) {
    return Invoke-BoundedCommand $Path @('remote-host', 'discovery', '--json')
}

$Request = Read-BoundedRequest
$RuntimeNodeDir = $null
if (Get-Command Resolve-CbcNode -ErrorAction SilentlyContinue) {
    Resolve-CbcNode
    if ($CbcRuntime.Resolved) {
        $env:Path = $CbcRuntime.Dir + ';' + $env:Path
        $RuntimeNodeDir = [string]$CbcRuntime.Dir
    }
}
try {
    $Parsed = $Request | ConvertFrom-Json
} catch {
    exit 2
}
if ($null -eq $Parsed -or $Parsed.schemaVersion -ne 1) {
    exit 2
}

$Candidates = [System.Collections.Generic.List[string]]::new()
foreach ($Encoded in @($Parsed.explicitPaths)) {
    if ($null -eq $Encoded) { continue }
    try {
        Add-Candidate $Candidates (Decode-HexString ([string]$Encoded))
    } catch {
        exit 2
    }
}
foreach ($Encoded in @($Parsed.managedRoots)) {
    if ($null -eq $Encoded) { continue }
    try {
        $Root = Decode-HexString ([string]$Encoded)
        Add-Candidate $Candidates (Join-Path $Root 'codebuddy.cmd')
        Add-Candidate $Candidates (Join-Path $Root 'cbc.cmd')
        Add-Candidate $Candidates (Join-Path $Root 'codebuddy-code.cmd')
        Add-Candidate $Candidates (Join-Path $Root 'bin\codebuddy.exe')
        Add-Candidate $Candidates (Join-Path $Root 'bin\cbc.exe')
        Add-Candidate $Candidates (Join-Path $Root 'bin\codebuddy-code.exe')
    } catch {
        exit 2
    }
}
foreach ($Encoded in @($Parsed.trustedInstallRefs)) {
    if ($null -eq $Encoded) { continue }
    try {
        Add-Candidate $Candidates (Decode-HexString ([string]$Encoded))
    } catch {
        exit 2
    }
}

foreach ($Name in @('codebuddy.exe', 'cbc.exe', 'codebuddy-code.exe', 'codebuddy.cmd', 'cbc.cmd', 'codebuddy-code.cmd')) {
    $Commands = @(Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue)
    foreach ($Command in $Commands) {
        if ($null -ne $Command.Source) {
            Add-Candidate $Candidates ([string]$Command.Source)
        }
    }
}
$Facts = @()
foreach ($Candidate in $Candidates) {
    if ($Facts.Count -ge $MaxCandidates) {
        break
    }
    $Version = Invoke-BoundedVersion $Candidate
    # The discovery command is read-only: it prints static compatibility facts
    # and never starts the remote gateway. Older published CBC packages simply
    # leave protocol facts unknown and are rejected when remote-host protocol 1
    # is required by the control side.
    $Protocol = Invoke-BoundedDiscovery $Candidate
    $ProtocolMin = $null
    $ProtocolMax = $null
    $ProtocolOutput = [string]$Protocol.output
    $VersionText = [string]$Version.output
    $Product = 'unknown'
    if ($Protocol.ok -and -not [string]::IsNullOrEmpty($ProtocolOutput)) {
        try {
            $ProtocolRecord = $ProtocolOutput | ConvertFrom-Json
            if ($ProtocolRecord.schemaVersion -eq 1
                -and ($ProtocolRecord.protocolMin -is [int] -or $ProtocolRecord.protocolMin -is [long])
                -and ($ProtocolRecord.protocolMax -is [int] -or $ProtocolRecord.protocolMax -is [long])) {
                $ProtocolMin = [int]$ProtocolRecord.protocolMin
                $ProtocolMax = [int]$ProtocolRecord.protocolMax
                if ([string]$ProtocolRecord.product -in @('codebuddy', 'cbc', 'codebuddy-code')) {
                    $Product = [string]$ProtocolRecord.product
                }
            }
        } catch {
            $ProtocolMin = $null
            $ProtocolMax = $null
        }
    }
    if ($Product -eq 'unknown' -and $VersionText -match '(?i)codebuddy') {
        $Product = 'codebuddy'
    }
    $Facts += [ordered]@{
        executablePath = Encode-HexString $Candidate
        versionOutput = Encode-HexString ([string]$Version.output)
        product = $Product
        protocolMin = $ProtocolMin
        protocolMax = $ProtocolMax
        protocolRaw = Encode-HexString $(if ($Protocol.ok) { $ProtocolOutput } else { $null })
        executable = $true
        probeSucceeded = [bool]$Version.ok
        nodeDir = Encode-HexString $RuntimeNodeDir
    }
}

[ordered]@{
    schemaVersion = 1
    platform = 'windows'
    candidates = $Facts
} | ConvertTo-Json -Compress -Depth 8
