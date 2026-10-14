// Desktop timing includes native process startup and waits for an OS-visible dialog.
// Optional AXIOM_PICKER_BASELINE_COMMAND points to a saved {file,args} command for comparison.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WindowsOpenHost } from "../src/server/windows-open-host.js";

if (process.platform !== "win32") throw Error("Requires a Windows desktop session");
const probeSource = String.raw`
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
class Command { public string file; public string[] args; }
class Probe {
  delegate bool Callback(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr state);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
  // These known command arguments contain no spaces/quotes; request data is exclusively environment JSON.
  public static int Main() {
    var command = new JavaScriptSerializer().Deserialize<Command>(Environment.GetEnvironmentVariable("AXIOM_LATENCY_COMMAND"));
    foreach (var arg in command.args) if (arg.IndexOfAny(new char[] {' ', '"', '\t', '\r', '\n'}) >= 0) throw new Exception("Unexpected command argument");
    var start = new ProcessStartInfo(command.file, String.Join(" ", command.args));
    start.UseShellExecute = false; start.CreateNoWindow = true; start.WindowStyle = ProcessWindowStyle.Hidden;
    start.RedirectStandardOutput = true; start.RedirectStandardError = true;
    var timer = Stopwatch.StartNew();
    using (var process = Process.Start(start)) {
      var output = process.StandardOutput.ReadToEndAsync();
      var errors = process.StandardError.ReadToEndAsync();
      try {
        IntPtr found = IntPtr.Zero;
        while (timer.ElapsedMilliseconds < 15000 && !process.HasExited) {
          EnumWindows(delegate(IntPtr window, IntPtr state) {
            uint pid; GetWindowThreadProcessId(window, out pid);
            if (pid == process.Id && IsWindowVisible(window)) {
              var text = new StringBuilder(256); GetWindowText(window, text, 256);
              if (text.ToString() == "Axiom latency test") found = window;
            }
            return true;
          }, IntPtr.Zero);
          if (found != IntPtr.Zero) break;
          Thread.Sleep(10);
        }
        long elapsed = timer.ElapsedMilliseconds;
        if (found == IntPtr.Zero) throw new Exception("No visible dialog: " + (process.HasExited ? errors.Result : "host still running"));
        PostMessage(found, 0x10, IntPtr.Zero, IntPtr.Zero);
        if (!process.WaitForExit(5000)) throw new Exception("Cancel did not close dialog");
        if (process.ExitCode != 0 || output.Result.Trim() != "[]") throw new Exception("Invalid cancellation result: " + errors.Result);
        Console.WriteLine(elapsed);
        return 0;
      } finally { if (!process.HasExited) { process.Kill(); process.WaitForExit(); } }
    }
  }
}
`;
const root = mkdtempSync(join(tmpdir(), "axiom-open-timing-")), host = new WindowsOpenHost();
try {
  const source = join(root, "Probe.cs"), probe = join(root, "Probe.exe");
  writeFileSync(source, probeSource, "utf8");
  const compiler = join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", process.arch === "ia32" ? "Framework" : "Framework64", "v4.0.30319", "csc.exe");
  const compiled = spawnSync(compiler, ["/nologo", "/reference:System.Web.Extensions.dll", `/out:${probe}`, source], { windowsHide: true, encoding: "utf8", timeout: 15_000 });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const preparedAt = performance.now();
  const command = await host.prepare();
  console.log(`Preparation before accepting clicks: ${Math.round(performance.now() - preparedAt)} ms`);
  const commands: [string, { file: string; args: string[] }][] = [];
  if (process.env.AXIOM_PICKER_BASELINE_COMMAND) commands.push(["baseline", JSON.parse(readFileSync(process.env.AXIOM_PICKER_BASELINE_COMMAND, "utf8"))]);
  commands.push(["prepared GUI host", command]);
  for (const [label, target] of commands) {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const result = spawnSync(probe, [], { windowsHide: true, encoding: "utf8", timeout: 22_000, env: {
        ...process.env, AXIOM_LATENCY_COMMAND: JSON.stringify(target),
        AXIOM_OPEN_OPTIONS: JSON.stringify({ title: "Axiom latency test", kind: "mixed", multiple: true, initialDirectory: root }),
      } });
      assert.equal(result.status, 0, result.stderr || String(result.error));
      const ms = Number(result.stdout.trim());
      assert.ok(Number.isFinite(ms) && ms > 0);
      times.push(ms);
    }
    console.log(`${label}: ${times.join(", ")} ms; median ${[...times].sort((a, b) => a - b)[1]} ms (process start to visible)`);
  }
} finally { await host.close(); rmSync(root, { recursive: true, force: true }); }
