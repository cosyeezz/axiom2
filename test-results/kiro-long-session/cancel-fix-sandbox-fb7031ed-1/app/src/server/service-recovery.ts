import type { Agents } from "./agents.js";
import type { Tasks } from "./tasks.js";
import type { ServiceRecovery } from "./service-recovery-records.js";
import { AppError, type Scope } from "../shared/protocol.js";
import { errorMessage } from "./error-message.js";

export const serviceRecoveryDelayMs = 2000;
export const serviceRecoveryConcurrency = 3;

/** Startup-only, bounded recovery. Model errors still use Pi's native retry policy. */
export class ServiceRecoveryCoordinator {
  private timer?: NodeJS.Timeout;
  private closed = false;
  private launching = new Map<string, Promise<void>>();
  private admitted = new Map<string, string>();
  constructor(private readonly agents: Agents, private readonly tasks: Tasks) {}
  start() {
    this.timer = setTimeout(() => this.tick(), serviceRecoveryDelayMs);
    this.timer.unref?.();
  }
  private changed(scope: Scope) {
    this.agents.publish(`agent:${scope.workspaceId}:${scope.sessionId}`);
    this.agents.publish(`sessions:${scope.workspaceId}`);
  }
  private tick() {
    if (this.closed) return;
    const store = this.agents.store;
    for (const [id, runId] of this.admitted) {
      const run = store.db.prepare("SELECT status FROM runs WHERE id=?").get(runId);
      if (!run || !["starting", "running", "stopping"].includes(String(run.status))) this.admitted.delete(id);
    }
    for (const recovery of store.recoveries.pending()) {
      if (this.launching.has(recovery.sessionId)) continue;
      const owner = store.db.prepare(`SELECT s.workspaceId,s.deletedAt,w.archived,w.authorized FROM sessions s
        JOIN workspaces w ON w.id=s.workspaceId WHERE s.id=?`).get(recovery.sessionId);
      if (!owner || owner.deletedAt || owner.archived || !owner.authorized) {
        store.recoveries.block(recovery.sessionId, "会话已删除、工作空间已移除或文件授权不可用；未自动续跑。");
        continue;
      }
      const scope = { workspaceId: String(owner.workspaceId), sessionId: recovery.sessionId };
      const info = this.agents.info(scope);
      if ((info.run?.id ?? null) !== recovery.runId) { store.recoveries.remove(scope.sessionId); this.changed(scope); continue; }
      if (this.agents.active(scope) || info.task?.status === "queued") continue;
      const children = store.db.prepare(`SELECT r.state FROM service_recoveries r JOIN tasks t ON t.sessionId=r.sessionId
        WHERE t.parentSessionId=?`).all(scope.sessionId);
      if (children.some(row => row.state === "blocked")) {
        store.recoveries.block(scope.sessionId, "子任务自动恢复受阻；请检查子任务的恢复说明。"); this.changed(scope); continue;
      }
      if (children.length || info.activeTaskCount) continue;
      if (recovery.kind === "resume" && (!info.run || !["interrupted", "cancelled"].includes(info.run.status) ||
          info.run.status === "cancelled" && info.run.reasonCode !== "SHUTDOWN_STOPPED")) {
        store.recoveries.remove(scope.sessionId); this.changed(scope); continue;
      }
      if (!info.task && this.launching.size + this.admitted.size >= serviceRecoveryConcurrency) continue;
      const job = this.recover(scope, recovery).finally(() => this.launching.delete(scope.sessionId));
      this.launching.set(scope.sessionId, job);
    }
    this.timer = setTimeout(() => this.tick(), 1000);
    this.timer.unref?.();
  }
  private async recover(scope: Scope, recovery: ServiceRecovery) {
    try {
      if (this.agents.info(scope).task || recovery.kind === "notify") {
        const runId = await this.tasks.recover(scope, recovery);
        if (runId) this.admitted.set(scope.sessionId, runId);
      } else {
        const receipt = await this.tasks.command({ requestId: `service-recovery-${recovery.runId}`, op: "agent.resume", ...scope,
          params: { expectedRunId: recovery.runId } }, recovery) as { runId: string };
        if (receipt?.runId) this.admitted.set(scope.sessionId, receipt.runId);
      }
      this.changed(scope);
    } catch (error) {
      // A new durable run owns any dispatched operation, including uncertain sends.
      // Never retry a failed model run by reissuing its host command.
      const current = this.agents.store.recoveries.get(scope.sessionId);
      if (!this.closed && current?.runId === recovery.runId && current.kind === recovery.kind && current.createdAt === recovery.createdAt) {
        this.agents.store.recoveries.block(scope.sessionId, errorMessage(error, "自动恢复未启动；请检查配置后手动重试。"));
        this.changed(scope);
      }
    }
  }
  pause() {
    this.closed = true;
    clearTimeout(this.timer);
  }
  async close() {
    this.pause();
    await Promise.allSettled(this.launching.values());
  }
}

export function assertServiceRecovery(agents: Agents, recovery: ServiceRecovery) {
  const current = agents.store.recoveries.get(recovery.sessionId);
  if (!current || current.state !== "pending" || current.runId !== recovery.runId || current.kind !== recovery.kind)
    throw new AppError("RECOVERY_CANCELLED", "自动恢复已取消或执行已变化。");
}
