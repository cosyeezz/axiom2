import { randomUUID } from "node:crypto";
import type { Agents } from "./agents.js";
import type { Tasks } from "./tasks.js";
import type { ServiceRecovery } from "./service-recovery-records.js";
import { AppError, type Scope } from "../shared/protocol.js";
import { errorMessage } from "./error-message.js";

export const serviceRecoveryDelayMs = 3000;

/** One reconnect at a time, children before parents; model execution is not a queue slot. */
export class ServiceRecoveryCoordinator {
  private timer?: NodeJS.Timeout;
  private closed = false;
  private launching?: Promise<void>;
  private attempted = new Set<string>();
  constructor(private readonly agents: Agents, private readonly tasks: Tasks) {}
  start() {
    if (this.closed || this.timer || this.launching) return;
    // Revisit old preflight failures under the current configuration after an upgrade/restart.
    this.agents.store.db.prepare("UPDATE service_recoveries SET state='pending' WHERE state='blocked'").run();
    this.schedule(0);
  }
  private schedule(delay: number) {
    if (this.closed) return;
    this.timer = setTimeout(() => this.tick(), delay);
    this.timer.unref?.();
  }
  private changed(scope: Scope) {
    this.agents.publish(`agent:${scope.workspaceId}:${scope.sessionId}`);
    this.agents.publish(`sessions:${scope.workspaceId}`);
  }
  private tick() {
    if (this.closed || this.launching) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.launching = this.next().catch(error => {
      // A read/publish error must not silently stop the entire recovery queue.
      console.warn("Service recovery will retry:", errorMessage(error, "恢复状态读取失败"));
    }).finally(() => {
      this.launching = undefined;
      this.schedule(serviceRecoveryDelayMs);
    });
  }
  private async next() {
    const store = this.agents.store;
    // Refresh child-first order every tick, including interruptions arriving mid-pass.
    // A failed preflight still gives every other pending intention a turn before retrying.
    const pending = store.recoveries.pending().map(recovery => ({ recovery,
      identity: JSON.stringify([recovery.sessionId, recovery.runId, recovery.kind, recovery.createdAt, recovery.payload]),
    }));
    const identities = new Set(pending.map(item => item.identity));
    for (const identity of this.attempted) if (!identities.has(identity)) this.attempted.delete(identity);
    if (pending.every(item => this.attempted.has(item.identity))) this.attempted.clear();
    for (const { recovery, identity } of pending) {
      if (this.closed) return;
      if (this.attempted.has(identity)) continue;
      this.attempted.add(identity);
      const current = store.recoveries.get(recovery.sessionId);
      if (!current || current.state !== "pending" || current.runId !== recovery.runId ||
          current.kind !== recovery.kind || current.createdAt !== recovery.createdAt || current.payload !== recovery.payload) continue;
      const owner = store.db.prepare(`SELECT s.workspaceId,s.deletedAt,w.archived,w.authorized FROM sessions s
        JOIN workspaces w ON w.id=s.workspaceId WHERE s.id=?`).get(recovery.sessionId);
      if (!owner || owner.deletedAt || owner.archived || !owner.authorized) {
        store.recoveries.block(recovery.sessionId, "会话已删除、工作空间已移除或文件授权不可用；未自动续跑。");
        continue;
      }
      const scope = { workspaceId: String(owner.workspaceId), sessionId: recovery.sessionId };
      const info = this.agents.info(scope);
      if ((info.run?.id ?? null) !== recovery.runId) { store.recoveries.remove(scope.sessionId, recovery); this.changed(scope); continue; }
      if (this.agents.active(scope)) continue;
      if (recovery.kind === "resume" && (!info.run || !["interrupted", "cancelled"].includes(info.run.status) ||
          info.run.status === "cancelled" && info.run.reasonCode !== "SHUTDOWN_STOPPED")) {
        store.recoveries.remove(scope.sessionId, recovery); this.changed(scope); continue;
      }
      await this.recover(scope, recovery);
      return;
    }
  }
  private async recover(scope: Scope, recovery: ServiceRecovery) {
    try {
      if (this.agents.info(scope).task || recovery.kind === "notify") {
        await this.tasks.recover(scope, recovery);
      } else {
        await this.tasks.command({ requestId: `service-recovery-${recovery.runId}-${randomUUID()}`, op: "agent.resume", ...scope,
          params: { expectedRunId: recovery.runId } }, recovery);
      }
      this.changed(scope);
    } catch (error) {
      // Once a durable run owns the operation, only Pi retries model errors. Never resend its command.
      if (!this.closed) {
        this.agents.store.recoveries.retry(recovery, errorMessage(error, "自动恢复尚未启动；将继续重试。"));
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
    await this.launching;
  }
}

export function assertServiceRecovery(agents: Agents, recovery: ServiceRecovery) {
  const current = agents.store.recoveries.get(recovery.sessionId);
  if (!current || current.state !== "pending" || current.runId !== recovery.runId || current.kind !== recovery.kind ||
      current.createdAt !== recovery.createdAt || current.payload !== recovery.payload)
    throw new AppError("RECOVERY_CANCELLED", "自动恢复已取消或执行已变化。");
}
