import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Query actual top-level Win32 windows, independently of CDP page targets. */
export async function inspectDesktopWindow(pid: number, size?: { width: number; height: number }) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const width = size?.width ?? 0, height = size?.height ?? 0;
  assert.ok(Number.isSafeInteger(width) && Number.isSafeInteger(height));
  const script = `$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DesktopWindow {
  delegate bool Callback(IntPtr handle, IntPtr state);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr state);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint process);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr handle, int index);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr handle, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr handle, out Rect rect);
  [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr handle, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static int[] Inspect(uint process, int width, int height) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    int count = 0, w = 0, h = 0;
    EnumWindows((handle, state) => {
      uint owner; GetWindowThreadProcessId(handle, out owner);
      if (owner == process && IsWindowVisible(handle)) {
        var title = new System.Text.StringBuilder(512); var type = new System.Text.StringBuilder(512);
        GetWindowText(handle, title, title.Capacity); GetClassName(handle, type, type.Capacity);
        Rect observed; GetClientRect(handle, out observed);
        int style = GetWindowLong(handle, -16);
        Console.Error.WriteLine(title + " | " + type + " | " + style.ToString("X") + " | " + observed.Right + "x" + observed.Bottom);
        // Tauri also owns zero-size single-instance and event-loop windows. Count
        // decorated top-level application windows that can be closed by users.
        if ((style & 0x00C00000) != 0x00C00000) return true;
        count++;
        if (width > 0 && height > 0 && !MoveWindow(handle, 100, 100, width, height, true)) throw new Exception("Resize failed");
        Rect rect; if (!GetClientRect(handle, out rect)) throw new Exception("Client bounds unavailable");
        w = rect.Right - rect.Left; h = rect.Bottom - rect.Top;
      }
      return true;
    }, IntPtr.Zero);
    return new int[] { count, w, h };
  }
}
'@
[DesktopWindow]::Inspect(${pid}, ${width}, ${height}) | ConvertTo-Json -Compress`;
  const result = await promisify(execFile)("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeout: 15_000 });
  console.log("Native window inspection:", result.stderr.trim());
  const [count, clientWidth, clientHeight] = JSON.parse(result.stdout) as number[];
  assert.equal(count, 1, "Two WebView targets must belong to exactly one visible native window");
  return { clientWidth, clientHeight };
}
