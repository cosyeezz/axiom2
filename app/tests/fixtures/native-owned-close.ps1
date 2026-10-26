param([Parameter(Mandatory=$true)][int]$TargetPid,[Parameter(Mandatory=$true)][string]$ExpectedExe,[Parameter(Mandatory=$true)][string]$ExpectedSha256)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if([IO.Path]::GetFileName($ExpectedExe) -notmatch '^Axiom2-ClickAudit-R[0-9]+\.exe$'){throw 'Only an owned audit binary may be closed'}
$p=Get-Process -Id $TargetPid -ErrorAction Stop
if($p.Path -ine $ExpectedExe -or (Get-FileHash -LiteralPath $ExpectedExe -Algorithm SHA256).Hash -ine $ExpectedSha256){throw 'Native audit process identity changed'}
$started=$p.StartTime.ToUniversalTime().ToString('o');$null=$p.Handle
if(-not $p.Responding){throw 'Owned UI does not respond; do not force kill'}
$requested=$p.CloseMainWindow()
if(-not $requested){throw 'Normal CloseMainWindow request was not sent'}
$exited=$p.WaitForExit(20000)
if(-not $exited){throw 'Owned UI did not exit normally; no process was killed and no lock was removed'}
[Console]::WriteLine((@{pid=$TargetPid;path=$ExpectedExe;startedAt=$started;normalCloseRequested=$requested;exitCode=$p.ExitCode;exited=$exited;noKill=$true;noLockRemoval=$true}|ConvertTo-Json -Compress))
