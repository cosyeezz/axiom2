export const thinkingLevels = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
];
export const runOriginLabels = {
    task_notification: "任务结果通知后续跑",
    memory_continuation: "按记忆进度续跑",
    compression_preparation: "压缩前记忆维护",
    manual_resume: "手动继续执行",
};
/** Only explicit host facts have a source; legacy runs stay unknown. */
export const readRunOrigin = (value) => typeof value === "string" && Object.hasOwn(runOriginLabels, value) ? value : undefined;
export const agentScope = (s) => `agent:${s.workspaceId}:${s.sessionId}`;
export const threadScope = (s) => `thread:${s.workspaceId}:${s.sessionId}`;
export const messageScope = (s, id) => `message:${s.workspaceId}:${s.sessionId}:${id}`;
export const emptyAgent = {
    selection: null,
    run: null,
    environment: null,
    usage: null,
};
export const emptyThread = { ids: [] };
export const activeStatus = (status) => ["starting", "running", "stopping"].includes(status ?? "");
export const running = (run) => activeStatus(run?.status);
export const runLabels = {
    starting: "正在初始化",
    running: "执行中",
    stopping: "正在停止",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
    interrupted: "执行中断",
};
//# sourceMappingURL=agent.js.map