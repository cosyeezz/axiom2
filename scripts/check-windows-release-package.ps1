$ErrorActionPreference = 'Stop'
$work = Join-Path $PWD 'artifacts/windows-package-check'
New-Item -ItemType Directory -Path $work -Force | Out-Null
$result = [ordered]@{ success = $false; errors = @() }
$failure = $null
$attempted = $false
$productCode = $null
$installDirectory = Join-Path $env:RUNNER_TEMP 'axiom-release-installed'
function Invoke-Com($object, [string] $name, [Reflection.BindingFlags] $flags, [object[]] $arguments) {
  return $object.GetType().InvokeMember($name, $flags, $null, $object, $arguments)
}
function Product-IsRegistered {
  foreach ($root in @('Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (Test-Path "$root\$productCode") { return $true }
  }
  return $false
}
function Invoke-Msi([string] $arguments) {
  $process = Start-Process msiexec.exe -ArgumentList $arguments -PassThru
  try {
    if (-not $process.WaitForExit(180000)) { $process.Kill($true); $process.WaitForExit(10000) | Out-Null; throw 'msiexec exceeded 180 seconds; service transaction termination is not assumed' }
    return $process.ExitCode
  } finally { $process.Dispose() }
}
function Check-Window([string] $binary, [string] $name) {
  $data = Join-Path $work "$name-data"
  New-Item -ItemType Directory -Path $data | Out-Null
  $previousData = $env:AXIOM_DATA_DIR
  $env:AXIOM_DATA_DIR = $data
  $process = $null
  try {
    $process = Start-Process -FilePath $binary -PassThru -RedirectStandardOutput (Join-Path $work "$name-stdout.log") -RedirectStandardError (Join-Path $work "$name-stderr.log")
    $stable = 0
    $lastWindow = ''
    for ($i = 0; $i -lt 45; $i++) {
      Start-Sleep -Seconds 1
      $process.Refresh()
      if ($process.HasExited) { throw "$name exited before a stable window: $($process.ExitCode)" }
      $handle = $process.MainWindowHandle
      $bounds = New-Object AxiomReleaseWindow+Rect
      $valid = $handle -ne 0 -and [AxiomReleaseWindow]::IsWindowVisible($handle) -and [AxiomReleaseWindow]::GetWindowRect($handle, [ref] $bounds)
      $width = $bounds.Right - $bounds.Left
      $height = $bounds.Bottom - $bounds.Top
      $signature = "$handle/$($bounds.Left)/$($bounds.Top)/$width/$height/$($process.MainWindowTitle)"
      if ($valid -and $width -ge 360 -and $height -ge 600 -and -not [string]::IsNullOrWhiteSpace($process.MainWindowTitle)) {
        if ($signature -eq $lastWindow) { $stable++ } else { $stable = 1 }
      } else { $stable = 0 }
      $lastWindow = $signature
      if ($stable -ge 3) {
        [AxiomReleaseWindow]::SetForegroundWindow($handle) | Out-Null
        Start-Sleep -Milliseconds 250
        $process.Refresh()
        if ($process.HasExited -or $process.MainWindowHandle -ne $handle) { throw "$name window disappeared before capture" }
        $image = New-Object Drawing.Bitmap($width, $height)
        $graphics = [Drawing.Graphics]::FromImage($image)
        try {
          $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $image.Size)
          $image.Save((Join-Path $work "$name-window.png"), [Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $image.Dispose() }
        return @{ pid = $process.Id; window = $handle.ToInt64(); title = $process.MainWindowTitle; width = $width; height = $height; stableSeconds = $stable; dataRoot = $data }
      }
    }
    throw "$name did not open a stable visible native window within 45 seconds"
  } finally {
    if ($process) {
      if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit(10000) | Out-Null }
      $process.Dispose()
    }
    if ($null -eq $previousData) { Remove-Item Env:AXIOM_DATA_DIR -ErrorAction SilentlyContinue } else { $env:AXIOM_DATA_DIR = $previousData }
  }
}
try {
  $result.source = Get-Content (Join-Path $work 'source.json') -Raw | ConvertFrom-Json
  $expectedVersion = $result.source.tag -replace '^v', ''
  if ($expectedVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid expected version' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  Add-Type -AssemblyName System.Drawing
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AxiomReleaseWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
}
'@
  $archive = Join-Path $work 'build.zip'
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  try {
    $entries = @($zip.Entries | ForEach-Object { $_.FullName } | Sort-Object)
    if (($entries -join ',') -ne 'Axiom2.exe,Axiom2.msi') { throw "Unexpected archive entries: $entries" }
  } finally { $zip.Dispose() }
  $payload = Join-Path $work 'payload'
  Expand-Archive -LiteralPath $archive -DestinationPath $payload
  $exe = Join-Path $payload 'Axiom2.exe'
  $msi = Join-Path $payload 'Axiom2.msi'
  $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
  $pattern = '^' + [regex]::Escape($expectedVersion) + '(?:\.0)?$'
  if ($version.ProductVersion -notmatch $pattern -or $version.FileVersion -notmatch $pattern) { throw "Incorrect PE versions: $($version.ProductVersion), $($version.FileVersion)" }
  $result.exeSha256 = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  $result.msiSha256 = (Get-FileHash $msi -Algorithm SHA256).Hash.ToLowerInvariant()
  $result.peProductVersion = $version.ProductVersion
  $result.peFileVersion = $version.FileVersion
  $installer = New-Object -ComObject WindowsInstaller.Installer
  $database = $null
  $summary = $null
  try {
    $database = Invoke-Com $installer 'OpenDatabase' ([Reflection.BindingFlags]::InvokeMethod) @($msi, 0)
    function Read-MsiProperty([string] $name) {
      $view = Invoke-Com $database 'OpenView' ([Reflection.BindingFlags]::InvokeMethod) @("SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = '$name'")
      $record = $null
      try {
        Invoke-Com $view 'Execute' ([Reflection.BindingFlags]::InvokeMethod) @() | Out-Null
        $record = Invoke-Com $view 'Fetch' ([Reflection.BindingFlags]::InvokeMethod) @()
        if (-not $record) { throw "Missing MSI property $name" }
        return Invoke-Com $record 'StringData' ([Reflection.BindingFlags]::GetProperty) @(1)
      } finally {
        Invoke-Com $view 'Close' ([Reflection.BindingFlags]::InvokeMethod) @() | Out-Null
        if ($record) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) | Out-Null }
        [Runtime.InteropServices.Marshal]::FinalReleaseComObject($view) | Out-Null
      }
    }
    $result.msiVersion = Read-MsiProperty 'ProductVersion'
    $productCode = Read-MsiProperty 'ProductCode'
    if ($result.msiVersion -ne $expectedVersion) { throw "Incorrect MSI version: $($result.msiVersion)" }
    if ($productCode -notmatch '^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$') { throw 'Invalid product code' }
    $summary = Invoke-Com $database 'SummaryInformation' ([Reflection.BindingFlags]::GetProperty) @(0)
    $result.msiTemplate = Invoke-Com $summary 'Property' ([Reflection.BindingFlags]::GetProperty) @(7)
    if ($result.msiTemplate -notmatch '^x64;') { throw "Incorrect MSI platform: $($result.msiTemplate)" }
    $result.productCode = $productCode
  } finally {
    foreach ($object in @($summary, $database, $installer)) { if ($object) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($object) | Out-Null } }
  }
  if (Product-IsRegistered) { throw 'Refusing to replace a pre-existing product on the runner' }
  if (Test-Path -LiteralPath $installDirectory) { throw 'Refusing a pre-existing installation directory' }
  $result.portable = Check-Window $exe 'portable'
  $installLog = Join-Path $work 'install.log'
  $uninstallLog = Join-Path $work 'uninstall.log'
  $attempted = $true
  $result.installExit = Invoke-Msi "/i `"$msi`" /qn /norestart INSTALLDIR=`"$installDirectory`" /l*v `"$installLog`""
  if ($result.installExit -notin @(0, 3010)) { throw "MSI installation failed: $($result.installExit)" }
  if (-not (Product-IsRegistered)) { throw 'MSI product is not registered after installation' }
  $candidates = @(Get-ChildItem -LiteralPath $installDirectory -Recurse -Filter '*.exe' -File)
  $installedExe = $candidates | Where-Object { (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -eq $result.exeSha256 } | Select-Object -First 1
  if (-not $installedExe) { throw 'Installed payload does not match the verified portable executable' }
  $result.installedExecutable = $installedExe.FullName
  $result.installed = Check-Window $installedExe.FullName 'installed'
} catch {
  $failure = $_
  $result.errors += $_.ToString()
} finally {
  try {
    if ($attempted) {
      $result.cleanupBusyRetries = 0
      for ($retry = 0; $retry -lt 8; $retry++) {
        $result.uninstallExit = Invoke-Msi "/x $productCode /qn /norestart /l*v `"$uninstallLog`""
        if ($result.uninstallExit -ne 1618) { break }
        $result.cleanupBusyRetries++
        if ($retry -lt 7) { Start-Sleep -Seconds 15 }
      }
      if ($result.uninstallExit -notin @(0, 3010, 1605)) { throw "MSI uninstall failed: $($result.uninstallExit)" }
      if (Product-IsRegistered) { throw 'Product remains registered after MSI uninstall' }
      $remaining = @()
      if (Test-Path -LiteralPath $installDirectory -ErrorAction Stop) { $remaining = @(Get-ChildItem -LiteralPath $installDirectory -Recurse -File -Force -ErrorAction Stop) }
      $result.remainingInstalledFiles = @($remaining | ForEach-Object { $_.FullName })
      if ($remaining.Count -gt 0) { throw 'Installed files remain after MSI uninstall' }
      $result.uninstallVerified = $true
    }
  } catch {
    $result.errors += $_.ToString()
    if (-not $failure) { $failure = $_ }
  } finally {
    $result.success = (-not $failure)
    $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $work 'windows-package.json') -Encoding utf8
  }
}
$result | ConvertTo-Json -Depth 12
if ($failure) { throw $failure }
