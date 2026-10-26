import { setTimeout as delay } from "node:timers/promises";
import { currentMaintenance } from "./maintenance.js";
import { AppError } from "../shared/protocol.js";
import { MaintenanceError } from "../shared/maintenance.js";

/** Reserve application admission first, drain already-admitted work (including
 * delegates), then take the physical worker barrier. Never pause the scheduler
 * while waiting for its queued tasks to finish. */
export class IntegrationMaintenanceQueue {
  private entries = new Set<AbortController>();
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  get pending() { return this.entries.size > 0; }
  constructor(private blockers: () => string[], private exclusive: <T>(work: () => T, signal: AbortSignal) => Promise<T>) {}
  run = <T>(work: () => T): Promise<T> => {
    if (this.closed) return Promise.reject(new AppError("SHUTTING_DOWN", "服务正在退出，未接受组件维护。"));
    const controller = new AbortController(), execution = currentMaintenance();
    const signal = execution ? AbortSignal.any([execution.signal, controller.signal]) : controller.signal;
    this.entries.add(controller);
    execution?.phase("queued", "已预约组件维护，等待先前任务到达安全点…");
    if (execution) { execution.task.capabilities.cancel = true; execution.update(true); }
    const previous = this.tail;
    const result = (async () => {
      // Aborting a queued reservation need not wait for the reservation ahead.
      await Promise.race([previous.catch(() => {}), new Promise<never>((_, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        void previous.finally(() => signal.removeEventListener("abort", abort)).catch(() => {});
        if (signal.aborted) abort();
      })]);
      while (true) {
        signal.throwIfAborted();
        const blockers = this.blockers();
        if (blockers.length) {
          execution?.phase("queued", `等待安全点：${blockers.join("、")}；可取消等待。`);
          await delay(100, undefined, { signal }); continue;
        }
        try {
          return await this.exclusive(() => {
            signal.throwIfAborted();
            // Recheck after retiring cached workers, still inside the barrier.
            if (this.blockers().length) throw new AppError("MAINTENANCE_BUSY", "安全点已变化，继续等待。");
            if (execution) { execution.task.capabilities.cancel = false; execution.phase("checking", "已到达安全点，正在重新核实配置与清理范围…"); }
            return work();
          }, signal);
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== "MAINTENANCE_BUSY") throw error;
          execution?.phase("queued", "等待安全点：正在执行的 Agent 或缓存工作进程；可取消等待。");
          await delay(100, undefined, { signal });
        }
      }
    })().catch(error => { throw signal.aborted ? signal.reason : error; }).finally(() => { this.entries.delete(controller); });
    // Keep FIFO even when an intermediate queued caller cancels early.
    this.tail = Promise.allSettled([previous, result]);
    return result;
  };
  close() {
    this.closed = true;
    for (const controller of this.entries) controller.abort(new MaintenanceError("cancelled", "服务正在退出，已取消尚未提交的组件维护。"));
  }
}
