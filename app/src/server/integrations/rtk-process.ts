import { spawn } from "node:child_process";
import { join } from "node:path";
import { rtkDirectory } from "./rtk-config.js";

export type RtkRun = (file: string, args: string[], options: { root: string; input?: string; signal?: AbortSignal; timeout?: number; limit?: number }) => Promise<Buffer>;
export const runRtk: RtkRun = (file, args, options) => new Promise((resolve, reject) => {
  if (options.signal?.aborted) { reject(Error("RTK 操作已取消。")); return; }
  const directory = rtkDirectory(options.root);
  const child = spawn(file, args, { cwd: options.root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: {
    ...process.env, NO_COLOR: "1", RTK_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", RTK_RECALL: "0", RTK_TEE: "0",
    RTK_DB_PATH: join(directory, "upstream.db"), RTK_RECALL_DB: join(directory, "upstream-recall.db"),
  } });
  const chunks: Buffer[] = []; let bytes = 0, errors = 0, stopped = false;
  const stop = () => { stopped = true; child.kill("SIGKILL"); };
  const timer = setTimeout(stop, options.timeout ?? 2000);
  const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", stop); };
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();
  child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > (options.limit ?? 1024 * 1024)) stop(); else chunks.push(chunk); });
  child.stderr.on("data", (chunk: Buffer) => { errors += chunk.length; if (errors > 64 * 1024) stop(); });
  // Never expose upstream stderr (it can contain source text) to diagnostics or statistics.
  child.stdin.on("error", () => {});
  child.once("error", () => { cleanup(); reject(Error("RTK 程序无法启动，请检查安装。")); });
  child.once("close", code => { cleanup(); if (stopped || code !== 0) reject(Error("RTK 操作取消、超时、输出超限或执行失败。")); else resolve(Buffer.concat(chunks)); });
  child.stdin.end(options.input ?? "");
});
