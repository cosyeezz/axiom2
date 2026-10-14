/** Static native hosts. Request values travel only in AXIOM_OPEN_OPTIONS (JSON), never source code. */
export const macOpenScript = String.raw`
ObjC.import('AppKit');
ObjC.import('Foundation');
function run() {
  const options = JSON.parse(ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('AXIOM_OPEN_OPTIONS')));
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  const panel = $.NSOpenPanel.openPanel;
  panel.title = options.title;
  panel.prompt = '打开';
  panel.canChooseFiles = options.kind !== 'folder';
  panel.canChooseDirectories = options.kind !== 'file';
  panel.allowsMultipleSelection = options.multiple;
  panel.canCreateDirectories = true;
  panel.resolvesAliases = true;
  if (options.initialDirectory) panel.directoryURL = $.NSURL.fileURLWithPath(options.initialDirectory);
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
// Compiled once before serving requests; each selection launches this STA GUI host directly.
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
  [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
  public class Events : IFileDialogEvents, IFileDialogControlEvents {
    internal IFileOpenDialog Dialog;
    internal string[] Selected;
    internal int Limit;
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
          IShellItem folder; Dialog.GetFolder(out folder);
          try {
            IntPtr name; folder.GetDisplayName(0x80058000, out name);
            try { paths = new string[] { Marshal.PtrToStringUni(name) }; }
            finally { Marshal.FreeCoTaskMem(name); }
          } finally { Marshal.ReleaseComObject(folder); }
        } else {
          IShellItemArray items; Dialog.GetSelectedItems(out items); paths = Paths(items);
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
        ShowWindow(window, 5); SetForegroundWindow(window); shown = true;
      }
      return 0;
    }
    public int OnSelectionChange(IFileOpenDialog dialog) { return 0; }
    public int OnShareViolation(IFileOpenDialog dialog, IShellItem item, out uint response) { response = 0; return 0; }
    public int OnTypeChange(IFileOpenDialog dialog) { return 0; }
    public int OnOverwrite(IFileOpenDialog dialog, IShellItem item, out uint response) { response = 0; return 0; }
    public int OnItemSelected(IFileDialogCustomize dialog, uint control, uint item) { return 0; }
    public int OnCheckButtonToggled(IFileDialogCustomize dialog, uint control, bool value) { return 0; }
    public int OnControlActivating(IFileDialogCustomize dialog, uint control) { return 0; }
  }
  public static class Host {
    [STAThread]
    public static int Main() {
      try {
        Console.SetOut(new System.IO.StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false)) { AutoFlush = true });
        var json = new System.Web.Script.Serialization.JavaScriptSerializer();
        var options = json.Deserialize<Dictionary<string, object>>(Environment.GetEnvironmentVariable("AXIOM_OPEN_OPTIONS"));
        string directory = options.ContainsKey("initialDirectory") ? (string)options["initialDirectory"] : null;
        var paths = Open((string)options["title"], (string)options["kind"], (bool)options["multiple"], directory);
        Console.WriteLine(json.Serialize(paths));
        return 0;
      } catch (Exception error) {
        Console.Error.WriteLine("Native Open failed: " + error.GetType().Name + " (" + error.HResult.ToString("X") + ")"); return 1;
      }
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr bind, ref Guid iid, out IShellItem item);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateWindowEx(uint exStyle, string className, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    public static string[] Open(string title, string kind, bool multiple, string directory) {
      // Consume STARTUPINFO's hidden first ShowWindow on an invisible utility window,
      // not on the real dialog. The foreground app owns the native modal window.
      IntPtr owner = GetForegroundWindow();
      IntPtr utility = CreateWindowEx(0x80, "STATIC", "", 0x80000000, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
      ShowWindow(utility, 0); DestroyWindow(utility);
      var dialog = (IFileOpenDialog)new FileOpenDialog();
      uint cookie = 0;
      try {
        uint flags; dialog.GetOptions(out flags);
        flags |= 0x40 | 0x800 | 0x1000 | 0x02000000; // filesystem, existing paths/files, no recent list
        if (multiple) flags |= 0x200;
        if (kind == "folder") flags |= 0x20;
        dialog.SetOptions(flags); dialog.SetTitle(title); dialog.SetOkButtonLabel("打开");
        if (!String.IsNullOrEmpty(directory) && System.IO.Directory.Exists(directory)) {
          IShellItem folder; Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
          SHCreateItemFromParsingName(directory, IntPtr.Zero, ref iid, out folder);
          try { dialog.SetFolder(folder); } finally { Marshal.ReleaseComObject(folder); }
        }
        var events = new Events { Dialog = dialog, Limit = multiple ? 50 : 1 };
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
        Marshal.ReleaseComObject(dialog);
      }
    }
  }
}
`;
