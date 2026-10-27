import { safeExecutionRejection, type ExecutionRejection } from './execution-diagnostics.js';
export type LeaseRef = Readonly<{ instanceId: string; generation: number; leaseId: string }>;
export type InstanceRef = Readonly<{ instanceId: string; generation: number; profileHash: string }>;
export const sameLease = (a: LeaseRef | undefined, b: LeaseRef | undefined) => Boolean(a && b && a.instanceId === b.instanceId && a.generation === b.generation && a.leaseId === b.leaseId);
export const workerInstance: InstanceRef | undefined = process.env.AXIOM_EXECUTION_INSTANCE ? Object.freeze({
  instanceId: process.env.AXIOM_EXECUTION_INSTANCE, generation: Number(process.env.AXIOM_EXECUTION_GENERATION), profileHash: process.env.AXIOM_EXECUTION_PROFILE!,
}) : undefined;
export function acceptsLease(ref: LeaseRef | undefined) {
  return !workerInstance || Boolean(ref && ref.instanceId === workerInstance.instanceId && ref.generation === workerInstance.generation && typeof ref.leaseId === "string");
}
export function instanceSend(value: object) {
  if (process.connected) process.send?.({ ...value, instance: workerInstance });
}
export function leaseSender(ref?: LeaseRef, runId?: string) {
  // Capture once at callback/tool entry, never relabel an old asynchronous reply.
  return (value: unknown) => { if (process.connected) process.send?.({ ...(value as object), lease: ref, runId }); };
}
export function sameInstance(ref: InstanceRef | undefined) {
  return Boolean(workerInstance && ref && ref.instanceId === workerInstance.instanceId && ref.generation === workerInstance.generation && ref.profileHash === workerInstance.profileHash);
}
export class ExecutionPermitDeniedError extends Error {
  readonly rejection: Readonly<ExecutionRejection>;
  constructor(rejection?: unknown) {
    const safe = safeExecutionRejection(rejection);
    super(`绑定期间资源已变化或内部执行快照损坏，未发起模型请求（${safe.check}）`);
    this.name = 'ExecutionPermitDeniedError';
    this.rejection = safe;
  }
}
/** The coordinator rechecks configuration after asynchronous binding, before inference. */
export async function awaitExecutionPermit(ref: LeaseRef | undefined, required?: boolean) {
  if (!required) return;
  if (!ref || !workerInstance) throw Error('执行租约缺失');
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); process.removeListener('message', message); process.removeListener('disconnect', disconnected); error ? reject(error) : resolve(); };
    const disconnected = () => finish(Error('执行协调器已断开'));
    const message = (event: any) => {
      if (event.type === 'shutdown' && sameInstance(event.instance)) return finish(Error('执行已取消'));
      if (!sameLease(event.lease, ref)) return;
      if (event.type === 'execution_permit') finish(event.allowed === true ? undefined : new ExecutionPermitDeniedError(event.rejection));
      if (event.type === 'stop' || event.type === 'shutdown') finish(Error('执行已取消'));
    };
    const timer = setTimeout(() => finish(Error('执行确认超时')), 30000);
    process.on('message', message); process.once('disconnect', disconnected);
    leaseSender(ref)({ type: 'binding_ready' });
  });
}
if (workerInstance) queueMicrotask(() => instanceSend({ type: "process_ready" }));
