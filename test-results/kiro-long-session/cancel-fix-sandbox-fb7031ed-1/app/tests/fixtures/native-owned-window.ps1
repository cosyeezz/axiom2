param([Parameter(Mandatory=$true)][int]$TargetPid,[Parameter(Mandatory=$true)][string]$ExpectedExe,[ValidateSet('inspect','resize','minimize','restore')][string]$Action='inspect',[int]$Width=0,[int]$Height=0,[int]$Left=[int]::MinValue,[int]$Top=[int]::MinValue)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$p=Get-Process -Id $TargetPid -ErrorAction Stop
if([IO.Path]::GetFileName($ExpectedExe) -notmatch '^Axiom2-ClickAudit-R[0-9]+\.exe$' -or $p.Path -ine $ExpectedExe){throw 'Not the owned native click audit process'}
$handle=$p.MainWindowHandle;if($handle -eq [IntPtr]::Zero){throw 'Native audit main window unavailable'}
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class AuditWindow {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out RECT rect);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window,out RECT rect);
 [DllImport("user32.dll",SetLastError=true)] public static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window,int command);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
}
'@
$prior=[AuditWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
try{
 if($Action -eq 'resize'){
  if($Width -lt 540 -or $Width -gt 2200 -or $Height -lt 600 -or $Height -gt 1600){throw 'Resize outside audit bounds'}
  [uint32]$flags=0x4014
  if($Left -eq [int]::MinValue -or $Top -eq [int]::MinValue){$flags=$flags -bor 2;$Left=0;$Top=0}
  if(-not [AuditWindow]::SetWindowPos($handle,[IntPtr]::Zero,$Left,$Top,$Width,$Height,$flags)){throw 'Native resize request failed'}
 }elseif($Action -eq 'minimize'){[void][AuditWindow]::ShowWindowAsync($handle,7)}elseif($Action -eq 'restore'){[void][AuditWindow]::ShowWindowAsync($handle,4)}
 Start-Sleep -Milliseconds 600
 $outer=[AuditWindow+RECT]::new();$client=[AuditWindow+RECT]::new()
 if(-not [AuditWindow]::GetWindowRect($handle,[ref]$outer) -or -not [AuditWindow]::GetClientRect($handle,[ref]$client)){throw 'Native audit bounds unavailable'}
 $p.Refresh();$result=@{pid=$p.Id;path=$p.Path;responding=$p.Responding;action=$Action;minimized=[AuditWindow]::IsIconic($handle);left=$outer.Left;top=$outer.Top;width=$outer.Right-$outer.Left;height=$outer.Bottom-$outer.Top;clientWidth=$client.Right-$client.Left;clientHeight=$client.Bottom-$client.Top}
}finally{if($prior -ne [IntPtr]::Zero){[void][AuditWindow]::SetThreadDpiAwarenessContext($prior)}}
[Console]::WriteLine(($result|ConvertTo-Json -Compress))
