export interface TaskBudget {
  workMs: number;
  elapsedMs: number;
  workStartedAt?: number;
  revision?: number;
  summaryDeadlineAt?: number | null;
  deadlineAt?: number;
}

// A new deadline can supersede an input-normalization drain. Never let the
// phase owner wait on a queue whose acceptance gate only that owner can open.
export class TaskPhase {
  stage: "work" | "summary" = "work";
  revision = 0;
  private listeners = new Set<() => void>();
  change(stage: typeof this.stage) {
    if (stage === this.stage) return false;
    this.stage = stage;
    this.revision++;
    for (const notify of this.listeners) notify();
    return true;
  }
  async drain(pending: Promise<void>, revision: number) {
    if (revision !== this.revision) return;
    let notify!: () => void;
    const changed = new Promise<void>((resolve) => { notify = resolve; this.listeners.add(notify); });
    try { await Promise.race([pending, changed]); }
    finally { this.listeners.delete(notify); }
  }
}

export const taskSummaryMs = 180_000;
export const taskSummaryInstruction = "工作预算已到。现在只基于已有上下文生成最终总结，不得调用任何工具，不得继续调查、测试或修改文件。请交代已有发现与证据、实际执行的测试及结果、未完成／未验证项和已知副作用；没有证据的内容明确标为未知，不把总结完成当作任务全部验收通过。本次总结最多 3 分钟，超时将强制停止。";

export function taskBudgetIntro(budget: TaskBudget) {
  return `本次执行预算：${budget.workMs}ms；截止时间：${new Date(budget.deadlineAt ?? Date.now() + budget.workMs).toISOString()}；此前任务链累计执行：${budget.elapsedMs}ms。有效追加会刷新工作时限。服务端会在剩余总预算的 20%（最多提前 60 秒）时提醒；工作到期进入无工具总结，总结最多 3 分钟，超时强制停止。`;
}

export function taskBudgetWarning(deadlineAt: number) {
  const remaining = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
  return `子任务预算即将用尽：截至本条提示生成时，剩余约 ${remaining} 秒。请尽快交付已有发现、实际测试结果及未完成／未验证项，避免启动无法在剩余时间内完成的新工作。此提醒不延长预算，工作到期后将进入最多 3 分钟的无工具总结。`;
}

/** Server worker clock; delivery only queues Steering inside an active run. */
export class TaskBudgetReminder {
  private timer?: ReturnType<typeof setTimeout>;
  private budget?: TaskBudget;
  private warnedDeadlines = new Set<number>();

  constructor(private readonly deliver: (deadlineAt: number) => boolean) {}

  update(budget: TaskBudget) {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.budget = budget;
    const deadline = budget.deadlineAt;
    if (deadline === undefined || deadline <= Date.now() || this.warnedDeadlines.has(deadline)) return;
    const delay = deadline - Math.min(60_000, budget.workMs * 0.2) - Date.now();
    if (delay <= 0) this.flush();
    else this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, Math.ceil(delay));
  }

  // Initialization can pass the warning threshold before the model run starts.
  flush() {
    const budget = this.budget, deadline = budget?.deadlineAt;
    if (!budget || deadline === undefined || this.warnedDeadlines.has(deadline) ||
        deadline <= Date.now() || deadline - Date.now() > Math.min(60_000, budget.workMs * 0.2)) return;
    if (this.deliver(deadline)) this.warnedDeadlines.add(deadline);
  }

  dispose() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.budget = undefined;
  }
}
