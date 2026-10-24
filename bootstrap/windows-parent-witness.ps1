param([Parameter(Mandatory=$true)][string]$Request)
$ErrorActionPreference = 'Stop'
if (-not ('AxiomBootstrapFiles' -as [type])) { . (Join-Path $PSScriptRoot 'windows-files.ps1') }
# Holds the original parent HANDLE across command and parent-commit gaps.
# WAIT_FAILED is never an exit receipt. This observer never kills a process.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public sealed class AxiomParentWitness : IDisposable {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  IntPtr parent;
  public AxiomParentWitness(int pid) {
    parent = OpenProcess(0x00100000, false, pid);
    if (parent == IntPtr.Zero) throw new Win32Exception();
  }
  public bool Exited(uint timeout) {
    uint result = WaitForSingleObject(parent, timeout);
    if (result == 0) return true;
    if (result == 258) return false;
    throw new Win32Exception();
  }
  public void Dispose() { if (parent != IntPtr.Zero) { CloseHandle(parent); parent = IntPtr.Zero; } }
}
'@
function Write-WitnessJson([string]$Path, $Value) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Compress))
    $file = [AxiomBootstrapFiles]::CreateNew($Path)
    try { $file.Write($bytes, 0, $bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
}
$config = Read-BootstrapJson $Request
$directory = [IO.Path]::GetDirectoryName($Request)
$witness = New-Object AxiomParentWitness([int]$config.parentPid)
try {
    # The parent accepts this receipt while it is still alive, before any work.
    Write-WitnessJson (Join-Path $directory 'parent-ready.json') @{ nonce=$config.nonce; parentPid=$config.parentPid }
    while ($true) {
        if ($witness.Exited(200)) {
            Write-WitnessJson (Join-Path $directory 'parent-exited.json') @{ nonce=$config.nonce; parentPid=$config.parentPid; exited=$true }
            break
        }
        $stop = Join-Path $directory 'parent-stop.json'
        if ([AxiomBootstrapFiles]::Exists($stop)) {
            $control = Read-BootstrapJson $stop
            if ($control.nonce -is [string] -and [string]::Equals($control.nonce, $config.nonce, [StringComparison]::Ordinal)) { break }
        }
    }
} finally { $witness.Dispose() }
