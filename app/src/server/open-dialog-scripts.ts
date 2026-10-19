/** Static native hosts. Request values travel only as JSON (environment or stdin), never source code. */
export const macOpenScript = String.raw`
ObjC.import('AppKit');
ObjC.import('Foundation');
function run() {
  const options = JSON.parse(ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('AXIOM_OPEN_OPTIONS')));
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  // osascript has no normal AppKit application startup. Finish it before
  // presenting a key window, so activation targets a window ready for input.
  app.finishLaunching;
  const panel = $.NSOpenPanel.openPanel;
  panel.title = options.title;
  panel.prompt = '打开';
  panel.canChooseFiles = options.kind !== 'folder';
  panel.canChooseDirectories = options.kind !== 'file';
  panel.allowsMultipleSelection = options.multiple;
  panel.canCreateDirectories = true;
  panel.resolvesAliases = true;
  if (options.initialDirectory) panel.directoryURL = $.NSURL.fileURLWithPath(options.initialDirectory);
  panel.center;
  panel.makeKeyAndOrderFront(null);
  app.activateIgnoringOtherApps(true);
  if (panel.runModal !== $.NSModalResponseOK) return '[]';
  const urls = panel.URLs;
  const paths = [];
  for (let i = 0; i < urls.count; i++) paths.push(ObjC.unwrap(urls.objectAtIndex(i).path));
  return JSON.stringify(paths);
}
`;

// GTK's stock accept responses navigate directories. A positive custom response
// deliberately collects the selection, allowing files and folders in the same batch.
export const linuxOpenScript = String.raw`
import json, os, sys
try:
    import gi
    gi.require_version('Gtk', '3.0')
    from gi.repository import Gtk
except (ImportError, ValueError):
    sys.stderr.write('AXIOM_GTK_MISSING')
    sys.exit(3)
ready, _ = Gtk.init_check(None)
if not ready:
    sys.stderr.write('AXIOM_NO_DISPLAY')
    sys.exit(4)
options = json.loads(os.environ['AXIOM_OPEN_OPTIONS'])
action = Gtk.FileChooserAction.SELECT_FOLDER if options['kind'] == 'folder' else Gtk.FileChooserAction.OPEN
dialog = Gtk.FileChooserDialog(title=options['title'], action=action)
dialog.set_position(Gtk.WindowPosition.CENTER_ALWAYS)
dialog.add_button('取消', Gtk.ResponseType.CANCEL)
if options['kind'] == 'mixed':
    dialog.add_button('选择所选项目', 1001)
    dialog.add_button('选择当前文件夹', 1002)
    dialog.add_button('打开', Gtk.ResponseType.OK)
else:
    dialog.add_button('打开', Gtk.ResponseType.OK)
dialog.set_default_response(Gtk.ResponseType.OK)
dialog.set_select_multiple(options['multiple'])
dialog.set_local_only(True)
if options.get('initialDirectory'):
    dialog.set_current_folder(options['initialDirectory'])
try:
    while True:
        response = dialog.run()
        if response not in (Gtk.ResponseType.OK, 1001, 1002):
            paths = []
            break
        paths = [dialog.get_current_folder()] if response == 1002 else dialog.get_filenames()
        if not paths:
            continue
        if len(paths) > (50 if options['multiple'] else 1):
            message = Gtk.MessageDialog(transient_for=dialog, modal=True,
                message_type=Gtk.MessageType.WARNING, buttons=Gtk.ButtonsType.OK,
                text='最多选择 50 项' if options['multiple'] else '请选择一项')
            message.run()
            message.destroy()
            continue
        break
    # ASCII JSON keeps the wire protocol valid even under a non-UTF-8 desktop locale.
    print(json.dumps(paths))
finally:
    dialog.destroy()
`;

// IFileOpenDialog supplies Explorer navigation/search/accessibility. No custom file list.
// Mixed mode has an explicit selection button because the OS Open button navigates folders.
// Compiled once before serving requests; a waiting STA host initializes COM before the click.
export const windowsOpenSource = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace AxiomOpen {
  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")] class FileOpenDialog { }
  [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr filters);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IFileDialogEvents events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
    void AddPlace(IShellItem item, int placement);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
    void Close(int result);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr filter);
    void GetResults(out IShellItemArray items);
    void GetSelectedItems(out IShellItemArray items);
  }
  [ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface Services {
    [PreserveSig] int QueryService(ref Guid service, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out ShellBrowser browser);
  }
  [ComImport, Guid("000214E2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface ShellBrowser {
    void GetWindow(out IntPtr window);
    void ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool enter);
    void InsertMenusSB(IntPtr menu, IntPtr widths);
    void SetMenuSB(IntPtr menu, IntPtr reserved, IntPtr active);
    void RemoveMenusSB(IntPtr menu);
    void SetStatusTextSB([MarshalAs(UnmanagedType.LPWStr)] string text);
    void EnableModelessSB([MarshalAs(UnmanagedType.Bool)] bool enable);
    void TranslateAcceleratorSB(IntPtr message, ushort id);
    void BrowseObject(IntPtr item, uint flags);
    void GetViewStateStream(uint mode, out IntPtr stream);
    void GetControlWindow(uint id, out IntPtr window);
    void SendControlMsg(uint id, uint message, IntPtr w, IntPtr l, out IntPtr result);
    void QueryActiveShellView([MarshalAs(UnmanagedType.Interface)] out object view);
  }
  [ComImport, Guid("CDE725B0-CCC9-4519-917E-325D72FAB4CE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface FolderView {
    void GetCurrentViewMode(out uint mode);
    void SetCurrentViewMode(uint mode);
    void GetFolder(ref Guid iid, out IntPtr folder);
    void Item(int index, out IntPtr item);
    void ItemCount(uint flags, out int count);
    void Items(uint flags, ref Guid iid, out IShellItemArray items);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItem {
    void BindToHandler(IntPtr bind, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint type, out IntPtr name);
    void GetAttributes(uint mask, out uint attributes);
    void Compare(IShellItem other, uint hint, out int order);
  }
  [ComImport, Guid("B63EA76D-1F85-456F-A19C-48159EFA858B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItemArray {
    void BindToHandler(IntPtr bind, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetPropertyStore(int flags, ref Guid iid, out IntPtr store);
    void GetPropertyDescriptionList(IntPtr key, ref Guid iid, out IntPtr list);
    void GetAttributes(int flags, uint mask, out uint attributes);
    void GetCount(out uint count);
    void GetItemAt(uint index, out IShellItem item);
    void EnumItems(out IntPtr enumerator);
  }
  [ComImport, Guid("00000114-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IOleWindow { void GetWindow(out IntPtr window); void ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool enter); }
  [ComImport, Guid("E6FDD21A-163F-4975-9C8C-A69F1BA37034"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFileDialogCustomize {
    void EnableOpenDropDown(uint id);
    void AddMenu(uint id, [MarshalAs(UnmanagedType.LPWStr)] string label);
    void AddPushButton(uint id, [MarshalAs(UnmanagedType.LPWStr)] string label);
    void AddComboBox(uint id);
    void AddRadioButtonList(uint id);
    void AddCheckButton(uint id, [MarshalAs(UnmanagedType.LPWStr)] string label, [MarshalAs(UnmanagedType.Bool)] bool selected);
    void AddEditBox(uint id, [MarshalAs(UnmanagedType.LPWStr)] string text);
    void AddSeparator(uint id);
    void AddText(uint id, [MarshalAs(UnmanagedType.LPWStr)] string text);
    void SetControlLabel(uint id, [MarshalAs(UnmanagedType.LPWStr)] string label);
  }
  [ComImport, Guid("973510DB-7D7F-452B-8975-74A85828D354"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFileDialogEvents {
    [PreserveSig] int OnFileOk(IFileOpenDialog dialog);
    [PreserveSig] int OnFolderChanging(IFileOpenDialog dialog, IShellItem folder);
    [PreserveSig] int OnFolderChange(IFileOpenDialog dialog);
    [PreserveSig] int OnSelectionChange(IFileOpenDialog dialog);
    [PreserveSig] int OnShareViolation(IFileOpenDialog dialog, IShellItem item, out uint response);
    [PreserveSig] int OnTypeChange(IFileOpenDialog dialog);
    [PreserveSig] int OnOverwrite(IFileOpenDialog dialog, IShellItem item, out uint response);
  }
  [ComImport, Guid("36116642-D713-4B97-9B83-7484A9D00433"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFileDialogControlEvents {
    [PreserveSig] int OnItemSelected(IFileDialogCustomize dialog, uint control, uint item);
    [PreserveSig] int OnButtonClicked(IFileDialogCustomize dialog, uint control);
    [PreserveSig] int OnCheckButtonToggled(IFileDialogCustomize dialog, uint control, [MarshalAs(UnmanagedType.Bool)] bool value);
    [PreserveSig] int OnControlActivating(IFileDialogCustomize dialog, uint control);
  }
  public static class Placement {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] struct WindowPos { public IntPtr Window, After; public int X, Y, Width, Height; public uint Flags; }
    delegate IntPtr SubclassProc(IntPtr window, uint message, IntPtr w, IntPtr l, UIntPtr id, IntPtr data);
    static readonly SubclassProc PositionWindow = OnWindowMessage;
    [DllImport("comctl32.dll")] static extern bool SetWindowSubclass(IntPtr window, SubclassProc callback, UIntPtr id, IntPtr data);
    [DllImport("comctl32.dll")] static extern bool RemoveWindowSubclass(IntPtr window, SubclassProc callback, UIntPtr id);
    [DllImport("comctl32.dll")] static extern IntPtr DefSubclassProc(IntPtr window, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    public static void EnableDpi() {
      try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (EntryPointNotFoundException) { }
      SetProcessDPIAware();
    }
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    delegate bool ChildWindowProc(IntPtr window, IntPtr data);
    static readonly ChildWindowProc WatchForPaint = WatchChild;
    static readonly SubclassProc PaintedChild = OnChildMessage;
    static readonly List<IntPtr> PaintWindows = new List<IntPtr>();
    static IntPtr InitialWindow;
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, ChildWindowProc callback, IntPtr data);
    static bool WatchChild(IntPtr window, IntPtr data) {
      if (SetWindowSubclass(window, PaintedChild, new UIntPtr(1), InitialWindow)) PaintWindows.Add(window);
      return true;
    }
    static void FinishInitialization(IntPtr window) {
      RemoveWindowSubclass(window, PositionWindow, new UIntPtr(1));
      if (InitialWindow == window) {
        foreach (IntPtr child in PaintWindows.ToArray()) RemoveWindowSubclass(child, PaintedChild, new UIntPtr(1));
        PaintWindows.Clear(); InitialWindow = IntPtr.Zero;
      }
    }
    static IntPtr OnChildMessage(IntPtr window, uint message, IntPtr w, IntPtr l, UIntPtr id, IntPtr root) {
      IntPtr result = DefSubclassProc(window, message, w, l);
      // Explorer often paints its child controls without sending WM_PAINT to the frame.
      if (message == 0x000F && IsWindowVisible(window)) FinishInitialization(root);
      else if (message == 0x0082) { RemoveWindowSubclass(window, PaintedChild, id); PaintWindows.Remove(window); }
      return result;
    }
    // Protect initial geometry until the first visible client/control paint finishes.
    // User moves and display/DPI changes hand control back to Windows immediately.
    static IntPtr OnWindowMessage(IntPtr window, uint message, IntPtr w, IntPtr l, UIntPtr id, IntPtr owner) {
      if (message == 0x0231 || message == 0x0112 || message == 0x0082 || message == 0x02E0 ||
          message == 0x007E || message == 0x001A || (owner != IntPtr.Zero && !IsWindow(owner)))
        FinishInitialization(window);
      else if (message == 0x000F && IsWindowVisible(window)) {
        IntPtr result = DefSubclassProc(window, message, w, l);
        FinishInitialization(window);
        return result;
      } else if (message == 0x0046) { // WM_WINDOWPOSCHANGING
        var pos = (WindowPos)Marshal.PtrToStructure(l, typeof(WindowPos));
        if ((pos.Flags & 3) == 3) return DefSubclassProc(window, message, w, l); // No move/resize requested.
        var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) }; Rect rect;
        if (GetMonitorInfo(MonitorFromWindow(owner, 2), ref info) && GetWindowRect(window, out rect)) {
          if ((pos.Flags & 1) != 0) { pos.Width = rect.Right - rect.Left; pos.Height = rect.Bottom - rect.Top; }
          pos.Width = Math.Min(pos.Width, info.Work.Right - info.Work.Left);
          pos.Height = Math.Min(pos.Height, info.Work.Bottom - info.Work.Top);
          pos.X = info.Work.Left + (info.Work.Right - info.Work.Left - pos.Width) / 2;
          pos.Y = info.Work.Top + (info.Work.Bottom - info.Work.Top - pos.Height) / 2;
          pos.Flags &= ~3u; // Supply both position and clamped size.
          Marshal.StructureToPtr(pos, l, false);
        }
      }
      return DefSubclassProc(window, message, w, l);
    }
    public static bool Center(IntPtr window, IntPtr owner, bool initialize = true) {
      if (initialize) {
        if (InitialWindow != IntPtr.Zero) FinishInitialization(InitialWindow);
        InitialWindow = window;
        EnumChildWindows(window, WatchForPaint, IntPtr.Zero);
        if (!SetWindowSubclass(window, PositionWindow, new UIntPtr(1), owner)) {
          FinishInitialization(window);
          throw new System.ComponentModel.Win32Exception("Cannot initialize native window placement");
        }
      }
      var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
      Rect rect;
      if (!GetMonitorInfo(MonitorFromWindow(owner, 2), ref info) || !GetWindowRect(window, out rect)) return false;
      var work = info.Work;
      int width = Math.Min(rect.Right - rect.Left, work.Right - work.Left);
      int height = Math.Min(rect.Bottom - rect.Top, work.Bottom - work.Top);
      if (!SetWindowPos(window, IntPtr.Zero, work.Left + (work.Right - work.Left - width) / 2,
        work.Top + (work.Bottom - work.Top - height) / 2, width, height, 0x14) || !GetWindowRect(window, out rect)) return false;
      // Restoring an Explorer window can animate asynchronously. A successful API call
      // alone does not establish that its on-screen rectangle has reached the target.
      return rect.Right > rect.Left && rect.Bottom > rect.Top && rect.Left >= work.Left && rect.Top >= work.Top &&
        rect.Right <= work.Right && rect.Bottom <= work.Bottom &&
        Math.Abs(rect.Left + rect.Right - work.Left - work.Right) <= 2 && Math.Abs(rect.Top + rect.Bottom - work.Top - work.Bottom) <= 2;
    }
  }
  [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
  public class Events : IFileDialogEvents, IFileDialogControlEvents {
    internal IFileOpenDialog Dialog;
    internal IntPtr Owner;
    internal string[] Selected;
    internal int Limit;
    internal bool Mixed;
    string[] SelectedPaths() {
      // The filename edit can override GetSelectedItems in mixed mode, dropping selected folders.
      // Read the actual Explorer view selection used by both explicit selection buttons.
      ShellBrowser browser = null; object view = null;
      try {
        var service = new Guid("4C96BE40-915C-11CF-99D3-00AA004AE837");
        var iid = new Guid("000214E2-0000-0000-C000-000000000046");
        Marshal.ThrowExceptionForHR(((Services)Dialog).QueryService(ref service, ref iid, out browser));
        browser.QueryActiveShellView(out view);
        var folderView = (FolderView)view;
        int count; folderView.ItemCount(1, out count);
        if (count == 0) return new string[0];
        var array = new Guid("B63EA76D-1F85-456F-A19C-48159EFA858B");
        IShellItemArray items; folderView.Items(1, ref array, out items); // SVGIO_SELECTION
        return Paths(items);
      } finally {
        if (view != null) Marshal.ReleaseComObject(view);
        if (browser != null) Marshal.ReleaseComObject(browser);
      }
    }
    string[] SelectedFolders() {
      return Array.FindAll(SelectedPaths(), System.IO.Directory.Exists);
    }
    string CurrentFolder() {
      IShellItem folder; Dialog.GetFolder(out folder);
      try {
        IntPtr name; folder.GetDisplayName(0x80058000, out name);
        try { return Marshal.PtrToStringUni(name); }
        finally { Marshal.FreeCoTaskMem(name); }
      } finally { Marshal.ReleaseComObject(folder); }
    }
    void UpdateFolderButton() {
      if (!Mixed) return;
      try {
        var folders = SelectedFolders();
        string label;
        if (folders.Length > 0) label = "选择所选文件夹（" + folders.Length + "）";
        else {
          var name = System.IO.Path.GetFileName(CurrentFolder().TrimEnd('\\', '/'));
          if (name.Length > 32) name = name.Substring(0, 32) + "…";
          label = "选择当前文件夹（" + name + "）";
        }
        ((IFileDialogCustomize)Dialog).SetControlLabel(1002, label);
      } catch (COMException) { }
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBox(IntPtr owner, string text, string title, uint flags);
    internal static string[] Paths(IShellItemArray items) {
      try {
        uint count; items.GetCount(out count);
        var paths = new List<string>();
        for (uint i = 0; i < count; i++) {
          IShellItem item; items.GetItemAt(i, out item);
          try {
            IntPtr name; item.GetDisplayName(0x80058000, out name); // SIGDN_FILESYSPATH
            try { paths.Add(Marshal.PtrToStringUni(name)); }
            finally { Marshal.FreeCoTaskMem(name); }
          } finally { Marshal.ReleaseComObject(item); }
        }
        return paths.ToArray();
      } finally { Marshal.ReleaseComObject(items); }
    }
    public int OnButtonClicked(IFileDialogCustomize dialog, uint control) {
      try {
        string[] paths;
        if (control == 1002) {
          paths = SelectedFolders();
          if (paths.Length == 0) paths = new string[] { CurrentFolder() };
        } else {
          paths = SelectedPaths();
        }
        if (paths.Length == 0) return 0;
        if (paths.Length > Limit) {
          IntPtr window; ((IOleWindow)Dialog).GetWindow(out window);
          MessageBox(window, "最多选择 " + Limit + " 项", "打开", 0x30); return 0;
        }
        Selected = paths; Dialog.Close(0);
      } catch (COMException) { /* Virtual shell items are not filesystem paths. */ }
      return 0;
    }
    // GetResults is consumed only after Show returns; the shared service validates
    // count and type for typed filenames as well as list selections.
    public int OnFileOk(IFileOpenDialog dialog) { return 0; }
    public int OnFolderChanging(IFileOpenDialog dialog, IShellItem folder) { return 0; }
    bool shown;
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    public int OnFolderChange(IFileOpenDialog dialog) {
      if (!shown) {
        IntPtr window; ((IOleWindow)dialog).GetWindow(out window);
        Placement.Center(window, Owner);
        ShowWindow(window, 5); SetForegroundWindow(window); shown = true;
      }
      UpdateFolderButton();
      return 0;
    }
    public int OnSelectionChange(IFileOpenDialog dialog) { UpdateFolderButton(); return 0; }
    public int OnShareViolation(IFileOpenDialog dialog, IShellItem item, out uint response) { response = 0; return 0; }
    public int OnTypeChange(IFileOpenDialog dialog) { return 0; }
    public int OnOverwrite(IFileOpenDialog dialog, IShellItem item, out uint response) { response = 0; return 0; }
    public int OnItemSelected(IFileDialogCustomize dialog, uint control, uint item) { return 0; }
    public int OnCheckButtonToggled(IFileDialogCustomize dialog, uint control, bool value) { return 0; }
    public int OnControlActivating(IFileDialogCustomize dialog, uint control) { return 0; }
  }
  public static class Host {
    [STAThread]
    public static int Main(string[] args) {
      IFileOpenDialog dialog = null;
      try {
        Placement.EnableDpi();
        Console.SetOut(new System.IO.StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false)) { AutoFlush = true });
        var json = new System.Web.Script.Serialization.JavaScriptSerializer();
        string request;
        if (args.Length == 1 && args[0] == "--standby") {
          // Load the CLR, serializer and Explorer COM implementation before accepting a request.
          json.Serialize(new string[0]);
          dialog = (IFileOpenDialog)new FileOpenDialog();
          uint flags; dialog.GetOptions(out flags);
          Console.WriteLine("ready");
          Console.SetIn(new System.IO.StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false, true)));
          request = Console.ReadLine();
          if (request == null) return 0; // Parent closed its pipe; never show an orphaned dialog.
        } else request = Environment.GetEnvironmentVariable("AXIOM_OPEN_OPTIONS");
        var options = json.Deserialize<Dictionary<string, object>>(request);
        string directory = options.ContainsKey("initialDirectory") ? (string)options["initialDirectory"] : null;
        if (dialog == null) dialog = (IFileOpenDialog)new FileOpenDialog();
        var paths = Open(dialog, (string)options["title"], (string)options["kind"], (bool)options["multiple"], directory);
        Console.WriteLine(json.Serialize(paths));
        return 0;
      } catch (Exception error) {
        Console.Error.WriteLine("Native Open failed: " + error.GetType().Name + " (" + error.HResult.ToString("X") + ")"); return 1;
      } finally { if (dialog != null) Marshal.ReleaseComObject(dialog); }
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr bind, ref Guid iid, out IShellItem item);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateWindowEx(uint exStyle, string className, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    public static string[] Open(IFileOpenDialog dialog, string title, string kind, bool multiple, string directory) {
      // Consume STARTUPINFO's hidden first ShowWindow on an invisible utility window,
      // not on the real dialog. The foreground app owns the native modal window.
      IntPtr owner = GetForegroundWindow();
      IntPtr utility = CreateWindowEx(0x80, "STATIC", "", 0x80000000, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
      ShowWindow(utility, 0); DestroyWindow(utility);
      uint cookie = 0;
      try {
        uint flags; dialog.GetOptions(out flags);
        flags |= 0x40 | 0x800 | 0x1000 | 0x02000000; // filesystem, existing paths/files, no recent list
        if (multiple) flags |= 0x200;
        if (kind == "folder") flags |= 0x20;
        dialog.SetOptions(flags); dialog.SetTitle(title); dialog.SetOkButtonLabel("打开");
        // A local home folder avoids the potentially slow Quick Access/recent network locations.
        if (String.IsNullOrEmpty(directory)) directory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!String.IsNullOrEmpty(directory) && System.IO.Directory.Exists(directory)) {
          IShellItem folder; Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
          SHCreateItemFromParsingName(directory, IntPtr.Zero, ref iid, out folder);
          try { dialog.SetFolder(folder); } finally { Marshal.ReleaseComObject(folder); }
        }
        var events = new Events { Dialog = dialog, Owner = owner, Limit = multiple ? 50 : 1, Mixed = kind == "mixed" };
        dialog.Advise(events, out cookie);
        if (kind == "mixed") {
          var custom = (IFileDialogCustomize)dialog;
          custom.AddPushButton(1001, "选择所选项目");
          custom.AddPushButton(1002, "选择当前文件夹");
        }
        int result = dialog.Show(owner);
        if (result == unchecked((int)0x800704C7)) return new string[0];
        Marshal.ThrowExceptionForHR(result);
        if (events.Selected != null) return events.Selected;
        IShellItemArray selected; dialog.GetResults(out selected); return Events.Paths(selected);
      } finally {
        if (cookie != 0) dialog.Unadvise(cookie);
      }
    }
  }
}
`;
