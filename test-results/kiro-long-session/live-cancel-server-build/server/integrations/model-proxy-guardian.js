import { supervisorEnvironment } from "./component-environment.js";
import { MaintenanceError } from "../../shared/maintenance.js";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProcessOwner } from "../process-owner-record.js";
import { monotonicMilliseconds } from "../owned-process-linux.js";
import { forkMaintenanceProcess } from "../maintenance-process.js";
const activeOwners = new Set();
export const activeProxyOwner = (path) => activeOwners.has(path);
const uncertain = () => new MaintenanceError("stop-unconfirmed", "代理进程树尚未确认全部退出；归属记录与文件已保留，请核实后台进程后重试。");
/** Temporary subscription checks use the same maintenance lifecycle as installers. */
export class ProxyGuardian {
    owner;
    limits;
    signal;
    child;
    ready;
    closed;
    closing;
    requestedStop = false;
    service = false;
    confirmed = false;
    failure;
    owned;
    timer;
    abort;
    journal;
    constructor(owner, limits, signal) {
        this.owner = owner;
        this.limits = limits;
        this.signal = signal;
        signal.throwIfAborted();
        this.journal = createProcessOwner(join(dirname(owner), "process-owner.json"));
        const source = import.meta.url.endsWith(".ts");
        const entry = fileURLToPath(new URL(`./model-proxy-supervisor.${source ? "ts" : "js"}`, import.meta.url));
        const options = { env: supervisorEnvironment(), execArgv: source ? ["--import", import.meta.resolve("tsx")] : [] };
        try {
            this.owned = forkMaintenanceProcess(entry, options, this.deadline(), () => this.timeoutError(), identity => this.journal.arm(identity), dirname(owner));
            this.child = this.owned.child;
        }
        catch (error) {
            this.journal.confirmed();
            throw error;
        }
        activeOwners.add(owner);
        this.abort = () => { void this.stop().catch(() => { }); };
        this.closed = new Promise(resolve => {
            this.child.once("error", error => { this.failure ??= error; void this.cleanup().catch(() => { }); });
            this.child.once("close", async () => {
                this.requestedStop = true;
                clearInterval(this.timer);
                this.signal.removeEventListener("abort", this.abort);
                try {
                    await this.cleanup();
                    const failure = this.owned.failure();
                    if (failure instanceof MaintenanceError && failure.code === "stop-unconfirmed")
                        throw failure;
                    this.failure ??= failure;
                    this.journal.confirmed();
                    rmSync(this.owner, { force: true });
                    this.confirmed = true;
                }
                catch {
                    this.failure = uncertain();
                }
                activeOwners.delete(this.owner);
                resolve();
            });
        });
        this.timer = setInterval(() => {
            this.owned.setDeadline(this.deadline());
            if (!this.service && this.limits().remainingMs <= 0) {
                this.failure ??= this.timeoutError();
                this.abort();
            }
        }, 250);
        this.signal.addEventListener("abort", this.abort, { once: true });
        this.ready = this.owned.ready.then(() => {
            if (this.requestedStop || this.signal.aborted || this.failure)
                throw this.failure ?? this.signal.reason ?? Error("代理启动已取消。");
        }).catch(error => { this.failure ??= error; this.abort(); throw error; });
        void this.ready.catch(() => { });
        if (signal.aborted)
            this.abort();
    }
    timeoutError() { return new MaintenanceError(this.limits().code, "代理内核操作达到执行期限。"); }
    deadline() {
        // Running routes have a host heartbeat, independent of a finished start task.
        return monotonicMilliseconds() + (this.service ? 120_000 : this.limits().remainingMs);
    }
    cleanup() {
        this.requestedStop = true;
        return this.closing ??= this.owned.close();
    }
    async start(request) {
        await this.ready;
        if (this.requestedStop || this.signal.aborted)
            throw this.signal.reason ?? Error("代理启动已取消。");
        if (!this.service && this.limits().remainingMs <= 0)
            throw this.timeoutError();
        await new Promise((resolve, reject) => {
            this.child.send({ type: "start", ...request }, error => { if (error)
                reject(error);
            else
                resolve(); });
        });
    }
    promoteToService() {
        if (this.requestedStop || this.signal.aborted || this.failure)
            throw this.failure ?? this.signal.reason ?? Error("代理启动已取消。");
        if (this.limits().remainingMs <= 0)
            throw this.timeoutError();
        this.service = true;
        this.signal.removeEventListener("abort", this.abort);
        this.owned.setDeadline(this.deadline());
    }
    async stop(timeoutMs = 8000) {
        this.requestedStop = true;
        clearInterval(this.timer);
        this.signal.removeEventListener("abort", this.abort);
        void this.cleanup().catch(() => { });
        let timer;
        try {
            await Promise.race([this.closed, new Promise((_, reject) => { timer = setTimeout(() => reject(uncertain()), timeoutMs); })]);
            if (!this.confirmed)
                throw uncertain();
        }
        finally {
            clearTimeout(timer);
        }
    }
}
//# sourceMappingURL=model-proxy-guardian.js.map