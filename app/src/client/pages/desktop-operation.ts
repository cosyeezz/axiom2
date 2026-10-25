import { validMaintenanceTask } from '../../shared/maintenance.js';

export function validOperationJob(value: unknown, actionKey: 'kind' | 'action' = 'kind'): boolean {
  if (!value || typeof value !== 'object') return false;
  const job = value as Record<string, unknown>;
  return typeof job[actionKey] === 'string' && !!job[actionKey] && typeof job.running === 'boolean'
    && validMaintenanceTask(job.task) && (job.id === undefined || job.id === job.task.id);
}

// Only admission refusals that are emitted before a task is claimed prove no write began.
export function isSubmissionRefused(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return ["已有安装任务正在执行或结果待核实。", "已有更新正在进行，请等待完成。", "已有更新进程、启动结果或父提交尚未确认，请先核实已有任务；归属记录已保留。", "中断核实尚未提交完成，请再次核实原任务。", "服务启动结果仍需核实，请先恢复旧版本。", "上次更新退出尚未确认，请先核实已有任务。"].includes(message);
}
export type OperationWitness = { action: string; previousId?: string; sentAt: number };
export function observesSubmission(witness: OperationWitness, job: { kind?: string; task?: { id: string; createdAt: number } } | null | undefined): boolean {
  return !!job?.task && job.kind === witness.action && job.task.id !== witness.previousId && job.task.createdAt >= witness.sentAt;
}
