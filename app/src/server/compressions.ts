import { type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { ExecutionLease } from "./execution-pool.js";
import { sameLease } from "./execution-protocol.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens, type CompactionEntry } from "@earendil-works/pi-coding-agent";
import { AppError, object, text, type Command, type Configuration, type Scope } from "../shared/protocol.js";
import { agentScope, type Selection } from "../shared/agent.js";
import { autoCompressionThreshold, compressionScope, compressionPreferencesScope, type Compression } from "../shared/compression.js";
import type { Agents } from "./agents.js";
import { configuration } from "./models.js";
import { openTranscript } from "./transcript.js";
import { contextUsage } from "./context-usage.js";
import type { CompressionInput } from "./compression-worker.js";
import { compressionError } from "./compression-error.js";
import { captureCompression, applyCompression, type CompressionSnapshot } from "./compression-context.js";

type Live = {
  scope: Scope;
  job: Compression;
  input: CompressionInput;
  controller: AbortController;
  requestStartedAtMonoMs: number;
  lease?: ExecutionLease;
  child?: ChildProcess;
  exit?: Promise<void>;
  cancel: boolean;
  closed: boolean;
  snapshot?: CompressionSnapshot;
  entry?: CompactionEntry;
  applyRun?: string;
  cancelAck?: () => void;
  cancelConfirmedRun?: string;
};
// The live worker is the sole writer while running. The server writes only while
// no worker owns this session, without yielding between ownership check and append.
export class Compressions {
  private live = new Map<string, Live>();
  private epochs = new Map<string, number>();
  private automatic = new Map<string, { runId: string; attempted: boolean; stopped: boolean }>();
  private autoPending = new Set<string>();
  private autoWork = new Set<Promise<unknown>>();
  private closing = false;
  private readonly directory: string;
  private readonly store;
  constructor(private readonly agents: Agents) {
    this.store = agents.store;
    this.directory = join(this.store.root, "compression-snapshots");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.store.db.exec("CREATE TABLE IF NOT EXISTS compressions(id TEXT PRIMARY KEY,sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,body TEXT NOT NULL)");
    for (const row of this.store.db.prepare("SELECT id,sessionId,body FROM compressions").all()) {
      const job: Compression = JSON.parse(String(row.body));
      if (job.state === "running" || (job.state === "completed" && !job.appliedAt)) {
        // Older completed jobs were preview-only. Never relabel those as applied.
        // A crash can occur after the append but before its IPC/database receipt.
        const session = this.store.db.prepare("SELECT workspaceId FROM sessions WHERE id=?").get(row.sessionId);
        const scope = session && { workspaceId: String(session.workspaceId), sessionId: String(row.sessionId) };
        const applied = scope && this.applied(scope, job.id);
        job.state = applied ? "completed" : "interrupted";
        job.phase = applied ? "done" : job.phase;
        job.endedAt = Date.now();
        if (applied) job.appliedAt = Date.now();
        job.error = applied ? null : "没有此摘要已应用的持久记录；未自动重新压缩或应用历史摘要。";
        this.store.db.prepare("UPDATE compressions SET body=? WHERE id=?").run(JSON.stringify(job), row.id);
      }
    }
    for (const name of readdirSync(this.directory))
      if (/^[0-9a-f-]+\.(json|jsonl)$/.test(name)) rmSync(join(this.directory, name), { force: true });
  }
  private manager(scope: Scope) {
    const row = this.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
    if (!row?.file) throw new AppError("COMPRESSION_EMPTY", "此会话尚无已保存消息可压缩");
    return openTranscript(String(row.file), this.store.workspace(scope.workspaceId).path);
  }
  private applied(scope: Scope, id: string) {
    try {
      return this.manager(scope).getBranch().some((e) => e.type === "compaction" && (e.details as any)?.axiomCompressionId === id);
    } catch { return false; }
  }
  info(scope: Scope): Compression | null {
    this.store.session(scope.workspaceId, scope.sessionId);
    const row = this.store.db.prepare("SELECT body FROM compressions WHERE sessionId=? ORDER BY rowid DESC LIMIT 1").get(scope.sessionId);
    return row ? JSON.parse(String(row.body)) : null;
  }
  private save(live: Pick<Live, "scope" | "job">) {
    this.store.db.prepare("UPDATE compressions SET body=? WHERE id=? AND sessionId=?")
      .run(JSON.stringify(live.job), live.job.id, live.scope.sessionId);
    this.agents.publish(compressionScope(live.scope), live.job);
  }
  private selection(value: unknown, config: Configuration): Selection {
    const selection = object(value);
    if (Object.keys(selection).some((key) => !["provider", "id", "thinking"].includes(key)) ||
      typeof selection.provider !== "string" || typeof selection.id !== "string")
      throw new AppError("INVALID_INPUT", "模型选择无效");
    const model = !config.error && config.available.find((m) => m.provider === selection.provider && m.id === selection.id);
    if (!model || !model.levels.includes(selection.thinking as Selection["thinking"]))
      throw new AppError("MODEL_UNAVAILABLE", "请选择已配置、已认证的压缩模型及其支持的思考等级；不会自动替换模型。");
    return { provider: selection.provider, id: selection.id, thinking: selection.thinking as Selection["thinking"] };
  }
  command(c: Command): Promise<unknown> {
    if (c.op === "compression.preferences.get") return Promise.resolve(this.store.compressionPreferences());
    if (c.op === "compression.preferences.save") return this.store.external(c, () => this.agents.models.serial(async () => {
      if (this.closing) throw new AppError("SHUTTING_DOWN", "服务正在退出，未接受新操作");
      const params = object(c.params);
      if (!Object.keys(params).length || Object.keys(params).some((key) => !["selection", "auto"].includes(key)))
        throw new AppError("INVALID_INPUT", "压缩偏好无效");
      const current = this.store.compressionPreferences();
      const auto = { ...current.auto };
      if (Object.hasOwn(params, "auto")) {
        const patch = object(params.auto);
        if (!Object.keys(patch).length || Object.keys(patch).some((key) => !["enabled", "tokens", "percent"].includes(key)))
          throw new AppError("INVALID_INPUT", "自动压缩设置无效");
        if (Object.hasOwn(patch, "enabled")) {
          if (typeof patch.enabled !== "boolean") throw new AppError("INVALID_INPUT", "自动压缩开关必须为布尔值");
          auto.enabled = patch.enabled;
        }
        for (const key of ["tokens", "percent"] as const) if (Object.hasOwn(patch, key)) {
          const value = patch[key];
          const max = key === "percent" ? 100 : Number.MAX_SAFE_INTEGER;
          if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max)
            throw new AppError("INVALID_INPUT", key === "percent" ? "百分比须为 1–100 的整数" : "Token 阈值须为正安全整数");
          auto[key] = value;
        }
      }
      const selection = !Object.hasOwn(params, "selection") ? current.selection
        : params.selection === null ? null : this.selection(params.selection, await configuration(this.store.root));
      const preferences = this.store.saveCompressionPreferences({ selection, auto });
      this.agents.publish(compressionPreferencesScope, preferences);
      return preferences;
    }));
    const scope = { workspaceId: text(c.workspaceId, "工作空间"), sessionId: text(c.sessionId, "会话") };
    this.store.session(scope.workspaceId, scope.sessionId);
    if (c.op === "compression.get") return Promise.resolve(this.info(scope));
    if (c.op === "compression.cancel") return this.store.external(c, async () => {
      if (this.info(scope)?.id !== text(c.params?.id, "压缩任务"))
        throw new AppError("COMPRESSION_SCOPE", "压缩任务已变化或不属于此会话");
      await this.stop(scope);
      return this.info(scope);
    });
    if (c.op !== "compression.start") return Promise.reject(new AppError("UNKNOWN_OPERATION", "不支持的压缩操作"));
    return this.start(c, scope);
  }
  private start(c: Command, scope: Scope, autoRunId?: string): Promise<unknown> {
    const epoch = this.epochs.get(scope.sessionId) ?? 0;
    return this.store.external(c, () => this.agents.models.serial(async () => {
      this.store.session(scope.workspaceId, scope.sessionId);
      const check = () => {
        if (this.agents.reloads.active(scope)) throw new AppError("COMPRESSION_BUSY", "会话正在重载，请等待完成后压缩。");
        if (this.closing || epoch !== (this.epochs.get(scope.sessionId) ?? 0))
          throw new AppError("COMPRESSION_STOPPED", "启动期间会话已停止；未重新压缩");
        if (autoRunId) {
          const info = this.agents.info(scope), settings = this.store.compressionPreferences().auto;
          const context = info.usage?.context;
          if (!settings.enabled || info.run?.id !== autoRunId ||
              !["starting", "running", "completed"].includes(info.run.status) ||
              this.automatic.get(scope.sessionId)?.stopped || context?.tokens == null ||
              context.tokens < autoCompressionThreshold(settings, context.window))
            throw new AppError("COMPRESSION_STOPPED", "自动压缩条件已变化，未启动任务");
        }
      };
      check();
      if (this.live.has(scope.sessionId)) throw new AppError("COMPRESSION_BUSY", "此会话已有压缩任务，请查看详情");
      if (this.live.size >= 4) throw new AppError("COMPRESSION_LIMIT", "最多同时运行 4 个压缩任务");
      const config = await configuration(this.store.root);
      // An explicit per-run override never changes the global preference or chat model.
      // Only an unset preference falls back; stale saved selections must be rejected.
      const requested = c.params?.selection !== undefined ? c.params.selection
        : this.store.compressionPreferences().selection ?? this.agents.info(scope).selection;
      if (requested === null && c.params?.selection === undefined)
        throw new AppError("MODEL_UNAVAILABLE", "请先选择已配置、已认证的压缩模型；不会自动替换模型。");
      const selection = this.selection(requested, config);
      const manager = this.manager(scope);
      if (!this.agents.active(scope) && manager.getLeafEntry()?.type === "compaction")
        throw new AppError("COMPRESSION_EMPTY", "当前上下文已压缩，尚无新增消息可再次压缩。");
      if (!this.agents.active(scope) && !manager.buildSessionProjection().messages.some((m) => ["user", "assistant", "custom", "toolResult"].includes(m.role)))
        throw new AppError("COMPRESSION_EMPTY", "此会话尚无已保存消息可压缩");
      const raw = await this.agents.models.raw();
      if (createHash("sha256").update(raw).digest("hex") !== config.revision)
        throw new AppError("REVISION_CONFLICT", "模型配置已变化；请重新确认");
      check();
      const id = randomUUID(), input: CompressionInput = {
        root: this.store.root, cwd: this.store.workspace(scope.workspaceId).path,
        file: join(this.directory, `${id}.jsonl`), modelsFile: join(this.directory, `${id}.json`), selection,
      };
      const job: Compression = {
        id, requestId: c.requestId, trigger: autoRunId ? "auto" : "manual", state: "running", phase: "snapshot", startedAt: Date.now(), endedAt: null,
        messageCount: 0, before: null, after: null, summary: "", error: null, selection, usage: null,
      };
      const live: Live = {
        scope, job, input, cancel: false, closed: false, controller: new AbortController(), requestStartedAtMonoMs: performance.now(),
      };
      try {
        writeFileSync(input.modelsFile, raw, { flag: "wx", mode: 0o600 });
        this.store.db.prepare("INSERT INTO compressions VALUES(?,?,?)").run(id, scope.sessionId, JSON.stringify(job));
        this.live.set(scope.sessionId, live);
        this.save(live);
        this.advance(live);
      } catch (error) {
        this.finish(live, "failed", `压缩工作进程未启动：${compressionError(error)}`);
        throw new AppError("COMPRESSION_START", job.error!);
      }
      return { id, status: "accepted" };
    }));
  }
  // Only fresh worker measurements trigger work; reads/reconnects/restarts never do.
  private checkAutomatic(scope: Scope, runId: string, trigger = true) {
    if (this.closing) return;
    const settings = this.store.compressionPreferences().auto;
    const info = this.agents.info(scope), context = info.usage?.context;
    if (info.run?.id !== runId || !["starting", "running", "completed"].includes(info.run.status)) return;
    let state = this.automatic.get(scope.sessionId);
    if (!state || state.runId !== runId) {
      state = { runId, attempted: false, stopped: false };
      this.automatic.set(scope.sessionId, state);
    }
    if (!settings.enabled || state.stopped || context?.tokens == null || !Number.isFinite(context.tokens)) return;
    if (context.tokens < autoCompressionThreshold(settings, context.window)) {
      if (!this.live.has(scope.sessionId) && !this.autoPending.has(scope.sessionId) && this.info(scope)?.state === "completed")
        state.attempted = false;
      return;
    }
    if (!trigger || state.attempted || this.live.has(scope.sessionId) || this.autoPending.has(scope.sessionId) || this.live.size >= 4) return;
    state.attempted = true;
    this.autoPending.add(scope.sessionId);
    const requestId = randomUUID(), previousId = this.info(scope)?.id;
    const work = this.start({ op: "compression.start", requestId, ...scope }, scope, runId).catch((error) => {
      // Stops, capacity and changed conditions are intentional skips. A model or
      // configuration failure is visible in the same page as manual failures.
      if (this.closing || state.stopped) return;
      if (["COMPRESSION_STOPPED", "COMPRESSION_BUSY", "COMPRESSION_LIMIT"].includes(error?.code)) {
        if (this.automatic.get(scope.sessionId) === state) state.attempted = false;
        return;
      }
      try {
        if (this.info(scope)?.id !== previousId) return;
        const selection = this.store.compressionPreferences().selection ?? info.selection;
        if (!selection) return;
        const job: Compression = { id: randomUUID(), requestId, trigger: "auto", state: "failed", phase: "snapshot",
          startedAt: Date.now(), endedAt: Date.now(), messageCount: 0, before: context.tokens,
          after: null, summary: "", error: compressionError(error), selection, usage: null };
        this.store.db.prepare("INSERT INTO compressions VALUES(?,?,?)").run(job.id, scope.sessionId, JSON.stringify(job));
        this.save({ scope, job });
      } catch { /* Session removal owns cleanup; no retries or replacement requests. */ }
    }).finally(() => { this.autoPending.delete(scope.sessionId); this.autoWork.delete(work); });
    this.autoWork.add(work);
  }
  // Called after worker ownership is released (idle or closed), before a successor starts.
  settled(scope: Scope, runId: string) {
    const live = this.live.get(scope.sessionId);
    if (!live) return;
    live.cancelConfirmedRun = runId;
    live.cancelAck?.();
    if (live.cancel) void this.stop(scope).catch(() => {});
    else this.advance(live);
  }
  event(scope: Scope, runId: string, event: any) {
    if (event.type === "usage") this.checkAutomatic(scope, runId, event.autoCheck === true);
    const live = this.live.get(scope.sessionId);
    if (!live) return;
    // A request made during worker startup may not have had an IPC owner yet.
    if (event.type === "ready") { this.advance(live); return; }
    if (event.id !== live.job.id) return;
    // The owning run is settling. settled() will continue against the current
    // owner or idle transcript without regenerating a summary.
    if (event.type === "compression-deferred") return;
    if (event.type === "compression-cancelled") {
      live.cancelConfirmedRun = runId;
      live.cancelAck?.();
      if (live.cancel) void this.stop(scope).catch(() => {});
      return;
    }
    if (live.cancel) return;
    try {
      if (event.type === "compression-snapshot" && !live.snapshot) {
        if (event.ok === false || !event.snapshot)
          this.finish(live, "failed", `会话快照保存失败：${compressionError(event.error)}；未开始生成摘要。`);
        else this.snapshot(live, event.snapshot);
      }
      if (event.type === "compression-queued") { live.job.phase = "applying"; this.save(live); }
      if (event.type === "compression-applied") {
        if (event.ok && this.applied(scope, live.job.id)) this.finish(live, "completed");
        else this.finish(live, "failed", `摘要应用失败：${compressionError(event.error)}；未应用此摘要。`);
      }
    } catch (error) { this.finish(live, "failed", `安全点校验或持久化失败：${compressionError(error)}；未自动重做。`); }
  }
  private advance(live: Live) {
    if (live.cancel || this.live.get(live.scope.sessionId) !== live) return;
    try {
      const { scope, job } = live;
      if (this.applied(scope, job.id)) { this.finish(live, "completed"); return; }
      if (live.snapshot && !live.entry) return;
      if (this.agents.active(scope)) {
        const run = this.agents.info(scope).run;
        if (!run) return;
        if (live.entry) {
          if (this.agents.signal(scope, run.id, { type: "compression-apply", id: job.id, snapshot: live.snapshot, entry: live.entry })) live.applyRun = run.id;
        } else this.agents.signal(scope, run.id, { type: "compression-snapshot", id: job.id });
        // If already finishing, close/settled will retry against the idle manager.
      } else if (this.agents.hasIdle(scope)) {
        // Shutdown hooks can still append entries. Wait for the sole writer to
        // release ownership before either capturing or applying a snapshot.
        void this.agents.releaseIdle(scope).then(() => this.advance(live)).catch(() => {
          if (!live.cancel && this.live.get(scope.sessionId) === live)
            this.finish(live, "failed", "无法释放保活会话；未保存快照或应用摘要。");
        });
      } else if (live.entry && live.snapshot) {
        applyCompression(this.manager(scope), live.snapshot, live.entry, job.id);
        if (!this.applied(scope, job.id)) throw Error("Not persisted");
        this.updateUsage(live);
        this.finish(live, "completed");
      } else this.snapshot(live, captureCompression(this.manager(scope)));
    } catch (error) { this.finish(live, "failed", `快照保存或摘要应用失败：${compressionError(error)}；未应用此摘要。`); }
  }
  private snapshot(live: Live, snapshot: CompressionSnapshot) {
    if (live.snapshot || live.cancel) return;
    live.snapshot = snapshot;
    writeFileSync(live.input.file, [snapshot.header, ...snapshot.entries].map((e) => JSON.stringify(e)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    const messages = openTranscript(live.input.file, live.input.cwd).buildSessionProjection().messages;
    live.job.messageCount = messages.filter((m) => ["user", "assistant", "custom", "toolResult"].includes(m.role)).length;
    if (!live.job.messageCount) throw Error("Empty snapshot");
    live.job.before = messages.reduce((total, message) => total + estimateTokens(message), 0);
    this.launch(live);
    this.save(live);
  }
  private launch(live: Live) {
    live.exit = this.run(live);
    void live.exit.catch(() => {});
  }
  private async run(live: Live) {
    const { input } = live;
    let environment: ReturnType<Agents["profiles"]["prepare"]> | undefined;
    try {
      environment = this.agents.profiles.prepare({ entry: "compression", cwd: input.cwd, modelDir: this.agents.models.dir,
        modelsRaw: readFileSync(input.modelsFile, "utf8"), selection: input.selection, mode: this.agents.pool.mode });
      const lease = await this.agents.pool.acquire({ environment, kind: "compression-summary", requestStartedAtMonoMs: live.requestStartedAtMonoMs, signal: live.controller.signal });
      live.lease = lease;
      const child = await lease.ensureReady();
      if (live.cancel || !environment.current()) throw Error("摘要执行已取消或配置已变化");
      await this.observe(live, child, lease);
    } catch (error) {
      if (live.lease) await this.agents.pool.retire(live.lease.ref, "compression_failed");
      if (!live.cancel && this.live.get(live.scope.sessionId) === live) this.finish(live, "failed", compressionError(error));
    } finally { environment?.release(); }
  }
  private observe(live: Live, child: ChildProcess, lease: ExecutionLease) {
    const { scope, job, input } = live;
    live.child = child;
    let exited!: () => void;
    const closed = new Promise<void>((r) => { exited = r; });
    let terminal: "failed" | "cancelled" | undefined;
    let failure: string | undefined;
    let reap: NodeJS.Timeout | undefined;
    child.on("message", (event: any) => {
      if (!sameLease(event.lease, lease.ref)) return;
      try {
        if (event.type === "closed") live.closed = true;
        // A stopped request can still report real usage before its worker exits.
        if (event.type === "billing") { job.billing = event.billing; this.save(live); }
        if (live.cancel) return;
        if (event.type === "phase") { job.phase = "summarizing"; this.save(live); }
        if (event.type === "completed") {
          if (!event.entry || event.entry.type !== "compaction" || !event.entry.summary?.trim()) throw Error("Missing native compaction");
          live.entry = event.entry;
          const summary = String(event.entry.summary);
          job.summary = summary.slice(0, 64000) + (summary.length > 64000 ? "\n…（摘要预览超过 64,000 字符，已截断）" : "");
          job.before = event.before; job.after = event.after; job.usage = event.usage;
          this.save(live);
          reap = setTimeout(() => child.kill("SIGKILL"), 2000);
        }
        if (event.type === "failed" || event.type === "cancelled") {
          terminal = event.type;
          if (event.type === "failed") failure = compressionError(event.error);
          reap = setTimeout(() => child.kill("SIGKILL"), 2000);
        }
      } catch (error) {
        terminal = "failed";
        failure = compressionError(error);
        child.kill("SIGKILL");
      }
    });
    child.once("error", (error) => { terminal = "failed"; failure = compressionError(error); });
    child.once("close", (code, signal) => {
      clearTimeout(reap);
      live.child = undefined;
      this.cleanup(live);
      exited();
      if (live.cancel || this.live.get(scope.sessionId) !== live) return;
      if (!live.closed || terminal || !live.entry)
        this.finish(live, terminal ?? "interrupted", failure ?? (terminal === "cancelled"
          ? "pi 已取消快照压缩；摘要未应用。"
          : `压缩进程中断（${signal ? `信号 ${signal}` : `退出码 ${code ?? "未知"}`}），未收到有效压缩结果。`));
      else {
        job.phase = "applying";
        this.save(live);
        this.advance(live);
      }
    });
    child.send({ type: "start", input: { ...input, executionGate: true, modelsFile: lease.environment.modelsFile }, lease: lease.ref }, (error) => {
      if (error) { terminal = "failed"; failure = compressionError(error); child.kill("SIGKILL"); }
    });
    return closed;
  }
  private updateUsage(live: Live) {
    const usage = this.agents.info(live.scope).usage;
    if (!usage) return;
    const u = live.entry?.usage;
    if (u) {
      usage.input += u.input; usage.output += u.output;
      usage.cacheRead += u.cacheRead; usage.cacheWrite += u.cacheWrite; usage.total += u.totalTokens;
      usage.cost = u.cost.total > 0 ? (usage.cost ?? 0) + u.cost.total : usage.cost;
    }
    // The next provider measurement is not available yet. Estimate the live,
    // committed projection including retained messages and the post-snapshot tail.
    if (usage.context) usage.context = contextUsage(this.manager(live.scope), {
      ...usage.context, tokens: null, percent: null,
    });
    this.store.db.prepare("UPDATE agent_sessions SET usage=? WHERE sessionId=?").run(JSON.stringify(usage), live.scope.sessionId);
    this.agents.publish(agentScope(live.scope), this.agents.info(live.scope));
  }
  private cleanup(live: Live) {
    for (const file of [live.input.file, live.input.modelsFile]) {
      try { rmSync(file, { force: true }); } catch { /* Retried at startup. */ }
    }
  }
  private finish(live: Live, state: Compression["state"], error: string | null = null) {
    // Never report an unchanged context when the native append already committed,
    // even if telemetry or a late acknowledgement failed afterwards.
    if (state !== "completed" && this.applied(live.scope, live.job.id)) state = "completed";
    live.job.state = state; live.job.endedAt = Date.now(); live.job.error = state === "completed" ? null : error;
    if (state === "completed") { live.job.phase = "done"; live.job.appliedAt = Date.now(); this.agents.refresh(live.scope); }
    this.save(live);
    this.live.delete(live.scope.sessionId);
    if (state === "completed") {
      const automatic = this.automatic.get(live.scope.sessionId);
      if (automatic) this.checkAutomatic(live.scope, automatic.runId, false);
    }
    if (!live.child) this.cleanup(live);
  }
  async stop(scope: Scope) {
    this.store.session(scope.workspaceId, scope.sessionId);
    this.epochs.set(scope.sessionId, (this.epochs.get(scope.sessionId) ?? 0) + 1);
    const runId = this.agents.info(scope).run?.id;
    if (runId) this.automatic.set(scope.sessionId, { runId, attempted: true, stopped: true });
    const live = this.live.get(scope.sessionId);
    if (!live) return;
    live.cancel = true;
    live.controller.abort();
    // Abort the billable summarization first, even if the live agent is too busy
    // to acknowledge cancellation of its queued apply within the deadline.
    if (live.child) {
      const child = live.child;
      if (child.connected) child.send({ type: "stop", lease: live.lease?.ref }, () => {});
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      await live.exit;
      clearTimeout(timer);
    } else await live.exit;
    const run = this.agents.info(scope).run;
    if (run && this.agents.active(scope) && live.cancelConfirmedRun !== run.id) {
      let ack!: () => void;
      const cancelled = new Promise<void>((r) => { ack = r; });
      live.cancelAck = ack;
      const sent = this.agents.signal(scope, run.id, { type: "compression-cancel", id: live.job.id });
      if (sent || live.applyRun) {
        let timer: NodeJS.Timeout | undefined;
        const confirmed = await Promise.race([cancelled.then(() => true), new Promise<false>((r) => { timer = setTimeout(() => r(false), 2000); })]);
        clearTimeout(timer);
        if (!confirmed && this.agents.active(scope)) {
          // Never claim cancellation while a previously delivered apply may commit.
          live.job.error = "正在等待会话安全点确认取消；尚未确认，不能重新压缩。";
          this.save(live);
          throw new AppError("UNCERTAIN", live.job.error);
        }
      }
    }
    if (this.live.get(scope.sessionId) === live)
      this.finish(live, this.applied(scope, live.job.id) ? "completed" : "cancelled", live.job.error);
  }
  checkProviders(providers: string[], confirmed: boolean) {
    if (!confirmed && [...this.live.values()].some((l) => providers.includes(l.job.selection.provider)))
      throw new AppError("ACTIVE_RUNS_CONFIRMATION_REQUIRED", "需先停止受影响的后台压缩任务，再撤销认证。");
  }
  async stopProviders(providers: string[], confirmed: boolean) {
    this.checkProviders(providers, confirmed);
    await Promise.all([...this.live.values()].filter((l) => providers.includes(l.job.selection.provider)).map((l) => this.stop(l.scope)));
  }
  async close() {
    this.closing = true;
    await Promise.allSettled([...this.live.values()].map((l) => this.stop(l.scope)));
    await Promise.allSettled(this.autoWork);
  }
}
