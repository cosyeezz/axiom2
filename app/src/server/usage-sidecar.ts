import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ModelUsageLedger, usageRecordFilter } from "./model-usage-ledger.js";
import { emptyUsagePage, emptyUsageStatistics, usageView, type UsageSidecarOptions } from "./usage-sidecar-engine.js";
import type { ModelUsageStatistics, UsageRecordFilter, UsageRecordPage } from "../shared/model-usage.js";
import { AppError } from "../shared/protocol.js";
import type { Store } from "./storage.js";

type Pending = { finish: (value: any) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> };
/** No model/message/compression subscriptions. A failed worker is never replaced by an in-process scan. */
export class UsageSidecar {
  private readonly directory: ModelUsageLedger;
  private child?: ChildProcess;
  private ready = false;
  private closed = false;
  private started = false;
  private failures = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private pending = new Map<number, Pending>();
  private queued = new Map<string, { params: UsageRecordFilter; kind: "ledger" | "statistics" }>();
  private sequence = 0;
  constructor(private readonly store: Pick<Store, "db" | "root">, private readonly modelsDir: string, private readonly options: UsageSidecarOptions = {}) {
    this.directory = new ModelUsageLedger(store, modelsDir);
  }
  workspaces() { return this.directory.workspaces(); }
  sessions(input: unknown = {}) { return this.directory.sessions(input); }
  get status() { return { pid: this.child?.pid, ready: this.ready, pending: this.pending.size, restarts: this.failures }; }
  start() { if (this.started || this.closed) return; this.started = true; this.spawn(); }
  private spawn() {
    if (this.closed || this.child) return;
    const ts = import.meta.url.endsWith(".ts");
    let child: ChildProcess;
    try {
      child = fork(fileURLToPath(new URL(`./usage-sidecar-worker.${ts ? "ts" : "js"}`, import.meta.url)), [], {
        execArgv: [...(ts ? ["--import", import.meta.resolve("tsx")] : []), "--max-old-space-size=256"],
        stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...process.env, AXIOM_USAGE_SIDECAR: "1" },
      });
    } catch { this.restart(); return; }
    this.child = child; child.unref(); child.channel?.unref();
    const startup = setTimeout(() => { if (this.child === child && !this.ready) child.kill("SIGKILL"); }, 10_000); startup.unref();
    const failed = () => {
      clearTimeout(startup);
      if (this.child !== child) return;
      this.child = undefined; this.ready = false;
      for (const [id, request] of this.pending) { clearTimeout(request.timer); request.finish(undefined); this.pending.delete(id); }
      this.restart();
    };
    child.on("message", (message: any) => {
      if (this.child !== child) return;
      if (message?.type === "ready") {
        clearTimeout(startup); this.ready = true;
        for (const value of this.queued.values()) this.send({ type: "read", id: 0, ...value });
        this.queued.clear(); return;
      }
      if (message?.type !== "result") return;
      const request = this.pending.get(message.id); if (!request) return;
      this.pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new AppError(message.error.code ?? "INVALID_INPUT", message.error.message ?? "用量查询失败。"));
      else request.finish(message.value);
    });
    child.once("exit", failed);
    child.once("error", () => { child.kill("SIGKILL"); failed(); });
    this.send({ type: "init", root: this.store.root, modelsDir: this.modelsDir, options: this.options });
  }
  private restart() {
    if (this.closed || this.retry) return;
    this.failures++;
    this.retry = setTimeout(() => { this.retry = undefined; this.spawn(); }, Math.min(30_000, 1000 * 2 ** Math.min(5, this.failures - 1)));
    this.retry.unref();
  }
  private send(value: unknown) {
    const child = this.child; if (!child?.connected || this.closed) return;
    child.send(value as any, error => { if (error && this.child === child) child.kill("SIGKILL"); });
  }
  async read(input: unknown = {}): Promise<UsageRecordPage> {
    const params = usageRecordFilter(input);
    return await this.query(params, "ledger") as UsageRecordPage | undefined ?? emptyUsagePage(params, this.failures ? "error" : "preparing");
  }
  async statistics(workspaceId?: string): Promise<ModelUsageStatistics> {
    const params = usageRecordFilter({ workspaceId });
    return await this.query(params, "statistics") as ModelUsageStatistics | undefined ?? emptyUsageStatistics(this.failures ? "error" : "preparing");
  }
  private query(params: UsageRecordFilter, kind: "ledger" | "statistics"): Promise<unknown> {
    if (this.closed) return Promise.resolve(undefined);
    if (!this.ready) {
      const { key } = usageView(params, kind); this.queued.delete(key); this.queued.set(key, { params, kind });
      while (this.queued.size > 32) this.queued.delete(this.queued.keys().next().value!);
      return Promise.resolve(undefined);
    }
    if (this.pending.size >= 16) return Promise.resolve(undefined);
    return new Promise((finish, reject) => {
      const id = ++this.sequence;
      const child = this.child;
      const timer = setTimeout(() => {
        finish(undefined);
        // A timed-out message is still on the wire. Keep its slot until ACK/exit,
        // otherwise repeated callers could create an unbounded IPC backlog.
        const request = this.pending.get(id); if (!request) return;
        request.timer = setTimeout(() => { if (child && this.child === child) child.kill("SIGKILL"); }, 9500); request.timer.unref();
      }, 500);
      this.pending.set(id, { finish, reject, timer }); this.send({ type: "read", id, params, kind });
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true; this.ready = false; clearTimeout(this.retry);
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.finish(undefined); }
    this.pending.clear(); this.queued.clear();
    const child = this.child; this.child = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1500);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
        if (child.connected) child.send({ type: "close" }, () => {}); else child.kill("SIGTERM");
      });
    }
    await this.directory.close();
  }
}
