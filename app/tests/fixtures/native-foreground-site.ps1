param([ValidateSet('node','tailscale','release')][string]$Site)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;using System.Runtime.InteropServices;public static class AuditForeground { [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid); }
'@
$expected=switch($Site){'node'{'nodejs.org/en/download'}'tailscale'{'tailscale.com/download'}'release'{'github.com/cosyeezz/axiom2/releases'}}
$expectedTitle=switch($Site){'node'{'Node\.js'}'tailscale'{'Tailscale'}'release'{'cosyeezz/axiom2'}}
$result=@{site=$Site;expectedUri=$expected;matchedAddress=$false;matchedTitle=$false;browserObserved=$false}
$end=[DateTime]::UtcNow.AddSeconds(15)
do{
 $handle=[AuditForeground]::GetForegroundWindow();[uint32]$processId=0;[void][AuditForeground]::GetWindowThreadProcessId($handle,[ref]$processId)
 $p=Get-Process -Id $processId -ErrorAction SilentlyContinue
 if($p -and $p.ProcessName -match '^(chrome|msedge|firefox|brave|vivaldi)$'){
  $result.browserObserved=$true;$result.process=$p.ProcessName;$result.handle=[long]$handle
  try{
   $window=[Windows.Automation.AutomationElement]::FromHandle($handle)
   $result.matchedTitle=($window.Current.Name -match $expectedTitle)
   $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Edit)
   foreach($edit in $window.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)){
    if($edit.Current.Name -notmatch '地址|address'){continue}
    $pattern=$null
    if($edit.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){
     $value=$pattern.Current.Value -replace '^https?://',''
     if($value.StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)){$result.matchedAddress=$true}
     # Never print, hash or save any other browser address or field content.
     $value=$null
    }
   }
  }catch{}
  if($result.matchedAddress -and $result.matchedTitle){break}
 }
 Start-Sleep -Milliseconds 400
}while([DateTime]::UtcNow -lt $end)
[Console]::WriteLine(($result|ConvertTo-Json -Compress))
