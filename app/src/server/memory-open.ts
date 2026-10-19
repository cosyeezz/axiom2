import { spawn } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { AppError } from "../shared/protocol.js";

export type OpenMemoryFile = (path: string, signal?: AbortSignal) => Promise<void>;

export function textFileCommand(path: string, platform = process.platform) {
  if (!isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path) || !/\.(md|txt)$/i.test(path))
    throw new AppError("MEMORY_PATH", "仅支持打开 Markdown 或文本资料");
  if (platform === "win32") return { file: join(process.env.SystemRoot || "C:\\Windows", "System32", "notepad.exe"), args: [path] };
  return platform === "darwin" ? { file: "/usr/bin/open", args: ["-t", path] } : { file: "xdg-open", args: [path] };
}

/** Open a checked text document; never pass memory content or a shell command to the OS. */
export const openMemoryFile: OpenMemoryFile = async (path, signal) => {
  signal?.throwIfAborted();
  const command = textFileCommand(path);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, { shell: false, stdio: "ignore", detached: true });
    const abort = () => { child.kill(); reject(signal?.reason ?? new Error("打开请求已取消")); };
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", () => { signal?.removeEventListener("abort", abort); reject(new AppError("MEMORY_OPEN_FAILED", "无法启动本地文本编辑器，请检查桌面环境后重试")); });
    child.once("spawn", () => { signal?.removeEventListener("abort", abort); child.unref(); resolve(); });
    if (signal?.aborted) abort();
  });
};
