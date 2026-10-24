import { taskToolName, type TaskResult, type TaskTool } from "../shared/tasks.js";

/** The model needs outcomes and evidence, not the complete transport/storage record. */
export function modelTaskOutput(name: TaskTool, details: unknown) {
  const value = details as Partial<TaskResult> & { taskIds?: string[]; taskRefs?: string[] };
  if (name === "delegate") return { taskIds: value.taskRefs ?? value.taskIds, status: value.status };
  if (name !== "read_result") return { status: value.status };
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

/** Preserve the existing UI JSON contract without putting metadata in model content.
 * Old transcripts and failed tools still render their original content.
 */
export function taskDisplayText(name: string | undefined, details: unknown, isError = false): string | undefined {
  if (!isError && name && taskToolName(name) && details && typeof details === "object" && !Array.isArray(details))
    return JSON.stringify(details);
  return undefined;
}
