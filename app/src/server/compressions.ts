import { fork, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import {
  AppError,
  text,
  type Command,
  type Scope,
} from "../shared/protocol.js";
import {
  compressionLimitMs,
  compressionScope,
  type Compression,
} from "../shared/compression.js";
import type { Agents } from "./agents.js";
import { configuration } from "./models.js";
import { openTranscript } from "./transcript.js";
import type { CompressionInput } from "./compression-worker.js";

type Live = {
  scope: Scope;
  job: Compression;
  child: ChildProcess;
  exit: Promise<void>;
  timer: NodeJS.Timeout;
  cancel: boolean;
  closed: boolean;
};
// Detached snapshots never replace or write the live Agent transcript.
export class Compressions {
  private live = new Map<string, Live>();
  private epochs = new Map<string, number>();
  private closing = false;
  private readonly directory: string;
  private readonly store;
  constructor(private readonly agents: Agents) {
    this.store = agents.store;
    this.directory = join(this.store.root, "compression-snapshots");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.store.db.exec(
      "CREATE TABLE IF NOT EXISTS compressions(id TEXT PRIMARY KEY,sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,body TEXT NOT NULL)",
    );
    for (const row of this.store.db
      .prepare("SELECT id,body FROM compressions")
      .all()) {
      const job: Compression = JSON.parse(String(row.body));
      if (job.state === "running") {
        job.state = "interrupted";
        job.endedAt = Date.now();
        job.error = "服务中断；未自动重新压缩，原始上下文未改变。";
        this.store.db
          .prepare("UPDATE compressions SET body=? WHERE id=?")
          .run(JSON.stringify(job), row.id);
      }
    }
    for (const name of readdirSync(this.directory))
      if (/^[0-9a-f-]+\.(json|jsonl)$/.test(name))
        rmSync(join(this.directory, name), { force: true });
  }
  info(scope: Scope): Compression | null {
    this.store.session(scope.workspaceId, scope.sessionId);
    const row = this.store.db
      .prepare(
        "SELECT body FROM compressions WHERE sessionId=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(scope.sessionId);
    return row ? JSON.parse(String(row.body)) : null;
  }
  private save(live: Pick<Live, "scope" | "job">) {
    this.store.db
      .prepare("UPDATE compressions SET body=? WHERE id=? AND sessionId=?")
      .run(JSON.stringify(live.job), live.job.id, live.scope.sessionId);
    this.agents.publish(compressionScope(live.scope), live.job);
  }
  command(c: Command): Promise<unknown> {
    const scope = {
      workspaceId: text(c.workspaceId, "工作空间"),
      sessionId: text(c.sessionId, "会话"),
    };
    this.store.session(scope.workspaceId, scope.sessionId);
    if (c.op === "compression.get") return Promise.resolve(this.info(scope));
    if (c.op === "compression.cancel")
      return this.store.external(c, async () => {
        if (this.info(scope)?.id !== text(c.params?.id, "压缩任务"))
          throw new AppError(
            "COMPRESSION_SCOPE",
            "压缩任务已变化或不属于此会话",
          );
        await this.stop(scope);
        return this.info(scope);
      });
    if (c.op !== "compression.start")
      return Promise.reject(
        new AppError("UNKNOWN_OPERATION", "不支持的压缩操作"),
      );
    const epoch = this.epochs.get(scope.sessionId) ?? 0;
    return this.store.external(c, () =>
      this.agents.models.serial(async () => {
        this.store.session(scope.workspaceId, scope.sessionId);
        if (this.closing || epoch !== (this.epochs.get(scope.sessionId) ?? 0))
          throw new AppError(
            "COMPRESSION_STOPPED",
            "启动期间会话已停止；未重新压缩",
          );
        if (this.live.has(scope.sessionId))
          throw new AppError(
            "COMPRESSION_BUSY",
            "此会话已有压缩任务，请查看详情",
          );
        if (this.live.size >= 4)
          throw new AppError("COMPRESSION_LIMIT", "最多同时运行 4 个压缩任务");
        const config = await configuration(this.store.root),
          selection = this.agents.info(scope).selection;
        if (
          !selection ||
          config.error ||
          !config.available.some(
            (m) =>
              m.provider === selection.provider &&
              m.id === selection.id &&
              m.levels.includes(selection.thinking),
          )
        )
          throw new AppError(
            "MODEL_UNAVAILABLE",
            "请先选择已配置、已认证的模型；不会自动替换模型。",
          );
        const row = this.store.db
          .prepare("SELECT file FROM agent_sessions WHERE sessionId=?")
          .get(scope.sessionId);
        if (!row?.file)
          throw new AppError("COMPRESSION_EMPTY", "此会话尚无已保存消息可压缩");
        const cwd = this.store.workspace(scope.workspaceId).path;
        const manager = openTranscript(String(row.file), cwd),
          entries = manager.getBranch();
        const messages = manager.buildSessionProjection().messages;
        const messageCount = messages.filter((m) =>
          ["user", "assistant", "custom", "toolResult"].includes(m.role),
        ).length;
        if (!messageCount)
          throw new AppError("COMPRESSION_EMPTY", "此会话尚无已保存消息可压缩");
        const raw = await this.agents.models.raw();
        if (createHash("sha256").update(raw).digest("hex") !== config.revision)
          throw new AppError("REVISION_CONFLICT", "模型配置已变化；请重新确认");
        if (this.closing || epoch !== (this.epochs.get(scope.sessionId) ?? 0))
          throw new AppError(
            "COMPRESSION_STOPPED",
            "启动期间会话已停止；未重新压缩",
          );
        const id = randomUUID(),
          file = join(this.directory, `${id}.jsonl`),
          modelsFile = join(this.directory, `${id}.json`);
        const job: Compression = {
          id,
          requestId: c.requestId,
          state: "running",
          phase: "snapshot",
          startedAt: Date.now(),
          endedAt: null,
          messageCount,
          before: messages.reduce(
            (total, message) => total + estimateTokens(message),
            0,
          ),
          after: null,
          summary: "",
          error: null,
          selection,
          usage: null,
        };
        try {
          writeFileSync(
            file,
            [manager.getHeader(), ...entries]
              .map((e) => JSON.stringify(e))
              .join("\n") + "\n",
            { flag: "wx", mode: 0o600 },
          );
          writeFileSync(modelsFile, raw, { flag: "wx", mode: 0o600 });
          this.store.db
            .prepare("INSERT INTO compressions VALUES(?,?,?)")
            .run(id, scope.sessionId, JSON.stringify(job));
          this.launch(scope, job, {
            root: this.store.root,
            cwd,
            file,
            modelsFile,
            selection,
          });
        } catch {
          rmSync(file, { force: true });
          rmSync(modelsFile, { force: true });
          job.state = "failed";
          job.endedAt = Date.now();
          job.error = "压缩工作进程未启动；原始上下文未改变。";
          this.save({ scope, job });
          throw new AppError("COMPRESSION_START", job.error);
        }
        this.save({ scope, job });
        return { id, status: "accepted" };
      }),
    );
  }
  private launch(scope: Scope, job: Compression, input: CompressionInput) {
    const source = import.meta.url.endsWith(".ts");
    const child = fork(
      fileURLToPath(
        new URL(
          source ? "./compression-worker.ts" : "./compression-worker.js",
          import.meta.url,
        ),
      ),
      [],
      {
        cwd: input.cwd,
        execArgv: source ? ["--import", import.meta.resolve("tsx")] : [],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    let exited!: () => void;
    const live: Live = {
      scope,
      job,
      child,
      exit: new Promise<void>((r) => {
        exited = r;
      }),
      cancel: false,
      closed: false,
      timer: setTimeout(() => {
        live.job.error = "压缩超过两分钟，已请求取消；原始上下文未改变。";
        void this.stop(scope).catch(() => {});
      }, compressionLimitMs),
    };
    this.live.set(scope.sessionId, live);
    child.on("message", (event: any) => {
      try {
        if (event.type === "closed") live.closed = true;
        if (live.cancel) return;
        if (event.type === "phase") job.phase = "summarizing";
        if (event.type === "completed") {
          job.state = "completed";
          job.phase = "done";
          const summary = String(event.summary);
          job.summary =
            summary.slice(0, 64000) +
            (summary.length > 64000
              ? "\n…（摘要预览超过 64,000 字符，已截断）"
              : "");
          job.before = event.before;
          job.after = event.after;
          job.usage = event.usage;
          job.endedAt = Date.now();
        }
        if (event.type === "failed" || event.type === "cancelled") {
          job.state = event.type;
          job.endedAt = Date.now();
          job.error =
            event.type === "failed"
              ? "pi 无法压缩此快照；会话可能过短，或模型／认证／网络不可用。原始上下文未改变。"
              : null;
        }
        if (job.state !== "running") {
          clearTimeout(live.timer);
          live.timer = setTimeout(() => child.kill("SIGKILL"), 2000);
        } else this.save(live);
        // Publish terminal state only after close, so immediate retry cannot race worker cleanup.
      } catch {
        child.kill("SIGKILL");
      }
    });
    child.once("error", () => {
      job.error = "压缩工作进程无法启动。";
    });
    child.once("close", () => {
      clearTimeout(live.timer);
      this.live.delete(scope.sessionId);
      try {
        if (live.cancel) job.state = "cancelled";
        else if (!live.closed || job.state === "running") {
          job.state = "interrupted";
          job.error = "压缩工作进程中断；未自动重做，原始上下文未改变。";
        }
        job.endedAt ??= Date.now();
        this.save(live);
      } catch {
        // A failed durable update remains running/uncertain on disk and is interrupted at restart.
      } finally {
        for (const file of [input.file, input.modelsFile]) {
          try {
            rmSync(file, { force: true });
          } catch {
            /* Retried on next startup. */
          }
        }
        exited();
      }
    });
    child.send({ type: "start", input }, (error) => {
      if (error) child.kill("SIGKILL");
    });
  }
  async stop(scope: Scope) {
    this.store.session(scope.workspaceId, scope.sessionId);
    this.epochs.set(
      scope.sessionId,
      (this.epochs.get(scope.sessionId) ?? 0) + 1,
    );
    const live = this.live.get(scope.sessionId);
    if (!live) return;
    if (!live.cancel) {
      live.cancel = live.job.state === "running";
      if (live.child.connected) live.child.send({ type: "stop" }, () => {});
      clearTimeout(live.timer);
      live.timer = setTimeout(() => live.child.kill("SIGKILL"), 2000);
    }
    await live.exit;
    if (this.info(scope)?.state === "running")
      throw new AppError(
        "UNCERTAIN",
        "压缩进程已退出，但终态未保存；请检查应用磁盘，勿重复发送。",
      );
  }
  checkProviders(providers: string[], confirmed: boolean) {
    if (
      !confirmed &&
      [...this.live.values()].some((l) =>
        providers.includes(l.job.selection.provider),
      )
    )
      throw new AppError(
        "ACTIVE_RUNS_CONFIRMATION_REQUIRED",
        "需先停止受影响的后台压缩任务，再撤销认证。",
      );
  }
  async stopProviders(providers: string[], confirmed: boolean) {
    this.checkProviders(providers, confirmed);
    await Promise.all(
      [...this.live.values()]
        .filter((l) => providers.includes(l.job.selection.provider))
        .map((l) => this.stop(l.scope)),
    );
  }
  async close() {
    this.closing = true;
    await Promise.allSettled(
      [...this.live.values()].map((l) => this.stop(l.scope)),
    );
  }
}
