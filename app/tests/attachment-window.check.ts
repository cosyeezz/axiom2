// Windows desktop integration: drives the UNMODIFIED native host via UI Automation.
// Requires an unlocked desktop; this is intentionally separate from headless unit tests.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { WindowsOpenHost } from "../src/server/windows-open-host.js";

if (process.platform !== "win32") throw Error("This check requires a Windows desktop session.");
const root = mkdtempSync(join(tmpdir(), "axiom-visible-picker-"));
const paths = [join(root, "中文 😀 notes & $.txt"), join(root, "image.png"), join(root, "空 folder")];
writeFileSync(paths[0], "test"); writeFileSync(paths[1], "path classification only"); mkdirSync(paths[2]); mkdirSync(join(root, "second folder"));
const probe = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeProbe {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
  delegate bool Callback(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr state);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int max);
  public static IntPtr Find(uint process) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr s) { uint p; GetWindowThreadProcessId(h, out p); if (p == process) { var b = new System.Text.StringBuilder(512); GetWindowText(h,b,512); if (b.ToString() == "Axiom Open test") found = h; } return true; }, IntPtr.Zero);
    return found;
  }
  public static string Windows(uint process) {
    var names = new System.Collections.Generic.List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr s) { uint p; GetWindowThreadProcessId(h, out p); if (p == process) { var b = new System.Text.StringBuilder(512); GetWindowText(h,b,512); names.Add(h + ":" + b + ":" + IsWindowVisible(h)); } return true; }, IntPtr.Zero);
    return String.Join(";",names);
  }
}
'@
$window = $null
for ($i = 0; $i -lt 60; $i++) {
  $handle = [NativeProbe]::Find([uint32]$env:AXIOM_PROBE_PID)
  if ($handle -ne [IntPtr]::Zero -and [NativeProbe]::IsWindowVisible($handle)) {
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    break
  }
  Start-Sleep -Milliseconds 200
}
if ($null -eq $window -or -not [NativeProbe]::IsWindowVisible([IntPtr]$window.Current.NativeWindowHandle)) { throw ('Native dialog is not OS-visible: ' + [NativeProbe]::Windows([uint32]$env:AXIOM_PROBE_PID)) }
$names = ConvertFrom-Json -InputObject $env:AXIOM_PROBE_NAMES
$expectedCount = [int]$env:AXIOM_PROBE_COUNT
if ($expectedCount -eq 0) {
  [void][NativeProbe]::PostMessage($handle, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
  exit 0
}
$selected = 0
for ($i = 0; $i -lt 30; $i++) {
  $items = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $selected = 0
  foreach ($item in $items) {
    if ($names -contains $item.Current.Name) {
      $pattern = $null
      if ($item.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
        if ($selected -eq 0) { $pattern.Select() } else { $pattern.AddToSelection() }
        $selected++
      }
    }
  }
  if ($selected -eq $expectedCount) { break }
  Start-Sleep -Milliseconds 200
}
if ($selected -ne $expectedCount) {
  Add-Type -AssemblyName System.Drawing
  $rect = $window.Current.BoundingRectangle
  $bitmap = New-Object System.Drawing.Bitmap([int]$rect.Width, [int]$rect.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try { $graphics.CopyFromScreen([int]$rect.X, [int]$rect.Y, 0, 0, $bitmap.Size); $bitmap.Save((Join-Path $env:TEMP 'axiom-open-probe.png')) } finally { $graphics.Dispose(); $bitmap.Dispose() }
  $summary = @($items | ForEach-Object { $_.Current.ControlType.ProgrammaticName + ':' + $_.Current.Name }) -join '; '
  throw "Expected $expectedCount selectable filesystem items, got $selected. $summary"
}
$buttonCondition = if ($env:AXIOM_PROBE_KIND -eq 'mixed') {
  New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '选择所选项目')
} else {
  New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '打开')
}
$buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
$invoked = $false
foreach ($button in $buttons) {
  $target = $button
  for ($depth = 0; $depth -lt 4 -and $null -ne $target; $depth++) {
    $pattern = $null
    if ($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
      $pattern.Invoke(); $invoked = $true; break
    }
    $target = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($target)
  }
  if ($invoked) { break }
  if ($button.Current.NativeWindowHandle -ne 0) {
    # Shell custom buttons expose an HWND but not the managed UIA Invoke pattern.
    [void][NativeProbe]::PostMessage([IntPtr]$button.Current.NativeWindowHandle, 0xF5, [IntPtr]::Zero, [IntPtr]::Zero)
    $invoked = $true; break
  }
}
if (-not $invoked) {
  Add-Type -AssemblyName System.Drawing
  $rect = $window.Current.BoundingRectangle
  $bitmap = New-Object System.Drawing.Bitmap([int]$rect.Width, [int]$rect.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try { $graphics.CopyFromScreen([int]$rect.X, [int]$rect.Y, 0, 0, $bitmap.Size); $bitmap.Save((Join-Path $env:TEMP 'axiom-open-probe.png')) } finally { $graphics.Dispose(); $bitmap.Dispose() }
  throw ('Missing invokable mixed selection button: ' + (@($buttons | ForEach-Object { $_.Current.ControlType.ProgrammaticName + ':' + $_.Current.Name + ':' + $_.Current.NativeWindowHandle + ':' + $_.Current.IsEnabled }) -join ';'))
}
[Console]::WriteLine('OS_VISIBLE=True;SELECTED=3')
`;
const host = new WindowsOpenHost();
try {
  const command = await host.prepare();
  for (const [kind, multiple, selected] of [
    ["mixed", true, paths], ["mixed", false, [paths[2]]],
    ["folder", false, [paths[2]]], ["folder", true, [paths[2], join(root, "second folder")]],
    ["file", false, [paths[0]]], ["file", true, paths.slice(0, 2)], ["mixed", true, []],
  ] as const) {
  const child = spawn(command.file, command.args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, AXIOM_OPEN_OPTIONS: JSON.stringify({ kind, multiple, title: "Axiom Open test", initialDirectory: root }),
  } });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  child.stdout.on("data", (b: Buffer) => stdout.push(b)); child.stderr.on("data", (b: Buffer) => stderr.push(b));
  const closed = new Promise<number | null>((resolve, reject) => { child.once("close", resolve); child.once("error", reject); });
  const timer = setTimeout(() => child.kill("SIGKILL"), 25_000);
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(probe, "utf16le").toString("base64")], {
      timeout: 20_000, encoding: "utf8", windowsHide: true, env: { ...process.env, AXIOM_PROBE_PID: String(child.pid),
        AXIOM_PROBE_KIND: kind, AXIOM_PROBE_COUNT: String(selected.length),
        AXIOM_PROBE_NAMES: JSON.stringify(selected.flatMap((path) => [basename(path), basename(path, extname(path))])),
      },
    });
    if (result.status !== 0) child.kill("SIGKILL");
    const code = await closed;
    assert.equal(result.status, 0, `${result.stderr || result.error}\nHOST: ${Buffer.concat(stderr).toString()}`);
    assert.equal(code, 0, Buffer.concat(stderr).toString());
    assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString()).sort(), selected.map((path) => realpathSync(path)).sort());
    console.log(`PASS: Explorer Open ${kind}, multiple=${multiple}, count=${selected.length}; OS-visible and exact paths.`);
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await closed; } }
  }
} finally { await host.close(); rmSync(root, { recursive: true, force: true }); }
