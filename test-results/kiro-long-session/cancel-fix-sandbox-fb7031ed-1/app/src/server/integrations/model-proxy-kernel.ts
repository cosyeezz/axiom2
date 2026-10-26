import { MaintenanceError } from "../../shared/maintenance.js";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 线路内核的直接托管记录：只记 PID，不做进程树/命名空间监督。
 * 存活判断以 PID 为准；停止时先停记录的 PID，再按安装目录兜底清理同内核进程。 */
export type KernelRecord = { pid: number; kernel: string; executable: string; startedAt: string; profileId?: string };

export function kernelRecordPath(directory: string) {
  return join(directory, "kernel.json");
}

export function readKernelRecord(directory: string): KernelRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(kernelRecordPath(directory), "utf8"));
    if (!Number.isSafeInteger(value?.pid) || value.pid < 1 || typeof value.executable !== "string") return undefined;
    return { pid: value.pid, kernel: String(value.kernel ?? ""), executable: value.executable, startedAt: String(value.startedAt ?? ""),
      ...(typeof value.profileId === "string" ? { profileId: value.profileId } : {}) };
  } catch { return undefined; }
}

export function writeKernelRecord(directory: string, record: KernelRecord) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = kernelRecordPath(directory);
  writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* Windows 上无 POSIX 权限位。 */ }
}

export const pidAlive = (pid: number) => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
};

/** 启动内核：脱离宿主进程组，避免宿主退出时被一并带走，也便于整组清理。 */
export function spawnKernel(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(executable, args, { cwd, env, stdio: "ignore", detached: process.platform !== "win32", windowsHide: true });
  child.once("error", () => {});
  return child;
}

/** 结束一个 PID 及其子进程。Windows 用 taskkill /T，POSIX 先按进程组再按 PID。 */
export async function terminatePid(pid: number, graceMs = 3000) {
  if (!pidAlive(pid)) return true;
  const signal = (name: NodeJS.Signals | "tree") => {
    try {
      if (name === "tree" && process.platform === "win32") { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); return; }
      // 组信号失败（ESRCH）说明不存在该组，退回单 PID。
      if (process.platform !== "win32") { try { process.kill(-pid, name as NodeJS.Signals); return; } catch { /* fall through */ } }
      process.kill(pid, name as NodeJS.Signals);
    } catch { /* 已退出或无权；后续以存活检查为准。 */ }
  };
  signal("tree");
  if (await waitPidGone(pid, graceMs)) return true;
  signal("SIGKILL" as NodeJS.Signals);
  if (await waitPidGone(pid, 2000)) return true;
  throw new MaintenanceError("stop-unconfirmed", `代理内核进程 ${pid} 尚未退出，请核实后台进程后重试。`);
}

export async function waitPidGone(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return !pidAlive(pid);
}

/** 兜底清理：结束所有以该安装目录下可执行文件运行的进程。
 * 不依赖记录文件，因此也能清掉遗留的旧内核与失去记录的进程。 */
export function installedKernelPids(executable: string | readonly string[], requireScan = false): number[] {
  const targets = typeof executable === "string" ? [executable] : executable;
  if (!targets.length) return [];
  if (process.platform === "win32") {
    if (requireScan) throw new MaintenanceError("stop-unconfirmed", "当前平台无法核实全部代理内核进程，未删除程序文件。");
    return [];
  }
  let output: string;
  try {
    output = execFileSync("ps", ["-Ao", "pid=,command="], { encoding: "utf8", maxBuffer: 8 << 20, timeout: 2000 });
  } catch {
    if (requireScan) throw new MaintenanceError("stop-unconfirmed", "无法核实代理内核进程，未删除程序文件；请恢复进程查询后重试。");
    return [];
  }
  const found: number[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid === process.pid || !targets.some(target => match[2].includes(target))) continue;
    if (requireScan || /(^|\/)xray(\.exe)?\s+run(\s|$)/.test(match[2]) || /(^|\/)mihomo(\.exe)?(\s|$)/.test(match[2])) found.push(pid);
  }
  return found;
}

export async function terminateInstalledKernels(executable: string, except: readonly number[] = []) {
  for (const pid of installedKernelPids(executable)) {
    if (except.includes(pid)) continue;
    try { await terminatePid(pid); } catch { /* 由调用方汇总存活结果。 */ }
  }
}

export function clearKernelRecord(directory: string) {
  rmSync(kernelRecordPath(directory), { force: true });
}
