$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class InputDesktop {
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
}
'@
$desktop = [InputDesktop]::OpenInputDesktop(0,$false,1)
if($desktop -eq [IntPtr]::Zero){throw 'Native desktop acceptance requires a connected, unlocked Windows desktop; this session cannot verify UI interaction.'}
$null=[InputDesktop]::CloseDesktop($desktop)
$process = Start-Process -FilePath $env:AXIOM_DESKTOP_BINARY -PassThru
try {
  $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$process.Id)
  $window = $null
  for ($i=0; $i -lt 100 -and !$window; $i++) {
    Start-Sleep -Milliseconds 200
    $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,$condition)
    if ($process.HasExited) { throw 'Desktop exited before showing a window' }
  }
  if (!$window) { throw 'Desktop window unavailable' }
  function Screenshot {
    try {
    $rect=$window.Current.BoundingRectangle
    if ($rect.Width -le 0 -or $rect.Height -le 0) { return }
    $bitmap=[System.Drawing.Bitmap]::new([int]$rect.Width,[int]$rect.Height)
    $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
    try { $graphics.CopyFromScreen([int]$rect.X,[int]$rect.Y,0,0,$bitmap.Size);$bitmap.Save($env:AXIOM_DESKTOP_SCREENSHOT) } finally { $graphics.Dispose();$bitmap.Dispose() }
    } catch { Write-Warning 'Screen capture unavailable in this Windows desktop session' }
  }
  function Named([string]$name) {
    return $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name))
  }
  function Wait-Named([string]$name) {
    for($i=0;$i -lt 100;$i++) { $element=Named $name; if($element){return $element};Start-Sleep -Milliseconds 200 }
    Screenshot
    $names=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.ControlType.ProgrammaticName + ': ' + $_.Current.Name }
    [IO.File]::WriteAllLines($env:AXIOM_DESKTOP_SCREENSHOT+'.txt', [string[]]@($names), [Text.Encoding]::UTF8)
    throw "Desktop control unavailable: $name"
  }
  $null=Wait-Named '已连接本地服务'
  $null=Wait-Named '新建会话'
  Screenshot
  $settings=Wait-Named '打开应用配置'
  $settings.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  $null=Wait-Named '子任务并发与预算'
  Write-Output 'PASS: packaged Windows window automatically connected to fixed-port local service and opened product settings.'
} finally {
  if (!$process.HasExited) { $null=$process.CloseMainWindow(); if(!$process.WaitForExit(5000)){$process.Kill()} }
}
