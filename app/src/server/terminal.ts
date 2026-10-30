import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, win32 } from "node:path";

export class TerminalError extends Error {
  constructor(message = "无法打开系统终端，请确认已安装终端且桌面可用", readonly status = 503) { super(message); }
}
export type OpenTerminal = (directory: string, signal: AbortSignal) => Promise<void>;
type Launcher = { file: string; args: string[]; persistent?: boolean; env?: NodeJS.ProcessEnv };

/** Paths are arguments or environment data, never interpolated into shell code. */
export function terminalLaunchers(directory: string, platform: NodeJS.Platform = process.platform): Launcher[] {
  if (platform === "darwin") return [{ file: "/usr/bin/open", args: ["-a", "Terminal", directory] }];
  if (platform === "win32") {
    const script = "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:ComSpec -WorkingDirectory $env:AXIOM_TERMINAL_CWD";
    const system = win32.join(process.env.SystemRoot || "C:\\Windows", "System32");
    return [{ file: win32.join(system, "WindowsPowerShell", "v1.0", "powershell.exe"), args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      env: { ...process.env, ComSpec: win32.join(system, "cmd.exe"), AXIOM_TERMINAL_CWD: directory } }];
  }
  if (platform === "linux") return [
    { file: "/usr/bin/x-terminal-emulator", args: [], persistent: true },
    { file: "/usr/bin/gnome-terminal", args: ["--working-directory", directory], persistent: true },
    { file: "/usr/bin/konsole", args: ["--workdir", directory], persistent: true },
    { file: "/usr/bin/xfce4-terminal", args: ["--working-directory", directory], persistent: true },
    { file: "/usr/bin/xterm", args: [], persistent: true },
  ];
  throw new TerminalError("当前系统暂不支持打开终端");
}

function launch(launcher: Launcher, directory: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(launcher.file, launcher.args, {
      cwd: directory, env: launcher.env, shell: false, stdio: "ignore", windowsHide: true, detached: !!launcher.persistent,
    });
    let settled = false, startup: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(startup); signal.removeEventListener("abort", abort);
      if (error) reject(error); else { child.unref(); resolve(); }
    };
    const abort = () => { child.kill("SIGKILL"); };
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", error => finish(signal.aborted ? signal.reason : error));
    child.once("close", code => finish(signal.aborted ? signal.reason : code === 0 ? undefined : new TerminalError()));
    // Some Linux terminals ARE the long-lived process. Accept startup without waiting
    // for the user's window to close, but surface immediate desktop/launcher failures.
    if (launcher.persistent) child.once("spawn", () => { startup = setTimeout(() => finish(signal.aborted ? signal.reason : undefined), 400); });
    if (signal.aborted) abort();
  });
}

export function nativeTerminal(platform: NodeJS.Platform = process.platform): OpenTerminal {
  return async (directory, signal) => {
    for (const launcher of terminalLaunchers(directory, platform)) {
      signal.throwIfAborted();
      try { await launch(launcher, directory, signal); return; }
      catch (error) {
        signal.throwIfAborted();
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error instanceof TerminalError ? error : new TerminalError();
      }
    }
    throw new TerminalError();
  };
}

/** Owns only pending launchers, never terminals already handed over to the user. */
export class Terminal {
  private active?: { controller: AbortController; done: Promise<void> };
  private closed = false;
  constructor(private readonly openNative: OpenTerminal = nativeTerminal(), private readonly timeoutMs = 10_000) {}

  async open(directory: string, signal: AbortSignal): Promise<void> {
    if (this.closed) throw new TerminalError("服务正在退出");
    if (this.active) throw new TerminalError("正在打开终端，请稍候", 409);
    signal.throwIfAborted();
    if (!isAbsolute(directory) || directory.length > 4096 || /[\x00-\x1f\x7f]/.test(directory))
      throw new TerminalError("终端工作目录无效", 400);
    const controller = new AbortController();
    const abort = () => controller.abort(new TerminalError("打开请求已断开", 499));
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new TerminalError("打开终端超时，请重试", 504)), this.timeoutMs);
    timer.unref();
    const done = Promise.resolve().then(async () => {
      controller.signal.throwIfAborted();
      let exists = false;
      try { exists = (await stat(directory)).isDirectory(); } catch { /* Keep inaccessible paths out of the launcher. */ }
      controller.signal.throwIfAborted();
      if (!exists) throw new TerminalError("终端工作目录不存在或无法访问", 400);
      await this.openNative(directory, controller.signal);
      controller.signal.throwIfAborted();
    });
    this.active = { controller, done };
    try { await done; }
    finally { clearTimeout(timer); signal.removeEventListener("abort", abort); this.active = undefined; }
  }

  async close(): Promise<void> {
    this.closed = true;
    const active = this.active;
    active?.controller.abort(new TerminalError("服务正在退出"));
    await active?.done.catch(() => {});
  }
}
