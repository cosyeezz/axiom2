// Compiled with the dialog host to share DPI/work-area geometry. Paths arrive only as JSON.
export const windowsExplorerSource = String.raw`
namespace AxiomExplorer {
  using System;
  using System.Collections.Generic;
  using System.Diagnostics;
  using System.IO;
  using System.Runtime.InteropServices;
  using System.Text;
  using System.Threading;
  [ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface BrowserServices {
    [PreserveSig] int QueryService(ref Guid service, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out BrowserWindow browser);
  }
  [ComImport, Guid("000214E2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface BrowserWindow { [PreserveSig] int GetWindow(out IntPtr window); }
  public static class Host {
    [StructLayout(LayoutKind.Sequential)]
    struct Message { public IntPtr Window; public uint Id; public IntPtr W, L; public uint Time; public int X, Y; public uint Private; }
    [DllImport("user32.dll")] static extern bool PeekMessage(out Message message, IntPtr window, uint first, uint last, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
    static void PumpMessages() {
      Message message;
      while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref message); DispatchMessage(ref message); }
    }
    static string ReadRequest() {
      // Shell automation runs in an STA. Keep its message queue responsive while stdin waits.
      var request = System.Threading.Tasks.Task.Factory.StartNew(() => Console.ReadLine());
      while (!request.IsCompleted) { PumpMessages(); Thread.Sleep(5); }
      return request.Result;
    }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int length);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    static bool Activate(IntPtr window) {
      if (GetForegroundWindow() == window) return true;
      SetForegroundWindow(window);
      // Cross-thread activation can finish asynchronously. Wait briefly without
      // synthesizing input or attaching another application's input queue.
      var waiting = Stopwatch.StartNew();
      while (waiting.ElapsedMilliseconds < 200) {
        PumpMessages();
        if (GetForegroundWindow() == window) return true;
        Thread.Sleep(10);
      }
      return GetForegroundWindow() == window;
    }
    static int ForegroundUnavailable() { Console.WriteLine("foreground-unavailable"); return 2; }
    static string Normalize(string path) { return Path.GetFullPath(path).TrimEnd('\\', '/'); }
    static bool ActiveTab(object item, IntPtr window, bool warm = false) {
      // Windows 11 keeps inactive tab HWNDs visible too. The selected tab is the
      // foremost ShellTabWindowClass child; top-level HWND/IsWindowVisible alone is insufficient.
      IntPtr active = FindWindowEx(window, IntPtr.Zero, "ShellTabWindowClass", null);
      if (active == IntPtr.Zero) return true; // Older non-tabbed Explorer.
      // A fresh single-tab window needs no cross-process browser-service round trip.
      if (!warm && FindWindowEx(window, active, "ShellTabWindowClass", null) == IntPtr.Zero) return true;
      BrowserWindow browser = null;
      try {
        var service = new Guid("4C96BE40-915C-11CF-99D3-00AA004AE837");
        var iid = new Guid("000214E2-0000-0000-C000-000000000046");
        if (((BrowserServices)item).QueryService(ref service, ref iid, out browser) != 0 || browser == null) return false;
        IntPtr tab;
        return browser.GetWindow(out tab) == 0 && tab == active;
      } finally { if (browser != null) Marshal.ReleaseComObject(browser); }
    }
    // Explorer can reuse its process or a pre-existing window. Match the exact filesystem
    // location and active tab before touching any geometry. A UIA display name cannot
    // establish directory identity, so inactive tabs are left unchanged and opened separately.
    static IntPtr Find(dynamic windows, string directory) {
      // New Explorer windows are appended; inspect them first and read Count once
      // to avoid a separate cross-process COM round trip on every iteration.
      int count = windows.Count;
      for (int i = count - 1; i >= 0; i--) {
        object item = null;
        try {
          item = windows.Item(i);
          if (item == null) continue;
          dynamic browser = item;
          Uri uri;
          if (!Uri.TryCreate((string)browser.LocationURL, UriKind.Absolute, out uri) || !uri.IsFile) continue;
          if (directory.Length != 0 && !String.Equals(Normalize(uri.LocalPath), directory, StringComparison.OrdinalIgnoreCase)) continue;
          var window = new IntPtr((long)browser.HWND);
          var name = new StringBuilder(64); GetClassName(window, name, name.Capacity);
          if (name.ToString() != "CabinetWClass" && name.ToString() != "ExploreWClass") continue;
          bool active = ActiveTab(item, window, directory.Length == 0);
          if (directory.Length == 0) return IntPtr.Zero;
          if (active) return window;
        } catch (COMException) { /* A user may close/navigate an unrelated window during enumeration. */ }
        catch (ArgumentException) { /* Non-filesystem shell locations cannot match this request. */ }
        finally { if (item != null && Marshal.IsComObject(item)) Marshal.ReleaseComObject(item); }
      }
      return IntPtr.Zero;
    }
    [STAThread]
    public static int Main(string[] args) {
      object shellObject = null, windowsObject = null;
      try {
        AxiomOpen.Placement.EnableDpi();
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
        Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false, true)));
        var json = new System.Web.Script.Serialization.JavaScriptSerializer();
        json.Serialize(new string[0]);
        shellObject = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("13709620-C279-11CE-A49E-444553540000")));
        dynamic shell = shellObject;
        windowsObject = shell.Windows();
        // Initialize automation/binders before reporting readiness; this does not open a window.
        Find(windowsObject, "");
        Console.WriteLine("ready");
        string request = ReadRequest();
        if (request == null) return 0;
        var options = json.Deserialize<Dictionary<string, string>>(request);
        string directory = Normalize(options["directory"]);
        if (!Directory.Exists(options["directory"])) throw new DirectoryNotFoundException();
        IntPtr owner = GetForegroundWindow();
        // A disconnected/locked input desktop cannot display the requested window to the user.
        // Reject before creating or moving a shell-owned Explorer window.
        if (owner == IntPtr.Zero) return ForegroundUnavailable();
        IntPtr window = Find(windowsObject, directory);
        if (window == IntPtr.Zero) shell.Explore(options["directory"]);
        var timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < 8000) {
          if (window == IntPtr.Zero) window = Find(windowsObject, directory);
          if (window != IntPtr.Zero && IsWindowVisible(window)) {
            if (IsIconic(window) || IsZoomed(window)) ShowWindow(window, 9);
            // The Explorer window belongs to the shell, so never install an in-process subclass.
            if (AxiomOpen.Placement.Center(window, owner, false) && !IsIconic(window) && !IsZoomed(window)) {
              if (!Activate(window)) return ForegroundUnavailable();
              // Activation/restoration may complete layout asynchronously; success requires
              // both the actual foreground identity and final geometry, not just API return codes.
              if (Find(windowsObject, directory) == window && AxiomOpen.Placement.Center(window, owner, false) && IsWindowVisible(window) &&
                  !IsIconic(window) && !IsZoomed(window) && GetForegroundWindow() == window) {
                Console.WriteLine("opened");
                return 0;
              }
            }
          }
          window = IntPtr.Zero; // Revalidate the location if navigation/closing overtakes positioning.
          Thread.Sleep(10);
        }
        throw new TimeoutException();
      } catch (Exception error) {
        Console.Error.WriteLine("Native Explorer failed: " + error.GetType().Name + " (" + error.HResult.ToString("X") + ")");
        return 1;
      } finally {
        if (windowsObject != null) Marshal.ReleaseComObject(windowsObject);
        if (shellObject != null) Marshal.ReleaseComObject(shellObject);
        // Explorer is user-owned and remains open; only this single-use helper exits.
      }
    }
  }
}
`;
