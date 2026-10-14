import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { openDialogLimit, type OpenDialogOptions } from "../shared/open-dialog.js";
import { linuxOpenScript, macOpenScript } from "./open-dialog-scripts.js";
import { WindowsOpenHost } from "./windows-open-host.js";

export class OpenDialogError extends Error {
  constructor(message: string, readonly status = 500) { super(message); }
}
export type PickPaths = ((options: OpenDialogOptions, signal: AbortSignal) => Promise<string[]>) & {
  prepare?: () => Promise<void>;
  close?: () => Promise<void>;
};
export type PickerSpawn = (file: string, args: string[], options: SpawnOptions) => ChildProcess;

export function openDialogCommand(platform: NodeJS.Platform, windowsExecutable = "AxiomOpen.exe") {
  if (platform === "win32") return { file: windowsExecutable, args: [] as string[] };
  if (platform === "darwin") return { file: "/usr/bin/osascript", args: ["-l", "JavaScript", "-e", macOpenScript] };
  if (platform === "linux") return { file: "python3", args: ["-I", "-c", linuxOpenScript] };
  throw new OpenDialogError("当前系统不支持原生打开窗口", 503);
}

export function nativeOpenDialog(dependencies: { platform?: NodeJS.Platform; spawn?: PickerSpawn } = {}): PickPaths {
  const platform = dependencies.platform ?? process.platform;
  // Injected process adapters use a virtual command; production always prepares the trusted GUI host.
  const host = platform === "win32" && !dependencies.spawn ? new WindowsOpenHost() : undefined;
  const pick: PickPaths = async (options, signal) => {
    signal.throwIfAborted();
    const unavailable = () => new OpenDialogError(platform === "linux"
      ? "无法打开系统选择器：需要 Python 3、PyGObject 和 GTK 3（Debian/Ubuntu: python3-gi gir1.2-gtk-3.0），并在图形桌面会话中运行服务"
      : "无法打开系统选择器，请确认系统组件与图形桌面会话可用", 503);
    let command: { file: string; args: string[] };
    try { command = host ? await host.prepare() : openDialogCommand(platform); }
    catch { throw unavailable(); }
    signal.throwIfAborted();
    return new Promise<string[]>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = (dependencies.spawn ?? spawn)(command.file, command.args, {
          shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, AXIOM_OPEN_OPTIONS: JSON.stringify({ ...options, title: options.title ?? "打开" }) },
        });
      } catch { reject(unavailable()); return; }
      const stdout: Buffer[] = [];
      let bytes = 0, failure: unknown;
      const terminate = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
      const abort = () => { failure = signal.reason; terminate(); };
      const collect = (chunk: Buffer, output: boolean) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { failure = new OpenDialogError("系统选择器返回内容过大"); terminate(); }
        else if (output) stdout.push(chunk);
      };
      child.stdout?.on("data", (chunk: Buffer) => collect(chunk, true));
      child.stderr?.on("data", (chunk: Buffer) => collect(chunk, false));
      signal.addEventListener("abort", abort, { once: true });
      process.once("exit", terminate);
      if (signal.aborted) abort();
      child.once("error", () => { failure = unavailable(); });
      child.once("close", (code) => {
        signal.removeEventListener("abort", abort);
        process.removeListener("exit", terminate);
        if (failure) { reject(failure); return; }
        if (code !== 0) { reject(platform === "linux" && (code === 3 || code === 4) ? unavailable() : new OpenDialogError("系统打开窗口未能完成，请确认桌面会话可用")); return; }
        try {
          const paths: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(stdout)));
          if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) throw Error();
          if (paths.length > (options.multiple ? openDialogLimit : 1)) {
            reject(new OpenDialogError(options.multiple ? "最多选择 50 项，请重新选择" : "只能选择一项，请重新选择", 400)); return;
          }
          resolve(paths);
        } catch { reject(new OpenDialogError("系统选择器返回了无效的路径列表")); }
      });
    });
  };
  pick.prepare = async () => { await host?.prepare(); };
  pick.close = async () => { await host?.close(); };
  return pick;
}

/** One shared service instance for ALL entry points; abort retains the slot until process exit. */
export class OpenDialog {
  private active?: { controller: AbortController; done: Promise<string[]> };
  private closed = false;
  constructor(private readonly pick: PickPaths = nativeOpenDialog(), private readonly timeoutMs = 120_000) {}

  async prepare() { await this.pick.prepare?.(); }

  async select(options: OpenDialogOptions, signal: AbortSignal, pick: PickPaths = this.pick): Promise<string[]> {
    if (this.closed) throw new OpenDialogError("服务正在退出", 503);
    if (this.active) throw new OpenDialogError("打开窗口已在使用中，请先完成或取消选择", 409);
    if (!["file", "folder", "mixed"].includes(options.kind) || typeof options.multiple !== "boolean")
      throw new OpenDialogError("打开窗口的选择模式无效", 400);
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(new OpenDialogError("选择请求已断开", 499));
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new OpenDialogError("选择超时，请重试", 504)), this.timeoutMs);
    timer.unref();
    const done = Promise.resolve().then(async () => {
      controller.signal.throwIfAborted();
      const selected = await pick(options, controller.signal);
      controller.signal.throwIfAborted();
      if (!Array.isArray(selected) || selected.length > (options.multiple ? openDialogLimit : 1))
        throw new OpenDialogError(options.multiple ? "最多选择 50 项" : "只能选择一项", 400);
      const paths: string[] = [], seen = new Set<string>();
      for (const value of selected) {
        if (typeof value !== "string" || !isAbsolute(value) || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value))
          throw new OpenDialogError("选择器未返回有效的绝对路径", 400);
        let path: string, info;
        try { path = await realpath(value); info = await stat(path); }
        catch { throw new OpenDialogError("所选项目不存在或无法访问", 400); }
        controller.signal.throwIfAborted();
        if (path.length > 4096 || /[\x00-\x1f\x7f]/.test(path) || (!info.isFile() && !info.isDirectory()) ||
          (options.kind === "file" && !info.isFile()) || (options.kind === "folder" && !info.isDirectory()))
          throw new OpenDialogError("所选项目不符合文件或文件夹选择要求", 400);
        const key = process.platform === "win32" ? path.toLowerCase() : path;
        if (!seen.has(key)) { seen.add(key); paths.push(path); }
      }
      return paths;
    });
    this.active = { controller, done };
    try { return await done; }
    finally { clearTimeout(timer); signal.removeEventListener("abort", abort); this.active = undefined; }
  }

  async close() {
    this.closed = true;
    const active = this.active;
    if (active) {
      active.controller.abort(new OpenDialogError("服务正在退出", 503));
      await active.done.catch(() => {});
    }
    await this.pick.close?.();
  }
}
