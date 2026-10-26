import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { AppError } from "../shared/protocol.js";
import { ExecutionPool } from "./execution-pool.js";
import { ExecutionProfiles } from "./execution-profile.js";
import { memoryIncompleteMessages } from "../shared/memory.js";
import { sameLease } from "./execution-protocol.js";
export class PooledMemoryRunner {
    memories;
    models;
    jobs = new Set();
    stopped = false;
    pool;
    profiles;
    ownsPool;
    constructor(memories, models, pool, profiles) {
        this.memories = memories;
        this.models = models;
        this.ownsPool = !pool;
        this.pool = pool ?? new ExecutionPool();
        this.profiles = profiles ?? new ExecutionProfiles(memories.store.root);
    }
    execute(input) {
        const started = performance.now();
        const job = { controller: new AbortController(), provider: input.selection.provider };
        this.jobs.add(job);
        const promise = this.run(input, job.controller, started).finally(() => this.jobs.delete(job));
        job.promise = promise;
        return promise;
    }
    async run(input, controller, requestStartedAtMonoMs) {
        if (this.stopped)
            throw Error("记忆执行器已关闭");
        const preferences = this.memories.preferences();
        const deadlineAt = input.deadlineAt ?? Date.now() + preferences.timeoutMs;
        const remaining = Math.max(0, deadlineAt - Date.now());
        if (!remaining)
            throw Error('记忆执行已超时；未返回完整结果');
        const timeout = AbortSignal.timeout(remaining);
        const timeoutError = () => Error(`记忆执行时限已到（${Math.round((input.deadlineAt ? remaining : preferences.timeoutMs) / 1000)} 秒，含排队）；请在记忆设置中提高执行时限后重试`);
        const signal = AbortSignal.any([controller.signal, timeout, ...(input.signal ? [input.signal] : [])]);
        signal.throwIfAborted();
        const stage = (name) => { if (input.processingId)
            this.memories.records.stage(input.processingId, name, input.selection); };
        stage("准备模型配置");
        const cwd = this.memories.store.workspace(input.scope.workspaceId).path;
        const environment = this.profiles.prepare({ entry: 'memory', cwd, modelDir: this.models.dir, modelsRaw: await this.models.raw(), selection: input.selection, mode: this.pool.mode });
        let lease;
        try {
            stage("等待执行资源");
            lease = await this.pool.acquire({ environment, kind: input.kind === 'title' ? 'session-title' : input.kind === 'query' ? 'memory-query' : 'memory-organize', requestStartedAtMonoMs, signal, deadlineAt, parentLease: input.parentLease, memory: { concurrency: preferences.concurrency, queue: preferences.queue }, beforeExecute: () => this.memories.owner(input.scope) });
            if (!environment.current())
                throw Error('记忆模型配置已变化，请重试');
            stage("准备执行环境");
            const child = await lease.ensureReady();
            signal.throwIfAborted();
            if (!environment.current())
                throw Error('记忆模型配置在准备期间变化，请重试');
            this.memories.owner(input.scope);
            stage("准备发送模型请求");
            const revisionAware = input;
            return await this.observe(child, lease, revisionAware, signal, { kind: input.kind, executionGate: true, root: this.memories.store.root, cwd, modelsFile: lease.environment.modelsFile, selection: input.selection, prompt: input.prompt, systemPrompt: input.systemPrompt });
        }
        catch (error) {
            if (lease)
                await this.pool.retire(lease.ref, 'memory_failed');
            if (timeout.aborted)
                throw timeoutError();
            if (signal.aborted)
                throw new AppError('MEMORY_CANCELLED', '记忆执行已取消；未返回完整结果');
            throw error;
        }
        finally {
            environment.release();
        }
    }
    observe(child, lease, input, signal, start) {
        return new Promise((resolve, reject) => {
            let result, failure, settled = false;
            let reap;
            const charges = new Map();
            const cleanup = () => { clearTimeout(reap); signal.removeEventListener('abort', abort); child.removeListener('message', message); child.removeListener('error', error); child.removeListener('close', close); };
            const finish = (err) => { if (settled)
                return; settled = true; cleanup(); if (err)
                reject(err);
            else
                resolve(result); };
            const send = (value) => { try {
                if (child.connected)
                    child.send({ ...value, lease: lease.ref }, error => { if (error) {
                        failure = Error('记忆工作进程通信失败');
                        void this.pool.retire(lease.ref, 'ipc_failed');
                    } });
            }
            catch {
                failure = Error('记忆工作进程通信失败');
                void this.pool.retire(lease.ref, 'ipc_failed');
            } };
            const abort = () => { failure = Error('记忆执行已取消或超时；未返回完整结果'); send({ type: 'stop' }); void this.pool.retire(lease.ref, 'memory_cancel'); };
            const error = () => { failure = Error('记忆工作进程异常'); };
            const close = () => finish(failure ?? Error('记忆进程未正常完成，未发布结果。'));
            const message = (event) => {
                if (!sameLease(event.lease, lease.ref) || settled)
                    return;
                try {
                    // Already incurred usage always belongs to this original lease, including after cancellation.
                    if (event.type === 'usage') {
                        const id = charges.get(event.id) ?? randomUUID();
                        charges.set(event.id, id);
                        this.memories.store.db.prepare('INSERT INTO memory_usage(id,sessionId,kind,provider,model,usage,createdAt) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,model=excluded.model,usage=excluded.usage')
                            .run(id, input.scope.sessionId, input.kind, event.provider, event.model, event.usage ? JSON.stringify(event.usage) : null, Date.now());
                        this.memories.publish(`costs:${input.scope.workspaceId}:${input.scope.sessionId}`, { revision: Date.now() });
                    }
                    if (event.type === 'model_call' && input.processingId && input.processingCallId) {
                        this.memories.records.callSent(input.processingId, input.processingCallId);
                        this.memories.records.stage(input.processingId, '模型请求已发出，等待响应');
                    }
                    if (event.type === 'model_result' && input.processingId && input.processingCallId) {
                        const result = event.result;
                        this.memories.records.callFinish(input.processingId, input.processingCallId, result, result?.stopReason === 'error' || result?.stopReason === 'aborted' ? result.errorMessage || '模型请求失败' : undefined, result?.usage);
                        this.memories.records.stage(input.processingId, result?.stopReason === 'error' || result?.stopReason === 'aborted' ? '模型响应错误' : '已收到模型响应');
                    }
                    if (signal.aborted)
                        return;
                    if (event.type === 'read' || event.type === 'revision')
                        throw Error('独立记忆请求不允许工具读取');
                    if (event.type === 'completed') {
                        if (typeof event.answer !== 'string' || input.kind === 'organize' && !event.answer || event.answer.length > 32000 || typeof event.incomplete !== 'boolean')
                            throw Error('记忆结果无效');
                        if (event.incompleteReason !== undefined && (typeof event.incompleteReason !== 'string' || !Object.hasOwn(memoryIncompleteMessages, event.incompleteReason)))
                            throw Error('记忆未完成原因无效');
                        result = { answer: event.answer, incomplete: event.incomplete, ...(event.incompleteReason ? { incompleteReason: event.incompleteReason } : {}) };
                        if (input.processingId)
                            this.memories.records.stage(input.processingId, '清理执行环境');
                        reap = setTimeout(() => { failure = Error('记忆清理未完成'); void this.pool.retire(lease.ref, 'cleanup_timeout'); }, 1500);
                    }
                    if (event.type === 'failed') {
                        failure = Error(typeof event.error === 'string' ? event.error : '记忆执行失败');
                        void this.pool.retire(lease.ref, 'memory_failed');
                    }
                    if (event.type === 'cleaned') {
                        if (!result || failure || event.clean !== true)
                            throw Error('记忆执行未提供有效清理结果');
                        clearTimeout(reap);
                        // Single-use mode still waits for actual exit; cross-binding waits for validated cleanup.
                        child.removeListener('close', close);
                        void this.pool.release(lease.ref, { clean: true, keepSession: false }).then(() => finish(signal.aborted ? Error('记忆执行已取消或超时') : failure)).catch(error => { void this.pool.retire(lease.ref, 'cleanup_failed').then(() => finish(error)); });
                    }
                }
                catch (error) {
                    failure = error;
                    void this.pool.retire(lease.ref, 'memory_failed');
                }
            };
            child.on('message', message);
            child.once('error', error);
            child.once('close', close);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted)
                abort();
            else
                send({ type: 'start', input: start });
        });
    }
    async stopProviders(providers, confirmed) {
        const affected = [...this.jobs].filter(job => providers.includes(job.provider));
        if (affected.length && !confirmed)
            throw new AppError('ACTIVE_RUNS', '该供应商仍有记忆查询或整理执行，需要确认停止');
        for (const job of affected)
            job.controller.abort();
        await Promise.allSettled(affected.flatMap(job => job.promise ? [job.promise] : []));
        await this.pool.invalidate(providers);
    }
    async close() { this.stopped = true; for (const job of this.jobs)
        job.controller.abort(); await Promise.allSettled([...this.jobs].flatMap(job => job.promise ? [job.promise] : [])); if (this.ownsPool)
        await this.pool.close(); }
}
// Keep the old constructor export for integrations; it now participates in the physical pool.
export { PooledMemoryRunner as ColdMemoryRunner };
//# sourceMappingURL=memory-runner.js.map