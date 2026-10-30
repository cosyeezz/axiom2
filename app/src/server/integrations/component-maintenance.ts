import { lstatSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { maintenanceCancelled } from "../maintenance.js";
import { lockCommandAdmission } from "../command-admission.js";

/**
 * Integrated component standard (通用组件规范).
 *
 * Every integrated component (RTK, OpenCLI, REA and its engines, model-proxy
 * kernels, and any component added later) must implement its maintenance
 * buttons with these rules. The buttons are never disabled, rejected or left
 * waiting because of earlier state or validation:
 *
 * - Uninstall: the client asks for confirmation; the server then aborts the
 *   component's running operation, deletes its managed directories and clears
 *   its installation record. It never checks revisions, cleanup scopes,
 *   ownership journals, safe points or agents. A failed delete is retried once.
 * - Install: install the latest version directly (no prior "check" needed).
 *   On failure, force-clean the component and install once more.
 * - Update: same as install; downgrades are allowed. On failure, clean and
 *   install the new version once more.
 * - History: progress exists only while the operation runs. Interrupted or
 *   unconfirmed results are never persisted, shown after restart or used to
 *   block the next operation.
 * - Preemption: install/update/uninstall abort the running operation and wait
 *   up to 15s. Only an operation that ignores abort for that long still yields
 *   BUSY, because two writers on the same directories could corrupt files.
 * - Versions: install/update refetch the latest release each time; a cached
 *   check result is used only when the refetch fails.
 */

/**
 * Runs a forced removal while holding command admission so no tool process starts
 * mid-removal. Admission is retried briefly; if it stays busy the removal still runs.
 */
export async function withComponentAdmission<T>(root: string, work: () => T, wait = 3_000): Promise<T> {
  const end = Date.now() + wait;
  for (;;) {
    let release: (() => void) | undefined;
    try { release = lockCommandAdmission(root); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("工具正在启动或清理")) return work();
      if (Date.now() < end) { await new Promise(done => setTimeout(done, 100)); continue; }
      return work();
    }
    try { return work(); } finally { release(); }
  }
}

/** Waits for a running operation after aborting it, without blocking forever. */
export async function abortComponentOperation(controller: AbortController | undefined, pending: Promise<unknown> | undefined, timeout = 15_000) {
  controller?.abort();
  if (!pending) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([pending.catch(() => {}), new Promise<void>(done => { timer = setTimeout(done, timeout); timer.unref?.(); })]);
  clearTimeout(timer);
}

/** Deletes paths that must lie inside `container`; retries once per path. */
export function forceRemoveComponentPaths(container: string, paths: string[]) {
  const base = resolve(container), failed: string[] = [];
  for (const path of [...new Set(paths.map(item => resolve(item)))]) {
    const inside = relative(base, path);
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw Error(`拒绝删除组件目录之外的路径：${path}`);
    try { rmSync(path, { recursive: true, force: true }); }
    catch { try { rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { failed.push(path); } }
  }
  if (failed.length) throw Error(`部分文件未能删除，可再次点击卸载重试：${failed.join("、")}`);
}

/** Lists direct children of `directory` matching `pattern`; missing directory yields []. */
export function componentChildren(directory: string, pattern: RegExp) {
  try { if (!lstatSync(directory).isDirectory()) return []; } catch { return []; }
  return readdirSync(directory).filter(name => pattern.test(name)).map(name => join(directory, name));
}

/** Install with one fallback: on a non-cancelled failure, clean and retry once. */
export async function installWithFallback<T>(install: () => Promise<T>, clean: () => Promise<void> | void, signal?: AbortSignal, notify?: (message: string) => void): Promise<T> {
  try { return await install(); }
  catch (error) {
    if (maintenanceCancelled(error, signal) || signal?.aborted) throw error;
    notify?.("安装失败，正在清理旧文件后重新安装…");
    await clean();
    return install();
  }
}
