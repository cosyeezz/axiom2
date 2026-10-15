import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "./storage.js";
import { ModelService } from "./model-service.js";
import { configuration } from "./models.js";
import { boundedMessage, openTranscript } from "./transcript.js";
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
import { Compressions } from "./compressions.js";
import { imagesInput, imagePrompt, requireImageModel, contextImages } from "./images.js";
import { canContinue } from "../shared/session-state.js";
import { errorMessage } from "./error-message.js";
export class Agents {
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
  messages(scope: Scope) {
    return [...this.views.transcript(scope).values()].map((message) => this.views.message(scope, message.id));
  }
  message(scope: Scope, id: string, full = false) {
    return this.views.message(scope, id, full);
  }
  refresh(scope: Scope) {
    this.views.refresh(scope);
  }
  active(scope: Scope) {
    return this.runs.active(scope);
  }
  assertContinuation(scope: Scope, expectedRunId: unknown, queuedTask = false) {
    if (expectedRunId === undefined) return;
    const info = this.info(scope);
    if (text(expectedRunId, "原执行标识") !== info.run?.id || !canContinue(info.run) ||
        this.active(scope) || info.activeTaskCount || (!queuedTask && info.task?.status === "queued"))
      throw new AppError("RUN_MISMATCH", "原执行已变化或仍有活动任务；未将继续处理注入其他执行，请重新读取。");
  }
  hasIdle(scope: Scope) { return this.runs.hasIdle(scope); }
  releaseIdle(scope: Scope) { return this.runs.releaseIdle(scope); }
  signal(scope: Scope, id: string, value: Record<string, unknown>) {
    return this.runs.signal(scope, id, value);
  }
  recallIds(scope: Scope, ids: string[]) {
    return this.runs.recallIds(scope, ids);
  }
  setQueue(scope: Scope, queue: NonNullable<import("../shared/agent.js").AgentInfo["queue"]>) {
    this.owner(scope);
    this.views.queues.set(scope.sessionId, queue);
    this.changed(scope);
  }
  async stop(scope: Scope, source: StopSource = "user") {
    await Promise.all([
      this.runs.stop(scope, source),
      this.compressions.stop(scope),
    ]);
  }
  affected(providers: string[]) {
    return this.runs.affected(providers);
  }
  async stopProviders(providers: string[], confirmed: boolean) {
    await this.compressions.stopProviders(providers, confirmed);
    return this.runs.stopProviders(providers, confirmed);
  }
  async close() {
    await Promise.all([this.runs.close(), this.compressions.close()]);
  }
  constructor(
    readonly store: Store,
    readonly models: ModelService,
    readonly publish: (scope: string, data?: unknown) => void,
  ) {
    this.views = new AgentViews(store, publish);
    this.runs = new AgentRuns(store, this.views, publish);
    this.compressions = new Compressions(this);
    this.runs.onEvent = (scope, run, event) => {
      this.compressions.event(scope, run.id, event);
      this.externalEvent?.(scope, run, event);
    };
    this.runs.onSettled = (scope, run) => {
      this.compressions.settled(scope, run.id);
      this.externalSettled?.(scope, run);
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
      beforeStart?: () => void;
      onStart?: (run: Run) => void;
    } = {},
  ) {
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! },
      p = object(c.params ?? {});
    this.owner(scope);
    const resuming = c.op === "agent.resume";
    if (resuming && (typeof p.expectedRunId !== "string" || Object.keys(p).some((key) => key !== "expectedRunId")))
      throw new AppError("INVALID_INPUT", "重试只接受原执行标识。");
    const epoch = this.runs.epoch(scope);
    if (c.op === "agent.inputs") {
      if (!Array.isArray(p.ids) || p.ids.length > 128 || p.ids.some((id) => typeof id !== "string" || id.length > 200))
        throw new AppError("INVALID_INPUT", "输入查询最多接受 128 个标识");
      const ids = new Set(p.ids as string[]);
      const consumed = new Set<string>();
      const row = this.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
      if (row?.file) {
        // Identity only: no hidden pre-compaction message bodies leave the server.
        for (const entry of openTranscript(String(row.file), this.store.workspace(scope.workspaceId).path).getBranch()) {
          const value = entry as any;
          for (const id of value.message?.axiomInputIds ?? []) if (ids.has(id)) consumed.add(id);
          if (ids.has(value.details?.axiomInput)) consumed.add(value.details.axiomInput);
        }
      }
      const active = this.active(scope);
      return [...ids].map((id) => ({ id, consumed: consumed.has(id), active,
        queued: this.views.queues.get(scope.sessionId)?.some((item) => item.id === id) ?? false,
        receipt: this.store.receipt(id, scope) }));
    }
    if (c.op === "agent.original") {
      if (Object.keys(p).length) throw new AppError("INVALID_INPUT", "原始会话读取不接受额外参数");
      return [...this.views.original(scope).values()].map(boundedMessage);
    }
    if (c.op === "message.get")
      return this.message(scope, text(p.id, "消息标识"), true);
    if (c.op === "message.image") {
      if (Object.keys(p).some((key) => !["messageId", "imageId"].includes(key)) ||
        typeof p.imageId !== "string" || !/^imag[1-9]\d{0,8}$/.test(p.imageId))
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
    return this.models.serial(() =>
      this.store.external(c, async () => {
        this.owner(scope);
        if (c.op === "prompt" || resuming) {
          this.runs.assertEpoch(scope, epoch);
          this.assertContinuation(scope, p.expectedRunId, resuming && !!internal.task);
        }
        if (this.runs.closing)
          throw new AppError("SHUTTING_DOWN", "服务正在退出，未接受新操作");
        if (c.op === "prompt" && this.runs.active(scope)) {
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
          const body = text(p.text || (attachments.length || images.length ? "请检查附件。" : ""), "消息", 12000);
          const mode = p.mode ?? "steer";
          if (mode !== "steer" && mode !== "followUp") throw new AppError("INVALID_INPUT", "追问方式无效");
          // The worker validates images against its frozen running model, not the next selection.
          const draft: Draft = { text: typeof p.text === "string" ? p.text : "", attachment: null, attachments, images };
          return this.runs.enqueue(scope, c.requestId, draft,
            imagePrompt(attachmentPrompt(body, attachments), images), mode);
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
          return this.info(scope);
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
        const prompt = resuming ? "" : text(p.text || (attachments.length || images.length ? "请检查附件。" : ""), "消息", 12000);
        const content = imagePrompt(
          internal.prompt ?? attachmentPrompt(prompt, attachments), images);
        const cwd = this.store.workspace(scope.workspaceId).path;
        const id = randomUUID();
        const modelsFile = join(this.store.root, "run-models", `run-${id}.json`);
        let file: string;
        // No worker receives this input until all local preparation succeeds.
        try {
          const row = this.store.db
            .prepare("SELECT file FROM agent_sessions WHERE sessionId=?")
            .get(scope.sessionId);
          file = row?.file as string;
          if (!file && resuming)
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
          requireImageModel(model, contextImages(manager.buildSessionContext().messages));
          const raw = await this.models.raw();
          if (createHash("sha256").update(raw).digest("hex") !== config.revision)
            throw new AppError(
              "REVISION_CONFLICT",
              "模型配置在发送前改变；未执行，请重新确认。",
            );
          this.runs.assertEpoch(scope, epoch);
          this.assertContinuation(scope, p.expectedRunId, resuming && !!internal.task);
          internal.beforeStart?.();
          writeFileSync(modelsFile, raw, { flag: "wx", mode: 0o600 });
        } catch (error) {
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
          resumedFromRunId: typeof p.expectedRunId === "string" ? p.expectedRunId : null,
        };
        const requestTitle = !internal.task && this.store.requestTitle(scope,
          internal.notification || resuming ? undefined : (typeof p.text === "string" && p.text.trim() ? p.text : images.length ? "[图片]" : prompt));
        this.store.db
          .prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,phase,resumedFromRunId) VALUES(?,?,?,?,?,?,?)")
          .run(
            id,
            scope.sessionId,
            run.status,
            JSON.stringify(selection),
            run.startedAt,
            run.phase!,
            run.resumedFromRunId ?? null,
          );
        this.store.db
          .prepare("UPDATE sessions SET updatedAt=?,autoPinUntil=NULL WHERE id=?")
          .run(run.startedAt, scope.sessionId);
        this.publish(threadScope(scope), this.thread(scope));
        let launching = false;
        try {
          internal.onStart?.(run);
          launching = true;
          await this.runs.launch(scope, run, {
            root: this.store.root,
            cwd,
            file,
            modelsFile,
            runId: id,
            requestId: c.requestId,
            selection: selection!,
            prompt: content,
            resume: resuming,
            requestTitle,
            images,
            task: internal.task ? { ...internal.task, budget: internal.task.budget ? { ...internal.task.budget,
              deadlineAt: run.startedAt + internal.task.budget.workMs } : undefined } : undefined,
            notification: internal.notification,
          });
        } catch (error) {
          // launch owns process cleanup and settlement; a dispatch error may already
          // have reached the worker, so it must retain its UNCERTAIN classification.
          try { rmSync(modelsFile, { force: true }); } catch { /* Retry cleanup on service startup. */ }
          if ((error as AppError).code === "UNCERTAIN") throw error;
          const cancelled = (error as AppError).code === "AGENT_STOPPED";
          const reason = errorMessage(error, "工作进程启动失败：未收到具体错误原因。");
          if (!launching) {
            run.status = cancelled ? "cancelled" : "failed";
            run.endedAt = Date.now();
            run.error = reason;
            this.store.finishRun(id, run.status, reason, cancelled ? "USER_STOPPED" : "WORKER_START_FAILED");
            this.changed(scope);
          }
          if (cancelled) throw error;
          throw new AppError("WORKER_START_FAILED", reason);
        }
        this.changed(scope);
        return { runId: id, status: "accepted" };
      }),
    );
  }
  async remove(c: Command) {
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! };
    if (c.params?.confirmed !== true)
      throw new AppError(
        "CONFIRMATION_REQUIRED",
        "删除需要确认；活动执行将先停止，项目文件不会删除。",
      );
    if (this.store.receipt(c.requestId).status === "committed")
      return this.store.execute(c);
    await this.stop(scope);
    const result = this.store.execute(c);
    this.views.messages.delete(scope.sessionId);
    return result;
  }
}
