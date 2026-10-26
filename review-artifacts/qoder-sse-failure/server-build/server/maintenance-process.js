import { fork } from "node:child_process";
import { MaintenanceError } from "../shared/maintenance.js";
import { forkLinuxOwned } from "./owned-process-linux.js";
import { ownWindowsPackageTree } from "./pi-package-windows.js";
import { forkPidProcess } from "./maintenance-process-pid.js";
import { isAbsolute, relative, resolve } from "node:path";
export const maintenanceProcessSupported = (platform = process.platform) => ["win32", "linux", "darwin"].includes(platform);
export const maintenanceProcessSupportError = "当前后台平台暂不支持维护进程执行；支持 macOS、Windows 和 Linux。";
/** Common lifecycle for maintenance workers: register ownership before business
 * IPC, inspect failure/deadline, and close the owned tree even after worker exit.
 * Windows/Linux retain their native backends; macOS uses PID/group ownership. */
function forkBackend(entry, options, deadline, timeoutError, save) {
    if (!maintenanceProcessSupported())
        throw new MaintenanceError("operation", maintenanceProcessSupportError);
    if (process.platform === "linux")
        return forkLinuxOwned(entry, options, deadline, timeoutError, save);
    if (process.platform === "darwin")
        return forkPidProcess(entry, options, save);
    const child = fork(entry, [], { ...options, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    let job, failure, stopping;
    const ready = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", () => {
            try {
                job = ownWindowsPackageTree(child.pid);
                if (!job)
                    throw new MaintenanceError("operation", "无法创建维护进程组，尚未执行命令。");
                save({ platform: "win32", workerPid: child.pid });
                resolve();
            }
            catch (error) {
                failure = error;
                reject(error);
            }
        });
    });
    void ready.catch(() => { });
    return { child, ready, failure: () => failure, setDeadline(_value) { },
        close() {
            return stopping ??= (async () => {
                try {
                    await ready;
                }
                catch { /* No business IPC was sent. */ }
                if (job)
                    await job.close();
                else if (child.pid)
                    child.kill();
            })();
        }, };
}
const active = new Set();
const inScope = (scope, root) => {
    if (!root)
        return true;
    const path = relative(resolve(root), scope);
    return path === "" || path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(path);
};
export function forkMaintenanceProcess(entry, options, deadline, timeoutError, save, scope = String(options.cwd ?? process.cwd())) {
    const backend = forkBackend(entry, options, deadline, timeoutError, save);
    const record = { scope: resolve(scope), process: backend };
    const handle = { ...backend, async close() { await backend.close(); active.delete(record); } };
    record.process = handle;
    active.add(record);
    return handle;
}
/** Shutdown fallback; services first cancel their jobs and await parent commits. */
export async function stopMaintenanceProcesses(root) {
    const results = await Promise.allSettled([...active].filter(item => inScope(item.scope, root)).map(item => item.process.close()));
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected")
        throw failed.reason;
}
export function maintenanceProcessPids(root) {
    return [...active].filter(item => inScope(item.scope, root)).flatMap(item => item.process.child.pid ? [item.process.child.pid] : []);
}
//# sourceMappingURL=maintenance-process.js.map