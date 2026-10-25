import { latencyFor } from "../latency.js";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { ExecutionPool, type ExecutionLease } from "../execution-pool.js";
import { fileRevision } from "../execution-profile.js";
import { sameLease, ExecutionPermitDeniedError } from "../execution-protocol.js";
import { AppError, type Scope, type Draft } from "../../shared/protocol.js";
import { agentScope, threadScope, type Run } from "../../shared/agent.js";
import type { Store } from "../storage.js";
import type { StopSource } from "../../shared/tasks.js";
import type { WorkerInput } from "../agent-worker.js";
import { AgentViews } from "./views.js";
import { errorMessage } from "../error-message.js";
type Live = {
  scope: Scope;
  task: boolean;
  automatic?: boolean;
  run: Run;
  lease: ExecutionLease;
  child: ChildProcess;
  bornAt?: number;
  exit: Promise<void>;
  finish?: { status: Run["status"]; error?: string; reasonCode?: string };
  storageFailed?: boolean;
  terminating?: boolean;
  validatingIdle?: boolean;
  closed?: boolean;
  receive?: (event: any) => void;
  timer?: NodeJS.Timeout;
  inputs: Map<string, { draft: Draft; mode: "steer" | "followUp"; pending: boolean; failed?: boolean }>;
  recalls: Map<string, { resolve: (ids: string[]) => void; reject: (error: Error) => void }>;
  accepting: Map<string, { resolve: () => void; reject: (error: Error) => void }>;
};


export class AgentRuns {
  constructor(
    readonly store: Store,
    readonly views: AgentViews,
    readonly publish: (scope: string, data?: unknown) => void,
    readonly pool = new ExecutionPool(),
  ) {}
  private live = new Map<string, Live>();
  private epochs = new Map<string, number>();
  private automaticStops = new Map<string, Promise<void>>();
  private pending = new Map<string, { scope: Scope; run: Run; input: WorkerInput; lease: ExecutionLease; done: Promise<void> }>();
  epoch(scope: Scope) { return this.epochs.get(scope.sessionId) ?? 0; }
  assertEpoch(scope: Scope, epoch: number) {
    if (this.closing || this.epoch(scope) !== epoch)
      throw new AppError("AGENT_STOPPED", "启动期间会话已停止；未发送请求。");
  }
  hasIdle(scope: Scope) { return this.pool.hasAffinity(scope.sessionId); }
  releaseIdle(scope: Scope) { return this.pool.releaseAffinity(scope.sessionId); }
  lease(scope: Scope, runId: string) {
    const live = this.live.get(scope.sessionId);
    return live?.run.id === runId && this.pool.isActive(live.lease.ref) ? live.lease.ref : undefined;
  }
  closing = false;
  onEvent?: (scope: Scope, run: Run, event: any) => void;
  onSettled?: (scope: Scope, run: Run) => void;
  active(scope: Scope) {
    this.store.session(scope.workspaceId, scope.sessionId);
    return this.live.has(scope.sessionId) || this.pending.has(scope.sessionId);
  }
  preemptAutomatic(scope: Scope) {
    const stopping = this.automaticStops.get(scope.sessionId);
    if (stopping) return stopping;
    const pending = this.pending.get(scope.sessionId), live = this.live.get(scope.sessionId);
    if (!((pending?.input.memoryContinuation || pending?.input.compressionPreparation) && pending.run.status === "starting" || live?.automatic && live.run.status === "starting")) return;
    // Concurrent user inputs share one preemption. Explicit stops still advance the epoch independently.
    const stopped = this.stop(scope);
    this.automaticStops.set(scope.sessionId, stopped);
    void stopped.finally(() => {
      if (this.automaticStops.get(scope.sessionId) === stopped) this.automaticStops.delete(scope.sessionId);
    }).catch(() => {});
    return stopped;
  }
  signal(scope: Scope, runId: string, value: Record<string, unknown>) {
    this.store.session(scope.workspaceId, scope.sessionId);
    const live = this.live.get(scope.sessionId);
    const preparing = this.pending.get(scope.sessionId);
    if (!live && preparing?.run.id === runId && ["budget", "summarize"].includes(String(value.type)) && preparing.input.task?.budget) {
      preparing.input.task.budget = { ...preparing.input.task.budget, ...value } as NonNullable<NonNullable<WorkerInput["task"]>["budget"]>;
      return true;
    }
    if (
      !live ||
      live.run.id !== runId ||
      !live.child.connected ||
      live.closed ||
      live.finish
    )
      return false;
    let reported = false;
    const uncertain = () => {
      if (reported || value.type !== "input") return;
      reported = true;
      // send() failure does not prove the worker received nothing. Report it
      // after enqueue has installed its receipt waiter, without replaying.
      const items = Array.isArray(value.notifications) ? value.notifications : [{ id: value.id }];
      queueMicrotask(() => {
        for (const item of items) live.receive?.({ type: "input-error", id: item.id, runId, lease: live.lease.ref, uncertain: true,
          error: "输入发送结果未获确认；须核对会话记录，未自动重发。" });
      });
    };
    try {
      live.child.send({ ...value, runId, lease: live.lease.ref }, (error) => { if (error) uncertain(); });
      return true; // false from child.send() is backpressure, not rejection.
    } catch {
      uncertain();
      return value.type === "input";
    }
  }
  private confirmLateInput(live: Live, id: string, status: "committed" | "failed", data: object) {
    // Only the still-owned input can resolve its original uncertain receipt.
    // Never change another scope, a pending transaction, or a confirmed result.
    this.store.db.prepare("UPDATE external_requests SET state=?,response=? WHERE id=? AND scope=? AND state='uncertain'")
      .run(status, JSON.stringify(data), id, JSON.stringify([live.scope.workspaceId, live.scope.sessionId]));
  }
  private queueChanged(live: Live) {
    if (live.task) return; // TaskScheduler owns the child's queued + native projection.
    this.views.queues.set(live.scope.sessionId, [...live.inputs].map(([id, input]) =>
      ({ id, text: input.draft.text, mode: input.mode, ...(input.draft.skills?.length ? { skills: input.draft.skills } : {}) })));
    this.publish(agentScope(live.scope), this.views.info(live.scope));
  }
  async enqueue(scope: Scope, id: string, draft: Draft, body: string, mode: "steer" | "followUp") {
    this.store.session(scope.workspaceId, scope.sessionId);
    const live = this.live.get(scope.sessionId);
    if (!live || live.run.status === "stopping" || live.finish || live.closed)
      throw new AppError("AGENT_BUSY", "执行正在结束或停止；请结束后发送新要求。");
    if (live.inputs.size >= 32) throw new AppError("TASK_LIMIT", "待处理输入达到 32 条");
    live.inputs.set(id, { draft, mode, pending: true });
    if (!this.signal(scope, live.run.id, { type: "input", id, text: body, images: draft.images, skills: draft.skills, mode })) {
      live.inputs.delete(id);
      throw new AppError("AGENT_BUSY", "追加输入未发送；执行已经结束。");
    }
    this.queueChanged(live);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        live.accepting.delete(id);
        reject(new AppError("UNCERTAIN", "追加输入受理未确认；不会自动重发。"));
      }, 30000);
      live.accepting.set(id, {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
    return { runId: live.run.id, inputId: id, status: "queued" };
  }
  async recallIds(scope: Scope, ids: string[]) {
    this.store.session(scope.workspaceId, scope.sessionId);
    const live = this.live.get(scope.sessionId);
    if (!live || !ids.length) return [];
    const key = randomUUID();
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        live.recalls.delete(key);
        reject(new AppError("UNCERTAIN", "撤回回执超时；不会自动重发输入。"));
      }, 10000);
      live.recalls.set(key, {
        resolve: (ids) => { clearTimeout(timer); resolve(ids); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      if (!this.signal(scope, live.run.id, { type: "recall", key, ids })) {
        live.recalls.delete(key);
        clearTimeout(timer);
        reject(new AppError("AGENT_BUSY", "执行正在结束；未确认撤回任何输入。"));
      }
    });
  }
  async recall(scope: Scope) {
    this.store.session(scope.workspaceId, scope.sessionId);
    const live = this.live.get(scope.sessionId);
    if (!live) return { drafts: [] };
    const snapshot = new Map(live.inputs);
    const failed = [...snapshot].filter(([, input]) => input.failed).map(([id]) => id);
    const ids = [...failed, ...await this.recallIds(scope,
      [...snapshot].filter(([, input]) => !input.failed).map(([id]) => id))];
    const removed = new Set(ids);
    const drafts = [...snapshot].filter(([id]) => removed.has(id)).map(([, input]) => input.draft);
    for (const id of ids) live.inputs.delete(id);
    this.queueChanged(live);
    return { drafts, ...(ids.length ? { ids } : {}) };
  }
  async launch(scope: Scope, run: Run, input: WorkerInput, lease: ExecutionLease, onStart?: (run: Run) => void) {
    if (this.active(scope)) throw new AppError("AGENT_BUSY", "会话已有启动或执行");
    let resolve!: () => void;
    const pending = { scope, run, input, lease, done: new Promise<void>((r) => { resolve = r; }) };
    const startup = { settled: false };
    this.pending.set(scope.sessionId, pending);
    try { onStart?.(run); await this.launchWorker(scope, run, input, lease, startup); }
    catch (error) {
      await this.pool.retire(lease.ref, "launch_failed");
      if (startup.settled) throw error;
      run.status = run.reasonCode?.endsWith("_STOPPED") || (error as AppError).code === "AGENT_STOPPED" ? "cancelled" : "failed";
      run.endedAt = Date.now(); run.error = errorMessage(error, "工作进程启动失败：未收到具体错误原因。");
      this.store.finishRun(run.id, run.status, run.error, run.reasonCode ?? "WORKER_START_FAILED");
      this.views.changed(scope);
      this.pending.delete(scope.sessionId);
      this.onSettled?.(scope, run);
      throw error;
    } finally {
      if (this.pending.get(scope.sessionId) === pending) this.pending.delete(scope.sessionId);
      resolve();
    }
  }
  private async launchWorker(scope: Scope, run: Run, input: WorkerInput, lease: ExecutionLease, startup = { settled: false }) {
    const epoch = this.epoch(scope);
    this.assertEpoch(scope, epoch);
    const child = await lease.ensureReady();
    this.assertEpoch(scope, epoch);
    if (!this.pool.isActive(lease.ref)) throw new AppError("AGENT_STOPPED", "启动期间会话已停止；未发送请求。");
    // Preserve a full check before trusted extension callbacks can run during SDK binding.
    const verified = await (lease.validateEnvironment?.() ?? lease.environment.current());
    this.assertEpoch(scope, epoch);
    if (!this.pool.isActive(lease.ref)) throw new AppError("AGENT_STOPPED", "启动期间会话已停止；未发送请求。");
    if (!verified || !lease.environment.current(false) || !lease.environment.snapshotValid())
      throw new AppError("REVISION_CONFLICT", "工作进程准备期间配置或资源已变化；消息未发送。");
    lease.beforeExecute?.();
    input.modelsFile = lease.environment.modelsFile;
    input.executionGate = true;
    let exited!: () => void;
    const live: Live = {
      scope,
      task: !!input.task,
      automatic: !!(input.memoryContinuation || input.compressionPreparation),
      run,
      child,
      lease,
      inputs: new Map(),
      recalls: new Map(),
      accepting: new Map(),
      exit: new Promise<void>((r) => {
        exited = r;
      }),
    };
    this.live.set(scope.sessionId, live);
    const onMessage = async (event: any) => {
      if (this.live.get(scope.sessionId) !== live || live.run.status === "stopping" || event.runId !== run.id || !sameLease(event.lease, lease.ref)) return;
      try {
        if (event.type === "idle" && live.finish && !live.storageFailed && !live.terminating && !this.closing) {
          if (live.validatingIdle) return;
          live.validatingIdle = true;
          // Worker cleanup has completed. Bound resource verification separately;
          // the two-second cleanup deadline must not kill a healthy idle worker.
          this.escalate(live, this.pool.limits.prepareTimeoutMs);
          const verified = await (lease.validateEnvironment?.() ?? lease.environment.current());
          if (this.live.get(scope.sessionId) !== live || this.live.get(scope.sessionId)?.run.status === 'stopping' || live.terminating || this.closing || !this.pool.isActive(lease.ref)) return;
          if (verified && !live.storageFailed && lease.environment.current(false) && lease.environment.snapshotValid()) settle(true);
          else this.kill(live);
          return;
        }
        if (event.type === "input-accepted") {
          const input = live.inputs.get(event.id);
          if (input) {
            input.pending = false;
            input.failed = false;
            if (!live.accepting.has(event.id)) this.confirmLateInput(live, event.id, "committed",
              { runId: run.id, inputId: event.id, status: "queued" });
          }
          live.accepting.get(event.id)?.resolve();
          live.accepting.delete(event.id);
        }
        if (event.type === "input-error") {
          const input = live.inputs.get(event.id);
          const waiting = live.accepting.get(event.id);
          const error = errorMessage(event.error, "追加输入未送达；原输入已保留，未自动重发。");
          if (waiting) {
            waiting.reject(new AppError(event.uncertain ? "UNCERTAIN" : "INPUT_REJECTED", error));
            live.accepting.delete(event.id);
          } else if (input && !event.uncertain) {
            this.confirmLateInput(live, event.id, "failed", { code: "INPUT_REJECTED", message: error });
          }
          // Transport uncertainty is not a rejection. Retain identity for a later
          // worker acknowledgement/rejection instead of orphaning the receipt.
          if (!event.uncertain) live.inputs.delete(event.id);
          this.queueChanged(live);
        }
        if (event.type === "queue") {
          const ids = new Set([...event.queue, ...event.native].map((input: { id: string }) => input.id));
          for (const [id, input] of live.inputs)
            if (!input.pending && !ids.has(id)) live.inputs.delete(id);
          this.queueChanged(live);
        }
        if (event.type === "recalled") {
          const recall = live.recalls.get(event.key);
          live.recalls.delete(event.key);
          recall?.resolve(event.ids);
        }
        if (event.type === "closed") live.closed = true;
        if (event.type === "done" && !live.validatingIdle) this.escalate(live, 2000);
        if (event.type === "ready")
          this.store.db
            .prepare(
              "UPDATE agent_sessions SET environment=? WHERE sessionId=?",
            )
            .run(JSON.stringify(event.environment), scope.sessionId);
        if (event.type === "running") {
          live.run.status = "running";
          this.store.db
            .prepare("UPDATE runs SET status='running' WHERE id=?")
            .run(run.id);
        }
        if (event.type === "context-rebuilt") this.views.refresh(scope);
        if (event.type === "messages-persisted") this.views.persisted(scope, event.ids);
        if (event.type === "latency") {
          latencyFor(this.store).add(event.record);
          return;
        }
        if (event.type === "message") {
          if (event.message.deliveryTiming) event.message.deliveryTiming.receivedAt = Date.now();
          this.views.messageChanged(scope, event.message);
        }
        if (event.type === "tool") {
          const id = `tool-${event.id}`,
            old = this.views.current(scope, id);
          const output = event.output?.content
            ?.filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n");
          const toolStartedAt = old?.toolStartedAt ?? (event.status === "running" ? Date.now() : undefined);
          this.views.messageChanged(scope, {
            id,
            role: "toolResult",
            toolStartedAt,
            durationMs: event.status === "running" ? undefined : event.durationMs,
            toolName: event.name,
            toolCallId: event.id,
            text: output ?? old?.text ?? "",
            status: event.status,
            streaming: event.status === "running",
          });
        }
        if (event.type === "done" && !live.storageFailed)
          live.finish = { status: event.status, error: event.error, reasonCode: event.reasonCode };
        if (["done", "usage"].includes(event.type) && event.usage)
          this.store.db
            .prepare("UPDATE agent_sessions SET usage=? WHERE sessionId=?")
            .run(JSON.stringify(event.usage), scope.sessionId);
        if (event.type === "progress") {
          if (event.retry && event.retry.runId !== run.id) return;
          if (event.phase) live.run.phase = event.phase;
          if (event.retry) live.run.retry = event.retry;
          this.store.db.prepare("UPDATE runs SET phase=?,retry=? WHERE id=? AND status IN ('starting','running')")
            .run(live.run.phase ?? null, live.run.retry ? JSON.stringify(live.run.retry) : null, run.id);
          this.views.changed(scope);
        }
        if (event.type === "warning" || event.type === "system-prompt") {
          const previous = this.views.info(scope).environment;
          const environment = event.type === "system-prompt" && event.environment ? event.environment : previous;
          if (environment) {
            if (event.type === "warning") environment.warnings.push(event.text);
            else {
              environment.systemPrompt = event.systemPrompt;
              environment.warnings = [...new Set([...(previous?.warnings ?? []), ...environment.warnings])];
            }
            this.store.db
              .prepare(
                "UPDATE agent_sessions SET environment=? WHERE sessionId=?",
              )
              .run(JSON.stringify(environment), scope.sessionId);
          }
        }
        if (["ready", "running"].includes(event.type))
          this.views.changed(scope);
        else if (["usage", "warning", "system-prompt"].includes(event.type))
          this.publish(agentScope(scope), this.views.info(scope));
        this.onEvent?.(scope, run, event);
      } catch {
        live.storageFailed = true;
        live.finish = {
          status: "failed",
          error: "执行状态保存失败；已停止工作进程。",
        };
        this.kill(live);
      }
    };
    let dispatched = false, startAcknowledged = false;
    const onError = (error: Error) => { live.finish = { status: "failed", error: errorMessage(error, "工作进程启动失败：未收到具体错误原因。") }; };
    const onClose = () => {
      if (dispatched && !startAcknowledged && !live.finish)
        live.finish = { status: "interrupted", error: "工作进程在启动消息发送确认前退出。", reasonCode: "UNCERTAIN" };
      settle(false);
    };
    let settled = false;
    const settle = (keepAlive: boolean) => {
      if (settled) return;
      settled = true;
      startup.settled = true;
      live.receive = undefined;
      child.removeListener("message", onMessage);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      clearTimeout(live.timer);
      let terminal: Run | undefined;
      try {
        this.views.flush(scope);
        // Worker text/reason codes alone cannot authorize a replay. The durable
        // witness is written by the coordinator before a denied permit is sent.
        const rejection = this.store.bindingRejection(run.id);
        const rejected = rejection && live.finish?.status !== "cancelled" && live.run.status !== "stopping" && !live.storageFailed;
        const status = rejected ? "failed" : live.finish?.status ?? "interrupted";
        const error = rejected ? new ExecutionPermitDeniedError(rejection).message
          : live.finish?.error ?? (live.finish ? null : "工作进程中断；流式尾部可能未保存，未自动重做。");
        const reasonCode = rejected ? "BINDING_REJECTED" : live.finish?.reasonCode === "BINDING_REJECTED" ? "EXECUTION_ERROR"
          : live.finish?.reasonCode ?? (live.finish ? null : "WORKER_INTERRUPTED");
        const retry = live.run.retry && ["waiting", "retrying"].includes(live.run.retry.state)
          ? { ...live.run.retry, state: "cancelled" as const, nextRetryAt: undefined } : live.run.retry;
        if (!keepAlive) this.views.recoverRequestUsage(scope);
        this.store.finishRun(run.id, status, error, reasonCode, retry);
        this.views.settled(scope);
        this.views.queues.delete(scope.sessionId);
        this.views.refresh(scope);
        terminal = { ...run, status, endedAt: Date.now(), error, reasonCode, retry, phase: null };
      } catch {
        if (keepAlive) { this.kill(live); keepAlive = false; }
        this.publish(agentScope(scope), {
          ...this.views.info(scope),
          run: {
            ...run,
            status: "interrupted",
            error: "执行已退出，但状态保存失败；请检查应用磁盘，勿重复发送。",
          },
        });
      } finally {
        for (const recall of live.recalls.values())
          recall.reject(new AppError("UNCERTAIN", "工作进程已退出，撤回结果未确认；不会自动重发。"));
        live.recalls.clear();
        for (const waiting of live.accepting.values())
          waiting.reject(new AppError("UNCERTAIN", "工作进程退出，追加输入未确认；不会自动重发。"));
        live.accepting.clear();
        this.live.delete(scope.sessionId);
        if (this.pending.get(scope.sessionId)?.run === run) this.pending.delete(scope.sessionId);
        try {
          if (keepAlive && !live.terminating) {
            void this.pool.release(lease.ref, { clean: true, keepSession: true,
              affinity: { sessionId: scope.sessionId, fileRevision: fileRevision(input.file) } })
              .catch(() => { this.kill(live); });
          }
        } catch {
          // Synchronous snapshot/stat errors must not skip the business settlement.
          this.kill(live);
        } finally {
          exited();
          try {
            if (terminal) this.onSettled?.(scope, terminal);
          } catch {
            /* Persisted run remains available for reconciliation on restart; do not acknowledge delivery. */
          }
        }
      }
    };
    live.receive = onMessage;
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("close", onClose);
    try {
      if (!child.connected) throw new AppError("WORKER_START_FAILED", "工作进程连接已关闭；消息未发送。");
      await new Promise<void>((resolve, reject) => {
        let finished = false;
        const closed = () => finish(new Error("工作进程在启动消息发送确认前退出。"));
        const timer = setTimeout(() => finish(new Error("启动消息发送确认超时。")), 10000);
        const finish = (error?: Error | null) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          child.removeListener("close", closed);
          if (error) {
            if (!settled && live.run.status !== "stopping") live.finish = { status: "interrupted", error: errorMessage(error, "启动消息发送失败。"), reasonCode: "UNCERTAIN" };
            reject(error);
          } else { startAcknowledged = true; resolve(); }
        };
        child.once("close", closed);
        // Once send is invoked, an error alone cannot prove non-delivery. Its
        // boolean return value is backpressure, not an acknowledgement.
        dispatched = true;
        try { child.send({ type: "start", input, lease: lease.ref }, finish); }
        catch (error) { finish(error as Error); }
      });
    } catch (error) {
      const message = errorMessage(error, "未收到启动发送错误的具体原因。");
      const code = dispatched ? "UNCERTAIN" : "WORKER_START_FAILED";
      if (!settled) {
        if (live.run.status !== "stopping") {
          live.finish = { status: dispatched ? "interrupted" : "failed", error: message, reasonCode: code };
          this.kill(live);
        }
        await live.exit;
      }
      throw new AppError(code, message);
    }
  }
  async stop(scope: Scope, source: StopSource = "user") {
    this.store.session(scope.workspaceId, scope.sessionId);
    this.epochs.set(scope.sessionId, (this.epochs.get(scope.sessionId) ?? 0) + 1);
    const pending = this.pending.get(scope.sessionId);
    const starting = this.live.get(scope.sessionId);
    if (pending) pending.run.reasonCode ??= `${source.toUpperCase()}_STOPPED`;
    if (pending && starting) this.stopLive(starting, source);
    else if (pending) await this.pool.retire(pending.lease.ref, "stopped_before_ready");
    if (pending) await pending.done;
    await this.pool.releaseAffinity(scope.sessionId);
    const live = this.live.get(scope.sessionId);
    if (!live) return;
    this.stopLive(live, source);
    await live.exit;
  }
  private stopLive(live: Live, source: StopSource = "user") {
    if (live.run.status === "stopping") return;
    live.run.status = "stopping";
    live.finish = { status: "cancelled", reasonCode: `${source.toUpperCase()}_STOPPED` };
    this.store.db
      .prepare("UPDATE runs SET status='stopping' WHERE id=?")
      .run(live.run.id);
    this.views.changed(live.scope);
    this.kill(live);
  }
  private escalate(live: Live, ms: number) {
    clearTimeout(live.timer);
    live.timer = setTimeout(() => this.kill(live), ms);
  }
  // The pool revokes reuse before terminating the owned process tree.
  private kill(live: Live) {
    clearTimeout(live.timer);
    if (live.terminating) return;
    live.terminating = true;
    void this.pool.retire(live.lease.ref, "forced_stop", true).catch(() => {});
  }
  affected(providers: string[]) {
    return [...new Map([...this.live.values(), ...this.pending.values()]
      .filter((l) => providers.includes(l.run.selection.provider))
      .map((l) => [l.scope.sessionId, l])).values()]
      .map((l) => ({
        ...l.scope,
        title: this.store.session(l.scope.workspaceId, l.scope.sessionId).title,
      }));
  }
  async stopProviders(providers: string[], confirmed: boolean) {
    const affected = this.affected(providers);
    if (affected.length && !confirmed)
      throw new AppError(
        "ACTIVE_RUNS_CONFIRMATION_REQUIRED",
        `需先停止受影响会话：${affected.map((a) => a.title).join("、")}。确认后才退出登录。`,
      );
    await this.pool.invalidate(providers);
    for (const scope of affected) await this.stop(scope, "provider");
  }
  async close() {
    this.closing = true;
    await Promise.all([...this.pending.values()].map((entry) => this.stop(entry.scope, "shutdown")));
    await this.pool.trim();
    await Promise.allSettled(
      [...this.live.values()].map((l) =>
        this.stop(l.scope, "shutdown"),
      ),
    );
  }
}
