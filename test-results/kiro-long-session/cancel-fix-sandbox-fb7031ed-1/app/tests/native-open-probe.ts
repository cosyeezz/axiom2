// Windows desktop probe: owned dialogs, or Explorer at an isolated test-only directory.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const source = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
[ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ProbeServices {
  [PreserveSig] int QueryService(ref Guid service, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out ProbeBrowser browser);
}
[ComImport, Guid("000214E2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ProbeBrowser { [PreserveSig] int GetWindow(out IntPtr window); }
class Probe {
  delegate bool Callback(IntPtr window, IntPtr state);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Reserved1, Peb, Reserved2, Reserved3, Id, Parent; }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int infoClass, ref ProcessInfo info, int length, out int returned);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr state);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int length);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  static bool Owned(uint pid, int parent) {
    try {
      using (var process = Process.GetProcessById((int)pid)) {
        var info = new ProcessInfo(); int returned;
        return NtQueryInformationProcess(process.Handle, 0, ref info, Marshal.SizeOf(typeof(ProcessInfo)), out returned) == 0 && info.Parent.ToInt64() == parent;
      }
    } catch { return false; }
  }
  static Rect Bounds(IntPtr window) { Rect rect; if (!GetWindowRect(window, out rect)) throw new Exception("No window bounds"); return rect; }
  static bool Centered(IntPtr window, Rect work) {
    if (!IsWindowVisible(window) || IsIconic(window)) return false;
    var bounds = Bounds(window);
    return bounds.Left >= work.Left && bounds.Top >= work.Top && bounds.Right <= work.Right && bounds.Bottom <= work.Bottom &&
      Math.Abs(bounds.Left + bounds.Right - work.Left - work.Right) <= 2 && Math.Abs(bounds.Top + bounds.Bottom - work.Top - work.Bottom) <= 2;
  }
  static void AddOtherTab(dynamic windows, IntPtr window, string directory) {
    IntPtr previous = FindWindowEx(window, IntPtr.Zero, "ShellTabWindowClass", null);
    var root = System.Windows.Automation.AutomationElement.FromHandle(window);
    var button = root.FindFirst(System.Windows.Automation.TreeScope.Descendants,
      new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.AutomationIdProperty, "AddButton"));
    object pattern;
    if (button == null || !button.TryGetCurrentPattern(System.Windows.Automation.InvokePattern.Pattern, out pattern))
      throw new Exception("Isolated Explorer has no accessible new-tab button");
    ((System.Windows.Automation.InvokePattern)pattern).Invoke();
    var waiting = Stopwatch.StartNew();
    while (waiting.ElapsedMilliseconds < 5000) {
      IntPtr active = FindWindowEx(window, IntPtr.Zero, "ShellTabWindowClass", null);
      if (active != IntPtr.Zero && active != previous) {
        int count = windows.Count;
        for (int i = count - 1; i >= 0; i--) {
          object item = null; ProbeBrowser tab = null;
          try {
            item = windows.Item(i);
            if (item == null || new IntPtr((long)((dynamic)item).HWND) != window) continue;
            var service = new Guid("4C96BE40-915C-11CF-99D3-00AA004AE837");
            var iid = new Guid("000214E2-0000-0000-C000-000000000046");
            IntPtr handle;
            if (((ProbeServices)item).QueryService(ref service, ref iid, out tab) == 0 && tab != null && tab.GetWindow(out handle) == 0 && handle == active) {
              ((dynamic)item).Navigate2(directory);
              return;
            }
          } catch (COMException) { }
          finally {
            if (tab != null) Marshal.ReleaseComObject(tab);
            if (item != null && Marshal.IsComObject(item)) Marshal.ReleaseComObject(item);
          }
        }
      }
      System.Windows.Forms.Application.DoEvents(); Thread.Sleep(10);
    }
    throw new Exception("Explorer did not register the isolated second tab");
  }
  static string ExpectedCaption(string directory) {
    string label = Environment.GetEnvironmentVariable("AXIOM_PROBE_DISPLAY_NAME");
    return !String.IsNullOrEmpty(label) && String.Equals(directory, Environment.GetEnvironmentVariable("AXIOM_PROBE_DIRECTORY"), StringComparison.OrdinalIgnoreCase)
      ? label : Path.GetFileName(directory.TrimEnd('\\'));
  }
  static bool TargetCaption(IntPtr window, string directory) {
    var title = new StringBuilder(4096); GetWindowText(window, title, title.Capacity);
    string leaf = ExpectedCaption(directory);
    string caption = title.ToString();
    // Windows 11 appends the number of other tabs before the Explorer suffix.
    // Full directory ownership is checked separately through ShellWindows.
    return caption == leaf || caption == directory || caption.StartsWith(leaf + " ", StringComparison.Ordinal) || caption.StartsWith(directory + " ", StringComparison.Ordinal);
  }
  static IntPtr Explorer(dynamic windows, string directory) {
    int count = windows.Count;
    for (int i = count - 1; i >= 0; i--) {
      object item = null;
      try {
        item = windows.Item(i);
        if (item == null) continue;
        dynamic browser = item;
        Uri location;
        if (!Uri.TryCreate((string)browser.LocationURL, UriKind.Absolute, out location) || !location.IsFile ||
            !String.Equals(location.LocalPath.TrimEnd('\\'), directory.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) continue;
        var window = new IntPtr((long)browser.HWND);
        var name = new StringBuilder(64); GetClassName(window, name, name.Capacity);
        if ((name.ToString() == "CabinetWClass" || name.ToString() == "ExploreWClass") && TargetCaption(window, directory)) return window;
      } catch (COMException) { }
      finally { if (item != null && Marshal.IsComObject(item)) Marshal.ReleaseComObject(item); }
    }
    return IntPtr.Zero;
  }
  static void WaitForDirectory(dynamic windows, IntPtr window, string directory) {
    var changing = Stopwatch.StartNew();
    while (changing.ElapsedMilliseconds < 5000 && Explorer(windows, directory) != window) {
      System.Windows.Forms.Application.DoEvents(); Thread.Sleep(10);
    }
    if (Explorer(windows, directory) != window) throw new Exception("Isolated tab did not reach its expected directory and caption: " + directory);
  }
  [STAThread]
  public static int Main() {
    IntPtr found = IntPtr.Zero, original = IntPtr.Zero;
    Rect originalBounds = new Rect();
    string originalDirectory = null;
    object shell = null, windows = null;
    bool keep = false;
    try {
      SetProcessDpiAwarenessContext(new IntPtr(-4));
      Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
      Console.SetError(new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true });
      var json = new JavaScriptSerializer();
      string title = Environment.GetEnvironmentVariable("AXIOM_PROBE_TITLE");
      int parent = Int32.Parse(Environment.GetEnvironmentVariable("AXIOM_PROBE_PARENT"));
      var desktopWait = Stopwatch.StartNew();
      IntPtr foreground = GetForegroundWindow();
      while (foreground == IntPtr.Zero && desktopWait.ElapsedMilliseconds < 250) {
        System.Windows.Forms.Application.DoEvents(); Thread.Sleep(10); foreground = GetForegroundWindow();
      }
      if (foreground == IntPtr.Zero) throw new Exception("Native window acceptance requires a connected, unlocked Windows desktop with a foreground window");
      var monitor = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
      if (!GetMonitorInfo(MonitorFromWindow(foreground, 2), ref monitor)) throw new Exception("No desktop monitor");
      string directory = Environment.GetEnvironmentVariable("AXIOM_PROBE_DIRECTORY");
      if (!String.IsNullOrEmpty(directory)) {
        if (!Directory.Exists(directory) || !Path.GetFullPath(directory).StartsWith(Path.GetTempPath(), StringComparison.OrdinalIgnoreCase)) throw new Exception("Explorer probe requires an isolated temporary directory");
        shell = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("13709620-C279-11CE-A49E-444553540000")));
        windows = ((dynamic)shell).Windows();
        string state = Environment.GetEnvironmentVariable("AXIOM_PROBE_STATE");
        if (!String.IsNullOrEmpty(state)) {
          found = Explorer(windows, directory);
          if (found == IntPtr.Zero) throw new Exception("No test Explorer to reuse");
          if (state == "inactive-tab") {
            string other = Path.Combine(Path.GetDirectoryName(directory), "other-tab");
            if (!Directory.Exists(other)) throw new Exception("Missing isolated second-tab fixture");
            string decoy = Environment.GetEnvironmentVariable("AXIOM_PROBE_DECOY_DIRECTORY");
            if (!String.IsNullOrEmpty(decoy)) {
              if (!Directory.Exists(decoy) || !Path.GetFullPath(decoy).StartsWith(Path.GetDirectoryName(directory) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                  Path.GetFileName(decoy) != Path.GetFileName(directory) || ExpectedCaption(directory) == Path.GetFileName(directory))
                throw new Exception("Display-name collision fixture must use isolated different directories and a custom target label");
              AddOtherTab(windows, found, decoy);
              WaitForDirectory(windows, found, decoy);
            }
            AddOtherTab(windows, found, other);
            WaitForDirectory(windows, found, other);
            var tabs = System.Windows.Automation.AutomationElement.FromHandle(found).FindAll(System.Windows.Automation.TreeScope.Descendants,
              new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.ControlTypeProperty, System.Windows.Automation.ControlType.TabItem));
            bool targetInactive = false, otherActive = false, decoyInactive = false;
            int targetLabels = 0, decoyLabels = 0;
            foreach (System.Windows.Automation.AutomationElement tab in tabs) {
              object selection;
              if (!tab.TryGetCurrentPattern(System.Windows.Automation.SelectionItemPattern.Pattern, out selection)) continue;
              bool selected = ((System.Windows.Automation.SelectionItemPattern)selection).Current.IsSelected;
              if (tab.Current.Name == ExpectedCaption(directory)) { targetInactive = !selected; targetLabels++; }
              if (tab.Current.Name == Path.GetFileName(other)) otherActive = selected;
              if (tab.Current.Name == Path.GetFileName(directory)) { decoyInactive = !selected; decoyLabels++; }
            }
            if (!targetInactive || !otherActive || targetLabels != 1) throw new Exception("The isolated tabs did not finish switching before the measurement");
            if (!String.IsNullOrEmpty(decoy) && (!decoyInactive || decoyLabels != 1))
              throw new Exception("The unique filename label must belong to the isolated decoy tab");
            original = found; originalBounds = Bounds(found); originalDirectory = other;
          } else {
            var b = Bounds(found);
            SetWindowPos(found, IntPtr.Zero, monitor.Work.Left + 20, monitor.Work.Top + 20, b.Right - b.Left, b.Bottom - b.Top, 0x14);
            ShowWindow(found, state == "minimized" ? 6 : 3);
            if (state == "minimized" ? !IsIconic(found) : !IsZoomed(found)) throw new Exception("Test Explorer did not change state");
          }
        }
      }
      Console.WriteLine("ready");
      var timer = Stopwatch.StartNew();
      while (timer.ElapsedMilliseconds < 10000) {
        if (windows != null) {
          found = Explorer(windows, directory);
          if (found != IntPtr.Zero && Centered(found, monitor.Work) && GetForegroundWindow() == found) break;
        } else {
          EnumWindows(delegate(IntPtr window, IntPtr state) {
            if (!IsWindowVisible(window)) return true;
            var text = new StringBuilder(256); GetWindowText(window, text, 256);
            if (text.ToString() != title) return true;
            uint pid; GetWindowThreadProcessId(window, out pid);
            if (Owned(pid, parent)) found = window;
            return true;
          }, IntPtr.Zero);
          if (found != IntPtr.Zero) break;
        }
        if (windows != null) System.Windows.Forms.Application.DoEvents();
        Thread.Sleep(5);
      }
      if (found == IntPtr.Zero || !IsWindowVisible(found) || IsIconic(found) || (windows != null && (!Centered(found, monitor.Work) || GetForegroundWindow() != found))) throw new Exception("No foreground target window in the required position: " + (found == IntPtr.Zero ? "missing" : json.Serialize(new { bounds = Bounds(found), handle = found.ToInt64(), foreground = GetForegroundWindow().ToInt64() })));
      uint owner; GetWindowThreadProcessId(found, out owner);
      Console.WriteLine(json.Serialize(new { bounds = Bounds(found), work = monitor.Work, pid = owner, handle = found.ToInt64(), foreground = GetForegroundWindow().ToInt64() }));
      // Verify that Explorer does not restore a remembered/off-center position after first display.
      Thread.Sleep(120);
      Console.WriteLine(json.Serialize(new { bounds = Bounds(found), work = monitor.Work, pid = owner, handle = found.ToInt64(), foreground = GetForegroundWindow().ToInt64() }));
      if (windows == null) {
        // Wait for initial message processing, then verify later OS positioning is not intercepted.
        using (var native = Process.GetProcessById((int)owner)) {
          if (!native.WaitForInputIdle(2000)) throw new Exception("Test dialog did not finish initial message processing");
        }
        var before = Bounds(found);
        int x = monitor.Work.Left + 20, y = monitor.Work.Top + 20;
        if (!SetWindowPos(found, IntPtr.Zero, x, y, before.Right - before.Left, before.Bottom - before.Top, 0x14))
          throw new Exception("Could not move the initialized test dialog");
        var moved = Bounds(found);
        if (moved.Left != x || moved.Top != y) throw new Exception("Initialization hook still overrides later window positioning: " + json.Serialize(moved) + "; expected=" + x + "," + y);
      }
      if (original != IntPtr.Zero && (found == original ||
          !Bounds(original).Equals(originalBounds) || Explorer(windows, originalDirectory) != original))
        throw new Exception("Opening a background directory must use a new window and preserve the original tab and bounds");
      // The test decides when to close; EOF also closes only the test-owned target.
      var command = System.Threading.Tasks.Task.Factory.StartNew(() => Console.ReadLine());
      while (!command.IsCompleted) { System.Windows.Forms.Application.DoEvents(); Thread.Sleep(10); }
      keep = command.Result == "keep";
      return 0;
    } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    finally {
      if (found != IntPtr.Zero && !keep) {
        // Explorer's WM_CLOSE can close only the active tab. SC_CLOSE closes the
        // isolated test window with all of its tabs, like its title-bar close button.
        PostMessage(found, windows == null ? 0x10u : 0x112u, windows == null ? IntPtr.Zero : new IntPtr(0xF060), IntPtr.Zero);
        var closing = Stopwatch.StartNew();
        while (IsWindow(found) && IsWindowVisible(found) && closing.ElapsedMilliseconds < 3000) {
          System.Windows.Forms.Application.DoEvents(); Thread.Sleep(10);
        }
        if (IsWindow(found) && IsWindowVisible(found)) throw new Exception("Test window did not close");
      }
      if (windows != null) Marshal.ReleaseComObject(windows);
      if (shell != null) Marshal.ReleaseComObject(shell);
    }
  }
}
`;
export type NativeBounds = { Left: number; Top: number; Right: number; Bottom: number };
export type NativeWindow = { bounds: NativeBounds; work: NativeBounds; pid: number; handle: number; foreground: number };
export function compileWindowProbe(directory: string) {
  const file = join(directory, "WindowProbe.cs"), executable = join(directory, "WindowProbe.exe");
  writeFileSync(file, source, "utf8");
  const framework = join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", process.arch === "ia32" ? "Framework" : "Framework64", "v4.0.30319");
  const compiler = join(framework, "csc.exe");
  const result = spawnSync(compiler, ["/nologo", "/reference:System.Web.Extensions.dll", "/reference:Microsoft.CSharp.dll", "/reference:System.Windows.Forms.dll", `/reference:${join(framework, "WPF", "UIAutomationClient.dll")}`, `/reference:${join(framework, "WPF", "UIAutomationTypes.dll")}`, `/out:${executable}`, file], {
    windowsHide: true, encoding: "utf8", timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return executable;
}
export async function observeNativeWindow(executable: string, title: string, explorer?: {
  directory: string; state?: "minimized" | "maximized" | "inactive-tab"; displayName?: string; decoyDirectory?: string;
}) {
  const child = spawn(executable, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: {
    ...process.env, AXIOM_PROBE_TITLE: title, AXIOM_PROBE_PARENT: String(process.pid),
    AXIOM_PROBE_DIRECTORY: explorer?.directory ?? "", AXIOM_PROBE_STATE: explorer?.state ?? "",
    AXIOM_PROBE_DISPLAY_NAME: explorer?.displayName ?? "", AXIOM_PROBE_DECOY_DIRECTORY: explorer?.decoyDirectory ?? "",
  } });
  child.stdin.on("error", () => {}); // Exit/close reports failures without an unhandled EPIPE masking them.
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async () => {
    const result = await lines.next();
    if (result.done) throw Error(`Window probe exited: ${errors}`);
    return result.value;
  };
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(Error(errors || `Probe exited ${code}`)));
  });
  void done.catch(() => {});
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  timer.unref();
  try { assert.equal(await next(), "ready"); }
  catch (error) { clearTimeout(timer); child.stdin.end(); await done.catch(() => {}); throw error; }
  let closing: Promise<void> | undefined;
  return {
    next: async () => JSON.parse(await next()) as NativeWindow,
    close: async (keepOpen = false) => closing ??= (async () => {
      child.stdin.end(keepOpen ? "keep\n" : "close\n");
      try { await done; } finally { clearTimeout(timer); }
    })(),
  };
}
export function assertCentered({ bounds: b, work: w }: NativeWindow) {
  assert.ok(b.Right > b.Left && b.Bottom > b.Top, "visible dialog has nonzero size");
  assert.ok(Math.abs((b.Left + b.Right) - (w.Left + w.Right)) <= 2, `horizontal center: ${JSON.stringify({ b, w })}`);
  assert.ok(Math.abs((b.Top + b.Bottom) - (w.Top + w.Bottom)) <= 2, `vertical center: ${JSON.stringify({ b, w })}`);
  assert.ok(b.Left >= w.Left && b.Top >= w.Top && b.Right <= w.Right && b.Bottom <= w.Bottom, "dialog stays within the active monitor work area");
}
