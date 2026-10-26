export const taskToolNames = [
    "delegate",
    "append",
    "cancel_task",
    "read_result",
];
/** Normalize pi's optional namespace for presentation, without changing execution names. */
export function taskToolName(name) {
    const normalized = name.replace(/^functions\./, "");
    return taskToolNames.find((tool) => tool === normalized) ?? null;
}
export const defaultBudgets = {
    concurrency: 4,
    workMs: 600_000,
};
export const taskPreferencesScope = "task-preferences";
/** Remove legacy generated boilerplate without changing the recorded report or outcome. */
export function cleanTaskResult(result) {
    const legacyToolLog = /^(?:未记录工具返回|[^；\n]+：(?:失败|已记录返回)(?:；[^；\n]+：(?:失败|已记录返回))*)。文件及外部副作用未回滚。$/;
    return {
        ...result,
        unfinished: result.unfinished.filter((item) => item !== "模型报告不等于全部验收通过；请核对交付中的未验证项。"),
        sideEffects: legacyToolLog.test(result.sideEffects) ? "" : result.sideEffects,
    };
}
export const emptyTasks = {
    tasks: [],
    frozen: false,
    defaultModel: null,
};
export const tasksScope = (s) => `tasks:${s.workspaceId}:${s.sessionId}`;
export const taskLabels = {
    queued: "排队中",
    starting: "正在初始化",
    running: "执行中",
    stopping: "正在停止",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
    interrupted: "执行中断",
};
export const taskActive = (s) => [
    "queued",
    "starting",
    "running",
    "stopping",
].includes(s);
//# sourceMappingURL=tasks.js.map