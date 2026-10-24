import { MaintenanceError } from "../../shared/maintenance.js";
import { fork, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProcessOwner } from "../process-owner-record.js";
import { forkLinuxOwned, monotonicMilliseconds } from "../owned-process-linux.js";
import { ownWindowsPackageTree } from "../pi-package-windows.js";

type Limits = () => { remainingMs: number; code: "total-timeout" | "install-timeout" };
type Start = { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };
const activeOwners = new Set<string>();
export const activeProxyOwner = (path: string) => activeOwners.has(path);
const uncertain = () => new MaintenanceError("stop-unconfirmed", "代理进程树尚未确认全部退出；归属记录与文件已保留，请核实后台进程后重试。");

/** The supervisor reports kernel lifecycle only. Job/CLEANED is the tree proof. */
export class ProxyGuardian {
  readonly child: ChildProcess;
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  private closing?: Promise<void>;
  private requestedStop = false;
  private service = false;
  private confirmed = false;
  private failure?: Error;
  private linux?: ReturnType<typeof forkLinuxOwned>;
  private job?: ReturnType<typeof ownWindowsPackageTree>;
  private timer?: ReturnType<typeof setInterval>;
  private abort: () => void;
  private journal: ReturnType<typeof createProcessOwner>;

  constructor(private owner: string, private limits: Limits, private signal: AbortSignal) {
    signal.throwIfAborted();
    if (!["win32", "linux"].includes(process.platform)) throw new MaintenanceError("operation", "此平台尚不支持可靠的代理进程隔离，未启动内核。");
    this.journal = createProcessOwner(join(dirname(owner), "process-owner.json"));
    const source = import.meta.url.endsWith(".ts");
    const entry = fileURLToPath(new URL(`./model-proxy-supervisor.${source ? "ts" : "js"}`, import.meta.url));
    const options = { execArgv: source ? ["--import", import.meta.resolve("tsx")] : [] };
    try {
      this.linux = process.platform === "linux" ? forkLinuxOwned(entry, options, this.deadline(), () => this.timeoutError(), identity => this.journal.arm(identity)) : undefined;
      this.child = this.linux?.child ?? fork(entry, [], { ...options, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    } catch (error) { this.journal.confirmed(); throw error; }
    activeOwners.add(owner);
    this.abort = () => { void this.stop().catch(() => {}); };
    this.closed = new Promise(resolve => {
      this.child.once("error", error => { this.failure ??= error; void this.cleanup().catch(() => {}); });
      this.child.once("close", async () => {
        this.requestedStop = true;
        clearInterval(this.timer); this.signal.removeEventListener("abort", this.abort);
        try {
          await this.cleanup();
          const failure = this.linux?.failure();
          if (failure instanceof MaintenanceError && failure.code === "stop-unconfirmed") throw failure;
          this.failure ??= failure;
          this.journal.confirmed(); rmSync(this.owner, { force: true }); this.confirmed = true;
        } catch { this.failure = uncertain(); }
        activeOwners.delete(this.owner);
        resolve();
      });
    });
    this.timer = setInterval(() => {
      this.linux?.setDeadline(this.deadline());
      if (!this.service && this.limits().remainingMs <= 0) {
        this.failure ??= this.timeoutError(); this.abort();
      }
    }, 250);
    this.signal.addEventListener("abort", this.abort, { once: true });
    try {
      if (this.child.pid) {
        this.job = ownWindowsPackageTree(this.child.pid);
        if (this.job) this.journal.arm({ platform: "win32", workerPid: this.child.pid });
      }
    } catch (error) { this.failure = error as Error; this.abort(); }
    this.ready = (this.linux?.ready ?? Promise.resolve()).then(() => {
      if (this.requestedStop || this.signal.aborted || this.failure) throw this.failure ?? this.signal.reason ?? Error("代理启动已取消。");
    });
    void this.ready.catch(() => {});
    if (signal.aborted) this.abort();
  }
  private timeoutError() { return new MaintenanceError(this.limits().code, "代理内核操作达到执行期限。"); }
  private deadline() {
    // Running routes have a host heartbeat, independent of a finished start task.
    return monotonicMilliseconds() + (this.service ? 120_000 : this.limits().remainingMs);
  }
  private cleanup() {
    this.requestedStop = true;
    return this.closing ??= (async () => {
      if (this.linux) return this.linux.close();
      if (this.job) return this.job.close();
      // An unassigned Windows supervisor has never received business IPC.
      if (this.child.pid) this.child.kill();
    })();
  }
  async start(request: Start) {
    await this.ready;
    if (this.requestedStop || this.signal.aborted) throw this.signal.reason ?? Error("代理启动已取消。");
    if (!this.service && this.limits().remainingMs <= 0) throw this.timeoutError();
    await new Promise<void>((resolve, reject) => {
      this.child.send({ type: "start", ...request }, error => { if (error) reject(error); else resolve(); });
    });
  }
  promoteToService() {
    if (this.requestedStop || this.signal.aborted || this.failure) throw this.failure ?? this.signal.reason ?? Error("代理启动已取消。");
    if (this.limits().remainingMs <= 0) throw this.timeoutError();
    this.service = true;
    this.signal.removeEventListener("abort", this.abort);
    this.linux?.setDeadline(this.deadline());
  }
  async stop(timeoutMs = 8000) {
    this.requestedStop = true;
    clearInterval(this.timer); this.signal.removeEventListener("abort", this.abort);
    void this.cleanup().catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(uncertain()), timeoutMs); })]);
      if (!this.confirmed) throw uncertain();
    } finally { clearTimeout(timer); }
  }
}
