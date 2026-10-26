import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { CapabilityPlan } from "./capabilities.js";
import type { Agents } from "./agents.js";
import type { WorkerInput } from "./agent-worker.js";
import { sameLease } from "./execution-protocol.js";
import { fileRevision } from "./execution-profile.js";
import { configuration } from "./models.js";
import { memoryDirectory } from "./memory-files.js";
import { errorMessage } from "./error-message.js";
import { AppError, object, type Command, type Scope } from "../shared/protocol.js";
import type { CapabilityReloadSelection, SkillSelectionChange } from "../shared/capabilities.js";
import { agentScope } from "../shared/agent.js";
import { reloadScope, type ReloadState, type ResourceSnapshot, type ReloadStage } from "../shared/reload.js";

type Job = { selection?: CapabilityReloadSelection; skillChange?: SkillSelectionChange; capabilities?: CapabilityPlan; scope: Scope; state: ReloadState; controller: AbortController; done?: Promise<void>; timer?: ReturnType<typeof setTimeout> };
/** One independently subscribed operation per session; no synthetic chat Run or model request. */
export class SessionReloads {
  onReleased?: (scope: Scope) => void;
  private release(job: Job) {
    if (this.jobs.get(job.scope.sessionId) !== job) return;
    this.jobs.delete(job.scope.sessionId);
    if (!job.controller.signal.aborted) this.onReleased?.(job.scope);
  }
  private jobs = new Map<string, Job>();
  constructor(private agents: Agents) {
    agents.store.db.exec(`CREATE TABLE IF NOT EXISTS session_reloads(sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, state TEXT, resources TEXT)`);
    for (const row of agents.store.db.prepare("SELECT sessionId,state FROM session_reloads WHERE state IS NOT NULL").all()) {
      const state = JSON.parse(String(row.state)) as ReloadState;
      if (state.status !== "running") continue;
      state.status = "failed"; state.stage = "failed"; state.endedAt = Date.now();
      state.error = "服务重启，重载结果未确认；未自动重做。";
      state.steps.push({ stage: "failed", at: state.endedAt });
      agents.store.db.prepare("UPDATE session_reloads SET state=? WHERE sessionId=?").run(JSON.stringify(state), row.sessionId);
    }
  }
  active(scope: Scope) { return this.jobs.has(scope.sessionId); }
  state(scope: Scope): ReloadState | null {
    this.agents.store.session(scope.workspaceId, scope.sessionId);
    const row = this.agents.store.db.prepare("SELECT state FROM session_reloads WHERE sessionId=?").get(scope.sessionId);
    return row?.state ? JSON.parse(String(row.state)) : null;
  }
  private save(job: Job) {
    this.agents.store.db.prepare("INSERT INTO session_reloads(sessionId,state) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET state=excluded.state")
      .run(job.scope.sessionId, JSON.stringify(job.state));
    this.agents.publish(reloadScope(job.scope), job.state);
  }
  private stage(job: Job, stage: ReloadStage) {
    if (job.state.stage !== stage) job.state.steps.push({ stage, at: Date.now() });
    job.state.stage = stage; this.save(job);
  }
  private fail(job: Job, error: unknown) {
    if (job.state.status !== "running") return;
    job.state.status = "failed"; job.state.endedAt = Date.now();
    clearTimeout(job.timer);
    job.state.error = errorMessage(error, "重载未完成，请检查资源后重试。");
    this.stage(job, "failed");
  }
  event(scope: Scope, runId: string, event: any) {
    if (event.type === "resources-loaded") {
      // Cold initialization can already contain the desired configuration.
      // Do not replace the last successful baseline before reload succeeds.
      if (this.jobs.has(scope.sessionId)) return;
      this.agents.store.db.prepare("INSERT INTO session_reloads(sessionId,resources) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET resources=excluded.resources")
        .run(scope.sessionId, JSON.stringify(event.resources));
      return;
    }
    const job = this.jobs.get(scope.sessionId);
    if (!job || job.state.status !== "running" || event.id !== job.state.id || (job.state.runId && job.state.runId !== runId)) return;
    if (event.type === "reload-stage" && ["reloading", "comparing"].includes(event.stage)) {
      this.stage(job, event.stage);
      if (job.state.runId && !job.timer) job.timer = setTimeout(() => {
        this.fail(job, "重载超过 120 秒，已停止本次执行；请检查扩展服务。");
        void this.agents.stop(scope).catch(() => {});
      }, 120000);
    }
    if (event.type !== "reload-result") return;
    if (!event.ok) { this.fail(job, event.error); return; }
    if (job.capabilities) {
      try {
        if (job.skillChange) this.agents.capabilities.appliedSkills(scope, job.capabilities);
        else this.agents.capabilities.appliedReload(scope, job.capabilities, job.selection);
      } catch (error) {
        this.fail(job, error);
        void this.agents.stop(scope).catch(() => {});
        return;
      }
    }
    this.agents.store.db.prepare("UPDATE session_reloads SET resources=? WHERE sessionId=?")
      .run(JSON.stringify(event.after), scope.sessionId);
    job.state.before = event.before ?? job.state.before;
    job.state.after = event.after; job.state.warnings = event.warnings ?? [];
    job.state.resumed = event.resumed === true;
    job.state.status = "completed"; job.state.endedAt = Date.now();
    clearTimeout(job.timer);
    if (event.environment) {
      this.agents.store.db.prepare("UPDATE agent_sessions SET environment=? WHERE sessionId=?").run(JSON.stringify(event.environment), scope.sessionId);
      this.agents.publish(agentScope(scope), this.agents.info(scope));
    }
    this.stage(job, "completed");
    // Live workers already own their lease. Cold workers retain the lock through cleanup.
    if (job.state.runId) this.release(job);
  }
  settled(scope: Scope, runId: string) {
    const job = this.jobs.get(scope.sessionId);
    if (!job || job.state.runId !== runId) return;
    this.fail(job, "执行已结束或停止，尚未确认重载完成；请核对状态后重新加载。");
    this.jobs.delete(scope.sessionId);
  }
  command(c: Command) {
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! };
    this.agents.store.session(scope.workspaceId, scope.sessionId);
    const params = object(c.params ?? {});
    let skillChange: SkillSelectionChange | undefined, selection: CapabilityReloadSelection | undefined;
    if (c.op === "agent.skills") {
      if (Object.keys(params).some(key => !["revision", "catalogRevision", "id", "checked"].includes(key)) ||
        !Number.isSafeInteger(params.revision) || Number(params.revision) < 0 || typeof params.catalogRevision !== "string" ||
        typeof params.id !== "string" || !params.id || typeof params.checked !== "boolean")
        throw new AppError("INVALID_INPUT", "技能选择参数无效。");
      skillChange = params as SkillSelectionChange;
    } else if (Object.keys(params).length) {
      if (Object.keys(params).some(key => key !== "capabilities")) throw new AppError("INVALID_INPUT", "重载参数无效。");
      const value = object(params.capabilities);
      const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 2000 &&
        ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 1024) && new Set(ids).size === ids.length;
      if (Object.keys(value).some(key => !["target", "revision", "catalogRevision", "skills", "mcp"].includes(key)) ||
        !["session", "defaults"].includes(String(value.target)) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 ||
        typeof value.catalogRevision !== "string" || !validIds(value.skills) || !validIds(value.mcp))
        throw new AppError("INVALID_INPUT", "能力选择参数无效。");
      selection = value as CapabilityReloadSelection;
    }
    return this.agents.store.external(c, async () => {
      if (this.active(scope)) {
        if (selection || skillChange || this.state(scope)?.kind === "skills") throw new AppError("RELOAD_BUSY", "会话正在应用资源变化，请等待完成后调整技能。");
        return this.state(scope);
      }
      if (!this.agents.store.workspace(scope.workspaceId).authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
      const info = this.agents.info(scope);
      if ((skillChange || selection) && info.task) throw new AppError("CAPABILITIES_READONLY", "子任务沿用受限能力范围，不能单独调整选择。");
      if (this.agents.compressions.info(scope)?.state === "running") throw new AppError("COMPRESSION_BUSY", "请等待当前压缩结束后重新加载。");
      if (info.run?.status === "stopping" || info.task && ["queued", "starting", "stopping"].includes(info.task.status))
        throw new AppError("AGENT_BUSY", "会话正在排队、启动或停止，请稍后重试。");
      const executing = this.agents.executing(scope);
      if (this.agents.active(scope) && (!executing || info.run?.status !== "running")) throw new AppError("AGENT_BUSY", "会话正在准备，请稍后重试。");
      const row = this.agents.store.db.prepare("SELECT resources FROM session_reloads WHERE sessionId=?").get(scope.sessionId);
      const stage = executing ? "waiting" : "preparing", at = Date.now();
      const job: Job = { scope, selection, skillChange, controller: new AbortController(), state: { ...(skillChange ? { kind: "skills" } : {}), id: c.requestId, status: "running", stage,
        startedAt: at, steps: [{ stage, at }], before: row?.resources ? JSON.parse(String(row.resources)) as ResourceSnapshot : undefined,
        ...(executing ? { runId: info.run!.id } : {}) } };
      this.agents.continuations.cancel(scope, true);
      this.jobs.set(scope.sessionId, job); this.save(job);
      if (skillChange && !executing) {
        job.done = (async () => {
          const plan = await this.agents.capabilities.prepare(scope, false, skillChange);
          if (this.jobs.get(scope.sessionId) !== job || job.controller.signal.aborted) return;
          this.agents.capabilities.appliedSkills(scope, plan);
          job.state.status = "completed"; job.state.endedAt = Date.now();
          this.stage(job, "completed");
        })().catch(error => this.fail(job, error)).finally(() => this.release(job));
      } else if (executing) {
        job.done = (async () => {
          if (!info.task) job.capabilities = await this.agents.capabilities.prepare(scope, !skillChange, skillChange, selection);
          if (this.jobs.get(scope.sessionId) !== job || job.controller.signal.aborted) return;
          if (!this.agents.signal(scope, info.run!.id, { type: "reload", id: job.state.id, kind: job.state.kind, capabilities: job.capabilities?.runtime }))
            throw Error("执行已进入结束阶段，未发起重载，请稍后重试。");
        })().catch(error => { this.fail(job, error); this.release(job); });
      } else {
        job.done = this.cold(job).catch(error => this.fail(job, error)).finally(() => this.release(job));
      }
      return job.state;
    });
  }
  async stop(scope: Scope) {
    const job = this.jobs.get(scope.sessionId);
    if (!job) return;
    job.controller.abort(); this.fail(job, "会话已停止，重载结果未确认；未自动重做。");
    await job.done;
    if (this.jobs.get(scope.sessionId) === job) this.jobs.delete(scope.sessionId);
  }
  async close() { await Promise.all([...this.jobs.values()].map(job => this.stop(job.scope))); }
  private async cold(job: Job) {
    const { scope, controller } = job, { agents } = this;
    const cwd = agents.store.workspace(scope.workspaceId).path;
    const check = () => {
      agents.store.session(scope.workspaceId, scope.sessionId);
      if (controller.signal.aborted || !agents.store.workspace(scope.workspaceId).authorized) throw Error("重载已停止。");
      if (agents.executing(scope)) throw Error("会话已开始其他执行，未重载。");
    };
    const prepared = await agents.models.serial(async () => {
      check();
      const config = await configuration(agents.store.root), selection = agents.info(scope).selection;
      if (config.error) throw Error(config.error);
      if (!selection || !config.available.some(model => model.provider === selection.provider && model.id === selection.id && model.levels.includes(selection.thinking)))
        throw Error("请先选择已配置、已认证的模型；重载不会发起模型请求。");
      const child = agents.store.db.prepare("SELECT id FROM tasks WHERE sessionId=?").get(scope.sessionId);
      const task = child ? { id: String(child.id), inputIds: [] } : undefined;
      const capabilities = task ? undefined : await agents.capabilities.prepare(scope, true, undefined, job.selection);
      job.capabilities = capabilities;
      let file = agents.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)?.file as string | undefined;
      if (!file) {
        const directory = join(agents.store.root, "sessions", scope.workspaceId);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const manager = SessionManager.create(cwd, directory); file = manager.getSessionFile()!;
        writeFileSync(file, JSON.stringify(manager.getHeader()) + "\n", { flag: "wx", mode: 0o600 });
        agents.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(scope.sessionId, file);
      }
      const raw = await agents.models.raw(); check();
      return { selection, task, capabilities, file, raw };
    }, controller.signal);
    const environment = await agents.profiles.prepareAsync({ entry: "agent", cwd, modelDir: agents.models.dir, modelsRaw: prepared.raw,
      selection: prepared.selection, capabilities: prepared.capabilities?.runtime, mode: agents.pool.mode }, controller.signal);
    let lease: Awaited<ReturnType<typeof agents.pool.acquire>> | undefined;
    try {
      check();
      lease = await agents.pool.acquire({ environment, kind: "agent", bindingGate: true, requestStartedAtMonoMs: performance.now(),
        affinity: { sessionId: scope.sessionId, fileRevision: fileRevision(prepared.file) }, signal: controller.signal, beforeExecute: check });
      const child = await lease.ensureReady(); check();
      if (!(await lease.validateEnvironment?.()) || !agents.pool.isActive(lease.ref)) throw Error("准备期间资源已变化，请重新加载。");
      const input: WorkerInput = { root: agents.store.root, cwd, file: prepared.file, modelsFile: lease.environment.modelsFile,
        runId: job.state.id, selection: prepared.selection, prompt: "", reloadId: job.state.id, executionGate: true,
        capabilities: prepared.capabilities?.runtime, task: prepared.task,
        memoryTopics: prepared.task ? undefined : agents.memories.topicSnapshot(scope.workspaceId),
        memoryPath: prepared.task ? undefined : join(memoryDirectory(agents.store.root, scope.sessionId), "MEMORY.md") };
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => { clearTimeout(timer); controller.signal.removeEventListener("abort", aborted); child.off("message", message); child.off("close", closed); error ? reject(error) : resolve(); };
        const aborted = () => finish(new Error("重载已停止。"));
        const closed = () => finish(new Error("重载工作进程退出，结果未确认。"));
        const message = (event: any) => {
          if (event.runId !== job.state.id || !sameLease(event.lease, lease!.ref)) return;
          try {
            this.event(scope, job.state.id, event);
            if (event.type === "reload-result" && !event.ok) finish(new Error(event.error));
            else if (event.type === "done" && event.status !== "completed") finish(new Error(event.error || "重载初始化失败。"));
            else if (event.type === "idle") finish(job.state.status === "completed" ? undefined : new Error("重载未返回结果。"));
          } catch (error) { finish(error as Error); }
        };
        const timer = setTimeout(() => finish(new Error("重载超过 120 秒，已停止工作进程；请检查扩展服务。")), 120000);
        child.on("message", message); child.once("close", closed);
        controller.signal.addEventListener("abort", aborted, { once: true });
        if (controller.signal.aborted) { aborted(); return; }
        try { child.send({ type: "start", input, lease: lease!.ref }, error => { if (error) finish(error); }); }
        catch (error) { finish(error as Error); }
      });
      if (await lease.validateEnvironment?.()) await agents.pool.release(lease.ref, { clean: true, keepSession: true,
        affinity: { sessionId: scope.sessionId, fileRevision: fileRevision(prepared.file) } });
      else await agents.pool.retire(lease.ref, "reload_resources_changed");
    } finally {
      if (lease && agents.pool.isActive(lease.ref)) await agents.pool.retire(lease.ref, "reload_cleanup");
      environment.release();
    }
  }
}
