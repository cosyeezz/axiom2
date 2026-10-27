import { availableParallelism, freemem, totalmem } from "node:os";
import { statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import type { ReaAutoBudget } from "../../shared/rea.js";

const MiB = 1024 * 1024;
export const reaOperationMaximumMs = 600_000;
export const reaRequestTimeoutSeconds = 720;
export const reaTotalDeadlineMs = 25 * 60_000;
export type ReaHostResources = { totalMiB: number; availableMiB: number; cpus: number };
/** macOS Node reports only free pages, excluding reclaimable file-backed cache.
 * Do not count compressed/anonymous inactive pages as readily available memory. */
export function reaDarwinReclaimableBytes(snapshot: string) {
  const pageSize = Number(/page size of (\d+) bytes/.exec(snapshot)?.[1]);
  const filePages = Number(/^File-backed pages:\s+(\d+)\./m.exec(snapshot)?.[1]);
  const bytes = pageSize * filePages;
  return Number.isSafeInteger(pageSize) && pageSize >= 4096 && pageSize <= 65536 && Number.isSafeInteger(filePages) && filePages >= 0 && Number.isSafeInteger(bytes) ? bytes : 0;
}
export function reaHostResources(): ReaHostResources {
  const physical = totalmem(), constrained = process.constrainedMemory?.() || physical;
  const free = freemem();
  let available = Math.min(free, process.availableMemory?.() ?? free);
  if (process.platform === "darwin") {
    try {
      // Fixed OS utility, no shell, user input or environment override. Failure
      // falls back to conservative free pages; never guess anonymous reclaim.
      const snapshot = execFileSync("/usr/bin/vm_stat", [], { encoding: "utf8", timeout: 1000, maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "ignore"] });
      available = Math.min(physical, free + reaDarwinReclaimableBytes(snapshot));
    } catch { /* Conservative fallback if the OS snapshot is unavailable. */ }
  }
  return { totalMiB: Math.floor(Math.min(physical, constrained) / MiB), availableMiB: Math.floor(Math.min(constrained, available) / MiB), cpus: availableParallelism() };
}
/** Admission budgets, not an OS sandbox or a measurement of a target's required heap. */
export function reaAutoBudget(host = reaHostResources(), targetBytes = 0): ReaAutoBudget {
  const total = Number.isFinite(host.totalMiB) ? Math.max(0, host.totalMiB) : 0;
  const available = Number.isFinite(host.availableMiB) ? Math.max(0, host.availableMiB) : 0;
  const reserve = Math.max(512, Math.min(2048, Math.floor(total / 8)));
  const memoryMiB = Math.max(0, Math.floor(Math.min(8192, total / 2, available * 0.6, available - reserve)));
  const large = targetBytes >= 100 * MiB, medium = targetBytes >= 10 * MiB;
  const heapMaximumMiB = Math.max(0, Math.floor(memoryMiB * 0.7));
  return { mode: "auto", memoryMiB, heapMaximumMiB,
    heapMiB: Math.min(heapMaximumMiB, large ? 4096 : medium ? 2048 : 1024),
    cpus: Math.max(1, Math.min(4, Math.floor((Number.isFinite(host.cpus) ? host.cpus : 1) / 2))),
    operationTimeoutMs: large ? 600_000 : medium ? 480_000 : 300_000,
    operationMaximumMs: reaOperationMaximumMs, requestTimeoutSeconds: reaRequestTimeoutSeconds,
    concurrency: 1, retryLimit: 1, totalDeadlineMs: reaTotalDeadlineMs };
}
export function reaTargetBytes(input: Record<string, unknown>, cwd: string) {
  // Bounded metadata reads only: no recursive directory scan or archive extraction.
  for (const key of ["path", "binary_path", "artifact_path", "package_path"]) {
    const path = input[key];
    if (typeof path !== "string" || path.length > 4096) continue;
    try { const stat = statSync(isAbsolute(path) ? path : resolve(cwd, path)); if (stat.isFile()) return stat.size; } catch { /* REA owns target validation. */ }
  }
  return 0;
}
export function reaBudgetEnvironment(budget = reaAutoBudget()): Record<string, string> {
  // JVM flags cannot resize an already running JVM. New runtime only.
  if (budget.heapMaximumMiB < 128) throw Error("当前可用内存不足以安全启动 REA 运行环境；请等待其他任务完成后重新加载。");
  return { REA_JADX_HEAP_MIB: String(Math.min(4096, budget.heapMiB)), REA_JADX_ACTIVE_PROCESSOR_COUNT: String(budget.cpus) };
}
export const reaSettingCaps = (budget: ReaAutoBudget): Record<string, number> => ({
  "ghidra.startup_timeout_ms": budget.operationMaximumMs,
  "hopper.startup_timeout_ms": budget.operationMaximumMs,
  "ghidra.decompile_timeout_seconds": budget.operationMaximumMs / 1000,
  "jadx.operation_timeout_ms": budget.operationMaximumMs,
  "regex.matching_deadline_ms": 30_000,
  "regex.worker_heap_request_mib": Math.min(512, budget.heapMaximumMiB),
  "capture.decoder_old_generation_mib": Math.min(1024, budget.heapMaximumMiB),
  "javascript.analysis_timeout_ms": budget.operationMaximumMs,
  "javascript.max_heap_mb": budget.heapMaximumMiB,
  "wasm.command_timeout_ms": budget.operationMaximumMs,
});
export const reaSettingDefaults = (budget: ReaAutoBudget): Record<string, number> => ({
  "ghidra.startup_timeout_ms": Math.max(360_000, budget.operationTimeoutMs),
  "hopper.startup_timeout_ms": budget.operationTimeoutMs,
  "ghidra.decompile_timeout_seconds": Math.floor(budget.operationTimeoutMs / 1000),
  "jadx.operation_timeout_ms": budget.operationTimeoutMs,
  "regex.matching_deadline_ms": 5000,
  "regex.worker_heap_request_mib": Math.min(256, budget.heapMiB),
  "capture.decoder_old_generation_mib": Math.min(256, budget.heapMiB),
  "javascript.analysis_timeout_ms": budget.operationTimeoutMs,
  "javascript.max_heap_mb": budget.heapMiB,
  "wasm.command_timeout_ms": Math.min(120_000, budget.operationTimeoutMs),
});
