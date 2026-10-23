import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { windowsEngineSupervisor } from "./rea-engine-windows.js";

export type EngineRun = (file: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; signal: AbortSignal; timeout?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
/** No shell, including Windows: paths with spaces are passed as a single argument. */
export const runEngine: EngineRun = (file, args, options) => new Promise((resolve, reject) => {
  options.signal.throwIfAborted();
  const windows = process.platform === "win32";
  const command = windows ? process.execPath : file;
  const arguments_ = windows ? ["-e", windowsEngineSupervisor, JSON.stringify([createRequire(import.meta.url).resolve("koffi"), file, args])] : args;
  const child = spawn(command, arguments_, { cwd: options.cwd, env: { ...process.env, ...options.env, NO_COLOR: "1" }, windowsHide: true, detached: !windows, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (!child.pid) return;
    if (!windows) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    else child.kill("SIGKILL"); // Closing the supervisor's Job Object kills ALL descendants.
  };
  const timer = setTimeout(stop, options.timeout ?? 30_000);
  const cleanup = () => { clearTimeout(timer); options.signal.removeEventListener("abort", stop); };
  options.signal.addEventListener("abort", stop, { once: true });
  if (options.signal.aborted) stop();
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (text: string) => { stdout += text; if (stdout.length > 2 * 1024 * 1024) stop(); });
  child.stderr.on("data", (text: string) => { stderr += text; if (stderr.length > 256 * 1024) stop(); });
  child.once("error", () => { cleanup(); reject(Error("组件程序无法启动，请检查路径、执行权限及系统架构。")); });
  child.once("close", code => { cleanup(); if (stopped) reject(Error("组件检测已取消、超时或输出超限。")); else resolve({ code: code ?? -1, stdout, stderr }); });
});
