import { safeExecutionRejection } from './execution-diagnostics.js';
export const sameLease = (a, b) => Boolean(a && b && a.instanceId === b.instanceId && a.generation === b.generation && a.leaseId === b.leaseId);
export const workerInstance = process.env.AXIOM_EXECUTION_INSTANCE ? Object.freeze({
    instanceId: process.env.AXIOM_EXECUTION_INSTANCE, generation: Number(process.env.AXIOM_EXECUTION_GENERATION), profileHash: process.env.AXIOM_EXECUTION_PROFILE,
}) : undefined;
export function acceptsLease(ref) {
    return !workerInstance || Boolean(ref && ref.instanceId === workerInstance.instanceId && ref.generation === workerInstance.generation && typeof ref.leaseId === "string");
}
export function instanceSend(value) {
    if (process.connected)
        process.send?.({ ...value, instance: workerInstance });
}
export function leaseSender(ref, runId) {
    // Capture once at callback/tool entry, never relabel an old asynchronous reply.
    return (value) => { if (process.connected)
        process.send?.({ ...value, lease: ref, runId }); };
}
export function sameInstance(ref) {
    return Boolean(workerInstance && ref && ref.instanceId === workerInstance.instanceId && ref.generation === workerInstance.generation && ref.profileHash === workerInstance.profileHash);
}
export class ExecutionPermitDeniedError extends Error {
    rejection;
    constructor(rejection) {
        const safe = safeExecutionRejection(rejection);
        super(`绑定期间配置或资源已变化，未发起模型请求（${safe.check}）`);
        this.name = 'ExecutionPermitDeniedError';
        this.rejection = safe;
    }
}
/** The coordinator rechecks configuration after asynchronous binding, before inference. */
export async function awaitExecutionPermit(ref, required) {
    if (!required)
        return;
    if (!ref || !workerInstance)
        throw Error('执行租约缺失');
    await new Promise((resolve, reject) => {
        const finish = (error) => { clearTimeout(timer); process.removeListener('message', message); process.removeListener('disconnect', disconnected); error ? reject(error) : resolve(); };
        const disconnected = () => finish(Error('执行协调器已断开'));
        const message = (event) => {
            if (event.type === 'shutdown' && sameInstance(event.instance))
                return finish(Error('执行已取消'));
            if (!sameLease(event.lease, ref))
                return;
            if (event.type === 'execution_permit')
                finish(event.allowed === true ? undefined : new ExecutionPermitDeniedError(event.rejection));
            if (event.type === 'stop' || event.type === 'shutdown')
                finish(Error('执行已取消'));
        };
        const timer = setTimeout(() => finish(Error('执行确认超时')), 30000);
        process.on('message', message);
        process.once('disconnect', disconnected);
        leaseSender(ref)({ type: 'binding_ready' });
    });
}
if (workerInstance)
    queueMicrotask(() => instanceSend({ type: "process_ready" }));
//# sourceMappingURL=execution-protocol.js.map