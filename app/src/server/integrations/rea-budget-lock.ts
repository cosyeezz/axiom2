import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { lockResourcePaths } from "../resource-file-lock.js";

export type ReaProcessOwner = { pid?: number; close(): Promise<void> };
function live(pid: unknown, group = false) {
  if (!Number.isSafeInteger(pid) || (pid as number) < 1) return false;
  try { process.kill(group && process.platform !== "win32" ? -(pid as number) : pid as number, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
export async function reaProcessSettled(pid: number | undefined) {
  // A vanished Windows parent PID is not proof that taskkill reaped its tree.
  if (pid === undefined || process.platform === "win32") return false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!live(pid, true)) return true;
    await delay(100);
  }
  return !live(pid, true);
}
/** Cross-worker OS lock: never expires a live holder. A crashed worker's orphan
 * process group is NOT killed/replaced to make room for another analysis. */
export async function acquireReaBudget(root: string, owner: ReaProcessOwner, signal: AbortSignal) {
  const directory = join(root, "integrations", "rea", "budget");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "active.json");
  let release: (() => void) | undefined;
  while (!release) {
    signal.throwIfAborted();
    try { release = lockResourcePaths([path]); }
    catch (error) {
      if ((error as { code?: string }).code !== "RESOURCE_BUSY") throw error;
      await delay(100, undefined, { signal });
    }
  }
  try {
    signal.throwIfAborted();
    let prior: { worker?: number; server?: number } | undefined;
    try { prior = JSON.parse(readFileSync(path, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw Error("REA 资源归属记录不可读取；为避免重复分析，请检查资源目录。"); }
    if (prior !== undefined && (!prior || typeof prior !== "object" || !Number.isSafeInteger(prior.worker) || (prior.worker ?? 0) < 1))
      throw Error("REA 资源归属记录无效，未猜测原任务已经退出。");
    if (prior && (!Number.isSafeInteger(prior.server) || (prior.server ?? 0) < 1 || live(prior.worker) || live(prior.server, true)))
      throw Error("上次 REA 分析进程尚未确认退出，未重复启动。请关闭原会话或重启后台后检查残留进程。");
    writeFileSync(path, JSON.stringify({ worker: process.pid, server: owner.pid }), { mode: 0o600 });
    const unlock = release;
    release = undefined;
    return (settled = true) => { try { if (settled) rmSync(path, { force: true }); } finally { unlock(); } };
  } finally { release?.(); }
}
