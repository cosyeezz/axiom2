/** Public task outcome, shared by model content and the UI execution-output view. */
export function modelTaskOutput(name, details) {
    const value = details;
    if (name === "delegate")
        return { taskIds: value.taskRefs ?? value.taskIds, status: value.status };
    if (name !== "read_result")
        return { status: value.status };
    return {
        status: value.status,
        report: value.report,
        ...(value.reportKind ? { reportKind: value.reportKind } : {}),
        ...(value.reason ? { reason: value.reason } : {}),
        ...(value.unfinished?.length ? { unfinished: value.unfinished } : {}),
        ...(value.sideEffects ? { sideEffects: value.sideEffects } : {}),
        ...(value.budgetSummary ? { budgetSummary: true } : {}),
        ...(value.stop ? { stop: { source: value.stop.source,
                ...(value.stop.reason ? { reason: value.stop.reason } : {}) } } : {}),
    };
}
//# sourceMappingURL=task-output.js.map