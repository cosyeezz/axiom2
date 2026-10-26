import { forkSession } from "./session-fork.js";
import { SessionTitles } from "./session-titles.js";
import { SessionReloads } from "./session-reloads.js";
import { Capabilities } from "./capabilities.js";
import { previewEnvironment } from "./session-environment.js";
import { performance } from "node:perf_hooks";
import { ExecutionPool, type ExecutionLease } from "./execution-pool.js";
import type { TaskAdmissionTurn } from "./tasks/admission.js";
import { ExecutionProfiles, fileRevision } from "./execution-profile.js";
import type { LeaseRef } from "./execution-protocol.js";
import { assertRewrite, editableMessage, rewriteBranch, rewriteTarget } from "./session-rewrite.js";
import { Memories } from "./memories.js";
import { MemoryContinuations } from "./memory-continuations.js";
import type { OpenMemoryFile } from "./memory-open.js";
import { ColdMemoryRunner } from "./memory-runner.js";
import { memoryDirectory } from "./memory-files.js";
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store, type SessionRestorePosition } from "./storage.js";
import { ModelService } from "./model-service.js";
import { configuration } from "./models.js";
import { boundedMessage, openTranscript, toolKey } from "./transcript.js";
import { messagePart } from "./message-part.js";
import {
  AppError,
  attachmentsInput,
  attachmentPrompt,
  object,
  text,
  type Command,
  type Scope,
  type Draft,
} from "../shared/protocol.js";
import {
  threadScope,
  running,
  type Run,
  type Selection,
} from "../shared/agent.js";
import type { StopSource } from "../shared/tasks.js";
import type { WorkerInput } from "./agent-worker.js";
import { AgentViews } from "./agents/views.js";
import { AgentRuns } from "./agents/runs.js";
import { PersistedInputCursor } from "./agents/persisted-inputs.js";
import { Compressions } from "./compressions.js";
import { skillsInput } from "../shared/skills.js";
import { imagesInput, imagePrompt, requireImageModel } from "./images.js";
import { canContinue } from "../shared/session-state.js";
import { errorMessage } from "./error-message.js";
type PendingStart = { scope: Scope; automatic?: boolean; controller: AbortController; done: Promise<void>; finish: () => void; provider?: string; lease?: ExecutionLease };
export class Agents {
  readonly reloads: SessionReloads;
  readonly capabilities: Capabilities;
  readonly pool: ExecutionPool;
  readonly profiles: ExecutionProfiles;
  private starts = new Map<string, PendingStart>();
  private readonly unwatchConfiguration: () => void;
  readonly memories: Memories;
  readonly titles: SessionTitles;
  readonly continuations: MemoryContinuations;
  private memoryQueries = new Map<string, { scope: Scope; controller: AbortController }>();
  readonly compressions: Compressions;
  private readonly views: AgentViews;
  private readonly runs: AgentRuns;
  private externalEvent?: AgentRuns["onEvent"];
  private externalSettled?: AgentRuns["onSettled"];
  set onEvent(value: AgentRuns["onEvent"]) {
    this.externalEvent = value;
  }
  set onSettled(value: AgentRuns["onSettled"]) {
    this.externalSettled = value;
  }
  private commands = new Map<string, Promise<unknown>>();
  private serialCommand<T>(scope: Scope, operation: () => Promise<T>): Promise<T> {
    const previous = this.commands.get(scope.sessionId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.commands.set(scope.sessionId, next);
    void next.finally(() => {
      if (this.commands.get(scope.sessionId) === next) this.commands.delete(scope.sessionId);
    }).catch(() => {});
    return next;
  }
  private owner(scope: Scope) {
    return this.store.session(scope.workspaceId, scope.sessionId);
  }
  private changed(scope: Scope) {
    this.views.changed(scope);
  }
  info(scope: Scope) {
    return this.views.info(scope);
  }
  thread(scope: Scope) {
    return this.views.thread(scope);
  }
  messageCount(scope: Scope) {
    return this.views.messageCount(scope);
  }
  messages(scope: Scope) {
    return [...this.views.transcript(scope).values()].map(boundedMessage);
  }
  message(scope: Scope, id: string, full = false) {
    return this.views.message(scope, id, full);
  }
  refresh(scope: Scope) {
    this.views.refresh(scope);
  }
  // Global maintenance must also wait for background commands before a run exists.
  get maintenancePending() { return this.commands.size > 0 || this.starts.size > 0 || this.continuations.busy || this.compressions.busy; }
  active(scope: Scope, exclude?: PendingStart) {
    return this.reloads.active(scope) || this.runs.active(scope) || Boolean(this.starts.get(scope.sessionId) && this.starts.get(scope.sessionId) !== exclude);
  }
  executing(scope: Scope) { return this.runs.active(scope); }
  lease(scope: Scope, runId: string): LeaseRef | undefined { return this.runs.lease(scope, runId); }
  assertMemoryContinuation(scope: Scope, expectedRunId: string, exclude?: PendingStart, allowCompression = false, startingRunId?: string) {
    this.owner(scope);
    const info = this.info(scope);
    const expectedRun = startingRunId ? info.run?.id === startingRunId && info.run.resumedFromRunId === expectedRunId && info.run.status === "starting"
      : info.run?.id === expectedRunId && info.run.status === "completed" && !info.run.reasonCode && !info.run.error;
    if (this.runs.closing || !this.store.workspace(scope.workspaceId).authorized || !expectedRun ||
        !startingRunId && this.active(scope, exclude) || info.activeTaskCount || info.queue?.length ||
        !allowCompression && this.compressions.info(scope)?.state === "running" ||
        this.store.db.prepare("SELECT 1 FROM tasks WHERE sessionId=?").get(scope.sessionId) ||
        this.store.db.prepare("SELECT 1 FROM task_parents WHERE sessionId=? AND frozen=1").get(scope.sessionId) ||
        this.store.db.prepare("SELECT 1 FROM task_results r JOIN tasks t ON t.id=r.taskId WHERE t.parentSessionId=? AND r.delivery NOT IN ('delivered','discarded') LIMIT 1").get(scope.sessionId))
      throw new AppError("CONTINUATION_CANCELLED", "会话状态已变化或仍有待处理工作，未自动继续");
  }
  assertContinuation(scope: Scope, expectedRunId: unknown, queuedTask = false, exclude?: PendingStart) {
    if (expectedRunId === undefined) return;
    const info = this.info(scope);
    if (text(expectedRunId, "原执行标识") !== info.run?.id || !canContinue(info.run) ||
        this.active(scope, exclude) || info.activeTaskCount || (!queuedTask && info.task?.status === "queued"))
      throw new AppError("RUN_MISMATCH", "原执行已变化或仍有活动任务；未将继续处理注入其他执行，请重新读取。");
  }
  assertRewriteIdle(scope: Scope, queuedInputs: string[] = [], exclude?: PendingStart) {
    const info = this.info(scope);
    if (this.active(scope, exclude) || running(info.run) || info.activeTaskCount ||
        info.queue?.some((input) => !queuedInputs.includes(input.id)) || this.compressions.info(scope)?.state === "running" ||
        info.task && ["starting", "running", "stopping", ...(queuedInputs.length ? [] : ["queued"])].includes(info.task.status))
      throw new AppError("REWRITE_BUSY", "请先停止此会话及活动子任务、后台压缩，再修改并重新发送。");
  }
  editable(scope: Scope, messageId: string) {
    this.owner(scope);
    this.assertRewriteIdle(scope);
    const workspace = this.store.workspace(scope.workspaceId);
    if (!workspace.authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
    const file = this.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)?.file;
    if (!file) throw new AppError("NOT_EDITABLE", "此会话没有已保存的用户消息。");
    return editableMessage(openTranscript(String(file), workspace.path), messageId);
  }
  hasIdle(scope: Scope) { return this.runs.hasIdle(scope); }
  releaseIdle(scope: Scope) { return this.runs.releaseIdle(scope); }
  signal(scope: Scope, id: string, value: Record<string, unknown>) {
    return this.runs.signal(scope, id, value);
  }
  recallIds(scope: Scope, ids: string[]) {
    return this.runs.recallIds(scope, ids);
  }
  setQueue(scope: Scope, queue: NonNullable<import("../shared/agent.js").AgentInfo["queue"]>, notify = true) {
    this.owner(scope);
    const previous = this.views.queues.get(scope.sessionId);
    if (previous?.length === queue.length && previous.every((item, i) => item.id === queue[i].id && item.mode === queue[i].mode && item.text === queue[i].text)) return;
    this.views.queues.set(scope.sessionId, queue);
    if (notify) this.changed(scope);
  }
  async stop(scope: Scope, source: StopSource = "user") {
    if (source !== "shutdown") this.store.recoveries.remove(scope.sessionId);
    this.continuations.cancel(scope, true);
    this.titles.cancel(scope);
    const start = this.starts.get(scope.sessionId);
    start?.controller.abort();
    for (const query of this.memoryQueries.values()) if (query.scope.sessionId === scope.sessionId) query.controller.abort();
    await Promise.all([
      this.reloads.stop(scope),
      this.runs.stop(scope, source),
      this.compressions.stop(scope),
      start?.done,
    ]);
  }
  affected(providers: string[]) {
    return [...new Map([...this.runs.affected(providers), ...[...this.starts.values()].filter(start => start.provider && providers.includes(start.provider))
      .map(start => ({ ...start.scope, title: this.owner(start.scope).title }))].map(scope => [scope.sessionId, scope])).values()];
  }
  async stopProviders(providers: string[], confirmed: boolean) {
    const affected = this.affected(providers);
    if (affected.length && !confirmed) throw new AppError("ACTIVE_RUNS_CONFIRMATION_REQUIRED", "需先停止受影响会话，再退出认证。");
    this.continuations.cancelAll();
    this.titles.cancelProviders(providers);
    const starts = [...this.starts.values()].filter(start => !start.provider || providers.includes(start.provider));
    for (const start of starts) start.controller.abort();
    await this.compressions.stopProviders(providers, confirmed);
    await Promise.all([this.runs.stopProviders(providers, confirmed), ...starts.map(start => start.done)]);
  }
  async close() {
    this.unwatchConfiguration();
    const starts = [...this.starts.values()];
    for (const start of starts) start.controller.abort();
    await Promise.all([this.titles.close(), this.reloads.close(), this.runs.close(), this.compressions.close(), this.memories.close(), this.continuations.close()]);
    await Promise.all(starts.map(start => start.done));
    await this.pool.close();
  }
  constructor(
    readonly store: Store,
    readonly models: ModelService,
    readonly publish: (scope: string, data?: unknown) => void,
    openMemoryFile?: OpenMemoryFile,
    observed?: (scope: string) => boolean,
  ) {
    this.capabilities = new Capabilities(store, publish, models.dir);
    this.pool = new ExecutionPool();
    this.profiles = new ExecutionProfiles(store.root);
    this.unwatchConfiguration = models.watchConfiguration(() => { void this.pool.invalidate().catch(() => {}); });
    this.memories = new Memories(store, publish, openMemoryFile, undefined, undefined, observed);
    this.memories.runner = new ColdMemoryRunner(this.memories, models, this.pool, this.profiles);
    this.titles = new SessionTitles(this.memories, scope => this.changed(scope), (scope, runId) => {
      const messages = [...this.views.transcript(scope).values()];
      // Only a visible native message is a usable trigger anchor. Tool results,
      // stream placeholders and task notices never become standalone rows.
      return messages.findLast(message => message.runId === runId && !message.taskNotice && !message.compression &&
        (message.role === "user" || message.role === "assistant" && !!(message.text.trim() || message.thinking || message.calls?.length)))?.id;
    }, {
      startedAt: scope => {
        const row = this.store.db.prepare("SELECT MIN(startedAt) AS startedAt FROM runs WHERE sessionId=? AND origin IS NULL").get(scope.sessionId);
        return row?.startedAt == null ? undefined : Number(row.startedAt);
      },
      // Include the first user message even after compaction, on the current branch only.
      messages: scope => this.views.original(scope).values(),
    });
    this.views = new AgentViews(store, publish, observed);
    this.runs = new AgentRuns(store, this.views, publish, this.pool);
    this.compressions = new Compressions(this);
    this.continuations = new MemoryContinuations(this);
    this.reloads = new SessionReloads(this);
    this.runs.onEvent = (scope, run, event) => {
      if (event.type === "provider_request") this.titles.request(scope, run);
      if (event.type === "message") this.titles.message(scope, run, event.message);
      this.reloads.event(scope, run.id, event);
      this.compressions.event(scope, run.id, event);
      if (event.type === "memory-cancel") this.memoryQueries.get(event.key)?.controller.abort();
      if (event.type === "memory-call") {
        const controller = new AbortController();
        this.memoryQueries.set(event.key, { scope, controller });
        void (async () => {
          try {
            this.store.session(scope.workspaceId, scope.sessionId);
            const params = object(event.params);
            const question = text(params.question, "查询问题", Number.MAX_SAFE_INTEGER);
            if (Object.keys(params).some(key => key !== "question")) throw new AppError("INVALID_INPUT", "记忆查询仅接受question");
            const parentLease = this.runs.lease(scope, run.id);
            if (!parentLease) throw new AppError("AGENT_STOPPED", "父执行已经结束");
            const data = await this.memories.query(scope, question, controller.signal, parentLease, { runId: run.id, toolCallId: toolKey(run.id, event.callId) });
            if (!controller.signal.aborted) this.signal(scope, run.id, { type: "task-reply", key: event.key, ok: true, data });
          } catch (error) {
            this.signal(scope, run.id, { type: "task-reply", key: event.key, ok: false, error: errorMessage(error, "记忆查询失败") });
          } finally { this.memoryQueries.delete(event.key); }
        })();
      }
      this.externalEvent?.(scope, run, event);
    };
    this.runs.onSettled = (scope, run) => {
      this.titles.request(scope, run, true);
      this.reloads.settled(scope, run.id);
      for (const query of this.memoryQueries.values()) if (query.scope.sessionId === scope.sessionId) query.controller.abort();
      this.compressions.settled(scope, run.id);
      // Agent 工具可直接写入记忆目录；结算后定向刷新而不阻塞后续 HTTP/WS 事件。
      this.memories.refresh(scope);
      this.externalSettled?.(scope, run);
      this.continuations.settled(scope, run);
    };
    // Runtime snapshots belong to the data root protected by Store's service lock.
    // The shared pi directory may be in use by other services, including tests.
    const snapshots = join(store.root, "run-models");
    mkdirSync(snapshots, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(snapshots))
      if (/^run-[0-9a-f-]+\.json$/.test(name))
        rmSync(join(snapshots, name), { force: true });
  }
  async command(
    c: Command,
    internal: {
      task?: WorkerInput["task"];
      prompt?: string;
      notification?: WorkerInput["notification"];
      memoryContinuation?: { expectedRunId: string; validate: () => void };
      compressionPreparation?: { id: string; validate: () => void; signal: AbortSignal };
      admission?: { turn: TaskAdmissionTurn; reserve: () => TaskAdmissionTurn };
      beforeStart?: () => void;
      onCommit?: (run: Run) => void;
      onStart?: (run: Run) => void;
    } = {},
  ) {
    const requestStartedAtMonoMs = performance.now();
    let ownStart: PendingStart | undefined;
    let continuationRunId: string | undefined;
    let cancelPreparation: (() => void) | undefined;
    let admission = internal.admission?.turn;
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! },
      p = object(c.params ?? {});
    this.owner(scope);
    if (c.op === "agent.environment") {
      if (Object.keys(p).length) throw new AppError("INVALID_INPUT", "环境读取不接受额外参数。");
      const current = this.info(scope);
      if (current.environment || current.task) return current.environment;
      const plan = await this.capabilities.prepare(scope);
      const preview = await previewEnvironment({ root: this.store.root, cwd: this.store.workspace(scope.workspaceId).path,
        capabilities: plan.runtime, memoryPath: join(memoryDirectory(this.store.root, scope.sessionId), "MEMORY.md"),
        memoryTopics: this.memories.topicSnapshot(scope.workspaceId) });
      // Never overwrite a runtime snapshot or bind a transcript. Revalidate the
      // owner and preference revisions after asynchronous resource discovery.
      const latest = this.info(scope);
      if (latest.environment) return latest.environment;
      if (this.capabilities.state(scope).revision !== plan.revision || this.capabilities.preferences().revision !== plan.preferencesRevision)
        throw new AppError("REVISION_CONFLICT", "环境配置已改变，请重新加载预览。");
      return preview;
    }
    if (c.op === "agent.reload" || c.op === "agent.skills") return this.reloads.command(c);
    if (["prompt", "agent.resume", "agent.model"].includes(c.op) && this.reloads.active(scope))
      throw new AppError("RELOAD_BUSY", "会话正在重载，请等待完成后操作。");
    const rewrite = p.rewrite === undefined ? undefined : rewriteTarget(p.rewrite);
    if (rewrite && c.op !== "prompt") throw new AppError("INVALID_INPUT", "仅消息重发可以回滚对话。");
    if (c.op === "agent.fork") return this.serialCommand(scope, async () => forkSession(this, c));
    if (c.op === "agent.editable") {
      if (Object.keys(p).some((key) => key !== "messageId")) throw new AppError("INVALID_INPUT", "消息读取参数无效");
      return this.editable(scope, text(p.messageId, "消息标识"));
    }
    const resuming = c.op === "agent.resume";
    if (resuming && (typeof p.expectedRunId !== "string" || Object.keys(p).some((key) => key !== "expectedRunId")))
      throw new AppError("INVALID_INPUT", "重试只接受原执行标识。");
    let epoch = this.runs.epoch(scope);
    if (c.op === "agent.inputs") {
      if (!Array.isArray(p.ids) || p.ids.length > 128 || p.ids.some((id) => typeof id !== "string" || id.length > 200))
        throw new AppError("INVALID_INPUT", "输入查询最多接受 128 个标识");
      const ids = new Set(p.ids as string[]);
      const consumed = new Set<string>();
      const row = this.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
      if (row?.file) {
        // Read durable identities across all branches, including compacted inputs.
        // A mutable SessionManager cache is not proof that a record reached disk.
        for (const id of new PersistedInputCursor().read(String(row.file)).ids)
          if (ids.has(id)) consumed.add(id);
      }
      const active = this.active(scope);
      const child = this.store.db.prepare("SELECT 1 FROM tasks WHERE workspaceId=? AND sessionId=?").get(scope.workspaceId, scope.sessionId);
      const inputReceipts = new Map((child ? this.store.db.prepare(`SELECT r.inputId,r.state,r.error,r.runId FROM task_input_receipts r
        JOIN tasks t ON t.id=r.taskId WHERE t.workspaceId=? AND t.sessionId=?`).all(scope.workspaceId, scope.sessionId) : [])
        .map((receipt) => [String(receipt.inputId), receipt]));
      return [...ids].map((id) => {
        const taskReceipt = inputReceipts.get(id);
        const receipt = this.store.receipt(id, scope);
        return { id, consumed: consumed.has(id) || taskReceipt?.state === "delivered", active,
          queued: this.views.queues.get(scope.sessionId)?.some((item) => item.id === id) ?? false,
          receipt: taskReceipt?.state === "unknown" ? { status: "uncertain", data: { message: taskReceipt.error } }
            : taskReceipt?.state === "failed" ? { status: "failed", data: { message: taskReceipt.error } } : receipt };
      });
    }
    if (c.op === "agent.history.index") {
      if (Object.keys(p).length) throw new AppError("INVALID_INPUT", "历史索引不接受额外参数");
      return this.views.historyIndex(scope);
    }
    if (c.op === "agent.history.read") {
      if (Object.keys(p).some(key => !["segmentId", "groupId"].includes(key))) throw new AppError("INVALID_INPUT", "历史读取参数无效");
      return this.views.historyRead(scope, text(p.segmentId, "压缩点标识"), p.groupId === undefined ? undefined : text(p.groupId, "分组标识"));
    }
    if (c.op === "agent.original") {
      if (Object.keys(p).length) throw new AppError("INVALID_INPUT", "原始会话读取不接受额外参数");
      return [...this.views.original(scope).values()].map(boundedMessage);
    }
    if (c.op === "message.part")
      return messagePart(this.message(scope, text(p.id, "消息标识"), true), p);
    if (c.op === "message.get")
      return this.message(scope, text(p.id, "消息标识"), true);
    if (c.op === "message.image") {
      if (Object.keys(p).some((key) => !["messageId", "imageId"].includes(key)) ||
        typeof p.imageId !== "string" || !/^(?:img|imag)[1-9]\d{0,8}$/.test(p.imageId))
        throw new AppError("INVALID_INPUT", "图片预览仅接受消息标识与图片编号");
      return this.views.image(scope, text(p.messageId, "消息标识"), p.imageId);
    }
    if (c.op === "agent.recall") {
      if (Object.keys(p).length) throw new AppError("INVALID_INPUT", "撤回不接受额外参数");
      return this.store.external(c, () => this.runs.recall(scope));
    }
    if (!["prompt", "agent.resume", "agent.model", "agent.stop"].includes(c.op))
      throw new AppError("UNKNOWN_OPERATION", "不支持的 Agent 操作");
    if (c.op === "agent.stop")
      return this.store.external(c, async () => {
        if (p.runId !== this.info(scope).run?.id)
          throw new AppError(
            "RUN_MISMATCH",
            "执行已变化；未停止其他执行，请重新读取。",
          );
        await this.stop(scope);
        return this.info(scope);
      });
    const validate = () => {
      this.owner(scope);
      if (this.reloads.active(scope)) throw new AppError("RELOAD_BUSY", "会话正在重载，请等待完成后操作。");
      if (c.op === "prompt" || resuming) {
        if (!this.store.workspace(scope.workspaceId).authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
        this.runs.assertEpoch(scope, epoch);
        if (internal.memoryContinuation) {
          this.assertMemoryContinuation(scope, internal.memoryContinuation.expectedRunId, ownStart);
          internal.memoryContinuation.validate();
        } else this.assertContinuation(scope, p.expectedRunId, resuming && !!internal.task, ownStart);
        internal.compressionPreparation?.validate();
      }
      if (this.runs.closing) throw new AppError("SHUTTING_DOWN", "服务正在退出，未接受新操作");
      if (rewrite) this.assertRewriteIdle(scope, internal.task?.inputIds, ownStart);
    };
    const enqueue = async () => {
      internal.beforeStart?.();
      if (internal.notification) {
        const items = internal.notification.items ?? [internal.notification];
        const run = this.info(scope).run;
        if (!run || run.status !== "running" || !this.runs.signal(scope, run.id, {
          type: "input", id: items[0].id, text: items[0].content, notification: true, notifications: items, mode: "steer",
        })) throw new AppError("NOTIFICATION_NOT_SENT", "通知未发送到父执行");
        return { runId: run.id, status: "queued" };
      }
      const images = imagesInput(p.images);
      const attachments = attachmentsInput(p.attachments, p.attachment, images.length);
      const skills = skillsInput(p.skills);
      const body = text(p.text || (attachments.length || images.length ? "请检查附件。" : skills.length ? "请使用所选技能。" : ""), "消息", 12000);
      const mode = p.mode ?? "steer";
      if (mode !== "steer" && mode !== "followUp") throw new AppError("INVALID_INPUT", "追问方式无效");
      const draft: Draft = { text: typeof p.text === "string" ? p.text : "", attachment: null, attachments, images, skills };
      return this.runs.enqueue(scope, c.requestId, draft, imagePrompt(attachmentPrompt(body, attachments), images), mode);
    };
    return this.store.external(c, async () => {
      // First-time user work takes priority before the session queue, but a replay has no side effects.
      if (["prompt", "agent.resume"].includes(c.op) && !internal.notification && !internal.memoryContinuation && !internal.compressionPreparation) {
        this.continuations.cancel(scope, true);
        const pending = this.starts.get(scope.sessionId);
        if (pending?.automatic) pending.controller.abort();
        const stopped = this.runs.preemptAutomatic(scope);
        if (stopped) {
          // The shared preemption increments synchronously. A later user stop still invalidates this command.
          epoch = this.runs.epoch(scope);
          await stopped;
        }
      }
      return this.serialCommand(scope, async () => {
      validate();
      if (c.op === "prompt" && this.runs.active(scope)) {
        if (internal.compressionPreparation) throw new AppError("AGENT_BUSY", "会话已开始执行，由活动会话维护记忆。");
        return enqueue();
      }
      if (c.op !== "agent.model") {
        let finish!: () => void;
        const done = new Promise<void>(resolve => { finish = resolve; });
        ownStart = { scope, automatic: !!(internal.memoryContinuation || internal.compressionPreparation), controller: new AbortController(), provider: this.info(scope).selection?.provider, done, finish };
        this.starts.set(scope.sessionId, ownStart);
        if (internal.compressionPreparation) {
          const controller = ownStart.controller;
          cancelPreparation = () => controller.abort();
          internal.compressionPreparation.signal.addEventListener("abort", cancelPreparation, { once: true });
        }
      }
      try {
      if (rewrite) {
        await this.releaseIdle(scope);
        validate();
      }
      for (let attempt = 0; ; attempt++) {
      const prepared = await this.models.serial(async () => {
        validate();
        // A cold command may become an append while waiting for configuration.
        if (c.op === "prompt" && this.runs.active(scope)) {
          if (internal.compressionPreparation) throw new AppError("AGENT_BUSY", "会话已开始执行，由活动会话维护记忆。");
          return { completion: enqueue() };
        }
        const config = await configuration(this.store.root);
        if (config.error) throw new AppError("INVALID_CONFIG", config.error);
        const selection =
          c.op === "agent.model"
            ? (object(p.selection) as unknown as Selection)
            : this.info(scope).selection;
        if (
          selection &&
          (Object.keys(selection).some(
            (k) => !["provider", "id", "thinking"].includes(k),
          ) ||
            typeof selection.provider !== "string" ||
            typeof selection.id !== "string")
        )
          throw new AppError("INVALID_INPUT", "模型选择无效");
        const model =
          selection &&
          config.available.find(
            (m) => m.provider === selection.provider && m.id === selection.id,
          );
        if (!model || !model.levels.includes(selection!.thinking))
          throw new AppError(
            "MODEL_UNAVAILABLE",
            "请先选择已配置、已认证的模型及其支持的思考等级；不会自动替换模型。",
          );
        if (c.op === "agent.model") {
          const saved = JSON.stringify(selection);
          this.store.db.exec("BEGIN IMMEDIATE");
          try {
            this.store.db
              .prepare(
                "INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET selection=excluded.selection",
              )
              .run(scope.sessionId, saved);
            // Child sessions keep their independent model and never change the main-session default.
            if (
              !this.store.db
                .prepare("SELECT 1 FROM tasks WHERE sessionId=?")
                .get(scope.sessionId)
            )
              this.store.db
                .prepare(
                  "INSERT INTO agent_preferences(id,selection) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET selection=excluded.selection",
                )
                .run(saved);
            this.store.db.exec("COMMIT");
          } catch (error) {
            this.store.db.exec("ROLLBACK");
            throw error;
          }
          this.changed(scope);
          return { completion: Promise.resolve(this.info(scope)) };
        }
        if (c.op !== "prompt" && !resuming)
          throw new AppError("UNKNOWN_OPERATION", "不支持的 Agent 操作");
        if (this.runs.active(scope) || running(this.info(scope).run))
          throw new AppError(
            "AGENT_BUSY",
            "该会话已有执行；请等待结束或明确停止",
          );
        const images = imagesInput(p.images);
        const attachments = attachmentsInput(p.attachments, p.attachment, images.length);
        requireImageModel(model, images);
        const skills = skillsInput(p.skills);
        const prompt = resuming || internal.memoryContinuation || internal.compressionPreparation ? "" : text(p.text || (attachments.length || images.length ? "请检查附件。" : skills.length ? "请使用所选技能。" : ""), "消息", 12000);
        const content = imagePrompt(
          internal.prompt ?? attachmentPrompt(prompt, attachments), images);
        const capabilities = internal.task ? undefined : await this.capabilities.prepare(scope);
        const cwd = this.store.workspace(scope.workspaceId).path;
        const id = randomUUID();
        const modelsFile = join(this.store.root, "run-models", `run-${id}.json`);
        let file: string;
        let rewriteStarted = false;
        // No worker receives this input until all local preparation succeeds.
        try {
          const row = this.store.db
            .prepare("SELECT file FROM agent_sessions WHERE sessionId=?")
            .get(scope.sessionId);
          file = row?.file as string;
          if (!file && (resuming || internal.memoryContinuation || internal.compressionPreparation))
            throw new AppError("NO_CONTINUATION", "没有已保存的会话记录，请输入新的要求。");
          if (!file) {
            const dir = join(this.store.root, "sessions", scope.workspaceId);
            mkdirSync(dir, { recursive: true, mode: 0o700 });
            const manager = SessionManager.create(cwd, dir);
            file = manager.getSessionFile()!;
            writeFileSync(file, JSON.stringify(manager.getHeader()) + "\n", {
              flag: "wx",
              mode: 0o600,
            });
            this.store.db
              .prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file")
              .run(scope.sessionId, file);
          }
          const manager = openTranscript(file, cwd);
          if (rewrite) assertRewrite(manager, rewrite);
          // Memory is optional and updates independently; prompt admission must not
          // wait for a scan or depend on the source being readable.
          const raw = await this.models.raw();
          if (createHash("sha256").update(raw).digest("hex") !== config.revision)
            throw new AppError(
              "REVISION_CONFLICT",
              "模型配置在发送前改变；未执行，请重新确认。",
            );
          validate();
          writeFileSync(modelsFile, raw, { flag: "wx", mode: 0o600 });
        } catch (error) {
          try { rmSync(modelsFile, { force: true }); } catch { /* Startup cleans orphaned snapshots. */ }
          if (error instanceof AppError) throw error;
          // Preparation has not dispatched this input. Keep that evidence distinct
          // from transport failures, which may already have reached the worker.
          throw new AppError("PROMPT_PREPARATION_FAILED",
            `消息未发送：${errorMessage(error, "准备会话或模型配置失败。")}`);
        }
        return { start: { cwd, file, modelsFile, capabilities, selection: selection!,
          onBindingRejected: (rejection: unknown) => this.store.rejectBinding(id, rejection), commit: (lease: ExecutionLease) => {
          validate();
          if (ownStart?.controller.signal.aborted || !this.pool.isActive(lease.ref)) throw new AppError("AGENT_STOPPED", "启动期间会话已停止；未发送请求。");
          internal.beforeStart?.();
          try {
          if (rewrite) {
            this.assertRewriteIdle(scope, internal.task?.inputIds, ownStart);
            // Reopen after async preparation; never write through a stale tree instance.
            const current = openTranscript(file, cwd);
            const source = assertRewrite(current, rewrite);
            const branch = current.getBranch();
            const retainedResults = new Set(branch.slice(0, branch.findIndex((entry) => entry.id === source.entryId))
              .flatMap((entry) => entry.type === "custom_message" && entry.customType === "axiom-result" ? [(entry.details as any)?.axiomInput] : []));
            const discarded = this.store.db.prepare("SELECT r.id FROM task_results r JOIN tasks t ON t.id=r.taskId WHERE t.parentSessionId=?").all(scope.sessionId)
              .map((row) => String(row.id)).filter((id) => !retainedResults.has(id));
            rewriteStarted = true;
            rewriteBranch(current, rewrite, c.requestId, discarded);
            for (const resultId of discarded)
              this.store.db.prepare("UPDATE task_results SET delivery='discarded' WHERE id=?").run(resultId);
            this.store.db.prepare("UPDATE task_notification_attempts SET state='discarded' WHERE sessionId=? AND state!='delivered'").run(scope.sessionId);
            this.views.settled(scope);
            this.views.refresh(scope);
          }
        } catch (error) {
          try { rmSync(modelsFile, { force: true }); } catch { /* Startup cleans orphaned snapshots. */ }
          if (rewriteStarted) throw new AppError("UNCERTAIN", "会话回滚结果待确认；请读取当前对话和原回执，不要重复发送。");
          if (error instanceof AppError) throw error;
          throw new AppError("PROMPT_PREPARATION_FAILED",
            `消息未发送：${errorMessage(error, "准备会话或模型配置失败。")}`);
        }
        this.views.messages.delete(scope.sessionId);
        const run: Run = {
          id,
          sessionId: scope.sessionId,
          status: "starting",
          selection: selection!,
          startedAt: Date.now(),
          endedAt: null,
          error: null,
          phase: "initializing",
          resumedFromRunId: internal.memoryContinuation?.expectedRunId ?? (typeof p.expectedRunId === "string" ? p.expectedRunId : null),
          ...(!internal.task ? { origin: internal.notification ? "task_notification" as const
            : internal.memoryContinuation ? "memory_continuation" as const
            : internal.compressionPreparation ? "compression_preparation" as const
            : resuming ? "manual_resume" as const : undefined } : {}),
        };
        this.store.db.exec("BEGIN IMMEDIATE");
        try {
        if (capabilities) this.capabilities.lock(scope, capabilities);
        if (!internal.task) this.store.requestTitle(scope,
          internal.notification || resuming || internal.memoryContinuation || internal.compressionPreparation ? undefined : (typeof p.text === "string" && p.text.trim() ? p.text : images.length ? "[图片]" : prompt));
        this.store.db
          .prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,phase,resumedFromRunId,origin) VALUES(?,?,?,?,?,?,?,?)")
          .run(
            id,
            scope.sessionId,
            run.status,
            JSON.stringify(selection),
            run.startedAt,
            run.phase!,
            run.resumedFromRunId ?? null,
            run.origin ?? null,
          );
        // Task ownership/input handoff must commit with the run, not after it.
        internal.onCommit?.(run);
        // Atomically hand the recovery intention to this new durable run. A second
        // crash will recover the new run, never dispatch the original intention twice.
        this.store.recoveries.remove(scope.sessionId);
        this.store.db
          .prepare("UPDATE sessions SET updatedAt=?,autoPinUntil=NULL WHERE id=?")
          .run(run.startedAt, scope.sessionId);
        this.store.db.exec("COMMIT");
        } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
        if (!internal.task) this.titles.start(scope, run);
        if (capabilities) this.capabilities.changed(scope);
        this.publish(threadScope(scope), this.thread(scope));
        // Invoke now: launch installs pending synchronously before its first await.
        const completion = (async () => {
        let launching = false;
        try {
          launching = true;
          // Transfer synchronously: launch installs its stop/settle owner before onStart or ensureReady.
          this.starts.delete(scope.sessionId);
          ownStart!.lease = undefined;
          if (internal.memoryContinuation) continuationRunId = run.id;
          await this.runs.launch(scope, run, {
            root: this.store.root,
            cwd,
            file,
            modelsFile,
            capabilities: capabilities?.runtime,
            memoryTopics: internal.task ? undefined : this.memories.topicSnapshot(scope.workspaceId),
            memoryPath: internal.task ? undefined : join(memoryDirectory(this.store.root, scope.sessionId), "MEMORY.md"),
            runId: id,
            requestId: c.requestId,
            selection: selection!,
            prompt: content,
            resume: resuming,
            memoryContinuation: !!internal.memoryContinuation,
            compressionPreparation: internal.compressionPreparation?.id,
            rewrite: !!rewrite,
            images,
            skills,
            task: internal.task ? { ...internal.task, budget: internal.task.budget ? { ...internal.task.budget,
              deadlineAt: internal.task.budget.deadlineAt ?? run.startedAt + internal.task.budget.workMs } : undefined } : undefined,
            notification: internal.notification,
          }, lease, internal.onStart);
        } catch (error) {
          // launch owns process cleanup and settlement; a dispatch error may already
          // have reached the worker, so it must retain its UNCERTAIN classification.
          try { rmSync(modelsFile, { force: true }); } catch { /* Retry cleanup on service startup. */ }
          if ((error as AppError).code === "UNCERTAIN") {
            if (rewrite) throw new AppError("UNCERTAIN", "对话已回滚，新消息是否送达仍待确认；正在核对原回执，请勿重复发送。");
            throw error;
          }
          const cancelled = (error as AppError).code === "AGENT_STOPPED";
          const reason = errorMessage(error, "工作进程启动失败：未收到具体错误原因。");
          if (!launching) {
            run.status = cancelled ? "cancelled" : "failed";
            run.endedAt = Date.now();
            run.error = reason;
            this.store.finishRun(id, run.status, reason, cancelled ? "USER_STOPPED" : "WORKER_START_FAILED");
            this.changed(scope);
          }
          if (rewrite) throw new AppError("REWRITE_APPLIED_NOT_SENT", `对话已回滚，但新消息未发送；修改内容保留在原消息位置。${reason}`);
          if (cancelled) throw error;
          throw new AppError("WORKER_START_FAILED", reason);
        }
        this.changed(scope);
        return { runId: id, status: "accepted" };
        })();
        void completion.catch(() => {});
        return { completion };
        } } };
      }, ownStart?.controller.signal);
      if (prepared.completion) return prepared.completion;
      const start = prepared.start!;
      let environment: ReturnType<ExecutionProfiles["prepare"]> | undefined;
      let lease: ExecutionLease | undefined;
      let commitAttempted = false;
      try {
        // getAuth (unlike checkAuth) may persist a refreshed OAuth credential.
        // Finish that write before capturing the immutable binding revision.
        await this.models.serial(async () => {
          validate();
          await this.models.prepareAuth(start.selection, start.modelsFile, ownStart!.controller.signal);
          validate();
        }, ownStart!.controller.signal);
        validate();
        environment = await this.profiles.prepareAsync({ entry: "agent", cwd: start.cwd, modelDir: this.models.dir,
          modelsRaw: readFileSync(start.modelsFile, "utf8"), selection: start.selection, capabilities: start.capabilities?.runtime,
          mode: this.pool.mode }, ownStart!.controller.signal);
        if (admission) await admission.wait(ownStart!.controller.signal);
        const revision = fileRevision(start.file);
        validate();
        ownStart!.provider = start.selection.provider;
        const acquiring = this.pool.acquire({ environment, kind: "agent", bindingGate: true, requestStartedAtMonoMs,
          onBindingRejected: start.onBindingRejected,
          beforeExecute: internal.memoryContinuation ? () => {
            this.assertMemoryContinuation(scope, internal.memoryContinuation!.expectedRunId, ownStart, false, continuationRunId);
            internal.memoryContinuation!.validate();
          } : internal.compressionPreparation?.validate,
          affinity: { sessionId: scope.sessionId, fileRevision: revision }, signal: ownStart!.controller.signal });
        admission?.release();
        lease = await acquiring;
        ownStart!.lease = lease;
        // Full resource checks guard binding dispatch and execution_permit. Intermediate
        // admission still rechecks configuration and the JSONL owner outside the writer queue.
        if (!environment.current(false) || fileRevision(start.file) !== revision) {
          await this.pool.retire(lease.ref, "changed_during_admission"); ownStart!.lease = undefined;
          if (attempt >= 2) throw new AppError("REVISION_CONFLICT", "执行准备期间配置或会话持续变化；消息未发送。");
          // A rejected snapshot needs a new admission, not a bypass of later tickets.
          admission = internal.admission?.reserve();
          continue;
        }
        const launched = await this.models.serial(async () => {
          validate();
          const raw = await this.models.raw();
          validate();
          if (fileRevision(start.file) !== revision || createHash("sha256").update(raw).digest("hex") !== createHash("sha256").update(readFileSync(start.modelsFile)).digest("hex"))
            throw new AppError("REVISION_CONFLICT", "最终提交前配置或会话已变化；消息未发送。");
          commitAttempted = true;
          return start.commit(lease!);
        }, ownStart?.controller.signal);
        return await launched.completion;
      } catch (error) {
        if (commitAttempted || error instanceof AppError) throw error;
        throw new AppError("PROMPT_PREPARATION_FAILED",
          `消息未发送：${errorMessage(error, "准备执行环境失败。")}`);
      } finally {
        try {
          if (ownStart && ownStart.lease === lease && lease) {
            await this.pool.retire(lease.ref, "uncommitted");
            ownStart.lease = undefined;
          }
        } finally {
          // Cleanup cannot replace a committed/uncertain receipt or its original error.
          try { environment?.release(); } catch { /* Startup cleans orphaned snapshots. */ }
          try { rmSync(start.modelsFile, { force: true }); } catch { /* Startup retries deletion. */ }
        }
      }
      }
      } finally {
        admission?.release();
        if (cancelPreparation) internal.compressionPreparation?.signal.removeEventListener("abort", cancelPreparation);
        if (this.starts.get(scope.sessionId) === ownStart) this.starts.delete(scope.sessionId);
        ownStart?.finish();
      }
      });
    });
  }
  async remove(c: Command, deletionPosition?: SessionRestorePosition) {
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! };
    if (c.params?.confirmed !== true)
      throw new AppError(
        "CONFIRMATION_REQUIRED",
        "删除需要确认；活动执行将先停止，项目文件不会删除。",
      );
    if (this.store.receipt(c.requestId).status === "committed")
      return this.store.execute(c);
    const position = deletionPosition ?? this.store.session(scope.workspaceId, scope.sessionId);
    await this.stop(scope);
    const result = this.store.execute(c, position);
    this.views.forget(scope);
    return result;
  }
}
