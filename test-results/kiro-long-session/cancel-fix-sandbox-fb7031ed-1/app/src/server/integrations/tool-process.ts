import { supervisorEnvironment } from "./component-environment.js";
import { withCommandAdmission } from "../command-admission.js";
import { currentMaintenance } from "../maintenance.js";
import { MaintenanceError } from "../../shared/maintenance.js";
import { createWindowsCommandLease, windowsCommandLeaseLive } from "../pi-package-windows.js";
import { monotonicMilliseconds } from "../owned-process-linux.js";
import { forkMaintenanceProcess, maintenanceProcessSupported, maintenanceProcessSupportError, type MaintenanceProcess } from "../maintenance-process.js";
import type { ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readdirSync, readlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createProcessOwner, processOwnerIsLive, recoverProcessOwner, type CommandLeaseIdentity } from "../process-owner-record.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolProcessReply, ToolProcessRequest } from "./tool-process-worker.js";

export type ToolRunOptions = { root: string; cwd?: string; input?: string; signal?: AbortSignal; timeout?: number; limit?: number; errorLimit?: number; env?: NodeJS.ProcessEnv; output?: "structured" | "tail"; errorOutput?: "structured" | "tail"; admissionCheck?: () => void; beforeStart?: (owner: string) => void; onStopped?: (proof: "not-started" | "tree-cleaned") => void };
export type ToolRun = (file: string, args: string[], options: ToolRunOptions) => Promise<{ code: number; stdout: Buffer; stderr: Buffer; stdoutTruncated?: boolean; stderrTruncated?: boolean }>;
function commandLease(root: string, ownerPath: string): { id?: CommandLeaseIdentity; close(): void } {
  // PID owners use a revocable in-host registry, not Linux /proc descriptors.
  if (process.platform === "darwin") return { close() {} };
  const windows = createWindowsCommandLease(ownerPath);
  if (windows) return windows;
  // The descriptor keeps this never-reused inode alive after unlink. Closing it
  // revokes admission even if the host remains alive after an uncertain stop.
  const path = join(root, `.axiom-command-${randomUUID()}.live`);
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  let closed = false;
  try {
    unlinkSync(path);
    const secret = randomBytes(32); writeFileSync(fd, secret);
    const identity = fstatSync(fd, { bigint: true });
    const id = { fd, path: readlinkSync(`/proc/self/fd/${fd}`), dev: String(identity.dev), ino: String(identity.ino), digest: createHash("sha256").update(secret).digest("hex") };
    return { id, close() { if (!closed) { closed = true; closeSync(fd); } } };
  } catch (error) { closeSync(fd); throw error; }
}
export const toolProcessSupported = maintenanceProcessSupported;
export const toolProcessSupportError = maintenanceProcessSupportError;
/** 代理线路不依赖托管进程监督：内核由后台直接启动并记录 PID。 */
export const proxyLaunchSupported = () => ["win32", "linux", "darwin"].includes(process.platform);
const activeOwners = new Set<string>();
export function assertToolProcessesStopped(root: string) {
  let names: string[];
  try { names = readdirSync(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (names.some(name => /^\.axiom-command-[a-f0-9-]+\.json$/.test(name) && !recoverProcessOwner(join(root, name)))) throw new MaintenanceError("stop-unconfirmed", "程序退出尚未确认，未修改或删除程序文件；请核实后台进程后重试。");
}
export const runTool: ToolRun = (file, args, options) => new Promise((resolve, reject) => {
  const execution = currentMaintenance();
  const signal = options.signal && execution ? AbortSignal.any([options.signal, execution.signal]) : options.signal ?? execution?.signal;
  if (signal?.aborted) { options.onStopped?.("not-started"); reject(signal.reason); return; }
  if (!toolProcessSupported()) { options.onStopped?.("not-started"); reject(new MaintenanceError("operation", toolProcessSupportError)); return; }
  const started = Date.now();
  const remaining = () => execution?.remainingBudget() ?? { remainingMs: (options.timeout ?? 2000) - (Date.now() - started), code: "total-timeout" as const };
  const deadline = () => monotonicMilliseconds() + remaining().remainingMs;
  const timeoutError = () => new MaintenanceError(remaining().code, "程序执行因取消、超时或连接中断而停止，请核实当前状态。");
  // A previous host may have died before confirming its command tree stopped.
  for (const name of readdirSync(options.root)) {
    if (/^\.axiom-command-[a-f0-9-]+\.json$/.test(name) && !activeOwners.has(join(options.root, name)) && !processOwnerIsLive(join(options.root, name), windowsCommandLeaseLive) && !recoverProcessOwner(join(options.root, name))) {
      reject(new MaintenanceError("stop-unconfirmed", "此目录有程序退出未确认的记录，请核实后台进程后重试。")); return;
    }
  }
  const owner = join(options.root, `.axiom-command-${randomUUID()}.json`);
  let lease: ReturnType<typeof commandLease>, journal: ReturnType<typeof createProcessOwner>;
  try {
    ({ lease, journal } = withCommandAdmission(options.root, () => {
      signal?.throwIfAborted();
      // Revalidate the selected executable/configuration under the same gate used
      // by removal, before publishing the owner that protects the command tree.
      options.admissionCheck?.();
      const lease = commandLease(options.root, owner);
      try { return { lease, journal: createProcessOwner(owner, lease.id) }; }
      catch (error) { lease.close(); throw error; }
    }));
  } catch (error) { options.onStopped?.("not-started"); reject(error); return; }
  activeOwners.add(owner);
  const source = import.meta.url.endsWith(".ts");
  let child: ChildProcess, owned: MaintenanceProcess;
  try {
    options.beforeStart?.(owner);
    const entry = fileURLToPath(new URL(`./tool-process-worker.${source ? "ts" : "js"}`, import.meta.url));
    const forkOptions = { cwd: options.cwd ?? options.root, env: supervisorEnvironment(), execArgv: source ? ["--import", import.meta.resolve("tsx")] : [], serialization: "advanced" as const };
    owned = forkMaintenanceProcess(entry, forkOptions, deadline(), timeoutError, identity => journal.arm(identity));
    child = owned.child;
  } catch (error) {
    activeOwners.delete(owner);
    try { options.onStopped?.("not-started"); journal.confirmed(); }
    finally { lease.close(); }
    reject(error); return;
  }
  const chunks: Buffer[] = []; let stderr = Buffer.alloc(0), bytes = 0, errorBytes = 0, stdoutTruncated = false, failure: unknown, commandSent = false, admissionLost = false;
  let result: ToolProcessReply | undefined, deliveryFailure: Error | undefined, stopping: Promise<void> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => stopping ??= owned.close();
  const uncertain = () => new MaintenanceError("stop-unconfirmed", "程序退出未能确认，文件已保留；请核实后台进程后重试。");
  const stop = (reason?: unknown) => {
    failure ??= reason;
    void cleanup().catch(() => {});
    stopTimer ??= setTimeout(() => { admissionLost = true; journal.revoke(); lease.close(); clearInterval(timer); activeOwners.delete(owner); reject(uncertain()); }, 7000);
  };
  const abort = () => stop(signal?.reason ?? new MaintenanceError("cancelled", "操作已取消。"));
  const deliveryFailed = () => {
    // IPC can close because the native deadline killed a worker still starting.
    // Defer this generic transport error until cleanup supplies its real cause.
    deliveryFailure ??= Error("程序无法启动，请检查安装。");
    stop();
  };
  const timer = setInterval(() => {
    owned.setDeadline(deadline());
    if (remaining().remainingMs <= 0) stop(timeoutError());
  }, 100);
  signal?.addEventListener("abort", abort, { once: true });
  child.on("message", (message: ToolProcessReply) => {
    if (message.type === "stdout") {
      bytes += message.data.length;
      if (options.output === "tail") {
        const limit = options.limit ?? 64 * 1024;
        chunks.push(message.data);
        while (bytes > limit && chunks.length) {
          stdoutTruncated = true;
          const first = chunks[0], excess = bytes - limit;
          if (first.length <= excess) { chunks.shift(); bytes -= first.length; }
          else { chunks[0] = first.subarray(excess); bytes = limit; }
        }
      } else if (bytes > (options.limit ?? 1024 * 1024)) stop(new MaintenanceError("output-limit", "程序返回的结构化内容超限，已停止读取。"));
      else chunks.push(message.data);
    } else if (message.type === "stderr") {
      errorBytes += message.data.length;
      if (options.errorOutput === "structured" && errorBytes > (options.errorLimit ?? 64 * 1024)) stop(new MaintenanceError("output-limit", "程序返回的结构化错误输出超限，已停止读取。"));
      else stderr = Buffer.concat([stderr, message.data]).subarray(-(options.errorLimit ?? 64 * 1024));
    } else { result = message; stop(); }
  });
  child.once("error", deliveryFailed);
  child.once("close", async () => {
    clearInterval(timer); signal?.removeEventListener("abort", abort);
    try {
      await cleanup();
      const nativeFailure = owned.failure();
      if (nativeFailure instanceof MaintenanceError && nativeFailure.code === "stop-unconfirmed") throw nativeFailure;
      failure ??= nativeFailure ?? deliveryFailure;
      if (!admissionLost) {
        options.onStopped?.(commandSent ? "tree-cleaned" : "not-started");
        journal.confirmed();
      }
      if (failure || signal?.aborted) reject(failure ?? signal?.reason);
      else if (result?.type !== "exit") reject(Error("程序执行失败，请检查输入和安装状态。"));
      else resolve({ code: result.code ?? -1, stdout: Buffer.concat(chunks), stderr, ...(stdoutTruncated ? { stdoutTruncated: true } : {}), ...(errorBytes > (options.errorLimit ?? 64 * 1024) ? { stderrTruncated: true } : {}) });
    } catch { reject(uncertain()); }
    finally { journal.revoke(); lease.close(); activeOwners.delete(owner); clearTimeout(stopTimer); }
  });
  void owned.ready.then(() => {
    if (stopping) return;
    if (signal?.aborted) { abort(); return; }
    const request: ToolProcessRequest = { file, args, cwd: options.cwd ?? options.root, input: options.input ?? "", env: options.env ?? process.env };
    commandSent = true;
    child.send(request, error => { if (error) deliveryFailed(); });
  }, error => stop(error));
});
