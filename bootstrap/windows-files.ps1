# Native handles avoid .NET Framework's legacy MAX_PATH checks in PS 5.1.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class AxiomBootstrapFiles {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFileAttributesW(string path);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool DeleteFileW(string path);
  public static string LongPath(string path) {
    path = path.Replace('/', '\\');
    if (path.StartsWith(@"\\?\")) return path;
    if (path.StartsWith(@"\\")) return @"\\?\UNC\" + path.Substring(2);
    if (path.Length < 3 || path[1] != ':' || path[2] != '\\') throw new IOException("Absolute path required.");
    return @"\\?\" + path;
  }
  static FileStream Open(string path, bool write) {
    SafeFileHandle handle = CreateFileW(LongPath(path), write ? 0x40000000u : 0x80000000u, write ? 1u : 7u, IntPtr.Zero, write ? 1u : 3u, 0x80, IntPtr.Zero);
    if (handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
    try { return new FileStream(handle, write ? FileAccess.Write : FileAccess.Read); }
    catch { handle.Dispose(); throw; }
  }
  public static FileStream Read(string path) { return Open(path, false); }
  public static FileStream CreateNew(string path) { return Open(path, true); }
  public static bool Exists(string path) {
    if (GetFileAttributesW(LongPath(path)) != 0xffffffff) return true;
    int error = Marshal.GetLastWin32Error();
    if (error == 2 || error == 3) return false;
    throw new Win32Exception(error);
  }
  public static void Remove(string path) {
    if (DeleteFileW(LongPath(path))) return;
    int error = Marshal.GetLastWin32Error();
    if (error != 2 && error != 3) throw new Win32Exception(error);
  }
}
'@
function Read-BootstrapJson([string]$Path) {
    $stream = [AxiomBootstrapFiles]::Read($Path)
    try {
        if ($stream.Length -gt 524288) { throw 'Ownership JSON exceeds limit.' }
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.UTF8Encoding]::new($false, $true), $true)
        try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
}
