import { randomUUID } from "node:crypto";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { rmSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError, type Scope, type Draft } from "../../shared/protocol.js";
import { agentScope, threadScope, type Run } from "../../shared/agent.js";
import type { Store } from "../storage.js";
import type { WorkerInput } from "../agent-worker.js";
import { AgentViews } from "./views.js";
import { resourceIdentity } from "./resource-identity.js";
import { errorMessage } from "../error-message.js";
type Live = {
  scope: Scope;
  task: boolean;
  run: Run;
  child: ChildProcess;
  bornAt?: number;
  exit: Promise<void>;
  finish?: { status: Run["status"]; error?: string; reasonCode?: string };
  storageFailed?: boolean;
  closed?: boolean;
  timer?: NodeJS.Timeout;
  inputs: Map<string, { draft: Draft; mode: "steer" | "followUp"; pending: boolean; failed?: boolean }>;
  recalls: Map<string, { resolve: (ids: string[]) => void; reject: (error: Error) => void }>;
  accepting: Map<string, { resolve: () => void; reject: (error: Error) => void }>;
};

const idleLimit = 10;
const idleTimeoutMs = 15 * 60 * 1000;
type Idle = { live: Live; input: WorkerInput; identity: string; timer: NodeJS.Timeout; close: () => void };
function identity(input: WorkerInput, includeFile = true) {
  const stamp = (file: string) => { try { const s = statSync(file); return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`; } catch { return "missing"; } };
  const config = createHash("sha256").update(readFileSync(input.modelsFile)).digest("hex");
  let resources: string;
  try { resources = resourceIdentity(input.cwd, join(input.root, "pi")); }
  catch { resources = randomUUID(); } // Unverifiable resources disable reuse, not execution.
  return JSON.stringify([input.cwd, input.file, input.selection, input.task?.id, input.task?.role,
    config, resources, includeFile ? stamp(input.file) : null, stamp(join(process.env.AXIOM_PI_DIR || join(input.root, "pi"), "auth.json")),
    stamp(join(input.root, "pi", "settings.json")), stamp(join(input.cwd, ".pi", "settings.json"))]);
}

export class AgentRuns {
  constructor(
    readonly store: Store,
    readonly views: AgentViews,
    readonly publish: (scope: string, data?: unknown) => void,
  ) {}
  private live = new Map<string, Live>();
  private idle = new Map<string, Idle>();
  private retiring = new Set<Promise<void>>();
  private retiringSessions = new Map<string, Promise<void>>();
  private epochs = new Map<string, number>();
  private pending = new Map<string, { scope: Scope; run: Run; done: Promise<void> }>();
  epoch(scope: Scope) { return this.epochs.get(scope.sessionId) ?? 0; }
  assertEpoch(scope: Scope, epoch: number) {
    if (this.closing || this.epoch(scope) !== epoch)
      throw new AppError("AGENT_STOPPED", "启动期间会话已停止；未发送请求。");
  }
  hasIdle(scope: Scope) { return this.idle.has(scope.sessionId) || this.retiringSessions.has(scope.sessionId); }
  async releaseIdle(scope: Scope) {
    const entry = this.idle.get(scope.sessionId);
    if (entry) await this.retire(entry);
    await this.retiringSessions.get(scope.sessionId);
  }
  private retire(entry: Idle) {
    this.idle.delete(entry.live.scope.sessionId);
    clearTimeout(entry.timer);
    const closed = new Promise<void>((resolve) => {
      if (entry.live.child.exitCode !== null || entry.live.child.signalCode !== null) { resolve(); return; }
      const deadline = setTimeout(() => this.kill(entry.live), 2000);
      entry.live.child.once("close", () => { clearTimeout(deadline); resolve(); });
      try {
        if (entry.live.child.connected) entry.live.child.send({ type: "shutdown" }, (error) => { if (error) this.kill(entry.live); });
        else this.kill(entry.live);
      } catch { this.kill(entry.live); }
    });
    this.retiring.add(closed);
    this.retiringSessions.set(entry.live.scope.sessionId, closed);
    void closed.finally(() => {
      this.retiring.delete(closed);
      if (this.retiringSessions.get(entry.live.scope.sessionId) === closed) this.retiringSessions.delete(entry.live.scope.sessionId);
    });
    return closed;
  }
  private keep(live: Live, input: WorkerInput) {
    const close = () => {
      const item = this.idle.get(live.scope.sessionId);
      if (item?.live === live) { clearTimeout(item.timer); this.idle.delete(live.scope.sessionId); }
      try { rmSync(input.modelsFile, { force: true }); } catch { /* Retry on service startup. */ }
    };
    live.bornAt ??= Date.now();
    const remaining = Math.max(1, Math.min(idleTimeoutMs, live.bornAt + idleTimeoutMs - Date.now()));
    const entry: Idle = { live, input, identity: identity(input), close,
      timer: setTimeout(() => { void this.retire(entry); }, remaining) };
    entry.timer.unref();
    live.child.once("close", close);
    this.idle.set(live.scope.sessionId, entry);
    while (this.idle.size > idleLimit) void this.retire(this.idle.values().next().value!);
  }
  closing = false;
  onEvent?: (scope: Scope, run: Run, event: any) => void;
  onSettled?: (scope: Scope, run: Run) => void;
  active(scope: Scope) {
    this.store.session(scope.workspaceId, scope.sessionId);
    return this.live.has(scope.sessionId) || this.pending.has(scope.sessionId);
  }
  signal(scope: Scope, runId: string, value: Record<string, unknown>) {
    this.store.session(scope.workspaceId, scope.sessionId);
    const live = this.live.get(scope.sessionId);
    if (
      !live ||
      live.run.id !== runId ||
      !live.child.connected ||
      live.closed ||
      live.finish
    )
      return false;
    live.child.send({ ...value, runId }, () => {});
    return true;
  }
  private queueChanged(live: Live) {
    if (live.task) return; // TaskScheduler owns the child's queued + native projection.
    this.views.queues.set(live.scope.sessionId, [...live.inputs].map(([id, input]) =>
      ({ id, text: input.draft.text, mode: input.mode })));
    this.publish(agentScope(live.scope), this.views.info(live.scope));
  }
  async enqueue(scope: Scope, id: string, draft: Draft, body: string, mode: "steer" | "followUp") {
    this.store.session(scope.workspaceId, scope.sessionId);
    const live = this.live.get(scope.sessionId);
    if (!live || live.run.status === "stopping" || live.finish || live.closed)
      throw new AppError("AGENT_BUSY", "执行正在结束或停止；请结束后发送新要求。");
    if (live.inputs.size >= 32) throw new AppError("TASK_LIMIT", "待处理输入达到 32 条");
    live.inputs.set(id, { draft, mode, pending: true });
    if (!this.signal(scope, live.run.id, { type: "input", id, text: body, images: draft.images, mode })) {
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
  async launch(scope: Scope, run: Run, input: WorkerInput) {
    if (this.active(scope)) throw new AppError("AGENT_BUSY", "会话已有启动或执行");
    let resolve!: () => void;
    const pending = { scope, run, done: new Promise<void>((r) => { resolve = r; }) };
    const startup = { settled: false };
    this.pending.set(scope.sessionId, pending);
    try { await this.launchWorker(scope, run, input, startup); }
    catch (error) {
      if (startup.settled) throw error;
      run.status = (error as AppError).code === "AGENT_STOPPED" ? "cancelled" : "failed";
      run.endedAt = Date.now(); run.error = errorMessage(error, "工作进程启动失败：未收到具体错误原因。");
      this.store.finishRun(run.id, run.status, run.error, "WORKER_START_FAILED");
      this.views.changed(scope);
      this.pending.delete(scope.sessionId);
      this.onSettled?.(scope, run);
      throw error;
    } finally {
      if (this.pending.get(scope.sessionId) === pending) this.pending.delete(scope.sessionId);
      resolve();
    }
  }
  private async launchWorker(scope: Scope, run: Run, input: WorkerInput, startup = { settled: false }) {
    const epoch = this.epoch(scope);
    if (this.retiringSessions.has(scope.sessionId)) await this.retiringSessions.get(scope.sessionId);
    this.assertEpoch(scope, epoch);
    // Validate while any cached process is still owned by the idle pool. Reuse
    // requires identical configuration, so this also describes the reused input.
    const environmentIdentity = identity(input, false);
    let reused: ChildProcess | undefined;
    const cached = this.idle.get(scope.sessionId);
    if (cached) {
      let compatible = false;
      try {
        compatible = !this.closing && Date.now() - (cached.live.bornAt ?? 0) < idleTimeoutMs &&
          cached.live.child.connected && cached.identity === identity(input) && cached.identity === identity(cached.input);
      } catch { /* A missing or changed cached snapshot requires a fresh worker. */ }
      if (compatible) {
        // A cleanup failure must leave the cached owner registered and reusable.
        rmSync(input.modelsFile, { force: true });
        input.modelsFile = cached.input.modelsFile;
        clearTimeout(cached.timer);
        cached.live.child.removeListener("close", cached.close);
        this.idle.delete(scope.sessionId);
        reused = cached.live.child;
      } else await this.retire(cached);
    }
    if (this.closing || (this.epochs.get(scope.sessionId) ?? 0) !== epoch) {
      if (reused) reused.kill();
      throw new AppError("AGENT_STOPPED", "启动期间会话已停止；未发送请求。");
    }
    const path = fileURLToPath(
      new URL(
        import.meta.url.endsWith(".ts")
          ? "../agent-worker.ts"
          : "../agent-worker.js",
        import.meta.url,
      ),
    );
    const child = reused ?? fork(path, [], {
      cwd: input.cwd,
      execArgv:
        extname(path) === ".ts" ? ["--import", import.meta.resolve("tsx")] : [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      detached: process.platform !== "win32",
    });
    let exited!: () => void;
    const live: Live = {
      scope,
      task: !!input.task,
      run,
      child,
      bornAt: cached && reused ? cached.live.bornAt : Date.now(),
      inputs: new Map(),
      recalls: new Map(),
      accepting: new Map(),
      exit: new Promise<void>((r) => {
        exited = r;
      }),
    };
    this.live.set(scope.sessionId, live);
    const onMessage = (event: any) => {
      if (this.live.get(scope.sessionId) !== live || live.run.status === "stopping" || event.runId !== run.id) return;
      try {
        if (event.type === "idle" && live.finish && !live.storageFailed && !this.closing) {
          if (environmentIdentity === identity(input, false)) settle(true);
          else this.kill(live);
          return;
        }
        if (event.type === "input-accepted") {
          const input = live.inputs.get(event.id);
          if (input) input.pending = false;
          live.accepting.get(event.id)?.resolve();
          live.accepting.delete(event.id);
        }
        if (event.type === "input-error") {
          const input = live.inputs.get(event.id);
          const waiting = live.accepting.get(event.id);
          if (waiting) {
            waiting.reject(new AppError("INPUT_REJECTED", event.error || "追加输入未送达；原输入已保留，未自动重发。"));
            live.accepting.delete(event.id);
            live.inputs.delete(event.id);
          } else if (input) { input.failed = true; input.pending = true; }
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
        if (event.type === "done") this.escalate(live, 2000);
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
        if (event.type === "title" && !live.task && !live.finish && !live.closed) {
          if (this.store.generatedTitle(scope, event.title)) this.views.changed(scope);
        }
        if (event.type === "context-rebuilt") this.views.refresh(scope);
        if (event.type === "message")
          this.views.messageChanged(scope, event.message);
        if (event.type === "tool") {
          const id = `tool-${event.id}`,
            old = this.views.transcript(scope).get(id);
          const output = event.output?.content
            ?.filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n");
          this.views.messageChanged(scope, {
            id,
            role: "toolResult",
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
          const environment = this.views.info(scope).environment;
          if (environment) {
            if (event.type === "warning") environment.warnings.push(event.text);
            else environment.systemPrompt = event.systemPrompt;
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
      child.removeListener("message", onMessage);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      clearTimeout(live.timer);
      let terminal: Run | undefined;
      try {
        try {
          if (!keepAlive) rmSync(input.modelsFile, { force: true });
        } catch {
          /* Protected runtime snapshot is retried on service startup. */
        }
        this.views.flush(scope);
        const status = live.finish?.status ?? "interrupted";
        const error = live.finish?.error ?? (live.finish ? null : "工作进程中断；流式尾部可能未保存，未自动重做。");
        const reasonCode = live.finish?.reasonCode ?? (live.finish ? null : "WORKER_INTERRUPTED");
        const retry = live.run.retry && ["waiting", "retrying"].includes(live.run.retry.state)
          ? { ...live.run.retry, state: "cancelled" as const, nextRetryAt: undefined } : live.run.retry;
        this.store.finishRun(run.id, status, error, reasonCode, retry);
        this.views.settled(scope);
        this.views.messages.delete(scope.sessionId);
        this.views.queues.delete(scope.sessionId);
        this.publish(threadScope(scope), this.views.thread(scope));
        this.views.publishMessages(scope);
        this.views.changed(scope);
        terminal = { ...run, status, endedAt: Date.now(), error, reasonCode, retry, phase: null };
      } catch {
        if (keepAlive) { this.kill(live); keepAlive = false; rmSync(input.modelsFile, { force: true }); }
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
        if (keepAlive) {
          try { this.keep(live, input); } catch { this.kill(live); rmSync(input.modelsFile, { force: true }); }
        }
        exited();
        try {
          if (terminal) this.onSettled?.(scope, terminal);
        } catch {
          /* Persisted run remains available for reconciliation on restart; do not acknowledge delivery. */
        }
      }
    };
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
        try { child.send({ type: "start", input }, finish); }
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
  async stop(scope: Scope) {
    this.store.session(scope.workspaceId, scope.sessionId);
    this.epochs.set(scope.sessionId, (this.epochs.get(scope.sessionId) ?? 0) + 1);
    const pending = this.pending.get(scope.sessionId);
    const starting = this.live.get(scope.sessionId);
    if (pending && starting) this.stopLive(starting);
    if (pending) await pending.done;
    const idle = this.idle.get(scope.sessionId);
    if (idle) await this.retire(idle);
    await this.retiringSessions.get(scope.sessionId);
    const live = this.live.get(scope.sessionId);
    if (!live) return;
    this.stopLive(live);
    await live.exit;
  }
  private stopLive(live: Live) {
    if (live.run.status === "stopping") return;
    live.run.status = "stopping";
    live.finish = { status: "cancelled", reasonCode: "USER_STOPPED" };
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
  // Best-effort termination of the owned process tree, not proof of external side-effect rollback.
  private kill(live: Live) {
    clearTimeout(live.timer);
    if (process.platform === "win32" && live.child.pid) {
      const kill = spawn(
        join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/F", "/T", "/PID", String(live.child.pid)],
        { stdio: "ignore", windowsHide: true },
      );
      kill.on("error", () => live.child.kill());
      const deadline = setTimeout(() => {
        kill.kill();
        live.child.kill();
      }, 2000);
      kill.once("close", (code) => {
        clearTimeout(deadline);
        if (code !== 0) live.child.kill();
      });
    } else if (live.child.pid) {
      try {
        process.kill(-live.child.pid, "SIGKILL");
      } catch {
        live.child.kill("SIGKILL");
      }
    }
  }
  affected(providers: string[]) {
    return [...this.live.values(), ...this.pending.values()]
      .filter((l) => providers.includes(l.run.selection.provider))
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
    for (const entry of [...this.idle.values()])
      if (providers.includes(entry.live.run.selection.provider)) await this.retire(entry);
    for (const scope of affected) await this.stop(scope);
  }
  async close() {
    this.closing = true;
    await Promise.all([...this.pending.values()].map((entry) => this.stop(entry.scope)));
    await Promise.all([...this.idle.values()].map((entry) => this.retire(entry)));
    await Promise.all(this.retiring);
    await Promise.allSettled(
      [...this.live.values()].map((l) =>
        this.stop(l.scope),
      ),
    );
  }
}
