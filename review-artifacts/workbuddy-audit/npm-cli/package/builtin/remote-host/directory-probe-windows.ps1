Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8, $false, 8192, $false)
$Request = $Reader.ReadToEnd()
if ([System.Text.Encoding]::UTF8.GetByteCount($Request) -gt 8192) { exit 2 }
try {
    $Parsed = $Request | ConvertFrom-Json
} catch {
    exit 2
}
if ($null -eq $Parsed -or $Parsed.schemaVersion -ne 1) { exit 2 }

function Convert-HexString([string]$Value) {
    $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return 'hex:' + (($Bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

$HomeValue = $null
try {
    $Candidate = [System.Environment]::GetFolderPath(
        [System.Environment+SpecialFolder]::UserProfile
    )
    if (-not [string]::IsNullOrEmpty($Candidate)) {
        $HomeValue = Convert-HexString $Candidate
    }
} catch {
    $HomeValue = $null
}

$Roots = @()
try {
    foreach ($Drive in [System.IO.DriveInfo]::GetDrives()) {
        if ($Drive.IsReady) {
            $RootPath = $Drive.RootDirectory.FullName
            $Roots += [ordered]@{
                path = Convert-HexString $RootPath
                label = Convert-HexString $Drive.Name
            }
        }
    }
} catch {
    $Roots = @()
}

$Current = $null
$Parent = $null
$Children = @()
$Truncated = $false
if ($Parsed.mode -eq 'children') {
    if ($null -eq $Parsed.pathBase64 -or [string]::IsNullOrEmpty([string]$Parsed.pathBase64)) {
        exit 3
    }
    try {
        $Requested = [System.Text.Encoding]::UTF8.GetString(
            [System.Convert]::FromBase64String([string]$Parsed.pathBase64)
        )
    } catch {
        exit 3
    }
    if (-not [System.IO.Path]::IsPathRooted($Requested)) { exit 3 }
    if ($Requested.StartsWith('\\')) { exit 6 }
    try {
        $Directory = [System.IO.DirectoryInfo]::new($Requested)
        if (-not $Directory.Exists) { exit 4 }
        $Current = Convert-HexString $Directory.FullName
        if ($null -ne $Directory.Parent) {
            $Parent = Convert-HexString $Directory.Parent.FullName
        }
        $Count = 0
        $OutputBytes = 0
        foreach ($Entry in $Directory.EnumerateDirectories()) {
            if ($Count -ge 256) {
                $Truncated = $true
                break
            }
            $Child = [ordered]@{
                name = Convert-HexString $Entry.Name
                path = Convert-HexString $Entry.FullName
                kind = 'directory'
            }
            $ChildBytes = [System.Text.Encoding]::UTF8.GetByteCount(($Child | ConvertTo-Json -Compress))
            if ($OutputBytes + $ChildBytes -gt 65536) {
                $Truncated = $true
                break
            }
            $OutputBytes += $ChildBytes
            $Children += $Child
            $Count += 1
        }
    } catch {
        exit 4
    }
}

[ordered]@{
    schemaVersion = 1
    platform = 'windows'
    home = $HomeValue
    roots = $Roots
    current = $Current
    parent = $Parent
    children = $Children
    truncated = $Truncated
    encoding = 'utf8'
} | ConvertTo-Json -Compress -Depth 8
