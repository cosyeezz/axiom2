import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { WindowsOpenHost } from "./windows-open-host.js";

export class FileManagerError extends Error {
  constructor(message = "无法打开系统文件管理器", readonly status = 503) { super(message); }
}
export type RevealDirectory = ((directory: string, signal: AbortSignal) => Promise<void>) & {
  prepare?: () => Promise<void>;
  close?: () => Promise<void>;
};

export function nativeFileManager(): RevealDirectory {
  const host = process.platform === "win32" ? new WindowsOpenHost("explorer") : undefined;
  let keepWarm = false;
  const reveal: RevealDirectory = async (directory, signal) => {
    signal.throwIfAborted();
    let prepared: ChildProcess | undefined;
    if (host) {
      try { prepared = await host.take(keepWarm, signal); }
      catch { signal.throwIfAborted(); throw new FileManagerError(); }
    }
    return new Promise<void>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = prepared ?? spawn(process.platform === "darwin" ? "/usr/bin/open" : "xdg-open", [directory], {
          shell: false, stdio: "ignore", detached: true,
        });
      } catch { reject(new FileManagerError()); return; }
      // Non-Windows desktops retain their system opener. Window geometry is OS-specific.
      if (!prepared) {
        child.once("error", () => reject(new FileManagerError()));
        child.once("spawn", () => { child.unref(); resolve(); });
        return;
      }
      let output = "", bytes = 0, failure: unknown;
      const terminate = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
      const abort = () => { failure = signal.reason; terminate(); };
      const collect = (chunk: Buffer, stdout: boolean) => {
        bytes += chunk.length;
        if (bytes > 4096) { failure ??= new FileManagerError(); terminate(); }
        else if (stdout) output += chunk.toString("utf8");
      };
      child.stdout!.on("data", (chunk: Buffer) => collect(chunk, true));
      child.stderr!.on("data", (chunk: Buffer) => collect(chunk, false));
      child.once("error", () => { failure ??= new FileManagerError(); });
      signal.addEventListener("abort", abort, { once: true });
      child.once("close", (code) => {
        signal.removeEventListener("abort", abort);
        if (failure) reject(failure);
        else if (code === 2 && output.trim() === "foreground-unavailable")
          reject(new FileManagerError("无法将系统文件管理器切换到前台，请确认 Windows 桌面已连接并解锁后重试"));
        else if (code !== 0 || output.trim() !== "opened") reject(new FileManagerError());
        else resolve();
      });
      if (signal.aborted) abort();
      else child.stdin!.end(JSON.stringify({ directory }) + "\n", "utf8", (error?: Error | null) => {
        if (error) { failure ??= new FileManagerError(); terminate(); }
      });
    });
  };
  reveal.prepare = async () => { keepWarm = true; await host?.prepare(); };
  reveal.close = async () => { await host?.close(); };
  return reveal;
}

/** Windows succeeds only after the requested Explorer is foreground and positioned, and its helper has exited. */
export class FileManager {
  private active?: { controller: AbortController; done: Promise<void> };
  private closed = false;
  constructor(private readonly reveal: RevealDirectory = nativeFileManager(), private readonly timeoutMs = 10_000) {}

  async prepare() { await this.reveal.prepare?.(); }

  async open(directory: string, signal: AbortSignal): Promise<void> {
    if (this.closed) throw new FileManagerError("服务正在退出");
    if (this.active) throw new FileManagerError("正在打开系统文件管理器，请稍候", 409);
    signal.throwIfAborted();
    if (!isAbsolute(directory) || directory.length > 4096 || /[\x00-\x1f\x7f]/.test(directory))
      throw new FileManagerError("工作空间目录无效", 400);
    const controller = new AbortController();
    const abort = () => controller.abort(new FileManagerError("打开请求已断开", 499));
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new FileManagerError("打开系统文件管理器超时，请重试", 504)), this.timeoutMs);
    timer.unref();
    const done = Promise.resolve().then(async () => {
      controller.signal.throwIfAborted();
      let directoryExists = false;
      try { directoryExists = (await stat(directory)).isDirectory(); } catch { /* Report a missing/unavailable directory consistently. */ }
      controller.signal.throwIfAborted();
      if (!directoryExists) throw new FileManagerError("工作空间目录不存在或无法访问", 400);
      await this.reveal(directory, controller.signal);
      controller.signal.throwIfAborted();
    });
    this.active = { controller, done };
    try { await done; }
    finally { clearTimeout(timer); signal.removeEventListener("abort", abort); this.active = undefined; }
  }

  async close() {
    this.closed = true;
    const active = this.active;
    active?.controller.abort(new FileManagerError("服务正在退出"));
    await this.reveal.close?.();
    await active?.done.catch(() => {});
  }
}
