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
export const taskSummaryInstruction = "工作预算已到。停止调用工具，只根据已有上下文给出不超过2000字的最终总结：先给结论，再交代必要证据、实际测试结果、未完成／未验证项及已知副作用。未知内容如实说明，不把总结完成当作验收通过。总结最多3分钟，超时强制停止。";

export function taskBudgetIntro(budget: TaskBudget) {
  return `本次工作预算：${budget.workMs}ms；截止时间：${new Date(budget.deadlineAt ?? Date.now() + budget.workMs).toISOString()}；此前任务链累计执行：${budget.elapsedMs}ms。工作到期后进入最多3分钟的总结阶段，只总结已有内容，不调用工具。`;
}

export function taskBudgetUpdate(budget: TaskBudget) {
  return `工作预算已更新，当前截止时间为${new Date(budget.deadlineAt ?? Date.now() + budget.workMs).toISOString()}，以此为准。工作到期后进入最多3分钟的总结阶段。`;
}

export function taskBudgetWarning(deadlineAt: number) {
  const remaining = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
  return `截至本条提醒生成时，剩余约${remaining}秒。请收尾并准备交付已有成果与未完成／未验证项，避免开始无法按时完成的新工作。`;
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
