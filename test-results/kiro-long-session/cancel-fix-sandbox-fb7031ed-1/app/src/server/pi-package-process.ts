import { commitPiPackage, finishPiPackageRemoval, lockPiPackage, piPackagePlan } from "./pi-package-storage.js";
import { createProcessOwner, type ProcessOwner } from "./process-owner-record.js";
import { forkMaintenanceProcess, maintenanceProcessSupported, maintenanceProcessSupportError, type MaintenanceProcess } from "./maintenance-process.js";
import { monotonicMilliseconds } from "./owned-process-linux.js";
import { currentMaintenance } from "./maintenance.js";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MaintenanceError } from "../shared/maintenance.js";
import { AppError } from "../shared/protocol.js";
import type { PiPackageReply, PiPackageRequest, PiPackageResult } from "./pi-package-protocol.js";

export async function runPiPackage(request: PiPackageRequest, signal: AbortSignal): Promise<PiPackageResult> {
  signal.throwIfAborted();
  const operation = await lockPiPackage(request);
  let journal: ProcessOwner | undefined;
  const ownership = { confirmed: true };
  try {
    journal = createProcessOwner(operation.ownerPath);
    return await executePiPackage(request, signal, journal, ownership);
  }
  catch (error) {
    if (error instanceof MaintenanceError && error.code === "stop-unconfirmed") {
      try { operation.unconfirmed(); }
      catch { throw new MaintenanceError("stop-unconfirmed", "安装进程退出未确认，且阻止再次操作的记录未能保存。请停止后台并核实进程与目录。"); }
    }
    throw error;
  } finally {
    // Keep the durable host gate through parent settings commit and removal
    // finalization, including local-only operations and a stale SDK lock.
    try { if (ownership.confirmed) journal?.confirmed(); }
    finally { operation.release(); }
  }
}

async function executePiPackage(request: PiPackageRequest, signal: AbortSignal, journal: ProcessOwner, ownership: { confirmed: boolean }): Promise<PiPackageResult> {
  signal.throwIfAborted();
  const plan = piPackagePlan(request), source = import.meta.url.endsWith(".ts");
  if (request.action === "remove" && plan.parsed.type === "local") {
    await commitPiPackage(request, plan.initialIdentity, signal);
    finishPiPackageRemoval(request); return {};
  }
  if (!maintenanceProcessSupported()) throw new MaintenanceError("operation", maintenanceProcessSupportError);
  const execution = currentMaintenance(), started = Date.now();
  const remaining = () => execution?.remainingBudget() ?? { remainingMs: 1200000 - (Date.now() - started), code: "total-timeout" as const };
  const deadline = () => monotonicMilliseconds() + remaining().remainingMs;
  const timeoutError = () => new MaintenanceError(remaining().code, "资源包操作已达到执行期限。");
  const entry = new URL(`./pi-package-worker.${source ? "ts" : "js"}`, import.meta.url);
  let withdrawn = false;
  const uncertain = () => request.action === "remove" ? withdrawn ? "卸载进程退出未能确认；包声明已移除，待清理记录和文件已保留，请核实后台进程后重试。" : "卸载进程退出未能确认，请核实后台进程；未开始清理程序文件。" : "安装进程退出未能确认，配置未提交；请核实后台进程后重试。";
  const result = await new Promise<PiPackageResult>((resolve, reject) => {
    const options = { cwd: request.cwd, env: { ...process.env, npm_config_fetch_timeout: "86400000", npm_config_fetch_retries: "2" },
      execArgv: source ? ["--import", import.meta.resolve("tsx")] : [] };
    let owned: MaintenanceProcess, child: ReturnType<typeof fork>;
    ownership.confirmed = false;
    try {
      owned = forkMaintenanceProcess(fileURLToPath(entry), options, deadline(), timeoutError, identity => journal.arm(identity));
      child = owned.child;
    } catch (error) { ownership.confirmed = true; reject(error); return; }
    let reply: PiPackageReply | undefined, spawnError: Error | undefined;
    let preparation: Promise<void> = Promise.resolve();
    let stopping: Promise<void> | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let admissionLost = false;
    const cleanup = () => stopping ??= owned.close();
    const abort = () => {
      void cleanup().catch(() => {});
      stopTimer ??= setTimeout(() => { admissionLost = true; journal.revoke(); reject(new MaintenanceError("stop-unconfirmed", uncertain())); }, 7000);
    };
    const budgetTimer = setInterval(() => {
      owned.setDeadline(deadline());
      if (remaining().remainingMs <= 0) { spawnError ??= timeoutError(); abort(); }
    }, 100);
    signal.addEventListener("abort", abort, { once: true });
    child.on("message", message => { reply = message as PiPackageReply; });
    child.once("error", error => { spawnError = error; abort(); });
    child.once("close", async code => {
      clearInterval(budgetTimer);
      signal.removeEventListener("abort", abort);
      try {
        await preparation;
        await cleanup();
        const failure = owned.failure();
        if (admissionLost || failure instanceof MaintenanceError && failure.code === "stop-unconfirmed") throw new MaintenanceError("stop-unconfirmed", uncertain());
        spawnError ??= failure;
        if (spawnError instanceof MaintenanceError && spawnError.code === "stop-unconfirmed") throw spawnError;
        ownership.confirmed = true;
        if (signal.aborted) reject(signal.reason);
        else if (spawnError instanceof MaintenanceError) reject(spawnError);
        else if (spawnError || code !== 0 || !reply?.ok) reject(new AppError("RESOURCE_PACKAGE_FAILED", "资源包操作未完成，请检查来源、网络和文件权限后刷新核实；已发生的修改不会自动回滚。"));
        else resolve(reply.result);
      } catch { reject(new MaintenanceError("stop-unconfirmed", uncertain())); }
      finally { clearTimeout(stopTimer); }
    });
    preparation = owned.ready.then(async () => {
      if (stopping) throw spawnError ?? new MaintenanceError("cancelled", "启动许可已撤销。");
      signal.throwIfAborted();
      if (request.action === "remove") { await commitPiPackage(request, plan.initialIdentity, signal); withdrawn = true; }
      signal.throwIfAborted();
      if (stopping) throw spawnError ?? new MaintenanceError("cancelled", "启动许可已撤销。");
      child.send(request, error => { if (error) { spawnError = error; abort(); } });
    }).catch(error => { spawnError = error; abort(); });
  });
  if (request.action === "install") await commitPiPackage(request, plan.initialIdentity, signal);
  else finishPiPackageRemoval(request);
  return result;
}
