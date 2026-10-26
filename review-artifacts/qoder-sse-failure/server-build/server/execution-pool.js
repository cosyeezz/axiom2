import { randomUUID } from "node:crypto";
import { fork, spawn } from "node:child_process";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { AppError } from "../shared/protocol.js";
import { sameLease } from "./execution-protocol.js";
import { rejectExecution, safeExecutionRejection } from "./execution-diagnostics.js";
function deferred() {
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    void promise.catch(() => { });
    return { promise, resolve, reject };
}
const defaults = { maxLiveProcesses: 24, maxIdleRetained: 4, targetReadyTotal: 1, nestedLeafReserve: 1,
    maxPrewarming: 1, idleTtlMs: 15 * 60 * 1000, maxLifetimeMs: 15 * 60 * 1000, maxQueued: 256, prepareTimeoutMs: 30000 };
/** One service-owned physical pool; business queues and task budgets stay with their managers. */
export class ExecutionPool {
    limits;
    mode;
    onMetric;
    instances = new Map();
    waiters = [];
    recent = new Map();
    backoff = new Map();
    generation = 0;
    stopping = false;
    maintaining = false;
    pumping = false;
    scheduled = false;
    peak = 0;
    created = 0;
    unused = 0;
    validations = new Set();
    constructor(limits = {}, mode = process.env.AXIOM_EXECUTION_MODE === "C" ? "C" : process.env.AXIOM_EXECUTION_MODE === "managed" ? "managed" : "D") {
        this.limits = { ...defaults, ...limits };
        this.mode = mode;
        const l = this.limits;
        if (Object.values(l).some(v => !Number.isSafeInteger(v) || v < 0) || l.nestedLeafReserve < 1 || l.maxLiveProcesses <= l.nestedLeafReserve ||
            l.maxIdleRetained > l.maxLiveProcesses || l.targetReadyTotal > l.maxIdleRetained || l.maxPrewarming > l.maxLiveProcesses || !l.idleTtlMs || !l.maxLifetimeMs || !l.maxQueued || !l.prepareTimeoutMs)
            throw Error("Invalid execution pool limits");
    }
    metric(i, phase, extra = {}) {
        this.onMetric?.({ phase, instanceId: i.id, generation: i.generation, leaseId: i.lease?.ref.leaseId, profileHash: i.environment.profileHash, ...extra });
    }
    stats() {
        const rows = [...this.instances.values()];
        return { live: rows.filter(i => i.child).length, reserved: rows.filter(i => !i.child).length, total: rows.length,
            leased: rows.filter(i => i.lease).length, ordinary: rows.filter(i => i.lease && !i.lease.request.parentLease).length,
            memory: rows.filter(i => i.lease?.request.memory).length, idle: rows.filter(i => i.state === 'available').length,
            preparing: rows.filter(i => i.state === 'preparing').length, retiring: rows.filter(i => ['retiring', 'exiting'].includes(i.state)).length,
            queued: this.waiters.length, peak: this.peak, created: this.created, unused: this.unused };
    }
    isActive(ref) {
        const i = ref && this.instances.get(ref.instanceId);
        return Boolean(i && i.state === 'leased' && sameLease(i.lease?.ref, ref) && !i.lease?.request.signal.aborted);
    }
    acquire(request) {
        if (this.stopping)
            return Promise.reject(new AppError("SHUTTING_DOWN", "执行池正在关闭"));
        if (this.maintaining)
            return Promise.reject(new AppError("MAINTENANCE_BUSY", "正在清理托管组件，请稍后再开始执行。"));
        if (request.signal.aborted || request.deadlineAt !== undefined && request.deadlineAt <= Date.now())
            return Promise.reject(new AppError("AGENT_STOPPED", "执行资源等待已取消或超时"));
        if (request.parentLease && (request.kind !== 'memory-query' || !this.isActive(request.parentLease)))
            return Promise.reject(new AppError("AGENT_STOPPED", "父执行已经结束"));
        const waiter = { request, at: performance.now(), done: deferred(), abort: () => { this.remove(waiter); waiter.done.reject(new AppError("AGENT_STOPPED", "执行资源等待已取消或超时")); this.schedule(); } };
        this.waiters.push(waiter);
        request.signal.addEventListener('abort', waiter.abort, { once: true });
        if (request.deadlineAt !== undefined)
            waiter.timer = setTimeout(waiter.abort, Math.max(0, request.deadlineAt - Date.now()));
        this.pump();
        // Try immediate admission before applying the waiting-only limits (queue=0 is valid).
        if (this.waiters.includes(waiter) && (this.waiters.length > this.limits.maxQueued || request.memory && this.waiters.filter(w => w.request.memory).length > request.memory.queue)) {
            this.remove(waiter);
            waiter.done.reject(new AppError(request.memory ? 'MEMORY_BUSY' : 'EXECUTION_BUSY', request.memory ? '记忆查询队列已满' : '执行资源等待队列已满'));
        }
        return waiter.done.promise;
    }
    remove(w) { const at = this.waiters.indexOf(w); if (at >= 0)
        this.waiters.splice(at, 1); w.request.signal.removeEventListener('abort', w.abort); clearTimeout(w.timer); }
    eligible(r) {
        const owned = [...this.instances.values()].filter(i => i.lease);
        if (r.memory && owned.filter(i => i.lease.request.memory).length >= r.memory.concurrency)
            return false;
        return Boolean(r.parentLease) || owned.filter(i => !i.lease.request.parentLease).length < this.limits.maxLiveProcesses - this.limits.nestedLeafReserve;
    }
    compatible(i, r) {
        if (!['available', 'preparing'].includes(i.state) || i.lease || i.environment.profileHash !== r.environment.profileHash)
            return false;
        if (Date.now() - i.bornAt >= this.limits.maxLifetimeMs || !i.environment.snapshotValid()) {
            void this.retireInstance(i, 'expired');
            return false;
        }
        if (i.binding)
            return Boolean(r.affinity && i.binding.sessionId === r.affinity.sessionId && i.binding.fileRevision === r.affinity.fileRevision);
        return !i.consumed || i.environment.reuse === 'cross-binding';
    }
    pump() {
        if (this.pumping || this.stopping || this.maintaining)
            return;
        this.pumping = true;
        try {
            for (const w of [...this.waiters]) {
                const r = w.request;
                if (r.signal.aborted || r.deadlineAt !== undefined && r.deadlineAt <= Date.now() || r.parentLease && !this.isActive(r.parentLease)) {
                    w.abort();
                    continue;
                }
                if (!this.eligible(r))
                    continue;
                // A retained SessionBinding remains the sole JSONL writer until actual close.
                const owners = r.affinity ? [...this.instances.values()].filter(i => (i.binding ?? i.lease?.request.affinity)?.sessionId === r.affinity.sessionId) : [];
                const compatibility = new Map();
                const compatible = (i) => { if (!compatibility.has(i))
                    compatibility.set(i, this.compatible(i, r)); return compatibility.get(i); };
                if (owners.some(i => !compatible(i))) {
                    for (const owner of owners)
                        if (!owner.lease)
                            void this.retireInstance(owner, 'affinity_changed');
                    continue;
                }
                const available = [...this.instances.values()].filter(compatible);
                available.sort((a, b) => Number(Boolean(b.binding)) - Number(Boolean(a.binding)) || Number(Boolean(b.environmentReadyAt)) - Number(Boolean(a.environmentReadyAt)) || Number(Boolean(b.processReadyAt)) - Number(Boolean(a.processReadyAt)));
                let i = available[0];
                const cold = !i;
                if (!i && this.instances.size < this.limits.maxLiveProcesses)
                    i = this.create(r.environment);
                if (!i) {
                    // A pending physical close already supplies this gap. Do not evict the whole idle set.
                    if (![...this.instances.values()].some(i => i.state === 'retiring' || i.state === 'exiting')) {
                        const victim = [...this.instances.values()].filter(i => !i.lease && ['available', 'preparing'].includes(i.state)).sort((a, b) => a.lastUsed - b.lastUsed)[0];
                        if (victim)
                            void this.retireInstance(victim, 'demand');
                    }
                    continue;
                }
                this.remove(w);
                clearTimeout(i.idleTimer);
                const source = cold ? 'cold' : i.binding ? 'affinity' : i.environmentReadyAt ? 'environment' : i.processReadyAt ? 'process' : 'preparing';
                const ref = Object.freeze({ instanceId: i.id, generation: i.generation, leaseId: randomUUID() });
                const instance = i, done = deferred();
                const abort = () => { void this.retire(ref, 'cancelled'); };
                i.lease = { ref, request: r, done, abort, source };
                i.state = 'leased';
                i.cleaned = undefined;
                i.lastUsed = Date.now();
                r.signal.addEventListener('abort', abort, { once: true });
                this.remember(r.environment);
                const hit = source === 'affinity' ? 'affinity_hit' : cold ? 'cold_start' : i.environmentReadyAt !== undefined && i.environmentReadyAt <= r.requestStartedAtMonoMs ? 'environment_hit' : i.processReadyAt !== undefined && i.processReadyAt <= r.requestStartedAtMonoMs ? 'process_hit' : 'preparation_inflight';
                this.metric(i, 'acquired', { source, hit, kind: r.kind, durationMs: performance.now() - w.at, requestStartedAtMonoMs: r.requestStartedAtMonoMs, processReadyAt: i.processReadyAt, environmentReadyAt: i.environmentReadyAt });
                let ready;
                w.done.resolve({ ref, source, environment: i.environment, released: done.promise, beforeExecute: r.beforeExecute, validateEnvironment: () => this.verify(instance), ensureReady: () => {
                        if (ready)
                            return ready;
                        const begin = performance.now();
                        ready = (async () => { if (!this.isActive(ref))
                            throw new AppError('AGENT_STOPPED', '执行租约已失效'); const child = await this.start(instance); if (!this.isActive(ref))
                            throw new AppError('AGENT_STOPPED', '准备期间执行已停止'); if (!instance.environment.current(!(r.kind === 'agent' && r.bindingGate)) || !instance.environment.snapshotValid())
                            throw new AppError('REVISION_CONFLICT', '准备期间配置或模型快照已变化'); this.metric(instance, 'ready_wait', { durationMs: performance.now() - begin }); return child; })();
                        void ready.catch(() => { });
                        return ready;
                    } });
            }
        }
        finally {
            this.pumping = false;
        }
        this.schedule();
    }
    create(environment) {
        environment.retain();
        const i = { id: randomUUID(), generation: ++this.generation, environment, state: 'preparing', bornAt: Date.now(), lastUsed: Date.now(), consumed: false, validationAbort: new AbortController(), processReady: deferred(), environmentReady: deferred(), closed: deferred() };
        this.instances.set(i.id, i);
        this.peak = Math.max(this.peak, this.instances.size);
        return i;
    }
    start(i) {
        if (i.ready)
            return i.ready;
        i.ready = (async () => {
            if (this.stopping || !this.instances.has(i.id) || ['retiring', 'exiting', 'exited'].includes(i.state))
                throw new AppError('AGENT_STOPPED', '创建预留已撤销');
            const begin = performance.now(), e = i.environment;
            const timeout = setTimeout(() => {
                i.processReady.reject(Error('工作进程准备超时'));
                i.environmentReady.reject(Error('执行环境准备超时'));
                void this.retireInstance(i, 'prepare_timeout');
            }, this.limits.prepareTimeoutMs);
            try {
                const child = fork(e.workerPath, [], { cwd: e.cwd, execArgv: e.execArgv, env: { ...e.env, AXIOM_EXECUTION_INSTANCE: i.id, AXIOM_EXECUTION_GENERATION: String(i.generation), AXIOM_EXECUTION_PROFILE: e.profileHash }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], detached: process.platform !== 'win32' });
                i.child = child;
                this.created++;
                child.stderr?.resume();
                child.on('error', () => { i.processReady.reject(Error('工作进程启动失败')); i.environmentReady.reject(Error('执行环境准备失败')); });
                child.on('message', (event) => {
                    if (event.instance?.instanceId === i.id && event.instance?.generation === i.generation && event.instance?.profileHash === e.profileHash) {
                        if (event.type === 'process_ready') {
                            i.processReadyAt = performance.now();
                            i.processReady.resolve();
                            this.metric(i, 'process_ready', { durationMs: performance.now() - begin });
                        }
                        if (event.type === 'environment_ready') {
                            i.environmentReadyAt = performance.now();
                            i.environmentReady.resolve();
                            this.metric(i, 'environment_ready', { durationMs: event.durationMs });
                        }
                        if (event.type === 'prepare_failed') {
                            i.environmentReady.reject(Error('执行环境准备失败'));
                            void this.retireInstance(i, 'prepare_failed');
                        }
                    }
                    if (sameLease(event.lease, i.lease?.ref)) {
                        if (event.type === 'binding_ready')
                            void this.permit(i, event.lease);
                        if (event.type === 'cleaned' || event.type === 'idle')
                            i.cleaned = event.lease.leaseId;
                        if (event.type === 'provider_request' || event.type === 'execution_phase')
                            this.metric(i, event.type, { durationMs: event.durationMs, stage: event.stage, prepareEndpoint: 'hook_observed', observedAtMonoMs: performance.now() });
                    }
                });
                child.once('close', () => this.closed(i));
                await i.processReady.promise;
                if (['retiring', 'exiting', 'exited'].includes(i.state))
                    throw Error('执行环境已退役');
                if (e.environmentWarm) {
                    child.send({ type: 'prepare', instance: { instanceId: i.id, generation: i.generation, profileHash: e.profileHash }, input: { root: e.root, cwd: e.cwd, modelsFile: e.modelsFile } }, error => { if (error) {
                        i.environmentReady.reject(error);
                        void this.retireInstance(i, 'send_failed');
                    } });
                    await i.environmentReady.promise;
                }
                if (!i.lease) {
                    i.state = 'available';
                    this.idle(i);
                }
                return child;
            }
            catch (error) {
                this.backoff.set(e.profileHash, Date.now() + 30000);
                await this.retireInstance(i, 'prepare_failed');
                throw error;
            }
            finally {
                clearTimeout(timeout);
            }
        })();
        void i.ready.catch(() => { });
        return i.ready;
    }
    verify(i, onReject) {
        const pending = (async () => {
            try {
                return await (i.environment.currentAsync?.(i.validationAbort.signal, onReject) ?? i.environment.current(true, onReject));
            }
            catch {
                return rejectExecution(onReject, { check: 'verification' });
            }
        })();
        this.validations.add(pending);
        void pending.then(() => this.validations.delete(pending));
        return pending;
    }
    async permit(i, ref) {
        const lease = i.lease;
        if (!lease || !sameLease(lease.ref, ref) || !this.isActive(ref) || lease.permit)
            return;
        // A duplicate binding_ready must never produce a rejection after an earlier grant.
        lease.permit = 'checking';
        let rejection;
        // Per invocation, not instance state: overlapping validations cannot overwrite this rejection.
        const observe = value => {
            try {
                rejection ??= safeExecutionRejection(value);
            }
            catch { /* Diagnostics cannot change a custom environment's admission. */ }
        };
        const verified = await this.verify(i, observe);
        // Validation yields to cancellation and process close. Never apply its result to a successor.
        if (i.lease !== lease || i.state !== 'leased' || !i.child)
            return;
        let allowed = (verified || rejectExecution(observe, { check: 'verification' })) &&
            (this.isActive(ref) || rejectExecution(observe, { check: 'lease_inactive' })) &&
            (i.environment.current(false, observe) || rejectExecution(observe, { check: 'verification', stage: 'configuration' })) &&
            (i.environment.snapshotValid(observe) || rejectExecution(observe, { check: 'snapshot' }));
        if (allowed) {
            try {
                lease.request.beforeExecute?.();
            }
            catch {
                allowed = rejectExecution(observe, { check: 'before_execute' });
            }
        }
        lease.permit = allowed ? 'allowed' : 'denied';
        if (!allowed)
            rejectExecution(lease.request.onBindingRejected, rejection ?? { check: 'verification' });
        try {
            i.child.send({ type: 'execution_permit', lease: ref, allowed,
                ...(!allowed ? { rejection: safeExecutionRejection(rejection) } : {}) }, error => { if (error)
                void this.retireInstance(i, 'send_failed'); });
        }
        catch {
            void this.retireInstance(i, 'send_failed');
            return;
        }
        // A denied permit already makes the run fail and close itself. Sending
        // shutdown as well can cancel it or close IPC before its failure is sent.
        if (!allowed) {
            // This diagnostic has no IDs, hashes, paths or arbitrary exception fields.
            rejectExecution(value => this.onMetric?.({ phase: 'binding_rejected', rejection: value }), rejection ?? { check: 'verification' });
            void this.retireInstance(i, 'binding_changed', false);
        }
    }
    releaseOwner(i) {
        const lease = i.lease;
        if (!lease)
            return;
        lease.request.signal.removeEventListener('abort', lease.abort);
        i.lease = undefined;
        lease.done.resolve();
    }
    async release(ref, result) {
        const i = this.instances.get(ref.instanceId);
        if (!i || !sameLease(i.lease?.ref, ref))
            return;
        if (i.cleaned !== ref.leaseId)
            throw Error('Worker cleanup has not acknowledged this lease');
        if (i.state !== 'leased')
            return i.closed.promise;
        i.state = 'cleaning';
        i.consumed = true;
        if (this.stopping || i.environment.reuse === 'single-use' || i.environment.reuse === 'same-session' && !result.keepSession || Date.now() - i.bornAt >= this.limits.maxLifetimeMs)
            return this.retireInstance(i, 'not_reusable');
        i.binding = result.keepSession ? result.affinity : undefined;
        if (result.keepSession && !i.binding)
            throw Error('Session affinity is required');
        this.metric(i, 'released');
        this.releaseOwner(i);
        i.state = 'available';
        i.lastUsed = Date.now();
        // Fixed memory retains only its runtime; every loader/settings/session is freshly bound.
        if (i.environment.environmentWarm)
            i.environmentReadyAt = performance.now();
        this.idle(i);
        this.pump();
    }
    retire(ref, reason, force = false) {
        const i = this.instances.get(ref.instanceId);
        if (!i || !sameLease(i.lease?.ref, ref))
            return Promise.resolve();
        const closed = this.retireInstance(i, reason);
        // Revoke reuse synchronously before any asynchronous OS termination.
        if (force && i.child)
            this.kill(i.child);
        return closed;
    }
    retireInstance(i, reason, sendShutdown = true) {
        if (['retiring', 'exiting', 'exited'].includes(i.state))
            return i.closed.promise;
        i.state = 'retiring';
        i.validationAbort.abort();
        clearTimeout(i.idleTimer);
        this.metric(i, 'retiring', { reason });
        i.processReady.reject(Error('工作进程已停止'));
        i.environmentReady.reject(Error('执行环境已停止'));
        if (!i.child) {
            this.closed(i);
            return i.closed.promise;
        }
        const child = i.child;
        i.state = 'exiting';
        // OAuth refresh may finish credential persistence under its own 15s deadline after cancellation.
        i.killTimer = setTimeout(() => this.kill(child), i.environment.entry === 'memory' ? 20000 : 2000);
        if (sendShutdown)
            try {
                if (child.connected)
                    child.send({ type: 'shutdown', instance: { instanceId: i.id, generation: i.generation, profileHash: i.environment.profileHash }, lease: i.lease?.ref }, error => { if (error)
                        this.kill(child); });
                else
                    this.kill(child);
            }
            catch {
                this.kill(child);
            }
        return i.closed.promise;
    }
    kill(child) {
        if (child.exitCode !== null || child.signalCode !== null)
            return;
        if (process.platform === 'win32' && child.pid) {
            const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
            const fallback = () => { if (child.exitCode === null && child.signalCode === null)
                child.kill('SIGKILL'); };
            const deadline = setTimeout(() => { killer.kill(); fallback(); }, 2000);
            killer.on('error', () => { clearTimeout(deadline); fallback(); });
            killer.once('close', code => { clearTimeout(deadline); if (code !== 0)
                fallback(); });
        }
        else if (child.pid) {
            try {
                process.kill(-child.pid, 'SIGKILL');
            }
            catch {
                child.kill('SIGKILL');
            }
        }
    }
    closed(i) {
        if (i.state === 'exited')
            return;
        clearTimeout(i.killTimer);
        clearTimeout(i.idleTimer);
        i.state = 'exited';
        i.validationAbort.abort();
        i.processReady.reject(Error('工作进程已关闭'));
        i.environmentReady.reject(Error('执行环境已关闭'));
        if (!i.consumed && !i.lease)
            this.unused++;
        this.releaseOwner(i);
        this.instances.delete(i.id);
        try {
            i.environment.release();
        }
        catch { /* Cleanup must not interrupt later process-close listeners. */ }
        finally {
            i.closed.resolve();
            this.schedule();
        }
    }
    idle(i) {
        clearTimeout(i.idleTimer);
        i.idleTimer = setTimeout(() => { void this.retireInstance(i, 'idle_ttl'); }, Math.max(1, Math.min(this.limits.idleTtlMs, i.bornAt + this.limits.maxLifetimeMs - Date.now())));
        i.idleTimer.unref();
        const idle = [...this.instances.values()].filter(i => i.state === 'available' && !i.lease).sort((a, b) => a.lastUsed - b.lastUsed);
        while (idle.length > this.limits.maxIdleRetained)
            void this.retireInstance(idle.shift(), 'idle_limit');
    }
    remember(e) {
        const old = this.recent.get(e.profileHash), lastDemandAt = Date.now();
        if (old?.environment.snapshotValid()) {
            this.recent.delete(e.profileHash);
            this.recent.set(e.profileHash, { environment: old.environment, lastDemandAt });
            return;
        }
        if (old) {
            this.recent.delete(e.profileHash);
            old.environment.release();
        }
        e.retain();
        this.recent.set(e.profileHash, { environment: e, lastDemandAt });
        while (this.recent.size > 8) {
            const [key, value] = this.recent.entries().next().value;
            this.recent.delete(key);
            value.environment.release();
        }
    }
    schedule() {
        if (this.scheduled || this.stopping)
            return;
        this.scheduled = true;
        setImmediate(() => { this.scheduled = false; this.pumpOnce(); });
    }
    pumpOnce() {
        // pump schedules only after a real change; do not spin on blocked waiters.
        if (this.waiters.length) {
            this.scheduled = true;
            this.pump();
            this.scheduled = false;
        }
        this.prewarm();
    }
    prewarm() {
        if (this.stopping || this.maintaining)
            return;
        const now = Date.now();
        // Only real admitted demand renews this window; idle retirement must not feed prewarming forever.
        for (const [key, value] of this.recent)
            if (now - value.lastDemandAt >= this.limits.idleTtlMs) {
                this.recent.delete(key);
                value.environment.release();
            }
        if (this.mode === 'managed' || this.waiters.length)
            return;
        const rows = [...this.instances.values()], free = rows.filter(i => !i.lease && !i.binding && ['available', 'preparing'].includes(i.state));
        if (free.length >= this.limits.targetReadyTotal || free.filter(i => i.state === 'preparing').length >= this.limits.maxPrewarming || rows.length >= this.limits.maxLiveProcesses)
            return;
        const e = [...this.recent.values()].reverse().map(value => value.environment).find(e => (this.backoff.get(e.profileHash) ?? 0) <= Date.now() && e.prewarmAllowed !== false && !free.some(i => i.environment.profileHash === e.profileHash) && e.current() && e.snapshotValid());
        if (!e)
            return;
        const i = this.create(e);
        void this.start(i).then(() => this.schedule()).catch(() => { });
    }
    hasAffinity(sessionId) { return [...this.instances.values()].some(i => (i.binding ?? i.lease?.request.affinity)?.sessionId === sessionId); }
    async releaseAffinity(sessionId) { await Promise.all([...this.instances.values()].filter(i => (i.binding ?? i.lease?.request.affinity)?.sessionId === sessionId && (!i.lease || i.state === 'retiring' || i.state === 'exiting')).map(i => this.retireInstance(i, 'session_handoff'))); }
    async invalidate(providers) {
        for (const [key, { environment: e }] of this.recent)
            if (!providers || !e.provider || providers.includes(e.provider)) {
                this.recent.delete(key);
                e.release();
            }
        await Promise.all([...this.instances.values()].filter(i => !i.lease && (!providers || !i.environment.provider || providers.includes(i.environment.provider))).map(i => this.retireInstance(i, 'configuration')));
    }
    async trim() { for (const { environment: e } of this.recent.values())
        e.release(); this.recent.clear(); await Promise.all([...this.instances.values()].filter(i => !i.lease).map(i => this.retireInstance(i, 'trim'))); }
    /** Quiesce retained workers before removing programs they may have cached. */
    async maintenance(operation) {
        if (this.stopping || this.maintaining || this.waiters.length || [...this.instances.values()].some(i => i.lease))
            throw new AppError("MAINTENANCE_BUSY", "仍有执行或维护任务，请结束后再卸载组件。");
        this.maintaining = true;
        try {
            await this.trim();
            if (this.stopping)
                throw new AppError("SHUTTING_DOWN", "执行池正在关闭。");
            return await operation();
        }
        finally {
            this.maintaining = false;
            this.schedule();
        }
    }
    async waitForPrewarm() { this.prewarm(); await Promise.all([...this.instances.values()].filter(i => !i.lease && i.ready).map(i => i.ready.catch(() => { }))); }
    async close() {
        this.stopping = true;
        for (const w of [...this.waiters])
            w.abort();
        for (const { environment: e } of this.recent.values())
            e.release();
        this.recent.clear();
        await Promise.all([...this.instances.values()].map(i => this.retireInstance(i, 'shutdown')));
        await Promise.all(this.validations);
    }
}
//# sourceMappingURL=execution-pool.js.map