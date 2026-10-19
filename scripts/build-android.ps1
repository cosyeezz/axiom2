param(
  [string]$JavaHome = 'C:\Program Files\JetBrains\IntelliJ IDEA 2026.1.1\jbr',
  [string]$AndroidPlatform = 'F:\Tools\Android\platforms\android-35',
  [string]$BuildTools = 'F:\Tools\Android\build-tools\android-15',
  [string]$OutputDirectory = '',
  [string]$ClientVersion = ''
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$android = Join-Path $repo 'app\android'
$version = if ($ClientVersion) { $ClientVersion } else { (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version }
if ($version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw "Invalid release version: $version" }
$major = [long]$Matches[1]; $minor = [long]$Matches[2]; $patch = [long]$Matches[3]
$versionCode = $major * 1000000 + $minor * 1000 + $patch
if ($minor -gt 999 -or $patch -gt 999 -or $versionCode -le 404 -or $versionCode -gt 2100000000) { throw "Release version cannot be encoded as an upgradeable Android versionCode: $version" }
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repo 'artifacts\android' }
$build = Join-Path $OutputDirectory 'build'
$java = Join-Path $JavaHome 'bin\java.exe'
$javac = Join-Path $JavaHome 'bin\javac.exe'
$platformJar = Join-Path $AndroidPlatform 'android.jar'
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
Run $aapt @('link','-o',$unsigned,'-I',$platformJar,'--manifest',(Join-Path $android 'app\src\main\AndroidManifest.xml'),'--version-name',$version,'--version-code',[string]$versionCode,'--java',$generated,$resources)
$buildConfig = Join-Path $generated 'com\axiom2\android\BuildConfig.java'
[System.IO.File]::WriteAllText($buildConfig,'package com.axiom2.android; public final class BuildConfig { public static final boolean DEBUG = false; }')
$appSources = @(Get-ChildItem (Join-Path $android 'app\src\main\java'),$generated -Recurse -Filter '*.java' | ForEach-Object FullName)
Run $javac (@('--release','8','-encoding','UTF-8','-classpath',"$platformJar;$sdkJar",'-d',$appClasses) + $appSources)
$appJar = Join-Path $build 'app.jar'; ZipDirectory $appClasses $appJar
Run $java @('-cp',(Join-Path $BuildTools 'lib\d8.jar'),'com.android.tools.r8.D8','--release','--min-api','26','--lib',$platformJar,'--output',$dex,$sdkJar,$appJar)
$zip = [System.IO.Compression.ZipFile]::Open($unsigned,[System.IO.Compression.ZipArchiveMode]::Update)
try { Get-ChildItem $dex -Filter '*.dex' | ForEach-Object { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$_.FullName,$_.Name) | Out-Null } } finally { $zip.Dispose() }
$aligned = Join-Path $build 'aligned.apk'; Run (Join-Path $BuildTools 'zipalign.exe') @('-f','-p','4',$unsigned,$aligned)
$signing = Join-Path $env:LOCALAPPDATA 'Axiom2\android-signing'; New-Item -ItemType Directory -Force $signing | Out-Null
$keystore = Join-Path $signing 'release.p12'; $passwordFile = Join-Path $signing 'password.dpapi'
if (!(Test-Path $keystore)) {
  $random = New-Object byte[] 32; $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($random); $rng.Dispose()
  $password = [Convert]::ToBase64String($random)
  ConvertTo-SecureString $password -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $passwordFile
  $env:AXIOM_ANDROID_STOREPASS = $password
  Run (Join-Path $JavaHome 'bin\keytool.exe') @('-genkeypair','-keystore',$keystore,'-storetype','PKCS12','-storepass:env','AXIOM_ANDROID_STOREPASS','-alias','axiom2','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Axiom2 Android, O=Axiom2')
} else {
  $secure = (Get-Content $passwordFile -Raw).Trim() | ConvertTo-SecureString
  $env:AXIOM_ANDROID_STOREPASS = [System.Net.NetworkCredential]::new('', $secure).Password
}
$apk = Join-Path $OutputDirectory 'Axiom2-Android.apk'
try { Run $java @('-jar',(Join-Path $BuildTools 'lib\apksigner.jar'),'sign','--ks',$keystore,'--ks-key-alias','axiom2','--ks-pass','env:AXIOM_ANDROID_STOREPASS','--out',$apk,$aligned) }
finally { Remove-Item Env:\AXIOM_ANDROID_STOREPASS -ErrorAction SilentlyContinue }
Run $java @('-jar',(Join-Path $BuildTools 'lib\apksigner.jar'),'verify','--verbose',$apk)
Run $aapt @('dump','badging',$apk)
Get-FileHash $apk,(Join-Path $OutputDirectory 'axiom2-android-sdk.aar') -Algorithm SHA256 | ForEach-Object { "$($_.Hash.ToLower())  $([System.IO.Path]::GetFileName($_.Path))" } | Set-Content (Join-Path $OutputDirectory 'SHA256SUMS.txt')
Write-Output "APK and SDK: $OutputDirectory"
