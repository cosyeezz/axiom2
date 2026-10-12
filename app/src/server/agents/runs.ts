import { fork, spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError, type Scope } from "../../shared/protocol.js";
import { agentScope, threadScope, type Run } from "../../shared/agent.js";
import type { Store } from "../storage.js";
import type { WorkerInput } from "../agent-worker.js";
import { AgentViews } from "./views.js";
type Live = {
  scope: Scope;
  run: Run;
  child: ChildProcess;
  exit: Promise<void>;
  finish?: { status: Run["status"]; error?: string };
  forced: boolean;
  storageFailed?: boolean;
  closed?: boolean;
  timer?: NodeJS.Timeout;
  stopOptions?: {
    summary?: boolean;
    summaryMs?: number;
    cleanupMs?: number;
    reason?: string;
  };
};

export class AgentRuns {
  constructor(
    readonly store: Store,
    readonly views: AgentViews,
    readonly publish: (scope: string, data?: unknown) => void,
  ) {}
  private live = new Map<string, Live>();
  closing = false;
  onEvent?: (scope: Scope, run: Run, event: any) => void;
  onSettled?: (scope: Scope, run: Run) => void;
  active(scope: Scope) {
    this.store.session(scope.workspaceId, scope.sessionId);
    return this.live.has(scope.sessionId);
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
    live.child.send(value, () => {});
    return true;
  }
  launch(scope: Scope, run: Run, input: WorkerInput) {
    const path = fileURLToPath(
      new URL(
        import.meta.url.endsWith(".ts")
          ? "../agent-worker.ts"
          : "../agent-worker.js",
        import.meta.url,
      ),
    );
    const child = fork(path, [], {
      cwd: input.cwd,
      execArgv:
        extname(path) === ".ts" ? ["--import", import.meta.resolve("tsx")] : [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      detached: process.platform !== "win32",
    });
    let exited!: () => void;
    const live: Live = {
      scope,
      run,
      child,
      exit: new Promise<void>((r) => {
        exited = r;
      }),
      forced: false,
    };
    this.live.set(scope.sessionId, live);
    child.on("message", (event: any) => {
      if (this.live.get(scope.sessionId) !== live) return;
      try {
        if (event.type === "closed") live.closed = true;
        if (event.type === "summarizing" && live.stopOptions?.summary)
          this.escalate(
            live,
            (live.stopOptions.summaryMs ?? 60000) +
              (live.stopOptions.cleanupMs ?? 10000),
          );
        if (event.type === "done")
          this.escalate(live, live.stopOptions?.cleanupMs ?? 10000);
        if (event.type === "ready")
          this.store.db
            .prepare(
              "UPDATE agent_sessions SET environment=? WHERE sessionId=?",
            )
            .run(JSON.stringify(event.environment), scope.sessionId);
        if (event.type === "running" && live.run.status !== "stopping") {
          live.run.status = "running";
          this.store.db
            .prepare("UPDATE runs SET status='running' WHERE id=?")
            .run(run.id);
        }
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
          live.finish = { status: event.status, error: event.error };
        if (["done", "usage"].includes(event.type) && event.usage)
          this.store.db
            .prepare("UPDATE agent_sessions SET usage=? WHERE sessionId=?")
            .run(JSON.stringify(event.usage), scope.sessionId);
        if (event.type === "phase")
          this.views.phases.set(scope.sessionId, event.text);
        if (event.type === "warning") {
          const environment = this.views.info(scope).environment;
          if (environment) {
            environment.warnings.push(event.text);
            this.store.db
              .prepare(
                "UPDATE agent_sessions SET environment=? WHERE sessionId=?",
              )
              .run(JSON.stringify(environment), scope.sessionId);
          }
        }
        if (["ready", "running"].includes(event.type))
          this.views.changed(scope);
        else if (["usage", "phase", "warning"].includes(event.type))
          this.publish(agentScope(scope), this.views.info(scope));
        this.onEvent?.(scope, run, event);
      } catch {
        live.storageFailed = true;
        live.finish = {
          status: "failed",
          error: "执行状态保存失败；已请求停止，勿重复提交。",
        };
        if (child.connected) child.send({ type: "stop" }, () => {});
        this.escalate(live, 10000);
      }
    });
    child.once("error", () => {
      live.finish = { status: "failed", error: "工作进程无法启动。" };
    });
    child.once("close", () => {
      clearTimeout(live.timer);
      try {
        try {
          rmSync(input.modelsFile, { force: true });
        } catch {
          /* Protected runtime snapshot is retried on service startup. */
        }
        this.views.flush(scope);
        this.store.db
          .prepare(
            "UPDATE runs SET status=?,endedAt=?,error=?,cleanup=? WHERE id=?",
          )
          .run(
            live.finish?.status ?? "interrupted",
            Date.now(),
            live.finish?.error ??
              (live.finish
                ? null
                : "工作进程中断；流式尾部可能未保存，未自动重做。"),
            !live.forced && live.closed && !live.storageFailed
              ? "confirmed"
              : "unconfirmed",
            run.id,
          );
        this.store.db
          .prepare("UPDATE sessions SET unread=1,updatedAt=? WHERE id=?")
          .run(Date.now(), scope.sessionId);
        this.views.messages.delete(scope.sessionId);
        this.views.phases.delete(scope.sessionId);
        this.publish(threadScope(scope), this.views.thread(scope));
        this.views.changed(scope);
      } catch {
        this.publish(agentScope(scope), {
          ...this.views.info(scope),
          run: {
            ...run,
            status: "interrupted",
            cleanup: "unconfirmed",
            error: "执行已退出，但状态保存失败；请检查应用磁盘，勿重复发送。",
          },
        });
      } finally {
        this.live.delete(scope.sessionId);
        exited();
        try {
          this.onSettled?.(scope, this.views.info(scope).run!);
        } catch {
          /* Persisted run remains available for reconciliation on restart; do not acknowledge delivery. */
        }
      }
    });
    child.send({ type: "start", input }, (error) => {
      if (error) child.kill();
    });
  }
  async stop(
    scope: Scope,
    options: {
      summary?: boolean;
      summaryMs?: number;
      cleanupMs?: number;
      reason?: string;
    } = {},
  ) {
    this.store.session(scope.workspaceId, scope.sessionId);
    const live = this.live.get(scope.sessionId);
    if (!live) return;
    if (
      live.run.status !== "stopping" ||
      (live.stopOptions?.summary && options.summary === false)
    ) {
      live.stopOptions = options;
      live.run.status = "stopping";
      this.store.db
        .prepare("UPDATE runs SET status='stopping' WHERE id=?")
        .run(live.run.id);
      this.views.changed(scope);
      if (live.child.connected)
        live.child.send({ type: "stop", ...options }, () => {});
      this.escalate(live, options.cleanupMs ?? 10000);
    }
    await live.exit;
    if (this.views.info(scope).run?.cleanup !== "confirmed")
      throw new AppError(
        "CLEANUP_UNCONFIRMED",
        "工作进程已退出，但外部进程清理未确认；禁止续跑，需检查后确认。",
      );
  }
  private escalate(live: Live, ms: number) {
    clearTimeout(live.timer);
    live.timer = setTimeout(() => {
      live.forced = true;
      if (process.platform === "win32" && live.child.pid) {
        const kill = spawn(
          join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
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
    }, ms);
  }
  affected(providers: string[]) {
    return [...this.live.values()]
      .filter((l) => providers.includes(l.run.selection.provider))
      .map((l) => ({
        ...l.scope,
        title: this.store.session(l.scope.workspaceId, l.scope.sessionId).title,
      }));
  }
  async stopProviders(providers: string[], confirmed: boolean) {
    const affected = this.affected(providers);
    const unconfirmed = this.store.db
      .prepare("SELECT selection FROM runs WHERE cleanup='unconfirmed'")
      .all()
      .some((row) =>
        providers.includes(JSON.parse(String(row.selection)).provider),
      );
    if (unconfirmed)
      throw new AppError(
        "CLEANUP_UNCONFIRMED",
        "受影响会话存在清理未确认的执行；请先检查并确认清理，再撤销认证。",
      );
    if (affected.length && !confirmed)
      throw new AppError(
        "ACTIVE_RUNS_CONFIRMATION_REQUIRED",
        `需先停止受影响会话：${affected.map((a) => a.title).join("、")}。确认后才退出登录。`,
      );
    for (const scope of affected) await this.stop(scope, { summary: false });
  }
  async close() {
    this.closing = true;
    await Promise.allSettled(
      [...this.live.values()].map((l) =>
        this.stop(l.scope, { summary: false }),
      ),
    );
  }
}
