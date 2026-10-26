import { fork, type ForkOptions } from "node:child_process";
import { MaintenanceError } from "../shared/maintenance.js";
import { forkLinuxOwned } from "./owned-process-linux.js";
import { ownWindowsPackageTree } from "./pi-package-windows.js";
import { forkPidProcess } from "./maintenance-process-pid.js";
import type { ProcessOwnerIdentity } from "./process-owner-record.js";
import { isAbsolute, relative, resolve } from "node:path";

export const maintenanceProcessSupported = (platform: string = process.platform) => ["win32", "linux", "darwin"].includes(platform);
export const maintenanceProcessSupportError = "当前后台平台暂不支持维护进程执行；支持 macOS、Windows 和 Linux。";
type Options = Pick<ForkOptions, "cwd" | "env" | "execArgv" | "serialization">;

/** Common lifecycle for maintenance workers: register ownership before business
 * IPC, inspect failure/deadline, and close the owned tree even after worker exit.
 * Windows/Linux retain their native backends; macOS uses PID/group ownership. */
function forkBackend(entry: string, options: Options, deadline: number, timeoutError: () => MaintenanceError, save: (identity: ProcessOwnerIdentity) => void) {
  if (!maintenanceProcessSupported()) throw new MaintenanceError("operation", maintenanceProcessSupportError);
  if (process.platform === "linux") return forkLinuxOwned(entry, options, deadline, timeoutError, save);
  if (process.platform === "darwin") return forkPidProcess(entry, options, save);
  const child = fork(entry, [], { ...options, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  let job: ReturnType<typeof ownWindowsPackageTree>, failure: Error | undefined, stopping: Promise<void> | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => {
      try {
        job = ownWindowsPackageTree(child.pid!);
        if (!job) throw new MaintenanceError("operation", "无法创建维护进程组，尚未执行命令。");
        save({ platform: "win32", workerPid: child.pid! }); resolve();
      } catch (error) { failure = error as Error; reject(error); }
    });
  });
  void ready.catch(() => {});
  return { child, ready, failure: () => failure, setDeadline(_value: number) {},
    close() {
      return stopping ??= (async () => {
        try { await ready; } catch { /* No business IPC was sent. */ }
        if (job) await job.close();
        else if (child.pid) child.kill();
      })();
    },
  };
}
type Backend = ReturnType<typeof forkBackend>;
const active = new Set<{ scope: string; process: Backend }>();
const inScope = (scope: string, root?: string) => {
  if (!root) return true;
  const path = relative(resolve(root), scope);
  return path === "" || path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(path);
};
export function forkMaintenanceProcess(entry: string, options: Options, deadline: number, timeoutError: () => MaintenanceError, save: (identity: ProcessOwnerIdentity) => void, scope = String(options.cwd ?? process.cwd())) {
  const backend = forkBackend(entry, options, deadline, timeoutError, save);
  const record = { scope: resolve(scope), process: backend };
  const handle = { ...backend, async close() { await backend.close(); active.delete(record); } };
  record.process = handle; active.add(record);
  return handle;
}
/** Shutdown fallback; services first cancel their jobs and await parent commits. */
export async function stopMaintenanceProcesses(root?: string) {
  const results = await Promise.allSettled([...active].filter(item => inScope(item.scope, root)).map(item => item.process.close()));
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}
export function maintenanceProcessPids(root?: string) {
  return [...active].filter(item => inScope(item.scope, root)).flatMap(item => item.process.child.pid ? [item.process.child.pid] : []);
}
export type MaintenanceProcess = ReturnType<typeof forkMaintenanceProcess>;
