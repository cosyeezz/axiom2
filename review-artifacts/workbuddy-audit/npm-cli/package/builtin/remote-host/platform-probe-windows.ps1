Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NullableString([object]$Value) {
    if ($null -eq $Value) { return $null }
    $Text = [string]$Value
    if ($Text.Length -eq 0) { return $null }
    return $Text
}

function Test-CommandAvailable([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

$OsVersion = $null
try {
    $OsVersion = Get-NullableString ([System.Environment]::OSVersion.Version.ToString())
} catch {
    $OsVersion = $null
}

$UserId = $null
try {
    $Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $UserId = Get-NullableString $Identity.User.Value
} catch {
    $UserId = $null
}

$Home = $null
try {
    $Home = Get-NullableString ([System.Environment]::GetFolderPath(
        [System.Environment+SpecialFolder]::UserProfile
    ))
} catch {
    $Home = $null
}

function Convert-Architecture([object]$Value) {
    switch ($Value) {
        ([System.Runtime.InteropServices.Architecture]::X64) { return 'x64' }
        ([System.Runtime.InteropServices.Architecture]::Arm64) { return 'arm64' }
        ([System.Runtime.InteropServices.Architecture]::X86) { return 'x86' }
        ([System.Runtime.InteropServices.Architecture]::Arm) { return 'arm32' }
    }
    return 'unknown'
}

$ProcessArch = 'unknown'
$NativeArch = 'unknown'
$KernelArch = 'unknown'
try {
    $ProcessArch = Convert-Architecture (
        [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
    )
} catch {
    $ProcessArch = 'unknown'
}
try {
    $OsArchitecture = Convert-Architecture (
        [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    )
    $NativeArch = $OsArchitecture
    $KernelArch = $OsArchitecture
} catch {
    $NativeArch = 'unknown'
    $KernelArch = 'unknown'
}

$Os = 'windows'
$Libc = 'unknown'
$LibcVersion = $null
$Wsl = 'none'
$Rosetta = 'notApplicable'
$DiskFreeBytes = $null
$DesktopPresent = $null
$DesktopKind = $null

$Tools = [ordered]@{
    curl = if (Test-CommandAvailable 'curl.exe') { $true } else { $false }
    tar = if (Test-CommandAvailable 'tar.exe') { $true } else { $false }
    unzip = if (Test-CommandAvailable 'Expand-Archive') { $true } else { $false }
    sha256 = if (Test-CommandAvailable 'Get-FileHash') { $true } else { $false }
}

$Payload = [ordered]@{
    schemaVersion = 1
    probeKind = 'windows'
    os = $Os
    osVersion = $OsVersion
    kernelArch = $KernelArch
    nativeArch = $NativeArch
    processArch = $ProcessArch
    libc = $Libc
    libcVersion = $LibcVersion
    wsl = $Wsl
    rosetta = $Rosetta
    home = $Home
    userId = $UserId
    shellKind = 'powershell'
    tools = $Tools
    diskFreeBytes = $DiskFreeBytes
    desktop = [ordered]@{ present = $DesktopPresent; kind = $DesktopKind }
}

$Payload | ConvertTo-Json -Compress
