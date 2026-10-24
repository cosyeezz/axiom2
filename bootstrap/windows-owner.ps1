param([Parameter(Mandatory=$true)][string]$Request)
$ErrorActionPreference = 'Stop'
if (-not ('AxiomBootstrapFiles' -as [type])) { . (Join-Path $PSScriptRoot 'windows-files.ps1') }
# This supervisor is available before npm installs Axiom or any native Node addon.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public sealed class AxiomBootstrapOwner : IDisposable {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved, desktop, title;
    public int x,y,width,height,xchars,ychars,fill,flags; public short show,reservedSize;
    public IntPtr reservedData,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, byte[] data, uint size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string executable, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref StartupEx startup, out ProcessInfo info);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool MoveFileExW(string from, string to, uint flags);
  IntPtr job, parent; ProcessInfo worker; bool resumed;
  public int Pid { get { return (int)worker.pid; } }
  public bool ParentExited { get { return WaitForSingleObject(parent, 0) == 0; } }
  public bool ParentGone { get { return WaitForSingleObject(parent, 0) != 258; } }
  public bool Exited { get { return WaitForSingleObject(worker.process, 0) == 0; } }
  public uint ExitCode { get { uint code; if (!GetExitCodeProcess(worker.process, out code)) throw new Win32Exception(); return code; } }
  public AxiomBootstrapOwner(int host, string executable, string command, string directory) {
    if (IntPtr.Size != 8) throw new Exception("Unsupported Windows architecture");
    try {
      parent=OpenProcess(0x100000, false, host); if (parent==IntPtr.Zero || ParentGone) throw new Win32Exception();
      job=CreateJobObjectW(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Win32Exception();
      byte[] limits=new byte[144]; BitConverter.GetBytes((uint)0x2000).CopyTo(limits,16);
      if(!SetInformationJobObject(job,9,limits,(uint)limits.Length)) throw new Win32Exception();
      StartupEx startup=new StartupEx(); startup.startup.cb=Marshal.SizeOf(typeof(StartupEx));
      startup.startup.flags=0x100; startup.startup.input=GetStdHandle(-10); startup.startup.output=GetStdHandle(-11); startup.startup.error=GetStdHandle(-12);
      IntPtr size=IntPtr.Zero, jobs=IntPtr.Zero; bool initialized=false;
      InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
      if(size==IntPtr.Zero) throw new Win32Exception();
      try {
        startup.attributes=Marshal.AllocHGlobal(size);
        if(!InitializeProcThreadAttributeList(startup.attributes,1,0,ref size)) throw new Win32Exception();
        initialized=true; jobs=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs,job);
        // Job membership is atomic with process creation: no orphaned suspended gap.
        if(!UpdateProcThreadAttribute(startup.attributes,0,new IntPtr(0x2000D),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero)) throw new Win32Exception();
        if(!CreateProcessW(executable,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x80004,IntPtr.Zero,directory,ref startup,out worker)) throw new Win32Exception();
      } finally {
        if(initialized) DeleteProcThreadAttributeList(startup.attributes);
        if(startup.attributes!=IntPtr.Zero) Marshal.FreeHGlobal(startup.attributes);
        if(jobs!=IntPtr.Zero) Marshal.FreeHGlobal(jobs);
      }
    } catch { if(worker.process!=IntPtr.Zero) TerminateProcess(worker.process,1); Dispose(); throw; }
  }
  public void Go() {
    if(resumed || ParentGone) throw new Exception("Start permission revoked");
    if(ResumeThread(worker.thread)==UInt32.MaxValue) throw new Win32Exception();
    resumed=true;
  }
  public bool StopAndConfirm() {
    if(job==IntPtr.Zero || !TerminateJobObject(job,1)) return false;
    DateTime end=DateTime.UtcNow.AddSeconds(5);
    do {
      byte[] accounting=new byte[48];
      if(!QueryInformationJobObject(job,1,accounting,(uint)accounting.Length,IntPtr.Zero)) return false;
      if(BitConverter.ToUInt32(accounting,40)==0) return true;
      System.Threading.Thread.Sleep(25);
    } while(DateTime.UtcNow<end);
    return false;
  }
  public void Dispose() {
    if(worker.thread!=IntPtr.Zero) { CloseHandle(worker.thread); worker.thread=IntPtr.Zero; }
    if(worker.process!=IntPtr.Zero) { CloseHandle(worker.process); worker.process=IntPtr.Zero; }
    if(job!=IntPtr.Zero) { CloseHandle(job); job=IntPtr.Zero; }
    if(parent!=IntPtr.Zero) { CloseHandle(parent); parent=IntPtr.Zero; }
  }
}
'@
function Write-OwnerJson([string]$Path, $Value) {
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes(($Value | ConvertTo-Json -Depth 10 -Compress))
        $stream = [AxiomBootstrapFiles]::CreateNew($temporary)
        try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        if (-not [AxiomBootstrapOwner]::MoveFileExW([AxiomBootstrapFiles]::LongPath($temporary), [AxiomBootstrapFiles]::LongPath($Path), 9)) { throw 'Cannot publish ownership receipt.' }
    } finally { [AxiomBootstrapFiles]::Remove($temporary) }
}
function Quote-Argument([string]$Value) {
    # CommandLineToArgvW quoting; no command shell interprets this command line.
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Read-SharedJson([string]$Path) {
    return Read-BootstrapJson $Path
}
$config = Read-SharedJson $Request
$directory = Split-Path -Parent $Request
$taskPath = Join-Path $directory 'task.json'
if ($null -ne $config.taskPath) {
    if ($config.taskPath -isnot [string] -or -not [System.IO.Path]::IsPathRooted($config.taskPath) -or $config.taskPath.IndexOf([char]0) -ge 0) { throw 'Maintenance task path must be absolute.' }
    $taskPath = [System.IO.Path]::GetFullPath($config.taskPath)
}
$tree = $null
$started = $false
$confirmed = $false
$parentExited = $false
$exitCode = $null
$reason = 'supervisor-failure'
try {
    $command = (@($config.node, $config.entry, '--worker', $Request) | ForEach-Object { Quote-Argument $_ }) -join ' '
    $tree = New-Object AxiomBootstrapOwner([int]$config.parentPid, [string]$config.node, $command, [string]$config.cwd)
    Write-OwnerJson (Join-Path $directory 'ready.json') @{ nonce=$config.nonce; pid=$tree.Pid }
    $lastDeadline = [long]$config.deadline
    while ($true) {
        if ($tree.ParentGone) { $reason='parent-gone'; break }
        if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $lastDeadline) { $reason='deadline'; break }
        $controlPath = Join-Path $directory 'owner-control.json'
        if ([AxiomBootstrapFiles]::Exists($controlPath)) {
            $control = Read-SharedJson $controlPath
            if ($control.nonce -ne $config.nonce) { throw 'Ownership control does not match this task.' }
            if ($control.stop) { $reason='stopped'; break }
            if ($null -ne $control.deadline) { $lastDeadline = [long]$control.deadline }
            if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $lastDeadline) { $reason='deadline'; break }
            if (-not $started -and $control.go) { $tree.Go(); $started=$true }
        }
        if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $lastDeadline) { $reason='deadline'; break }
        if ($tree.Exited) { $exitCode=$tree.ExitCode; $reason='exited'; break }
        Start-Sleep -Milliseconds 50
    }
} finally {
    if ($null -ne $tree) {
        try { $confirmed = $tree.StopAndConfirm() }
        finally { $parentExited = $tree.ParentExited; $tree.Dispose() }
    }
    try {
        # The original process HANDLE proves this writer cannot race the host.
        # Keep the owner barrier: cleanup alone does not prove installation success.
        if ($parentExited -and $config.taskId -and $config.attemptId) {
            $task = Read-SharedJson $taskPath
            if ($task.id -is [string] -and $config.taskId -is [string] -and $task.attemptId -is [string] -and $config.attemptId -is [string] -and [string]::Equals($task.id, $config.taskId, [System.StringComparison]::Ordinal) -and [string]::Equals($task.attemptId, $config.attemptId, [System.StringComparison]::Ordinal) -and $task.status -is [string] -and @('running', 'cancelling') -ccontains $task.status) {
                $task.status = 'unknown'
                $task.message = '安装协调进程已退出，安装结果尚未核实；归属记录已保留。'
                $task.capabilities.cancel = $false; $task.capabilities.extend = $false
                $task.updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                $task | Add-Member -NotePropertyName finishedAt -NotePropertyValue $task.updatedAt -Force
                $task | Add-Member -NotePropertyName error -NotePropertyValue @{code='stop-unconfirmed'; message=$task.message; phase=$task.phase} -Force
                Write-OwnerJson $taskPath $task
            }
        }
    } finally {
        # Publish only after the last possible task write. A recovery consumer
        # must require writerStopped before releasing the parent transaction.
        if ($confirmed) { Write-OwnerJson (Join-Path $directory 'cleaned.json') @{ nonce=$config.nonce; reason=$reason; code=$exitCode; parentExited=$parentExited; writerStopped=$true } }
    }
}
