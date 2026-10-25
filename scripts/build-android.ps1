param(
  [string]$JavaHome = 'C:\Program Files\JetBrains\IntelliJ IDEA 2026.1.1\jbr',
  [string]$AndroidPlatform = 'F:\Tools\Android\platforms\android-35',
  [string]$BuildTools = 'F:\Tools\Android\build-tools\android-15',
  [string]$OutputDirectory = '',
  [string]$ClientVersion = '',
  [string]$SigningStore = '',
  [string]$ExpectedCertificateSha256 = 'ae00055c6143ea3739613150527aed2f91135daab0ab9c8ef0dd2e74872993a2',
  [long]$MinimumVersionCode = 4012
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$android = Join-Path $repo 'app\android'
$version = if ($ClientVersion) { $ClientVersion } else { (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version }
if ($version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw "Invalid release version: $version" }
$major = [long]$Matches[1]; $minor = [long]$Matches[2]; $patch = [long]$Matches[3]
$versionCode = $major * 1000000 + $minor * 1000 + $patch
if ($minor -gt 999 -or $patch -gt 999 -or $versionCode -le 404 -or $versionCode -gt 2100000000) { throw "Release version cannot be encoded as an upgradeable Android versionCode: $version" }
if ($versionCode -le $MinimumVersionCode) { throw "Android release must upgrade versionCode $MinimumVersionCode, got $versionCode" }
$ExpectedCertificateSha256 = $ExpectedCertificateSha256.Replace(':','').ToLowerInvariant()
if ($ExpectedCertificateSha256 -notmatch '^[a-f0-9]{64}$') { throw 'A trusted Android signing certificate SHA-256 is required' }
$localSigning = !$SigningStore
$signing = Join-Path $env:LOCALAPPDATA 'Axiom2\android-signing'
if ($localSigning) { $SigningStore = Join-Path $signing 'release.p12' }
if (!(Test-Path -LiteralPath $SigningStore -PathType Leaf)) { throw 'Original Android release keystore is missing; refusing to create a new upgrade-incompatible signing key' }
if (!$localSigning -and !$env:AXIOM_ANDROID_STOREPASS) { throw 'Android release signing password is missing' }
if ($localSigning -and !(Test-Path -LiteralPath (Join-Path $signing 'password.dpapi') -PathType Leaf)) { throw 'Original Android signing password is missing' }
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repo 'artifacts\android' }
$build = Join-Path $OutputDirectory 'build'
$java = Join-Path $JavaHome 'bin\java.exe'
$javac = Join-Path $JavaHome 'bin\javac.exe'
$platformJar = Join-Path $AndroidPlatform 'android.jar'
$qrJar = Join-Path $android 'libs\core-3.5.3.jar'
if ((Get-FileHash $qrJar -Algorithm SHA256).Hash.ToLower() -ne '8d8064c1636fdaef7189dd9055c7d59950a8940a12f2293956446ec3c109fd82') { throw 'ZXing dependency checksum mismatch' }
foreach ($required in @($java,$javac,$platformJar,(Join-Path $BuildTools 'aapt2.exe'))) { if (!(Test-Path $required)) { throw "Missing build tool: $required" } }
New-Item -ItemType Directory -Force $build,$OutputDirectory | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Run([string]$Program, [string[]]$Arguments) { & $Program @Arguments; if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" } }
function ZipDirectory([string]$Directory,[string]$Destination) {
  if (Test-Path $Destination) { Remove-Item $Destination }
  $archive = [System.IO.Compression.ZipFile]::Open($Destination,[System.IO.Compression.ZipArchiveMode]::Create)
  try { Get-ChildItem $Directory -Recurse -File | ForEach-Object { $entry = $_.FullName.Substring($Directory.Length + 1).Replace('\','/'); [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$_.FullName,$entry) | Out-Null } } finally { $archive.Dispose() }
}
$sdkClasses = Join-Path $build 'sdk-classes'; $appClasses = Join-Path $build 'app-classes'; $generated = Join-Path $build 'generated'; $dex = Join-Path $build 'dex'; $aar = Join-Path $build 'aar'
foreach ($directory in @($sdkClasses,$appClasses,$generated,$dex,$aar)) { if (Test-Path $directory) { Remove-Item -Recurse -Force $directory }; New-Item -ItemType Directory -Force $directory | Out-Null }
$sdkSources = @(Get-ChildItem (Join-Path $android 'sdk\src\main\java') -Recurse -Filter '*.java' | ForEach-Object FullName)
Run $javac (@('--release','8','-encoding','UTF-8','-classpath',$platformJar,'-d',$sdkClasses) + $sdkSources)
$sdkJar = Join-Path $build 'sdk.jar'; ZipDirectory $sdkClasses $sdkJar
Copy-Item $sdkJar (Join-Path $aar 'classes.jar'); Copy-Item (Join-Path $android 'sdk\src\main\AndroidManifest.xml') (Join-Path $aar 'AndroidManifest.xml')
[System.IO.File]::WriteAllText((Join-Path $aar 'R.txt'),'')
ZipDirectory $aar (Join-Path $OutputDirectory 'axiom2-android-sdk.aar')
$aapt = Join-Path $BuildTools 'aapt2.exe'; $resources = Join-Path $build 'resources.zip'
Run $aapt @('compile','--dir',(Join-Path $android 'app\src\main\res'),'-o',$resources)
$unsigned = Join-Path $build 'unsigned.apk'
Run $aapt @('link','-o',$unsigned,'-I',$platformJar,'--manifest',(Join-Path $android 'app\src\main\AndroidManifest.xml'),'--version-name',$version,'--version-code',[string]$versionCode,'--java',$generated,'-A',(Join-Path $android 'app\src\main\assets'),$resources)
$buildConfig = Join-Path $generated 'com\axiom2\android\BuildConfig.java'
[System.IO.File]::WriteAllText($buildConfig,'package com.axiom2.android; public final class BuildConfig { public static final boolean DEBUG = false; }')
$appSources = @(Get-ChildItem (Join-Path $android 'app\src\main\java'),$generated -Recurse -Filter '*.java' | ForEach-Object FullName)
Run $javac (@('--release','8','-encoding','UTF-8','-classpath',"$platformJar;$sdkJar;$qrJar",'-d',$appClasses) + $appSources)
$appJar = Join-Path $build 'app.jar'; ZipDirectory $appClasses $appJar
Run $java @('-cp',(Join-Path $BuildTools 'lib\d8.jar'),'com.android.tools.r8.D8','--release','--min-api','26','--lib',$platformJar,'--output',$dex,$sdkJar,$appJar,$qrJar)
$zip = [System.IO.Compression.ZipFile]::Open($unsigned,[System.IO.Compression.ZipArchiveMode]::Update)
try { Get-ChildItem $dex -Filter '*.dex' | ForEach-Object { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$_.FullName,$_.Name) | Out-Null } } finally { $zip.Dispose() }
$aligned = Join-Path $build 'aligned.apk'; Run (Join-Path $BuildTools 'zipalign.exe') @('-f','-p','4',$unsigned,$aligned)
$apk = Join-Path $OutputDirectory 'Axiom2-Android.apk'
$previousPassword = $env:AXIOM_ANDROID_STOREPASS
try {
  if ($localSigning) {
    $secure = (Get-Content (Join-Path $signing 'password.dpapi') -Raw).Trim() | ConvertTo-SecureString
    try { $env:AXIOM_ANDROID_STOREPASS = [System.Net.NetworkCredential]::new('', $secure).Password } finally { $secure.Dispose() }
  }
  Run $java @('-jar',(Join-Path $BuildTools 'lib\apksigner.jar'),'sign','--ks',$SigningStore,'--ks-key-alias','axiom2','--ks-pass','env:AXIOM_ANDROID_STOREPASS','--out',$apk,$aligned)
} finally {
  if ($null -eq $previousPassword) { Remove-Item Env:\AXIOM_ANDROID_STOREPASS -ErrorAction SilentlyContinue } else { $env:AXIOM_ANDROID_STOREPASS = $previousPassword }
}
$verification = & $java @('-jar',(Join-Path $BuildTools 'lib\apksigner.jar'),'verify','--verbose','--print-certs',$apk)
if ($LASTEXITCODE -ne 0) { throw 'Release APK signature verification failed' }
$verification | Write-Output
$signers = @($verification | Select-String -Pattern '^Signer #[0-9]+ certificate SHA-256 digest: ([a-fA-F0-9]{64})$')
if ($signers.Count -ne 1 -or $signers[0].Matches[0].Groups[1].Value.ToLowerInvariant() -ne $ExpectedCertificateSha256) { throw 'Release APK certificate differs from the original production certificate' }
$badging = & $aapt @('dump','badging',$apk)
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect release APK metadata' }
$badging | Write-Output
$metadata = $badging -join "`n"
if ($metadata -cnotmatch "(?m)^package: name='com\.axiom2\.android' versionCode='$versionCode' versionName='$([regex]::Escape($version))'" -or $metadata -notmatch "(?m)^sdkVersion:'26'" -or $metadata -notmatch "(?m)^targetSdkVersion:'35'" -or $metadata -match '(?m)^application-debuggable') { throw 'APK package, version, SDK, or release-mode validation failed' }
Run (Join-Path $BuildTools 'zipalign.exe') @('-c','-p','4',$apk)
$files = @(Get-FileHash $apk,(Join-Path $OutputDirectory 'axiom2-android-sdk.aar') -Algorithm SHA256)
$files | ForEach-Object { "$($_.Hash.ToLower())  $([System.IO.Path]::GetFileName($_.Path))" } | Set-Content -Encoding ascii (Join-Path $OutputDirectory 'SHA256SUMS.txt')
$source = & git -C $repo rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Unable to record Android release source revision' }
$proof = @{ source = $source.Trim(); version = $version; versionCode = $versionCode; packageName = 'com.axiom2.android'; minSdk = 26; targetSdk = 35; debuggable = $false; certificateSha256 = $ExpectedCertificateSha256; files = @{} }
foreach ($file in $files) { $proof.files[[System.IO.Path]::GetFileName($file.Path)] = @{ sha256 = $file.Hash.ToLowerInvariant(); size = (Get-Item -LiteralPath $file.Path).Length } }
[System.IO.File]::WriteAllText((Join-Path $OutputDirectory 'android-release.json'), ($proof | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
Write-Output "APK and SDK: $OutputDirectory"
